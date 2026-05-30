import { describe, it, expect } from 'vitest';
import { MessageManager, SessionContext } from '../src/message';

describe('MessageManager', () => {
  it('首次收到的消息不应判为重复', () => {
    const mgr = new MessageManager();
    expect(mgr.isDuplicate('msg_001')).toBe(false);
  });

  it('同一条消息不应判两次', () => {
    const mgr = new MessageManager();
    mgr.isDuplicate('msg_001');
    expect(mgr.isDuplicate('msg_001')).toBe(true);
  });

  it('不同消息不应互相影响', () => {
    const mgr = new MessageManager();
    mgr.isDuplicate('msg_001');
    expect(mgr.isDuplicate('msg_002')).toBe(false);
  });

  it('消息去重后应交给 handler', async () => {
    const mgr = new MessageManager();
    const handled: string[] = [];

    mgr.setMessageHandler(async (msg) => {
      handled.push(msg.message_id);
    });

    await mgr.handleMessage({
      message_id: 'msg_001',
      from_agent: 'test-agent-b',
      sender_type: 'agent',
      to_agent: 'test-agent',
      type: 'text',
      content: '你好',
      sent_at: new Date().toISOString(),
    });

    expect(handled).toHaveLength(1);
    expect(handled[0]).toBe('msg_001');
  });

  it('重复消息不应交给 handler', async () => {
    const mgr = new MessageManager();
    const handled: string[] = [];

    mgr.setMessageHandler(async (msg) => {
      handled.push(msg.message_id);
    });

    await mgr.handleMessage({
      message_id: 'msg_001',
      from_agent: 'test-agent-b',
      sender_type: 'agent',
      to_agent: 'test-agent',
      type: 'text',
      content: '你好',
      sent_at: new Date().toISOString(),
    });

    await mgr.handleMessage({
      message_id: 'msg_001',
      from_agent: 'test-agent-b',
      sender_type: 'agent',
      to_agent: 'test-agent',
      type: 'text',
      content: '你好',
      sent_at: new Date().toISOString(),
    });

    expect(handled).toHaveLength(1);
  });

  it('带 session_id 的消息创建上下文', async () => {
    const mgr = new MessageManager();
    const handled: string[] = [];

    mgr.setMessageHandler(async (msg) => {
      handled.push(msg.message_id);
    });

    await mgr.handleMessage({
      message_id: 'msg_001',
      from_agent: 'test-agent-b',
      sender_type: 'agent',
      to_agent: 'test-agent',
      type: 'text',
      content: '对话1',
      sent_at: new Date().toISOString(),
      session_id: 'session-alpha',
    });

    const ctx = mgr.sessionContext.getContext('test-agent-b', 'session-alpha');
    expect(ctx).toBeDefined();
    expect(handled).toHaveLength(1);
  });

  it('相同 session_id 复用同一个上下文', () => {
    const sc = new SessionContext();

    expect(sc.activeCount).toBe(0);

    const ctx1 = sc.getContext('test-agent-b', 'session-alpha');
    ctx1.step = 1;

    const ctx2 = sc.getContext('test-agent-b', 'session-alpha');
    expect(ctx2.step).toBe(1);
    expect(sc.activeCount).toBe(1);
  });

  it('不同发送方的 session_id 隔离', () => {
    const sc = new SessionContext();

    sc.getContext('test-agent-b', 'task-001').step = 1;
    sc.getContext('test-agent', 'task-001').step = 2;

    expect(sc.getContext('test-agent-b', 'task-001').step).toBe(1);
    expect(sc.getContext('test-agent', 'task-001').step).toBe(2);
    expect(sc.activeCount).toBe(2);
  });

  it('updateContext 合并已有数据', () => {
    const sc = new SessionContext();

    sc.getContext('test-agent-b', 'session-x').count = 1;
    sc.updateContext('test-agent-b', 'session-x', { name: 'test' });

    expect(sc.getContext('test-agent-b', 'session-x')).toEqual({ count: 1, name: 'test' });
  });

  it('endSession 清除上下文', () => {
    const sc = new SessionContext();

    sc.getContext('test-agent-b', 'temporary');
    expect(sc.activeCount).toBe(1);

    sc.endSession('test-agent-b', 'temporary');
    expect(sc.activeCount).toBe(0);
  });

  it('不传 sessionId 使用默认会话', () => {
    const sc = new SessionContext();

    sc.getContext('test-agent-b').value = 'default';
    sc.getContext('test-agent').value = 'default2';

    expect(sc.activeCount).toBe(2);
    expect(sc.getContext('test-agent-b').value).toBe('default');
  });
});
