import React, { useEffect, useState } from 'react';
import { fetchStats, fetchAgents, fetchHealth } from '../api/client';
import type { SystemStats, AgentListItem, HealthResponse } from '../types';
import { showToast } from '../components/Toast';

export function DashboardPage() {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [agents, setAgents] = useState<AgentListItem[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    try {
      const [s, h, a] = await Promise.all([
        fetchStats(),
        fetchHealth(),
        fetchAgents(),
      ]);
      setStats(s);
      setHealth(h);
      setAgents(a);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '加载失败';
      showToast('error', msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 10000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="main-area" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <div className="spinner" />
      </div>
    );
  }

  const formatUptime = (seconds: number): string => {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${d}d ${h}h ${m}m`;
  };

  const formatTime = (iso: string): string => {
    if (!iso) return '-';
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    if (diffMs < 60000) return '刚刚';
    if (diffMs < 3600000) return `${Math.floor(diffMs / 60000)}分钟前`;
    return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  };

  const statusText = health?.status || '未知';
  const statusClass = statusText === 'healthy' ? 'success' : statusText === 'degraded' ? 'warning' : 'danger';

  return (
    <div className="main-area">
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">总线状态</div>
          <div className="stat-value" style={{ color: `var(--${statusClass})` }}>{statusText}</div>
          <div className="stat-sub">运行 {stats ? formatUptime(stats.uptime_seconds) : '-'}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">今日消息</div>
          <div className="stat-value">{stats?.messages_today ?? '-'}</div>
          <div className="stat-sub">累计 {stats?.total_messages ?? '-'}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">在线 Agent</div>
          <div className="stat-value" style={{ color: 'var(--success)' }}>{stats?.online_agents ?? '-'}</div>
          <div className="stat-sub">总 {stats?.total_agents ?? '-'} 个</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">版本</div>
          <div className="stat-value" style={{ fontSize: 20 }}>{stats?.version || '-'}</div>
        </div>
      </div>

      <div className="section-header">
        <h2>Agent 列表</h2>
        <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>
          {agents.filter((a) => a.status === 'online').length} / {agents.length} 在线
        </span>
      </div>

      <div className="agent-list">
        {agents.length === 0 && (
          <div style={{ color: 'var(--text-muted)', padding: 20, textAlign: 'center' }}>
            暂无已注册的 Agent
          </div>
        )}
        {agents.map((agent) => (
          <div key={agent.agent_id} className="agent-card">
            <div className="agent-info">
              <div className={`status-dot ${agent.status}`} />
              <div>
                <div className="agent-name">{agent.display_name || agent.agent_id}</div>
                <div className="agent-id">{agent.agent_id} · {agent.mode}</div>
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className={`badge ${agent.status}`}>
                {agent.status === 'online' ? '在线' : agent.status === 'busy' ? '忙碌' : '离线'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                {formatTime(agent.last_heartbeat)}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
