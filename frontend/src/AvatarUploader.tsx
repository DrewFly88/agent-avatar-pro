/**
 * AvatarUploader — 头像上传组件
 *
 * 使用 antd Upload / Input / Button 组件，从 window.QwenPaw.host 获取。
 * 静态图片（PNG/JPEG）选择后弹出圆形裁剪弹窗，动画/SVG/Lottie 直接上传。
 */

import type * as ReactNS from "react";
import { host, React, antd } from "./qwenpaw-host";
const { Upload, Input, Button, Space, message, Modal } = antd as any;

import type { AvatarUploaderProps, AvatarUploadResponse } from "./types";
import { uploadAvatar, setAvatarUrl, checkAvatar, fetchAvatar, getAvatarImageUrl } from "./api";
import CropModal, { shouldSkipCrop } from "./CropModal";
import { refreshCurrentAvatar } from "./ChatAvatar";
import { fetchLottieUrlData, decodeLottieData } from "./LottieLoader";
import LottieRenderer from "./LottieRenderer";

const ACCEPT_DEFAULT = ".png,.jpg,.jpeg,.gif,.webp,.svg,.apng,.json";

export default function AvatarUploader({
  agentId,
  maxSizeMB = 5,
  acceptedFormats = ACCEPT_DEFAULT,
  onUploaded,
  onError,
}: AvatarUploaderProps) {
  const [preview, setPreview] = React.useState<string | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const [urlInput, setUrlInput] = React.useState("");

  // 裁剪弹窗状态
  const [cropVisible, setCropVisible] = React.useState(false);
  const [cropImageSrc, setCropImageSrc] = React.useState<string>("");
  const [cropFileName, setCropFileName] = React.useState<string>("avatar.png");

  // 当前头像信息（用于覆盖确认和预览）
  const [currentAvatar, setCurrentAvatar] = React.useState<{
    hasAvatar: boolean;
    format?: string;
    source?: string;
    imgSrc?: string;
    lottieData?: unknown | null;
  } | null>(null);

  // 组件挂载或 agentId 变化时，加载当前头像
  React.useEffect(() => {
    if (!agentId) {
      setCurrentAvatar(null);
      return;
    }
    let cancelled = false;
    // 使用 fetchAvatar 获取完整头像数据（含 base64），避免 /image 端点的 HTTP 缓存问题
    fetchAvatar(agentId)
      .then((data) => {
        if (cancelled) return;
        if (data.ok) {
          // Lottie 分支：解析 base64 JSON → LottieRenderer 预览
          if (data.format === "json" && data.type === "file" && data.data) {
            const parsed = decodeLottieData(data.data);
            setCurrentAvatar({
              hasAvatar: true,
              format: data.format,
              source: data.type,
              lottieData: parsed,
              imgSrc: parsed ? undefined : getAvatarImageUrl(agentId),
            });
            return;
          }
          // URL 类型 Lottie：fetch 远程 JSON → LottieRenderer 预览
          // CORS/网络失败时降级到 /image 端点（后端返回 poster.png）
          if (data.format === "json" && data.type === "url" && data.url) {
            fetchLottieUrlData(data.url).then((parsed) => {
              if (cancelled) return;
              setCurrentAvatar({
                hasAvatar: true,
                format: data.format,
                source: data.type,
                lottieData: parsed,
                imgSrc: parsed ? undefined : getAvatarImageUrl(agentId),
              });
            });
            return;
          }
          // 其他格式：保持原有 <img> 预览
          let imgSrc: string;
          if (data.type === "url" && data.url) {
            imgSrc = data.url;
          } else if (data.type === "file" && data.data && data.mime) {
            imgSrc = `data:${data.mime};base64,${data.data}`;
          } else {
            imgSrc = getAvatarImageUrl(agentId);
          }
          setCurrentAvatar({
            hasAvatar: true,
            format: data.format,
            source: data.type,
            imgSrc,
            lottieData: null,
          });
        } else {
          setCurrentAvatar({ hasAvatar: false });
        }
      })
      .catch(() => {
        if (!cancelled) setCurrentAvatar({ hasAvatar: false });
      });
    return () => { cancelled = true; };
  }, [agentId]);

  // ── 覆盖确认弹窗 ──────────────────────────────────────────────

  const confirmOverwrite = React.useCallback((): Promise<boolean> => {
    if (!currentAvatar?.hasAvatar) return Promise.resolve(true);
    return new Promise((resolve) => {
      Modal.confirm({
        title: "该 Agent 已有头像，是否替换？",
        content: `当前头像格式: ${currentAvatar.format || "unknown"}（${currentAvatar.source === "url" ? "URL" : "文件上传"}），替换后旧头像将自动备份。`,
        okText: "替换",
        cancelText: "取消",
        onOk: () => resolve(true),
        onCancel: () => resolve(false),
      });
    });
  }, [currentAvatar]);

  // ── 上传逻辑（裁剪后或直接上传共用） ──────────────────────────

  const doUpload = React.useCallback(
    async (file: File) => {
      // 覆盖确认
      const confirmed = await confirmOverwrite();
      if (!confirmed) return;

      setUploading(true);
      try {
        const result: AvatarUploadResponse = await uploadAvatar(agentId, file);
        if (result.ok) {
          if (result.replaced) {
            message.success(`替换成功 — 原格式: ${result.previous_format || "unknown"}，新格式: ${result.format}`);
          } else {
            message.success(`上传成功 — 格式: ${result.format}`);
          }
          // 更新预览
          if (file.type.startsWith("image/")) {
            const reader = new FileReader();
            reader.onload = (e) => setPreview(e.target?.result as string);
            reader.readAsDataURL(file);
          }
          // 更新当前头像状态（含预览图片 URL，确保连续替换时预览刷新）
          setCurrentAvatar({
            hasAvatar: true,
            format: result.format,
            source: "upload",
            imgSrc: getAvatarImageUrl(agentId),
          });
          onUploaded?.(result);
          // 立即刷新聊天窗口头像和名称
          refreshCurrentAvatar(agentId);
        } else {
          message.error(`上传失败: ${result.error}`);
          onError?.(result.error || "Unknown");
        }
      } catch (err: any) {
        message.error(`网络错误: ${err.message}`);
        onError?.(err.message);
      } finally {
        setUploading(false);
      }
    },
    [agentId, onUploaded, onError, confirmOverwrite]
  );

  // ── 文件选择处理 ──────────────────────────────────────────────

  const handleFile = React.useCallback(
    async (file: File) => {
      // 大小校验
      const maxBytes = maxSizeMB * 1024 * 1024;
      if (file.size > maxBytes) {
        const msg = `文件超过 ${maxSizeMB}MB 限制`;
        message.error(msg);
        onError?.(msg);
        return false;
      }

      // 判断是否需要裁剪
      if (await shouldSkipCrop(file)) {
        // 动画/SVG/Lottie → 直接上传
        await doUpload(file);
      } else {
        // 静态图片 → 读取为 data URL，弹出裁剪弹窗
        const reader = new FileReader();
        reader.onload = (e) => {
          const dataUrl = e.target?.result as string;
          setCropImageSrc(dataUrl);
          setCropFileName(file.name);
          setCropVisible(true);
        };
        reader.readAsDataURL(file);
      }

      return false; // 阻止 antd Upload 默认行为
    },
    [maxSizeMB, onError, doUpload]
  );

  // ── 裁剪确认回调 ──────────────────────────────────────────────

  const handleCropConfirm = React.useCallback(
    async (croppedFile: File) => {
      setCropVisible(false);
      await doUpload(croppedFile);
    },
    [doUpload]
  );

  const handleCropCancel = React.useCallback(() => {
    setCropVisible(false);
  }, []);

  // ── URL 头像 ──────────────────────────────────────────────────

  const handleUrlSubmit = React.useCallback(async () => {
    if (!urlInput.trim()) return;

    // 覆盖确认
    const confirmed = await confirmOverwrite();
    if (!confirmed) return;

    setUploading(true);
    try {
      const result = await setAvatarUrl(agentId, urlInput.trim());
      if (result.ok) {
        message.success("URL 头像设置成功");
        setUrlInput("");
        setPreview(urlInput.trim());
        // 更新当前头像状态（含预览图片 URL）
        setCurrentAvatar({ hasAvatar: true, format: "url", source: "url", imgSrc: urlInput.trim() });
        onUploaded?.({ ok: true, agent_id: agentId, format: "url", size: 0 } as any);
        // 立即刷新聊天窗口头像
        refreshCurrentAvatar(agentId);
      } else {
        message.error(`设置失败: ${result.error}`);
        onError?.(result.error || "Unknown");
      }
    } catch (err: any) {
      message.error(`网络错误: ${err.message}`);
    } finally {
      setUploading(false);
    }
  }, [agentId, urlInput, onUploaded, onError, confirmOverwrite]);

  // ── Render ────────────────────────────────────────────────────

  return React.createElement(
    Space,
    { direction: "vertical", size: "middle", style: { width: "100%" } },
    // 当前头像预览（已有头像时显示）
    currentAvatar?.hasAvatar && React.createElement(
      "div",
      {
        style: {
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "8px 12px",
          background: "#f6f6f8",
          borderRadius: 8,
          border: "1px solid #e8e8e8",
        },
      },
      React.createElement("span", {
        style: { fontSize: 12, color: "#888", whiteSpace: "nowrap" },
      }, "当前头像:"),
      // Lottie 预览分支
      currentAvatar.format === "json" && currentAvatar.lottieData
        ? React.createElement(LottieRenderer, {
            animationData: currentAvatar.lottieData,
            size: 40,
            shape: "circle",
            fallback: React.createElement("div", {
              style: { width: 40, height: 40, borderRadius: "50%", background: "#e8eaf6" },
            }),
          })
        : React.createElement("img", {
            key: currentAvatar.imgSrc || "none",
            src: currentAvatar.imgSrc || "",
            alt: "当前头像",
            style: {
              width: 40,
              height: 40,
              borderRadius: "50%",
              objectFit: "cover" as const,
              border: "2px solid #d9d9d9",
            },
            onError: (e: any) => { e.target.style.display = "none"; },
          }),
      React.createElement("span", {
        style: { fontSize: 12, color: "#666" },
      }, `${currentAvatar.format || "unknown"} · ${currentAvatar.source === "url" ? "URL" : "文件上传"}`)
    ),
    // 拖拽上传区域
    React.createElement(
      Upload.Dragger,
      {
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
              borderRadius: "50%",
              objectFit: "cover" as const,
              margin: "0 auto 12px",
              display: "block",
              border: "3px solid #e8eaf6",
            },
          })
        : React.createElement(
            "p",
            { style: { fontSize: 40, color: "#5c6bc0", marginBottom: 8 } },
            "+"
          ),
      React.createElement("p", null, "拖拽文件到此处，或点击选择"),
      React.createElement(
        "p",
        { style: { color: "#999", fontSize: 12 } },
        "支持 PNG / APNG / JPEG / GIF / WebP / SVG / Lottie · 最大 " +
          maxSizeMB +
          "MB"
      ),
      React.createElement(
        "p",
        { style: { color: "#bbb", fontSize: 11, marginTop: 4 } },
        "PNG / JPEG / 静态 WebP 可裁剪，APNG / GIF / SVG / Lottie / 动态 WebP 直接上传"
      )
    ),
    // URL 输入
    React.createElement(
      Space.Compact,
      { style: { width: "100%" } },
      React.createElement(Input, {
        value: urlInput,
        onChange: (e: any) => setUrlInput(e.target.value),
        placeholder: "https://...头像图 URL 或 lottie.host Lottie JSON URL",
        disabled: uploading || !agentId,
      }),
      React.createElement(
        Button,
        {
          type: "primary",
          onClick: handleUrlSubmit,
          loading: uploading,
          disabled: !urlInput.trim() || !agentId,
        },
        "URL 设置"
      )
    ),
    // 裁剪弹窗
    React.createElement(CropModal, {
      imageSrc: cropImageSrc,
      visible: cropVisible,
      onConfirm: handleCropConfirm,
      onCancel: handleCropCancel,
      fileName: cropFileName,
    })
  );
}
