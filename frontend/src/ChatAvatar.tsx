/**
 * ChatAvatar — 聊天头像定制（官方 API 版本 v3）
 *
 * 使用 QwenPaw 官方 chat.response.set() 和 chat.welcome.set() API
 * 为聊天气泡和欢迎界面设置当前 Agent 的自定义头像。
 *
 * v3 修复：
 * - avatar 使用图片直传端点 URL（GET /{agent_id}/image），而非 JSON API
 * - 先通过 /check 端点确认 Agent 有自定义头像，无头像时不设（保持默认）
 * - nick 使用 Agent 名称而非 ID（从 /agents 端点获取）
 *
 * 关键发现（来自官方文档 plugins.zh.md）：
 * - avatar 字段只接受 URL 字符串，不支持 base64 data URI
 * - chat.response.set() 内部复用 welcome.avatar/welcome.nick
 * - 注册立即生效，无需等待 ready 事件
 */

import { checkAvatar, fetchAgents } from './api';
import type { AgentInfo } from './types';

const PLUGIN_ID = "agent-avatar-pro";
const POLL_INTERVAL_MS = 800;

// ── 状态追踪 ────────────────────────────────────────────────────
let lastAgentId: string | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
const disposables: { dispose: () => void }[] = [];

// ── Agent 名称缓存 ──────────────────────────────────────────────
let agentNameCache: Map<string, string> = new Map();
let agentCacheLoaded = false;
let agentCacheTime = 0;
const AGENT_CACHE_TTL = 60_000; // 1 分钟

async function getAgentName(agentId: string): Promise<string> {
  // 检查缓存是否新鲜
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
  const host = window.QwenPaw?.host;
  if (host?.getApiUrl) {
    return host.getApiUrl(`/avatar-pro/${agentId}/image`);
  }
  return `/api/avatar-pro/${agentId}/image`;
}

// ── 清理所有注册 ────────────────────────────────────────────────

function clearDisposables(): void {
  disposables.forEach((d) => d.dispose());
  disposables.length = 0;
}

// ── 更新聊天头像 ────────────────────────────────────────────────

async function updateChatAvatar(agentId: string): Promise<void> {
  const qwpaw = window.QwenPaw;
  if (!qwpaw?.chat) {
    console.warn("[agent-avatar-pro] chat API not available");
    return;
  }

  // 先清理旧注册
  clearDisposables();

  // 并行请求：检查头像 + 获取 Agent 名称
  const [check, agentName] = await Promise.all([
    checkAvatar(agentId),
    getAgentName(agentId),
  ]);

  // 竞态防护：异步操作期间用户可能已切换到其他 Agent
  if (agentId !== lastAgentId) {
    console.log(`[agent-avatar-pro] Agent changed during fetch, skipping "${agentId}"`);
    return;
  }

  if (!check.ok || !check.has_avatar) {
    console.log(`[agent-avatar-pro] Agent "${agentId}" has no custom avatar, keeping default`);
    return;
  }

  // 确定头像 URL
  let avatarUrl: string;
  if (check.type === "url" && check.url) {
    // URL 类型头像：直接使用原始 URL
    avatarUrl = check.url;
  } else {
    // 文件类型头像：使用图片直传端点
    avatarUrl = getImageUrl(agentId);
  }

  console.log(`[agent-avatar-pro] Setting avatar for "${agentId}" (${agentName}): ${avatarUrl}`);

  // 设置欢迎界面的头像和昵称（chat.response.set 内部复用 welcome 字段）
  try {
    if (qwpaw.chat.welcome?.set) {
      const d = qwpaw.chat.welcome.set(PLUGIN_ID, {
        avatar: avatarUrl,
        nick: agentName,
      });
      disposables.push(d);
    }
  } catch (e) {
    console.warn("[agent-avatar-pro] chat.welcome.set failed:", e);
  }

  // 设置 AI 回复气泡的头像和昵称
  try {
    if (qwpaw.chat.response?.set) {
      const d = qwpaw.chat.response.set(PLUGIN_ID, {
        avatar: avatarUrl,
        nick: agentName,
      });
      disposables.push(d);
    }
  } catch (e) {
    console.warn("[agent-avatar-pro] chat.response.set failed:", e);
  }
}

// ── Agent 轮询监控 ──────────────────────────────────────────────

function checkAgentChange(): void {
  const host = window.QwenPaw?.host;
  if (!host) return;

  try {
    const currentAgentId = host.getSelectedAgentId?.();
    if (currentAgentId && currentAgentId !== lastAgentId) {
      console.log(`[agent-avatar-pro] Agent changed: ${lastAgentId} → ${currentAgentId}`);
      lastAgentId = currentAgentId;
      updateChatAvatar(currentAgentId);
    }
  } catch {
    // host.getSelectedAgentId() 可能抛异常，静默处理
  }
}

// ── 公开 API ────────────────────────────────────────────────────

/**
 * 启动 Agent 切换监控，定期轮询当前选中的 Agent 并更新聊天头像。
 */
export function startAvatarMonitor(): void {
  if (pollTimer) return;

  console.log("[agent-avatar-pro] Starting avatar monitor");

  // 预加载 Agent 名称缓存
  getAgentName("").catch(() => {});

  // 等宿主 API 就绪后开始首次检查
  setTimeout(checkAgentChange, 500);

  pollTimer = setInterval(checkAgentChange, POLL_INTERVAL_MS);
}

/**
 * 停止监控并清理所有注册。
 */
export function stopAvatarMonitor(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  clearDisposables();
  lastAgentId = null;
  console.log("[agent-avatar-pro] Avatar monitor stopped");
}

/**
 * 兼容旧接口：返回 cleanup 函数。
 */
export function initChatAvatarInjection(): () => void {
  startAvatarMonitor();
  return stopAvatarMonitor;
}
