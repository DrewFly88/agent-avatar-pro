// Ambient declarations for the QwenPaw console host API.
//
// The QwenPaw console injects a shared `window.QwenPaw` object at
// runtime; we externalize `react`/`react-dom`/`antd` (see vite.config.ts)
// and pull them off `host` instead of bundling.
//
// 基于 QwenPaw 官方文档 (plugins.zh.md) 编写。

import type * as ReactNS from "react";

declare global {
  // ── Host SDK ──────────────────────────────────────────────────
  interface QwenPawHost {
    React: typeof ReactNS;
    ReactDOM: any;
    antd: any;
    antdIcons: any;
    apiBaseUrl: string;
    getApiUrl: (path: string) => string;
    getApiToken: () => string | null;
    /** 认证代理请求：自动注入 Authorization 和 X-Agent-Id 请求头 */
    fetch: (path: string, init?: RequestInit) => Promise<Response>;
    /** React Hook: 获取当前主题 */
    useTheme: () => "light" | "dark";
    /** React Hook: 获取当前语言 */
    useLocale: () => string;
    /** React Hook: 获取当前选中的 Agent */
    useSelectedAgent: () => { id: string };
    /** React Hook: 获取当前会话 */
    useCurrentSession: () => { id: string } | null;
    /** 命令式获取：当前选中的 Agent ID */
    getSelectedAgentId: () => string;
    /** 命令式获取：当前会话 ID */
    getCurrentSessionId: () => string | null;
  }

  // ── Disposable 模式 ──────────────────────────────────────────
  interface Disposable {
    dispose: () => void;
  }

  // ── Route API ─────────────────────────────────────────────────
  interface QwenPawRouteApi {
    add: (pluginId: string, route: {
      id: string;
      path: string;
      component: ReactNS.ComponentType<any>;
    }) => Disposable;
    replace: (pluginId: string, targetId: string, component: ReactNS.ComponentType<any>) => Disposable;
    wrap: (pluginId: string, targetId: string, wrapper: (Inner: ReactNS.ComponentType) => ReactNS.ComponentType) => Disposable;
    remove: (targetId: string) => void;
  }

  // ── Menu API ──────────────────────────────────────────────────
  interface QwenPawMenuItem {
    id: string;
    label: string | (() => ReactNS.ReactNode);
    icon?: any;
    route?: string;
    parentId?: string;
    location?: "primary.agentScoped" | "primary.settings" | "userMenu";
    before?: string;
    after?: string;
    order?: number;
    visible?: () => boolean;
    isGroup?: boolean;
    divider?: boolean;
  }

  interface QwenPawMenuApi {
    add: (pluginId: string, item: QwenPawMenuItem | QwenPawMenuItem[]) => Disposable;
    replace: (pluginId: string, targetId: string, item: QwenPawMenuItem) => Disposable;
    remove: (targetId: string) => void;
    snapshot: (location?: string) => QwenPawMenuItem[];
  }

  // ── Chat API ──────────────────────────────────────────────────
  interface QwenPawChatResponseApi {
    set: (pluginId: string, opts: { avatar?: string; nick?: string }) => Disposable;
    append: (pluginId: string, render: (props: { data: any; isLast: boolean }) => any, opts?: any) => Disposable;
    prepend: (pluginId: string, render: (props: { data: any }) => any, opts?: any) => Disposable;
    render: (pluginId: string, render: (props: { data: any; fallback: () => any }) => any, opts?: any) => Disposable;
  }

  interface QwenPawChatWelcomeApi {
    set: (pluginId: string, opts: {
      avatar?: string;
      nick?: string;
      greeting?: string | ((locale: string) => string);
      description?: string;
      prompts?: { label: string; value: string }[];
    }) => Disposable;
    render: (pluginId: string, component: ReactNS.ComponentType<any>) => Disposable;
  }

  interface QwenPawChatApi {
    response: QwenPawChatResponseApi;
    welcome: QwenPawChatWelcomeApi;
    theme: { set: (pluginId: string, opts: { colorPrimary: string }) => Disposable };
    sender: {
      set: (pluginId: string, opts: { placeholder?: string; disclaimer?: string }) => Disposable;
      addSuggestion: (pluginId: string, opts: { id: string; items: { label: string; value: string }[] }) => Disposable;
    };
    actions: { add: (pluginId: string, action: { id: string; icon: any; onClick: (ctx: { data: any }) => void }) => Disposable };
    requestActions: { add: (pluginId: string, action: { id: string; icon: any; onClick: (ctx: { data: any }) => void }) => Disposable };
    requestPayload: { add: (pluginId: string, transform: (ctx: { payload: any; sessionId: string; selectedAgent: string }) => any, opts?: { id?: string; order?: number }) => Disposable };
    leftHeader: { set: (pluginId: string, opts: { title?: string; logo?: any }) => Disposable };
    rightHeader: { add: (pluginId: string, element: any, opts?: { id?: string; order?: number }) => Disposable };
    card: { add: (pluginId: string, card: any) => Disposable };
    toolRender: { add: (pluginId: string, render: any) => Disposable };
  }

  // ── Slot API ──────────────────────────────────────────────────
  interface QwenPawSlotApi {
    fill: (pluginId: string, name: string, render: any, opts?: any) => Disposable;
    replace: (pluginId: string, name: string, render: any, opts?: any) => Disposable;
    snapshot: () => any[];
  }

  // ── Global ────────────────────────────────────────────────────
  interface QwenPawGlobal {
    host: QwenPawHost;
    route: QwenPawRouteApi;
    menu: QwenPawMenuApi;
    chat: QwenPawChatApi;
    slot: QwenPawSlotApi;
    audit: any;
  }

  interface Window {
    QwenPaw: QwenPawGlobal;
  }
}

export {};
