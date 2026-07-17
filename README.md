# Agent Avatar Pro

QwenPaw Agent 自定义头像插件 — 为每个 Agent 设置专属头像，支持 7 种图片格式（含动态和矢量），在聊天窗口和欢迎界面自动展示。

## 功能

- **7 种图片格式**：PNG、APNG（动画）、JPEG、GIF（动画）、WebP（动画）、SVG（矢量）、Lottie JSON
- **URL 头像**：直接粘贴 HTTPS 图片链接，无需上传文件
- **聊天窗口展示**：切换 Agent 时自动更新聊天气泡和欢迎界面的头像与名称
- **Agent 工具**：对话中让 Agent 直接设置或查询头像（`set_agent_avatar` / `get_agent_avatar_status`）
- **服务端图片处理**：Pillow 自动 resize、缩略图生成、文件头格式校验
- **安全防护**：SVG XSS 清洗、HTTPS URL 白名单、文件类型伪造检测

## 支持的格式

| 格式 | 扩展名 | 类型 | 说明 |
|------|--------|------|------|
| PNG | `.png` | 静态 | 通用位图格式 |
| APNG | `.png` | 动画 | 自动检测 `acTL` chunk 区分 APNG |
| JPEG | `.jpg`, `.jpeg` | 静态 | 照片类头像 |
| GIF | `.gif` | 动画 | 传统动画格式 |
| WebP | `.webp` | 静态/动画 | 现代高效格式，自动检测动画帧 |
| SVG | `.svg` | 矢量 | 任意放大不模糊，上传时自动 XSS 清洗 |
| Lottie | `.json` | 动画 | After Effects 矢量动画 |

格式检测通过文件头 Magic bytes 实现，不依赖扩展名，也不依赖第三方库（`python-magic`/`filetype`）。SVG 额外支持 `<?xml` 声明开头的文件。

## 安装

**前置条件：** QwenPaw >= 1.1.0（支持 1.1.x 旧版和 2.0.x 新版），插件目录中包含 `dist/index.js`（已预构建）。

> **新版 QwenPaw 兼容性：** `plugin.json` 同时声明了 `min_version: "1.1.0"`（旧版加载器读取）和 `qwenpaw_version: {min: "1.1.0", max: "3.0.0"}`（新版加载器读取），实现新旧双向兼容。

```bash
# 关闭 QwenPaw 后执行
qwenpaw plugin install /path/to/agent-avatar-pro
```

或使用 Windows 一键安装脚本（自动构建 + 安装）：

```bash
install.bat
```

安装后启动 QwenPaw，确认日志中出现：

```
[agent-avatar-pro] Avatar service initialized
```

**卸载：**

```bash
# 关闭 QwenPaw 后执行
qwenpaw plugin uninstall agent-avatar-pro
```

## 使用

### 管理面板

安装后在 QwenPaw 侧边栏出现 "Agent 头像管理" 入口。打开面板后：

1. 在 Agent 选择器中选择或输入 Agent ID
2. 拖拽图片到上传区域，或点击选择文件（支持上述 7 种格式，默认 5MB 上限）
3. 也可以粘贴 HTTPS 图片链接，点击 "URL 设置"

已设置的头像以表格形式列出，支持预览和删除。

### 聊天窗口

为 Agent 设置头像后，切换到该 Agent 的聊天界面时：

- **欢迎界面**：显示 Agent 的自定义头像和名称
- **聊天气泡**：Agent 回复的消息旁显示自定义头像

未设置头像的 Agent 保持 QwenPaw 默认外观，不会被覆盖。插件通过 QwenPaw 官方 Host SDK（`chat.response.set` / `chat.welcome.set`）实现，不依赖 DOM 结构。

### Agent 对话工具

在对话中直接让 Agent 操作头像：

> "帮 my-agent 设置头像：https://cdn.example.com/avatar.png"

> "查看所有 Agent 的头像状态"

Agent 会自动调用注册的工具函数完成操作。

## 配置

在 **Settings > Plugins > Agent Avatar Pro** 中可调整：

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `max_file_size` | 5 MB | 单次上传文件大小上限 |
| `default_size` | 256 px | 服务端 resize 目标尺寸（保持宽高比） |
| `enable_lottie` | true | 是否启用 Lottie 动画渲染 |
| `enable_chat_avatar` | true | 是否在聊天窗口展示 Agent 头像 |
| `compression_quality` | medium | 压缩质量：high / medium / low |

修改即时生效，无需重启。

## 项目结构

```
agent-avatar-pro/
├── plugin.json             # 插件清单（含 qwenpaw_version 新版兼容声明）
├── plugin.py               # 后端入口：路由、工具、生命周期钩子
├── avatar_service.py       # 头像管理服务（存储/格式检测/压缩/SVG清洗/单例）
├── avatar_backend.py       # Agent 工具函数（直接调用 Service，无 HTTP 回环）
├── requirements.txt        # Python 依赖（QwenPaw 自带）
├── build.bat / install.bat # Windows 构建/安装脚本
├── dist/
│   ├── index.js            # 前端构建产物（~45KB / gzip ~12KB）
│   └── index.js.map        # Source Map
├── frontend/
│   ├── package.json
│   ├── vite.config.ts      # jsxRuntime: classic, external: react/react-dom/antd
│   ├── tsconfig.json       # jsx: react, types: []
│   └── src/
│       ├── index.tsx        # 前端入口（route.add + menu.add + startAvatarMonitor）
│       ├── api.ts           # API 封装层（host.fetch 认证代理 + 指数退避重试）
│       ├── AvatarManager.tsx    # 管理面板（antd Table/Card/AutoComplete）
│       ├── AvatarUploader.tsx   # 上传组件（拖拽/点击/URL 三模式 + 覆盖确认）
│       ├── AvatarRenderer.tsx   # 多格式渲染器
│       ├── ChatAvatar.tsx       # 聊天窗口头像（route.wrap 条件触发 + storage 事件驱动 + 阶梯重试）
│       ├── CropModal.tsx        # 圆形裁剪弹窗（Canvas CTM 管线 + 360° 旋转滑块）
│       ├── qwenpaw-host.d.ts    # Host SDK 类型声明
│       └── types.ts             # TypeScript 类型
├── tests/
│   └── test_all.py          # 自动化测试（51 项）
└── docs/
    ├── DEVLOG.md            # 开发日志（39 个问题 + 22 项设计决策 + Phase 12 迁移）
    ├── GUIDE.md             # 详细使用说明
    ├── TESTING.md           # 测试说明
    ├── LOTTIE_DESIGN.md     # Lottie 动画渲染方案
    └── QWENPAW_UNDERSTANDING.md # QwenPaw 平台理解与开发经验
```

## 开发

修改前端代码后需要重新构建：

```bash
cd frontend
npm install    # 首次需要
npm run build  # 输出 dist/index.js
```

或使用快捷脚本：

```bash
build.bat
```

后端修改（`plugin.py`、`avatar_service.py` 等）需要重启 QwenPaw 才能生效。

## 安全机制

- **Magic bytes 校验** — 通过文件头字节检测真实格式，不依赖扩展名，不依赖第三方库
- **SVG XSS 防护** — 上传 SVG 时自动移除 `<script>`、`onclick`、`javascript:` 等危险内容
- **HTTPS 白名单** — URL 头像仅允许 `https://` 协议
- **大小限制** — 超出配置上限的文件直接拒绝
- **存储隔离** — 头像文件仅存储在插件数据目录 `~/.qwenpaw/plugins/agent-avatar-pro/data/`

## 数据存储

每个 Agent 的头像数据存储在独立子目录。实际存储路径取决于 `plugin.py` 传入的 `plugin_dir` 参数：

- **主要路径**（新版默认）：`<插件安装目录>/data/{agent_id}/`
- **回退路径**（兼容旧版）：`~/.qwenpaw/plugins/agent-avatar-pro/data/{agent_id}/`

```
data/
├── my-agent/
│   ├── avatar.png       # 原始头像
│   ├── thumbnail.png    # 缩略图（48x48）
│   ├── meta.json        # 元数据（格式、来源、上传时间、历史记录）
│   └── backup/          # 覆盖时自动备份的旧文件（仅保留最近一次）
└── url-agent/
    └── meta.json        # URL 头像仅存元数据
```

**覆盖机制：** 对已有头像的 Agent 再次设置头像时，后端自动备份旧文件到 `backup/` 子目录，并在 `meta.json` 的 `history` 数组中记录替换历史（格式、来源、时间戳）。file→URL 切换时会清理残留的 avatar/thumbnail 文件。

## 文档

- [开发日志](docs/DEVLOG.md) — 39 个问题记录、22 项设计决策、Phase 12 新版迁移
- [详细使用说明](docs/GUIDE.md) — 安装配置、API 参考、常见问题
- [测试说明](docs/TESTING.md) — API 测试、安全测试、格式兼容性测试的完整步骤
- [Lottie 渲染方案](docs/LOTTIE_DESIGN.md) — Lottie 动画在 QwenPaw 前端的渲染设计
- [QwenPaw 平台理解](docs/QWENPAW_UNDERSTANDING.md) — QwenPaw 内部机制与开发经验
