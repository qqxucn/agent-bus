/**
 * 统一的 HTTP 客户端
 * 所有对总线服务端的请求都通过此模块
 */
import { CONFIG } from '../config';
import type {
  ApiResponse,
  SystemStats,
  AgentListItem,
  InboxResponse,
  SendMessageRequest,
  HealthResponse,
  FileInfo,
  MessageLogEntry,
} from '../types';

/** 获取存储的 admin_token */
function getToken(): string | null {
  return localStorage.getItem('admin_token');
}

/** 构建请求头 */
function headers(noAuth = false): Record<string, string> {
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (!noAuth) {
    const token = getToken();
    if (token) {
      h['Authorization'] = `Bearer ${token}`;
    }
  }
  return h;
}

/** 处理响应，统一解析 ApiResponse */
async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    // 401 特殊处理：token 无效
    if (res.status === 401) {
      localStorage.removeItem('admin_token');
      if (!window.location.hash.startsWith('#/login')) {
        window.location.hash = '#/login';
      }
      throw new Error('认证已过期，请重新登录');
    }
    const body = await res.text();
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as ApiResponse<T>;
  if (json.code !== 0) {
    throw new Error(json.message || `错误码 ${json.code}`);
  }
  return json.data as T;
}

// ====== API 方法 ======

/** 健康检查（无需认证） */
export async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch(`${CONFIG.busUrl}/health`, {
    method: 'GET',
    headers: headers(true),
  });
  if (!res.ok) throw new Error(`总线不可达 (${res.status})`);
  return res.json();
}

/** 获取总线统计 */
export async function fetchStats(): Promise<SystemStats> {
  const res = await fetch(`${CONFIG.busUrl}/api/v1/panel/stats`, {
    method: 'GET',
    headers: headers(),
  });
  return handleResponse<SystemStats>(res);
}

/** 获取 Agent 列表 */
export async function fetchAgents(): Promise<AgentListItem[]> {
  const res = await fetch(`${CONFIG.busUrl}/api/agents`, {
    method: 'GET',
    headers: headers(),
  });
  return handleResponse<AgentListItem[]>(res);
}

/** 获取 Agent 详情 */
export async function fetchAgentDetail(agentId: string): Promise<AgentListItem> {
  const res = await fetch(`${CONFIG.busUrl}/api/agents/${encodeURIComponent(agentId)}`, {
    method: 'GET',
    headers: headers(),
  });
  return handleResponse<AgentListItem>(res);
}

/** 验证 admin_token 是否有效 */
export async function verifyToken(): Promise<boolean> {
  try {
    const res = await fetch(`${CONFIG.busUrl}/api/v1/panel/stats`, {
      method: 'GET',
      headers: headers(),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** 拉取收件箱消息 */
export async function fetchInbox(
  agentId: string,
  limit = 50,
  offset = 0,
): Promise<InboxResponse> {
  const params = new URLSearchParams({
    agent_id: agentId,
    limit: String(limit),
    offset: String(offset),
  });
  const res = await fetch(`${CONFIG.busUrl}/api/messages/inbox?${params}`, {
    method: 'GET',
    headers: headers(),
  });
  return handleResponse<InboxResponse>(res);
}

/** 发送消息 */
export async function sendMessage(req: SendMessageRequest): Promise<{ message_id: string }> {
  const res = await fetch(`${CONFIG.busUrl}/api/messages/send`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(req),
  });
  return handleResponse<{ message_id: string }>(res);
}

/** 获取消息日志 */
export async function fetchMessageLog(params?: {
  agent_id?: string;
  limit?: number;
  offset?: number;
}): Promise<{ items: MessageLogEntry[]; total: number }> {
  const searchParams = new URLSearchParams();
  if (params?.agent_id) searchParams.set('agent_id', params.agent_id);
  if (params?.limit) searchParams.set('limit', String(params.limit));
  if (params?.offset) searchParams.set('offset', String(params.offset));
  const qs = searchParams.toString();
  const res = await fetch(`${CONFIG.busUrl}/api/messages/log${qs ? `?${qs}` : ''}`, {
    method: 'GET',
    headers: headers(),
  });
  return handleResponse<{ items: MessageLogEntry[]; total: number }>(res);
}

/** 获取文件列表 */
export async function fetchFiles(page = 1, limit = 20): Promise<{ items: FileInfo[]; total: number }> {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  const res = await fetch(`${CONFIG.busUrl}/api/files?${params}`, {
    method: 'GET',
    headers: headers(),
  });
  return handleResponse<{ items: FileInfo[]; total: number }>(res);
}