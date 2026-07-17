/**
 * LottieRenderer — Lottie 动画渲染组件
 *
 * 接收 Lottie JSON 数据，使用 lottie-web 在指定 DOM 容器中渲染 SVG 动画。
 *
 * 关键设计：
 * - SVG 渲染模式：矢量无损，适合任意尺寸缩放
 * - preserveAspectRatio: 'xMidYMid slice' — 等效于 CSS object-fit: cover
 * - loop: true, autoplay: true — 头像动画应持续循环播放
 * - useEffect cleanup 调用 anim.destroy() 释放 SVG DOM 节点和动画定时器
 * - cancelled 标志防止异步加载 lottie-web 期间组件已卸载或 animationData 已变更
 *
 * 使用 window.QwenPaw.host.React 而非 import React（与项目其他组件一致）。
 */

import type * as ReactNS from "react";
import { loadLottie } from "./LottieLoader";

const host = window.QwenPaw?.host ?? ({} as any);
const React: typeof ReactNS = host.React ?? {
  createElement: () => null,
  useRef: (() => ({ current: null })) as any,
  useState: (() => [null, () => {}]) as any,
  useEffect: () => {},
};

export interface LottieRendererProps {
  /** Lottie JSON 动画数据（已解析的对象，非 base64 字符串） */
  animationData: unknown;
  /** 渲染尺寸（像素），宽高相同 */
  size: number;
  /** 头像形状：circle 圆形 / rounded 圆角矩形 */
  shape?: "circle" | "rounded";
  /** 加载/出错时的回退节点 */
  fallback?: ReactNS.ReactNode;
  /** 自定义 className */
  className?: string;
}

type LottieState = "loading-lib" | "rendering" | "error";

export default function LottieRenderer({
  animationData,
  size,
  shape = "circle",
  fallback,
  className,
}: LottieRendererProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const animRef = React.useRef<any>(null);
  const animDataRef = React.useRef<unknown>(animationData);
  animDataRef.current = animationData;
  const [state, setState] = React.useState<LottieState>("loading-lib");

  // useEffect 始终渲染 container div（带 ref），不依赖 state 分支。
  // 修复 v1 bug：旧逻辑在 loading-lib 状态渲染 fallback div（无 ref），
  // 导致 useEffect 运行时 containerRef.current 为 null，loadLottie() 永不被调用，
  // 状态死锁在 loading-lib。
  React.useEffect(() => {
    if (!animationData) return;
    let cancelled = false;
    let animInstance: any = null;

    setState("loading-lib");

    loadLottie()
      .then((lottie: any) => {
        if (cancelled) return;
        // 此时组件已重渲染为 container div（state 切换前），containerRef 已绑定
        const container = containerRef.current;
        if (!container) {
          // container 未就绪：切换 state 触发重渲染后再试
          setState("rendering");
          // 用 setTimeout 0 等 React commit 后下一 tick 重试
          setTimeout(() => {
            if (cancelled) return;
            const c = containerRef.current;
            if (!c) return;
            c.innerHTML = "";
            animInstance = lottie.loadAnimation({
              container: c,
              renderer: "svg",
              loop: true,
              autoplay: true,
              animationData: animDataRef.current,
              rendererSettings: { preserveAspectRatio: "xMidYMid slice" },
            });
            animRef.current = animInstance;
          }, 0);
          return;
        }
        // 清空容器（可能上次渲染残留）
        container.innerHTML = "";
        animInstance = lottie.loadAnimation({
          container: container,
          renderer: "svg", // SVG 渲染：矢量无损，适合任意尺寸
          loop: true,
          autoplay: true,
          animationData: animDataRef.current,
          rendererSettings: {
            preserveAspectRatio: "xMidYMid slice", // 居中裁剪填充，等效 object-fit: cover
          },
        });
        animRef.current = animInstance;
        if (!cancelled) setState("rendering");
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });

    return () => {
      cancelled = true;
      if (animInstance) {
        try {
          animInstance.destroy();
        } catch {
          // 忽略 destroy 异常
        }
        animInstance = null;
      }
      animRef.current = null;
    };
  }, [animationData]);

  const borderRadius = shape === "circle" ? "50%" : "8px";

  // error 状态：显示回退（loading-lib 也渲染 container div 但带半透明 fallback 背景）
  if (state === "error") {
    return React.createElement(
      "div",
      {
        className,
        style: {
          width: size,
          height: size,
          borderRadius,
          background:
            "linear-gradient(135deg, #e8eaf6, #c5cae9)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
        },
      },
      fallback ?? null,
    );
  }

  // loading-lib / rendering：始终渲染 container div（带 ref），useEffect 可推进
  return React.createElement("div", {
    ref: containerRef,
    className,
    style: {
      width: size,
      height: size,
      borderRadius,
      overflow: "hidden",
      display: "block",
      background: state === "loading-lib"
        ? "linear-gradient(135deg, #e8eaf6, #c5cae9)" // 加载中可见占位
        : undefined,
    },
  });
}
