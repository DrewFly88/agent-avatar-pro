"""
Agent Avatar Pro — QwenPaw Plugin Entry Point

为 QwenPaw Agent 提供自定义头像功能，支持 APNG/SVG/Lottie 等动态格式，
URL 头像设置，以及聊天窗口头像展示。

用法:
    qwenpaw plugin install /path/to/agent-avatar-pro
"""

import os
import sys

# QwenPaw 通过 importlib.util.spec_from_file_location 加载此文件，
# 插件目录可能不在 sys.path 中，需显式添加以支持同级模块导入。
_plugin_dir = os.path.dirname(os.path.abspath(__file__))
if _plugin_dir not in sys.path:
    sys.path.insert(0, _plugin_dir)

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, Response
from avatar_backend import set_agent_avatar, get_agent_avatar_status
from avatar_service import AvatarService, set_service, get_service

# ── HTTP Router ──────────────────────────────────────────────────
router = APIRouter()


def _service_not_ready() -> JSONResponse:
    """返回 503 Service Unavailable，提示客户端稍后重试。"""
    return JSONResponse(
        status_code=503,
        content={"ok": False, "error": "Service is starting up, please retry later"},
        headers={"Retry-After": "3"},
    )


# ── API Endpoints ────────────────────────────────────────────────
# NOTE: 固定路径必须注册在参数化路径之前，否则 FastAPI 会将 "list"/"formats"
#       误匹配为 {agent_id} 参数。

@router.get("/list")
async def list_avatars():
    """列出所有 Agent 的头像配置状态。"""
    svc = await get_service()
    if svc is None:
        return _service_not_ready()
    return await svc.list_avatars()


@router.get("/formats")
async def supported_formats():
    """返回当前支持的头像格式列表。"""
    return {
        "formats": [
            {"ext": "png", "label": "PNG", "animated": False},
            {"ext": "apng", "label": "APNG (动态 PNG)", "animated": True},
            {"ext": "jpg", "label": "JPEG", "animated": False},
            {"ext": "gif", "label": "GIF (动画)", "animated": True},
            {"ext": "webp", "label": "WebP (动态)", "animated": True},
            {"ext": "svg", "label": "SVG (矢量)", "animated": False},
            {"ext": "json", "label": "Lottie (动画)", "animated": True},
        ]
    }


@router.post("/{agent_id}/upload")
async def upload_avatar(agent_id: str, request: Request):
    """上传头像文件（支持 PNG/APNG/JPEG/GIF/WebP/SVG/Lottie）。"""
    svc = await get_service()
    if svc is None:
        return _service_not_ready()
    file_data = await request.body()
    return await svc.upload_avatar(agent_id, file_data)


@router.post("/{agent_id}/url")
async def set_avatar_url(agent_id: str, payload: dict):
    """通过 HTTPS URL 设置头像。"""
    svc = await get_service()
    if svc is None:
        return _service_not_ready()
    return await svc.set_avatar_url(agent_id, payload.get("url", ""))


@router.get("/{agent_id}")
async def get_avatar(agent_id: str, size: str = "full"):
    """获取 Agent 头像数据（full 或 thumb）。"""
    svc = await get_service()
    if svc is None:
        return _service_not_ready()
    return await svc.get_avatar(agent_id, size)


@router.get("/{agent_id}/image")
async def get_avatar_image(agent_id: str, size: str = "full", request: Request):
    """
    获取 Agent 头像原始图片字节（供 <img src> 直接加载）。
    返回正确的 Content-Type（如 image/png），而非 JSON。
    对于 URL 类型头像，返回 302 重定向到原始 URL。

    缓存策略：Cache-Control: max-age=300 + ETag（内容 SHA1），
    客户端发 If-None-Match 匹配时返回 304 Not Modified，避免重传字节。
    """
    svc = await get_service()
    if svc is None:
        return _service_not_ready()

    # 先检查是否是 URL 类型头像
    meta_result = await svc.get_avatar(agent_id, size)
    if meta_result.get("ok") and meta_result.get("type") == "url":
        from fastapi.responses import RedirectResponse
        return RedirectResponse(url=meta_result["url"], status_code=302)

    # 文件类型头像：返回原始字节
    result = await svc.get_avatar_image(agent_id, size)
    if result is None:
        return JSONResponse(status_code=404, content={"ok": False, "error": "No avatar"})

    image_data, mime_type = result
    # ETag: 内容 SHA1 前 16 字符（短哈希足够碰撞罕见，节省头部体积）
    import hashlib
    etag = hashlib.sha1(image_data).hexdigest()[:16]
    # If-None-Match 命中：返回 304 Not Modified，空响应体
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers={
            "ETag": etag,
            "Cache-Control": "public, max-age=300",
        })
    return Response(
        content=image_data,
        media_type=mime_type,
        headers={
            "Cache-Control": "public, max-age=300",
            "ETag": etag,
        },
    )


@router.get("/{agent_id}/check")
async def check_avatar(agent_id: str):
    """
    检查 Agent 是否已设置自定义头像。
    返回 has_avatar (bool) 和 source 类型信息。
    """
    svc = await get_service()
    if svc is None:
        return _service_not_ready()

    has = svc.has_avatar(agent_id)
    if not has:
        return {"ok": True, "has_avatar": False}

    meta_result = await svc.get_avatar(agent_id)
    return {
        "ok": True,
        "has_avatar": True,
        "type": meta_result.get("type", "file"),
        "url": meta_result.get("url"),
        "format": meta_result.get("format"),
    }


@router.delete("/{agent_id}")
async def delete_avatar(agent_id: str):
    """删除 Agent 自定义头像。"""
    svc = await get_service()
    if svc is None:
        return _service_not_ready()
    return await svc.delete_avatar(agent_id)


# ── Plugin Class ─────────────────────────────────────────────────
class AgentAvatarProPlugin:
    """QwenPaw Agent 头像增强插件。"""

    def register(self, api: object) -> None:
        # 注册 Agent 可调用的工具
        api.register_tool(
            tool_name="set_agent_avatar",
            tool_func=set_agent_avatar,
            description="为指定 Agent 设置自定义头像（支持上传文件或 URL）",
            icon="image",
            enabled=True,
        )
        api.register_tool(
            tool_name="get_agent_avatar_status",
            tool_func=get_agent_avatar_status,
            description="查看所有 Agent 的头像配置状态",
            icon="list",
            enabled=True,
        )

        # 注册 HTTP 路由（前端通过 /api/avatar-pro/* 访问后端）
        api.register_http_router(router, prefix="/avatar-pro")

        # 生命周期钩子
        api.register_startup_hook(
            hook_name="avatar_pro_init",
            callback=self._on_startup,
            priority=10,
        )
        api.register_shutdown_hook(
            hook_name="avatar_pro_cleanup",
            callback=self._on_shutdown,
            priority=100,
        )
        api.register_uninstall_hook(
            hook_name="avatar_pro_uninstall",
            callback=self._on_uninstall,
        )

    async def _on_startup(self) -> None:
        """初始化头像服务，创建数据目录。"""
        # 软检测可选依赖：Pillow 用于格式检测/缩放/poster，httpx 用于 URL Lottie 下载
        # 缺失时插件仍可工作（降级路径已在 avatar_service.py 中处理），仅日志提示
        try:
            import PIL  # noqa: F401
            pillow_ok = True
        except ImportError:
            pillow_ok = False
        try:
            import httpx  # noqa: F401
            httpx_ok = True
        except ImportError:
            httpx_ok = False
        if not pillow_ok or not httpx_ok:
            missing = []
            if not pillow_ok:
                missing.append("Pillow (格式检测/缩放/Lottie poster 降级)")
            if not httpx_ok:
                missing.append("httpx (URL Lottie poster 下载)")
            print(
                f"[agent-avatar-pro] 可选依赖缺失: {', '.join(missing)} — "
                "部分功能降级，请 `pip install Pillow httpx` 以启用完整能力"
            )

        svc = AvatarService()
        await svc.initialize(plugin_dir=_plugin_dir)
        set_service(svc)  # 设置全局单例，供 avatar_backend.py 的工具函数直接使用
        print(f"[agent-avatar-pro] Avatar service initialized (data: {svc._data_dir})")

    async def _on_shutdown(self) -> None:
        """关闭头像服务。"""
        svc = await get_service()
        if svc:
            await svc.cleanup()
            set_service(None)
        print("[agent-avatar-pro] Avatar service shutdown")

    async def _on_uninstall(self, plugin_id: str, delete_files: bool) -> None:
        """卸载时可选清理头像数据。"""
        svc = await get_service()
        if svc and delete_files:
            await svc.purge_all_data()
        print(f"[agent-avatar-pro] Uninstalled: {plugin_id}, delete_files={delete_files}")


# ── Plugin Instance (required by QwenPaw loader) ─────────────────
plugin = AgentAvatarProPlugin()
