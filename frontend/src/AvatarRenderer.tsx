/**
 * AvatarRenderer — 多格式头像渲染组件
 *
 * 使用 window.QwenPaw.host.React 而非 import React。
 */

import type * as ReactNS from "react";

const host = window.QwenPaw?.host ?? {} as any;
const React: typeof ReactNS = host.React ?? { createElement: () => null, useState: (() => [null, () => {}]) as any, useEffect: () => {} };

import type { AvatarRendererProps, AvatarDataResponse } from './types';
import { fetchAvatar, getAvatarImageUrl } from './api';
import { fetchLottieUrlData } from './LottieLoader';
import LottieRenderer from './LottieRenderer';

const DEFAULT_SIZE = 48;
const DEFAULT_SHAPE = 'circle';

/**
 * 将 base64 编码的 Lottie JSON 解码为 JS 对象。
 * atob() 解码 base64 为 ASCII 字符串（Lottie JSON 是纯 ASCII 文本，安全可用）。
 * 失败时返回 null，由调用方回退到 FallbackIcon 或 poster.png。
 */
function decodeLottieData(b64: string): unknown | null {
  try {
    const jsonStr = atob(b64);
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}

function FallbackIcon({ size }: { size: number }) {
  return React.createElement("div", {
    style: {
      width: size,
      height: size,
      borderRadius: size / 2,
      background: 'linear-gradient(135deg, #e8eaf6, #c5cae9)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    },
  }, React.createElement("svg", {
    width: size * 0.55,
    height: size * 0.55,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "#5c6bc0",
    strokeWidth: 2,
    strokeLinecap: "round",
    strokeLinejoin: "round",
  },
    React.createElement("rect", { x: 3, y: 11, width: 18, height: 10, rx: 2 }),
    React.createElement("circle", { cx: 12, cy: 5, r: 2 }),
    React.createElement("path", { d: "M12 7v4" }),
  ));
}

export default function AvatarRenderer({
  agentId,
  size = DEFAULT_SIZE,
  shape = DEFAULT_SHAPE,
  animated = true,
  fallback,
  className,
}: AvatarRendererProps) {
  const [imgSrc, setImgSrc] = React.useState<string | null>(null);
  const [format, setFormat] = React.useState<string>('');
  const [lottieData, setLottieData] = React.useState<unknown | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;

    fetchAvatar(agentId)
      .then((data: AvatarDataResponse) => {
        if (cancelled) return;
        if (data.ok) {
          setFormat(data.format);
          // Lottie 分支：base64 → JSON.parse → LottieRenderer
          if (data.format === 'json' && data.type === 'file' && data.data) {
            const parsed = decodeLottieData(data.data);
            if (parsed) {
              setLottieData(parsed);
              setImgSrc(null);
              return;
            }
            // 解析失败：回退到 /image 端点（后端返回 poster.png）
            setLottieData(null);
            setImgSrc(getAvatarImageUrl(agentId));
            return;
          }
          // URL 类型 Lottie：fetch 远程 JSON → LottieRenderer 动画渲染
          // CORS/网络失败时降级到 /image 端点（后端返回 poster.png 静态封面）
          if (data.format === 'json' && data.type === 'url' && data.url) {
            fetchLottieUrlData(data.url).then((parsed) => {
              if (cancelled) return;
              if (parsed) {
                setLottieData(parsed);
                setImgSrc(null);
              } else {
                // fetch 失败：回退到 /image 端点（后端 poster.png）
                setLottieData(null);
                setImgSrc(getAvatarImageUrl(agentId));
              }
            });
            return;
          }
          // 其他格式保持原有 <img> 路径
          setLottieData(null);
          if (data.type === 'url' && data.url) {
            setImgSrc(data.url);
          } else if (data.type === 'file' && data.data && data.mime) {
            setImgSrc(`data:${data.mime};base64,${data.data}`);
          } else {
            setImgSrc(getAvatarImageUrl(agentId));
          }
        }
      })
      .catch(() => {
        if (!cancelled) setImgSrc(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [agentId]);

  const borderRadius = shape === 'circle' ? '50%' : '8px';

  if (loading) {
    return React.createElement(FallbackIcon, { size });
  }

  // Lottie 渲染分支
  if (format === 'json' && lottieData) {
    return React.createElement(LottieRenderer, {
      animationData: lottieData,
      size,
      shape,
      className,
      fallback: fallback ?? React.createElement(FallbackIcon, { size }),
    });
  }

  if (!imgSrc) {
    return React.createElement("div", { className },
      fallback ?? React.createElement(FallbackIcon, { size })
    );
  }

  return React.createElement("img", {
    className,
    src: imgSrc,
    alt: `${agentId} avatar`,
    style: {
      width: size,
      height: size,
      borderRadius,
      objectFit: 'cover' as const,
      display: 'block',
    },
    onError: () => setImgSrc(null),
  });
}
