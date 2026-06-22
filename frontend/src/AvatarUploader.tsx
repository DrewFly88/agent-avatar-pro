/**
 * AvatarUploader — 头像上传组件
 *
 * 使用 antd Upload / Input / Button 组件，从 window.QwenPaw.host 获取。
 */

import type * as ReactNS from "react";

const host = window.QwenPaw?.host ?? {} as any;
const React: typeof ReactNS = host.React ?? { createElement: () => null, useState: (() => [null, () => {}]) as any, useEffect: () => {}, useCallback: ((fn: any) => fn) as any };
const antd = host.antd ?? {};
const { Upload, Input, Button, Space, message } = antd as any;

import type { AvatarUploaderProps, AvatarUploadResponse } from './types';
import { uploadAvatar, setAvatarUrl } from './api';

const ACCEPT_DEFAULT = '.png,.jpg,.jpeg,.gif,.webp,.svg,.apng,.json';

export default function AvatarUploader({
  agentId,
  maxSizeMB = 5,
  acceptedFormats = ACCEPT_DEFAULT,
  onUploaded,
  onError,
}: AvatarUploaderProps) {
  const [preview, setPreview] = React.useState<string | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const [urlInput, setUrlInput] = React.useState('');

  const handleFile = React.useCallback(
    async (file: File) => {
      const maxBytes = maxSizeMB * 1024 * 1024;
      if (file.size > maxBytes) {
        const msg = `文件超过 ${maxSizeMB}MB 限制`;
        message.error(msg);
        onError?.(msg);
        return false;
      }

      // 本地预览
      if (file.type.startsWith('image/') || file.name.endsWith('.json')) {
        const reader = new FileReader();
        reader.onload = (e) => setPreview(e.target?.result as string);
        reader.readAsDataURL(file);
      }

      setUploading(true);
      try {
        const result: AvatarUploadResponse = await uploadAvatar(agentId, file);
        if (result.ok) {
          message.success(`上传成功 — 格式: ${result.format}`);
          onUploaded?.(result);
        } else {
          message.error(`上传失败: ${result.error}`);
          onError?.(result.error || 'Unknown');
        }
      } catch (err: any) {
        message.error(`网络错误: ${err.message}`);
        onError?.(err.message);
      } finally {
        setUploading(false);
      }
      return false; // 阻止 antd Upload 默认行为
    },
    [agentId, maxSizeMB, onUploaded, onError]
  );

  const handleUrlSubmit = React.useCallback(async () => {
    if (!urlInput.trim()) return;
    setUploading(true);
    try {
      const result = await setAvatarUrl(agentId, urlInput.trim());
      if (result.ok) {
        message.success('URL 头像设置成功');
        setUrlInput('');
        setPreview(urlInput.trim());
        onUploaded?.({ ok: true, agent_id: agentId, format: 'url', size: 0 } as any);
      } else {
        message.error(`设置失败: ${result.error}`);
        onError?.(result.error || 'Unknown');
      }
    } catch (err: any) {
      message.error(`网络错误: ${err.message}`);
    } finally {
      setUploading(false);
    }
  }, [agentId, urlInput, onUploaded, onError]);

  return React.createElement(Space, {
    direction: "vertical",
    size: "middle",
    style: { width: '100%' },
  },
    // 拖拽上传区域
    React.createElement(Upload.Dragger, {
      accept: acceptedFormats,
      showUploadList: false,
      beforeUpload: handleFile,
      disabled: uploading || !agentId,
    },
      preview
        ? React.createElement("img", {
            src: preview,
            alt: "预览",
            style: {
              width: 80,
              height: 80,
              borderRadius: '50%',
              objectFit: 'cover' as const,
              margin: '0 auto 12px',
              display: 'block',
              border: '3px solid #e8eaf6',
            },
          })
        : React.createElement("p", {
            style: { fontSize: 40, color: '#5c6bc0', marginBottom: 8 },
          }, "+"),
      React.createElement("p", null, "拖拽文件到此处，或点击选择"),
      React.createElement("p", { style: { color: '#999', fontSize: 12 } },
        "支持 PNG / APNG / JPEG / GIF / WebP / SVG / Lottie · 最大 " + maxSizeMB + "MB"
      ),
    ),
    // URL 输入
    React.createElement(Space.Compact, { style: { width: '100%' } },
      React.createElement(Input, {
        value: urlInput,
        onChange: (e: any) => setUrlInput(e.target.value),
        placeholder: "https://example.com/avatar.png",
        disabled: uploading || !agentId,
      }),
      React.createElement(Button, {
        type: "primary",
        onClick: handleUrlSubmit,
        loading: uploading,
        disabled: !urlInput.trim() || !agentId,
      }, "URL 设置"),
    ),
  );
}
