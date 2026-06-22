var _a, _b, _c;
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
  const base = (host2 == null ? void 0 : host2.getApiUrl) ? host2.getApiUrl(`/avatar-pro/${agentId}`) : `/api/avatar-pro/${agentId}`;
  return bust ? `${base}?t=${Date.now()}` : base;
}
const host$2 = ((_a = window.QwenPaw) == null ? void 0 : _a.host) ?? {};
const React$2 = host$2.React ?? { createElement: () => null, useState: () => [null, () => {
}], useEffect: () => {
} };
const DEFAULT_SIZE = 48;
const DEFAULT_SHAPE = "circle";
function FallbackIcon({ size }) {
  return React$2.createElement("div", {
    style: {
      width: size,
      height: size,
      borderRadius: size / 2,
      background: "linear-gradient(135deg, #e8eaf6, #c5cae9)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center"
    }
  }, React$2.createElement(
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
    React$2.createElement("rect", { x: 3, y: 11, width: 18, height: 10, rx: 2 }),
    React$2.createElement("circle", { cx: 12, cy: 5, r: 2 }),
    React$2.createElement("path", { d: "M12 7v4" })
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
  const [imgSrc, setImgSrc] = React$2.useState(null);
  const [format, setFormat] = React$2.useState("");
  const [loading, setLoading] = React$2.useState(true);
  React$2.useEffect(() => {
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
    return React$2.createElement(FallbackIcon, { size });
  }
  if (!imgSrc) {
    return React$2.createElement(
      "div",
      { className },
      fallback ?? React$2.createElement(FallbackIcon, { size })
    );
  }
  return React$2.createElement("img", {
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
const host$1 = ((_b = window.QwenPaw) == null ? void 0 : _b.host) ?? {};
const React$1 = host$1.React ?? { createElement: () => null, useState: () => [null, () => {
}], useEffect: () => {
}, useCallback: (fn) => fn };
const antd$1 = host$1.antd ?? {};
const { Upload, Input: Input$1, Button: Button$1, Space: Space$1, message: message$1 } = antd$1;
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
  const handleFile = React$1.useCallback(
    async (file) => {
      const maxBytes = maxSizeMB * 1024 * 1024;
      if (file.size > maxBytes) {
        const msg = `文件超过 ${maxSizeMB}MB 限制`;
        message$1.error(msg);
        onError == null ? void 0 : onError(msg);
        return false;
      }
      if (file.type.startsWith("image/") || file.name.endsWith(".json")) {
        const reader = new FileReader();
        reader.onload = (e) => {
          var _a2;
          return setPreview((_a2 = e.target) == null ? void 0 : _a2.result);
        };
        reader.readAsDataURL(file);
      }
      setUploading(true);
      try {
        const result = await uploadAvatar(agentId, file);
        if (result.ok) {
          message$1.success(`上传成功 — 格式: ${result.format}`);
          onUploaded == null ? void 0 : onUploaded(result);
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
      return false;
    },
    [agentId, maxSizeMB, onUploaded, onError]
  );
  const handleUrlSubmit = React$1.useCallback(async () => {
    if (!urlInput.trim()) return;
    setUploading(true);
    try {
      const result = await setAvatarUrl(agentId, urlInput.trim());
      if (result.ok) {
        message$1.success("URL 头像设置成功");
        setUrlInput("");
        setPreview(urlInput.trim());
        onUploaded == null ? void 0 : onUploaded({ ok: true, agent_id: agentId, format: "url", size: 0 });
      } else {
        message$1.error(`设置失败: ${result.error}`);
        onError == null ? void 0 : onError(result.error || "Unknown");
      }
    } catch (err) {
      message$1.error(`网络错误: ${err.message}`);
    } finally {
      setUploading(false);
    }
  }, [agentId, urlInput, onUploaded, onError]);
  return React$1.createElement(
    Space$1,
    {
      direction: "vertical",
      size: "middle",
      style: { width: "100%" }
    },
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
      }) : React$1.createElement("p", {
        style: { fontSize: 40, color: "#5c6bc0", marginBottom: 8 }
      }, "+"),
      React$1.createElement("p", null, "拖拽文件到此处，或点击选择"),
      React$1.createElement(
        "p",
        { style: { color: "#999", fontSize: 12 } },
        "支持 PNG / APNG / JPEG / GIF / WebP / SVG / Lottie · 最大 " + maxSizeMB + "MB"
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
      React$1.createElement(Button$1, {
        type: "primary",
        onClick: handleUrlSubmit,
        loading: uploading,
        disabled: !urlInput.trim() || !agentId
      }, "URL 设置")
    )
  );
}
const host = ((_c = window.QwenPaw) == null ? void 0 : _c.host) ?? {};
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
        rowKey: "agent_id",
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
  if (host2 == null ? void 0 : host2.getApiUrl) {
    return host2.getApiUrl(`/avatar-pro/${agentId}/image`);
  }
  return `/api/avatar-pro/${agentId}/image`;
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
  if (!check.ok || !check.has_avatar) {
    console.log(`[agent-avatar-pro] Agent "${agentId}" has no custom avatar, keeping default`);
    return;
  }
  let avatarUrl;
  if (check.type === "url" && check.url) {
    avatarUrl = check.url;
  } else {
    avatarUrl = getImageUrl(agentId);
  }
  console.log(`[agent-avatar-pro] Setting avatar for "${agentId}" (${agentName}): ${avatarUrl}`);
  try {
    if ((_a2 = qwpaw.chat.welcome) == null ? void 0 : _a2.set) {
      const d = qwpaw.chat.welcome.set(PLUGIN_ID$1, {
        avatar: avatarUrl,
        nick: agentName
      });
      disposables.push(d);
    }
  } catch (e) {
    console.warn("[agent-avatar-pro] chat.welcome.set failed:", e);
  }
  try {
    if ((_b2 = qwpaw.chat.response) == null ? void 0 : _b2.set) {
      const d = qwpaw.chat.response.set(PLUGIN_ID$1, {
        avatar: avatarUrl,
        nick: agentName
      });
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
function stopAvatarMonitor() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  clearDisposables();
  lastAgentId = null;
  console.log("[agent-avatar-pro] Avatar monitor stopped");
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
  startAvatarMonitor,
  stopAvatarMonitor
};
//# sourceMappingURL=index.js.map
