"use strict";
/**
 * BusClient — 替代飞书 LarkClient 的 Agent Bus 客户端。
 *
 * 职责：
 *   1. 通过 WebSocket 连接 agent-bus 总线
 *   2. 接收总线消息并回调 handler
 *   3. 通过总线 API 发送消息（HTTP POST）
 *   4. 心跳维护
 *
 * API 使用示例：
 *   const client = BusClient.fromConfig(config);
 *   client.onMessage = (msg) => { ... };
 *   await client.start();
 *   const { message_id } = await client.send('target_agent', 'hello');
 *   client.stop();
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BusClient = void 0;

const WebSocket = require('ws');

// ---------------------------------------------------------------------------
// 内部常量
// ---------------------------------------------------------------------------
/** 心跳间隔（毫秒） */
const HEARTBEAT_INTERVAL_MS = 30000;

/** 重连等待基数（毫秒） */
const RECONNECT_BASE_MS = 1000;

/** 最大重连等待（毫秒） */
const RECONNECT_MAX_MS = 30000;

// ---------------------------------------------------------------------------
// BusClient
// ---------------------------------------------------------------------------
class BusClient {
  /** The plugin runtime, set externally by the plugin system (via monitor.js). */
  static runtime = null;

  /**
   * Set the plugin runtime for downstream modules (dispatch-context, etc.).
   * Called by monitor.js with ctx.runtime when starting the account.
   */
  static setRuntime(runtime) {
    BusClient.runtime = runtime;
  }

  /**
   * 静态工厂：从 OpenClaw config 中提取 bus 连接信息。
   *
   * @param {object} config  - 顶层 config（含 busUrl、busWsUrl、busToken、agentId）
   * @returns {BusClient}
   */
  static fromConfig(config) {
    const busUrl    = config.busUrl;
    const busWsUrl  = config.busWsUrl;
    const busToken  = config.busToken;
    const agentId   = config.agentId;
    const displayName = config.displayName ?? config.agentId;

    if (!busUrl || !busWsUrl || !busToken || !agentId) {
      throw new Error(
        'BusClient.fromConfig: missing required config fields ' +
        '(busUrl, busWsUrl, busToken, agentId)'
      );
    }

    return new BusClient({ busUrl, busWsUrl, busToken, agentId, displayName });
  }

  /**
   * @param {object} opts
   * @param {string} opts.busUrl       - 总线 HTTP 地址（如 http://47.104.247.64:4322）
   * @param {string} opts.busWsUrl     - 总线 WS 地址（如 ws://47.104.247.64:4322/ws）
   * @param {string} opts.busToken     - 总线认证 token
   * @param {string} opts.agentId      - 当前 agent 的 ID
   * @param {string} [opts.displayName]- 展示名称，默认 agentId
   */
  constructor(opts) {
    this._busUrl       = opts.busUrl;
    this._busWsUrl     = opts.busWsUrl;
    this._busToken     = opts.busToken;
    this._agentId      = opts.agentId;
    this._displayName  = opts.displayName ?? opts.agentId;

    /** @type {import('ws').WebSocket | null} */
    this._ws = null;

    /** @type {NodeJS.Timeout | null} */
    this._heartbeatTimer = null;

    /** @type {boolean} */
    this._stopped = false;

    /** @type {number} */
    this._reconnectAttempt = 0;

    /**
     * 外部消息回调。收到总线消息时被调用。
     * @param {object} msg
     * @param {string} msg.from_agent
     * @param {string} msg.content
     * @param {string} msg.message_id
     * @param {string} msg.type
     * @param {string} [msg.session_id]
     * @param {string} [msg.ref_id]
     */
    this.onMessage = null;

    /**
     * 连接状态回调。
     * @param {'connected'|'disconnected'|'reconnecting'} status
     * @param {Error} [err]
     */
    this.onStatusChange = null;
  }

  // -----------------------------------------------------------------------
  // 属性
  // -----------------------------------------------------------------------

  /** 当前 agent 的 ID */
  get botAgentId() {
    return this._agentId;
  }

  /** 底层 WebSocket 是否已连接 */
  get connected() {
    return this._ws !== null && this._ws.readyState === WebSocket.OPEN;
  }

  // -----------------------------------------------------------------------
  // 生命周期
  // -----------------------------------------------------------------------

  /**
   * 连接总线 WebSocket 并开始监听。
   * 1. （可选）调用注册 API 确保服务端已注册
   * 2. 建立 WebSocket 连接
   * 3. 启动心跳
   */
  async start() {
    this._stopped = false;
    this._reconnectAttempt = 0;

    // 先通过 HTTP 注册（幂等）
    await this._register();

    // 连接 WebSocket
    await this._connectWs();
  }

  /**
   * 断开 WebSocket 连接，停止心跳和重连。
   */
  stop() {
    this._stopped = true;
    this._reconnectAttempt = 0;

    this._clearHeartbeat();
    this._closeWs();

    if (this.onStatusChange) {
      try { this.onStatusChange('disconnected'); } catch (_) { /* 忽略回调异常 */ }
    }
  }

  // -----------------------------------------------------------------------
  // 发送消息
  // -----------------------------------------------------------------------

  /**
   * 通过总线 API 发送文本消息。
   *
   * @param {string} to      - 目标 agent ID
   * @param {string} content - 消息内容
   * @param {string} [ref_id] - 引用消息 ID（可选）
   * @returns {Promise<{message_id: string}>}
   */
  async send(to, content, ref_id) {
    // 兼容对象格式调用: bus.send({ to, content, replyTo, threadId })
    if (typeof to === 'object' && to !== null && !Array.isArray(to)) {
      const params = to;
      ref_id = params.ref_id || params.replyTo || undefined;
      content = params.content || params.text || '';
      to = params.to;
    }
    // 调试日志：打印发送信息
    console.log('[BusClient.send] to=' + JSON.stringify(to) + ' content=' + JSON.stringify(String(content ?? '').slice(0,80)));
    const body = {
      to,
      from: this._agentId,
      content: String(content ?? ''),
      type: 'text',
    };
    if (ref_id) body.ref_id = ref_id;

    const res = await this._request('POST', '/api/messages/send', body);
    const data = res.data;

    if (!data || !data.message_id) {
      throw new Error(`BusClient.send failed: ${res.message ?? 'unknown error'}`);
    }

    return { message_id: data.message_id };
  }

  /**
   * 通过总线 API 发送文件消息（文本内容为 caption + file 标记）。
   *
   * 注意：文件内容需自行上传或通过其他方式传递；本方法仅发送
   * 带文件标记的消息告知接收方。
   *
   * @param {string} to       - 目标 agent ID
   * @param {string} filePath - 文件路径（本地路径或已上传的文件标识）
   * @param {string} [caption] - 文件描述文本
   * @returns {Promise<{message_id: string}>}
   */
  async sendFile(to, filePath, caption) {
    const body = {
      to,
      from: this._agentId,
      content: caption ?? '',
      type: 'file',
      file_path: filePath,
    };

    const res = await this._request('POST', '/api/messages/send', body);
    const data = res.data;

    if (!data || !data.message_id) {
      throw new Error(`BusClient.sendFile failed: ${res.message ?? 'unknown error'}`);
    }

    return { message_id: data.message_id };
  }

  // -----------------------------------------------------------------------
  // 内部：HTTP 请求
  // -----------------------------------------------------------------------

  /**
   * 向总线 API 发送 HTTP 请求。
   *
   * @param {'GET'|'POST'} method
   * @param {string} path
   * @param {object} [body]
   * @returns {Promise<{code: number, message: string, data?: any}>}
   */
  async _request(method, path, body) {
    const url = `${this._busUrl}${path}`;
    const headers = {
      'Authorization': `Bearer ${this._busToken}`,
      'Content-Type': 'application/json',
    };

    /** @type {RequestInit} */
    const init = { method, headers };

    if (body && method === 'POST') {
      init.body = JSON.stringify(body);
    }

    let response;
    try {
      response = await fetch(url, init);
    } catch (netErr) {
      console.error('[BusClient._request] network error:', method, path, netErr.message);
      throw netErr;
    }
    const json = await response.json();

    if (json.code !== 0) {
      throw new Error(`BusClient API error (${path}): ${json.message ?? JSON.stringify(json)}`);
    }

    return json;
  }

  // -----------------------------------------------------------------------
  // 内部：注册
  // -----------------------------------------------------------------------

  /**
   * 在总线上注册当前 agent（幂等）。
   */
  async _register() {
    const body = {
      agent_id: this._agentId,
      token: this._busToken,
      display_name: this._displayName,
      mode: 'websocket',
    };

    await this._request('POST', '/api/agents/register', body);
  }

  // -----------------------------------------------------------------------
  // 内部：WebSocket
  // -----------------------------------------------------------------------

  /**
   * 建立 WebSocket 连接并设置监听器。
   */
  _connectWs() {
    return new Promise((resolve, reject) => {
      if (this._stopped) return reject(new Error('BusClient already stopped'));

      // 若已有连接，先关闭
      this._closeWs();

      const wsUrl = this._busWsUrl;
      /** @type {import('ws').WebSocket} */
      const ws = new WebSocket(wsUrl, {
        headers: {
          'Authorization': `Bearer ${this._busToken}`,
          'X-Agent-Id': encodeURIComponent(this._agentId),
        },
        handshakeTimeout: 10000,
      });

      this._ws = ws;

      const cleanup = () => {
        ws.removeListener('open', onOpen);
        ws.removeListener('error', onError);
        ws.removeListener('close', onClose);
      };

      const onOpen = () => {
        cleanup();
        this._reconnectAttempt = 0;
        this._startHeartbeat();

        if (this.onStatusChange) {
          try { this.onStatusChange('connected'); } catch (_) { /* 忽略 */ }
        }

        resolve();
      };

      const onError = (err) => {
        cleanup();
        this._ws = null;
        reject(err);
      };

      const onClose = () => {
        // 如果 cleanup 已经执行过（open/error 已触发），这里不重复 reject
      };

      ws.on('open', onOpen);
      ws.on('error', onError);
      ws.on('close', () => this._onWsClose());
      ws.on('message', (data) => this._onWsMessage(String(data)));
    });
  }

  /**
   * WebSocket 关闭时回调 — 触发重连。
   */
  _onWsClose() {
    this._clearHeartbeat();
    this._ws = null;

    if (this._stopped) return;

    if (this.onStatusChange) {
      try { this.onStatusChange('disconnected'); } catch (_) { /* 忽略 */ }
    }

    this._scheduleReconnect();
  }

  /**
   * 收到 WebSocket 消息。
   *
   * @param {string} raw
   */
  _onWsMessage(raw) {
    let frame;
    try {
      frame = JSON.parse(raw);
    } catch {
      // 非 JSON 消息忽略
      return;
    }

    const wsType = frame.ws_type;

    // 心跳回复
    if (wsType === 'ping') {
      this._sendWsFrame({ ws_type: 'pong' });
      return;
    }

    if (wsType === 'pong') {
      // 服务端回复 pong，无需额外操作
      return;
    }

    // 连接确认
    if (wsType === 'connected') {
      return;
    }

    // 错误帧
    if (wsType === 'error') {
      console.error('[BusClient] WS error frame:', frame.code, frame.payload);
      return;
    }

    // ACK 确认 — 忽略（由 HTTP send 处理）
    if (wsType === 'ack') {
      return;
    }

    // 消息帧
    if (wsType === 'message') {
      const payload = frame.payload ?? frame;

      // 兼容两种格式：
      // 服务端 push: { ws_type: 'message', payload: { message_id, from_agent, content, type, session_id } }
      // 直接格式:   { ws_type: 'message', message_id, from_agent, content, type, session_id }
      const msg = {
        message_id: payload.message_id ?? frame.message_id,
        from_agent: payload.from_agent ?? frame.from_agent,
        content:    payload.content    ?? frame.content,
        type:       payload.type       ?? frame.type ?? 'text',
        session_id: payload.session_id ?? frame.session_id,
        ref_id:     payload.ref_id     ?? frame.ref_id,
      };

      // 防回声：忽略来自我自己的消息
      if (msg.from_agent && msg.from_agent === this._agentId) {
        return;
      }

      if (msg.message_id && this.onMessage) {
        try {
          this.onMessage(msg);
        } catch (err) {
          console.error('[BusClient] onMessage handler error:', err);
        }
      }
      return;
    }
  }

  /**
   * 向 WebSocket 发送 JSON 帧。
   *
   * @param {object} frame
   * @returns {Promise<boolean>}
   */
  _sendWsFrame(frame) {
    return new Promise((resolve) => {
      if (!this._ws || this._ws.readyState !== WebSocket.OPEN) {
        resolve(false);
        return;
      }
      this._ws.send(JSON.stringify(frame), (err) => {
        resolve(err === null);
      });
    });
  }

  /**
   * 关闭当前 WebSocket 连接。
   */
  _closeWs() {
    if (this._ws) {
      try {
        this._ws.removeAllListeners();
        this._ws.close();
      } catch (_) { /* 忽略关闭异常 */ }
      this._ws = null;
    }
  }

  // -----------------------------------------------------------------------
  // 内部：心跳
  // -----------------------------------------------------------------------

  /**
   * 启动定时心跳：每 30s 发送 { ws_type: 'ping' }。
   */
  _startHeartbeat() {
    this._clearHeartbeat();

    this._heartbeatTimer = setInterval(() => {
      this._sendWsFrame({ ws_type: 'ping' });
    }, HEARTBEAT_INTERVAL_MS);
  }

  /**
   * 清除心跳定时器。
   */
  _clearHeartbeat() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  }

  // -----------------------------------------------------------------------
  // 内部：重连
  // -----------------------------------------------------------------------

  /**
   * 按指数退避策略调度重连。
   */
  _scheduleReconnect() {
    if (this._stopped) return;

    this._reconnectAttempt++;

    const delay = Math.min(
      RECONNECT_BASE_MS * Math.pow(2, this._reconnectAttempt - 1),
      RECONNECT_MAX_MS
    );

    if (this.onStatusChange) {
      try { this.onStatusChange('reconnecting'); } catch (_) { /* 忽略 */ }
    }

    setTimeout(() => {
      if (this._stopped) return;

      this._connectWs().catch((err) => {
        console.error('[BusClient] reconnect attempt failed:', err.message);
        this._scheduleReconnect();
      });
    }, delay);
  }
}

exports.BusClient = BusClient;
