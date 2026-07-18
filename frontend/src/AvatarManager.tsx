/**
 * AvatarManager — 头像管理面板
 *
 * 使用 antd 组件（Card, Table, Input, Button, Tag, Space, Typography 等），
 * 通过 window.QwenPaw.host 获取。
 */

import type * as ReactNS from "react";
import { host, React, antd } from "./qwenpaw-host";

const {
  Card, Table, Input, Button, Space, Tag, Typography, message, Popconfirm, Row, Col, Empty, AutoComplete,
} = antd as any;
const { Title, Text } = (Typography ?? {}) as any;

import type { AvatarMeta, FormatInfo, AvatarManagerProps, AgentInfo } from './types';
import { fetchAvatarList, fetchSupportedFormats, fetchAgents, deleteAvatar } from './api';
import { refreshCurrentAvatar } from './ChatAvatar';
import AvatarRenderer from './AvatarRenderer';
import AvatarUploader from './AvatarUploader';

export default function AvatarManager(_props?: AvatarManagerProps) {
  const [avatars, setAvatars] = React.useState<AvatarMeta[]>([]);
  const [formats, setFormats] = React.useState<FormatInfo[]>([]);
  const [agents, setAgents] = React.useState<AgentInfo[]>([]);
  const [selectedAgent, setSelectedAgent] = React.useState('');
  const [agentValid, setAgentValid] = React.useState<boolean | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [refreshKey, setRefreshKey] = React.useState(0);
  const [serviceReady, setServiceReady] = React.useState(false);
  const retryTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // AutoComplete 选项：显示 "Agent名称 (agent_id)"
  const agentOptions = React.useMemo(() => {
    return agents.map((a: AgentInfo) => ({
      value: a.id,
      label: `${a.name || a.id}${a.name && a.name !== a.id ? ` (${a.id})` : ''}${a.enabled ? '' : ' [已禁用]'}`,
    }));
  }, [agents]);

  // 根据输入值校验 Agent ID 是否合法
  const matchedAgent = React.useMemo(() => {
    if (!selectedAgent) return null;
    return agents.find((a: AgentInfo) => a.id === selectedAgent) ?? null;
  }, [selectedAgent, agents]);

  const reload = React.useCallback(() => {
    setLoading(true);
    Promise.all([fetchAvatarList(), fetchSupportedFormats(), fetchAgents()])
      .then(([listRes, fmtRes, agentsRes]) => {
        setAvatars(listRes.avatars || []);
        setFormats(fmtRes.formats || []);
        setAgents(agentsRes.agents || []);
        setServiceReady(true);
        // 清理可能存在的重试定时器
        if (retryTimerRef.current) {
          clearTimeout(retryTimerRef.current);
          retryTimerRef.current = null;
        }
      })
      .catch((e) => {
        // api.ts 层已完成重试，仍然失败说明后端确实不可用
        message.error(e?.message || String(e));
        // 首次加载失败时，5 秒后自动重试（应对后端启动慢的场景）
        if (!serviceReady) {
          retryTimerRef.current = setTimeout(() => {
            setRefreshKey((k) => k + 1);
          }, 5000);
        }
      })
      .finally(() => setLoading(false));
  }, [serviceReady]);

  // 组件卸载时清理定时器
  React.useEffect(() => {
    return () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
      }
    };
  }, []);


  React.useEffect(() => { reload(); }, [reload, refreshKey]);

  // 校验 Agent ID 是否在已有 Agent 列表中
  React.useEffect(() => {
    if (!selectedAgent) {
      setAgentValid(null);
    } else {
      setAgentValid(agents.length > 0 && agents.some((a: AgentInfo) => a.id === selectedAgent));
    }
  }, [selectedAgent, agents]);

  const handleAgentSelect = React.useCallback((value: string) => {
    setSelectedAgent(value);
  }, []);

  const handleAgentSearch = React.useCallback((value: string) => {
    setSelectedAgent(value);
  }, []);

  const handleDelete = React.useCallback(async (agentId: string) => {
    try {
      await deleteAvatar(agentId);
      message.success(`已删除 ${agentId} 的头像`);
      setRefreshKey((k) => k + 1);
      // 刷新聊天页面头像，删除后立即反映变更
      refreshCurrentAvatar(agentId);
    } catch (e: any) {
      message.error(e?.message || String(e));
    }
  }, []);

  const handleUploaded = React.useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  const columns = React.useMemo(() => [
    {
      title: '头像',
      key: 'avatar',
      width: 80,
      render: (_: unknown, row: AvatarMeta) =>
        React.createElement(AvatarRenderer, { agentId: row.agent_id, size: 48 }),
    },
    {
      title: 'Agent ID',
      dataIndex: 'agent_id',
      key: 'agent_id',
      render: (text: string) => React.createElement(Text, { strong: true }, text),
    },
    {
      title: '格式',
      dataIndex: 'format',
      key: 'format',
      render: (fmt: string) => React.createElement(Tag, { color: 'blue' }, fmt),
    },
    {
      title: '来源',
      dataIndex: 'source',
      key: 'source',
      render: (src: string) => React.createElement(Tag, {
        color: src === 'url' ? 'green' : 'default',
      }, src === 'url' ? 'URL' : '文件上传'),
    },
    {
      title: '操作',
      key: 'action',
      width: 100,
      render: (_: unknown, row: AvatarMeta) =>
        React.createElement(Popconfirm, {
          title: '确定删除该头像？',
          onConfirm: () => handleDelete(row.agent_id),
          okText: '删除',
          cancelText: '取消',
          okButtonProps: { danger: true },
        },
          React.createElement(Button, { danger: true, size: 'small' }, '删除')
        ),
    },
  ], [handleDelete]);

  return React.createElement(Card, {
    style: { maxWidth: 900, margin: '24px auto' },
  },
    React.createElement(Space, {
      direction: 'vertical',
      size: 'large',
      style: { width: '100%' },
    },
      // 标题
      React.createElement("div", null,
        React.createElement(Title, { level: 3, style: { marginBottom: 4 } }, 'Agent 头像管理'),
        React.createElement(Text, { type: 'secondary' },
          '为 QwenPaw Agent 自定义头像，支持 7 种图片格式'),
      ),

      // 服务未就绪提示
      !serviceReady && loading === false && React.createElement(Card, {
        size: 'small',
        style: { borderColor: '#faad14', backgroundColor: 'rgba(250, 173, 20, 0.08)' },
      },
        React.createElement(Space, { align: 'center' },
          React.createElement(Text, { style: { color: '#faad14' } },
            '\u23F3 头像服务正在启动中，页面将自动重试...'),
        ),
      ),

      // 设置头像区域
      React.createElement(Card, {
        size: 'small',
        title: '设置头像',
      },
        React.createElement(Space, {
          direction: 'vertical',
          size: 'middle',
          style: { width: '100%' },
        },
          React.createElement(Space, { align: 'center' },
            React.createElement(Text, null, 'Agent ID：'),
            React.createElement(AutoComplete, {
              value: selectedAgent,
              options: agentOptions,
              onSelect: handleAgentSelect,
              onSearch: handleAgentSearch,
              onChange: handleAgentSearch,
              placeholder: '选择或输入 Agent ID',
              style: { width: 320 },
              allowClear: true,
              filterOption: (inputValue: string, option: any) => {
                const lower = inputValue.toLowerCase();
                const val = (option?.value || '').toLowerCase();
                const lbl = (option?.label || '').toLowerCase();
                return val.includes(lower) || lbl.includes(lower);
              },
            }),
          ),
          // 验证提示
          selectedAgent && agentValid === false && React.createElement(Text, {
            type: 'danger',
            style: { fontSize: 13 },
          }, '\u26A0 该 Agent ID 不存在，请从下拉列表中选择'),
          selectedAgent && agentValid === true && matchedAgent && React.createElement(Text, {
            type: 'success',
            style: { fontSize: 13 },
          }, `\u2713 已匹配: ${matchedAgent.name || matchedAgent.id}`),
          // 上传组件仅在 Agent ID 合法时显示
          selectedAgent && agentValid
            ? React.createElement(AvatarUploader, {
                key: selectedAgent,
                agentId: selectedAgent,
                onUploaded: handleUploaded,
              })
            : !selectedAgent
              ? React.createElement(Text, { type: 'secondary' }, '请先选择或输入 Agent ID')
              : null,
        ),
      ),

      // 支持的格式
      React.createElement("div", null,
        React.createElement(Text, { strong: true, style: { display: 'block', marginBottom: 8 } },
          '支持的格式'),
        React.createElement(Space, { wrap: true },
          ...formats.map((f: FormatInfo) =>
            React.createElement(Tag, {
              key: f.ext,
              color: f.animated ? 'green' : 'default',
            }, f.label + (f.animated ? ' 🎞' : ''))
          ),
        ),
      ),

      // 头像列表
      React.createElement(Table, {
        rowKey: (row: AvatarMeta) => `${row.agent_id}-${refreshKey}`,
        loading,
        dataSource: avatars,
        columns,
        pagination: { pageSize: 10, showSizeChanger: true, size: "small" },
        locale: {
          emptyText: React.createElement(Empty, {
            description: '暂无自定义头像，输入 Agent ID 并上传头像以开始',
          }),
        },
      }),
    ),
  );
}
