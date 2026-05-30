// ========================================================
// Agent 消息总线 — 中继层 REST API 路由
// 所有路径以 /relay 为前缀挂载到 Express
// ========================================================

import { Router, type Request, type Response } from 'express';
import { proxyRequest } from '../proxy/proxy.js';
import type { RelayConfig } from '../config.js';
import type { ProxyResult } from '../types.js';

// ===== 辅助函数 =====

/**
 * 将 IncomingHttpHeaders（string | string[] | undefined）扁平化为 Record<string, string>
 */
function flattenHeaders(raw: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    result[key] = Array.isArray(value) ? value.join(', ') : String(value);
  }
  return result;
}

/**
 * 统一转发处理：将请求透传给总线，返回总线原始响应
 */
async function forwardToBus(
  method: string,
  path: string,
  req: Request,
  res: Response,
  config: RelayConfig,
): Promise<void> {
  try {
    const headers = flattenHeaders(req.headers as Record<string, unknown>);
    const body = ['POST', 'PUT', 'PATCH'].includes(method)
      ? JSON.stringify(req.body)
      : undefined;

    const result: ProxyResult = await proxyRequest(config, method, path, headers, body);

    // 透传总线的状态码和响应体
    res.status(result.status);
    for (const [key, value] of Object.entries(result.headers)) {
      if (key.toLowerCase() !== 'transfer-encoding') {
        res.setHeader(key, value);
      }
    }
    res.send(result.body);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'unknown_error';
    res.status(502).json({
      code: 9001,
      message: 'relay_error',
      data: { detail: message },
    });
  }
}

// ===== 中间件 =====

/**
 * 中继 Token 校验中间件
 */
function requireRelayToken(config: RelayConfig) {
  return (req: Request, res: Response, next: () => void): void => {
    if (!config.relayToken) {
      // 未配置 token，直接放行
      next();
      return;
    }
    const token = req.headers['x-relay-token'];
    if (!token || token !== config.relayToken) {
      res.status(401).json({ code: 1001, message: 'relay_unauthorized' });
      return;
    }
    next();
  };
}

// ===== 路由工厂 =====

export function createRelayRoutes(config: RelayConfig): Router {
  const router = Router();
  const auth = requireRelayToken(config);

  // ── Agent 注册代理 ──
  router.post('/api/agents/register', auth, (req, res) => {
    forwardToBus('POST', '/api/agents/register', req, res, config);
  });

  // ── Agent 列表 ──
  router.get('/api/agents', auth, (req, res) => {
    forwardToBus('GET', '/api/agents', req, res, config);
  });

  // ── Agent 详情 ──
  router.get('/api/agents/:id', auth, (req, res) => {
    forwardToBus('GET', `/api/agents/${req.params.id}`, req, res, config);
  });

  // ── 删除 Agent ──
  router.delete('/api/agents/:id', auth, (req, res) => {
    forwardToBus('DELETE', `/api/agents/${req.params.id}`, req, res, config);
  });

  // ── 发送消息代理 ──
  router.post('/api/messages/send', auth, (req, res) => {
    forwardToBus('POST', '/api/messages/send', req, res, config);
  });

  // ── 收件箱代理 ──
  router.get('/api/messages/inbox', auth, (req, res) => {
    const qs = new URLSearchParams(
      Object.entries(req.query).map(([k, v]) => [k, String(v)]),
    ).toString();
    forwardToBus('GET', `/api/messages/inbox${qs ? '?' + qs : ''}`, req, res, config);
  });

  // ── 消息搜索代理 ──
  router.post('/api/messages/search', auth, (req, res) => {
    forwardToBus('POST', '/api/messages/search', req, res, config);
  });

  // ── 总线统计 ──
  router.get('/api/stats', auth, (req, res) => {
    forwardToBus('GET', '/api/stats', req, res, config);
  });

  // ── 心跳代理 ──
  router.get('/api/ping', auth, (req, res) => {
    forwardToBus('GET', '/api/ping', req, res, config);
  });

  // ── 中继自身健康检查 ──
  router.get('/health', (_req, res) => {
    res.json({
      code: 0,
      message: 'success',
      data: {
        status: 'healthy',
        version: '1.0.0',
      },
    });
  });

  return router;
}
