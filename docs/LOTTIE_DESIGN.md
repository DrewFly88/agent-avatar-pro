# Lottie JSON 动画渲染实现方案（v2.0）

## 1. 方案演进背景

本插件最初基于 QwenPaw v1.x 设计 Lottie 渲染方案。v2.0 引入了重大变化的 Host SDK，特别是 `chat.welcome.set()` / `chat.response.set()` 的 `avatar` 字段类型从仅接受 URL 字符串升级为 `Localized<string | React.ReactNode>`（`console/src/plugins/registry/types.ts:252`）。

这意味着 Lottie 动画**可以直接在聊天气泡中播放**，无需降级为静态封面——旧方案的核心前提已过时。

## 2. v1.x vs v2.0 对比

| 维度 | v1.x 旧方案 | v2.0 新方案 |
|------|------------|------------|
| 聊天窗口 Lottie | 静态 `poster.png`（放弃动画） | `LottieRenderer` ReactNode 直接传入 `chat.welcome.set({avatar: <ReactNode>})` |
| `avatar` 字段类型 | 仅 URL 字符串 | `Localized<string \| React.ReactNode>` |
| 后端 `/image` 对 Lottie | 返回 `poster.png` | 同左（保留作为 CDN 不可用时的回退） |
| 管理面板渲染 | lottie-web CDN + SVG | 同左（无变化） |

## 3. 核心源码依据

| 文件 | 行 | 关键事实 |
|------|----|---------|
| `console/src/plugins/registry/types.ts` | 252 | `welcome.avatar?: Localized<string \| React.ReactNode>` 类型层面允许 ReactNode |
| `console/src/plugins/hostSdk/install.ts` | 79-164 | `QwenPawChatNamespace` 完整签名，`welcome.set(partial)` 中 `avatar` 字段透传 ReactNode |
| `console/src/plugins/registry/chatExtensions.ts` | — | scalar 字段使用 LIFO stack，`setScalar` 写入后 ChatPage 通过 `useSyncExternalStore` 响应式 re-render |
| `console/package.json` | 47 | React 18；无 lottie-web 依赖，需插件自行加载 |

## 4. 架构总览

```
                ┌─ 管理面板（AvatarRenderer/Uploader）
                │   └ LottieRenderer（lottie-web CDN，SVG 动画）
  Lottie JSON ──┤
                │   
                └─ 聊天窗口（ChatAvatar）
                    └ chat.welcome.set({ avatar: <LottieNode/> })
                       传入 ReactNode 而非 URL，宿主直接渲染动画
                       （CDN 不可用时自动回退到 poster.png URL）
```

## 5. 模块详细设计

### 5.1 LottieLoader — 动态加载器

**文件：** `frontend/src/LottieLoader.ts`

**职责：** 在运行时从 CDN 加载 lottie-web 库，暴露全局 Promise 供渲染组件等待。

**核心设计：**

```typescript
// 全局单例 Promise，确保多次调用只加载一次
let loadPromise: Promise<any> | null = null;

// CDN 地址（cdnjs 全球 CDN，稳定性高，版本锁定 5.12.2）
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
        loadPromise = null; // 允许重试
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
```

**关键决策：**

- **为什么用 CDN 而非打包？** lottie-web min.js 约 250KB（gzip ~65KB），直接打包会使 bundle 从 45KB 膨胀到 ~290KB，且大部分用户可能不使用 Lottie 头像。CDN 按需加载只在首次渲染 Lottie 头像时产生网络请求，且 CDN 有跨站点缓存优势。
- **为什么不用 `host.fetch()` 加载脚本？** `host.fetch()` 返回 Response 对象，适合数据请求。脚本注入需要 `<script>` 标签让浏览器执行代码，这是不同的机制。
- **CDN 不可用时的降级：** 如果 CDN 加载失败（离线环境、网络限制），`loadPromise` 重置为 null 允许下次重试。渲染组件在加载失败时回退到静态封面图。
- **版本锁定：** CDN URL 包含精确版本号 `5.12.2`，避免自动升级引入不兼容变更。

**Bundle 影响：** 加载器代码本身约 0.5KB，lottie-web 本体（~250KB）从 CDN 加载不计入 bundle。

### 5.2 LottieRenderer — 动画渲染组件

**文件：** `frontend/src/LottieRenderer.tsx`

**职责：** 接收 Lottie JSON 数据，使用 lottie-web 在指定 DOM 容器中渲染 SVG 动画。

**核心设计：**

```typescript
export default function LottieRenderer({
  animationData,
  size,
  shape = "circle",
  fallback,
  className,
}: LottieRendererProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const animRef = React.useRef<any>(null);
  const [state, setState] = React.useState<LottieState>("loading-lib");

  React.useEffect(() => {
    if (!containerRef.current || !animationData) return;
    let cancelled = false;
    let animInstance: any = null;

    setState("loading-lib");

    loadLottie()
      .then((lottie: any) => {
        if (cancelled || !containerRef.current) return;
        // 清空容器（可能上次渲染残留）
        containerRef.current.innerHTML = "";

        animInstance = lottie.loadAnimation({
          container: containerRef.current,
          renderer: "svg",         // SVG 渲染：矢量无损，适合任意尺寸
          loop: true,
          autoplay: true,
          animationData: animationData,
          rendererSettings: {
            preserveAspectRatio: "xMidYMid slice", // 居中裁剪填充
          },
        });

        animRef.current = animInstance;
        if (!cancelled) setState("rendering");
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });

    return () => {
      cancelled = true;
      if (animInstance) {
        try {
          animInstance.destroy();
        } catch {
          // 忽略 destroy 异常
        }
        animInstance = null;
      }
      animRef.current = null;
    };
  }, [animationData]);

  // ... render 逻辑
}
```

**关键设计点：**

- **SVG 渲染模式：** lottie-web 支持 SVG / Canvas / HTML 三种渲染模式。SVG 模式输出矢量图形，在任意尺寸下都清晰锐利，最适合头像这种需要缩放的场景。Canvas 模式性能更好但缩放会模糊。
- **`preserveAspectRatio: 'xMidYMid slice'`：** 等效于 CSS 的 `object-fit: cover`——保持宽高比居中裁剪填充容器，确保动画在圆形/圆角容器中不变形。
- **`loop: true, autoplay: true`：** 头像动画应持续循环播放，无需用户交互。
- **`anim.destroy()` 清理：** 组件卸载或 `animationData` 变化时必须调用 `destroy()` 释放 SVG DOM 节点和动画定时器，否则会造成内存泄漏。
- **`cancelled` 标志：** 防止异步加载 lottie-web 期间组件已卸载或 `animationData` 已变更时仍操作旧容器。

### 5.3 AvatarRenderer 分支改造

**文件：** `frontend/src/AvatarRenderer.tsx`（修改）

**改造后逻辑：**

```
fetchAvatar(agentId)
  → data.format === 'json' && data.type === 'file' && data.data
      → atob(data.data) → JSON.parse → 存入 lottieData 状态
      → 渲染 <LottieRenderer animationData={lottieData} />
  → data.format === 'json' && data.type === 'url'
      → Lottie URL 头像：无法直接渲染远程 JSON 动画
      → 回退到 /image 端点（后端返回 poster.png）
  → 其他格式
      → 保持原有 <img> 路径不变
```

**新增状态：**

```typescript
const [lottieData, setLottieData] = React.useState<unknown | null>(null);
```

**新增 helper：**

```typescript
function decodeLottieData(b64: string): unknown | null {
  try {
    const jsonStr = atob(b64);
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}
```

**注意事项：**

- `atob()` 在浏览器环境中解码 base64 为 ASCII 字符串，Lottie JSON 是纯 ASCII 文本，安全可用。
- `JSON.parse()` 对畸形 JSON 会抛异常，需要 try-catch 包裹。
- `lottieData` 为 null 时（加载失败或 URL 类型 Lottie），回退到 `FallbackIcon` 或 `/image` 端点。

### 5.4 AvatarUploader 预览适配

**文件：** `frontend/src/AvatarUploader.tsx`（修改）

当前上传 Lottie 后，预览区域通过 `fetchAvatar()` 获取 base64 数据。需要增加 Lottie 分支，使用 `LottieRenderer` 替代 `<img>` 显示当前头像预览。

改动与 AvatarRenderer 类似：检测 `format === "json"` 时解析 JSON 数据，渲染 `LottieRenderer` 组件。

```typescript
// Lottie 预览分支
currentAvatar.format === "json" && currentAvatar.lottieData
  ? React.createElement(LottieRenderer, {
      animationData: currentAvatar.lottieData,
      size: 40,
      shape: "circle",
      fallback: React.createElement("div", {
        style: { width: 40, height: 40, borderRadius: "50%", background: "#e8eaf6" },
      }),
    })
  : React.createElement("img", { ... }),
```

### 5.5 后端 poster.png 生成 + /image 适配

**文件：** `avatar_service.py`（修改）

**当前问题：** `/image` 端点对 Lottie 文件返回 `Content-Type: application/json` 的原始 JSON 数据。浏览器 `<img>` 标签无法渲染 JSON，导致聊天窗口和所有使用 `/image` URL 的场景都失败。

**方案：后端预渲染静态封面图**

为 Lottie 头像额外生成一张静态 PNG 封面图，`/image` 端点对 Lottie 格式返回这张 PNG 而非 JSON 原始数据。

**avatar_service.py 改动：**

```python
# upload_avatar() 中，保存 Lottie 文件后额外生成封面
if fmt == "json":
    self._generate_lottie_poster(agent_dir, file_data)

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

# get_avatar_image() 中，Lottie 格式返回 poster.png
if meta.get("format") == "json":
    poster_path = agent_dir / "poster.png"
    if poster_path.exists():
        return poster_path.read_bytes(), "image/png"
    return None
```

**设计考量：**

- **为什么不在后端做完整的 Lottie 渲染？** Lottie 的完整渲染需要 JavaScript 运行时（V8/Node.js）来执行 lottie-web 的动画计算。Python 后端没有等效的渲染引擎。可选的 Python Lottie 库（如 `lottie`）可以解析 JSON 并导出静态帧，但依赖较重且安装复杂。
- **poster.png 的演进路径：** 初始版本使用纯色占位图。后续可引入 Python `lottie` 包解析 JSON 并渲染首帧为 PNG，提供更精确的视觉预览。但这属于增强功能，不影响核心架构。
- **存储开销：** poster.png 是一张 PNG 图片（通常 1-10KB），存储开销可忽略。

### 5.6 聊天窗口 Lottie 动画渲染

**文件：** `frontend/src/ChatAvatar.tsx`（修改）

**核心突破：** v2.0 的 `chat.welcome.set()` / `chat.response.set()` 的 `avatar` 字段接受 `React.ReactNode`，可以直接传入 `<LottieRenderer>` 组件实例。

**updateChatAvatar() 改造：**

```typescript
async function updateChatAvatar(agentId: string): Promise<void> {
  // ... 初始化
  
  const [check, agentName] = await Promise.all([
    checkAvatar(agentId),
    getAgentName(agentId),
  ]);

  let avatarUrl: string | undefined;
  let lottieData: unknown | null = null;

  if (check.ok && check.has_avatar) {
    if (check.type === "url" && check.url) {
      avatarUrl = check.url;
    } else {
      // 文件类型头像：通过 fetchAvatar 获取 base64 数据
      try {
        const data = await fetchAvatar(agentId);
        if (data.ok && data.format === "json" && data.data) {
          lottieData = decodeLottieData(data.data);
          if (!lottieData) {
            // 解析失败：回退到 /image 端点（后端返回 poster.png）
            avatarUrl = getImageUrl(agentId);
          }
        } else {
          avatarUrl = getImageUrl(agentId);
        }
      } catch {
        // fetchAvatar 失败：回退到 /image 端点
        avatarUrl = getImageUrl(agentId);
      }
    }
  }

  // 构造传入 chat.welcome.set / chat.response.set 的参数
  // v2.0 welcome.avatar 接受 Localized<string | React.ReactNode>，
  // Lottie 格式传入 LottieRenderer ReactNode，其他格式传入 URL 字符串。
  const params: Record<string, any> = { nick: agentName };
  if (lottieData) {
    // Lottie 动画：传入 ReactNode，由宿主渲染
    params.avatar = React.createElement(LottieRenderer, {
      animationData: lottieData,
      size: 32, // 聊天气泡头像尺寸（通常 32-40px）
      shape: "circle",
      fallback: React.createElement("div", {
        style: { width: 32, height: 32, borderRadius: "50%", background: "#5c6bc0" },
      }),
    });
    avatarLoaded = true;
  } else if (avatarUrl) {
    params.avatar = avatarUrl;
    avatarLoaded = true;
  }

  // ... chat.welcome.set / chat.response.set 调用
}
```

**关键设计点：**

- **LottieRenderer ReactNode 作为 avatar：** v2.0 类型签名允许，宿主 `WelcomeCard` / `ResponseCard` 通过 `useSyncExternalStore` 响应式读取并渲染 ReactNode。
- **CDN 不可用时的自动降级：** `LottieRenderer` 内部 `loadLottie()` 失败时回退到 `fallback` div。但更优雅的降级是在 `updateChatAvatar` 中检测 `isLottieLoaded()`，若未加载则使用 `poster.png` URL。
- **聊天气泡头像尺寸：** 通常 32-40px。`size: 32` 是保守选择，宿主可能会按容器尺寸缩放 ReactNode。

**关键待验证假设：**

**核心假设：v2.0 的 `welcome.avatar`/`response.avatar` 字段接受 ReactNode 并在宿主组件中正确渲染。**

类型签名已确认允许 ReactNode（`types.ts:252`）。但运行时行为（宿主 `WelcomeCard`/`ResponseCard` 是否调用 `React.createElement` 渲染该 node，而非强制 `typeof === 'string'` 才显示）需要通过实际安装插件并观察聊天窗口来验证。

若验证失败，方案自动降级为旧版 Phase B（后端 `poster.png` 静态封面 + `/image` URL），不影响其他 Phase。

## 6. 文件变更清单

| 文件 | 操作 | 改动量（估） | 说明 |
|------|------|------------|------|
| `frontend/src/LottieLoader.ts` | 新建 | ~68 行 | CDN 动态加载器 |
| `frontend/src/LottieRenderer.tsx` | 新建 | ~134 行 | Lottie 动画渲染组件 |
| `frontend/src/AvatarRenderer.tsx` | 修改 | ~30 行 | 新增 Lottie 分支 |
| `frontend/src/AvatarUploader.tsx` | 修改 | ~40 行 | 预览区域 Lottie 适配 |
| `frontend/src/ChatAvatar.tsx` | 修改 | ~50 行 | 聊天窗口传入 LottieRenderer ReactNode |
| `avatar_service.py` | 修改 | ~40 行 | Lottie poster.png 生成 + /image 适配 |
| `docs/LOTTIE_DESIGN.md` | 重写 | 全文 | 替换 v1.x 假设，记录 v2.0 ReactNode avatar 方案 |
| `docs/DEVLOG.md` | 追加 | ~30 行 | Phase 13 Lottie 渲染实现 |

**Bundle 体积影响：** 新增代码约 150 行，预估 bundle 增加 ~3KB（LottieLoader + LottieRenderer + 分支逻辑），总计约 44KB。lottie-web 本体（~250KB）从 CDN 按需加载，不计入 bundle。

## 7. 数据流总览

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
                    │    → fetchAvatar() → format=json?     │
                    │    → YES → lottieData                 │
                    │         → chat.welcome.set({          │
                    │             avatar: <LottieRenderer/>,│
                    │             nick: agentName           │
                    │           })                          │
                    │    → NO  → avatarUrl (poster.png)     │
                    │         → chat.welcome.set({          │
                    │             avatar: url,              │
                    │             nick: agentName           │
                    │           })                          │
                    └──────────────────────────────────────┘

                    ┌──────────────────────────────────────┐
                    │         后端（Backend）               │
                    │                                      │
                    │  upload_avatar(format=json):          │
                    │    → 保存 avatar.json                 │
                    │    → 生成 poster.png（品牌色占位）      │
                    │                                      │
                    │  GET /{agent_id}/image:               │
                    │    → format=json → 返回 poster.png    │
                    │    → format=其他 → 返回原始文件        │
                    └──────────────────────────────────────┘
```

## 8. 实施计划

### Phase A — lottie-web 加载器 + 渲染组件（核心功能）

1. 新建 `frontend/src/LottieLoader.ts`，实现 CDN 动态加载器
2. 新建 `frontend/src/LottieRenderer.tsx`，实现 SVG 动画渲染组件

### Phase B — AvatarRenderer/Uploader 分支

3. 修改 `frontend/src/AvatarRenderer.tsx`，新增 `format === "json"` 分支
4. 修改 `frontend/src/AvatarUploader.tsx`，预览区域支持 Lottie 动画

### Phase C — 后端 poster.png 生成 + /image 适配

5. 修改 `avatar_service.py`，`upload_avatar` 中 `fmt == "json"` 时生成 `poster.png`
6. 修改 `avatar_service.py`，`get_avatar_image` 对 Lottie 返回 `poster.png`

### Phase D — 聊天窗口动画渲染

7. 修改 `frontend/src/ChatAvatar.tsx`，`updateChatAvatar` 中检测 `format === "json"`，构造 `<LottieRenderer>` ReactNode 作为 `avatar` 字段传入 `chat.welcome.set`

### Phase E — 测试与文档

8. 运行 `tests/test_all.py`（51 项）确保后端改动无回归
9. 前端构建 `cd frontend && npm run build` 验证 bundle 无语法错误
10. 更新 `docs/LOTTIE_DESIGN.md`（本文件）：替换旧版 v1.x 假设，记录 v2.0 ReactNode avatar 方案
11. 更新 `docs/DEVLOG.md`：追加 Phase 13 Lottie 渲染实现

## 9. 风险与降级策略

| 风险 | 概率 | 影响 | 降级策略 |
|------|------|------|---------|
| CDN 不可用（离线/防火墙） | 低 | 管理面板 Lottie 不显示 | 回退到 poster.png 静态图或 FallbackIcon |
| Lottie JSON 文件过大（>1MB） | 低 | base64 解码/JSON 解析慢 | 后端上传时限制 Lottie 文件大小（当前已有 5MB 总限制） |
| lottie-web 版本不兼容某些 Lottie 文件 | 中 | 部分动画渲染异常 | lottie-web 5.x 兼容性广泛，异常时回退静态图 |
| 畸形 Lottie JSON | 低 | JSON.parse 抛异常 | try-catch 包裹，回退 FallbackIcon |
| QwenPaw Desktop HTTP 缓存 poster.png | 中 | 更换 Lottie 后聊天窗口显示旧封面 | poster.png URL 添加 `?t=timestamp` cache-busting |
| **v2.0 宿主不渲染 `avatar` ReactNode** | **低** | **聊天窗口 Lottie 动画不显示** | **回退到 `poster.png` URL 方案（后端已实现）** |

## 10. 测试要点

1. **上传测试：** 上传不同复杂度的 Lottie JSON 文件（简单形状、复杂角色动画、含文本图层的动画），验证存储和渲染
2. **渲染测试：** 验证管理面板表格中 Lottie 动画正确播放（循环、自动播放、正确尺寸）
3. **切换测试：** 在多个 Agent 间切换，验证 LottieRenderer 正确销毁/重建，无内存泄漏
4. **降级测试：** 断网后刷新管理面板，验证 CDN 不可用时回退到静态图
5. **覆盖测试：** 对已有 Lottie 头像的 Agent 上传新 Lottie / PNG / URL，验证 poster.png 正确更新
6. **聊天测试：** 验证 Lottie Agent 在聊天窗口显示动画（v2.0 ReactNode avatar 方案）
7. **性能测试：** 同时渲染多个 Lottie 头像（表格中多行），观察 CPU/内存占用
