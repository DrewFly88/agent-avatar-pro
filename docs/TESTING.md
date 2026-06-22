# Agent Avatar Pro — 插件测试说明

## 一、测试环境准备

### 1.1 前置条件

- QwenPaw >= 1.1.0 已安装并可运行
- Node.js >= 18，npm 可用（仅首次构建前端时需要）
- 插件源码位于本地目录（如 `D:\代码\agent-avatar-pro\`）

**Python 依赖说明：** 插件唯一的 Python 依赖是 `Pillow`（图片处理），该库已包含在 QwenPaw 运行环境中（版本 12.2.0），无需额外安装。`httpx` 同样由 QwenPaw 自带。插件的工具函数直接调用 `AvatarService` 方法（同进程内调用），不通过 HTTP 回环，因此不存在端口依赖问题。

### 1.2 构建前端

如果拿到的源码尚未构建前端（即 `dist/index.js` 不存在），需执行：

```bash
cd frontend
npm install
npm run build
```

构建产物输出到 `agent-avatar-pro/dist/index.js`（约 24KB）。也可使用 Windows 下的 `build.bat` 一键构建。

如果已有 `dist/index.js`，可跳过此步。

### 1.3 安装插件

关闭 QwenPaw 后执行：

```bash
qwenpaw plugin install /path/to/agent-avatar-pro
```

或使用 Windows 下的 `install.bat` 一键安装。

启动 QwenPaw，确认日志中出现：

```
[agent-avatar-pro] Avatar service initialized
```

---

## 二、后端 API 测试

以下测试使用 `curl`。QwenPaw 默认端口为 **8088**，但可通过 `--port` 参数或 `QWENPAW_DESKTOP_PORT` 环境变量修改。如果使用了非默认端口，请替换下面命令中的 `8088`。

```bash
# 查看实际端口（Windows）
echo %QWENPAW_DESKTOP_PORT%
```

### 2.1 获取支持的格式列表

```bash
curl http://localhost:8088/api/avatar-pro/formats
```

**预期响应：**

```json
{
  "formats": [
    {"ext": "png", "label": "PNG", "animated": false},
    {"ext": "apng", "label": "APNG (动态 PNG)", "animated": true},
    {"ext": "jpg", "label": "JPEG", "animated": false},
    {"ext": "gif", "label": "GIF (动画)", "animated": true},
    {"ext": "webp", "label": "WebP (动态)", "animated": true},
    {"ext": "svg", "label": "SVG (矢量)", "animated": false},
    {"ext": "json", "label": "Lottie (动画)", "animated": true}
  ]
}
```

### 2.2 获取头像列表（空状态）

```bash
curl http://localhost:8088/api/avatar-pro/list
```

**预期响应（首次运行）：**

```json
{"ok": true, "count": 0, "avatars": []}
```

### 2.3 上传头像文件

准备一张测试 PNG 图片（小于 5MB），保存为 `test.png`：

```bash
curl -X POST http://localhost:8088/api/avatar-pro/test-agent/upload \
  --data-binary @test.png \
  -H "Content-Type: application/octet-stream"
```

**预期响应：**

```json
{"ok": true, "agent_id": "test-agent", "format": "png", "size": 12345}
```

### 2.4 获取头像数据

```bash
curl http://localhost:8088/api/avatar-pro/test-agent
```

**预期响应：**

```json
{
  "ok": true,
  "type": "file",
  "format": "png",
  "mime": "image/png",
  "data": "iVBORw0KGgo..."
}
```

`data` 字段应为 base64 编码的图片数据，可在浏览器中通过 `data:image/png;base64,<data>` 验证渲染。

### 2.5 设置 URL 头像

```bash
curl -X POST http://localhost:8088/api/avatar-pro/url-agent/url \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/avatar.png"}'
```

**预期响应：**

```json
{"ok": true, "agent_id": "url-agent", "url": "https://example.com/avatar.png", "format": "png"}
```

### 2.6 验证头像列表更新

```bash
curl http://localhost:8088/api/avatar-pro/list
```

**预期响应（上传 + URL 后）：**

```json
{
  "ok": true,
  "count": 2,
  "avatars": [
    {"agent_id": "test-agent", "format": "png", "source": "upload", "uploaded_at": 1750...},
    {"agent_id": "url-agent", "format": "png", "source": "url", "uploaded_at": 1750...}
  ]
}
```

### 2.7 删除头像

```bash
curl -X DELETE http://localhost:8088/api/avatar-pro/test-agent
```

**预期响应：**

```json
{"ok": true, "agent_id": "test-agent"}
```

### 2.8 获取不存在的头像

```bash
curl http://localhost:8088/api/avatar-pro/nonexistent-agent
```

**预期响应：**

```json
{"ok": false, "error": "No avatar set for this agent"}
```

### 2.9 检查头像存在性（/check 端点）

先上传一个头像，然后检查：

```bash
# 上传
curl -X POST http://localhost:8088/api/avatar-pro/test-agent/upload \
  --data-binary @test.png \
  -H "Content-Type: application/octet-stream"

# 检查已设置头像的 Agent
curl http://localhost:8088/api/avatar-pro/test-agent/check
```

**预期响应（有头像）：**

```json
{"ok": true, "has_avatar": true, "type": "file", "url": null, "format": "png"}
```

```bash
# 检查未设置头像的 Agent
curl http://localhost:8088/api/avatar-pro/nonexistent-agent/check
```

**预期响应（无头像）：**

```json
{"ok": true, "has_avatar": false}
```

### 2.10 获取图片直传（/image 端点）

```bash
# 文件类型头像：返回原始图片字节
curl -v http://localhost:8088/api/avatar-pro/test-agent/image
```

**预期行为：** 响应头 `Content-Type: image/png`，`Cache-Control: public, max-age=300`，响应体为图片二进制数据。

```bash
# URL 类型头像：302 重定向
curl -v http://localhost:8088/api/avatar-pro/url-agent/image
```

**预期行为：** 响应状态码 `302`，`Location` 头指向原始 URL。

```bash
# 缩略图
curl -v http://localhost:8088/api/avatar-pro/test-agent/image?size=thumb
```

**预期行为：** 返回缩略图片字节（如果存在），否则返回原图。

```bash
# 无头像的 Agent
curl -v http://localhost:8088/api/avatar-pro/nonexistent-agent/image
```

**预期行为：** 响应状态码 `404`。

---

## 三、安全测试

### 3.1 超大文件拒绝

上传一个超过 5MB 的文件：

```bash
# Windows 下生成 6MB 测试文件
fsutil file createnew large.png 6291456

# Linux/macOS
dd if=/dev/zero of=large.png bs=1M count=6

curl -X POST http://localhost:8088/api/avatar-pro/test/upload \
  --data-binary @large.png \
  -H "Content-Type: application/octet-stream"
```

**预期响应：**

```json
{"ok": false, "error": "File exceeds 5MB limit"}
```

### 3.2 非法格式拒绝（Magic bytes 校验）

上传一个文本文件（改名为 .png）：

```bash
echo "this is not an image" > fake.png

curl -X POST http://localhost:8088/api/avatar-pro/test/upload \
  --data-binary @fake.png \
  -H "Content-Type: application/octet-stream"
```

**预期响应：**

```json
{"ok": false, "error": "Unsupported file format"}
```

插件通过内置的 Magic bytes 字典检测文件真实格式，不依赖扩展名，也不依赖任何第三方库（如 `python-magic`）。

### 3.3 SVG XSS 防护

准备一个含恶意脚本的 SVG：

```xml
<svg xmlns="http://www.w3.org/2000/svg">
  <script>alert('xss')</script>
  <rect width="100" height="100" fill="red" onclick="alert('click')"/>
</svg>
```

上传后检查存储的 SVG 文件，确认 `<script>` 标签、`onclick` 属性和 `javascript:` 协议已被移除。

```bash
cat ~/.qwenpaw/plugins/agent-avatar-pro/data/test-agent/avatar.svg
# 不应包含 <script>、onclick、javascript:
```

### 3.4 URL 协议白名单

尝试设置非 HTTPS URL：

```bash
curl -X POST http://localhost:8088/api/avatar-pro/test/url \
  -H "Content-Type: application/json" \
  -d '{"url": "http://evil.com/avatar.png"}'
```

**预期响应：**

```json
{"ok": false, "error": "Only HTTPS URLs are allowed"}
```

---

## 四、格式兼容性测试

### 4.1 测试矩阵

| 格式 | 测试文件 | 验证点 |
|------|---------|--------|
| PNG | 标准 PNG 图片 | format 返回 `png`，base64 数据可渲染 |
| APNG | 含 acTL chunk 的 PNG | format 返回 `apng`，浏览器中动画播放 |
| JPEG | 标准 JPG 图片 | format 返回 `jpg`，图片正常显示 |
| GIF | 动画 GIF | format 返回 `gif`，动画播放 |
| WebP | 动态 WebP | format 返回 `webp`，图片/动画正常 |
| SVG | 矢量图形 | format 返回 `svg`，缩放无锯齿 |
| Lottie | .json 动画文件 | format 返回 `json`，文件正确保存 |

### 4.2 自动化检测脚本

以下脚本通过 HTTP API 测试所有格式。端口号请根据实际情况修改 `API` 变量。

```python
import httpx, json

API = "http://localhost:8088/api/avatar-pro"
TEST_FILES = {
    "png":  "samples/test.png",
    "jpg":  "samples/test.jpg",
    "gif":  "samples/test.gif",
    "webp": "samples/test.webp",
    "svg":  "samples/test.svg",
    "json": "samples/test.json",
}

results = []
for fmt, path in TEST_FILES.items():
    agent_id = f"test-{fmt}"
    with open(path, "rb") as f:
        data = f.read()

    # Upload
    r = httpx.post(f"{API}/{agent_id}/upload", content=data, timeout=30)
    upload_ok = r.json().get("ok")
    detected_fmt = r.json().get("format", "?")

    # Retrieve
    r2 = httpx.get(f"{API}/{agent_id}").json()
    get_ok = r2.get("ok")
    has_data = bool(r2.get("data"))

    results.append({
        "input": fmt,
        "upload_ok": upload_ok,
        "detected": detected_fmt,
        "get_ok": get_ok,
        "has_data": has_data,
    })

    # Cleanup
    httpx.delete(f"{API}/{agent_id}")

# Report
for r in results:
    status = "PASS" if all(r[k] for k in ["upload_ok", "get_ok", "has_data"]) else "FAIL"
    print(f"  {status}  {r['input']:>5} -> detected={r['detected']}")
```

---

## 五、前端组件测试

### 5.1 管理面板渲染

启动 QwenPaw 后访问控制台，插件前端加载后应看到：

- "Agent 头像管理" 标题及副标题
- Agent 选择器（AutoComplete 组件，支持下拉选择已有 Agent 或自由输入）
- 拖拽上传区域（Upload.Dragger）
- URL 输入框 + "URL 设置" 按钮
- "支持的格式" 区域（静态 Tag 展示，无筛选按钮）
- 头像列表（antd Table，列：头像、Agent ID、格式、来源、操作）

### 5.2 上传交互

1. 在 Agent 选择器中选择或输入 Agent ID（如 `my-agent`）
2. 拖拽或选择一张 PNG 图片上传
3. 观察：上传区域显示预览缩略图，状态提示 "上传成功 — 格式: png"
4. 头像列表出现新行，显示头像预览、Agent ID、格式和来源

### 5.3 URL 头像设置

1. 在 Agent 选择器中选择或输入 Agent ID
2. 在 URL 输入框粘贴一个 HTTPS 图片链接
3. 点击 "URL 设置"
4. 头像列表出现新行，来源显示 "URL"

### 5.4 删除头像

1. 在头像列表中找到目标行
2. 点击 "删除" 按钮（带 Popconfirm 确认）
3. 该行从列表消失
4. 再次查询 API 列表确认已删除

---

## 六、聊天窗口头像测试

### 6.1 验证头像注册

1. 确保 `enable_chat_avatar` 配置为 `true`
2. 为某个 Agent 设置头像
3. 在 QwenPaw 中切换到该 Agent
4. 检查欢迎界面是否显示该 Agent 的头像和名称
5. 发送一条消息，检查 Agent 回复的气泡旁是否出现自定义头像

### 6.2 验证 Agent 切换

1. 为两个不同的 Agent 分别设置不同头像
2. 在 Agent 之间切换
3. 确认头像和名称随切换自动更新（800ms 轮询 + 并行请求，延迟约 1 秒）
4. 打开浏览器控制台，确认日志输出 `[agent-avatar-pro] Agent changed: xxx → yyy`

### 6.3 验证无头像 Agent

1. 切换到一个未设置自定义头像的 Agent
2. 确认聊天窗口保持 QwenPaw 默认外观，不会被覆盖为灰色或空白
3. 控制台应输出 `[agent-avatar-pro] Agent "xxx" has no custom avatar, keeping default`

---

## 七、卸载测试

### 7.1 正常卸载

```bash
qwenpaw plugin uninstall agent-avatar-pro
```

确认日志中出现：

```
[agent-avatar-pro] Uninstalled: agent-avatar-pro, delete_files=True
```

### 7.2 数据清理验证

卸载后检查数据目录：

```bash
ls ~/.qwenpaw/plugins/agent-avatar-pro/data/
```

如果 `delete_files=True`，该目录应已被删除。

---

## 八、Agent 工具测试

在 QwenPaw 对话中让 Agent 使用注册的工具。

**注意：** 工具函数运行在 QwenPaw 同一进程中，直接调用 `AvatarService` 的方法（不通过 HTTP），因此不受端口配置影响，也不存在网络延迟。

### 8.1 查询头像状态

对话内容：
> "帮我查看一下所有 Agent 的头像配置状态"

Agent 应调用 `get_agent_avatar_status` 工具并返回格式化列表。

### 8.2 设置头像

对话内容：
> "帮 test-agent 设置这个头像：https://example.com/cat.png"

Agent 应调用 `set_agent_avatar` 工具，传入 agent_id 和 URL。

### 8.3 文件路径设置头像

对话内容：
> "用 C:\Users\sky21\Pictures\avatar.png 给 my-agent 设置头像"

Agent 应调用 `set_agent_avatar` 工具，传入 agent_id 和本地文件路径。工具函数会读取文件并直接传递给 `AvatarService.upload_avatar()`。

---

## 九、已知限制与 TODO

| 项目 | 当前状态 | 说明 |
|------|---------|------|
| Lottie 渲染 | 待集成 | 前端目前以 `<img>` 展示 JSON 缩略图，完整动画渲染需引入 lottie-react |
| react-easy-crop | 待集成 | 上传组件已预留接口，裁剪预览功能待后续实现 |
| 缩略图 API | 部分实现 | `size=thumb` 参数已定义，前端传递但 Pillow 缩略图生成仅对静态图片生效 |
| 多浏览器测试 | 待补充 | 已在 Chrome 120+ 验证，Firefox/Safari 待测试 |
