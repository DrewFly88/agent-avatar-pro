## Lottie JSON 动画渲染实现方案

### 1. 现状分析

#### 1.1 当前数据流

```
用户上传 .json 文件
    → 后端 Magic bytes 检测为 "json"（Lottie）
    → 存储为 data/{agent_id}/avatar.json + meta.json (format: "json")
    → 前端 AvatarUploader 跳过裁剪（shouldSkipCrop → true）
    → onUploaded 回调触发表格刷新
```

#### 1.2 当前渲染路径（失败）

`AvatarRenderer` 通过 `fetchAvatar(agentId)` 获取 JSON 数据，拿到 `data.data`（base64 编码的 JSON 文件内容）后构造：

```typescript
imgSrc = `data:application/json;base64,${data.data}`;
```

然后传给 `<img src={imgSrc}>`。浏览器无法将 `application/json` MIME 类型渲染为图片，因此 Lottie 头像在管理面板表格中显示为空白或加载失败图标。

#### 1.3 聊天窗口路径（同样失败）

`ChatAvatar.tsx` 通过 `checkAvatar()` 检测到 `has_avatar: true, format: "json"` 后，构造 `/image` 端点 URL 传给 `chat.response.set({ avatar: url })`。但 `/image` 端点对 Lottie 文件返回 `Content-Type: application/json` 的 JSON 原始数据，浏览器 `<img>` 标签同样无法渲染。

#### 1.4 核心矛盾

Lottie JSON 不是图片格式，而是**动画描述数据**——包含矢量形状图层、关键帧时间线、缓动函数、变换矩阵等结构化信息。它需要一个渲染引擎将 JSON 解析为可视化的 SVG 或 Canvas 动画帧。这与 PNG/GIF/SVG 等浏览器原生可渲染的格式有本质区别。

---

### 2. 技术约束

#### 2.1 QwenPaw 插件环境限制

| 约束 | 影响 |
|------|------|
| 不能 `import` 第三方库（问题 23） | 不能 `import lottie from 'lottie-web'`，Vite external 会保留裸导入导致运行时崩溃 |
| React/antd 来自 `window.QwenPaw.host` | 所有组件必须用 `host.React.createElement`，不能用 JSX |
| Bundle 体积敏感 | lottie-web min.js 约 250KB（gzip ~65KB），直接打包会使 bundle 从 41KB 膨胀到 ~290KB |
| `chat.response.set()` 的 avatar 只接受 URL 字符串 | 聊天窗口无法直接播放 DOM 动画 |
| QwenPaw Desktop 存在 HTTP 缓存问题 | `/image` 端点可能被缓存，需要额外处理 |

#### 2.2 Lottie JSON 格式特征

Lottie 文件结构（简化）：

```json
{
  "v": "5.7.4",          // Lottie 版本
  "fr": 30,              // 帧率
  "ip": 0,               // 起始帧
  "op": 60,              // 结束帧
  "w": 512,              // 画布宽度
  "h": 512,              // 画布高度
  "layers": [            // 图层数组
    {
      "ty": 4,           // 图层类型（4=形状图层）
      "ks": { ... },     // 变换属性（位置、缩放、旋转、透明度）
      "shapes": [ ... ]  // 矢量形状数据
    }
  ]
}
```

文件大小通常在 5KB ~ 500KB 之间，复杂动画可能更大。

---

### 3. 架构设计

整体分为 5 个模块，按职责分层：

```
┌─────────────────────────────────────────────────────────┐
│                    消费层（Consumers）                    │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ AvatarManager │  │ AvatarUploader│  │  ChatAvatar   │  │
│  │   (表格渲染)   │  │  (预览渲染)   │  │ (聊天气泡)    │  │
│  └──────┬───────┘  └──────┬───────┘  └───────┬───────┘  │
│         │                 │                   │          │
│  ┌──────▼─────────────────▼───────────────────▼───────┐  │
│  │              AvatarRenderer (路由层)                 │  │
│  │   format=json → LottieRenderer                      │  │
│  │   format=其他  → <img> 原始路径                      │  │
│  └──────────────────────┬─────────────────────────────┘  │
│                         │                                │
│  ┌──────────────────────▼─────────────────────────────┐  │
│  │              LottieRenderer (渲染层)                 │  │
│  │   lottie-web CDN 动态加载 + loadAnimation()         │  │
│  └──────────────────────┬─────────────────────────────┘  │
│                         │                                │
│  ┌──────────────────────▼─────────────────────────────┐  │
│  │              LottieLoader (加载层)                   │  │
│  │   <script> 注入 CDN → window.lottie 全局可用         │  │
│  └──────────────────────┬─────────────────────────────┘  │
│                         │                                │
│  ┌──────────────────────▼─────────────────────────────┐  │
│  │              后端 /image 端点 (适配层)                │  │
│  │   Lottie → 预渲染 PNG 静态封面 / 原始 JSON 数据      │  │
│  └────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

---

### 4. 模块详细设计

#### 4.1 LottieLoader — 动态加载器

**文件：** `frontend/src/LottieLoader.ts`（新建）

**职责：** 在运行时从 CDN 加载 lottie-web 库，暴露全局 Promise 供渲染组件等待。

**核心设计：**

```typescript
// 全局单例 Promise，确保多次调用只加载一次
let loadPromise: Promise<any> | null = null;

// CDN 地址（cdnjs 全球 CDN，稳定性高）
const CDN_URL =
  "https://cdnjs.cloudflare.com/ajax/libs/lottie-web/5.12.2/lottie.min.js";

export function loadLottie(): Promise<any> {
  // 已加载：直接返回
  if ((window as any).lottie) {
    return Promise.resolve((window as any).lottie);
  }
  // 加载中：复用已有 Promise
  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = CDN_URL;
    script.async = true;
    script.onload = () => {
      if ((window as any).lottie) {
        resolve((window as any).lottie);
      } else {
        reject(new Error("lottie-web loaded but window.lottie not found"));
      }
    };
    script.onerror = () => {
      loadPromise = null; // 允许重试
      reject(new Error("Failed to load lottie-web from CDN"));
    };
    document.head.appendChild(script);
  });

  return loadPromise;
}

// 查询当前加载状态（不触发加载）
export function isLottieLoaded(): boolean {
  return !!(window as any).lottie;
}
```

**关键决策：**

- **为什么用 CDN 而非打包？** lottie-web min.js 约 250KB（gzip ~65KB），直接打包会使 bundle 从 41KB 膨胀到 ~290KB，且大部分用户可能不使用 Lottie 头像。CDN 按需加载只在首次渲染 Lottie 头像时产生网络请求，且 CDN 有跨站点缓存优势。
- **为什么不用 `host.fetch()` 加载脚本？** `host.fetch()` 返回 Response 对象，适合数据请求。脚本注入需要 `<script>` 标签让浏览器执行代码，这是不同的机制。
- **CDN 不可用时的降级：** 如果 CDN 加载失败（离线环境、网络限制），`loadPromise` 重置为 null 允许下次重试。渲染组件在加载失败时回退到静态封面图。
- **版本锁定：** CDN URL 包含精确版本号 `5.12.2`，避免自动升级引入不兼容变更。

**Bundle 影响：** 加载器代码本身约 0.5KB，lottie-web 本体（~250KB）从 CDN 加载不计入 bundle。

---

#### 4.2 LottieRenderer — 动画渲染组件

**文件：** `frontend/src/LottieRenderer.tsx`（新建）

**职责：** 接收 Lottie JSON 数据，使用 lottie-web 在指定 DOM 容器中渲染 SVG 动画。

**核心设计：**

```typescript
import { loadLottie } from './LottieLoader';

// 组件状态
type LottieState = 'loading-lib' | 'rendering' | 'error' | 'fallback';

function LottieRenderer({ animationData, size, shape, fallback }) {
  const containerRef = React.useRef(null);
  const animRef = React.useRef(null);
  const [state, setState] = React.useState('loading-lib');

  React.useEffect(() => {
    if (!containerRef.current || !animationData) return;
    let cancelled = false;
    let animInstance = null;

    loadLottie()
      .then((lottie) => {
        if (cancelled || !containerRef.current) return;
        // 清空容器（可能上次渲染残留）
        containerRef.current.innerHTML = '';

        animInstance = lottie.loadAnimation({
          container: containerRef.current,
          renderer: 'svg',         // SVG 渲染：矢量无损，适合任意尺寸
          loop: true,
          autoplay: true,
          animationData: animationData,
          rendererSettings: {
            preserveAspectRatio: 'xMidYMid slice', // 居中裁剪填充
          },
        });

        animRef.current = animInstance;
        if (!cancelled) setState('rendering');
      })
      .catch(() => {
        if (!cancelled) setState('error');
      });

    return () => {
      cancelled = true;
      if (animInstance) {
        animInstance.destroy();
        animInstance = null;
      }
      animRef.current = null;
    };
  }, [animationData]);

  const borderRadius = shape === 'circle' ? '50%' : '8px';

  // 加载 lottie-web 库中 / 出错时：显示回退
  if (state === 'loading-lib' || state === 'error') {
    return React.createElement('div', {
      style: { width: size, height: size, borderRadius, /* ... */ },
    }, fallback || React.createElement(FallbackIcon, { size }));
  }

  // 动画渲染容器
  return React.createElement('div', {
    ref: containerRef,
    style: {
      width: size,
      height: size,
      borderRadius,
      overflow: 'hidden',
      display: 'block',
    },
  });
}
```

**关键设计点：**

- **SVG 渲染模式：** lottie-web 支持 SVG / Canvas / HTML 三种渲染模式。SVG 模式输出矢量图形，在任意尺寸下都清晰锐利，最适合头像这种需要缩放的场景。Canvas 模式性能更好但缩放会模糊。
- **`preserveAspectRatio: 'xMidYMid slice'`：** 等效于 CSS 的 `object-fit: cover`——保持宽高比居中裁剪填充容器，确保动画在圆形/圆角容器中不变形。
- **`loop: true, autoplay: true`：** 头像动画应持续循环播放，无需用户交互。
- **`anim.destroy()` 清理：** 组件卸载或 `animationData` 变化时必须调用 `destroy()` 释放 SVG DOM 节点和动画定时器，否则会造成内存泄漏。
- **`cancelled` 标志：** 防止异步加载 lottie-web 期间组件已卸载或 `animationData` 已变更时仍操作旧容器。

---

#### 4.3 AvatarRenderer 分支改造

**文件：** `frontend/src/AvatarRenderer.tsx`（修改）

**当前逻辑：**

```
fetchAvatar(agentId)
  → data.type === 'url'  → imgSrc = data.url
  → data.type === 'file' → imgSrc = data:mime;base64,data.data
  → 兜底                  → imgSrc = getAvatarImageUrl(agentId)
  → 全部传给 <img src={imgSrc}>
```

**改造后逻辑：**

```
fetchAvatar(agentId)
  → data.format === 'json' && data.type === 'file'
      → 解析 base64 → JSON.parse → 存入 lottieData 状态
      → 渲染 <LottieRenderer animationData={lottieData} />
  → data.format === 'json' && data.type === 'url'
      → Lottie URL 头像：无法直接渲染远程 JSON 动画
      → 回退到静态封面图或 FallbackIcon
  → 其他格式
      → 保持原有 <img> 路径不变
```

**代码改动范围：**

```typescript
// 新增状态
const [lottieData, setLottieData] = React.useState(null);

// fetchAvatar 回调中新增分支
if (data.ok) {
  setFormat(data.format);
  if (data.format === 'json' && data.type === 'file' && data.data) {
    // Lottie：base64 → JSON 对象
    try {
      const jsonStr = atob(data.data);
      setLottieData(JSON.parse(jsonStr));
    } catch {
      setLottieData(null);
    }
    setImgSrc(null); // 不走 <img> 路径
  } else if (data.type === 'url' && data.url) {
    setImgSrc(data.url);
  } else if (data.type === 'file' && data.data && data.mime) {
    setImgSrc(`data:${data.mime};base64,${data.data}`);
  } else {
    setImgSrc(getAvatarImageUrl(agentId));
  }
}

// render 中新增分支
if (format === 'json' && lottieData) {
  return React.createElement(LottieRenderer, {
    animationData: lottieData,
    size,
    shape,
    fallback: fallback || React.createElement(FallbackIcon, { size }),
  });
}
// 其他格式保持原有 <img> 渲染
```

**注意事项：**

- `atob()` 在浏览器环境中解码 base64 为 ASCII 字符串，Lottie JSON 是纯 ASCII 文本，安全可用。
- `JSON.parse()` 对畸形 JSON 会抛异常，需要 try-catch 包裹。
- `lottieData` 为 null 时（加载失败或 URL 类型 Lottie），回退到 `FallbackIcon`。

---

#### 4.4 后端 /image 端点 Lottie 适配

**文件：** `avatar_service.py`、`plugin.py`（修改）

**当前问题：** `/image` 端点对 Lottie 文件返回 `Content-Type: application/json` 的原始 JSON 数据。浏览器 `<img>` 标签无法渲染 JSON，导致聊天窗口和所有使用 `/image` URL 的场景都失败。

**方案：后端预渲染静态封面图**

为 Lottie 头像额外生成一张静态 PNG 封面图，`/image` 端点对 Lottie 格式返回这张 PNG 而非 JSON 原始数据。

**avatar_service.py 改动：**

```python
# upload_avatar() 中，保存 Lottie 文件后额外生成封面
if fmt == "json":
    await self._generate_lottie_poster(agent_dir, file_data)

async def _generate_lottie_poster(self, agent_dir: Path, json_data: bytes):
    """从 Lottie JSON 中提取元数据，生成静态封面 PNG。

    策略：读取 JSON 的 w/h 尺寸，生成同尺寸的纯色占位 PNG。
    后续可升级为使用 cairosvg 或 Pillow 绘制首帧静态图。
    """
    try:
        meta = json.loads(json_data)
        w = meta.get("w", DEFAULT_AVATAR_PX)
        h = meta.get("h", DEFAULT_AVATAR_PX)
        # 生成与 Lottie 画布同尺寸的占位 PNG
        if Image:
            img = Image.new("RGBA", (w, h), (92, 107, 192, 255))  # 品牌色占位
            img.save(agent_dir / "poster.png", "PNG")
    except Exception:
        pass

# get_avatar_image() 中，Lottie 格式返回 poster.png
async def get_avatar_image(self, agent_id, size="full"):
    # ...
    if meta.get("format") == "json":
        poster = agent_dir / "poster.png"
        if poster.exists():
            return poster.read_bytes(), "image/png"
        return None  # 无封面，回退
    # ... 其他格式正常返回原始文件
```

**设计考量：**

- **为什么不在后端做完整的 Lottie 渲染？** Lottie 的完整渲染需要 JavaScript 运行时（V8/Node.js）来执行 lottie-web 的动画计算。Python 后端没有等效的渲染引擎。可选的 Python Lottie 库（如 `lottie`）可以解析 JSON 并导出静态帧，但依赖较重且安装复杂。
- **poster.png 的演进路径：** 初始版本使用纯色占位图。后续可引入 Python `lottie` 包解析 JSON 并渲染首帧为 PNG，提供更精确的视觉预览。但这属于增强功能，不影响核心架构。
- **存储开销：** poster.png 是一张 PNG 图片（通常 1-10KB），存储开销可忽略。

---

#### 4.5 聊天窗口 Lottie 适配

**文件：** `frontend/src/ChatAvatar.tsx`（修改）

**核心挑战：** `chat.response.set()` 的 `avatar` 字段只接受 URL 字符串（决策 9），无法传入 DOM 元素或动画对象。Lottie 动画需要在 DOM 中由 lottie-web 渲染，与聊天 API 的 URL-only 设计存在根本矛盾。

**可选方案对比：**

| 方案 | 实现方式 | 动画效果 | 复杂度 | 可行性 |
|------|---------|---------|--------|--------|
| A. 静态封面图 | `/image` 端点返回 poster.png | 无动画（静态） | 低 | 高 |
| B. Canvas 逐帧导出 | lottie-web Canvas 渲染 → canvas.toDataURL() → 定时更新 chat.response.set() | 有动画（低帧率） | 高 | 中 |
| C. 后端预渲染 GIF | Python lottie 库渲染为 GIF → `/image` 返回 GIF | 有动画（完整帧） | 中 | 中 |
| D. 接受限制，静态展示 | 聊天窗口不播放 Lottie 动画，仅管理面板播放 | 无动画 | 低 | 高 |

**推荐方案：A + D 组合（静态封面 + 管理面板动画）**

这是最务实的选择。聊天窗口显示 Lottie 的静态封面图（poster.png），管理面板表格中播放完整动画。理由如下：

1. **聊天气泡头像尺寸很小**（通常 32-40px），动画细节几乎不可见，静态图已足够辨识。
2. **性能影响可控**：不需要在聊天窗口维持 lottie-web 实例和动画循环。
3. **实现简单可靠**：只需后端 `/image` 端点对 Lottie 返回 poster.png，前端 `ChatAvatar.tsx` 无需修改（它已经使用 `/image` URL）。
4. **用户体验合理**：管理面板（用户主动设置的场景）播放动画，聊天窗口（被动观看的场景）显示静态图，符合"动画是增强而非必需"的定位。

**方案 B 的详细分析（作为未来增强参考）：**

如果后续需要在聊天窗口播放动画，技术路径如下：

```typescript
// 1. 加载 lottie-web 并创建 Canvas 渲染器
const lottie = await loadLottie();
const canvas = document.createElement("canvas");
canvas.width = 128; canvas.height = 128;

const anim = lottie.loadAnimation({
  container: canvas,
  renderer: "canvas",
  animationData: jsonData,
  loop: true, autoplay: true,
});

// 2. 定时导出 Canvas 帧为 blob URL
const intervalId = setInterval(() => {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    // 3. 更新聊天头像（频繁调用 chat.response.set）
    chat.response.set(PLUGIN_ID, { avatar: url, nick: agentName });
    // 4. 释放上一个 blob URL
    URL.revokeObjectURL(previousUrl);
    previousUrl = url;
  }, "image/png");
}, 100); // ~10fps

// 5. Agent 切换或组件卸载时清理
clearInterval(intervalId);
anim.destroy();
```

**方案 B 的风险：**

- `chat.response.set()` 每 100ms 调用一次，QwenPaw 前端是否能承受这种频率的 Disposable 创建/销毁未经验证。
- `canvas.toBlob()` 是异步操作，10fps 的导出速率可能导致 blob 堆积。
- `URL.createObjectURL()` 频繁创建和释放 blob URL 可能造成内存碎片。
- 如果 QwenPaw 前端对 `avatar` URL 有缓存或懒加载机制，频繁更换 URL 可能导致旧头像残留。

---

### 5. AvatarUploader 预览适配

**文件：** `frontend/src/AvatarUploader.tsx`（修改）

当前上传 Lottie 后，预览区域通过 `fetchAvatar()` 获取 base64 数据。需要增加 Lottie 分支，使用 `LottieRenderer` 替代 `<img>` 显示当前头像预览。

改动与 AvatarRenderer 类似：检测 `format === "json"` 时解析 JSON 数据，渲染 `LottieRenderer` 组件。

```typescript
// 当前头像预览区域（currentAvatar?.hasAvatar 分支）
if (currentAvatar.format === "json" && lottiePreviewData) {
  // Lottie 动画预览
  React.createElement(LottieRenderer, {
    animationData: lottiePreviewData,
    size: 40,
    shape: "circle",
  });
} else {
  // 其他格式保持 <img> 预览
  React.createElement("img", { src: currentAvatar.imgSrc, ... });
}
```

---

### 6. 文件变更清单

| 文件 | 操作 | 改动量（估） | 说明 |
|------|------|------------|------|
| `frontend/src/LottieLoader.ts` | 新建 | ~40 行 | CDN 动态加载器 |
| `frontend/src/LottieRenderer.tsx` | 新建 | ~80 行 | Lottie 动画渲染组件 |
| `frontend/src/AvatarRenderer.tsx` | 修改 | ~30 行 | 新增 Lottie 分支 |
| `frontend/src/AvatarUploader.tsx` | 修改 | ~25 行 | 预览区域 Lottie 适配 |
| `avatar_service.py` | 修改 | ~30 行 | Lottie poster.png 生成 |
| `plugin.py` | 修改 | ~10 行 | `/image` 端点 Lottie 分支 |
| `frontend/src/ChatAvatar.tsx` | 无改动 | 0 | 静态封面方案无需修改 |
| `frontend/src/api.ts` | 无改动 | 0 | 现有 API 已满足需求 |
| `frontend/src/types.ts` | 无改动 | 0 | 现有类型已覆盖 |

**Bundle 体积影响：** 新增代码约 150 行，预估 bundle 增加 ~3KB（LottieLoader + LottieRenderer + 分支逻辑），总计约 44KB。lottie-web 本体（~250KB）从 CDN 按需加载，不计入 bundle。

---

### 7. 数据流总览

```
                    ┌──────────────────────────────────────┐
                    │         管理面板（Management）         │
                    │                                      │
                    │  ┌──────────────────────────────┐    │
                    │  │ AvatarRenderer                │    │
                    │  │                               │    │
                    │  │ fetchAvatar(agentId)          │    │
                    │  │   ↓                           │    │
                    │  │ format === "json"?            │    │
                    │  │   ├─ YES → base64→JSON.parse  │    │
                    │  │   │        → LottieRenderer   │    │
                    │  │   │        → lottie-web CDN   │    │
                    │  │   │        → SVG 动画         │    │
                    │  │   └─ NO  → <img> 原始路径     │    │
                    │  └──────────────────────────────┘    │
                    └──────────────────────────────────────┘

                    ┌──────────────────────────────────────┐
                    │         聊天窗口（Chat）              │
                    │                                      │
                    │  ChatAvatar.updateChatAvatar()        │
                    │    → checkAvatar() → has_avatar       │
                    │    → getImageUrl(agentId)             │
                    │    → /image 端点                      │
                    │    → Lottie? 返回 poster.png          │
                    │    → chat.response.set({avatar: url}) │
                    │    → 静态展示（无需 lottie-web）       │
                    └──────────────────────────────────────┘

                    ┌──────────────────────────────────────┐
                    │         后端（Backend）               │
                    │                                      │
                    │  upload_avatar(format=json):          │
                    │    → 保存 avatar.json                 │
                    │    → 生成 poster.png（占位/首帧）      │
                    │                                      │
                    │  GET /{agent_id}/image:               │
                    │    → format=json → 返回 poster.png    │
                    │    → format=其他 → 返回原始文件        │
                    └──────────────────────────────────────┘
```

---

### 8. 实施计划

#### Phase A：管理面板 Lottie 渲染（核心功能）

1. 新建 `LottieLoader.ts`，实现 CDN 动态加载器
2. 新建 `LottieRenderer.tsx`，实现 SVG 动画渲染组件
3. 修改 `AvatarRenderer.tsx`，新增 `format === "json"` 分支
4. 构建验证 + 实际 Lottie 文件测试

#### Phase B：后端 Lottie 封面生成

5. 修改 `avatar_service.py`，上传 Lottie 时生成 `poster.png`
6. 修改 `plugin.py`，`/image` 端点对 Lottie 返回 `poster.png`
7. 后端测试：验证 `/image` 端点返回正确的 PNG 字节流

#### Phase C：上传预览适配

8. 修改 `AvatarUploader.tsx`，预览区域支持 Lottie 动画
9. 端到端测试：上传 → 预览动画 → 表格动画 → 聊天静态封面

#### Phase D（可选增强）：聊天窗口动画

10. 验证 `chat.response.set()` 对 blob URL 的支持情况
11. 如支持：实现 Canvas 逐帧导出方案
12. 如不支持：维持静态封面方案，记录为已知限制

---

### 9. 风险与降级策略

| 风险 | 概率 | 影响 | 降级策略 |
|------|------|------|---------|
| CDN 不可用（离线/防火墙） | 低 | 管理面板 Lottie 不显示 | 回退到 poster.png 静态图或 FallbackIcon |
| Lottie JSON 文件过大（>1MB） | 低 | base64 解码/JSON 解析慢 | 后端上传时限制 Lottie 文件大小（当前已有 5MB 总限制） |
| lottie-web 版本不兼容某些 Lottie 文件 | 中 | 部分动画渲染异常 | lottie-web 5.x 兼容性广泛，异常时回退静态图 |
| 畸形 Lottie JSON | 低 | JSON.parse 抛异常 | try-catch 包裹，回退 FallbackIcon |
| QwenPaw Desktop HTTP 缓存 poster.png | 中 | 更换 Lottie 后聊天窗口显示旧封面 | poster.png URL 添加 `?t=timestamp` cache-busting |

---

### 10. 测试要点

1. **上传测试：** 上传不同复杂度的 Lottie JSON 文件（简单形状、复杂角色动画、含文本图层的动画），验证存储和渲染
2. **渲染测试：** 验证管理面板表格中 Lottie 动画正确播放（循环、自动播放、正确尺寸）
3. **切换测试：** 在多个 Agent 间切换，验证 LottieRenderer 正确销毁/重建，无内存泄漏
4. **降级测试：** 断网后刷新管理面板，验证 CDN 不可用时回退到静态图
5. **覆盖测试：** 对已有 Lottie 头像的 Agent 上传新 Lottie / PNG / URL，验证 poster.png 正确更新
6. **聊天测试：** 验证 Lottie Agent 在聊天窗口显示静态封面图（非空白、非 JSON 文本）
7. **性能测试：** 同时渲染多个 Lottie 头像（表格中多行），观察 CPU/内存占用
