/**
 * ChatAvatar — 聊天头像定制（官方 API 版本 v5.5）
 *
 * v5.5 变更（修复 route.wrap 被误销毁 + 阶梯式重试）：
 * - route.wrap disposable 从 disposables 数组分离，独立存储在
 *   _routeWrapDisposable 中，不受 clearDisposables() 影响
 *   （v5.4 中 updateChatAvatar 调用 clearDisposables 会销毁 wrapper）
 * - 单次 9s 重试改为阶梯式 3s/6s/9s 三次重试，更早命中后端就绪窗口
 * - stopAvatarMonitor() 单独清理 _routeWrapDisposable
 *
 * v5.4 变更（条件触发替代固定延迟）：
 * - 移除 5 秒 setTimeout 固定延迟，改用 route.wrap("core.chat") 检测
 *   用户何时进入聊天页面，仅在此时触发 updateChatAvatar()
 * - wrapper 无 React Hook，仅作为导航检测器，返回 Inner 组件
 * - Inner 通过 useRef 保持引用稳定，避免 React 重新挂载聊天页面
 * - 用户停留在插件管理页时零 API 请求，不干扰插件管理页
 * - 保留 9 秒重试（应对后端 503），仅在 avatarLoaded=false 时触发
 *
 * v5.3 变更（storage 事件驱动方案）：
 * - sessionStorage 事件驱动检测 Agent 切换：
 *   · 跨 tab 切换：window "storage" 事件监听 qwenpaw-agent-storage
 *   · 同 tab 切换：monkey-patch sessionStorage.setItem
 * - chat.welcome.set() 写入 welcome.avatar / welcome.nick，
 *   消息组件通过 React context store 响应式读取，所有消息自动更新
 *
 * 架构发现（来自 QwenPaw 源码分析）：
 * - chat.response.set() 与 chat.welcome.set() 写入完全相同的字段
 *   (welcome.avatar / welcome.nick)，无独立 response.avatar
 * - 头像/昵称是全局值，所有 AI 消息共享（无 per-agent / per-message 机制）
 * - Agent 状态由 zustand + persist 管理，key: "qwenpaw-agent-storage"
 */

import { checkAvatar, fetchAgents } from './api';
import type { AgentInfo } from './types';

const PLUGIN_ID = "agent-avatar-pro";
const AGENT_STORAGE_KEY = "qwenpaw-agent-storage";

// ── Host SDK 获取 ────────────────────────────────────────────────
const host = window.QwenPaw?.host ?? {} as any;
const React: any = host.React ?? { createElement: () => null, useRef: (() => ({ current: null })) as any };

// ── Agent 名称缓存 ──────────────────────────────────────────────
let agentNameCache: Map<string, string> = new Map();
let agentCacheLoaded = false;
let agentCacheTime = 0;
const AGENT_CACHE_TTL = 60_000; // 1 分钟

async function getAgentName(agentId: string): Promise<string> {
  if (agentCacheLoaded && Date.now() - agentCacheTime < AGENT_CACHE_TTL) {
    return agentNameCache.get(agentId) ?? agentId;
  }

  try {
    const resp = await fetchAgents();
    if (resp?.agents) {
      agentNameCache.clear();
      for (const agent of resp.agents as AgentInfo[]) {
        agentNameCache.set(agent.id, agent.name || agent.id);
      }
      agentCacheLoaded = true;
      agentCacheTime = Date.now();
      return agentNameCache.get(agentId) ?? agentId;
    }
  } catch {
    // 获取失败，回退到 agentId
  }
  return agentId;
}

// ── 构造图片直传 URL ────────────────────────────────────────────

function getImageUrl(agentId: string): string {
  const ts = Date.now();
  if (host?.getApiUrl) {
    return `${host.getApiUrl(`/avatar-pro/${agentId}/image`)}?t=${ts}`;
  }
  return `/api/avatar-pro/${agentId}/image?t=${ts}`;
}

// ── Disposable 追踪 ─────────────────────────────────────────────

/** chat.welcome.set / chat.response.set 的 disposable（每次 Agent 切换时清理重建） */
const disposables: { dispose: () => void }[] = [];

/**
 * route.wrap 的 disposable（独立存储，不受 clearDisposables() 影响）。
 * clearDisposables() 在每次 updateChatAvatar() 时调用，
 * 若 route.wrap 也在 disposables 中会被销毁，导致 wrapper 失效。
 */
let _routeWrapDisposable: { dispose: () => void } | null = null;

function clearDisposables(): void {
  disposables.forEach((d) => d.dispose());
  disposables.length = 0;
  // 注意：不清理 _routeWrapDisposable，它在 stopAvatarMonitor() 中单独清理
}

// ── 更新聊天头像 ────────────────────────────────────────────────

let lastAgentId: string | null = null;
let avatarLoaded = false; // 头像 URL 是否成功获取
let _avatarConfirmed = false; // 后端已确认头像状态（check.ok=true，无论有无头像）

async function updateChatAvatar(agentId: string): Promise<void> {
  const qwpaw = window.QwenPaw;
  if (!qwpaw?.chat) {
    console.warn("[agent-avatar-pro] chat API not available");
    return;
  }

  lastAgentId = agentId;
  avatarLoaded = false;
  _avatarConfirmed = false;
  clearDisposables();

  const [check, agentName] = await Promise.all([
    checkAvatar(agentId),
    getAgentName(agentId),
  ]);

  let avatarUrl: string | undefined;
  if (check.ok && check.has_avatar) {
    if (check.type === "url" && check.url) {
      avatarUrl = check.url;
    } else {
      avatarUrl = getImageUrl(agentId);
    }
  }

  // 后端已正常响应（无论有无头像），后续重试可跳过
  if (check.ok) {
    _avatarConfirmed = true;
  }

  console.log(
    `[agent-avatar-pro] Setting nick for "${agentId}" → "${agentName}", avatar: ${avatarUrl || "(none)"}, check.ok: ${check.ok}`
  );

  // chat.welcome.set() 和 chat.response.set() 写入相同的字段
  // (welcome.avatar / welcome.nick)，消息组件响应式读取，
  // 调用后所有 AI 消息自动更新头像和名称
  const params: Record<string, string> = { nick: agentName };
  if (avatarUrl) {
    params.avatar = avatarUrl;
    avatarLoaded = true; // 头像 URL 已获取，标记为成功
  }

  try {
    if (qwpaw.chat.welcome?.set) {
      const d = qwpaw.chat.welcome.set(PLUGIN_ID, params);
      disposables.push(d);
    }
  } catch (e) {
    console.warn("[agent-avatar-pro] chat.welcome.set failed:", e);
  }

  try {
    if (qwpaw.chat.response?.set) {
      const d = qwpaw.chat.response.set(PLUGIN_ID, params);
      disposables.push(d);
    }
  } catch (e) {
    console.warn("[agent-avatar-pro] chat.response.set failed:", e);
  }
}

// ── Storage 事件驱动 ────────────────────────────────────────────

/** 从 storage event 的 newValue 中提取 selectedAgent */
function extractAgentId(storageValue: string | null): string | null {
  if (!storageValue) return null;
  try {
    const parsed = JSON.parse(storageValue);
    const id = parsed?.state?.selectedAgent;
    return typeof id === "string" && id ? id : null;
  } catch {
    return null;
  }
}

/** storage 事件处理（跨 tab 切换 Agent） */
function onStorageEvent(e: StorageEvent): void {
  if (e.key !== AGENT_STORAGE_KEY) return;
  const agentId = extractAgentId(e.newValue);
  if (!agentId || agentId === lastAgentId) return;
  console.log(`[agent-avatar-pro] Agent changed (cross-tab): ${lastAgentId} → ${agentId}`);
  updateChatAvatar(agentId);
}

/** monkey-patch sessionStorage.setItem（同 tab 切换 Agent） */
let patchedSetItem = false;
let originalSetItem: typeof sessionStorage.setItem | null = null;

function patchSessionStorage(): void {
  if (patchedSetItem) return;
  try {
    originalSetItem = sessionStorage.setItem.bind(sessionStorage);
    sessionStorage.setItem = function (key: string, value: string): void {
      originalSetItem!(key, value);
      if (key === AGENT_STORAGE_KEY) {
        const agentId = extractAgentId(value);
        if (agentId && agentId !== lastAgentId) {
          console.log(`[agent-avatar-pro] Agent changed (same-tab): ${lastAgentId} → ${agentId}`);
          updateChatAvatar(agentId);
        }
      }
    };
    patchedSetItem = true;
    console.log("[agent-avatar-pro] sessionStorage.setItem patched for agent detection");
  } catch (e) {
    console.warn("[agent-avatar-pro] Failed to patch sessionStorage:", e);
  }
}

function unpatchSessionStorage(): void {
  if (patchedSetItem && originalSetItem) {
    sessionStorage.setItem = originalSetItem;
    patchedSetItem = false;
    originalSetItem = null;
  }
}

// ── route.wrap 条件触发 ──────────────────────────────────────────

/** 保持 Inner 组件引用稳定，避免 React 重新挂载聊天页面 */
let _chatInnerRef: { current: any } = { current: null };
/** 首次进入聊天页后不再重复触发 */
let _chatAvatarTriggered = false;

/**
 * 稳定的 route.wrap wrapper 组件。
 * 无 React Hook，仅作为导航检测器：首次渲染时触发 updateChatAvatar()，
 * 之后直接返回 Inner 组件，对聊天页面零侵入。
 */
function ChatRouteWrapper(): any {
  if (!_chatAvatarTriggered) {
    _chatAvatarTriggered = true;
    // setTimeout(0) 确保不在 React 渲染周期内发起异步操作
    setTimeout(() => {
      const agentId = host.getSelectedAgentId?.();
      if (agentId) {
        lastAgentId = null; // 重置以确保 updateChatAvatar 执行
        console.log(`[agent-avatar-pro] Chat page entered, loading avatar for "${agentId}"`);
        updateChatAvatar(agentId);
      }
    }, 0);
  }
  return React.createElement(_chatInnerRef.current);
}

// ── 公开 API ────────────────────────────────────────────────────

/**
 * 启动聊天头像注入：条件触发 + storage 事件驱动方案。
 *
 * 1. monkey-patch sessionStorage.setItem 检测同 tab Agent 切换
 * 2. 监听 window "storage" 事件检测跨 tab Agent 切换
 * 3. route.wrap("core.chat") 检测用户进入聊天页面时才加载头像
 *    （disposable 独立存储，不受 clearDisposables 影响）
 * 4. 阶梯式重试（3s / 6s / 9s）：应对后端启动延迟导致的 503
 *
 * 启动期间零 API 请求（进入聊天页才触发，重试最多三次额外请求）。
 */
export function startAvatarMonitor(): void {
  // 1. 同 tab 检测
  patchSessionStorage();

  // 2. 跨 tab 检测
  window.addEventListener("storage", onStorageEvent);

  // 3. route.wrap 条件触发：用户进入聊天页时才加载头像
  const qwpaw = window.QwenPaw;
  if (qwpaw?.route?.wrap) {
    try {
      _routeWrapDisposable = qwpaw.route.wrap(PLUGIN_ID, "core.chat", (Inner: any) => {
        _chatInnerRef.current = Inner;
        return ChatRouteWrapper;
      });
      console.log("[agent-avatar-pro] route.wrap(\"core.chat\") registered");
    } catch (e) {
      console.warn("[agent-avatar-pro] route.wrap failed:", e);
    }
  } else {
    console.warn("[agent-avatar-pro] route.wrap not available, falling back to 5s delay");
    // 回退：若 route.wrap 不可用，使用旧的 5 秒延迟
    const currentId = host.getSelectedAgentId?.();
    if (currentId) {
      lastAgentId = currentId;
      setTimeout(() => {
        const freshId = host.getSelectedAgentId?.();
        if (freshId) {
          lastAgentId = null;
          updateChatAvatar(freshId);
        }
      }, 5000);
    }
  }

  // 4. 阶梯式重试（3s / 6s / 9s）：首次 checkAvatar 因后端 503 失败时重试
  //    后端启动 hooks 按顺序执行，可能需 5-10 秒才能就绪
  const retryDelays = [3000, 6000, 9000];
  retryDelays.forEach((delay) => {
    setTimeout(() => {
      if (!avatarLoaded && !_avatarConfirmed) {
        const retryId = host.getSelectedAgentId?.();
        if (retryId) {
          console.log(`[agent-avatar-pro] Retrying avatar load (${delay / 1000}s, avatarLoaded=false, agent: "${retryId}")`);
          lastAgentId = null;
          updateChatAvatar(retryId);
        }
      }
    }, delay);
  });

  console.log("[agent-avatar-pro] Condition-triggered avatar monitor started");
}

/**
 * 强制刷新当前 Agent 的聊天头像（上传新头像后立即调用）。
 * 可指定 agentId 以刷新特定 Agent（管理页上传时使用）。
 */
export function refreshCurrentAvatar(agentId?: string): void {
  const targetId = agentId ?? host.getSelectedAgentId?.();
  if (!targetId) return;

  console.log(`[agent-avatar-pro] Force refresh for agent "${targetId}"`);
  lastAgentId = null; // 重置追踪，确保 updateChatAvatar 执行
  updateChatAvatar(targetId);
}

/**
 * 停止监控并清理所有注册。
 */
export function stopAvatarMonitor(): void {
  window.removeEventListener("storage", onStorageEvent);
  unpatchSessionStorage();
  clearDisposables();
  // 单独清理 route.wrap disposable（不在 clearDisposables 范围内）
  if (_routeWrapDisposable) {
    _routeWrapDisposable.dispose();
    _routeWrapDisposable = null;
  }
  console.log("[agent-avatar-pro] Avatar monitor stopped");
}

/**
 * 兼容旧接口：返回 cleanup 函数。
 */
export function initChatAvatarInjection(): () => void {
  startAvatarMonitor();
  return stopAvatarMonitor;
}
