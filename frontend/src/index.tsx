/**
 * Agent Avatar Pro — 前端入口
 *
 * 使用 QwenPaw 官方前端插件 API 注册路由、菜单和聊天定制。
 *
 * 关键安全约束：
 * QwenPaw 在启动期间同步加载所有插件的前端 bundle。此文件的求值
 * 绝对不能抛出未捕获异常，否则会中断插件加载循环，导致本插件及
 * 后续插件无法加载，甚至 QwenPaw 自身的"插件管理"页面崩溃。
 */

import AvatarManager from './AvatarManager';
import { startAvatarMonitor } from './ChatAvatar';

// ── 组件导出 ────────────────────────────────────────────────────
export { default as AvatarRenderer } from './AvatarRenderer';
export { default as AvatarUploader } from './AvatarUploader';
export { default as AvatarManager } from './AvatarManager';
export { startAvatarMonitor, stopAvatarMonitor, refreshCurrentAvatar } from './ChatAvatar';

// ── 类型导出 ────────────────────────────────────────────────────
export type {
  AvatarMeta,
  AvatarSource,
  AvatarFormat,
  AvatarShape,
  AvatarRendererProps,
  AvatarUploaderProps,
  AvatarManagerProps,
  FormatInfo,
} from './types';

// ── 插件注册 ────────────────────────────────────────────────────
const PLUGIN_ID = "agent-avatar-pro";
const ROUTE_ID = "agent-avatar-pro.manager";

class AgentAvatarProPlugin {
  readonly id = PLUGIN_ID;
  private disposables: { dispose: () => void }[] = [];

  setup(): void {
    const qwpaw = window.QwenPaw;
    if (!qwpaw) {
      console.warn("[agent-avatar-pro] window.QwenPaw not available, deferring setup");
      return;
    }

    // 注册页面路由（官方 API: route.add）
    try {
      if (qwpaw.route?.add) {
        const d = qwpaw.route.add(this.id, {
          id: ROUTE_ID,
          path: "/plugin/agent-avatar-pro/manager",
          component: AvatarManager,
        });
        this.disposables.push(d);
      } else {
        console.warn("[agent-avatar-pro] route.add not available");
      }
    } catch (e) {
      console.error("[agent-avatar-pro] Failed to register route:", e);
    }

    // 注册侧边栏菜单入口（官方 API: menu.add）
    try {
      if (qwpaw.menu?.add) {
        const d = qwpaw.menu.add(this.id, {
          id: ROUTE_ID,
          label: "Agent 头像管理",
          icon: "\uD83D\uDDBC",
          route: ROUTE_ID,
        });
        this.disposables.push(d);
      }
    } catch (e) {
      console.error("[agent-avatar-pro] Failed to register menu:", e);
    }

    // 启动聊天头像监控：轮询检测当前 Agent，动态设置聊天头像
    try {
      startAvatarMonitor();
    } catch (e) {
      console.warn("[agent-avatar-pro] Chat avatar monitor failed to start:", e);
    }
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
  }
}

// 安全执行：try-catch 包裹，确保 bundle 求值不会抛出未捕获异常
try {
  const instance = new AgentAvatarProPlugin();
  instance.setup();
} catch (e) {
  console.error("[agent-avatar-pro] Plugin setup failed:", e);
}
