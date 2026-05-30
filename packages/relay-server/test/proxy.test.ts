// ========================================================
// relay-server / test / proxy.test.ts
// Tests for proxyRequest() — mocks node:http/https
// ========================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { proxyRequest } from '../src/proxy/proxy.js';
import type { RelayConfig } from '../src/config.js';

// We mock node:http by intercepting vi.mock calls
// Since the module uses dynamic imports of http/https, we patch at runtime
const mockConfig: RelayConfig = {
  relayPort: 4324,
  listenHost: '0.0.0.0',
  tunnelPort: 4323,
  tunnelHost: '0.0.0.0',
  busHost: 'localhost',
  busPort: 4322,
  mode: 'tunnel',
  relayToken: '',
};

/**
 * Helper: creates a mock http.IncomingMessage-like response
 */
function createMockResponse(overrides: {
  statusCode?: number;
  headers?: Record<string, string>;
  body?: string;
}): any {
  const statusCode = overrides.statusCode ?? 200;
  const headers = overrides.headers ?? { 'content-type': 'application/json' };
  const body = overrides.body ?? '{"ok":true}';

  const mockRes: any = {
    statusCode,
    headers,
    on: vi.fn((event: string, handler: (...args: any[]) => void) => {
      if (event === 'data') {
        handler(Buffer.from(body));
      }
      if (event === 'end') {
        handler();
      }
      return mockRes;
    }),
  };
  return mockRes;
}

/**
 * Creates a mock http.request function and a mock req object
 */
function createMockHttp(requestImpl?: (options: any, callback: (res: any) => void) => any) {
  const mockReq: any = {
    on: vi.fn((_event: string, _handler: (...args: any[]) => void) => mockReq),
    write: vi.fn(),
    end: vi.fn(),
    destroy: vi.fn(),
  };

  const mockRequest = vi.fn((options: any, callback: (res: any) => void) => {
    if (requestImpl) {
      return requestImpl(options, callback);
    }
    // Default: respond with 200
    callback(createMockResponse({}));
    return mockReq;
  });

  return { mockRequest, mockReq };
}

describe('proxyRequest', () => {
  let httpMock: ReturnType<typeof createMockHttp>;

  beforeEach(async () => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('successfully forwards a GET request and returns response', async () => {
    const { mockRequest, mockReq } = createMockHttp((options, callback) => {
      callback(createMockResponse({
        statusCode: 200,
        headers: { 'content-type': 'application/json', 'x-custom': 'value' },
        body: '{"result":"ok"}',
      }));
      return mockReq;
    });

    // Mock http module
    vi.doMock('node:http', () => ({
      default: { request: mockRequest },
      request: mockRequest,
    }));

    // Re-import proxyRequest after mocking
    const { proxyRequest: proxied } = await import('../src/proxy/proxy.js');

    const result = await proxied(
      mockConfig,
      'GET',
      '/api/agents',
      { authorization: 'Bearer token123' },
    );

    expect(result.status).toBe(200);
    expect(result.body).toBe('{"result":"ok"}');
    expect(result.headers['content-type']).toBe('application/json');
    expect(result.headers['x-custom']).toBe('value');
  });

  it('successfully forwards a POST request with body', async () => {
    const { mockRequest, mockReq } = createMockHttp((options, callback) => {
      expect(options.method).toBe('POST');
      callback(createMockResponse({
        statusCode: 201,
        headers: { 'content-type': 'application/json' },
        body: '{"id":"agent-1"}',
      }));
      return mockReq;
    });

    vi.doMock('node:http', () => ({
      default: { request: mockRequest },
      request: mockRequest,
    }));

    const { proxyRequest: proxied } = await import('../src/proxy/proxy.js');

    const result = await proxied(
      mockConfig,
      'POST',
      '/api/agents/register',
      { 'content-type': 'application/json' },
      JSON.stringify({ name: 'test-agent' }),
    );

    expect(result.status).toBe(201);
    expect(result.body).toBe('{"id":"agent-1"}');
    expect(mockReq.write).toHaveBeenCalledWith(JSON.stringify({ name: 'test-agent' }));
    expect(mockReq.end).toHaveBeenCalled();
  });

  it('strips host and x-relay-token headers', async () => {
    const { mockRequest, mockReq } = createMockHttp((options, callback) => {
      // Verify the headers passed to http.request don't include host or x-relay-token
      expect(Object.keys(options.headers)).not.toContain('host');
      expect(Object.keys(options.headers)).not.toContain('Host');
      expect(Object.keys(options.headers)).not.toContain('x-relay-token');
      expect(options.headers['authorization']).toBe('Bearer valid');
      callback(createMockResponse({}));
      return mockReq;
    });

    vi.doMock('node:http', () => ({
      default: { request: mockRequest },
      request: mockRequest,
    }));

    const { proxyRequest: proxied } = await import('../src/proxy/proxy.js');

    await proxied(
      mockConfig,
      'GET',
      '/api/agents',
      {
        host: 'relay.example.com',
        'x-relay-token': 'secret',
        authorization: 'Bearer valid',
      },
    );
  });

  it('passes the correct request options to http.request', async () => {
    const { mockRequest, mockReq } = createMockHttp((options, callback) => {
      expect(options.hostname).toBe('localhost');
      expect(options.port).toBe(4322);
      expect(options.path).toBe('/api/agents/test-123');
      expect(options.method).toBe('DELETE');
      expect(options.timeout).toBe(30000);
      callback(createMockResponse({}));
      return mockReq;
    });

    vi.doMock('node:http', () => ({
      default: { request: mockRequest },
      request: mockRequest,
    }));

    const { proxyRequest: proxied } = await import('../src/proxy/proxy.js');

    await proxied(
      mockConfig,
      'DELETE',
      '/api/agents/test-123',
      {},
    );
  });

  it('returns 502 on connection error', async () => {
    const { mockRequest, mockReq } = createMockHttp((options, callback) => {
      // trigger the error handler
      setImmediate(() => {
        mockReq.on.mock.calls.forEach(([event, handler]: [string, Function]) => {
          if (event === 'error') {
            handler(new Error('ECONNREFUSED: connection refused'));
          }
        });
      });
      return mockReq;
    });

    vi.doMock('node:http', () => ({
      default: { request: mockRequest },
      request: mockRequest,
    }));

    const { proxyRequest: proxied } = await import('../src/proxy/proxy.js');

    await expect(proxied(
      mockConfig,
      'GET',
      '/api/agents',
      {},
    )).rejects.toThrow(/proxy_connection_error/);
  });

  it('returns 502 on timeout', async () => {
    const { mockRequest, mockReq } = createMockHttp((options, callback) => {
      // trigger the timeout handler
      setImmediate(() => {
        mockReq.on.mock.calls.forEach(([event, handler]: [string, Function]) => {
          if (event === 'timeout') {
            handler();
          }
        });
      });
      return mockReq;
    });

    vi.doMock('node:http', () => ({
      default: { request: mockRequest },
      request: mockRequest,
    }));

    const { proxyRequest: proxied } = await import('../src/proxy/proxy.js');

    await expect(proxied(
      mockConfig,
      'GET',
      '/api/agents',
      {},
    )).rejects.toThrow('proxy_timeout');
  });

  it('handles a DELETE request without body', async () => {
    const { mockRequest, mockReq } = createMockHttp((options, callback) => {
      expect(options.method).toBe('DELETE');
      callback(createMockResponse({ statusCode: 204, body: '' }));
      return mockReq;
    });

    vi.doMock('node:http', () => ({
      default: { request: mockRequest },
      request: mockRequest,
    }));

    const { proxyRequest: proxied } = await import('../src/proxy/proxy.js');

    const result = await proxied(
      mockConfig,
      'DELETE',
      '/api/agents/agent-1',
      {},
    );

    expect(result.status).toBe(204);
    expect(result.body).toBe('');
    expect(mockReq.write).not.toHaveBeenCalled();
    expect(mockReq.end).toHaveBeenCalled();
  });

  it('handles empty response body', async () => {
    const { mockRequest, mockReq } = createMockHttp((options, callback) => {
      callback(createMockResponse({ statusCode: 204, body: '' }));
      return mockReq;
    });

    vi.doMock('node:http', () => ({
      default: { request: mockRequest },
      request: mockRequest,
    }));

    const { proxyRequest: proxied } = await import('../src/proxy/proxy.js');

    const result = await proxied(
      mockConfig,
      'DELETE',
      '/api/agents/agent-1',
      {},
    );

    expect(result.body).toBe('');
  });
});
