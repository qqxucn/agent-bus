import { BusAuthError } from './types';

/**
 * 认证管理：Agent 注册 + Token 管理。
 */

interface RegisterResponse {
  agent_id?: string;
  token?: string;
  error?: string;
}

/**
 * AuthManager
 * 负责 Agent 在总线上的注册和 Header 构建。
 */
export class AuthManager {
  private _registered = false;
  private _token: string;
  private readonly _skipRegistrationIfTokenSet: boolean;

  private readonly _agentId: string;

  constructor(
    private readonly busUrl: string,
    agentId: string,
    agentToken: string,
    skipRegistrationIfTokenSet: boolean = false,
  ) {
    this._agentId = agentId;
    this._token = agentToken;
    this._skipRegistrationIfTokenSet = skipRegistrationIfTokenSet;
  }

  /** Agent ID */
  get agentId(): string {
    return this._agentId;
  }

  /** 当前有效的 Token */
  get token(): string {
    return this._token;
  }

  /** 是否已注册 */
  get registered(): boolean {
    return this._registered;
  }

  /**
   * 注册 Agent 到总线。
   * 支持固定 Token 传入，容器重启后 Token 不变。
   *
   * 遇到 HTTP 409（Agent 已注册）时静默跳过，
   * 与 Python 版行为一致。
   *
   * 当 skipRegistrationIfTokenSet=true 且 agentToken 非空时，
   * 直接跳过注册（假设 Token 已由管理员预先配置）。
   */
  async register(): Promise<void> {
    // Token 已设置时跳过注册
    if (this._skipRegistrationIfTokenSet && this._token) {
      this._registered = true;
      return;
    }

    const url = `${this.busUrl}/api/agents/register`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_id: this.agentId,
        display_name: this.agentId,
        token: this._token,
      }),
    });

    if (res.status === 409) {
      // Agent 已注册，静默跳过
      this._registered = true;
      return;
    }

    if (!res.ok) {
      const body = await res.text();
      throw new BusAuthError(`注册 Agent 失败 (${res.status}): ${body}`);
    }

    const data: RegisterResponse = (await res.json()) as RegisterResponse;
    if (data.error) {
      throw new BusAuthError(`注册 Agent 失败: ${data.error}`);
    }

    this._registered = true;
  }

  /**
   * 续期当前 Agent 的 Token。
   */
  async renewToken(adminToken: string): Promise<void> {
    const url = `${this.busUrl}/api/agents/${this.agentId}/token/renew`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: '{}',
    });

    if (!res.ok) {
      const body = await res.text();
      throw new BusAuthError(`Token 续期失败 (${res.status}): ${body}`);
    }

    const data = (await res.json()) as { token: string };
    this._token = data.token;
  }

  /**
   * 构建 HTTP Authorization Header。
   * 符合规范：Authorization: Bearer <token>
   */
  buildAuthHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this._token}`,
      'X-Agent-Id': this.agentId,
      'Content-Type': 'application/json',
    };
  }

  /**
   * 构建 WebSocket 连接的认证 Headers。
   *
   * Node.js 18+ 的 WebSocket 实现支持自定义 headers，
   * 不需要将 Token 暴露在 URL query 中。
   */
  buildWsAuthHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this._token}`,
      'X-Agent-Id': this.agentId,
    };
  }
}
