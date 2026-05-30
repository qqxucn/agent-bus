import { createHmac } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import type { ApiResponse, BusServerConfig } from '../types/index.js';
import type { AgentStore } from '../storage/agent-store.js';

/**
 * 生成 Agent Token（HMAC-SHA256）
 */
export function createToken(agentId: string, secret: string): string {
  return createHmac('sha256', secret).update(agentId).digest('hex');
}

/**
 * Agent 认证中间件
 * 从 Authorization: Bearer *** 提取 Token
 * Agent Token：HMAC-SHA256(agentId, secret)
 * Admin Token：直接比对配置
 */
export function requireAuth(config: BusServerConfig, agentStore: AgentStore) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const auth = req.headers['authorization'];
    if (!auth || !auth.startsWith('Bearer ')) {
      res.status(401).json({ code: 1001, message: 'invalid_token', data: null } satisfies ApiResponse);
      return;
    }

    const token = auth.slice(7);

    // Check admin token first
    if (token === config.adminToken) {
      (req as any).agentId = '__admin__';
      next();
      return;
    }

    // Check agent token — find agent by iterating all agents and comparing
    const agents = agentStore.listAgents();
    for (const agent of agents) {
      const expectedToken = createToken(agent.agent_id, config.agentTokenSecret);
      if (token === expectedToken) {
        (req as any).agentId = agent.agent_id;
        next();
        return;
      }
    }

    // Token not matched
    res.status(401).json({ code: 1001, message: 'invalid_token', data: null } satisfies ApiResponse);
  };
}

/**
 * Admin 认证中间件
 * 仅在 Token 完全匹配 adminToken 时通过
 */
export function requireAdmin(config: BusServerConfig) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const auth = req.headers['authorization'];
    if (!auth || !auth.startsWith('Bearer ')) {
      res.status(401).json({ code: 1001, message: 'invalid_token', data: null } satisfies ApiResponse);
      return;
    }

    const token = auth.slice(7);
    if (token !== config.adminToken) {
      res.status(403).json({ code: 1001, message: 'invalid_token', data: null } satisfies ApiResponse);
      return;
    }

    (req as any).agentId = '__admin__';
    next();
  };
}
