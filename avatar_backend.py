"""
Backend tool functions for Agent Avatar Pro.

这些函数注册为 QwenPaw Agent 工具，可被 LLM 直接调用。
注意：工具函数与 HTTP 端点运行在同一进程中，因此直接调用 AvatarService
方法而非通过 HTTP 回环，避免端口硬编码和事件循环死锁风险。
"""

from avatar_service import get_service


async def set_agent_avatar(agent_id: str, source: str) -> "ToolResponse":
    """为指定 Agent 设置自定义头像。

    Args:
        agent_id: Agent 的唯一标识符。
        source: 头像来源 — 可以是 HTTPS URL 或本地文件路径。

    Returns:
        ToolResponse: 设置结果。
    """
    from qwenpaw.core.tool_response import ToolResponse

    svc = await get_service()
    if svc is None:
        return ToolResponse(content="错误：头像服务尚未初始化，请确认插件已正确加载。")

    if source.startswith("https://"):
        # URL 头像
        result = await svc.set_avatar_url(agent_id, source)
    else:
        # 文件上传
        try:
            from pathlib import Path
            file_path = Path(source)
            if not file_path.exists():
                return ToolResponse(content=f"错误：文件不存在 — {source}")

            file_data = file_path.read_bytes()
            result = await svc.upload_avatar(agent_id, file_data)
        except Exception as e:
            return ToolResponse(content=f"上传失败：{e}")

    if result.get("ok"):
        return ToolResponse(
            content=f"已为 Agent [{agent_id}] 设置头像，格式: {result.get('format', 'unknown')}"
        )
    else:
        return ToolResponse(content=f"设置头像失败：{result.get('error', '未知错误')}")


async def get_agent_avatar_status() -> "ToolResponse":
    """查看所有 Agent 的头像配置状态。

    Returns:
        ToolResponse: 包含所有 Agent 头像状态的信息。
    """
    from qwenpaw.core.tool_response import ToolResponse

    svc = await get_service()
    if svc is None:
        return ToolResponse(content="错误：头像服务尚未初始化。")

    result = await svc.list_avatars()

    if not result.get("ok"):
        return ToolResponse(content=f"查询失败：{result.get('error', '未知错误')}")

    avatars = result.get("avatars", [])
    if not avatars:
        return ToolResponse(content="目前没有 Agent 配置了自定义头像。")

    lines = [f"共 {len(avatars)} 个 Agent 配置了头像：\n"]
    for a in avatars:
        source_label = "URL" if a.get("source") == "url" else "文件上传"
        lines.append(f"  - {a['agent_id']}: {a['format']} ({source_label})")

    return ToolResponse(content="\n".join(lines))
