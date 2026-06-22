# Agent Avatar Pro — 开发日志

## 项目概述

Agent Avatar Pro 是一个 QwenPaw 前端扩展插件（Bundle 类型），为 QwenPaw Agent 提供自定义头像功能。相比 QwenPaw 原生控制台（所有 Agent 使用通用机器人图标），本插件支持 7 种图片格式，包括 APNG、SVG、Lottie 等动态格式，并支持通过 URL 直接设置头像。

**项目路径：** `D:\代码\agent-avatar-pro\`
**插件 ID：** `agent-avatar-pro`
**当前版本：** `0.1.0`
**开发日期：** 2026-06-20 至 2026-06-21

---

## 开发时间线

### 第一阶段：调查与规划

**任务：** 调查 QwenPaw 控制台前端的 Agent 头像相关代码，了解现状并制定开发计划。

**调查发现：**

QwenPaw 控制台 main 分支不具备任何 Agent 头像功能。Agent 管理表格使用 `RobotOutlined` 图标，Agent 切换器使用 `Bot` 图标，聊天窗口无 Agent 标识。

社区已有一个 Feature Request（#4974）和一个在途 PR（#5263，未合并），该 PR 实现了基本的头像上传功能，但存在以下局限：仅支持 PNG/JPEG/GIF/WebP 四种格式、2MB 文件限制、不支持 URL 头像、聊天窗口不展示头像、无图片压缩。

**产出：** 编写了详细的开发计划文档，定义了插件定位为"官方头像功能的增强层"，规划了四阶段开发排期。

### 第二阶段：后端实现

**完成内容：**

- `plugin.py` — 插件入口，注册 6 个 HTTP 端点、2 个 Agent 工具、3 个生命周期钩子
- `avatar_service.py` — 核心服务，实现头像存储、Magic bytes 格式检测、Pillow 压缩、SVG XSS 清洗、URL 白名单校验
- `avatar_backend.py` — Agent 工具函数（`set_agent_avatar` / `get_agent_avatar_status`）
- `plugin.json` — 插件清单，声明 5 个配置字段和 2 个工具

**数据存储设计：** `~/.qwenpaw/plugins/agent-avatar-pro/data/{agent_id}/`，每个 Agent 一个子目录，包含 `avatar.{ext}`、`thumbnail.{ext}`、`meta.json`。

### 第三阶段：前端实现

**完成内容：**

- `AvatarRenderer.tsx` — 多格式头像渲染组件（支持 Lottie/SVG/APNG/GIF/WebP/静态图片，无头像回退 SVG 机器人图标）
- `AvatarUploader.tsx` — 上传组件（拖拽/点击/URL 三模式）
- `AvatarManager.tsx` — 管理面板（网格视图、格式筛选、批量操作）
- `ChatAvatar.tsx` — 聊天窗口头像注入（MutationObserver + DOM 注入 + 5 分钟缓存）
- `api.ts` — HTTP API 封装层
- `types.ts` — TypeScript 类型定义
- `vite.config.ts` + `tsconfig.json` — 构建配置

### 第四阶段：文档与测试

**完成内容：**

- `docs/TESTING.md` — 测试说明（API 测试、安全测试、格式兼容性测试、前端组件测试）
- `docs/GUIDE.md` — 使用说明（安装配置、运行架构、常见问题 FAQ）
- `tests/test_all.py` — 自动化测试脚本（51 项测试用例）
- `install.bat` / `build.bat` — Windows 一键安装和构建脚本
- 预构建 `dist/index.js`（16.35KB）实现开箱即用

### 第五阶段：实际环境测试与问题修复（2026-06-21）

**任务：** 在 QwenPaw 实际运行环境中安装并测试插件，发现并修复了 6 个生产级问题。

**完成内容：**

- 修复后端启动竞态条件：引入 `asyncio.Event` 就绪门控 + 503 响应 + 前端指数退避重试
- 修复前端 bundle 加载崩溃：全面添加 try-catch 和 null guards，延迟 ChatAvatar 初始化
- 修复 JSON 解析异常：`fetchWithRetry` 在调用 `res.json()` 前先检查 `res.ok`
- 修复文件上传全格式失败：FastAPI 端点改用 `Request.body()` 读取原始二进制数据
- 修复数据硬编码路径：`initialize()` 接受 `plugin_dir` 参数，存储路径改为插件目录相对路径
- 新增 Agent ID 下拉选择：`AutoComplete` 组件 + `/api/agents` 接口验证 + 匹配反馈

**关键改进：** 插件在 QwenPaw 启动期间加载较慢时不再导致崩溃，管理页面显示服务启动状态提示并自动重试。

### 第六阶段：官方 API 迁移（2026-06-21）

**任务：** 参照 QwenPaw 官方插件文档（`qwenpaw/docs/plugins.zh.md`），将前端代码从不准确的社区 API 迁移到正确的官方 API。同步修正 `qwenpaw-plugin-dev` skill 文档中的错误信息。

**背景：** 项目第三阶段和第四阶段使用的前端 API（`registerRoutes()`、MutationObserver 注入等）来源于对 QwenPaw Pet 插件的逆向分析和社区 skill 文档，并非官方文档。用户提供了官方文档路径后，发现多处 API 使用不正确。

**完成内容：**

- `index.tsx` — `registerRoutes()` 替换为官方 `route.add()` + `menu.add()`，添加 `dispose()` 清理
- `ChatAvatar.tsx` — 完全重写，移除 MutationObserver DOM 注入，改用官方 `chat.response.set()` + `chat.welcome.set()` API，通过轮询 `host.getSelectedAgentId()` 检测 Agent 切换
- `api.ts` — 所有 HTTP 请求改用 `host.fetch()` 认证代理（自动注入 Authorization 和 X-Agent-Id 请求头），移除手动 `authHeaders()` 拼接
- `qwenpaw-host.d.ts` — 完整重写，覆盖 route/menu/chat/slot/disposable 全部官方 API 命名空间
- `AvatarManager.tsx` — 移除 `initChatAvatarInjection` 引用（监控已移至入口文件）
- `qwenpaw-plugin-dev` skill — 修正路由注册、类型声明、Vite 配置、Host API pattern 等章节

**Bundle 大小：** 22.93KB（gzip 6.56KB），相比第五阶段略有增加（新增 route/menu/chat 注册代码），但因移除 MutationObserver 逻辑总体保持精简。

---

## 遇到的问题和解决方案

### 问题 1：FastAPI 路由顺序导致端点被遮蔽

**现象：** 访问 `/api/avatar-pro/list` 和 `/api/avatar-pro/formats` 返回 404 或错误数据。

**原因：** FastAPI 按注册顺序匹配路由。`/{agent_id}` 参数化路径注册在 `/list` 和 `/formats` 之前，导致 FastAPI 将 "list" 和 "formats" 误匹配为 `agent_id` 参数值。

**解决：** 将固定路径路由（`/list`、`/formats`）移到参数化路径（`/{agent_id}`）之前注册。在 `plugin.py` 中添加注释说明此规则。

**影响文件：** `plugin.py`

---

### 问题 2：Vite 输出 `.mjs` 扩展名不匹配 plugin.json

**现象：** `npm run build` 生成 `dist/index.mjs`，但 `plugin.json` 声明入口为 `dist/index.js`，导致 QwenPaw 无法加载前端。

**原因：** Vite 的 `lib.formats: ["es"]` 默认使用 `.mjs` 扩展名。

**解决：** 将 `fileName: 'index'` 改为 `fileName: () => 'index.js'`，强制输出 `.js` 扩展名。

**影响文件：** `frontend/vite.config.ts`

---

### 问题 3：`python-magic` 幽灵依赖

**现象：** `requirements.txt` 声明了 `python-magic` 依赖，但代码中从未 import 或使用。

**原因：** 格式检测功能在 `avatar_service.py` 中使用自建的 Magic bytes 字典（`SUPPORTED_FORMATS`）实现，不需要任何第三方库。`python-magic` 在早期设计阶段被列入但从未实际集成。此外 `python-magic` 在 Windows 上需要 `libmagic` DLL，是一个潜在的安装隐患。

**解决：** 从 `requirements.txt` 和 `plugin.json` 中移除 `python-magic`。

**影响文件：** `requirements.txt`、`plugin.json`、`README.md`

---

### 问题 4：插件依赖与 QwenPaw 环境冲突分析

**任务：** 检查插件的三个 Python 依赖（Pillow、httpx、python-magic）是否已包含在 QwenPaw 运行环境中。

**调查方法：** 找到 QwenPaw 安装目录（`D:\QwenPaw\`），检查其 Python 环境（Python 3.10.20，conda-pack'd），通过 `pip show` 确认已安装包列表。

**发现：**

| 依赖 | QwenPaw 中版本 | 插件要求 | 状态 |
|------|---------------|---------|------|
| Pillow | 12.2.0 | >=9.0 | 已包含 |
| httpx | 0.28.1 | 任意 | 已包含 |
| python-magic | 未安装 | — | 已移除（见问题 3） |

QwenPaw 环境中还有 `filetype` 1.2.0（可作为 python-magic 的替代），但由于格式检测使用自建实现，这些都不需要。

**结论：** 插件唯一的实际依赖是 Pillow，已由 QwenPaw 提供。最终 `requirements.txt` 只保留 `Pillow>=9.0`。

---

### 问题 5：`avatar_backend.py` 通过 HTTP 自调用（架构错误）

**现象：** 工具函数 `set_agent_avatar` 和 `get_agent_avatar_status` 使用 `httpx.AsyncClient` 向 `http://127.0.0.1:8088/api/avatar-pro/*` 发 HTTP 请求。

**问题：**

1. **端口硬编码**：QwenPaw 桌面版使用 `QWENPAW_DESKTOP_PORT` 环境变量分配随机端口，命令行版可通过 `--port` 自定义。8088 只是默认值。
2. **同进程 HTTP 回环**：QwenPaw 插件在同一个 Python 进程和事件循环中运行。工具函数通过 HTTP 调用自己的 API 端点是不必要的网络开销，且在高并发下可能导致事件循环死锁。

**调查发现：** 通过深入阅读 QwenPaw 插件系统源码（`loader.py`、`registry.py`、`api.py`），确认：
- 插件代码通过 `importlib.util.spec_from_file_location` 加载，运行在 QwenPaw 同一进程中
- HTTP 路由挂载在 QwenPaw 主 FastAPI 应用上
- 工具函数被注入到 `qwenpaw.agents.tools` 模块，由 LLM 直接调用

**解决：**

1. 在 `avatar_service.py` 中新增 `get_service()` / `set_service()` 单例访问器
2. `plugin.py` 的 startup hook 中调用 `set_service(svc)` 注册实例
3. `avatar_backend.py` 从 `avatar_service` 导入 `get_service()`，直接调用 `AvatarService` 方法，不再走 HTTP
4. 从 `requirements.txt` 中移除 `httpx`（QwenPaw 自带，且工具函数不再需要）

**影响文件：** `avatar_service.py`、`avatar_backend.py`、`plugin.py`、`requirements.txt`

---

### 问题 6：SVG Magic bytes 检测不支持 XML 声明

**现象：** 自动化测试中，以 `<?xml version="1.0"?>` 开头的 SVG 文件上传失败，报 "Unsupported file format"。

**原因：** `_detect_format()` 方法只检查文件头 4 个字节是否匹配 `<svg`，但合法的 SVG 文件经常以 XML 声明 `<?xml` 开头。

**解决：** 在 `_detect_format()` 方法末尾增加二次检测逻辑：

```python
if data[:5] == b"<?xml" and b"<svg" in data[:1024]:
    return "svg"
```

**影响文件：** `avatar_service.py`

---

### 问题 7：QwenPaw 插件验证失败 — `No module named 'avatar_backend'`

**现象：** 执行 `qwenpaw plugin install` 时报错：`Plugin validation failed: No module named 'avatar_backend'`。

**原因：** QwenPaw 通过 `importlib.util.spec_from_file_location` 加载 `plugin.py`，但不会自动将插件目录加入 `sys.path`。`plugin.py` 中的 `from avatar_backend import ...` 因此找不到同级模块。

**解决：** 在 `plugin.py` 顶部添加：

```python
import os, sys
_plugin_dir = os.path.dirname(os.path.abspath(__file__))
if _plugin_dir not in sys.path:
    sys.path.insert(0, _plugin_dir)
```

**影响文件：** `plugin.py`

---

### 问题 8：QwenPaw 插件验证失败 — `No module named 'qwenpaw.core'`

**现象：** 修复问题 7 后，新的报错：`Plugin validation failed: No module named 'qwenpaw.core'`。

**原因：** `avatar_backend.py` 顶层导入了 `from qwenpaw.core.tool_response import ToolResponse`。验证阶段 QwenPaw 的模块可能尚未完全加载，导致导入失败。

**解决：** 将 `qwenpaw.core.tool_response` 改为函数内延迟导入，返回类型注解改为字符串形式 `"ToolResponse"`：

```python
async def set_agent_avatar(agent_id: str, source: str) -> "ToolResponse":
    from qwenpaw.core.tool_response import ToolResponse
    ...
```

**影响文件：** `avatar_backend.py`

---

### 问题 9：前端面板不显示 — QwenPaw 前端插件加载机制不匹配

**现象：** 插件后端成功安装并显示"运行中"，但 QwenPaw 控制台界面中找不到 "Agent 头像管理" 面板。

**原因：** 通过分析 QwenPaw 已有的前端插件（QwenPaw Pet）发现，QwenPaw 前端插件有一套特定的加载规范，与我们的实现完全不同：

| 对比项 | QwenPaw 规范（Pet 插件） | 我们的原始实现 |
|--------|------------------------|-------------|
| React 来源 | `window.QwenPaw.host.React` | `import React from "react"` |
| UI 库 | `window.QwenPaw.host.antd` | 内联样式 |
| 路由注册 | `window.QwenPaw.registerRoutes()` | `export default` |
| JSX 运行时 | `jsxRuntime: "classic"` | 默认 (automatic) |
| 执行方式 | 文件末尾 `new Plugin().setup()` | 模块导出 |
| tsconfig | `"types": []` | 无此设置 |

**解决：** 完全重写前端代码：

1. `vite.config.ts` — 添加 `jsxRuntime: "classic"`，external 增加 `antd`
2. `tsconfig.json` — `jsx` 改为 `"react"`，添加 `"types": []`
3. 新建 `qwenpaw-host.d.ts` — 声明 `window.QwenPaw` 全局类型
4. `api.ts` — 改用 `window.QwenPaw.host.getApiUrl()` 解析 API 路径
5. 所有组件 — 改用 `window.QwenPaw.host.React` 和 `window.QwenPaw.host.antd`
6. `index.tsx` — 改为 `new Plugin().setup()` 模式，调用 `registerRoutes()` 注册页面
7. `AvatarManager.tsx` — 使用 antd 组件（Card、Table、Upload、Tag 等）重写

Bundle 大小从 58.9KB 缩小到 16.35KB（React/antd 不再打包）。

**影响文件：** 全部前端文件（`vite.config.ts`、`tsconfig.json`、`qwenpaw-host.d.ts`、`api.ts`、`AvatarRenderer.tsx`、`AvatarUploader.tsx`、`AvatarManager.tsx`、`ChatAvatar.tsx`、`index.tsx`）

---

### 问题 10：Windows GBK 编码导致测试脚本崩溃

**现象：** 测试脚本在输出失败项时使用 Unicode 字符 `✗`（U+2717），Windows GBK 终端无法编码导致 `UnicodeEncodeError`。

**解决：** 将 `✗` 替换为 ASCII 安全的 `[x]`。

**影响文件：** `tests/test_all.py`

---

### 问题 11：QwenPaw 启动期间 500 错误（后端服务竞态条件）

**现象：** QwenPaw 启动时加载插件需要较长时间，在此期间访问头像 API 返回 500 错误，管理页面显示 "Unexpected token 'I', 'Internal S'... is not valid JSON" 报错。直到 QwenPaw debug 后台显示 "[agent-avatar-pro] Avatar service initialized" 后才恢复正常。

**原因：** FastAPI 路由在 `_on_startup` 钩子执行之前就已注册并可接受请求。`AvatarService.initialize()` 是异步操作（读取配置、创建目录），尚未完成时请求已到达端点，`get_service()` 返回 `None`，导致空指针异常。

**解决：** 引入三层防护机制：

1. **后端就绪门控：** 在 `avatar_service.py` 中使用 `asyncio.Event` 作为就绪信号。`set_service(svc)` 调用时设置事件，`get_service()` 等待事件（超时 15 秒）：

```python
_service_instance: "AvatarService | None" = None
_service_ready = asyncio.Event()
_READY_TIMEOUT = 15

async def get_service(timeout: float = _READY_TIMEOUT) -> "AvatarService | None":
    if _service_instance is not None:
        return _service_instance
    try:
        await asyncio.wait_for(_service_ready.wait(), timeout=timeout)
    except asyncio.TimeoutError:
        pass
    return _service_instance
```

2. **503 友好响应：** 服务未就绪时返回 `503 Service Unavailable` + `Retry-After: 3` 头，替代 500 内部错误
3. **前端指数退避重试：** `api.ts` 的 `fetchWithRetry` 对 503/500 状态码自动重试（最多 3 次，间隔 1s → 2s → 4s）

**影响文件：** `avatar_service.py`、`plugin.py`、`frontend/src/api.ts`

---

### 问题 12：前端 bundle 求值异常导致插件管理页面崩溃

**现象：** QwenPaw 启动期间，不仅本插件的管理页面无法加载，连 QwenPaw 自身的"插件管理"页面也会崩溃白屏。

**原因：** QwenPaw 在启动期间同步加载所有前端插件 bundle。`index.tsx` 在模块级别直接调用 `window.QwenPaw.host.getApiUrl()` 等 API，但此时 QwenPaw 宿主对象可能尚未完全初始化。未捕获的异常中断了插件加载循环，导致后续插件（包括 QwenPaw 内置的插件管理页面）也无法加载。

**解决：**

1. 整个 `index.tsx` 入口文件包裹在 `try-catch` 中
2. 所有组件中对 `window.QwenPaw?.host` 添加可选链和 null 守卫
3. 将 `initChatAvatarInjection()` 从 bundle 加载时移至 `AvatarManager` 组件 `useEffect` 中按需启动
4. React/antd 获取添加回退默认值：`host.React ?? { createElement: () => null, ... }`

**教训：** 前端插件的 bundle 求值绝对不能抛出未捕获异常。这是 QwenPaw 插件开发中最容易忽视的陷阱。

**影响文件：** `frontend/src/index.tsx`、`frontend/src/AvatarManager.tsx`、`frontend/src/AvatarRenderer.tsx`、`frontend/src/AvatarUploader.tsx`、`frontend/src/api.ts`

---

### 问题 13：`res.json()` 解析纯文本 500 响应体

**现象：** 前端报 `Unexpected token 'I', "Internal S"... is not valid JSON`。

**原因：** 后端在服务未就绪时返回纯文本 `"Internal Server Error"`（FastAPI 默认行为），前端的 `fetchWithRetry` 直接调用 `res.json()` 解析失败。

**解决：** 在 `fetchWithRetry` 中先检查 `res.ok`，对非 2xx 响应尝试 JSON 解析错误信息，若解析失败则使用 HTTP 状态码作为错误消息：

```typescript
if (!res.ok) {
  let errorMsg = `HTTP ${res.status}`;
  try {
    const body = await res.json();
    if (body?.error) errorMsg = body.error;
  } catch { /* 响应体非 JSON */ }
  throw new Error(errorMsg);
}
```

**影响文件：** `frontend/src/api.ts`

---

### 问题 14：文件上传全格式失败 — FastAPI bytes 参数陷阱

**现象：** 无论上传 PNG、APNG、WebP、JPEG、GIF 中的哪种格式，全部报 "Unsupported file format" 错误。

**原因：** FastAPI 端点声明为 `file: bytes = b""` 时，FastAPI 不会从请求体中读取原始二进制数据。`bytes` 类型参数被 FastAPI 解释为查询参数或表单字段，导致 `file_data` 始终为空字节串 `b""`，Magic bytes 检测无法匹配任何格式。

**解决：** 改用 FastAPI 的 `Request` 对象直接读取原始请求体：

```python
from fastapi import Request

@router.post("/{agent_id}/upload")
async def upload_avatar(agent_id: str, request: Request):
    file_data = await request.body()
    return await svc.upload_avatar(agent_id, file_data)
```

请求头设置 `Content-Type: application/octet-stream`，前端通过 `body: file` 发送原始文件数据。

**影响文件：** `plugin.py`、`frontend/src/api.ts`

---

### 问题 15：数据存储路径硬编码

**现象：** 头像文件存储在 `~/.qwenpaw/plugins/agent-avatar-pro/data/` 下，这是硬编码的路径。

**问题：** QwenPaw 插件的安装位置可能因安装方式（CLI、Desktop、手动）而不同。硬编码路径在不同环境下可能导致兼容性问题，且插件卸载时无法自动清理数据。

**解决：** `AvatarService.initialize()` 新增 `plugin_dir` 参数，数据存储路径改为插件安装目录的相对路径 `{plugin_dir}/data/`：

```python
async def initialize(self, plugin_dir: Optional[str] = None) -> None:
    if plugin_dir:
        self._data_dir = Path(plugin_dir) / "data"
    else:
        self._data_dir = Path.home() / ".qwenpaw" / "plugins" / "agent-avatar-pro" / "data"
    self._data_dir.mkdir(parents=True, exist_ok=True)
```

`plugin.py` 在 startup hook 中传入 `_plugin_dir`：

```python
async def _on_startup(self) -> None:
    svc = AvatarService()
    await svc.initialize(plugin_dir=_plugin_dir)
    set_service(svc)
```

**影响文件：** `avatar_service.py`、`plugin.py`

---

### 问题 16：聊天窗口头像不显示 — MutationObserver DOM 注入方案根本性错误

**现象：** 上传头像后，管理面板表格中可正常预览，但切换到聊天窗口时 Agent 头像仍显示默认的机器人图标。

**原因：** 原方案（`ChatAvatar.tsx`）使用 MutationObserver 监听 DOM 变化，试图在消息气泡旁注入自定义 `<img>` 元素。这个方案存在三个根本性缺陷：

1. **DOM 选择器不可靠：** 使用 `.chat-container`、`.conversation-area`、`[class*="chat"]` 等启发式选择器查找容器，QwenPaw 的 DOM 结构可能不匹配
2. **违反框架契约：** QwenPaw 提供官方 `chat.response.set()` API 定制聊天气泡头像，DOM 注入绕过了框架的渲染管线
3. **脆弱性：** QwenPaw 前端更新（如 className 变更、虚拟列表重构）会立即破坏注入逻辑

**解决：** 完全重写 `ChatAvatar.tsx`，改用官方 API：

- `chat.response.set(pluginId, { avatar, nick })` — 设置 AI 回复气泡的头像和昵称
- `chat.welcome.set(pluginId, { avatar, nick })` — 设置欢迎界面的头像
- `host.getSelectedAgentId()` — 命令式获取当前选中的 Agent
- 2 秒间隔轮询检测 Agent 切换，动态更新头像

详细实现见问题 18。

**影响文件：** `frontend/src/ChatAvatar.tsx`

---

### 问题 17：前端路由注册 API 不正确 — registerRoutes vs route.add

**现象：** `registerRoutes()` 在 QwenPaw 运行时可能未被定义（可选链 `?.` 保护了不会崩溃，但路由实际上没有注册成功）。

**原因：** `registerRoutes()` 是从 QwenPaw Pet 插件逆向分析得到的 API，并非官方文档记载的接口。QwenPaw 官方的前端插件 API 采用声明式注册模式：

| 社区/skill 文档（错误） | 官方文档（正确） |
|---|---|
| `registerRoutes(pluginId, routes[])` | `route.add(pluginId, { id, path, component })` |
| 路由和菜单合二为一 | `route.add()` 注册路由 + `menu.add()` 注册菜单 |
| 无返回值 | 返回 `{ dispose() }` 用于清理 |

**解决：** 重写 `index.tsx` 使用官方 API：

```typescript
const ROUTE_ID = "agent-avatar-pro.manager";

// 注册页面路由
qwpaw.route.add(this.id, {
  id: ROUTE_ID,
  path: "/plugin/agent-avatar-pro/manager",
  component: AvatarManager,
});

// 注册侧边栏菜单
qwpaw.menu.add(this.id, {
  id: ROUTE_ID,
  label: "Agent 头像管理",
  icon: "\uD83D\uDDBC",
  route: ROUTE_ID,
});
```

**影响文件：** `frontend/src/index.tsx`

---

### 问题 18：聊天头像定制的完整实现

**背景：** 修复问题 16 后，需要基于官方 API 实现完整的聊天头像定制功能。

**设计决策：**

`chat.response.set()` 和 `chat.welcome.set()` 是按 `pluginId` 隔离的全局设置——调用后影响所有 AI 回复的气泡样式，无法按 Agent 分别设置。因此采用"动态更新"策略：

1. 插件启动时开启 2 秒间隔轮询
2. 每次轮询调用 `host.getSelectedAgentId()` 获取当前 Agent
3. Agent ID 变化时，从后端 API 获取该 Agent 的头像数据
4. 调用 `chat.response.set()` 和 `chat.welcome.set()` 更新头像和昵称
5. 缓存头像数据（5 分钟 TTL），避免重复请求
6. 所有注册返回的 `Disposable` 在 Agent 切换或停止监控时统一清理

```typescript
// ChatAvatar.tsx 核心逻辑
let lastAgentId: string | null = null;
const disposables: { dispose: () => void }[] = [];

async function updateChatAvatar(agentId: string): Promise<void> {
  const avatarInfo = await getAvatarForAgent(agentId);
  disposables.forEach(d => d.dispose());
  disposables.length = 0;
  if (avatarInfo) {
    disposables.push(
      qwpaw.chat.response.set(PLUGIN_ID, { avatar: avatarInfo.src, nick: avatarInfo.agentName })
    );
    disposables.push(
      qwpaw.chat.welcome.set(PLUGIN_ID, { avatar: avatarInfo.src, nick: avatarInfo.agentName })
    );
  }
}
```

**影响文件：** `frontend/src/ChatAvatar.tsx`、`frontend/src/index.tsx`

---

### 问题 19：qwenpaw-plugin-dev skill 文档存在多处不准确信息

**现象：** skill 文档中记载的 API（如 `registerRoutes()`、Vite external 列表、TypeScript 类型声明）与官方文档 `plugins.zh.md` 不一致。

**原因：** skill 文档是基于项目早期开发过程中对 QwenPaw Pet 插件的逆向分析和推测编写的，并非参考官方文档。用户明确指出 "skill 文档不一定正确，只是根据之前的开发过程编写，并非官方"。

**修正内容：**

| 章节 | 修正前 | 修正后 |
|------|--------|--------|
| 路由注册 | `registerRoutes()` | `route.add()` + `menu.add()`，Disposable 模式 |
| Host API | 仅 getApiUrl/getApiToken | 补充 host.fetch()、useSelectedAgent()、getSelectedAgentId()、useTheme()、useLocale() |
| Chat API | 无 | 新增 chat.response.set()、chat.welcome.set()、chat.response.append() |
| TypeScript 声明 | 20 行，仅 QwenPawHost + registerRoutes | 完整覆盖 route/menu/chat/slot/disposable 全部命名空间 |
| Vite 配置 | "react/react-dom/antd externalized" | 补充说明官方文档仅 externalize react/react-dom，antd external 是实用选择 |
| Checklist | 3 项前端检查 | 8 项，增加 pluginId 隔离、chat 定制、host.fetch()、try-catch 防护 |

**影响范围：** `qwenpaw-plugin-dev` skill（`~/.qoderworkcn/skills/qwenpaw-plugin-dev/SKILL.md`）

---

### 问题 20：chat.response.set() / chat.welcome.set() 头像不显示 — avatar 字段不接受 data URI

**现象：** 管理面板功能正常，但聊天气泡和欢迎界面的 Agent 头像不显示。

**原因：** `chat.response.set()` 和 `chat.welcome.set()` 的 `avatar` 字段只接受 URL 字符串（如 `"https://example.com/bot-avatar.png"`），不接受 base64 data URI。之前的实现从后端 API 获取图片数据后转成 `data:image/png;base64,...` 格式传入，QwenPaw 前端无法正确渲染。

此外，官方文档有一条关键注释：*"当前会复用 welcome.avatar / welcome.nick，因为默认 ResponseCard 读取这两个字段"*——说明 `chat.response.set()` 底层依赖 welcome 机制，两者需要配合使用。

**解决：** 不再从 API 获取图片数据转 base64，而是直接构造后端头像 API 端点的 URL：

```typescript
// ❌ 旧方案：base64 data URI（不被 avatar 字段支持）
const res = await host.fetch(`/api/avatar-pro/${agentId}?size=thumb`);
const data = await res.json();
const src = `data:${data.mime};base64,${data.data}`;
chat.response.set(PLUGIN_ID, { avatar: src, nick: agentId });

// ✅ 新方案：直接传递 API 端点 URL
const avatarUrl = host.getApiUrl(`/avatar-pro/${agentId}`);
chat.welcome.set(PLUGIN_ID, { avatar: avatarUrl, nick: agentId });  // 先设 welcome
chat.response.set(PLUGIN_ID, { avatar: avatarUrl, nick: agentId }); // 再设 response
```

同时添加了 `console.log` 诊断输出，便于在浏览器控制台排查问题。

**影响文件：** `frontend/src/ChatAvatar.tsx`

---

## 更新后的项目结构

```
agent-avatar-pro/
├── plugin.json              # 插件清单
├── plugin.py                # 入口：sys.path 注入 + 路由 + 工具 + 钩子 + 503 就绪检测
├── avatar_service.py        # 核心服务：存储/格式检测/压缩/SVG清洗/单例/asyncio.Event 门控
├── avatar_backend.py        # Agent 工具：延迟导入 + 直接调用 Service
├── requirements.txt         # Pillow>=9.0（QwenPaw 已包含）
├── install.bat              # 一键安装脚本
├── build.bat                # 仅构建前端
├── data/                    # 运行时头像数据（插件目录相对路径）
│   └── {agent_id}/          # 每个 Agent 一个子目录
├── dist/
│   ├── index.js             # 前端 Bundle（22.93KB / gzip 6.56KB）
│   └── index.js.map         # Source Map
├── frontend/
│   ├── package.json
│   ├── vite.config.ts       # jsxRuntime: classic, external: react/react-dom/antd
│   ├── tsconfig.json        # jsx: react, types: []
│   └── src/
│       ├── index.tsx        # 入口：route.add() + menu.add() + chat monitor
│       ├── types.ts         # TypeScript 类型定义
│       ├── api.ts           # API 层（使用 host.fetch() 认证代理）
│       ├── qwenpaw-host.d.ts # 完整官方 API 全局类型声明（route/menu/chat/slot）
│       ├── AvatarRenderer.tsx  # 多格式渲染器
│       ├── AvatarUploader.tsx  # 上传组件（antd Upload）
│       ├── AvatarManager.tsx   # 管理面板（antd Table/Card/AutoComplete）
│       └── ChatAvatar.tsx      # 聊天头像定制（chat.response.set / chat.welcome.set）
├── docs/
│   ├── DEVLOG.md            # 开发日志（本文件）
│   ├── TESTING.md           # 测试说明
│   └── GUIDE.md             # 使用说明
├── tests/
│   └── test_all.py          # 自动化测试（51 项）
└── README.md                # 项目文档
```

---

## 测试结果

使用 QwenPaw 自带的 Python 3.10.20 环境运行 51 项测试，全部通过：

| 模块 | 测试数 | 结果 |
|------|--------|------|
| 核心功能（CRUD、列表、删除、错误处理） | 13 | 全部通过 |
| 安全（Magic bytes、SVG XSS、URL 白名单、大小限制） | 15 | 全部通过 |
| 格式兼容（PNG/APNG/JPG/GIF/WebP/SVG/Lottie JSON） | 20 | 全部通过 |
| 单例访问器（get/set_service） | 3 | 全部通过 |

测试过程中发现并修复了 SVG XML 声明检测 bug（问题 6）。

---

## 当前状态与待完成项

### 已完成

- [x] 后端：6 个 API 端点 + 2 个 Agent 工具 + 3 个生命周期钩子
- [x] 后端就绪机制：asyncio.Event 门控 + 503 响应 + 前端指数退避重试
- [x] 前端安全防护：try-catch 包裹 + null guards + 延迟初始化
- [x] 前端管理面板：antd 组件 + AutoComplete Agent ID 选择 + 匹配验证
- [x] 文件上传：Request.body() 原始二进制 + Magic bytes 格式检测
- [x] 数据存储：插件目录相对路径（`{plugin_dir}/data/`）
- [x] 聊天头像：官方 chat.response.set() + chat.welcome.set() API
- [x] Agent 检测：host.getSelectedAgentId() 轮询 + 动态头像切换
- [x] 路由注册：官方 route.add() + menu.add() API
- [x] API 认证：host.fetch() 代理（自动注入 Authorization + X-Agent-Id）
- [x] 安全：Magic bytes 校验 + SVG XSS 清洗 + URL 白名单 + 大小限制
- [x] 格式支持：PNG/APNG/JPEG/GIF/WebP/SVG/Lottie JSON（7 种）
- [x] 测试：51 项自动化测试全部通过
- [x] 构建：预构建 dist/index.js（22.93KB / gzip 6.56KB）
- [x] 插件安装：已通过 QwenPaw CLI 成功安装，后端状态"运行中"
- [x] Skill 文档：已根据官方 plugins.zh.md 修正 qwenpaw-plugin-dev skill

### 待验证

- [x] 官方 route.add() + menu.add() 注册后，"Agent 头像管理" 是否出现在侧边栏（已验证：正确显示）
- [x] 管理面板中 antd 组件是否正确渲染（已验证：正常）
- [x] 上传功能端到端测试（前端 → API → 存储 → 渲染）（已验证：正常）
- [ ] chat.response.set() 是否正确显示 Agent 头像在聊天气泡中（v2 已修复：改用 URL 替代 data URI，待验证）
- [ ] chat.welcome.set() 是否正确显示欢迎界面头像（v2 已修复，待验证）
- [ ] Agent 切换时头像是否动态更新（v2 已修复，待验证）

### 待开发

- [ ] Lottie 动画完整渲染（当前以静态图片展示，需集成 lottie-react 动态导入）
- [ ] 圆形裁剪预览（react-easy-crop 接口已预留）
- [ ] 缩略图 API 完整支持（`size=thumb` 参数已定义，仅静态图片生效）
- [ ] 多浏览器兼容性测试（Firefox/Safari）
- [ ] `chat.response.append()` 增强：在 AI 回复末尾追加来源标识
- [ ] 按 Agent 分别定制欢迎语（`chat.welcome.set()` 的 greeting 参数）

---

## 关键设计决策记录

### 决策 1：自建格式检测而非使用第三方库

**选择：** 在 `avatar_service.py` 中使用自建 `SUPPORTED_FORMATS` 字典做 Magic bytes 匹配。

**理由：** `python-magic` 在 Windows 上需要 `libmagic` DLL；`filetype` 虽然跨平台但不支持 SVG 和 Lottie JSON。自建实现零依赖、完全可控，且可精确处理 APNG 的 `acTL` chunk 检测和 SVG 的 XML 声明问题。

### 决策 2：工具函数直接调用而非 HTTP 回环

**选择：** `avatar_backend.py` 通过 `get_service()` 单例直接调用 `AvatarService` 方法。

**理由：** QwenPaw 插件运行在同一进程中，HTTP 回环引入不必要的网络延迟和端口依赖。直接调用更简洁、更快、更可靠。

### 决策 3：前端使用 QwenPaw Host API

**选择：** React/antd 从 `window.QwenPaw.host` 获取而非自行打包。

**理由：** 与 QwenPaw 控制台共享同一 React 实例和 antd 主题，保证 UI 一致性；Bundle 从 58.9KB 缩小到 16.35KB；避免多 React 实例导致的 Hook 错误。

### 决策 4：插件目录显式加入 sys.path

**选择：** 在 `plugin.py` 顶部用 `sys.path.insert(0, _plugin_dir)` 注册插件目录。

**理由：** QwenPaw 的 `importlib.util.spec_from_file_location` 加载方式不会自动将插件目录加入 `sys.path`，导致同级模块导入失败。这是 QwenPaw 插件开发的一个常见陷阱。

### 决策 5：qwenpaw.core 延迟导入

**选择：** `ToolResponse` 在函数体内导入而非模块顶层。

**理由：** QwenPaw 插件验证阶段会尝试 import 插件模块，此时 `qwenpaw.core` 可能尚未完全加载。延迟导入确保验证阶段不会因模块未就绪而失败。

### 决策 6：后端就绪门控（asyncio.Event）

**选择：** 使用 `asyncio.Event` + 超时机制（15s）作为服务就绪门控，而非直接返回 None 或抛出异常。

**理由：** QwenPaw 的 FastAPI 路由注册（`register` 阶段）先于 `startup hook` 执行完成。这意味着 HTTP 端点在 `AvatarService.initialize()` 完成前就已可访问。直接返回 None 会导致 500 错误，而 asyncio.Event 允许请求等待服务就绪（最多 15 秒），配合 503 + Retry-After 头给前端明确的重试信号。

### 决策 7：官方 chat API 替代 DOM 注入

**选择：** 使用 `chat.response.set()` + `chat.welcome.set()` 官方 API 设置聊天头像，替代 MutationObserver DOM 注入。

**理由：** MutationObserver 方案存在三个根本问题：(1) DOM 选择器不可靠，依赖 QwenPaw 前端的具体 class 名和 DOM 结构；(2) 绕过框架渲染管线，违反框架契约；(3) QwenPaw 前端更新会立即破坏注入逻辑。官方 API 是声明式的，由框架负责渲染细节，更健壮、更持久。

### 决策 8：host.fetch() 替代原生 fetch

**选择：** 使用 `window.QwenPaw.host.fetch()` 替代原生 `fetch()` + 手动 `authHeaders()`。

**理由：** `host.fetch()` 自动注入 `Authorization`（Bearer token）和 `X-Agent-Id` 请求头，免去手动管理认证令牌的复杂性。同时确保在 QwenPaw Desktop 和 CLI 等不同部署环境下都能正确认证。

### 决策 9：聊天头像使用 API 端点 URL 而非 base64

**选择：** `chat.response.set()` 的 `avatar` 字段传入 `host.getApiUrl('/avatar-pro/{agentId}')` 返回的 URL，而非从 API 获取图片数据后转成的 base64 data URI。

**理由：** 官方文档明确显示 `avatar` 字段只接受 URL 字符串。虽然 base64 data URI 在 `<img>` 标签中可用，但 `chat.response.set()` 内部可能对 URL 有额外处理（如懒加载、CDN 重写等），不支持 data URI 格式。使用 API 端点 URL 更轻量（无需额外 API 调用和 base64 编码开销），也更符合官方设计意图。

### 问题 21：聊天头像显示灰色 + 所有 Agent 头像变灰 + nick 显示 ID

**现象：** `chat.response.set()` 和 `chat.welcome.set()` 调用成功（头像区域出现），但显示为灰色占位区域而非实际图片。设置任一 Agent 后所有 Agent 头像都变灰色，不会因切换 Agent 恢复默认。对话页面显示 Agent ID 而非名称。

**原因（三个独立问题）：**

1. **灰色头像：** `GET /api/avatar-pro/{agent_id}` 返回的是 JSON（含 base64 数据），Content-Type 为 `application/json`。`<img>` 标签加载此 URL 时浏览器无法将 JSON 解析为图片，显示灰色占位符。
2. **所有 Agent 变灰：** `chat.response.set()` 是全局设置，对没有自定义头像的 Agent 也生效。当切换到无头像的 Agent 时，旧的灰色头像 URL 仍然生效。
3. **nick 显示 ID：** `nick` 字段直接传入了 `agentId` 而非 Agent 名称。

**解决：**

1. **新增图片直传端点：** `GET /{agent_id}/image` 返回原始图片字节 + 正确 `Content-Type`（如 `image/png`），URL 类型头像返回 302 重定向。新增 `has_avatar()` 和 `get_avatar_image()` 方法到 `AvatarService`。
2. **按需设置头像：** 调用 `chat.response.set()` 前先通过 `GET /{agent_id}/check` 确认 Agent 有自定义头像，无头像时不调用 set（保持 QwenPaw 默认头像）。
3. **获取 Agent 名称：** 从 `/agents` 端点获取 Agent 列表，缓存名称映射（1 分钟 TTL），nick 使用名称。

**影响文件：** `avatar_service.py`、`plugin.py`、`frontend/src/ChatAvatar.tsx`、`frontend/src/api.ts`

---

### 问题 22：头像/名称切换延迟优化

**现象：** Agent 切换后头像和名称更新有约 2-3 秒延迟。

**原因：** 轮询间隔 2000ms + `checkAvatar` 和 `getAgentName` 串行执行（两次网络请求顺序等待）。

**解决：**
- 轮询间隔从 2000ms 缩短到 800ms（同步检查开销可忽略）
- `checkAvatar` 和 `getAgentName` 改为 `Promise.all` 并行调用
- 添加竞态防护：异步操作完成后校验 `agentId === lastAgentId`，避免旧请求覆盖新 Agent 设置

**效果：** 延迟从约 2-3 秒降至约 1 秒。

**影响文件：** `frontend/src/ChatAvatar.tsx`

---

### 决策 10：800ms 轮询而非事件监听

**选择：** 使用 800ms 间隔轮询 `host.getSelectedAgentId()` 检测 Agent 切换，而非 React hook 事件监听。

**理由：** 官方 Host SDK 提供 `host.useSelectedAgent()` React hook，但只能在 React 组件内使用。ChatAvatar 是纯命令式模块，无法直接调用 hook。理论上可通过 `slot.fill()` 挂载隐藏组件来使用 hook，但增加了架构复杂度且依赖 slot 在非页面场景下的行为。800ms 轮询的核心操作是同步读取，CPU 开销可忽略，是更简单可靠的选择。

### 决策 11：图片直传端点（/image）与 JSON 端点并存

**选择：** 新增 `GET /{agent_id}/image` 返回原始图片字节，保留原有 `GET /{agent_id}` 返回 JSON。

**理由：** 两个端点服务不同消费场景：JSON 端点供管理面板和 API 调用者获取元数据（格式、来源、大小等）；图片直传端点供 `<img>` 标签和 `chat.response.set()` 直接加载。合并为一个端点会破坏已有前端代码（AvatarRenderer 依赖 JSON 响应格式）。URL 类型头像在 `/image` 端点返回 302 重定向，避免后端代理下载。
