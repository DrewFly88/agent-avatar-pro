/**
 * Agent Avatar Pro — API 层
 *
 * 使用 window.QwenPaw.host.fetch() 进行认证代理请求，
 * 自动注入 Authorization 和 X-Agent-Id 请求头。
 *
 * 包含指数退避重试机制，应对后端服务启动期间的 503 响应。
 */

import type {
  AvatarListResponse,
  AvatarDataResponse,
  AvatarUploadResponse,
  ApiResponse,
  FormatsResponse,
  QwenPawAgentListResponse,
} from './types';

// ── Host fetch 封装 ──────────────────────────────────────────────

function hostFetch(path: string, init?: RequestInit): Promise<Response> {
  const host = window.QwenPaw?.host;
  if (host?.fetch) {
    return host.fetch(path, init);
  }
  // Fallback: 直接使用原生 fetch + 手动认证头
  const headers: Record<string, string> = {};
  const token = host?.getApiToken?.();
  if (token) headers.Authorization = `Bearer ${token}`;
  const url = host?.getApiUrl
    ? host.getApiUrl(path)
    : `/api${path}`;
  return fetch(url, { ...init, headers: { ...headers, ...(init?.headers as Record<string, string>) } });
}

// ── 带重试的 fetch 封装 ──────────────────────────────────────────

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 带指数退避重试的 fetch 封装。
 *
 * 当后端返回 503（服务未就绪）或 500 时自动重试，
 * 最多重试 MAX_RETRIES 次，间隔 1s → 2s → 4s。
 */
async function fetchWithRetry(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await hostFetch(path, init);

      // 可重试状态码：503（服务未就绪）或 500（内部错误）
      if ((res.status === 503 || res.status === 500) && attempt < MAX_RETRIES) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt);
        await sleep(delay);
        continue;
      }

      // 非 2xx 响应：解析错误信息并抛出
      if (!res.ok) {
        let errorMsg = `HTTP ${res.status}`;
        try {
          const body = await res.json();
          if (body?.error) errorMsg = body.error;
        } catch {
          // 响应体非 JSON，使用默认错误信息
        }
        throw new Error(errorMsg);
      }

      return res;
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      if (attempt < MAX_RETRIES) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt);
        await sleep(delay);
        continue;
      }
    }
  }

  throw lastError || new Error('Request failed after retries');
}

// ── QwenPaw Agent 列表（原生端点） ─────────────────────────────

export async function fetchAgents(): Promise<QwenPawAgentListResponse> {
  const res = await fetchWithRetry('/agents');
  return res.json();
}

// ── 头像列表 ────────────────────────────────────────────────────

export async function fetchAvatarList(): Promise<AvatarListResponse> {
  const res = await fetchWithRetry('/avatar-pro/list');
  return res.json();
}

// ── 获取单个头像 ────────────────────────────────────────────────

export async function fetchAvatar(
  agentId: string,
  size: 'full' | 'thumb' = 'full'
): Promise<AvatarDataResponse> {
  const res = await fetchWithRetry(`/avatar-pro/${agentId}?size=${size}`);
  return res.json();
}

// ── 检查 Agent 是否有头像 ──────────────────────────────────────

export async function checkAvatar(agentId: string): Promise<{
  ok: boolean;
  has_avatar: boolean;
  type?: string;
  url?: string;
  format?: string;
}> {
  try {
    const res = await hostFetch(`/avatar-pro/${agentId}/check`);
    if (!res.ok) return { ok: false, has_avatar: false };
    return res.json();
  } catch {
    return { ok: false, has_avatar: false };
  }
}

// ── 上传头像文件 ────────────────────────────────────────────────

export async function uploadAvatar(
  agentId: string,
  file: File
): Promise<AvatarUploadResponse> {
  const res = await fetchWithRetry(`/avatar-pro/${agentId}/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: file,
  });
  return res.json();
}

// ── 设置 URL 头像 ───────────────────────────────────────────────

export async function setAvatarUrl(
  agentId: string,
  url: string
): Promise<ApiResponse> {
  const res = await fetchWithRetry(`/avatar-pro/${agentId}/url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  return res.json();
}

// ── 删除头像 ────────────────────────────────────────────────────

export async function deleteAvatar(agentId: string): Promise<ApiResponse> {
  const res = await fetchWithRetry(`/avatar-pro/${agentId}`, {
    method: 'DELETE',
  });
  return res.json();
}

// ── 获取支持的格式列表 ─────────────────────────────────────────

export async function fetchSupportedFormats(): Promise<FormatsResponse> {
  const res = await fetchWithRetry('/avatar-pro/formats');
  return res.json();
}

// ── 头像图片 URL（用于 <img src>，管理页面表格展示用） ─────────

export function getAvatarImageUrl(agentId: string, bust = true): string {
  const host = window.QwenPaw?.host;
  const base = host?.getApiUrl
    ? host.getApiUrl(`/avatar-pro/${agentId}`)
    : `/api/avatar-pro/${agentId}`;
  return bust ? `${base}?t=${Date.now()}` : base;
}
