/**
 * CropModal — 头像裁剪弹窗（自定义实现，零外部依赖）
 *
 * 使用 DOM + 鼠标事件 + Canvas API 实现圆形裁剪。
 * 不依赖 react-easy-crop 或任何其他第三方裁剪库。
 *
 * v4 更新：
 * - 基础缩放：图片最短边填满裁剪圆，滑块控制附加缩放 1-3x
 * - 图片旋转：0°-359° 自由旋转滑块，支持任意角度
 * - 拖拽约束：放大后可拖动，偏移量自动限制确保裁剪圆始终在图片内
 * - 交互光标：拖拽中用 grabbing，可拖拽时 grab，否则 default
 *
 * 仅适用于静态图片（PNG/JPEG/静态 WebP）。
 * 动画格式（GIF/APNG/动态 WebP）、SVG、Lottie 应跳过此组件直接上传。
 */

import type * as ReactNS from "react";
import { host, React, antd } from "./qwenpaw-host";
const { Modal, Slider, Space, Button, Typography } = antd as any;
const { Text } = (Typography ?? {}) as any;

// ── 常量 ────────────────────────────────────────────────────────

const CONTAINER_W = 460;
const CONTAINER_H = 360;
const CROP_SIZE = 240;  // 圆形裁剪区域直径（px）
const OUTPUT_SIZE = 256; // 输出图片尺寸（px）
const MIN_ZOOM = 1;
const MAX_ZOOM = 3;

// ── Canvas 裁剪提取（支持旋转） ───────────────────────────────────

interface CropState {
  imgW: number;
  imgH: number;
  baseScale: number;
  zoom: number;
  rotation: number;
  offsetX: number;
  offsetY: number;
}

async function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.addEventListener("load", () => resolve(img));
    img.addEventListener("error", reject);
    img.src = src;
  });
}

/**
 * 从原图中提取裁剪区域的像素，生成 OUTPUT_SIZE×OUTPUT_SIZE 的圆形 PNG blob。
 *
 * Canvas 变换管道（从输出坐标映射到原图坐标）：
 *   1. translate → 输出画布中心
 *   2. scale     → 输出尺寸 → 裁剪圆尺寸
 *   3. translate → 反向屏幕偏移（裁剪圆中心 = 容器中心，偏移前已对齐）
 *   4. rotate    → 反向旋转（撤销 CSS 旋转）
 *   5. scale     → 显示坐标 → 原图坐标
 *   6. translate → 原点移到图像中心
 */
async function extractCroppedBlob(
  imageSrc: string,
  state: CropState
): Promise<Blob> {
  const image = await loadImage(imageSrc);

  const canvas = document.createElement("canvas");
  canvas.width = OUTPUT_SIZE;
  canvas.height = OUTPUT_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");

  const { imgW, imgH, baseScale, zoom, rotation, offsetX, offsetY } = state;
  const totalScale = baseScale * zoom;

  ctx.save();

  // 圆形遮罩
  ctx.beginPath();
  ctx.arc(OUTPUT_SIZE / 2, OUTPUT_SIZE / 2, OUTPUT_SIZE / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();

  // 变换管道：将原图像素正确映射到输出画布
  ctx.translate(OUTPUT_SIZE / 2, OUTPUT_SIZE / 2);             // 6. 输出居中
  ctx.scale(OUTPUT_SIZE / CROP_SIZE, OUTPUT_SIZE / CROP_SIZE); // 5. 裁剪圆 → 输出
  ctx.translate(offsetX, offsetY);                             // 4. 用户偏移（+方向）
  ctx.rotate((rotation * Math.PI) / 180);                      // 3. 用户旋转（+方向）
  ctx.scale(totalScale, totalScale);                           // 2. 缩放（正向）
  ctx.translate(-imgW / 2, -imgH / 2);                         // 1. 图片中心 → 原点

  // 绘制图像，使其中心对齐原点
  ctx.drawImage(image, 0, 0);

  ctx.restore();

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Canvas toBlob failed"));
      },
      "image/png",
      0.95
    );
  });
}

// ── 偏移约束 ─────────────────────────────────────────────────────

/**
 * 将偏移量限制在有效范围内，确保裁剪圆始终完全位于图片内部。
 *
 * 图片在容器中居中；偏移后图片边缘与裁剪圆边缘的关系：
 * 最大偏移 = (图片显示尺寸 - 裁剪圆尺寸) / 2
 */
function clampOffset(
  offset: number,
  displaySize: number,
  cropSize: number
): number {
  if (displaySize <= cropSize) return 0;
  const maxOffset = (displaySize - cropSize) / 2;
  return Math.max(-maxOffset, Math.min(maxOffset, offset));
}

// ── CropModal 组件 ───────────────────────────────────────────────

interface CropModalProps {
  imageSrc: string;
  visible: boolean;
  onConfirm: (croppedFile: File) => void;
  onCancel: () => void;
  fileName?: string;
}

export default function CropModal({
  imageSrc,
  visible,
  onConfirm,
  onCancel,
  fileName = "avatar.png",
}: CropModalProps) {
  const [zoom, setZoom] = React.useState(1);
  const [rotation, setRotation] = React.useState(0);
  const [offset, setOffset] = React.useState({ x: 0, y: 0 });
  const [processing, setProcessing] = React.useState(false);
  const [imgSize, setImgSize] = React.useState({ w: 0, h: 0 });
  const [baseScale, setBaseScale] = React.useState(1);
  const [isDragging, setIsDragging] = React.useState(false);

  // 拖拽内部状态使用 ref（避免闭包陈旧问题）
  const isDraggingRef = React.useRef(false);
  const dragStartRef = React.useRef({ x: 0, y: 0 });
  const offsetStartRef = React.useRef({ x: 0, y: 0 });
  const clampedRef = React.useRef({ x: 0, y: 0 });

  // ── 图片加载：计算基础缩放 ──────────────────────────────────

  React.useEffect(() => {
    if (!visible || !imageSrc) return;
    const img = new Image();
    img.onload = () => {
      const w = img.width;
      const h = img.height;
      // 基础缩放：让图片最短边刚好填满裁剪圆
      const bs = CROP_SIZE / Math.min(w, h);
      setBaseScale(bs);
      setZoom(1);
      setRotation(0);
      setOffset({ x: 0, y: 0 });
      setImgSize({ w, h });
    };
    img.src = imageSrc;
  }, [visible, imageSrc]);

  // ── 派生值 ──────────────────────────────────────────────────

  const totalScale = baseScale * zoom;

  // 旋转后的显示尺寸（任意角度的旋转包围盒）
  const rad = (rotation * Math.PI) / 180;
  const absCos = Math.abs(Math.cos(rad));
  const absSin = Math.abs(Math.sin(rad));
  const displayW = (imgSize.w * absCos + imgSize.h * absSin) * totalScale;
  const displayH = (imgSize.w * absSin + imgSize.h * absCos) * totalScale;

  // 约束后的偏移量
  const clampedX = clampOffset(offset.x, displayW, CROP_SIZE);
  const clampedY = clampOffset(offset.y, displayH, CROP_SIZE);

  // 同步 clampedRef
  clampedRef.current = { x: clampedX, y: clampedY };

  // ── 拖拽处理 ────────────────────────────────────────────────

  const handleMouseDown = React.useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDraggingRef.current = true;
      setIsDragging(true);
      dragStartRef.current = { x: e.clientX, y: e.clientY };
      offsetStartRef.current = {
        x: clampedRef.current.x,
        y: clampedRef.current.y,
      };
    },
    []
  );

  const handleMouseMove = React.useCallback((e: React.MouseEvent) => {
    if (!isDraggingRef.current) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    setOffset({
      x: offsetStartRef.current.x + dx,
      y: offsetStartRef.current.y + dy,
    });
  }, []);

  const stopDrag = React.useCallback(() => {
    isDraggingRef.current = false;
    setIsDragging(false);
  }, []);

  // 全局 mouseup 监听：处理鼠标在窗口外释放的情况
  React.useEffect(() => {
    if (!isDragging) return;
    window.addEventListener("mouseup", stopDrag);
    return () => window.removeEventListener("mouseup", stopDrag);
  }, [isDragging, stopDrag]);

  // ── 确认裁剪 ────────────────────────────────────────────────

  const handleConfirm = React.useCallback(async () => {
    if (!imgSize.w || !imgSize.h) return;
    setProcessing(true);
    try {
      const blob = await extractCroppedBlob(imageSrc, {
        imgW: imgSize.w,
        imgH: imgSize.h,
        baseScale,
        zoom,
        rotation,
        offsetX: clampedX,
        offsetY: clampedY,
      });
      const file = new File([blob], fileName, { type: "image/png" });
      onConfirm(file);
    } catch (err: any) {
      console.error("[CropModal] Crop failed:", err);
    } finally {
      setProcessing(false);
    }
  }, [
    imageSrc, imgSize, baseScale, zoom, rotation,
    clampedX, clampedY, fileName, onConfirm,
  ]);

  // ── 取消 ────────────────────────────────────────────────────

  const handleCancel = React.useCallback(() => {
    setZoom(1);
    setRotation(0);
    setOffset({ x: 0, y: 0 });
    setImgSize({ w: 0, h: 0 });
    setBaseScale(1);
    stopDrag();
    onCancel();
  }, [onCancel, stopDrag]);

  // ── 旋转（360° 滑块）─────────────────────────────────────────

  const handleRotateChange = React.useCallback((value: number) => {
    setRotation(value);
    setOffset({ x: 0, y: 0 }); // 旋转后重置偏移
  }, []);

  // ── 光标样式 ───────────────────────────────────────────────

  const canDrag = displayW > CROP_SIZE || displayH > CROP_SIZE;
  const cursorStyle = isDragging
    ? "grabbing"
    : canDrag
      ? "grab"
      : "default";

  // ── 裁剪圆位置（始终居中） ─────────────────────────────────

  const cropLeft = (CONTAINER_W - CROP_SIZE) / 2;
  const cropTop = (CONTAINER_H - CROP_SIZE) / 2;

  // ── Render ─────────────────────────────────────────────────

  return React.createElement(
    Modal,
    {
      title: "裁剪头像",
      open: visible,
      onCancel: handleCancel,
      width: CONTAINER_W + 48,
      destroyOnClose: true,
      footer: React.createElement(
        Space,
        null,
        React.createElement(Button, { onClick: handleCancel }, "取消"),
        React.createElement(
          Button,
          {
            type: "primary",
            onClick: handleConfirm,
            loading: processing,
            disabled: !imgSize.w,
          },
          "确认裁剪并上传"
        )
      ),
    },

    // ── 裁剪画布 ────────────────────────────────────────────
    React.createElement(
      "div",
      {
        style: {
          position: "relative",
          width: CONTAINER_W,
          height: CONTAINER_H,
          background: "#1a1a1a",
          borderRadius: 8,
          overflow: "hidden",
          cursor: cursorStyle,
          userSelect: "none",
          margin: "0 auto",
        },
        onMouseDown: handleMouseDown,
        onMouseMove: handleMouseMove,
        onMouseUp: stopDrag,
        onMouseLeave: stopDrag,
      },

      // 图片层（先居中，再 CSS 旋转，再屏幕空间平移）
      imgSize.w > 0 &&
        React.createElement(
          "div",
          {
            style: {
              position: "absolute",
              left: "50%",
              top: "50%",
              width: imgSize.w * totalScale,
              height: imgSize.h * totalScale,
              marginLeft: -(imgSize.w * totalScale) / 2,
              marginTop: -(imgSize.h * totalScale) / 2,
              // CSS 应用顺序（右→左）：先 rotate，后 translate
              //   → translate 在屏幕空间执行，拖拽方向与旋转无关
              transform: `translate(${clampedX}px, ${clampedY}px) rotate(${rotation}deg)`,
              transformOrigin: "center center",
              pointerEvents: "none",
            },
          },
          React.createElement("img", {
            src: imageSrc,
            alt: "crop",
            draggable: false,
            style: {
              width: "100%",
              height: "100%",
              display: "block",
            },
          })
        ),

      // 圆形遮罩层（半透明覆盖 + 圆形透明窗口）
      React.createElement("div", {
        style: {
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          background:
            `radial-gradient(circle ${CROP_SIZE / 2}px at ` +
            `${cropLeft + CROP_SIZE / 2}px ${cropTop + CROP_SIZE / 2}px, ` +
            `transparent 0%, transparent 100%, rgba(0,0,0,0.6) 100%)`,
        },
      }),

      // 圆形边框指示器
      React.createElement("div", {
        style: {
          position: "absolute",
          left: cropLeft,
          top: cropTop,
          width: CROP_SIZE,
          height: CROP_SIZE,
          borderRadius: "50%",
          border: "2px solid rgba(255,255,255,0.7)",
          pointerEvents: "none",
          boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)",
        },
      })
    ),

    // ── 旋转滑块（360° 自由旋转）────────────────────────────────
    React.createElement(
      "div",
      {
        style: {
          marginTop: 12,
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          gap: 8,
          width: "80%",
          marginLeft: "auto",
          marginRight: "auto",
        },
      },
      React.createElement(
        Text,
        { type: "secondary", style: { fontSize: 13, flexShrink: 0 } },
        "旋转:"
      ),
      React.createElement(
        Slider,
        {
          min: 0,
          max: 359,
          step: 1,
          value: rotation,
          onChange: handleRotateChange,
          disabled: !imgSize.w,
          style: { flex: 1 },
          tooltip: { formatter: (v: number) => `${v}°` },
        }
      ),
      React.createElement(
        Text,
        { type: "secondary", style: { fontSize: 12, flexShrink: 0, width: 36, textAlign: "right" } },
        `${rotation}\u00B0`
      )
    ),

    // ── 缩放控制 ────────────────────────────────────────────
    React.createElement(
      "div",
      { style: { marginTop: 8, padding: "0 12px" } },
      React.createElement(
        "div",
        {
          style: {
            display: "flex",
            justifyContent: "space-between",
            marginBottom: 4,
          },
        },
        React.createElement(
          Text,
          { type: "secondary", style: { fontSize: 13 } },
          "缩放"
        ),
        React.createElement(
          Text,
          { type: "secondary", style: { fontSize: 13 } },
          `${Math.round(zoom * 100)}%`
        )
      ),
      React.createElement(Slider, {
        min: MIN_ZOOM,
        max: MAX_ZOOM,
        step: 0.01,
        value: zoom,
        onChange: (v: number) => setZoom(v),
        disabled: !imgSize.w,
      })
    ),

    // ── 提示 ────────────────────────────────────────────────
    React.createElement(
      Text,
      {
        type: "secondary",
        style: {
          display: "block",
          marginTop: 8,
          fontSize: 12,
          textAlign: "center",
        },
      },
      "拖动图片调整位置，滑动条缩放大小，\u21BB 旋转图片。圆形区域内为最终头像效果。"
    )
  );
}

// ── 格式检测工具 ─────────────────────────────────────────────────

/**
 * 检测 WebP 文件是否为动画格式。
 *
 * WebP 容器结构：RIFF [size] WEBP [chunks...]
 * VP8X 扩展块（offset 12）包含动画标志：
 *   - byte 0: 'V' (0x56)
 *   - byte 1: 'P' (0x50)
 *   - byte 2: '8' (0x38)
 *   - byte 3: 'X' (0x58)
 *   - byte 8: flags — bit 1 (0x02) = animation
 */
export async function isAnimatedWebP(file: File): Promise<boolean> {
  try {
    const header = new Uint8Array(await file.slice(0, 30).arrayBuffer());

    // 检查 RIFF / WEBP 签名
    if (
      header[0] !== 0x52 ||
      header[1] !== 0x49 ||
      header[2] !== 0x46 ||
      header[3] !== 0x46 ||
      header[8] !== 0x57 ||
      header[9] !== 0x45 ||
      header[10] !== 0x42 ||
      header[11] !== 0x50
    )
      return false;

    // 检查第一个 chunk 是否为 VP8X
    if (
      header[12] !== 0x56 ||
      header[13] !== 0x50 ||
      header[14] !== 0x38 ||
      header[15] !== 0x58
    )
      return false;

    // VP8X flags 字节位于 chunk 起始 + 8（即 offset 20），bit 1 = animation
    return (header[20] & 0x02) !== 0;
  } catch {
    return false;
  }
}

/**
 * 判断文件是否应该跳过裁剪直接上传。
 *
 * 跳过裁剪的格式：
 * - GIF（动画）
 * - APNG（动画 PNG，.apng 扩展名或专用 MIME）
 * - SVG（矢量）
 * - Lottie JSON
 * - 动画 WebP（通过 VP8X 二进制检测）
 *
 * 进入裁剪的格式：
 * - PNG（始终静态）
 * - JPEG（始终静态）
 * - 静态 WebP（VP8 / VP8L，无动画标志）
 */
export async function shouldSkipCrop(file: File): Promise<boolean> {
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();

  if (type === "image/svg+xml" || name.endsWith(".svg")) return true;
  if (type === "application/json" || name.endsWith(".json")) return true;
  if (type === "image/gif" || name.endsWith(".gif")) return true;

  // APNG：扩展名 .apng 或专用 MIME 类型
  if (name.endsWith(".apng") || type === "image/vnd.mozilla.apng") return true;

  // WebP：通过二进制检测 VP8X 动画标志，静态 WebP 进入裁剪
  if (type === "image/webp" || name.endsWith(".webp")) {
    return await isAnimatedWebP(file);
  }

  return false;
}
