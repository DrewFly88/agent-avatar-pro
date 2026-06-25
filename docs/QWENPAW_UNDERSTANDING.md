## QwenPaw 插件开发理解总结

本文档整理自 agent-avatar-pro 插件开发过程中对 QwenPaw 官方文档（`docs/plugins.zh.md`）和运行时代码的分析与理解。内容涵盖插件加载机制、前端/后端 API、状态管理、以及开发中遇到的关键陷阱。

---

### 一、插件加载机制

#### 1.1 后端加载

QwenPaw 启动时通过 `importlib` 动态导入每个已安装插件的后端入口文件（`plugin.py`）。插件目录会被注入 `sys.path`，因此入口文件可以直接 `import` 同目录下的兄弟模块（如 `from avatar_service import AvatarService`）。

后端插件入口需导出一个 `plugin` 对象，该对象必须实现 `register(self, api: PluginApi)` 方法。QwenPaw 在加载阶段依次调用各插件的 `register()`，完成路由注册、启动钩子绑定等操作。

**启动钩子（startup hooks）** 按 `priority` 值排序执行。优先级数字越小越先执行。插件的初始化逻辑（如创建数据目录、加载配置）应放在 startup hook 中，而非模块顶层或 `register()` 中，因为后者在插件加载时同步执行，此时其他插件或核心服务可能尚未就绪。

**关键发现：** 所有插件的后端入口在启动阶段同步加载，如果某个插件的 `register()` 或模块顶层代码抛出异常，可能影响后续插件的加载。

#### 1.2 前端加载

前端插件 bundle（`dist/index.js`）通过 Blob URL + `dynamic import()` 加载。QwenPaw 在启动期间**并行**加载所有前端插件的 bundle（`Promise.allSettled`），bundle 的 JavaScript 代码会被**同步求值**。

这意味着：

- bundle 求值期间的任何未捕获异常都会中断该插件的加载，若异常未被 `allSettled` 妥善处理，甚至可能影响后续插件。
- bundle 求值期间发起的 API 请求（包括 `setTimeout(0)` 延迟的请求）会与 QwenPaw 自身的启动请求竞争 HTTP 连接池，导致"插件管理"页面加载异常。
- 因此，bundle 的顶层代码必须极度轻量——仅做 try-catch 包裹的注册调用，不发起任何网络请求。

**关键约束：** 前端 bundle 求值 ≠ 组件挂载。React 组件的挂载发生在用户导航到相应页面时，远晚于 bundle 求值。所有需要 API 请求的初始化逻辑应延迟到组件挂载（`useEffect`）或用户进入特定页面时执行。

#### 1.3 插件安装目录

QwenPaw 将插件安装到 `~/.qwenpaw/plugins/{plugin_id}/`。CLI 命令：

```bash
qwenpaw plugin install /path/to/plugin --force
```

安装时需先关闭 QwenPaw，否则文件可能被占用。构建产物在源码目录的 `dist/` 中，安装后位于 plugins 目录，两者独立——修改源码后需重新构建并重新安装（或手动拷贝 `dist/index.js`）。

---

### 二、插件清单（plugin.json）

#### 2.1 基本字段

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "0.1.0",
  "description": "A brief description",
  "author": "Author",
  "type": "frontend",
  "entry": {
    "backend": "plugin.py",
    "frontend": "dist/index.js"
  },
  "dependencies": ["Pillow>=9.0"],
  "min_version": "1.1.0"
}
```

`type` 可选值：`tool`、`provider`、`hook`、`command`、`frontend`、`general`。即使同时包含前后端入口，`type` 仍写主要类型（如 `"frontend"`）。

#### 2.2 国际化（i18n）

**重要发现：** `name` 和 `description` 字段必须是**纯字符串**，不能使用 `{ "zh-CN": "...", "en-US": "..." }` 对象格式。QwenPaw 的插件管理页面直接用 `name` 和 `description` 作为 React 子节点渲染，如果传入对象会导致 React 崩溃：

```
Objects are not valid as a React child (found: object with keys {zh-CN, en-US})
```

多语言翻译应放在 `description_i18n` 字段中（参考 `qwenpaw-pet` 插件的做法）：

```json
{
  "name": "Agent Avatar Pro",
  "description": "English description here",
  "description_i18n": {
    "zh-CN": "中文描述",
    "en-US": "English description"
  }
}
```

官方文档中未明确说明此约束，这是通过对比正常工作的 `qwenpaw-pet` 插件的 `plugin.json` 才发现的。

#### 2.3 meta 字段

`meta.tools` 声明插件提供的 Agent 工具，`meta.config_fields` 声明用户可配置项。这些字段在插件管理页面展示，并影响 QwenPaw 的工具注册。

---

### 三、前端 API

前端插件通过 `window.QwenPaw` 全局对象访问 QwenPaw 提供的 Host SDK。所有 API 均返回 `Disposable` 对象（含 `dispose()` 方法），用于在插件卸载或功能关闭时清理资源。

#### 3.1 Host SDK（`window.QwenPaw.host`）

| 方法 | 说明 |
|------|------|
| `host.fetch(url, options)` | 带鉴权的 HTTP 请求（自动附加认证头） |
| `host.getApiUrl(path)` | 将相对路径转为完整 API URL（含 base path） |
| `host.getSelectedAgentId()` | 获取当前选中 Agent 的 ID |
| `host.useSelectedAgent()` | React Hook，返回 `{ id: string }`，Agent 切换时触发 re-render |

**React/antd 运行时：** 前端插件不打包 React 和 antd，而是通过 `window.QwenPaw.host.React` 和 `window.QwenPaw.host.antd` 获取 QwenPaw 提供的共享实例。Vite 构建时需将 `react`、`react-dom`、`react/jsx-runtime`、`antd`、`@ant-design/icons` 配置为 `external`。

**JSX 运行时：** 必须使用 `"classic"` 模式（即每个 JSX 文件需 `import React from 'react'`），不能用 `"automatic"` 模式，因为后者依赖的 `_jsx` 运行时在外部化后不可用。

#### 3.2 路由与菜单

| API | 说明 |
|-----|------|
| `route.add(pluginId, { id, path, component })` | 注册页面路由，component 为 React 组件 |
| `route.wrap(pluginId, routeId, wrapperFn)` | 包裹已有路由，wrapperFn 签名 `(Inner) => Wrapper` |
| `menu.add(pluginId, { id, label, icon, route })` | 注册侧边栏菜单项 |

**route.wrap 的 Disposable 特殊性：** `route.wrap` 返回的 Disposable 属于**生命周期级别**——它控制整个路由包裹关系的存续。不应将其与 `chat.welcome.set` 等返回的**操作级别** Disposable 混在同一数组中管理。后者在每次操作时需要清理重建，若 route.wrap 的 Disposable 也在其中，会导致 wrapper 被意外销毁，路由包裹失效。

#### 3.3 聊天定制

| API | 说明 |
|-----|------|
| `chat.welcome.set(pluginId, { nick, avatar })` | 设置欢迎界面的头像和昵称 |
| `chat.response.set(pluginId, { nick, avatar })` | 设置 AI 回复消息的头像和昵称 |
| `chat.response.append(pluginId, component)` | 在回复区域追加 React 组件 |
| `slot.fill(slotId, component)` | 向指定插槽注入 React 组件（追加模式） |

**关键发现：** `chat.welcome.set()` 和 `chat.response.set()` 写入**完全相同的全局字段**（`welcome.avatar` / `welcome.nick`）。不存在 per-agent 或 per-message 的头像 API——所有 AI 消息共享单一头像，切换 Agent 时需要重新调用这两个 API 来更新。

**avatar 字段限制：** `avatar` 参数只接受**可访问的 URL 字符串**，不支持 base64 data URI。若需展示本地生成的图片，必须通过后端端点返回原始图片字节（配合正确的 `Content-Type` 响应头）。

**chat.welcome.render() 与 slot.fill() 的区别：** `chat.welcome.render()` 会**替换**整个欢迎界面，组件返回 `null` 会导致空白页。`slot.fill("content.statusBar")` 是**追加模式**，不会破坏现有 UI。需要非破坏性注入时应使用后者。

#### 3.4 组件渲染上下文

通过 `slot.fill()`、`chat.response.append()`、`route.wrap()` 渲染的 React 组件运行在**隔离的子树**中，与 QwenPaw 主应用的 zustand store 隔离。这意味着 `useSelectedAgent()` 等 Hook 在这些组件中**不会响应** Agent 切换。

**例外：** `route.wrap()` 包裹的组件渲染在主 React 树中，zustand Hook 可以正常工作。

**解决方案（隔离子树中检测 Agent 切换）：**

- 跨 tab：监听 `window` 的 `"storage"` 事件，key 为 `"qwenpaw-agent-storage"`
- 同 tab：monkey-patch `sessionStorage.setItem`，拦截写入事件

#### 3.5 前端安全约束

1. **bundle 求值不能抛出未捕获异常**——用 try-catch 包裹整个插件初始化逻辑
2. **bundle 求值期间不发起 API 请求**——包括 `setTimeout(0)` 也不行，会与启动请求竞争连接池
3. **所有 host 访问使用可选链**——`window.QwenPaw?.host?.method?.()`，防止 API 不可用时崩溃
4. **antd 子组件解构加兜底**——`const { Table, Button } = (window.QwenPaw?.host?.antd ?? {}) as any`

---

### 四、后端 API

#### 4.1 PluginApi

后端插件通过 `register(self, api: PluginApi)` 中的 `api` 对象与 QwenPaw 交互：

| 方法 | 说明 |
|------|------|
| `api.register_http_router(router, prefix, tags)` | 注册 FastAPI 路由（`APIRouter`） |
| `api.register_startup_hook(callback, priority)` | 注册启动钩子 |
| `api.register_shutdown_hook(callback)` | 注册关闭钩子 |
| `api.register_provider(provider)` | 注册 Provider |

**HTTP 路由：** 使用标准 FastAPI `APIRouter`，通过 `register_http_router` 挂载到 QwenPaw 的 FastAPI 应用上。路由注册顺序很重要——固定路径（如 `/list`、`/formats`）必须在参数化路径（如 `/{agent_id}`）之前注册，否则 FastAPI 会将 `"list"` 匹配为 `agent_id` 参数。

#### 4.2 启动时序与竞态

QwenPaw 启动时序大致如下：

1. 后端核心服务初始化
2. 各插件 `register()` 被调用（注册路由、钩子等）
3. Startup hooks 按 priority 顺序执行
4. 后端 HTTP 服务开始监听
5. 前端 bundle 开始并行加载

**竞态条件：** 前端 bundle 加载后，如果用户立即进入聊天页面，此时后端 startup hooks 可能尚未执行完毕（特别是依赖外部服务的 hook），API 请求会返回 503。解决方案是阶梯式重试（3s / 6s / 9s），给后端足够的启动时间。

**asyncio.Event 门控：** 后端服务（如 `AvatarService`）可使用模块级 `asyncio.Event` 作为就绪门控。startup hook 中完成初始化后调用 `event.set()`，API 端点在处理请求前检查 `event.is_set()`，未就绪时返回 503。这比在 `register()` 中初始化更安全，因为此时依赖的服务可能尚未就绪。

#### 4.3 同进程工具函数

Agent 工具函数（`avatar_backend.py` 中定义的函数）运行在 QwenPaw **同一进程**中，可以直接 `import` 并调用插件服务的方法（如 `AvatarService.upload_avatar()`），不通过 HTTP 回环。这意味着：

- 没有端口依赖问题
- 没有网络延迟
- 但需要注意线程安全和阻塞操作

#### 4.4 原生 API 端点

QwenPaw 自身提供的 API 端点（插件可直接调用，无需自建代理）：

| 端点 | 说明 |
|------|------|
| `GET /api/agents` | 返回 `{ agents: [{ id, name, description, enabled, workspace_dir, active_model }] }` |

插件前端可直接通过 `host.fetch()` 调用此端点获取 Agent 列表，用于 AutoComplete 组件的数据源。

---

### 五、Agent 状态管理

#### 5.1 存储机制

QwenPaw 使用 **zustand + persist** 管理 Agent 状态，存储 key 为 `"qwenpaw-agent-storage"`，同时写入 `sessionStorage` 和 `localStorage`。数据格式：

```json
{
  "state": {
    "selectedAgent": "agent-id-here"
  }
}
```

#### 5.2 检测 Agent 切换

由于前端插件的 slot/route.wrap 组件可能运行在隔离子树中（zustand Hook 不生效），需要通过 storage 事件检测 Agent 切换：

**跨 tab 切换：**
```typescript
window.addEventListener("storage", (e) => {
  if (e.key === "qwenpaw-agent-storage") {
    const parsed = JSON.parse(e.newValue);
    const agentId = parsed?.state?.selectedAgent;
    // agentId 即为切换后的 Agent ID
  }
});
```

**同 tab 切换：**
```typescript
const original = sessionStorage.setItem.bind(sessionStorage);
sessionStorage.setItem = function(key, value) {
  original(key, value);
  if (key === "qwenpaw-agent-storage") {
    const parsed = JSON.parse(value);
    const agentId = parsed?.state?.selectedAgent;
    // 检测切换
  }
};
```

---

### 六、图片缓存问题

#### 6.1 QwenPaw Desktop 的缓存行为

QwenPaw Desktop（基于 Electron/Edge）的 `/image` 端点返回的图片**不受 URL 查询参数影响**——即使添加 `?t=timestamp`，浏览器仍可能返回缓存的旧图片。`Cache-Control: max-age=300` 响应头也无法覆盖此行为。

**解决方案：** 管理面板中的头像预览和表格不使用 HTTP URL，而是通过 `fetchAvatar()` API 获取 JSON 响应中的 base64 data URI（`data:image/png;base64,...`）来渲染。聊天窗口的头像 URL 同样需要 cache-busting，但效果因浏览器而异。

#### 6.2 React 组件缓存

即使 URL 已变化，React 可能复用旧的 `<img>` DOM 元素，导致浏览器内部图片缓存生效。解决方案是为 `<img>` 添加 `key={imgSrc}` 属性，强制 React 在 URL 变化时创建新的 DOM 元素。

---

### 七、关键陷阱与经验

#### 7.1 插件管理页面崩溃

**症状：** 安装插件后打开"插件管理"页面，页面阻塞或报错。

**原因：** 前端 bundle 求值期间发起 API 请求（即使通过 `setTimeout(0)` 延迟），与 QwenPaw 自身的插件管理页面请求竞争 HTTP 连接池。

**解法：** 所有 API 请求延迟到组件挂载时（`useEffect`）或用户进入特定页面时（`route.wrap` 检测）。

#### 7.2 Disposable 生命周期混淆

**症状：** `route.wrap` 包裹的路由突然失效，聊天页面不再被包裹。

**原因：** `route.wrap` 返回的 Disposable 与 `chat.welcome.set` 等返回的 Disposable 放在同一数组中，后者在每次更新时被 `clearDisposables()` 清理，连带销毁了 route.wrap 的包裹关系。

**解法：** 将 `route.wrap` 的 Disposable 单独存储在模块级变量中，仅在 `stopAvatarMonitor()` 中清理。

#### 7.3 setup() 同步调用 API

**症状：** 插件加载后 QwenPaw 整体异常，插件管理页面无法打开。

**原因：** `setup()` 中同步调用 API（fetch、定时器等），阻断插件加载循环，或引发 HTTP 连接池竞争。

**解法：** `setup()` 仅做同步注册（route.add、menu.add），异步操作延迟到组件挂载或条件触发时。

#### 7.4 plugin.json i18n 格式

**症状：** 插件管理页面 React 崩溃，错误信息 `Objects are not valid as a React child`。

**原因：** `name` 或 `description` 使用了 `{ "zh-CN": "...", "en-US": "..." }` 对象格式，QwenPaw 直接将其作为 React 子节点渲染。

**解法：** 使用纯字符串 + `description_i18n` 字段。

#### 7.5 无头像 Agent 的冗余请求

**症状：** 对未设置头像的 Agent，阶梯式重试仍执行全部 3 次。

**原因：** 重试条件仅检查 `avatarLoaded`（头像 URL 是否获取），未考虑后端已正常响应"无头像"的情况。

**解法：** 引入 `_avatarConfirmed` 标志，后端返回 `check.ok=true` 时设置为 `true`，重试条件改为 `!avatarLoaded && !_avatarConfirmed`。

#### 7.6 构建后不同步 dist

**症状：** 修改源码并 `npm run build` 后，安装的插件行为未变化。

**原因：** QwenPaw 将插件安装到 `~/.qwenpaw/plugins/` 目录，构建产物在源码目录的 `dist/` 中，两者独立。

**解法：** 构建后需手动拷贝 `dist/index.js` 到已安装插件目录，或重新执行 `qwenpaw plugin install`。

---

### 八、API 速查表

#### 前端 API

```
window.QwenPaw.host.fetch(url, options)      — 带鉴权 HTTP 请求
window.QwenPaw.host.getApiUrl(path)           — 构造完整 API URL
window.QwenPaw.host.getSelectedAgentId()      — 获取当前 Agent ID
window.QwenPaw.host.useSelectedAgent()        — React Hook 监听 Agent 切换
window.QwenPaw.host.React                     — 共享 React 实例
window.QwenPaw.host.antd                      — 共享 antd 实例

window.QwenPaw.route.add(pid, opts)           — 注册路由
window.QwenPaw.route.wrap(pid, rid, fn)       — 包裹路由
window.QwenPaw.menu.add(pid, opts)            — 注册菜单
window.QwenPaw.chat.welcome.set(pid, params)  — 设置欢迎头像/昵称
window.QwenPaw.chat.response.set(pid, params) — 设置回复头像/昵称
window.QwenPaw.slot.fill(slotId, component)   — 注入插槽组件
```

#### 后端 API

```python
api.register_http_router(router, prefix, tags)  # 注册 FastAPI 路由
api.register_startup_hook(callback, priority)    # 注册启动钩子
api.register_shutdown_hook(callback)             # 注册关闭钩子
api.register_provider(provider)                  # 注册 Provider
```

#### 原生端点

```
GET /api/agents  ->  { agents: [{ id, name, description, enabled, ... }] }
```
