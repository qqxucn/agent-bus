import React, { useEffect, useState, useRef, useCallback } from 'react';
import { fetchAgents, fetchInbox, sendMessage } from '../api/client';
import { WsClient, type WsMessageHandler, type WsStatusHandler } from '../api/ws';
import type { AgentListItem, StoredMessage } from '../types';
import { showToast } from '../components/Toast';
import { CONFIG } from '../config';

interface ChatAgent {
  agent_id: string;
  display_name: string;
  status: 'online' | 'offline' | 'busy';
}

export function ChatPage() {
  const [agents, setAgents] = useState<ChatAgent[]>([]);
  const [activeAgent, setActiveAgent] = useState<string | null>(null);
  const [messages, setMessages] = useState<StoredMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingAgents, setLoadingAgents] = useState(true);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [wsStatus, setWsStatus] = useState<'connected' | 'disconnected' | 'reconnecting'>('disconnected');
  const wsRef = useRef<WsClient | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef(0);
  const activeAgentRef = useRef(activeAgent);
  activeAgentRef.current = activeAgent;

  // WebSocket 管理（只注册一次，通过 ref 读取最新 activeAgent）
  useEffect(() => {
    const ws = new WsClient();
    wsRef.current = ws;

    ws.onStatusChange((status) => {
      setWsStatus(status);
    });

    ws.onMessage((msg) => {
      const current = activeAgentRef.current;
      // 只处理活跃会话的消息
      if (msg.from_agent === current || msg.to_agent === current) {
        setMessages((prev) => {
          // 去重
          if (prev.some((m) => m.message_id === msg.message_id)) return prev;
          return [...prev, msg];
        });
      }
    });

    ws.connect();

    return () => {
      ws.disconnect();
      wsRef.current = null;
    };
  }, []);

  // 加载 Agent 列表
  useEffect(() => {
    const load = async () => {
      try {
        const list = await fetchAgents();
        setAgents(list.map((a: AgentListItem) => ({
          agent_id: a.agent_id,
          display_name: a.display_name || a.agent_id,
          status: a.status,
        })));
      } catch (err: unknown) {
        showToast('error', `加载 Agent 列表失败: ${err instanceof Error ? err.message : ''}`);
      } finally {
        setLoadingAgents(false);
      }
    };
    load();
  }, []);

  // 自动滚动到底部
  const scrollToBottom = useCallback(() => {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 50);
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // 选择 Agent 加载聊天记录
  const selectAgent = async (agentId: string) => {
    setActiveAgent(agentId);
    setMessages([]);
    offsetRef.current = 0;
    setHasMore(false);
    setLoading(true);

    try {
      const resp = await fetchInbox(agentId, CONFIG.chatLoadMore, 0);
      // API返回旧→新，保持顺序，不要reverse（避免打开时从头滑到最新）
      setMessages(resp.messages);
      setHasMore(resp.has_more);
      offsetRef.current = resp.messages.length;
    } catch (err: unknown) {
      showToast('error', `加载消息失败: ${err instanceof Error ? err.message : ''}`);
    } finally {
      setLoading(false);
    }
  };

  // 加载更多历史消息
  const loadMore = async () => {
    if (!activeAgent || loading || !hasMore) return;
    setLoading(true);
    try {
      const resp = await fetchInbox(activeAgent, CONFIG.chatLoadMore, offsetRef.current);
      // API返回旧→新（更早的消息在前），追加到现有消息前面
      setMessages((prev) => [...resp.messages, ...prev]);
      setHasMore(resp.has_more);
      offsetRef.current += resp.messages.length;
    } catch (err: unknown) {
      showToast('error', `加载更多消息失败: ${err instanceof Error ? err.message : ''}`);
    } finally {
      setLoading(false);
    }
  };

  // 发送消息
  const handleSend = async () => {
    const text = inputText.trim();
    if (!text || !activeAgent) return;
    setSending(true);
    const optimisticId = `temp_${Date.now()}`;
    const optimistic: StoredMessage = {
      message_id: optimisticId,
      from_agent: CONFIG.adminAgentId,
      sender_type: 'user',
      to_agent: activeAgent,
      type: 'text',
      content: text,
      status: 'pending',
      sent_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    setInputText('');
    try {
      const result = await sendMessage({
        from: CONFIG.adminAgentId,
        to: activeAgent,
        type: 'text',
        content: text,
      });
      // 更新为已发送，同时去重（防WS推送先到导致重复）
      setMessages((prev) => {
        // 先检查是否已有真实 message_id（WS推送先到了）
        const alreadyExists = prev.some((m) => m.message_id === result.message_id);
        if (alreadyExists) {
          // WS推送已加入，只需移除乐观消息
          return prev.filter((m) => m.message_id !== optimisticId);
        }
        return prev.map((m) =>
          m.message_id === optimisticId
            ? { ...m, message_id: result.message_id, status: 'delivered' as const }
            : m,
        );
      });
    } catch (err: unknown) {
      // 标记失败
      setMessages((prev) =>
        prev.map((m) =>
          m.message_id === optimisticId
            ? { ...m, status: 'delivered' as const, content: `${m.content}\n[发送失败]` }
            : m,
        ),
      );
      showToast('error', `发送失败: ${err instanceof Error ? err.message : ''}`);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const formatTime = (iso: string): string => {
    const d = new Date(iso);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    if (isToday) return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  };

  const wsStatusText = wsStatus === 'connected' ? '已连接' : wsStatus === 'reconnecting' ? '重连中' : '未连接';

  if (loadingAgents) {
    return (
      <div className="chat-page">
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <div className="spinner" />
        </div>
      </div>
    );
  }

  const activeInfo = agents.find((a) => a.agent_id === activeAgent);

  return (
    <div className="chat-page">
      {/* 侧边栏 */}
      <div className="chat-sidebar">
        <div className="sidebar-title">Agent 列表</div>
        {agents.length === 0 && (
          <div style={{ color: 'var(--text-muted)', padding: 16, textAlign: 'center', fontSize: 13 }}>
            暂无 Agent
          </div>
        )}
        {agents.map((agent) => (
          <div
            key={agent.agent_id}
            className={`chat-agent-item ${agent.agent_id === activeAgent ? 'active' : ''}`}
            onClick={() => selectAgent(agent.agent_id)}
          >
            <div className={`status-dot ${agent.status}`} />
            <span>{agent.display_name}</span>
          </div>
        ))}
      </div>

      {/* 聊天区域 */}
      {activeAgent ? (
        <div className="chat-main">
          <div className="chat-header">
            <div className={`status-dot ${activeInfo?.status || 'offline'}`} />
            <span className="chat-title">{activeInfo?.display_name || activeAgent}</span>
            <span className="agent-id" style={{ marginLeft: 4 }}>{activeAgent}</span>
            <span style={{ flex: 1 }} />
            <div className="ws-indicator">
              <div className={`dot ${wsStatus}`} />
              {wsStatusText}
            </div>
          </div>

          <div className="chat-messages">
            {hasMore && (
              <div className="chat-loading">
                <button className="btn btn-sm btn-secondary" onClick={loadMore} disabled={loading}>
                  {loading ? '加载中...' : '加载更多消息 ↑'}
                </button>
              </div>
            )}
            {loading && messages.length === 0 && (
              <div className="chat-loading">
                <div className="spinner" />
              </div>
            )}
            {messages.map((msg) => (
              <div key={msg.message_id} className={`message-bubble ${msg.from_agent === CONFIG.adminAgentId ? 'sent' : 'received'}`}>
                {msg.from_agent !== CONFIG.adminAgentId && (
                  <div className="msg-sender">{activeInfo?.display_name || msg.from_agent}</div>
                )}
                {msg.file_name ? (
                  <div>📎 {msg.file_name} {msg.file_size ? `(${(msg.file_size / 1024).toFixed(1)} KB)` : ''}</div>
                ) : (
                  <div style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</div>
                )}
                <div className="msg-time">
                  {formatTime(msg.sent_at)}
                  {msg.status === 'pending' && ' · 发送中'}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          <div className="chat-input-area">
            <button className="btn-icon" title="上传文件" disabled>
              📎
            </button>
            <input
              placeholder="输入消息..."
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={sending}
            />
            <button className="btn btn-primary btn-sm" onClick={handleSend} disabled={sending || !inputText.trim()}>
              {sending ? '发送中' : '发送'}
            </button>
          </div>
        </div>
      ) : (
        <div className="chat-empty">
          请从左侧选择一个 Agent 开始聊天
        </div>
      )}
    </div>
  );
}
