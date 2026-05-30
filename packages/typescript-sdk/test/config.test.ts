import { describe, it, expect } from 'vitest';
import { ConfigManager } from '../src/config';

describe('ConfigManager', () => {
  it('应该通过完整配置的验证', () => {
    const mgr = new ConfigManager();
    const config = mgr.validate({
      mode: 'websocket',
      busUrl: 'http://localhost:4322',
      busWsUrl: 'ws://localhost:4322/ws',
      agentId: 'test-agent',
      agentToken: 'test-token',
    });

    expect(config.mode).toBe('websocket');
    expect(config.busUrl).toBe('http://localhost:4322');

    // 默认值
    expect(config.pollInterval).toBe(3);
    expect(config.reconnectInterval).toBe(3);
    expect(config.maxReconnectInterval).toBe(30);
    expect(config.maxReconnectAttempts).toBe(10);
    expect(config.heartbeatInterval).toBe(30);
    expect(config.fileMode).toBe('sandbox');
    expect(config.maxFileSizeMb).toBe(10);
  });

  it('应该接受覆盖默认值', () => {
    const mgr = new ConfigManager();
    const config = mgr.validate({
      mode: 'websocket',
      busUrl: 'http://localhost:4322',
      busWsUrl: 'ws://localhost:4322/ws',
      agentId: 'test-agent',
      agentToken: 'test-token',
      pollInterval: 5,
      reconnectInterval: 2,
      maxReconnectInterval: 20,
      maxReconnectAttempts: 5,
      heartbeatInterval: 15,
      fileMode: 'base64',
      maxFileSizeMb: 5,
    });

    expect(config.pollInterval).toBe(5);
    expect(config.reconnectInterval).toBe(2);
    expect(config.maxReconnectInterval).toBe(20);
    expect(config.maxReconnectAttempts).toBe(5);
    expect(config.heartbeatInterval).toBe(15);
    expect(config.fileMode).toBe('base64');
    expect(config.maxFileSizeMb).toBe(5);
  });

  it('WS 模式下 busWsUrl 缺失应报错', () => {
    const mgr = new ConfigManager();
    expect(() => mgr.validate({
      mode: 'websocket',
      busUrl: 'http://localhost:4322',
      agentId: 'test-agent',
      agentToken: 'test-token',
    })).toThrow();
  });

  it('必填字段缺失应报错', () => {
    const mgr = new ConfigManager();
    expect(() => mgr.validate({})).toThrow();
    expect(() => mgr.validate({ busUrl: '123' })).toThrow();
  });

  it('轮询模式不需要 busWsUrl', () => {
    const mgr = new ConfigManager();
    const config = mgr.validate({
      mode: 'poll',
      busUrl: 'http://localhost:4322',
      agentId: 'test-agent',
      agentToken: 'test-token',
    });
    expect(config.mode).toBe('poll');
    expect(config.busWsUrl).toBeUndefined();
  });

  it('无效 mode 应报错', () => {
    const mgr = new ConfigManager();
    expect(() => mgr.validate({
      mode: 'grpc' as any,
      busUrl: 'http://localhost:4322',
      agentId: 'test-agent',
      agentToken: 'test-token',
    })).toThrow();
  });

  it('skipRegistrationIfTokenSet 应透传到配置中', () => {
    const mgr = new ConfigManager();
    const config = mgr.validate({
      mode: 'poll',
      busUrl: 'http://localhost:4322',
      agentId: 'test-agent',
      agentToken: 'test-token',
      skipRegistrationIfTokenSet: false,
    });
    expect(config.skipRegistrationIfTokenSet).toBe(false);
  });

  it('skipRegistrationIfTokenSet 不传时应为 undefined', () => {
    const mgr = new ConfigManager();
    const config = mgr.validate({
      mode: 'poll',
      busUrl: 'http://localhost:4322',
      agentId: 'test-agent',
      agentToken: 'test-token',
    });
    expect(config.skipRegistrationIfTokenSet).toBeUndefined();
  });
});
