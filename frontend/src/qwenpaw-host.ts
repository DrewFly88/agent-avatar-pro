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
 */

import type * as ReactNS from "react";

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
const ReactStub = {
  createElement: (() => null) as typeof ReactNS.createElement,
  useRef: (() => ({ current: null })) as typeof ReactNS.useRef,
  useState: (() => [null, () => {}]) as typeof ReactNS.useState,
  useEffect: (() => {}) as typeof ReactNS.useEffect,
  useCallback: ((fn: any) => fn) as typeof ReactNS.useCallback,
  useMemo: ((fn: any) => fn()) as typeof ReactNS.useMemo,
};

export const React: typeof ReactNS = host.React ?? (ReactStub as unknown as typeof ReactNS);

// ── antd: 宿主未注入时空对象（组件解构时返回 undefined，渲染安全） ─
export const antd = host.antd ?? {};
