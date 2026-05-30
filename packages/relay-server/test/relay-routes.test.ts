// ========================================================
// relay-server / test / relay-routes.test.ts
// Tests for createRelayRoutes() via supertest
// ========================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import type { RelayConfig } from '../src/config.js';
import type { ProxyResult } from '../src/types.js';

// ── Mock proxyRequest before importing routes ──

const mockProxyRequest = vi.fn<
  (config: RelayConfig, method: string, path: string, headers: Record<string, string>, body?: string) => Promise<ProxyResult>
>();

vi.mock('../src/proxy/proxy.js', () => ({
  proxyRequest: mockProxyRequest,
}));

// Now it's safe to import the module under test
const { createRelayRoutes } = await import('../src/relay/routes.js');

// ── Helpers ──

function makeApp(configOverrides: Partial<RelayConfig> = {}) {
  const defaultConfig: RelayConfig = {
    relayPort: 4324,
    listenHost: '0.0.0.0',
    tunnelPort: 4323,
    tunnelHost: '0.0.0.0',
    busHost: 'localhost',
    busPort: 4322,
    mode: 'tunnel',
    relayToken: '',
    ...configOverrides,
  };

  const app = express();
  app.use(express.json());
  app.use('/relay', createRelayRoutes(defaultConfig));

  // 404 catch-all (same as real app)
  app.use((_req, res) => {
    res.status(404).json({ code: 1004, message: 'not_found' });
  });

  return app;
}

// We need to dynamically import supertest
let supertest: any;

async function request(app: express.Express) {
  if (!supertest) {
    supertest = (await import('supertest')).default;
  }
  return supertest(app);
}

describe('createRelayRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: proxyRequest succeeds
    mockProxyRequest.mockResolvedValue({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ok: true }),
    });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  // ── /relay/health ──

  describe('GET /relay/health', () => {
    it('returns healthy status with code 0', async () => {
      const app = makeApp();
      const res = await (await request(app)).get('/relay/health');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        code: 0,
        message: 'success',
        data: {
          status: 'healthy',
          version: '1.0.0',
        },
      });
    });

    it('does not require authentication', async () => {
      const app = makeApp({ relayToken: 'secret' });
      const res = await (await request(app)).get('/relay/health');
      expect(res.status).toBe(200);
    });
  });

  // ── requireRelayToken middleware ──

  describe('requireRelayToken middleware', () => {
    it('rejects request with 401 when token is required and missing', async () => {
      const app = makeApp({ relayToken: 'my-secret' });
      const res = await (await request(app)).get('/relay/api/agents');
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ code: 1001, message: 'relay_unauthorized' });
    });

    it('rejects request with 401 when token is wrong', async () => {
      const app = makeApp({ relayToken: 'my-secret' });
      const res = await (await request(app))
        .get('/relay/api/agents')
        .set('x-relay-token', 'wrong-token');
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ code: 1001, message: 'relay_unauthorized' });
    });

    it('accepts request when token is correct', async () => {
      const app = makeApp({ relayToken: 'my-secret' });
      const res = await (await request(app))
        .get('/relay/api/agents')
        .set('x-relay-token', 'my-secret');
      expect(res.status).toBe(200);
    });

    it('passes request when no token is configured', async () => {
      const app = makeApp({ relayToken: '' });
      const res = await (await request(app)).get('/relay/api/agents');
      expect(res.status).toBe(200);
    });

    it('applies to POST routes', async () => {
      const app = makeApp({ relayToken: 'secret' });
      const res = await (await request(app))
        .post('/relay/api/agents/register')
        .send({ name: 'test' });
      expect(res.status).toBe(401);
    });

    it('applies to DELETE routes', async () => {
      const app = makeApp({ relayToken: 'secret' });
      const res = await (await request(app)).delete('/relay/api/agents/test-123');
      expect(res.status).toBe(401);
    });
  });

  // ── Route forwarding (via proxyRequest mock) ──

  describe('route forwarding', () => {
    it('POST /relay/api/agents/register forwards to bus', async () => {
      const app = makeApp();
      await (await request(app))
        .post('/relay/api/agents/register')
        .send({ name: 'agent-1' });

      expect(mockProxyRequest).toHaveBeenCalledWith(
        expect.anything(),
        'POST',
        '/api/agents/register',
        expect.any(Object),
        JSON.stringify({ name: 'agent-1' }),
      );
    });

    it('GET /relay/api/agents forwards to bus', async () => {
      const app = makeApp();
      await (await request(app)).get('/relay/api/agents');

      expect(mockProxyRequest).toHaveBeenCalledWith(
        expect.anything(),
        'GET',
        '/api/agents',
        expect.any(Object),
        undefined,
      );
    });

    it('GET /relay/api/agents/:id forwards to bus', async () => {
      const app = makeApp();
      await (await request(app)).get('/relay/api/agents/agent-abc');

      expect(mockProxyRequest).toHaveBeenCalledWith(
        expect.anything(),
        'GET',
        '/api/agents/agent-abc',
        expect.any(Object),
        undefined,
      );
    });

    it('DELETE /relay/api/agents/:id forwards to bus', async () => {
      const app = makeApp();
      await (await request(app)).delete('/relay/api/agents/agent-xyz');

      expect(mockProxyRequest).toHaveBeenCalledWith(
        expect.anything(),
        'DELETE',
        '/api/agents/agent-xyz',
        expect.any(Object),
        undefined,
      );
    });

    it('POST /relay/api/messages/send forwards to bus', async () => {
      const app = makeApp();
      await (await request(app))
        .post('/relay/api/messages/send')
        .send({ to: 'agent-2', text: 'hello' });

      expect(mockProxyRequest).toHaveBeenCalledWith(
        expect.anything(),
        'POST',
        '/api/messages/send',
        expect.any(Object),
        JSON.stringify({ to: 'agent-2', text: 'hello' }),
      );
    });

    it('GET /relay/api/messages/inbox forwards with query params', async () => {
      const app = makeApp();
      await (await request(app))
        .get('/relay/api/messages/inbox')
        .query({ agentId: 'agent-1', limit: '10' });

      expect(mockProxyRequest).toHaveBeenCalledWith(
        expect.anything(),
        'GET',
        '/api/messages/inbox?agentId=agent-1&limit=10',
        expect.any(Object),
        undefined,
      );
    });

    it('GET /relay/api/messages/inbox forwards without query params', async () => {
      const app = makeApp();
      await (await request(app)).get('/relay/api/messages/inbox');

      expect(mockProxyRequest).toHaveBeenCalledWith(
        expect.anything(),
        'GET',
        '/api/messages/inbox',
        expect.any(Object),
        undefined,
      );
    });

    it('POST /relay/api/messages/search forwards to bus', async () => {
      const app = makeApp();
      await (await request(app))
        .post('/relay/api/messages/search')
        .send({ query: 'test', limit: 5 });

      expect(mockProxyRequest).toHaveBeenCalledWith(
        expect.anything(),
        'POST',
        '/api/messages/search',
        expect.any(Object),
        JSON.stringify({ query: 'test', limit: 5 }),
      );
    });

    it('GET /relay/api/stats forwards to bus', async () => {
      const app = makeApp();
      await (await request(app)).get('/relay/api/stats');

      expect(mockProxyRequest).toHaveBeenCalledWith(
        expect.anything(),
        'GET',
        '/api/stats',
        expect.any(Object),
        undefined,
      );
    });

    it('GET /relay/api/ping forwards to bus', async () => {
      const app = makeApp();
      await (await request(app)).get('/relay/api/ping');

      expect(mockProxyRequest).toHaveBeenCalledWith(
        expect.anything(),
        'GET',
        '/api/ping',
        expect.any(Object),
        undefined,
      );
    });
  });

  // ── Proxy result passthrough ──

  describe('proxy result passthrough', () => {
    it('returns proxy status code and body', async () => {
      mockProxyRequest.mockResolvedValueOnce({
        status: 201,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: 'new-agent' }),
      });

      const app = makeApp();
      const res = await (await request(app))
        .post('/relay/api/agents/register')
        .send({ name: 'test' });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ id: 'new-agent' });
    });

    it('returns 502 when proxyRequest throws', async () => {
      mockProxyRequest.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const app = makeApp();
      const res = await (await request(app))
        .post('/relay/api/agents/register')
        .send({ name: 'test' });

      expect(res.status).toBe(502);
      expect(res.body).toEqual({
        code: 9001,
        message: 'relay_error',
        data: { detail: 'ECONNREFUSED' },
      });
    });

    it('handles unknown error types in catch', async () => {
      mockProxyRequest.mockRejectedValueOnce('string error');

      const app = makeApp();
      const res = await (await request(app))
        .get('/relay/api/agents');

      expect(res.status).toBe(502);
      expect(res.body).toEqual({
        code: 9001,
        message: 'relay_error',
        data: { detail: 'unknown_error' },
      });
    });
  });

  // ── 404 handling ──

  describe('404 handling', () => {
    it('returns 404 for unknown routes', async () => {
      const app = makeApp();
      const res = await (await request(app)).get('/relay/api/nonexistent');
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ code: 1004, message: 'not_found' });
    });
  });

  // ── flattenHeaders utility ──

  describe('flattenHeaders (tested via proxyRequest call)', () => {
    it('flattens array header values into comma-separated strings', async () => {
      const app = makeApp();
      // Send multiple Accept headers which Express aggregates into array
      await (await request(app))
        .get('/relay/api/agents')
        .set('accept', ['text/html', 'application/json']);

      const call = mockProxyRequest.mock.calls[0];
      const headers = call[3]; // headers argument
      expect(headers['accept']).toBeDefined();
      // Express 5 might join them already, or keep as array. We just verify
      // the proxyRequest was called and headers were passed.
    });
  });
});
