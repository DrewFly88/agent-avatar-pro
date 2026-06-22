# Agent Avatar Pro — 插件使用说明

## 一、插件简介

Agent Avatar Pro 是 QwenPaw 的头像增强插件，为每个 Agent 提供自定义头像功能。相比 QwenPaw 原生控制台（当前版本所有 Agent 使用通用机器人图标），本插件支持 7 种图片格式，包括 APNG、SVG、Lottie 等动态格式，并支持通过 URL 直接设置头像。

**零额外依赖：** 插件的所有 Python 依赖（Pillow、httpx）均已包含在 QwenPaw 运行环境中，安装时无需手动 `pip install` 任何包。格式检测使用内置 Magic bytes 字典实现，不依赖第三方库。

---

## 二、安装

### 2.1 前置条件

- QwenPaw >= 1.1.0
- 插件目录（包含 `plugin.json`、`plugin.py`、`dist/index.js`）

如果目录中已有 `dist/index.js`（约 24KB），可直接安装。否则需先构建前端：

```bash
cd frontend
npm install
npm run build
```

或使用 Windows 下的 `build.bat` 一键构建。

### 2.2 安装插件

1. **关闭 QwenPaw**（插件必须在 QwenPaw 离线时安装）
2. 执行安装命令：

```bash
qwenpaw plugin install /path/to/agent-avatar-pro
```

或使用 Windows 下的 `install.bat`（自动完成构建 + 安装）。

3. **启动 QwenPaw**
4. 确认启动日志中出现 `[agent-avatar-pro] Avatar service initialized`

### 2.3 卸载插件

```bash
# 关闭 QwenPaw 后执行
qwenpaw plugin uninstall agent-avatar-pro
```

卸载时插件会清理所有存储的头像数据。

---

## 三、运行架构

本插件的代码运行在 **QwenPaw 同一 Python 进程**中，不是独立的子进程。具体来说：

- **HTTP 端点**（`/api/avatar-pro/*`）挂载在 QwenPaw 的 FastAPI 应用上，供前端浏览器调用
- **Agent 工具**（`set_agent_avatar` / `get_agent_avatar_status`）被注入到 QwenPaw 的工具模块中，由 LLM 在同一进程中直接调用
- 工具函数**直接调用** `AvatarService` 的方法，不通过 HTTP 回环，因此不受端口配置影响

这意味着：
- 插件不需要知道 QwenPaw 运行在哪个端口
- 工具调用没有网络开销
- 插件能访问 QwenPaw 的所有 Python 包（Pillow 12.2.0、httpx 0.28.1 等）

---

## 四、配置

安装完成后，在 QwenPaw 控制台 **Settings > Plugins > Agent Avatar Pro** 中可调整以下配置：

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| 最大文件大小 | 5 MB | 单次上传的文件大小上限 |
| 默认头像尺寸 | 256 px | 服务端自动 resize 的目标尺寸（保持宽高比） |
| 启用 Lottie 动画 | true | 是否渲染 Lottie JSON 动画头像 |
| 聊天窗口展示头像 | true | 是否在聊天消息旁显示 Agent 头像 |
| 压缩质量 | medium (70%) | 图片压缩等级：high / medium / low |

修改配置后无需重启 QwenPaw，更改即时生效。

---

## 五、使用方式

### 5.1 头像管理面板

打开 QwenPaw 控制台，插件会在界面中加载 "Agent 头像管理" 面板，包含三个区域：

**设置区** — 输入 Agent ID，然后通过以下两种方式设置头像：

- **文件上传**：拖拽图片到上传区域，或点击选择文件。支持 PNG、APNG、JPEG、GIF、WebP、SVG、Lottie JSON 七种格式，文件大小不超过配置的最大值（默认 5MB）。
- **URL 设置**：在 URL 输入框粘贴一个 HTTPS 图片链接，点击 "URL 设置" 按钮。仅支持 HTTPS 协议。

**格式标签区** — 展示所有支持的格式，可通过 "全部 / 动态 / 静态" 按钮筛选。动态格式（APNG、GIF、WebP、Lottie）带有 🎞 标识。

**头像网格区** — 以卡片形式展示所有已配置头像的 Agent，每张卡片包含头像预览、Agent ID、格式和来源信息，以及删除按钮。

### 5.2 通过 Agent 对话设置头像

插件注册了两个 Agent 工具，可以在对话中直接让 Agent 操作头像：

**设置头像：**
> "帮 my-agent 设置这个头像：https://cdn.example.com/avatar.png"

Agent 会自动调用 `set_agent_avatar` 工具完成设置。

**查询头像状态：**
> "查看所有 Agent 的头像配置情况"

Agent 会调用 `get_agent_avatar_status` 工具并返回格式化的列表。

---

## 六、支持的图片格式

| 格式 | 扩展名 | 类型 | 说明 |
|------|--------|------|------|
| PNG | .png | 静态 | 通用位图格式，适合纯色图标和界面元素 |
| APNG | .png / .apng | 动态 | 动态 PNG 动画，浏览器原生支持 |
| JPEG | .jpg / .jpeg | 静态 | 适合照片类头像，有损压缩 |
| GIF | .gif | 动态 | 传统动画格式，色彩有限（256 色） |
| WebP | .webp | 静态/动态 | Google 推出的高效格式，体积更小 |
| SVG | .svg | 矢量 | 可缩放矢量图形，任意放大不模糊 |
| Lottie | .json | 动画 | After Effects 导出的矢量动画，效果丰富 |

**选择建议：**

- 追求简单清晰 → PNG 或 JPEG
- 需要动画效果 → GIF（简单动画）、APNG（高质量动画）、WebP（小体积）
- 需要无限缩放 → SVG
- 需要复杂动画（AE 导出） → Lottie JSON

---

## 七、头像展示位置

### 7.1 聊天窗口

（需开启 "聊天窗口展示头像" 配置）在与 Agent 对话时，插件通过 QwenPaw 官方 Host SDK 的 `chat.response.set()` 和 `chat.welcome.set()` 注册自定义头像和昵称。具体效果：

- **欢迎界面**：切换到已设置头像的 Agent 时，欢迎区域显示该 Agent 的头像和名称
- **聊天气泡**：Agent 回复的消息气泡旁显示自定义头像

插件内部通过 800ms 轮询检测当前选中的 Agent，自动切换对应的头像。对于没有设置自定义头像的 Agent，保持 QwenPaw 默认外观，不会覆盖原有图标。

---

## 八、数据存储

所有头像数据存储在：

```
~/.qwenpaw/plugins/agent-avatar-pro/data/
```

每个 Agent 对应一个子目录：

```
data/
├── my-agent/
│   ├── avatar.png        # 原始头像文件
│   ├── thumbnail.png     # 缩略图（48x48，用于列表展示）
│   └── meta.json         # 元数据（格式、来源、时间戳）
├── another-agent/
│   ├── meta.json         # URL 头像无本地文件，仅存元数据
│   └── ...
```

卸载插件时，如果选择删除数据（`delete_files=True`），整个 `data/` 目录会被清理。

---

## 九、安全机制

本插件内置以下安全防护：

**文件格式校验** — 通过文件头的 Magic bytes 检测真实格式，不依赖扩展名，也不依赖任何第三方库。伪装成 .png 的文本文件会被拒绝。

**SVG 安全清洗** — 上传 SVG 文件时，自动移除 `<script>` 标签、`onclick` / `onerror` 等事件属性和 `javascript:` 协议，防止 XSS 攻击。

**URL 白名单** — 仅允许 `https://` 协议的 URL，拒绝 `http://`、`file://`、`ftp://` 等，防止 SSRF 风险。

**大小限制** — 上传文件不得超过配置的最大大小（默认 5MB），超出直接拒绝。

**存储隔离** — 头像文件仅存储在插件数据目录内，不访问系统其他路径。

---

## 十、常见问题

### Q: 安装时需要额外安装 Python 依赖吗？

不需要。插件依赖的 Pillow 和 httpx 已包含在 QwenPaw 运行环境中。格式检测使用内置实现，不依赖 `python-magic` 或 `filetype` 等第三方库。

### Q: 上传后头像没有显示？

检查以下几点：

1. 确认文件格式在支持列表中（PNG/JPEG/GIF/WebP/SVG/APNG/Lottie）
2. 确认文件未超过大小限制
3. 打开浏览器开发者工具，查看 Network 面板中 API 请求是否返回 200
4. 查看 QwenPaw 控制台日志是否有错误信息

### Q: URL 头像设置失败？

确认 URL 以 `https://` 开头。插件不支持 `http://` 协议。另外，目标 URL 需要对 QwenPaw 所在机器可访问。

### Q: 聊天窗口没有显示头像？

1. 确认 "聊天窗口展示头像" 配置为 `true`
2. 该 Agent 必须已设置自定义头像（未设置头像的 Agent 保持默认外观）
3. 打开浏览器开发者工具控制台，查看是否有 `[agent-avatar-pro]` 开头的日志输出
4. 检查 Network 面板中 `/api/avatar-pro/{agentId}/check` 请求是否返回 `has_avatar: true`
5. 如果后端服务尚未初始化完成，头像设置会有短暂延迟，稍等后刷新即可

### Q: Lottie 动画没有播放？

当前版本 Lottie JSON 以静态图片方式展示。完整的 Lottie 动画渲染需要在前端构建时集成 `lottie-react` 库（已在 `package.json` 中声明为依赖）。确保构建时该依赖已正确安装。

### Q: 如何批量设置头像？

头像管理面板的上传功能一次操作一个 Agent。如需批量设置，可通过 Agent 对话工具逐一操作，或直接操作数据存储目录（`~/.qwenpaw/plugins/agent-avatar-pro/data/`）手动放置文件和 `meta.json`。

### Q: 头像图片会被压缩吗？

上传的静态图片（PNG/JPEG/WebP）会自动 resize 到配置的默认尺寸（默认 256px），保持原始宽高比。GIF 和 APNG 等动态格式保持原文件不做 resize，以保留动画帧。

### Q: 插件在非 8088 端口下能正常工作吗？

可以。插件的工具函数直接调用 `AvatarService` 方法（同进程内调用），不走 HTTP，因此完全不受端口配置影响。HTTP 端点（供前端浏览器调用）自动挂载到 QwenPaw 的 FastAPI 应用上，端口由 QwenPaw 统一管理。

---

## 十一、API 参考

插件后端提供以下 REST API，挂载在 QwenPaw 的 FastAPI 应用上，路径前缀为 `/api/avatar-pro`。端口由 QwenPaw 决定（默认 8088）。

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/avatar-pro/list` | 获取所有头像配置状态 |
| `GET` | `/api/avatar-pro/formats` | 获取支持的格式列表 |
| `POST` | `/api/avatar-pro/{agentId}/upload` | 上传头像文件 |
| `POST` | `/api/avatar-pro/{agentId}/url` | 设置 URL 头像 |
| `GET` | `/api/avatar-pro/{agentId}` | 获取头像数据（base64 或 URL） |
| `GET` | `/api/avatar-pro/{agentId}?size=thumb` | 获取缩略图 |
| `GET` | `/api/avatar-pro/{agentId}/image` | 图片直传（返回原始字节，URL 头像 302 重定向） |
| `GET` | `/api/avatar-pro/{agentId}/image?size=thumb` | 图片直传缩略图 |
| `GET` | `/api/avatar-pro/{agentId}/check` | 检查头像是否存在及类型信息 |
| `DELETE` | `/api/avatar-pro/{agentId}` | 删除头像 |
