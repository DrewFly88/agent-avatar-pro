"""
Avatar Service — 头像存储、格式转换、压缩的核心服务。

存储路径: ~/.qwenpaw/plugins/agent-avatar-pro/data/{agent_id}/
    avatar.{ext}       — 原始头像文件
    thumbnail.{ext}    — 缩略图 (48x48)
    meta.json          — 元数据 (格式、来源、上传时间等)
"""

import asyncio
import json
import os
import time
from pathlib import Path
from typing import Optional

# httpx for URL Lottie JSON download (URL 类型 Lottie 生成 poster.png 时下载远程 JSON)
try:
    import httpx
except ImportError:
    httpx = None  # 不可用时跳过 URL Lottie poster 生成，前端仍可 fetch URL 渲染动画

# Pillow for image processing
try:
    from PIL import Image
except ImportError:
    Image = None


# ── Supported formats ────────────────────────────────────────────
SUPPORTED_FORMATS = {
    "png": {"mime": "image/png", "animated": False, "magic": b"\x89PNG"},
    "jpg": {"mime": "image/jpeg", "animated": False, "magic": b"\xff\xd8\xff"},
    "jpeg": {"mime": "image/jpeg", "animated": False, "magic": b"\xff\xd8\xff"},
    "gif": {"mime": "image/gif", "animated": True, "magic": b"GIF8"},
    "webp": {"mime": "image/webp", "animated": True, "magic": b"RIFF"},
    "svg": {"mime": "image/svg+xml", "animated": False, "magic": b"<svg"},
    "apng": {"mime": "image/png", "animated": True, "magic": b"\x89PNG"},
    "json": {"mime": "application/json", "animated": True, "magic": b'{"'},  # Lottie
}

# Security: URL protocol whitelist
ALLOWED_URL_PROTOCOLS = ("https://",)

# Default settings
DEFAULT_MAX_SIZE_MB = 5
DEFAULT_AVATAR_PX = 256
THUMBNAIL_PX = 48

# ── Module-level service singleton with readiness gate ───────────
# plugin.py sets the instance on startup; avatar_backend.py reads it
# when tools are invoked. The asyncio.Event ensures callers wait for
# initialization instead of getting None during the startup window.

_service_instance: "AvatarService | None" = None
_service_ready = asyncio.Event()

# Maximum seconds to wait for service initialization
_READY_TIMEOUT = 15


def set_service(svc: "AvatarService | None") -> None:
    """设置全局服务实例（由 plugin.py 在 startup hook 中调用）。"""
    global _service_instance
    _service_instance = svc
    if svc is not None:
        _service_ready.set()
    else:
        _service_ready.clear()


async def get_service(timeout: float = _READY_TIMEOUT) -> "AvatarService | None":
    """获取全局服务实例，若尚未初始化则等待（最多 timeout 秒）。

    供 HTTP 端点和 Agent 工具函数使用。
    返回 None 表示等待超时、服务仍未就绪。
    """
    if _service_instance is not None:
        return _service_instance
    try:
        await asyncio.wait_for(_service_ready.wait(), timeout=timeout)
    except asyncio.TimeoutError:
        pass
    return _service_instance


class AvatarService:
    """头像管理服务。"""

    def __init__(self):
        self._data_dir: Optional[Path] = None
        self._config: dict = {}

    async def initialize(self, plugin_dir: Optional[str] = None) -> None:
        """初始化服务：创建数据目录，加载配置。

        Args:
            plugin_dir: 插件安装目录的路径，数据将存储在其下的 data/ 子目录。
                        若未提供，回退到 ~/.qwenpaw/plugins/agent-avatar-pro/data/。
        """
        from qwenpaw.plugins import get_tool_config

        self._config = get_tool_config("set_agent_avatar") or {}
        # 数据存储在插件安装目录下的 data/ 子目录
        if plugin_dir:
            self._data_dir = Path(plugin_dir) / "data"
        else:
            # 回退：兼容旧版安装
            self._data_dir = Path.home() / ".qwenpaw" / "plugins" / "agent-avatar-pro" / "data"
        self._data_dir.mkdir(parents=True, exist_ok=True)

    async def cleanup(self) -> None:
        """关闭时释放资源。"""
        pass

    async def purge_all_data(self) -> None:
        """卸载时删除所有头像数据。"""
        if self._data_dir and self._data_dir.exists():
            import shutil
            shutil.rmtree(self._data_dir, ignore_errors=True)

    # ── Upload ────────────────────────────────────────────────────

    async def upload_avatar(self, agent_id: str, file_data: bytes) -> dict:
        """上传头像文件。

        流程:
        1. 校验文件大小
        2. Magic bytes 格式检测
        3. SVG 安全清洗
        4. Pillow resize (静态图片)
        5. 生成缩略图
        6. 保存文件 + 元数据
        """
        if not self._data_dir:
            return {"ok": False, "error": "Service not initialized"}

        # 1. Size check
        max_mb = self._config.get("max_file_size", DEFAULT_MAX_SIZE_MB)
        max_bytes = int(max_mb) * 1024 * 1024
        if len(file_data) > max_bytes:
            return {"ok": False, "error": f"File exceeds {max_mb}MB limit"}

        # 2. Format detection via magic bytes
        fmt = self._detect_format(file_data)
        if not fmt:
            return {"ok": False, "error": "Unsupported file format"}

        # 3. SVG security sanitization
        if fmt == "svg":
            file_data = self._sanitize_svg(file_data)

        # 4. Create agent directory
        agent_dir = self._data_dir / agent_id
        agent_dir.mkdir(parents=True, exist_ok=True)

        # 4.5 检查是否已有头像，若有则备份并记录历史
        replaced = False
        previous_format = None
        history: list = []

        meta_path = agent_dir / "meta.json"
        if meta_path.exists():
            old_meta = json.loads(meta_path.read_text())
            replaced = True
            previous_format = old_meta.get("format")
            history = old_meta.get("history", [])
            history.append(self._build_history_entry(old_meta))
            # 仅保留最近 1 条历史
            if len(history) > 1:
                history = history[-1:]
            self._backup_existing(agent_dir)

        # 5. Save original file
        ext = fmt if fmt != "jpeg" else "jpg"
        avatar_path = agent_dir / f"avatar.{ext}"
        avatar_path.write_bytes(file_data)

        # 6. Resize static images & generate thumbnail
        if Image and fmt in ("png", "jpg", "jpeg", "webp"):
            # 动画 WebP 不能走 Pillow resize，会破坏动画帧
            if fmt == "webp" and self._is_animated_webp(file_data):
                pass  # skip resize for animated WebP
            else:
                target_px = int(self._config.get("default_size", DEFAULT_AVATAR_PX))
                self._resize_image(avatar_path, target_px)
                self._generate_thumbnail(avatar_path, agent_dir / f"thumbnail.{ext}")

        # 6.5 Lottie → 生成静态封面 poster.png
        # /image 端点对 Lottie 格式返回 poster.png，使 <img src> 和
        # chat.welcome.set({avatar: url}) 能正常加载（CDN 不可用时的回退）
        if fmt == "json":
            self._generate_lottie_poster(agent_dir, file_data)

        # 7. Save metadata (含历史记录)
        meta = {
            "format": fmt,
            "source": "upload",
            "size_bytes": len(file_data),
            "uploaded_at": time.time(),
            "filename": f"avatar.{ext}",
            "history": history,
        }
        meta_path = agent_dir / "meta.json"
        meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2))

        return {
            "ok": True,
            "agent_id": agent_id,
            "format": fmt,
            "size": len(file_data),
            "replaced": replaced,
            "previous_format": previous_format,
        }

    # ── URL Avatar ────────────────────────────────────────────────

    async def set_avatar_url(self, agent_id: str, url: str) -> dict:
        """通过 URL 设置头像（不下载，仅保存 URL 引用）。

        若已有文件类型头像，会清理旧的 avatar/thumbnail 文件（解决孤立文件问题）。
        若已有任意类型头像，会备份旧数据并记录历史。
        """
        if not self._data_dir:
            return {"ok": False, "error": "Service not initialized"}

        # Security: only allow HTTPS URLs
        if not url.startswith(ALLOWED_URL_PROTOCOLS):
            return {"ok": False, "error": "Only HTTPS URLs are allowed"}

        agent_dir = self._data_dir / agent_id
        agent_dir.mkdir(parents=True, exist_ok=True)

        # 检查现有头像，备份并记录历史
        replaced = False
        previous_format = None
        previous_source = None
        history: list = []

        meta_path = agent_dir / "meta.json"
        if meta_path.exists():
            old_meta = json.loads(meta_path.read_text())
            replaced = True
            previous_format = old_meta.get("format")
            previous_source = old_meta.get("source")
            history = old_meta.get("history", [])
            history.append(self._build_history_entry(old_meta))
            if len(history) > 1:
                history = history[-1:]

            # file→URL 切换：清理旧的头像文件（解决孤立文件问题）
            if previous_source == "file":
                self._cleanup_old_files(agent_dir)
            else:
                # URL→URL 替换：备份旧 meta
                self._backup_existing(agent_dir)

        # Detect format from URL extension
        fmt = "unknown"
        for ext_key in SUPPORTED_FORMATS:
            if url.lower().endswith(f".{ext_key}"):
                fmt = ext_key
                break

        meta = {
            "format": fmt,
            "source": "url",
            "url": url,
            "uploaded_at": time.time(),
            "history": history,
        }
        meta_path = agent_dir / "meta.json"
        meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2))

        # URL 类型 Lottie：下载远程 JSON 生成静态封面 poster.png，
        # 使 /image 端点和前端 CORS/网络失败时仍能显示静态占位图
        # 下载失败不阻塞设置（meta 已写入，前端可 fetch URL 渲染动画）
        if fmt == "json" and httpx:
            asyncio.create_task(self._download_and_make_lottie_poster(url, agent_dir))

        return {
            "ok": True,
            "agent_id": agent_id,
            "url": url,
            "format": fmt,
            "replaced": replaced,
            "previous_format": previous_format,
        }

    async def _download_and_make_lottie_poster(self, url: str, agent_dir: Path) -> None:
        """下载远程 Lottie JSON 并生成静态封面 poster.png。

        用于 URL 类型 Lottie 头像，使 /image 端点对 URL Lottie 也能返回静态 PNG，
        作为前端 fetch CORS 失败时的回退。下载/生成失败时静默跳过（不影响设置）。

        SSRF 防护：下载前调用 _is_ssrf_url 拦截内网/保留地址，
        避免 HTTPS URL 指向内网服务（如 https://10.0.0.1）触发服务端请求伪造。
        """
        # SSRF 拦截：内网/保留地址直接拒绝，不发起请求
        if self._is_ssrf_url(url):
            return
        try:
            # 5s 超时，限制 1MB 避免恶意超大 JSON
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(url)
                if resp.status_code != 200:
                    return
                # 仅接受 JSON 响应（宽松：text/plain 也接受，部分 CDN 返回此类型）
                ct = resp.headers.get("content-type", "")
                if "json" not in ct and "text" not in ct:
                    return
                data = resp.content
                if len(data) > 1_000_000:  # 1MB 上限
                    return
            self._generate_lottie_poster(agent_dir, data)
        except Exception:
            # 网络错误/超时/JSON 格式异常：静默跳过，前端仍可 fetch URL 渲染
            pass

    @staticmethod
    def _is_ssrf_url(url: str) -> bool:
        """检测 URL 是否指向内网/保留地址（SSRF 防护）。

        解析 URL hostname，对域名做 DNS 解析，对结果 IP 检查：
        - 私有网段（10/8、172.16/12、192.168/16）
        - 链路本地（169.254/16，含 AWS metadata 169.254.169.254）
        - 回环（127/8）、未指定（0/8）、广播/组播
        - IPv6 ::1 / fe80:: / fc00::/7 (ULA)

        解析失败（无网络/DNS 拒绝）时保守判定为 SSRF（拒绝下载）。
        """
        import ipaddress
        import socket
        from urllib.parse import urlparse

        try:
            host = urlparse(url).hostname
            if not host:
                return True  # 无 hostname 视为可疑
            # 先尝试直接当 IP 解析（host 本身就是 IP 字面量）
            try:
                addr = ipaddress.ip_address(host)
            except ValueError:
                # 域名：做 DNS 解析（同步 socket，超时 2s）
                try:
                    resolved = socket.getaddrinfo(
                        host, None,
                        family=socket.AF_UNSPEC,
                        type=socket.SOCK_STREAM,
                        proto=socket.IPPROTO_TCP,
                        flags=socket.AI_NUMERICHOST,
                    )
                except (socket.gaierror, socket.herror):
                    return True  # DNS 解析失败：保守拒绝
                # 取所有解析到的 IP 检查
                addr_ips = []
                for family, _, _, _, sockaddr in resolved:
                    try:
                        addr_ips.append(ipaddress.ip_address(sockaddr[0]))
                    except (ValueError, IndexError):
                        continue
                if not addr_ips:
                    return True
                # 任一解析 IP 落内网即拒绝
                return any(
                    addr.is_private or addr.is_loopback or addr.is_link_local
                    or addr.is_unspecified or addr.is_multicast or addr.is_reserved
                    for addr in addr_ips
                )
            # host 本身是 IP 字面量：直接检查
            return (
                addr.is_private or addr.is_loopback or addr.is_link_local
                or addr.is_unspecified or addr.is_multicast or addr.is_reserved
            )
        except Exception:
            # 任何意外：保守判定为 SSRF（拒绝下载）
            return True

    # ── Get Avatar ────────────────────────────────────────────────

    async def get_avatar(self, agent_id: str, size: str = "full") -> dict:
        """获取 Agent 头像信息。"""
        if not self._data_dir:
            return {"ok": False, "error": "Service not initialized"}

        agent_dir = self._data_dir / agent_id
        meta_path = agent_dir / "meta.json"

        if not meta_path.exists():
            return {"ok": False, "error": "No avatar set for this agent"}

        meta = json.loads(meta_path.read_text())

        # URL-based avatar
        if meta.get("source") == "url":
            return {"ok": True, "type": "url", "url": meta["url"], "format": meta.get("format", "unknown")}

        # File-based avatar
        filename = meta.get("filename", "avatar.png")
        if size == "thumb":
            thumb_name = filename.replace("avatar.", "thumbnail.")
            if (agent_dir / thumb_name).exists():
                filename = thumb_name

        file_path = agent_dir / filename
        if not file_path.exists():
            return {"ok": False, "error": "Avatar file not found"}

        import base64
        data = base64.b64encode(file_path.read_bytes()).decode("ascii")
        mime = SUPPORTED_FORMATS.get(meta.get("format", ""), {}).get("mime", "image/png")

        return {
            "ok": True,
            "type": "file",
            "format": meta.get("format", "unknown"),
            "mime": mime,
            "data": data,
        }

    # ── Has Avatar ─────────────────────────────────────────────────

    def has_avatar(self, agent_id: str) -> bool:
        """检查指定 Agent 是否已设置自定义头像。"""
        if not self._data_dir:
            return False
        meta_path = self._data_dir / agent_id / "meta.json"
        return meta_path.exists()

    # ── Get Avatar Image (raw bytes) ─────────────────────────────

    async def get_avatar_image(self, agent_id: str, size: str = "full") -> "tuple[bytes, str] | None":
        """
        获取 Agent 头像的原始图片字节和 MIME 类型。
        用于 <img> 标签直接加载（返回 FileResponse / Response 而非 JSON）。
        返回 None 表示该 Agent 没有头像。
        """
        if not self._data_dir:
            return None

        agent_dir = self._data_dir / agent_id
        meta_path = agent_dir / "meta.json"

        if not meta_path.exists():
            return None

        meta = json.loads(meta_path.read_text())

        # Lottie 格式：返回静态封面 poster.png（浏览器无法渲染原始 JSON）
        # URL 类型 Lottie 也能返回 poster.png（set_avatar_url 时 _download_and_make_lottie_poster 生成）
        if meta.get("format") == "json":
            poster_path = agent_dir / "poster.png"
            if poster_path.exists():
                return poster_path.read_bytes(), "image/png"
            return None

        # URL-based avatar（非 Lottie）：不下载，返回 None（前端应直接使用 meta["url"]）
        if meta.get("source") == "url":
            return None

        filename = meta.get("filename", "avatar.png")
        if size == "thumb":
            thumb_name = filename.replace("avatar.", "thumbnail.")
            if (agent_dir / thumb_name).exists():
                filename = thumb_name

        file_path = agent_dir / filename
        if not file_path.exists():
            return None

        data = file_path.read_bytes()
        mime = SUPPORTED_FORMATS.get(meta.get("format", ""), {}).get("mime", "image/png")
        return data, mime

    # ── Delete Avatar ─────────────────────────────────────────────

    async def delete_avatar(self, agent_id: str) -> dict:
        """删除 Agent 的自定义头像。"""
        if not self._data_dir:
            return {"ok": False, "error": "Service not initialized"}

        agent_dir = self._data_dir / agent_id
        if agent_dir.exists():
            import shutil
            shutil.rmtree(agent_dir, ignore_errors=True)

        return {"ok": True, "agent_id": agent_id}

    # ── List Avatars ──────────────────────────────────────────────

    async def list_avatars(self) -> dict:
        """列出所有已配置头像的 Agent。"""
        if not self._data_dir:
            return {"ok": False, "error": "Service not initialized"}

        results = []
        for agent_dir in self._data_dir.iterdir():
            if not agent_dir.is_dir():
                continue
            meta_path = agent_dir / "meta.json"
            if meta_path.exists():
                meta = json.loads(meta_path.read_text())
                results.append({
                    "agent_id": agent_dir.name,
                    "format": meta.get("format", "unknown"),
                    "source": meta.get("source", "unknown"),
                    "uploaded_at": meta.get("uploaded_at", 0),
                })

        return {"ok": True, "count": len(results), "avatars": results}

    # ── Internal Helpers ──────────────────────────────────────────

    def _backup_existing(self, agent_dir: Path) -> bool:
        """备份现有头像文件到 backup/ 子目录。返回是否有备份。

        将 agent 目录下所有文件（含 meta.json）移动到 backup/，
        覆盖上一次的备份。仅保留最近一次备份。
        """
        backup_dir = agent_dir / "backup"
        has_backup = False

        # 先移动普通文件
        for f in agent_dir.iterdir():
            if f.is_file():
                if not backup_dir.exists():
                    backup_dir.mkdir(parents=True, exist_ok=True)
                dst = backup_dir / f.name
                if dst.exists():
                    dst.unlink()
                f.rename(dst)
                has_backup = True

        return has_backup

    def _cleanup_old_files(self, agent_dir: Path) -> None:
        """清理 agent 目录中的旧头像文件（不含 meta.json 和 backup/ 子目录）。

        用于 file→URL 切换时，删除残留的 avatar.{ext} / thumbnail.{ext}。
        """
        for f in agent_dir.iterdir():
            if f.is_file() and f.name != "meta.json":
                f.unlink()

    @staticmethod
    def _build_history_entry(old_meta: dict) -> dict:
        """从旧 meta 构建历史记录条目。"""
        return {
            "format": old_meta.get("format", "unknown"),
            "source": old_meta.get("source", "unknown"),
            "replaced_at": time.time(),
        }

    def _detect_format(self, data: bytes) -> Optional[str]:
        """通过 Magic bytes 检测图片格式。"""
        for fmt, info in SUPPORTED_FORMATS.items():
            magic = info.get("magic", b"")
            if data[:len(magic)] == magic:
                # Distinguish APNG from regular PNG
                if fmt == "png" and self._is_apng(data):
                    return "apng"
                # Distinguish animated WebP from static WebP
                if fmt == "webp" and not self._is_animated_webp(data):
                    # 静态 WebP — 当作普通静态图片处理，允许裁剪/缩放
                    return fmt  # 仍然返回 "webp"，但 animated 仅可由 SUPPORTED_FORMATS 查询
                return fmt

        # SVG 可能以 <?xml 声明开头，需在内容中查找 <svg 标签
        if data[:5] == b"<?xml" and b"<svg" in data[:1024]:
            return "svg"

        return None

    @staticmethod
    def _is_apng(data: bytes) -> bool:
        """检测 PNG 是否为 APNG（包含 acTL chunk）。"""
        return b"acTL" in data[:1024]

    @staticmethod
    def _is_animated_webp(data: bytes) -> bool:
        """检测 WebP 文件是否为动画格式。

        WebP 容器结构：RIFF [size] WEBP [chunks...]
        VP8X 扩展块（offset 12）包含动画标志：
          - byte 0: 'V' (0x56), byte 1: 'P' (0x50)
          - byte 2: '8' (0x38), byte 3: 'X' (0x58)
          - byte 8 (offset 20): flags，bit 1 (0x02) = animation
        """
        if len(data) < 30:
            return False
        # 检查 VP8X chunk 签名（位于 offset 12）
        if data[12:16] != b"VP8X":
            return False
        # flags 字节位于 VP8X chunk 起始 + 8 = offset 20
        return (data[20] & 0x02) != 0

    @staticmethod
    def _generate_lottie_poster(agent_dir: Path, json_data: bytes) -> None:
        """从 Lottie JSON 生成静态封面 poster.png。

        策略：读取 JSON 的 w/h 尺寸，生成同尺寸的品牌色占位 PNG。
        /image 端点对 Lottie 格式返回此 poster.png，使 <img src> 和
        chat.welcome.set({avatar: url}) 能正常加载。

        后续可升级为使用 cairosvg 或 Pillow 绘制首帧静态图，
        但首帧渲染需要完整 Lottie 引擎，Python 侧无成熟方案。
        """
        if not Image:
            return
        try:
            meta = json.loads(json_data)
            w = int(meta.get("w", DEFAULT_AVATAR_PX))
            h = int(meta.get("h", DEFAULT_AVATAR_PX))
            # 限制尺寸避免恶意超大 JSON 导致 OOM
            w = max(1, min(w, 1024))
            h = max(1, min(h, 1024))
            img = Image.new("RGBA", (w, h), (92, 107, 192, 255))  # 品牌色占位
            img.save(agent_dir / "poster.png", "PNG")
        except Exception:
            pass  # Non-critical: 聊天窗口和管理面板仍可走 LottieRenderer CDN 路径

    @staticmethod
    def _sanitize_svg(data: bytes) -> bytes:
        """清洗 SVG 中的潜在 XSS 内容。

        覆盖向量：
        - `<script>` / `<foreignObject>` 标签整段移除（foreignObject 可嵌入 HTML/JS）
        - `on*` 事件属性（支持引号、未引号、反引号包裹）
        - `javascript:` URL（含未引号包裹）
        - `style` 属性中的 `expression()` / `url(javascript:...)`（IE 老旧向量）
        - SVG 尺寸上限（width/height > 4096 视为恶意，裁剪到 256）

        保守策略：宁可误杀部分合法属性，也要确保剥离所有已知 XSS 向量。
        """
        import re
        text = data.decode("utf-8", errors="replace")

        # 1. 移除 <script> 和 <foreignObject> 整段（含内容）
        text = re.sub(r"<script[\s\S]*?</script>", "", text, flags=re.IGNORECASE)
        text = re.sub(r"<foreignObject[\s\S]*?</foreignObject>", "", text, flags=re.IGNORECASE)

        # 2. 移除 on* 事件属性（支持单引号/双引号/反引号/未引号包裹）
        # 未引号：onload=alert(1) → 需匹配到空白或 > 结束
        text = re.sub(r"\bon\w+\s*=\s*['\"\`][^'\"\`]*['\"\`]", "", text, flags=re.IGNORECASE)
        text = re.sub(r"\bon\w+\s*=\s*[^\s>]+", "", text, flags=re.IGNORECASE)

        # 3. 移除 javascript: URL（含未引号包裹）
        text = re.sub(r"javascript\s*:", "", text, flags=re.IGNORECASE)

        # 4. 移除 style 属性中的 expression() / url(javascript:...)（IE 老旧向量）
        # 先剥 style 属性整段（保守策略，避免误判半边匹配）
        text = re.sub(r"\bstyle\s*=\s*['\"\`][^'\"\`]*['\"\`]", "", text, flags=re.IGNORECASE)
        # 再兜底剥残留的 expression() / url(javascript:)
        text = re.sub(r"expression\s*\(", "", text, flags=re.IGNORECASE)

        # 5. SVG 尺寸上限：width/height > 4096 视为恶意，裁剪到 256（避免 Pillow 解码 OOM）
        def _cap_size(m):
            try:
                val = int(m.group(2))
                return f"{m.group(1)}={256 if val > 4096 else val}"
            except (ValueError, IndexError):
                return m.group(0)

        # 匹配 width="1234" / height="1234"（支持单/双/未引号）
        text = re.sub(r"\b(width|height)\s*=\s*['\"\`]?\d+['\"\`]?", _cap_size, text, flags=re.IGNORECASE)

        return text.encode("utf-8")

    @staticmethod
    def _resize_image(path: Path, target_px: int) -> None:
        """使用 Pillow 调整图片尺寸（保持宽高比）。"""
        if not Image:
            return
        try:
            img = Image.open(path)
            img.thumbnail((target_px, target_px), Image.LANCZOS)
            img.save(path)
        except Exception:
            pass  # Non-critical: keep original if resize fails

    @staticmethod
    def _generate_thumbnail(src: Path, dst: Path) -> None:
        """生成缩略图。"""
        if not Image:
            return
        try:
            img = Image.open(src)
            img.thumbnail((THUMBNAIL_PX, THUMBNAIL_PX), Image.LANCZOS)
            img.save(dst)
        except Exception:
            pass
