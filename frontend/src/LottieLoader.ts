/**
 * LottieLoader — lottie-web CDN 动态加载器
 *
 * 在运行时从 CDN 按需加载 lottie-web 库，暴露全局 Promise 供渲染组件等待。
 * 多次调用只加载一次，加载失败时重置 Promise 允许重试。
 *
 * 设计考量：
 * - lottie-web min.js 约 250KB（gzip ~65KB），直接打包会使 bundle 从 45KB 膨胀到 ~290KB
 * - 大部分用户可能不使用 Lottie 头像，CDN 按需加载更经济
 * - CDN 有跨站点缓存优势，已加载过 lottie-web 的站点可直接命中浏览器缓存
 */

// CDN 地址（cdnjs 全球 CDN，稳定性高，版本锁定 5.12.2）
const CDN_URL =
  "https://cdnjs.cloudflare.com/ajax/libs/lottie-web/5.12.2/lottie.min.js";

// 全局单例 Promise，确保多次调用只加载一次
let loadPromise: Promise<any> | null = null;

/**
 * 动态加载 lottie-web 库。
 *
 * @returns Promise<lottie> — 解析为 lottie-web 库对象
 *
 * 行为：
 * - 已加载（window.lottie 存在）：直接返回
 * - 加载中（loadPromise 存在）：复用已有 Promise
 * - 首次加载：创建 <script> 标签注入 CDN
 * - 加载失败：重置 loadPromise 为 null 允许下次重试
 */
export function loadLottie(): Promise<any> {
  // 已加载：直接返回
  const w = window as any;
  if (w.lottie) {
    return Promise.resolve(w.lottie);
  }
  // 加载中：复用已有 Promise
  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = CDN_URL;
    script.async = true;
    script.onload = () => {
      if (w.lottie) {
        resolve(w.lottie);
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

/**
 * 将 base64 编码的 Lottie JSON 解码为 JS 对象。
 * atob() 解码 base64 为 ASCII 字符串（Lottie JSON 是纯 ASCII 文本，安全可用）。
 * 失败时返回 null，由调用方回退到 FallbackIcon 或 poster.png。
 *
 * 用于替代 AvatarRenderer/Uploader/ChatAvatar 中各自的重复实现。
 */
export function decodeLottieData(b64: string): unknown | null {
  try {
    const jsonStr = atob(b64);
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}

/**
 * 查询当前加载状态（不触发加载）。
 * @returns true 如果 window.lottie 已存在
 */
export function isLottieLoaded(): boolean {
  return !!(window as any).lottie;
}

/**
 * 从远程 URL fetch Lottie JSON 并解析为 JS 对象。
 *
 * 用于 URL 类型 Lottie 头像（如 https://lottie.host/xxx/anim.json），
 * 让前端直接渲染远程 JSON 动画，无需后端代理下载。
 *
 * 行为：
 * - fetch 失败（网络/CORS/404）→ 返回 null，由调用方降级到后端 poster.png
 * - 响应非 JSON / JSON.parse 失败 → 返回 null
 * - 成功 → 返回解析后的 JS 对象
 *
 * CORS 考量：lottie.host 等 CDN 通常含 `Access-Control-Allow-Origin: *` 响应头，
 * 若 CORS 拒绝则 fetch 抛异常被 catch 捕获，降级到 poster.png URL 静态封面。
 *
 * @param url Lottie JSON 的 HTTPS URL
 * @returns 解析后的 JS 对象，或 null（失败时）
 */
export async function fetchLottieUrlData(url: string): Promise<unknown | null> {
  try {
    const resp = await fetch(url, { mode: "cors" });
    if (!resp.ok) return null;
    // Content-Type 校验（宽松：部分 CDN 返回 text/plain 而非 application/json）
    const ct = resp.headers.get("content-type") || "";
    if (!ct.includes("json") && !ct.includes("text")) return null;
    return await resp.json();
  } catch {
    // 网络错误 / CORS 拒绝 / JSON 解析失败
    return null;
  }
}
