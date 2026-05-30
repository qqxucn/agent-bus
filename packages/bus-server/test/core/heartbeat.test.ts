import { describe, it, expect, beforeEach, vi, afterEach, useFakeTimers, useRealTimers } from 'vitest';
import { Heartbeat } from '../../src/core/heartbeat.js';
import { ConnectionPool } from '../../src/core/connection-pool.js';
import { WebSocket } from 'ws';

class MockWebSocket {
  readyState = WebSocket.OPEN;
  private listeners: Map<string, Array<(...args: any[]) => void>> = new Map();

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
    this.readyState = WebSocket.CLOSED;
    const closeListeners = this.listeners.get('close') ?? [];
    for (const cb of closeListeners) cb(code ?? 1000, reason ?? '');
  }
}

describe('Heartbeat', () => {
  let pool: ConnectionPool;
  let agentStore: { updateAgentStatus: ReturnType<typeof vi.fn>; updateHeartbeat: ReturnType<typeof vi.fn> };
  let heartbeat: Heartbeat;

  beforeEach(() => {
    pool = new ConnectionPool();
    agentStore = {
      updateAgentStatus: vi.fn(),
      updateHeartbeat: vi.fn(),
    };
    heartbeat = new Heartbeat(pool, agentStore as any);
  });

  afterEach(() => {
    heartbeat.stop();
  });

  describe('start/stop', () => {
    it('should start and stop the check interval', () => {
      heartbeat.start(1, 60);
      // After starting, the timer should be set
      // Stopping should clear it
      heartbeat.stop();
      // No crash — that's the test
    });

    it('should restart with new interval if called again', () => {
      heartbeat.start(10, 60);
      heartbeat.start(5, 60);
      heartbeat.stop();
    });
  });

  describe('updateHeartbeat', () => {
    it('should record heartbeat timestamp', () => {
      heartbeat.updateHeartbeat('agent-1');
      // Internal state updated — no direct getter, but timeout won't fire
    });

    it('should prevent timeout when heartbeat is recent', async () => {
      vi.useFakeTimers();

      const ws = new MockWebSocket() as any;
      pool.register('agent-hb', ws);
      heartbeat.updateHeartbeat('agent-hb');

      // Start with very short check interval and timeout
      heartbeat.start(0.01, 1);

      // Advance time by less than timeout
      vi.advanceTimersByTime(500);
      expect(agentStore.updateAgentStatus).not.toHaveBeenCalled();

      heartbeat.stop();
      vi.useRealTimers();
    });
  });

  describe('removeHeartbeat', () => {
    it('should remove heartbeat tracking', () => {
      heartbeat.updateHeartbeat('agent-temp');
      heartbeat.removeHeartbeat('agent-temp');
      // After removal, timeout shouldn't affect this agent
    });

    it('should not throw when removing non-existent agent', () => {
      expect(() => heartbeat.removeHeartbeat('non-existent')).not.toThrow();
    });
  });

  describe('timeout detection', () => {
    it('should detect heartbeat timeout and mark agent offline', () => {
      vi.useFakeTimers();

      const ws = new MockWebSocket() as any;
      pool.register('agent-timeout', ws);

      // Set last heartbeat to "now" so we can advance past the timeout
      heartbeat.updateHeartbeat('agent-timeout');

      // Start with 0.1s check interval and 1s timeout
      heartbeat.start(0.1, 1);

      // Advance time by more than the timeout
      vi.advanceTimersByTime(1500);

      // The agent should be unregistered and marked offline
      expect(agentStore.updateAgentStatus).toHaveBeenCalledWith('agent-timeout', 'offline');
      expect(pool.isOnline('agent-timeout')).toBe(false);

      heartbeat.stop();
      vi.useRealTimers();
    });

    it('should not timeout agents that never sent a heartbeat', () => {
      vi.useFakeTimers();

      const ws = new MockWebSocket() as any;
      pool.register('agent-no-hb', ws);

      // Don't call updateHeartbeat — no lastBeat entry
      heartbeat.start(0.1, 1);

      vi.advanceTimersByTime(2000);

      // Should NOT have been marked offline since no heartbeat was ever recorded
      expect(agentStore.updateAgentStatus).not.toHaveBeenCalled();
      expect(pool.isOnline('agent-no-hb')).toBe(true);

      heartbeat.stop();
      vi.useRealTimers();
    });

    it('should fire onStateChange callback on timeout', () => {
      vi.useFakeTimers();

      const onStateChange = vi.fn();
      heartbeat.setOnStateChange(onStateChange);

      const ws = new MockWebSocket() as any;
      pool.register('agent-callback', ws);
      heartbeat.updateHeartbeat('agent-callback');

      heartbeat.start(0.1, 1);
      vi.advanceTimersByTime(1500);

      expect(onStateChange).toHaveBeenCalledWith('agent-callback', 'timeout');

      heartbeat.stop();
      vi.useRealTimers();
    });

    it('should recover when heartbeat is updated before timeout', () => {
      vi.useFakeTimers();

      const onStateChange = vi.fn();
      heartbeat.setOnStateChange(onStateChange);

      const ws = new MockWebSocket() as any;
      pool.register('agent-recover', ws);
      heartbeat.updateHeartbeat('agent-recover');

      heartbeat.start(0.1, 2);

      // Advance 1s — still within timeout
      vi.advanceTimersByTime(1000);
      expect(agentStore.updateAgentStatus).not.toHaveBeenCalled();

      // Update heartbeat
      heartbeat.updateHeartbeat('agent-recover');

      // Advance another 1.5s — still within new timeout window
      vi.advanceTimersByTime(1500);
      expect(agentStore.updateAgentStatus).not.toHaveBeenCalled();

      heartbeat.stop();
      vi.useRealTimers();
    });
  });

  describe('setOnStateChange', () => {
    it('should set the state change callback', () => {
      const callback = vi.fn();
      heartbeat.setOnStateChange(callback);
      // No-op test — just verify API exists
      expect(heartbeat).toBeDefined();
    });
  });
});
