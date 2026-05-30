import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import { ConnectionPool } from '../../src/core/connection-pool.js';

class MockWebSocket {
  readyState = WebSocket.OPEN;
  private listeners: Map<string, Array<(...args: any[]) => void>> = new Map();
  private _closeCode: number | null = null;
  private _closeReason: string | null = null;

  on(event: string, cb: (...args: any[]) => void) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event)!.push(cb);
    return this;
  }

  off(event: string, cb: (...args: any[]) => void) {
    const arr = this.listeners.get(event);
    if (arr) {
      const idx = arr.indexOf(cb);
      if (idx >= 0) arr.splice(idx, 1);
    }
    return this;
  }

  close(code?: number, reason?: string) {
    this._closeCode = code ?? 1000;
    this._closeReason = reason ?? '';
    this.readyState = WebSocket.CLOSED;
    // Trigger close listeners
    const closeListeners = this.listeners.get('close') ?? [];
    for (const cb of closeListeners) cb(code ?? 1000, reason ?? '');
  }

  get closeCode() { return this._closeCode; }
  get closeReason() { return this._closeReason; }
}

describe('ConnectionPool', () => {
  let pool: ConnectionPool;

  beforeEach(() => {
    pool = new ConnectionPool();
  });

  describe('register', () => {
    it('should register a new WebSocket connection', () => {
      const ws = new MockWebSocket() as any;
      pool.register('agent-1', ws);
      expect(pool.isOnline('agent-1')).toBe(true);
      expect(pool.getConnectionCount()).toBe(1);
    });

    it('should close existing connection on duplicate registration', () => {
      const ws1 = new MockWebSocket() as any;
      const ws2 = new MockWebSocket() as any;

      pool.register('agent-1', ws1);
      expect(ws1.readyState).toBe(WebSocket.OPEN);

      pool.register('agent-1', ws2);
      // ws1 should have been closed
      expect(ws1.readyState).toBe(WebSocket.CLOSED);
      expect(pool.getConnectionCount()).toBe(1);
      expect(pool.getConnection('agent-1')).toBe(ws2);
    });

    it('should auto-unregister when connection closes', () => {
      const ws = new MockWebSocket() as any;
      pool.register('agent-1', ws);
      expect(pool.isOnline('agent-1')).toBe(true);

      ws.close(1000, 'normal');
      expect(pool.isOnline('agent-1')).toBe(false);
      expect(pool.getConnectionCount()).toBe(0);
    });

    it('should set metadata on registration', () => {
      const ws = new MockWebSocket() as any;
      pool.register('agent-1', ws);
      const meta = (pool as any).getAgentMetadata('agent-1');
      expect(meta).not.toBeNull();
      expect(meta!.connectedAt).toBeTruthy();
    });
  });

  describe('unregister', () => {
    it('should unregister an agent and close its connection', () => {
      const ws = new MockWebSocket() as any;
      pool.register('agent-1', ws);
      expect(pool.isOnline('agent-1')).toBe(true);

      pool.unregister('agent-1');
      expect(pool.isOnline('agent-1')).toBe(false);
      expect(pool.getConnectionCount()).toBe(0);
      expect(ws.readyState).toBe(WebSocket.CLOSED);
    });

    it('should not throw when unregistering non-existent agent', () => {
      expect(() => pool.unregister('non-existent')).not.toThrow();
    });
  });

  describe('isOnline', () => {
    it('should return false for non-existent agent', () => {
      expect(pool.isOnline('non-existent')).toBe(false);
    });

    it('should return false for agent with closed connection', () => {
      const ws = new MockWebSocket() as any;
      pool.register('agent-1', ws);
      ws.close(1000, 'gone');
      expect(pool.isOnline('agent-1')).toBe(false);
    });
  });

  describe('getOnlineAgents', () => {
    it('should return empty array when no agents online', () => {
      expect(pool.getOnlineAgents()).toEqual([]);
    });

    it('should return all registered agent IDs', () => {
      const ws1 = new MockWebSocket() as any;
      const ws2 = new MockWebSocket() as any;
      pool.register('agent-a', ws1);
      pool.register('agent-b', ws2);

      const agents = pool.getOnlineAgents();
      expect(agents).toHaveLength(2);
      expect(agents).toContain('agent-a');
      expect(agents).toContain('agent-b');
    });

    it('should not include unregistered agents', () => {
      const ws = new MockWebSocket() as any;
      pool.register('agent-temp', ws);
      pool.unregister('agent-temp');

      expect(pool.getOnlineAgents()).toEqual([]);
    });
  });

  describe('getConnectionCount', () => {
    it('should return 0 initially', () => {
      expect(pool.getConnectionCount()).toBe(0);
    });

    it('should reflect current connection count', () => {
      const ws1 = new MockWebSocket() as any;
      const ws2 = new MockWebSocket() as any;
      pool.register('agent-1', ws1);
      expect(pool.getConnectionCount()).toBe(1);

      pool.register('agent-2', ws2);
      expect(pool.getConnectionCount()).toBe(2);

      pool.unregister('agent-1');
      expect(pool.getConnectionCount()).toBe(1);
    });
  });

  describe('getConnection', () => {
    it('should return null for non-existent agent', () => {
      expect(pool.getConnection('non-existent')).toBeNull();
    });

    it('should return the stored WebSocket', () => {
      const ws = new MockWebSocket() as any;
      pool.register('agent-1', ws);
      expect(pool.getConnection('agent-1')).toBe(ws);
    });
  });

  describe('getAgentMetadata', () => {
    it('should return null for non-existent agent', () => {
      expect((pool as any).getAgentMetadata('nope')).toBeNull();
    });

    it('should return metadata for registered agent', () => {
      const ws = new MockWebSocket() as any;
      pool.register('agent-meta', ws);
      const meta = (pool as any).getAgentMetadata('agent-meta');
      expect(meta).not.toBeNull();
      expect(meta!.connectedAt).toBeTruthy();
      expect(() => new Date(meta!.connectedAt)).not.toThrow();
    });
  });

  describe('clear', () => {
    it('should close all connections and clear the pool', () => {
      const ws1 = new MockWebSocket() as any;
      const ws2 = new MockWebSocket() as any;
      pool.register('agent-1', ws1);
      pool.register('agent-2', ws2);

      pool.clear();

      expect(pool.getConnectionCount()).toBe(0);
      expect(pool.getOnlineAgents()).toEqual([]);
      expect(ws1.readyState).toBe(WebSocket.CLOSED);
      expect(ws2.readyState).toBe(WebSocket.CLOSED);
    });

    it('should handle empty pool', () => {
      expect(() => pool.clear()).not.toThrow();
    });
  });
});
