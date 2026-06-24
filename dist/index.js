var _a, _b, _c, _d;
function hostFetch(path, init) {
  var _a2, _b2;
  const host2 = (_a2 = window.QwenPaw) == null ? void 0 : _a2.host;
  if (host2 == null ? void 0 : host2.fetch) {
    return host2.fetch(path, init);
  }
  const headers = {};
  const token = (_b2 = host2 == null ? void 0 : host2.getApiToken) == null ? void 0 : _b2.call(host2);
  if (token) headers.Authorization = `Bearer ${token}`;
  const url = (host2 == null ? void 0 : host2.getApiUrl) ? host2.getApiUrl(path) : `/api${path}`;
  return fetch(url, { ...init, headers: { ...headers, ...init == null ? void 0 : init.headers } });
}
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1e3;
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function fetchWithRetry(path, init) {
  let lastError = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await hostFetch(path, init);
      if ((res.status === 503 || res.status === 500) && attempt < MAX_RETRIES) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt);
        await sleep(delay);
        continue;
      }
      if (!res.ok) {
        let errorMsg = `HTTP ${res.status}`;
        try {
          const body = await res.json();
          if (body == null ? void 0 : body.error) errorMsg = body.error;
        } catch {
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
  throw lastError || new Error("Request failed after retries");
}
async function fetchAgents() {
  const res = await fetchWithRetry("/agents");
  return res.json();
}
async function fetchAvatarList() {
  const res = await fetchWithRetry("/avatar-pro/list");
  return res.json();
}
async function fetchAvatar(agentId, size = "full") {
  const res = await fetchWithRetry(`/avatar-pro/${agentId}?size=${size}`);
  return res.json();
}
async function checkAvatar(agentId) {
  try {
    const res = await hostFetch(`/avatar-pro/${agentId}/check`);
    if (!res.ok) return { ok: false, has_avatar: false };
    return res.json();
  } catch {
    return { ok: false, has_avatar: false };
  }
}
async function uploadAvatar(agentId, file) {
  const res = await fetchWithRetry(`/avatar-pro/${agentId}/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: file
  });
  return res.json();
}
async function setAvatarUrl(agentId, url) {
  const res = await fetchWithRetry(`/avatar-pro/${agentId}/url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url })
  });
  return res.json();
}
async function deleteAvatar(agentId) {
  const res = await fetchWithRetry(`/avatar-pro/${agentId}`, {
    method: "DELETE"
  });
  return res.json();
}
async function fetchSupportedFormats() {
  const res = await fetchWithRetry("/avatar-pro/formats");
  return res.json();
}
function getAvatarImageUrl(agentId, bust = true) {
  var _a2;
  const host2 = (_a2 = window.QwenPaw) == null ? void 0 : _a2.host;
  const base = (host2 == null ? void 0 : host2.getApiUrl) ? host2.getApiUrl(`/avatar-pro/${agentId}/image`) : `/api/avatar-pro/${agentId}/image`;
  return bust ? `${base}?t=${Date.now()}` : base;
}
const PLUGIN_ID$1 = "agent-avatar-pro";
const POLL_INTERVAL_MS = 800;
let lastAgentId = null;
let pollTimer = null;
const disposables = [];
let agentNameCache = /* @__PURE__ */ new Map();
let agentCacheLoaded = false;
let agentCacheTime = 0;
const AGENT_CACHE_TTL = 6e4;
async function getAgentName(agentId) {
  if (agentCacheLoaded && Date.now() - agentCacheTime < AGENT_CACHE_TTL) {
    return agentNameCache.get(agentId) ?? agentId;
  }
  try {
    const resp = await fetchAgents();
    if (resp == null ? void 0 : resp.agents) {
      agentNameCache.clear();
      for (const agent of resp.agents) {
        agentNameCache.set(agent.id, agent.name || agent.id);
      }
      agentCacheLoaded = true;
      agentCacheTime = Date.now();
      return agentNameCache.get(agentId) ?? agentId;
    }
  } catch {
  }
  return agentId;
}
function getImageUrl(agentId) {
  var _a2;
  const host2 = (_a2 = window.QwenPaw) == null ? void 0 : _a2.host;
  const ts = Date.now();
  if (host2 == null ? void 0 : host2.getApiUrl) {
    return `${host2.getApiUrl(`/avatar-pro/${agentId}/image`)}?t=${ts}`;
  }
  return `/api/avatar-pro/${agentId}/image?t=${ts}`;
}
function clearDisposables() {
  disposables.forEach((d) => d.dispose());
  disposables.length = 0;
}
async function updateChatAvatar(agentId) {
  var _a2, _b2;
  const qwpaw = window.QwenPaw;
  if (!(qwpaw == null ? void 0 : qwpaw.chat)) {
    console.warn("[agent-avatar-pro] chat API not available");
    return;
  }
  clearDisposables();
  const [check, agentName] = await Promise.all([
    checkAvatar(agentId),
    getAgentName(agentId)
  ]);
  if (agentId !== lastAgentId) {
    console.log(`[agent-avatar-pro] Agent changed during fetch, skipping "${agentId}"`);
    return;
  }
  let avatarUrl;
  if (check.ok && check.has_avatar) {
    if (check.type === "url" && check.url) {
      avatarUrl = check.url;
    } else {
      avatarUrl = getImageUrl(agentId);
    }
  }
  console.log(
    `[agent-avatar-pro] Setting nick for "${agentId}" → "${agentName}", avatar: ${avatarUrl || "(none, keep default)"}`
  );
  const welcomeParams = { nick: agentName };
  const responseParams = { nick: agentName };
  if (avatarUrl) {
    welcomeParams.avatar = avatarUrl;
    responseParams.avatar = avatarUrl;
  }
  try {
    if ((_a2 = qwpaw.chat.welcome) == null ? void 0 : _a2.set) {
      const d = qwpaw.chat.welcome.set(PLUGIN_ID$1, welcomeParams);
      disposables.push(d);
    }
  } catch (e) {
    console.warn("[agent-avatar-pro] chat.welcome.set failed:", e);
  }
  try {
    if ((_b2 = qwpaw.chat.response) == null ? void 0 : _b2.set) {
      const d = qwpaw.chat.response.set(PLUGIN_ID$1, responseParams);
      disposables.push(d);
    }
  } catch (e) {
    console.warn("[agent-avatar-pro] chat.response.set failed:", e);
  }
}
function checkAgentChange() {
  var _a2, _b2;
  const host2 = (_a2 = window.QwenPaw) == null ? void 0 : _a2.host;
  if (!host2) return;
  try {
    const currentAgentId = (_b2 = host2.getSelectedAgentId) == null ? void 0 : _b2.call(host2);
    if (currentAgentId && currentAgentId !== lastAgentId) {
      console.log(`[agent-avatar-pro] Agent changed: ${lastAgentId} → ${currentAgentId}`);
      lastAgentId = currentAgentId;
      updateChatAvatar(currentAgentId);
    }
  } catch {
  }
}
function startAvatarMonitor() {
  if (pollTimer) return;
  console.log("[agent-avatar-pro] Starting avatar monitor");
  getAgentName("").catch(() => {
  });
  setTimeout(checkAgentChange, 500);
  pollTimer = setInterval(checkAgentChange, POLL_INTERVAL_MS);
}
function refreshCurrentAvatar(agentId) {
  const targetId = agentId || lastAgentId;
  if (!targetId) return;
  if (agentId && lastAgentId && agentId !== lastAgentId) {
    console.log(`[agent-avatar-pro] Skip refresh: "${agentId}" is not the current chat agent "${lastAgentId}"`);
    return;
  }
  console.log(`[agent-avatar-pro] Force refresh for agent "${targetId}"`);
  updateChatAvatar(targetId);
}
function stopAvatarMonitor() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  clearDisposables();
  lastAgentId = null;
  console.log("[agent-avatar-pro] Avatar monitor stopped");
}
const host$3 = ((_a = window.QwenPaw) == null ? void 0 : _a.host) ?? {};
const React$3 = host$3.React ?? { createElement: () => null, useState: () => [null, () => {
}], useEffect: () => {
} };
const DEFAULT_SIZE = 48;
const DEFAULT_SHAPE = "circle";
function FallbackIcon({ size }) {
  return React$3.createElement("div", {
    style: {
      width: size,
      height: size,
      borderRadius: size / 2,
      background: "linear-gradient(135deg, #e8eaf6, #c5cae9)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center"
    }
  }, React$3.createElement(
    "svg",
    {
      width: size * 0.55,
      height: size * 0.55,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "#5c6bc0",
      strokeWidth: 2,
      strokeLinecap: "round",
      strokeLinejoin: "round"
    },
    React$3.createElement("rect", { x: 3, y: 11, width: 18, height: 10, rx: 2 }),
    React$3.createElement("circle", { cx: 12, cy: 5, r: 2 }),
    React$3.createElement("path", { d: "M12 7v4" })
  ));
}
function AvatarRenderer({
  agentId,
  size = DEFAULT_SIZE,
  shape = DEFAULT_SHAPE,
  animated = true,
  fallback,
  className
}) {
  const [imgSrc, setImgSrc] = React$3.useState(null);
  const [format, setFormat] = React$3.useState("");
  const [loading, setLoading] = React$3.useState(true);
  React$3.useEffect(() => {
    let cancelled = false;
    fetchAvatar(agentId).then((data) => {
      if (cancelled) return;
      if (data.ok) {
        setFormat(data.format);
        if (data.type === "url" && data.url) {
          setImgSrc(data.url);
        } else if (data.type === "file" && data.data && data.mime) {
          setImgSrc(`data:${data.mime};base64,${data.data}`);
        } else {
          setImgSrc(getAvatarImageUrl(agentId));
        }
      }
    }).catch(() => {
      if (!cancelled) setImgSrc(null);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [agentId]);
  const borderRadius = shape === "circle" ? "50%" : "8px";
  if (loading) {
    return React$3.createElement(FallbackIcon, { size });
  }
  if (!imgSrc) {
    return React$3.createElement(
      "div",
      { className },
      fallback ?? React$3.createElement(FallbackIcon, { size })
    );
  }
  return React$3.createElement("img", {
    className,
    src: imgSrc,
    alt: `${agentId} avatar`,
    style: {
      width: size,
      height: size,
      borderRadius,
      objectFit: "cover",
      display: "block"
    },
    onError: () => setImgSrc(null)
  });
}
const host$2 = ((_b = window.QwenPaw) == null ? void 0 : _b.host) ?? {};
const React$2 = host$2.React ?? {
  createElement: () => null,
  useState: () => [null, () => {
  }],
  useRef: () => ({ current: null }),
  useCallback: (fn) => fn,
  useEffect: () => {
  }
};
const antd$2 = host$2.antd ?? {};
const { Modal: Modal$1, Slider, Space: Space$2, Button: Button$2, Typography: Typography$1 } = antd$2;
const { Text: Text$1 } = Typography$1 ?? {};
const CONTAINER_W = 460;
const CONTAINER_H = 360;
const CROP_SIZE = 240;
const OUTPUT_SIZE = 256;
const MIN_ZOOM = 1;
const MAX_ZOOM = 3;
async function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.addEventListener("load", () => resolve(img));
    img.addEventListener("error", reject);
    img.src = src;
  });
}
async function extractCroppedBlob(imageSrc, state) {
  const image = await loadImage(imageSrc);
  const canvas = document.createElement("canvas");
  canvas.width = OUTPUT_SIZE;
  canvas.height = OUTPUT_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");
  const { imgW, imgH, baseScale, zoom, rotation, offsetX, offsetY } = state;
  const totalScale = baseScale * zoom;
  ctx.save();
  ctx.beginPath();
  ctx.arc(OUTPUT_SIZE / 2, OUTPUT_SIZE / 2, OUTPUT_SIZE / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  ctx.translate(OUTPUT_SIZE / 2, OUTPUT_SIZE / 2);
  ctx.scale(OUTPUT_SIZE / CROP_SIZE, OUTPUT_SIZE / CROP_SIZE);
  ctx.translate(offsetX, offsetY);
  ctx.rotate(rotation * Math.PI / 180);
  ctx.scale(totalScale, totalScale);
  ctx.translate(-imgW / 2, -imgH / 2);
  ctx.drawImage(image, 0, 0);
  ctx.restore();
  return new Promise((resolve, reject) => {
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
function clampOffset(offset, displaySize, cropSize) {
  if (displaySize <= cropSize) return 0;
  const maxOffset = (displaySize - cropSize) / 2;
  return Math.max(-maxOffset, Math.min(maxOffset, offset));
}
function CropModal({
  imageSrc,
  visible,
  onConfirm,
  onCancel,
  fileName = "avatar.png"
}) {
  const [zoom, setZoom] = React$2.useState(1);
  const [rotation, setRotation] = React$2.useState(0);
  const [offset, setOffset] = React$2.useState({ x: 0, y: 0 });
  const [processing, setProcessing] = React$2.useState(false);
  const [imgSize, setImgSize] = React$2.useState({ w: 0, h: 0 });
  const [baseScale, setBaseScale] = React$2.useState(1);
  const [isDragging, setIsDragging] = React$2.useState(false);
  const isDraggingRef = React$2.useRef(false);
  const dragStartRef = React$2.useRef({ x: 0, y: 0 });
  const offsetStartRef = React$2.useRef({ x: 0, y: 0 });
  const clampedRef = React$2.useRef({ x: 0, y: 0 });
  React$2.useEffect(() => {
    if (!visible || !imageSrc) return;
    const img = new Image();
    img.onload = () => {
      const w = img.width;
      const h = img.height;
      const bs = CROP_SIZE / Math.min(w, h);
      setBaseScale(bs);
      setZoom(1);
      setRotation(0);
      setOffset({ x: 0, y: 0 });
      setImgSize({ w, h });
    };
    img.src = imageSrc;
  }, [visible, imageSrc]);
  const totalScale = baseScale * zoom;
  const rad = rotation * Math.PI / 180;
  const absCos = Math.abs(Math.cos(rad));
  const absSin = Math.abs(Math.sin(rad));
  const displayW = (imgSize.w * absCos + imgSize.h * absSin) * totalScale;
  const displayH = (imgSize.w * absSin + imgSize.h * absCos) * totalScale;
  const clampedX = clampOffset(offset.x, displayW, CROP_SIZE);
  const clampedY = clampOffset(offset.y, displayH, CROP_SIZE);
  clampedRef.current = { x: clampedX, y: clampedY };
  const handleMouseDown = React$2.useCallback(
    (e) => {
      e.preventDefault();
      isDraggingRef.current = true;
      setIsDragging(true);
      dragStartRef.current = { x: e.clientX, y: e.clientY };
      offsetStartRef.current = {
        x: clampedRef.current.x,
        y: clampedRef.current.y
      };
    },
    []
  );
  const handleMouseMove = React$2.useCallback((e) => {
    if (!isDraggingRef.current) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    setOffset({
      x: offsetStartRef.current.x + dx,
      y: offsetStartRef.current.y + dy
    });
  }, []);
  const stopDrag = React$2.useCallback(() => {
    isDraggingRef.current = false;
    setIsDragging(false);
  }, []);
  React$2.useEffect(() => {
    if (!isDragging) return;
    window.addEventListener("mouseup", stopDrag);
    return () => window.removeEventListener("mouseup", stopDrag);
  }, [isDragging, stopDrag]);
  const handleConfirm = React$2.useCallback(async () => {
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
        offsetY: clampedY
      });
      const file = new File([blob], fileName, { type: "image/png" });
      onConfirm(file);
    } catch (err) {
      console.error("[CropModal] Crop failed:", err);
    } finally {
      setProcessing(false);
    }
  }, [
    imageSrc,
    imgSize,
    baseScale,
    zoom,
    rotation,
    clampedX,
    clampedY,
    fileName,
    onConfirm
  ]);
  const handleCancel = React$2.useCallback(() => {
    setZoom(1);
    setRotation(0);
    setOffset({ x: 0, y: 0 });
    setImgSize({ w: 0, h: 0 });
    setBaseScale(1);
    stopDrag();
    onCancel();
  }, [onCancel, stopDrag]);
  const handleRotateChange = React$2.useCallback((value) => {
    setRotation(value);
    setOffset({ x: 0, y: 0 });
  }, []);
  const canDrag = displayW > CROP_SIZE || displayH > CROP_SIZE;
  const cursorStyle = isDragging ? "grabbing" : canDrag ? "grab" : "default";
  const cropLeft = (CONTAINER_W - CROP_SIZE) / 2;
  const cropTop = (CONTAINER_H - CROP_SIZE) / 2;
  return React$2.createElement(
    Modal$1,
    {
      title: "裁剪头像",
      open: visible,
      onCancel: handleCancel,
      width: CONTAINER_W + 48,
      destroyOnClose: true,
      footer: React$2.createElement(
        Space$2,
        null,
        React$2.createElement(Button$2, { onClick: handleCancel }, "取消"),
        React$2.createElement(
          Button$2,
          {
            type: "primary",
            onClick: handleConfirm,
            loading: processing,
            disabled: !imgSize.w
          },
          "确认裁剪并上传"
        )
      )
    },
    // ── 裁剪画布 ────────────────────────────────────────────
    React$2.createElement(
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
          margin: "0 auto"
        },
        onMouseDown: handleMouseDown,
        onMouseMove: handleMouseMove,
        onMouseUp: stopDrag,
        onMouseLeave: stopDrag
      },
      // 图片层（先居中，再 CSS 旋转，再屏幕空间平移）
      imgSize.w > 0 && React$2.createElement(
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
            pointerEvents: "none"
          }
        },
        React$2.createElement("img", {
          src: imageSrc,
          alt: "crop",
          draggable: false,
          style: {
            width: "100%",
            height: "100%",
            display: "block"
          }
        })
      ),
      // 圆形遮罩层（半透明覆盖 + 圆形透明窗口）
      React$2.createElement("div", {
        style: {
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          background: `radial-gradient(circle ${CROP_SIZE / 2}px at ${cropLeft + CROP_SIZE / 2}px ${cropTop + CROP_SIZE / 2}px, transparent 0%, transparent 100%, rgba(0,0,0,0.6) 100%)`
        }
      }),
      // 圆形边框指示器
      React$2.createElement("div", {
        style: {
          position: "absolute",
          left: cropLeft,
          top: cropTop,
          width: CROP_SIZE,
          height: CROP_SIZE,
          borderRadius: "50%",
          border: "2px solid rgba(255,255,255,0.7)",
          pointerEvents: "none",
          boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)"
        }
      })
    ),
    // ── 旋转滑块（360° 自由旋转）────────────────────────────────
    React$2.createElement(
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
          marginRight: "auto"
        }
      },
      React$2.createElement(
        Text$1,
        { type: "secondary", style: { fontSize: 13, flexShrink: 0 } },
        "旋转:"
      ),
      React$2.createElement(
        Slider,
        {
          min: 0,
          max: 359,
          step: 1,
          value: rotation,
          onChange: handleRotateChange,
          disabled: !imgSize.w,
          style: { flex: 1 },
          tooltip: { formatter: (v) => `${v}°` }
        }
      ),
      React$2.createElement(
        Text$1,
        { type: "secondary", style: { fontSize: 12, flexShrink: 0, width: 36, textAlign: "right" } },
        `${rotation}°`
      )
    ),
    // ── 缩放控制 ────────────────────────────────────────────
    React$2.createElement(
      "div",
      { style: { marginTop: 8, padding: "0 12px" } },
      React$2.createElement(
        "div",
        {
          style: {
            display: "flex",
            justifyContent: "space-between",
            marginBottom: 4
          }
        },
        React$2.createElement(
          Text$1,
          { type: "secondary", style: { fontSize: 13 } },
          "缩放"
        ),
        React$2.createElement(
          Text$1,
          { type: "secondary", style: { fontSize: 13 } },
          `${Math.round(zoom * 100)}%`
        )
      ),
      React$2.createElement(Slider, {
        min: MIN_ZOOM,
        max: MAX_ZOOM,
        step: 0.01,
        value: zoom,
        onChange: (v) => setZoom(v),
        disabled: !imgSize.w
      })
    ),
    // ── 提示 ────────────────────────────────────────────────
    React$2.createElement(
      Text$1,
      {
        type: "secondary",
        style: {
          display: "block",
          marginTop: 8,
          fontSize: 12,
          textAlign: "center"
        }
      },
      "拖动图片调整位置，滑动条缩放大小，↻ 旋转图片。圆形区域内为最终头像效果。"
    )
  );
}
async function isAnimatedWebP(file) {
  try {
    const header = new Uint8Array(await file.slice(0, 30).arrayBuffer());
    if (header[0] !== 82 || header[1] !== 73 || header[2] !== 70 || header[3] !== 70 || header[8] !== 87 || header[9] !== 69 || header[10] !== 66 || header[11] !== 80)
      return false;
    if (header[12] !== 86 || header[13] !== 80 || header[14] !== 56 || header[15] !== 88)
      return false;
    return (header[20] & 2) !== 0;
  } catch {
    return false;
  }
}
async function shouldSkipCrop(file) {
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  if (type === "image/svg+xml" || name.endsWith(".svg")) return true;
  if (type === "application/json" || name.endsWith(".json")) return true;
  if (type === "image/gif" || name.endsWith(".gif")) return true;
  if (name.endsWith(".apng") || type === "image/vnd.mozilla.apng") return true;
  if (type === "image/webp" || name.endsWith(".webp")) {
    return await isAnimatedWebP(file);
  }
  return false;
}
const host$1 = ((_c = window.QwenPaw) == null ? void 0 : _c.host) ?? {};
const React$1 = host$1.React ?? {
  createElement: () => null,
  useState: () => [null, () => {
  }],
  useEffect: () => {
  },
  useCallback: (fn) => fn
};
const antd$1 = host$1.antd ?? {};
const { Upload, Input: Input$1, Button: Button$1, Space: Space$1, message: message$1, Modal } = antd$1;
const ACCEPT_DEFAULT = ".png,.jpg,.jpeg,.gif,.webp,.svg,.apng,.json";
function AvatarUploader({
  agentId,
  maxSizeMB = 5,
  acceptedFormats = ACCEPT_DEFAULT,
  onUploaded,
  onError
}) {
  const [preview, setPreview] = React$1.useState(null);
  const [uploading, setUploading] = React$1.useState(false);
  const [urlInput, setUrlInput] = React$1.useState("");
  const [cropVisible, setCropVisible] = React$1.useState(false);
  const [cropImageSrc, setCropImageSrc] = React$1.useState("");
  const [cropFileName, setCropFileName] = React$1.useState("avatar.png");
  const [currentAvatar, setCurrentAvatar] = React$1.useState(null);
  React$1.useEffect(() => {
    if (!agentId) {
      setCurrentAvatar(null);
      return;
    }
    let cancelled = false;
    fetchAvatar(agentId).then((data) => {
      if (cancelled) return;
      if (data.ok) {
        let imgSrc;
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
          imgSrc
        });
      } else {
        setCurrentAvatar({ hasAvatar: false });
      }
    }).catch(() => {
      if (!cancelled) setCurrentAvatar({ hasAvatar: false });
    });
    return () => {
      cancelled = true;
    };
  }, [agentId]);
  const confirmOverwrite = React$1.useCallback(() => {
    if (!(currentAvatar == null ? void 0 : currentAvatar.hasAvatar)) return Promise.resolve(true);
    return new Promise((resolve) => {
      Modal.confirm({
        title: "该 Agent 已有头像，是否替换？",
        content: `当前头像格式: ${currentAvatar.format || "unknown"}（${currentAvatar.source === "url" ? "URL" : "文件上传"}），替换后旧头像将自动备份。`,
        okText: "替换",
        cancelText: "取消",
        onOk: () => resolve(true),
        onCancel: () => resolve(false)
      });
    });
  }, [currentAvatar]);
  const doUpload = React$1.useCallback(
    async (file) => {
      const confirmed = await confirmOverwrite();
      if (!confirmed) return;
      setUploading(true);
      try {
        const result = await uploadAvatar(agentId, file);
        if (result.ok) {
          if (result.replaced) {
            message$1.success(`替换成功 — 原格式: ${result.previous_format || "unknown"}，新格式: ${result.format}`);
          } else {
            message$1.success(`上传成功 — 格式: ${result.format}`);
          }
          if (file.type.startsWith("image/")) {
            const reader = new FileReader();
            reader.onload = (e) => {
              var _a2;
              return setPreview((_a2 = e.target) == null ? void 0 : _a2.result);
            };
            reader.readAsDataURL(file);
          }
          setCurrentAvatar({
            hasAvatar: true,
            format: result.format,
            source: "upload",
            imgSrc: getAvatarImageUrl(agentId)
          });
          onUploaded == null ? void 0 : onUploaded(result);
          refreshCurrentAvatar(agentId);
        } else {
          message$1.error(`上传失败: ${result.error}`);
          onError == null ? void 0 : onError(result.error || "Unknown");
        }
      } catch (err) {
        message$1.error(`网络错误: ${err.message}`);
        onError == null ? void 0 : onError(err.message);
      } finally {
        setUploading(false);
      }
    },
    [agentId, onUploaded, onError, confirmOverwrite]
  );
  const handleFile = React$1.useCallback(
    async (file) => {
      const maxBytes = maxSizeMB * 1024 * 1024;
      if (file.size > maxBytes) {
        const msg = `文件超过 ${maxSizeMB}MB 限制`;
        message$1.error(msg);
        onError == null ? void 0 : onError(msg);
        return false;
      }
      if (await shouldSkipCrop(file)) {
        await doUpload(file);
      } else {
        const reader = new FileReader();
        reader.onload = (e) => {
          var _a2;
          const dataUrl = (_a2 = e.target) == null ? void 0 : _a2.result;
          setCropImageSrc(dataUrl);
          setCropFileName(file.name);
          setCropVisible(true);
        };
        reader.readAsDataURL(file);
      }
      return false;
    },
    [maxSizeMB, onError, doUpload]
  );
  const handleCropConfirm = React$1.useCallback(
    async (croppedFile) => {
      setCropVisible(false);
      await doUpload(croppedFile);
    },
    [doUpload]
  );
  const handleCropCancel = React$1.useCallback(() => {
    setCropVisible(false);
  }, []);
  const handleUrlSubmit = React$1.useCallback(async () => {
    if (!urlInput.trim()) return;
    const confirmed = await confirmOverwrite();
    if (!confirmed) return;
    setUploading(true);
    try {
      const result = await setAvatarUrl(agentId, urlInput.trim());
      if (result.ok) {
        message$1.success("URL 头像设置成功");
        setUrlInput("");
        setPreview(urlInput.trim());
        setCurrentAvatar({ hasAvatar: true, format: "url", source: "url", imgSrc: urlInput.trim() });
        onUploaded == null ? void 0 : onUploaded({ ok: true, agent_id: agentId, format: "url", size: 0 });
        refreshCurrentAvatar(agentId);
      } else {
        message$1.error(`设置失败: ${result.error}`);
        onError == null ? void 0 : onError(result.error || "Unknown");
      }
    } catch (err) {
      message$1.error(`网络错误: ${err.message}`);
    } finally {
      setUploading(false);
    }
  }, [agentId, urlInput, onUploaded, onError, confirmOverwrite]);
  return React$1.createElement(
    Space$1,
    { direction: "vertical", size: "middle", style: { width: "100%" } },
    // 当前头像预览（已有头像时显示）
    (currentAvatar == null ? void 0 : currentAvatar.hasAvatar) && React$1.createElement(
      "div",
      {
        style: {
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "8px 12px",
          background: "#f6f6f8",
          borderRadius: 8,
          border: "1px solid #e8e8e8"
        }
      },
      React$1.createElement("span", {
        style: { fontSize: 12, color: "#888", whiteSpace: "nowrap" }
      }, "当前头像:"),
      React$1.createElement("img", {
        key: currentAvatar.imgSrc || "none",
        src: currentAvatar.imgSrc || "",
        alt: "当前头像",
        style: {
          width: 40,
          height: 40,
          borderRadius: "50%",
          objectFit: "cover",
          border: "2px solid #d9d9d9"
        },
        onError: (e) => {
          e.target.style.display = "none";
        }
      }),
      React$1.createElement("span", {
        style: { fontSize: 12, color: "#666" }
      }, `${currentAvatar.format || "unknown"} · ${currentAvatar.source === "url" ? "URL" : "文件上传"}`)
    ),
    // 拖拽上传区域
    React$1.createElement(
      Upload.Dragger,
      {
        accept: acceptedFormats,
        showUploadList: false,
        beforeUpload: handleFile,
        disabled: uploading || !agentId
      },
      preview ? React$1.createElement("img", {
        src: preview,
        alt: "预览",
        style: {
          width: 80,
          height: 80,
          borderRadius: "50%",
          objectFit: "cover",
          margin: "0 auto 12px",
          display: "block",
          border: "3px solid #e8eaf6"
        }
      }) : React$1.createElement(
        "p",
        { style: { fontSize: 40, color: "#5c6bc0", marginBottom: 8 } },
        "+"
      ),
      React$1.createElement("p", null, "拖拽文件到此处，或点击选择"),
      React$1.createElement(
        "p",
        { style: { color: "#999", fontSize: 12 } },
        "支持 PNG / APNG / JPEG / GIF / WebP / SVG / Lottie · 最大 " + maxSizeMB + "MB"
      ),
      React$1.createElement(
        "p",
        { style: { color: "#bbb", fontSize: 11, marginTop: 4 } },
        "PNG / JPEG / 静态 WebP 可裁剪，APNG / GIF / SVG / Lottie / 动态 WebP 直接上传"
      )
    ),
    // URL 输入
    React$1.createElement(
      Space$1.Compact,
      { style: { width: "100%" } },
      React$1.createElement(Input$1, {
        value: urlInput,
        onChange: (e) => setUrlInput(e.target.value),
        placeholder: "https://example.com/avatar.png",
        disabled: uploading || !agentId
      }),
      React$1.createElement(
        Button$1,
        {
          type: "primary",
          onClick: handleUrlSubmit,
          loading: uploading,
          disabled: !urlInput.trim() || !agentId
        },
        "URL 设置"
      )
    ),
    // 裁剪弹窗
    React$1.createElement(CropModal, {
      imageSrc: cropImageSrc,
      visible: cropVisible,
      onConfirm: handleCropConfirm,
      onCancel: handleCropCancel,
      fileName: cropFileName
    })
  );
}
const host = ((_d = window.QwenPaw) == null ? void 0 : _d.host) ?? {};
const React = host.React ?? { createElement: () => null, useState: () => [null, () => {
}], useEffect: () => {
}, useCallback: (fn) => fn, useMemo: (fn) => fn(), useRef: () => ({ current: null }) };
const antd = host.antd ?? {};
const {
  Card,
  Table,
  Input,
  Button,
  Space,
  Tag,
  Typography,
  message,
  Popconfirm,
  Row,
  Col,
  Empty,
  AutoComplete
} = antd;
const { Title, Text } = Typography ?? {};
function AvatarManager(_props) {
  const [avatars, setAvatars] = React.useState([]);
  const [formats, setFormats] = React.useState([]);
  const [agents, setAgents] = React.useState([]);
  const [selectedAgent, setSelectedAgent] = React.useState("");
  const [agentValid, setAgentValid] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [refreshKey, setRefreshKey] = React.useState(0);
  const [serviceReady, setServiceReady] = React.useState(false);
  const retryTimerRef = React.useRef(null);
  const agentOptions = React.useMemo(() => {
    return agents.map((a) => ({
      value: a.id,
      label: `${a.name || a.id}${a.name && a.name !== a.id ? ` (${a.id})` : ""}${a.enabled ? "" : " [已禁用]"}`
    }));
  }, [agents]);
  const matchedAgent = React.useMemo(() => {
    if (!selectedAgent) return null;
    return agents.find((a) => a.id === selectedAgent) ?? null;
  }, [selectedAgent, agents]);
  const reload = React.useCallback(() => {
    setLoading(true);
    Promise.all([fetchAvatarList(), fetchSupportedFormats(), fetchAgents()]).then(([listRes, fmtRes, agentsRes]) => {
      setAvatars(listRes.avatars || []);
      setFormats(fmtRes.formats || []);
      setAgents(agentsRes.agents || []);
      setServiceReady(true);
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    }).catch((e) => {
      message.error((e == null ? void 0 : e.message) || String(e));
      if (!serviceReady) {
        retryTimerRef.current = setTimeout(() => {
          setRefreshKey((k) => k + 1);
        }, 5e3);
      }
    }).finally(() => setLoading(false));
  }, [serviceReady]);
  React.useEffect(() => {
    return () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
      }
    };
  }, []);
  React.useEffect(() => {
    reload();
  }, [reload, refreshKey]);
  React.useEffect(() => {
    if (!selectedAgent) {
      setAgentValid(null);
    } else {
      setAgentValid(agents.length > 0 && agents.some((a) => a.id === selectedAgent));
    }
  }, [selectedAgent, agents]);
  const handleAgentSelect = React.useCallback((value) => {
    setSelectedAgent(value);
  }, []);
  const handleAgentSearch = React.useCallback((value) => {
    setSelectedAgent(value);
  }, []);
  const handleDelete = React.useCallback(async (agentId) => {
    try {
      await deleteAvatar(agentId);
      message.success(`已删除 ${agentId} 的头像`);
      setRefreshKey((k) => k + 1);
      refreshCurrentAvatar(agentId);
    } catch (e) {
      message.error((e == null ? void 0 : e.message) || String(e));
    }
  }, []);
  const handleUploaded = React.useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);
  const columns = React.useMemo(() => [
    {
      title: "头像",
      key: "avatar",
      width: 80,
      render: (_, row) => React.createElement(AvatarRenderer, { agentId: row.agent_id, size: 48 })
    },
    {
      title: "Agent ID",
      dataIndex: "agent_id",
      key: "agent_id",
      render: (text) => React.createElement(Text, { strong: true }, text)
    },
    {
      title: "格式",
      dataIndex: "format",
      key: "format",
      render: (fmt) => React.createElement(Tag, { color: "blue" }, fmt)
    },
    {
      title: "来源",
      dataIndex: "source",
      key: "source",
      render: (src) => React.createElement(Tag, {
        color: src === "url" ? "green" : "default"
      }, src === "url" ? "URL" : "文件上传")
    },
    {
      title: "操作",
      key: "action",
      width: 100,
      render: (_, row) => React.createElement(
        Popconfirm,
        {
          title: "确定删除该头像？",
          onConfirm: () => handleDelete(row.agent_id),
          okText: "删除",
          cancelText: "取消",
          okButtonProps: { danger: true }
        },
        React.createElement(Button, { danger: true, size: "small" }, "删除")
      )
    }
  ], [handleDelete]);
  return React.createElement(
    Card,
    {
      style: { maxWidth: 900, margin: "24px auto" }
    },
    React.createElement(
      Space,
      {
        direction: "vertical",
        size: "large",
        style: { width: "100%" }
      },
      // 标题
      React.createElement(
        "div",
        null,
        React.createElement(Title, { level: 3, style: { marginBottom: 4 } }, "Agent 头像管理"),
        React.createElement(
          Text,
          { type: "secondary" },
          "为 QwenPaw Agent 自定义头像，支持 7 种图片格式"
        )
      ),
      // 服务未就绪提示
      !serviceReady && loading === false && React.createElement(
        Card,
        {
          size: "small",
          style: { borderColor: "#faad14", backgroundColor: "rgba(250, 173, 20, 0.08)" }
        },
        React.createElement(
          Space,
          { align: "center" },
          React.createElement(
            Text,
            { style: { color: "#faad14" } },
            "⏳ 头像服务正在启动中，页面将自动重试..."
          )
        )
      ),
      // 设置头像区域
      React.createElement(
        Card,
        {
          size: "small",
          title: "设置头像"
        },
        React.createElement(
          Space,
          {
            direction: "vertical",
            size: "middle",
            style: { width: "100%" }
          },
          React.createElement(
            Space,
            { align: "center" },
            React.createElement(Text, null, "Agent ID："),
            React.createElement(AutoComplete, {
              value: selectedAgent,
              options: agentOptions,
              onSelect: handleAgentSelect,
              onSearch: handleAgentSearch,
              onChange: handleAgentSearch,
              placeholder: "选择或输入 Agent ID",
              style: { width: 320 },
              allowClear: true,
              filterOption: (inputValue, option) => {
                const lower = inputValue.toLowerCase();
                const val = ((option == null ? void 0 : option.value) || "").toLowerCase();
                const lbl = ((option == null ? void 0 : option.label) || "").toLowerCase();
                return val.includes(lower) || lbl.includes(lower);
              }
            })
          ),
          // 验证提示
          selectedAgent && agentValid === false && React.createElement(Text, {
            type: "danger",
            style: { fontSize: 13 }
          }, "⚠ 该 Agent ID 不存在，请从下拉列表中选择"),
          selectedAgent && agentValid === true && matchedAgent && React.createElement(Text, {
            type: "success",
            style: { fontSize: 13 }
          }, `✓ 已匹配: ${matchedAgent.name || matchedAgent.id}`),
          // 上传组件仅在 Agent ID 合法时显示
          selectedAgent && agentValid ? React.createElement(AvatarUploader, {
            key: selectedAgent,
            agentId: selectedAgent,
            onUploaded: handleUploaded
          }) : !selectedAgent ? React.createElement(Text, { type: "secondary" }, "请先选择或输入 Agent ID") : null
        )
      ),
      // 支持的格式
      React.createElement(
        "div",
        null,
        React.createElement(
          Text,
          { strong: true, style: { display: "block", marginBottom: 8 } },
          "支持的格式"
        ),
        React.createElement(
          Space,
          { wrap: true },
          ...formats.map(
            (f) => React.createElement(Tag, {
              key: f.ext,
              color: f.animated ? "green" : "default"
            }, f.label + (f.animated ? " 🎞" : ""))
          )
        )
      ),
      // 头像列表
      React.createElement(Table, {
        rowKey: (row) => `${row.agent_id}-${refreshKey}`,
        loading,
        dataSource: avatars,
        columns,
        pagination: false,
        locale: {
          emptyText: React.createElement(Empty, {
            description: "暂无自定义头像，输入 Agent ID 并上传头像以开始"
          })
        }
      })
    )
  );
}
const PLUGIN_ID = "agent-avatar-pro";
const ROUTE_ID = "agent-avatar-pro.manager";
class AgentAvatarProPlugin {
  constructor() {
    this.id = PLUGIN_ID;
    this.disposables = [];
  }
  setup() {
    var _a2, _b2;
    const qwpaw = window.QwenPaw;
    if (!qwpaw) {
      console.warn("[agent-avatar-pro] window.QwenPaw not available, deferring setup");
      return;
    }
    try {
      if ((_a2 = qwpaw.route) == null ? void 0 : _a2.add) {
        const d = qwpaw.route.add(this.id, {
          id: ROUTE_ID,
          path: "/plugin/agent-avatar-pro/manager",
          component: AvatarManager
        });
        this.disposables.push(d);
      } else {
        console.warn("[agent-avatar-pro] route.add not available");
      }
    } catch (e) {
      console.error("[agent-avatar-pro] Failed to register route:", e);
    }
    try {
      if ((_b2 = qwpaw.menu) == null ? void 0 : _b2.add) {
        const d = qwpaw.menu.add(this.id, {
          id: ROUTE_ID,
          label: "Agent 头像管理",
          icon: "🖼",
          route: ROUTE_ID
        });
        this.disposables.push(d);
      }
    } catch (e) {
      console.error("[agent-avatar-pro] Failed to register menu:", e);
    }
    try {
      startAvatarMonitor();
    } catch (e) {
      console.warn("[agent-avatar-pro] Chat avatar monitor failed to start:", e);
    }
  }
  dispose() {
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
  }
}
try {
  const instance = new AgentAvatarProPlugin();
  instance.setup();
} catch (e) {
  console.error("[agent-avatar-pro] Plugin setup failed:", e);
}
export {
  AvatarManager,
  AvatarRenderer,
  AvatarUploader,
  refreshCurrentAvatar,
  startAvatarMonitor,
  stopAvatarMonitor
};
//# sourceMappingURL=index.js.map
