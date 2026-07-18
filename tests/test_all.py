"""
Agent Avatar Pro — 综合测试脚本
使用 QwenPaw 自带的 Python 环境运行，确保依赖一致。
"""
import asyncio
import json
import os
import shutil
import struct
import sys
import tempfile
import time

# ── 将插件目录加入 sys.path ──────────────────────────────────────
PLUGIN_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, PLUGIN_DIR)

from avatar_service import AvatarService, get_service, set_service

# ── 测试统计 ─────────────────────────────────────────────────────
passed = 0
failed = 0
errors = []

def report(name, ok, detail=""):
    global passed, failed
    status = "PASS" if ok else "FAIL"
    if ok:
        passed += 1
    else:
        failed += 1
        errors.append(f"{name}: {detail}")
    print(f"  [{status}] {name}" + (f"  ({detail})" if detail and not ok else ""))


# ── 测试用临时目录 ───────────────────────────────────────────────
TEST_DIR = tempfile.mkdtemp(prefix="avatar_test_")

def make_test_service():
    """创建一个使用临时目录的 AvatarService，跳过 QwenPaw 初始化。"""
    svc = AvatarService()
    svc._data_dir = __import__("pathlib").Path(TEST_DIR)
    svc._data_dir.mkdir(parents=True, exist_ok=True)
    svc._config = {}
    set_service(svc)
    return svc


# ==================================================================
#  第一部分：核心功能测试
# ==================================================================
async def test_core():
    print("\n=== 核心功能测试 ===\n")

    svc = make_test_service()

    # ── 1.1 空列表 ───────────────────────────────────────────────
    result = await svc.list_avatars()
    report("空列表返回 ok=True", result["ok"])
    report("空列表 count=0", result["count"] == 0)

    # ── 1.2 PNG 上传 ─────────────────────────────────────────────
    # 生成最小有效 PNG (1x1 红色像素)
    png_data = _make_minimal_png()
    result = await svc.upload_avatar("test-png", png_data)
    report("PNG 上传成功", result["ok"], f"error={result.get('error','')}")
    report("PNG 格式检测为 png", result["format"] == "png", f"got={result.get('format')}")

    # ── 1.3 获取头像数据 ────────────────────────────────────────
    result = await svc.get_avatar("test-png")
    report("获取头像 ok=True", result["ok"])
    report("头像类型为 file", result["type"] == "file")
    report("头像 mime 为 image/png", result["mime"] == "image/png")
    report("头像 data 非空", bool(result.get("data")))

    # ── 1.4 列表更新 ────────────────────────────────────────────
    result = await svc.list_avatars()
    report("上传后 count=1", result["count"] == 1, f"got={result['count']}")

    # ── 1.5 删除头像 ────────────────────────────────────────────
    result = await svc.delete_avatar("test-png")
    report("删除成功", result["ok"])

    result = await svc.list_avatars()
    report("删除后 count=0", result["count"] == 0, f"got={result['count']}")

    # ── 1.6 获取不存在的头像 ────────────────────────────────────
    result = await svc.get_avatar("nonexistent")
    report("不存在的头像返回 ok=False", not result["ok"])
    report("错误信息正确", "No avatar" in result.get("error", ""))


# ==================================================================
#  第二部分：安全测试
# ==================================================================
async def test_security():
    print("\n=== 安全测试 ===\n")

    svc = make_test_service()

    # ── 2.1 Magic bytes 校验 — 非法格式拒绝 ─────────────────────
    fake_data = b"this is not an image file at all"
    result = await svc.upload_avatar("test-fake", fake_data)
    report("非法格式被拒绝", not result["ok"])
    report("错误提示 format", "format" in result.get("error", "").lower() or "Unsupported" in result.get("error", ""))

    # ── 2.2 Magic bytes 校验 — 伪装扩展名 ──────────────────────
    # 文本文件伪装成 PNG
    text_as_png = b"Hello world, I am a text file pretending to be PNG"
    result = await svc.upload_avatar("test-disguise", text_as_png)
    report("伪装 PNG 被拒绝", not result["ok"])

    # ── 2.3 文件大小限制 ────────────────────────────────────────
    svc._config["max_file_size"] = 1  # 1MB
    big_data = _make_minimal_png() + b"\x00" * (2 * 1024 * 1024)  # ~2MB
    result = await svc.upload_avatar("test-big", big_data)
    report("超大文件被拒绝", not result["ok"])
    report("错误提示包含 limit", "limit" in result.get("error", "").lower() or "exceeds" in result.get("error", "").lower())
    svc._config = {}  # reset

    # ── 2.4 SVG XSS 防护 ────────────────────────────────────────
    malicious_svg = b'''<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg">
  <script>alert('xss')</script>
  <rect width="100" height="100" fill="red" onclick="alert('click')"/>
  <a xlink:href="javascript:alert('href')">link</a>
</svg>'''
    result = await svc.upload_avatar("test-svg-xss", malicious_svg)
    report("SVG 上传成功", result["ok"], f"error={result.get('error','')}")

    # 检查清洗后的内容
    svg_path = svc._data_dir / "test-svg-xss" / "avatar.svg"
    if svg_path.exists():
        cleaned = svg_path.read_text()
        report("SVG 移除了 <script> 标签", "<script" not in cleaned.lower())
        report("SVG 移除了 onclick 属性", "onclick" not in cleaned.lower())
        report("SVG 移除了 javascript: 协议", "javascript:" not in cleaned.lower())
        report("SVG 保留了 <rect> 元素", "<rect" in cleaned.lower())
    else:
        report("SVG 文件存在", False, "文件未生成")

    # ── 2.5 URL 协议白名单 ──────────────────────────────────────
    result = await svc.set_avatar_url("test-url-ok", "https://example.com/avatar.png")
    report("HTTPS URL 设置成功", result["ok"])

    result = await svc.set_avatar_url("test-http", "http://evil.com/avatar.png")
    report("HTTP URL 被拒绝", not result["ok"])
    report("错误提示 HTTPS", "HTTPS" in result.get("error", ""))

    result = await svc.set_avatar_url("test-file", "file:///etc/passwd")
    report("file:// URL 被拒绝", not result["ok"])

    result = await svc.set_avatar_url("test-ftp", "ftp://server/avatar.png")
    report("ftp:// URL 被拒绝", not result["ok"])

    # ── 2.6 URL 类型 Lottie 格式识别 ──────────────────────────────
    # URL 扩展名 .json → fmt = "json"，meta source = "url"
    result = await svc.set_avatar_url(
        "test-url-lottie",
        "https://lottie.host/d12158de-44c9-4079-b980-3bf63694f918/VrgZppaPQ8.json",
    )
    report("URL Lottie 设置成功", result["ok"],
           f"error={result.get('error','')}")
    report("URL Lottie 识别格式=json", result.get("format") == "json",
           f"实际 format={result.get('format')}")

    # 验证 meta.json source 字段为 "url"（非 "file"）
    meta_check = await svc.get_avatar("test-url-lottie")
    report("URL Lottie meta source=url",
           meta_check.get("source") == "url" or meta_check.get("type") == "url",
           f"实际 type={meta_check.get('type')}, source={meta_check.get('source')}")


# ==================================================================
#  第三部分：格式兼容性测试
# ==================================================================
async def test_formats():
    print("\n=== 格式兼容性测试 ===\n")

    svc = make_test_service()

    # 各格式的最小有效文件
    test_cases = [
        ("png",  _make_minimal_png(),           "png"),
        ("jpg",  b"\xff\xd8\xff\xe0" + b"\x00" * 20,  "jpg"),
        ("gif",  b"GIF89a" + b"\x00" * 20,     "gif"),
        ("webp", b"RIFF\x00\x00\x00\x00WEBP" + b"\x00" * 10, "webp"),
        ("svg",  b'<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>', "svg"),
        ("json", b'{"v":"5.0","fr":30,"ip":0}', "json"),
    ]

    for label, data, expected_fmt in test_cases:
        result = await svc.upload_avatar(f"test-{label}", data)
        report(f"{label.upper()} 上传成功", result["ok"],
               f"error={result.get('error','')}")
        report(f"{label.upper()} 检测格式={expected_fmt}",
               result.get("format") == expected_fmt,
               f"got={result.get('format')}")

        # 验证可以获取
        get_result = await svc.get_avatar(f"test-{label}")
        report(f"{label.upper()} 获取成功", get_result["ok"])

    # ── APNG 特殊检测 ────────────────────────────────────────────
    apng_data = _make_minimal_apng()
    result = await svc.upload_avatar("test-apng", apng_data)
    report("APNG 上传成功", result["ok"])
    report("APNG 检测为 apng（非 png）", result.get("format") == "apng",
           f"got={result.get('format')}")

    # ── animated WebP 检测 ───────────────────────────────────────
    webp_animated = _make_minimal_animated_webp()
    result = await svc.upload_avatar("test-webp-anim", webp_animated)
    report("animated WebP 上传成功", result["ok"],
           f"error={result.get('error','')}")
    report("animated WebP 检测格式=webp", result.get("format") == "webp",
           f"got={result.get('format')}")
    # 普通静态 WebP 也应识别为 webp
    webp_static = b"RIFF\x00\x00\x00\x00WEBP" + b"\x00" * 10
    result = await svc.upload_avatar("test-webp-static", webp_static)
    report("static WebP 检测格式=webp", result.get("format") == "webp",
           f"got={result.get('format')}")

    # ── delete_avatar 删除测试 ──────────────────────────────────
    # 先确认 test-png 存在，删除后应不可获取
    get_before = await svc.get_avatar("test-png")
    report("delete 前头像可获取", get_before["ok"])
    del_result = await svc.delete_avatar("test-png")
    report("delete_avatar 返回 ok", del_result["ok"])
    get_after = await svc.get_avatar("test-png")
    report("delete 后头像不可获取", not get_after["ok"])
    report("delete 后 has_avatar=False", not svc.has_avatar("test-png"))

    # ── list_avatars 列表测试 ───────────────────────────────────
    # 此时应剩 test-jpg/jpeg/gif/webp/svg/json/apng/webp-anim/webp-static
    list_result = await svc.list_avatars()
    report("list_avatars 返回 ok", list_result["ok"])
    report("list_avatars count>0", list_result.get("count", 0) > 0,
           f"count={list_result.get('count')}")
    # 验证列表项含必要字段
    if list_result.get("avatars"):
        first = list_result["avatars"][0]
        report("list 项含 agent_id", "agent_id" in first)
        report("list 项含 format", "format" in first)
        report("list 项含 source", "source" in first)

    # ── _sanitize_svg XSS 清洗测试 ──────────────────────────────
    # 含 script 标签、onerror 属性、javascript: URL 的恶意 SVG
    evil_svg = (
        b'<svg xmlns="http://www.w3.org/2000/svg" '
        b'onload="alert(1)" width="100" height="100">'
        b'<script>alert("xss")</script>'
        b'<a xlink:href="javascript:alert(2)"><rect/></a>'
        b'</svg>'
    )
    result = await svc.upload_avatar("test-evil-svg", evil_svg)
    report("恶意 SVG 上传成功", result["ok"])
    # 重新获取存储的文件内容，验证清洗后无危险内容
    if result["ok"]:
        evil_agent_dir = svc._data_dir / "test-evil-svg"
        stored_svg = (evil_agent_dir / "avatar.svg").read_bytes().decode("utf-8", errors="replace")
        report("SVG 清洗后无 <script>", "<script" not in stored_svg.lower(),
               f"stored_head={stored_svg[:120]}")
        report("SVG 清洗后无 onload=", "onload=" not in stored_svg.lower())
        report("SVG 清洗后无 javascript:", "javascript:" not in stored_svg.lower())

    # ── get_avatar size="thumb" 缩略图分支测试 ─────────────────────
    # test-jpg 上传时生成了 thumbnail.jpg，请求 thumb 应返回缩略图
    thumb_result = await svc.get_avatar("test-jpg", size="thumb")
    report("get_avatar size=thumb 返回 ok", thumb_result["ok"],
           f"error={thumb_result.get('error','')}")
    report("get_avatar size=thumb type=file", thumb_result.get("type") == "file")
    report("get_avatar size=thumb 有 base64 数据", bool(thumb_result.get("data")),
           "data 为空")

    # ── history 截断到 1 条边界测试 ────────────────────────────────
    # 连续替换同一 Agent 3 次，history 应只保留最近 1 条
    for i in range(3):
        await svc.upload_avatar("test-history-agent",
                                _make_minimal_png())
    # 第三次上传后，meta.history 应仅 1 条（截断逻辑）
    agent_dir = svc._data_dir / "test-history-agent"
    meta = json.loads((agent_dir / "meta.json").read_text())
    history = meta.get("history", [])
    report("history 截断到 1 条", len(history) == 1,
           f"实际 history 长度={len(history)}")

    # ── Lottie poster.png 生成测试 ────────────────────────────────
    # 上传合规 Lottie JSON，应生成 poster.png 静态封面
    lottie_data = b'{"v":"5.9.0","fr":60,"ip":0,"op":30,"w":200,"h":200,"nm":"test","ddd":0,"assets":[],"layers":[]}'
    result = await svc.upload_avatar("test-lottie-poster", lottie_data)
    report("Lottie JSON 上传成功", result["ok"],
           f"error={result.get('error','')}")
    report("Lottie 检测格式=json", result.get("format") == "json",
           f"got={result.get('format')}")
    # 验证 poster.png 已生成（Pillow 可用时）
    if Image:
        poster_path = svc._data_dir / "test-lottie-poster" / "poster.png"
        report("Lottie 生成 poster.png", poster_path.exists(),
               f"path={poster_path}")
        # 验证 poster.png 尺寸与 JSON w/h 一致
        if poster_path.exists():
            try:
                poster_img = Image.open(poster_path)
                report("poster.png 尺寸=200x200",
                       poster_img.size == (200, 200),
                       f"实际尺寸={poster_img.size}")
            except Exception as e:
                report("poster.png 可读", False, f"error={e}")
    # get_avatar_image 对 Lottie 返回 poster.png（而非原始 JSON）
    img_result = await svc.get_avatar_image("test-lottie-poster")
    report("get_avatar_image 对 Lottie 返回字节", img_result is not None)
    if img_result:
        report("Lottie /image 返回 mime=image/png",
               "image/png" in img_result[1] or "png" in img_result[1].lower(),
               f"mime={img_result[1]}")


# ==================================================================
#  第四部分：单例访问器测试
# ==================================================================
async def test_singleton():
    print("\n=== 单例访问器测试 ===\n")

    # 清除全局实例
    set_service(None)
    report("get_service() 初始为 None", get_service() is None)

    svc = make_test_service()
    report("set_service() 后 get_service() 返回实例", get_service() is svc)

    set_service(None)
    report("set_service(None) 后 get_service() 为 None", get_service() is None)


# ==================================================================
#  辅助函数
# ==================================================================
def _make_minimal_png():
    """生成最小有效 PNG 文件（1x1 像素）。"""
    import struct, zlib

    def chunk(chunk_type, data):
        c = chunk_type + data
        crc = struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)
        return struct.pack(">I", len(data)) + c + crc

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
    raw = zlib.compress(b"\x00\xff\x00\x00")  # filter=none, R=255 G=0 B=0
    idat = chunk(b"IDAT", raw)
    iend = chunk(b"IEND", b"")
    return sig + ihdr + idat + iend


def _make_minimal_apng():
    """生成包含 acTL chunk 的 APNG 文件。"""
    import struct, zlib

    def chunk(chunk_type, data):
        c = chunk_type + data
        crc = struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)
        return struct.pack(">I", len(data)) + c + crc

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
    # acTL chunk: num_frames=2, num_plays=0
    actl = chunk(b"acTL", struct.pack(">II", 2, 0))
    raw = zlib.compress(b"\x00\xff\x00\x00")
    idat = chunk(b"IDAT", raw)
    iend = chunk(b"IEND", b"")
    return sig + ihdr + actl + idat + iend


def _make_minimal_animated_webp():
    """生成含 VP8X 扩展块且动画标志位设置的 WebP 字节流。

    WebP 容器结构：RIFF [size] WEBP VP8X [chunk_size] [flags] ...
    flags 字节 bit 1 (0x02) = animation。仅需前 30 字节即可触发检测。
    """
    import struct
    # RIFF [size=0] WEBP
    riff = b"RIFF" + struct.pack("<I", 0) + b"WEBP"
    # VP8X chunk: signature + [chunk_size=10] + flags(0x02=anim) + reserved(0)
    vp8x = b"VP8X" + struct.pack("<I", 10) + b"\x02" + b"\x00" * 9
    return riff + vp8x + b"\x00" * 8  # padding to >=30 bytes


# ==================================================================
#  主入口
# ==================================================================
async def main():
    print("=" * 60)
    print("  Agent Avatar Pro — 综合测试")
    print(f"  临时目录: {TEST_DIR}")
    print("=" * 60)

    try:
        await test_core()
        await test_security()
        await test_formats()
        await test_singleton()
    finally:
        # 清理临时目录
        shutil.rmtree(TEST_DIR, ignore_errors=True)

    print("\n" + "=" * 60)
    print(f"  结果: {passed} 通过, {failed} 失败")
    if errors:
        print("\n  失败项:")
        for e in errors:
            print(f"    [x] {e}")
    print("=" * 60)

    return failed == 0


if __name__ == "__main__":
    ok = asyncio.run(main())
    sys.exit(0 if ok else 1)
