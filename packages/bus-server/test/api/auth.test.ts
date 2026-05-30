import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createToken, requireAuth, requireAdmin } from '../../src/api/auth.js';
import type { BusServerConfig, AgentInfo } from '../../src/types/index.js';
import type { Request, Response, NextFunction } from 'express';

const TEST_CONFIG: BusServerConfig = {
  httpPort: 4322,
  dbPath: ':memory:',
  adminToken: 'my-admin-token',
  agentTokenSecret: 'my-secret-key',
  heartbeatTimeoutSeconds: 60,
  heartbeatCheckInterval: 15,
  maxInboxMessages: 200,
  logLevel: 'info',
};

describe('createToken', () => {
  it('should return a deterministic HMAC-SHA256 hex string', () => {
    const token1 = createToken('agent-1', 'secret');
    const token2 = createToken('agent-1', 'secret');
    expect(token1).toBe(token2);
    expect(token1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('should produce different tokens for different agent IDs', () => {
    const token1 = createToken('agent-1', 'secret');
    const token2 = createToken('agent-2', 'secret');
    expect(token1).not.toBe(token2);
  });

  it('should produce different tokens for different secrets', () => {
    const token1 = createToken('agent-1', 'secret-1');
    const token2 = createToken('agent-1', 'secret-2');
    expect(token1).not.toBe(token2);
  });
});

describe('requireAuth', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: ReturnType<typeof vi.fn>;
  let agentStore: { listAgents: ReturnType<typeof vi.fn> };
  let middleware: ReturnType<typeof requireAuth>;

  beforeEach(() => {
    mockReq = {
      headers: {},
    };
    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    mockNext = vi.fn();
    agentStore = {
      listAgents: vi.fn(),
    };
    middleware = requireAuth(TEST_CONFIG, agentStore as any);
  });

  it('should return 401 if no Authorization header', () => {
    middleware(mockReq as Request, mockRes as Response, mockNext as NextFunction);
    expect(mockRes.status).toHaveBeenCalledWith(401);
    expect(mockRes.json).toHaveBeenCalledWith({
      code: 1001, message: 'invalid_token', data: null,
    });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should return 401 if auth header does not start with Bearer', () => {
    mockReq.headers = { authorization: 'Basic xyz' };
    middleware(mockReq as Request, mockRes as Response, mockNext as NextFunction);
    expect(mockRes.status).toHaveBeenCalledWith(401);
  });

  it('should pass with admin token', () => {
    mockReq.headers = { authorization: `Bearer ${TEST_CONFIG.adminToken}` };
    middleware(mockReq as Request, mockRes as Response, mockNext as NextFunction);
    expect(mockNext).toHaveBeenCalled();
    expect((mockReq as any).agentId).toBe('__admin__');
  });

  it('should pass with valid agent token', () => {
    const agentId = 'valid-agent';
    const token = createToken(agentId, TEST_CONFIG.agentTokenSecret);
    mockReq.headers = { authorization: `Bearer ${token}` };
    agentStore.listAgents.mockReturnValue([
      { agent_id: agentId, display_name: 'Valid Agent' },
    ]);

    middleware(mockReq as Request, mockRes as Response, mockNext as NextFunction);
    expect(mockNext).toHaveBeenCalled();
    expect((mockReq as any).agentId).toBe(agentId);
  });

  it('should return 401 if no agent matches the token', () => {
    const token = createToken('some-agent', TEST_CONFIG.agentTokenSecret);
    mockReq.headers = { authorization: `Bearer ${token}` };
    agentStore.listAgents.mockReturnValue([]);

    middleware(mockReq as Request, mockRes as Response, mockNext as NextFunction);
    expect(mockRes.status).toHaveBeenCalledWith(401);
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should check all agents until it finds a matching token', () => {
    const agentId = 'matching-agent';
    const token = createToken(agentId, TEST_CONFIG.agentTokenSecret);
    mockReq.headers = { authorization: `Bearer ${token}` };
    agentStore.listAgents.mockReturnValue([
      { agent_id: 'first' },
      { agent_id: 'second' },
      { agent_id: agentId },
    ]);

    middleware(mockReq as Request, mockRes as Response, mockNext as NextFunction);
    expect(mockNext).toHaveBeenCalled();
    expect((mockReq as any).agentId).toBe(agentId);
  });
});

describe('requireAdmin', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: ReturnType<typeof vi.fn>;
  let middleware: ReturnType<typeof requireAdmin>;

  beforeEach(() => {
    mockReq = { headers: {} };
    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    mockNext = vi.fn();
    middleware = requireAdmin(TEST_CONFIG);
  });

  it('should return 401 if no Authorization header', () => {
    middleware(mockReq as Request, mockRes as Response, mockNext as NextFunction);
    expect(mockRes.status).toHaveBeenCalledWith(401);
  });

  it('should return 401 if not Bearer', () => {
    mockReq.headers = { authorization: 'Token xyz' };
    middleware(mockReq as Request, mockRes as Response, mockNext as NextFunction);
    expect(mockRes.status).toHaveBeenCalledWith(401);
  });

  it('should return 403 if token does not match admin token', () => {
    mockReq.headers = { authorization: 'Bearer wrong-token' };
    middleware(mockReq as Request, mockRes as Response, mockNext as NextFunction);
    expect(mockRes.status).toHaveBeenCalledWith(403);
  });

  it('should pass with correct admin token', () => {
    mockReq.headers = { authorization: `Bearer ${TEST_CONFIG.adminToken}` };
    middleware(mockReq as Request, mockRes as Response, mockNext as NextFunction);
    expect(mockNext).toHaveBeenCalled();
    expect((mockReq as any).agentId).toBe('__admin__');
  });

  it('should not accept non-admin valid agent token', () => {
    const agentToken = createToken('agent-1', TEST_CONFIG.agentTokenSecret);
    mockReq.headers = { authorization: `Bearer ${agentToken}` };
    middleware(mockReq as Request, mockRes as Response, mockNext as NextFunction);
    expect(mockRes.status).toHaveBeenCalledWith(403);
    expect(mockNext).not.toHaveBeenCalled();
  });
});
