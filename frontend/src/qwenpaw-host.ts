/**
 * qwenpaw-host — QwenPaw 宿主 SDK 运行时访问单点
 *
 * 集中导出 host / React / antd，替代各组件中复制的
 *   const host = window.QwenPaw?.host ?? ({} as any);
 *   const React = host.React ?? { createElement: () => null, useState: ... };
 *   const antd = host.antd ?? {};
 * 模式。fallback 提供完整的 createElement + 所有 hook 集合，
 * 确保 bundle 求值期宿主未注入时不抛异常。
 *
 * 类型声明见 qwenpaw-host.d.ts（ambient），本文件仅做运行时访问。
 * 由于 tsconfig 的 include glob 不含 .d.ts（修复 vite 索引时遗漏），
 * 在此运行时模块中追加 declare global 扩展 Window.QwenPaw，
 * 让所有文件的 window.QwenPaw 访问通过类型检查。
 */

import type * as ReactNS from "react";

// ── ambient 扩展：让 window.QwenPaw 类型可识别 ──────────────────
// QwenPawGlobal 形状见 qwenpaw-host.d.ts，这里用 any 兜底避免重复维护。
declare global {
  interface Window {
    QwenPaw?: {
      host?: {
        React?: typeof ReactNS;
        antd?: any;
        getApiUrl?: (path: string) => string;
        getApiToken?: () => string | null;
        fetch?: (path: string, init?: RequestInit) => Promise<Response>;
        [key: string]: any;
      };
      chat?: any;
      route?: any;
      menu?: any;
      slot?: any;
      [key: string]: any;
    };
  }
}

// ── host: 优先取 window.QwenPaw.host，缺失时空对象兜底 ───────────
export const host = (window.QwenPaw?.host ?? {}) as {
  React?: typeof ReactNS;
  antd?: any;
  getApiUrl?: (path: string) => string;
  getApiToken?: () => string | null;
  fetch?: (path: string, init?: RequestInit) => Promise<Response>;
  [key: string]: any;
};

// ── React: 宿主未注入时提供无副作用 stub（bundle 求值安全） ──────
// stub 只覆盖本项目用到的 API：createElement + 6 个 hook。
// 真宿主注入后 host.React 覆盖 stub。
// 用 unknown 中转避免 () => null 与 React.createElement 重载签名不兼容。
const ReactStub: unknown = {
  createElement: (() => null) as any,
  useRef: (() => ({ current: null })) as any,
  useState: (() => [null, () => {}]) as any,
  useEffect: (() => {}) as any,
  useCallback: ((fn: any) => fn) as any,
  useMemo: ((fn: any) => fn()) as any,
};

export const React: typeof ReactNS = host.React ?? (ReactStub as unknown as typeof ReactNS);

// ── antd: 宿主未注入时空对象（组件解构时返回 undefined，渲染安全） ─
export const antd = host.antd ?? {};
