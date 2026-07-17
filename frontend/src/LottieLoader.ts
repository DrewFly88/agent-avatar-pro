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
 * 查询当前加载状态（不触发加载）。
 * @returns true 如果 window.lottie 已存在
 */
export function isLottieLoaded(): boolean {
  return !!(window as any).lottie;
}
