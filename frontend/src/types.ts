/**
 * Agent Avatar Pro — TypeScript 类型定义
 */

// ── 头像元数据 ──────────────────────────────────────────────────

export type AvatarSource = 'upload' | 'url';

export type AvatarFormat = 'png' | 'apng' | 'jpg' | 'jpeg' | 'gif' | 'webp' | 'svg' | 'json';

export interface AvatarMeta {
  agent_id: string;
  format: AvatarFormat | string;
  source: AvatarSource;
  uploaded_at: number;
  filename?: string;
  url?: string;
  size_bytes?: number;
}

// ── API 响应 ────────────────────────────────────────────────────

export interface ApiResponse<T = unknown> {
  ok: boolean;
  error?: string;
}

export interface AvatarListResponse extends ApiResponse {
  count: number;
  avatars: AvatarMeta[];
}

export interface AvatarDataResponse extends ApiResponse {
  type: 'file' | 'url';
  format: string;
  mime?: string;
  data?: string;    // base64
  url?: string;
}

export interface AvatarUploadResponse extends ApiResponse {
  agent_id: string;
  format: string;
  size: number;
}

export interface FormatInfo {
  ext: string;
  label: string;
  animated: boolean;
}

export interface FormatsResponse {
  formats: FormatInfo[];
}

// ── QwenPaw Agent 信息 ──────────────────────────────────────────

export interface AgentInfo {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
}

export interface QwenPawAgentListResponse {
  agents: AgentInfo[];
}

// ── 组件 Props ──────────────────────────────────────────────────

export type AvatarShape = 'circle' | 'rounded';

export interface AvatarRendererProps {
  agentId: string;
  size?: number;
  shape?: AvatarShape;
  animated?: boolean;
  fallback?: React.ReactNode;
  className?: string;
}

export interface AvatarUploaderProps {
  agentId: string;
  maxSizeMB?: number;
  acceptedFormats?: string;
  onUploaded?: (result: AvatarUploadResponse) => void;
  onError?: (error: string) => void;
}

export interface AvatarManagerProps {
  className?: string;
}
