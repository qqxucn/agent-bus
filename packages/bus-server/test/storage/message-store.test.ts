import { describe, it, expect, beforeEach } from 'vitest';
import initSqlJs from 'sql.js';
import { v4 as uuidv4 } from 'uuid';
import { createMessageStore } from '../../src/storage/message-store.js';
import type { BusMessage, InboxQuery, MessageLogQuery, MessageSearchRequest } from '../../src/types/index.js';

async function createTestDb() {
  const SQL = await initSqlJs();
  const db = new SQL.Database();

  db.run(`CREATE TABLE IF NOT EXISTS messages (
    message_id TEXT PRIMARY KEY,
    from_agent TEXT NOT NULL,
    sender_type TEXT DEFAULT 'agent',
    to_agent TEXT NOT NULL,
    type TEXT NOT NULL,
    content TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    sent_at TEXT NOT NULL,
    delivered_at TEXT,
    read_at TEXT,
    ref_id TEXT,
    session_id TEXT,
    file_id TEXT,
    file_name TEXT,
    file_size INTEGER,
    caption TEXT
  )`);

  db.run('CREATE INDEX IF NOT EXISTS idx_messages_to_agent ON messages(to_agent, sent_at DESC)');
  db.run('CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(status)');

  const database = {
    db,
    save: () => {},
    close: () => { db.close(); },
  };

  return database;
}

function makeMessage(overrides: Partial<BusMessage> = {}): BusMessage {
  return {
    message_id: uuidv4(),
    from_agent: 'agent-sender',
    sender_type: 'agent',
    to_agent: 'agent-receiver',
    type: 'text',
    content: 'Hello, world!',
    sent_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('MessageStore', () => {
  let store: ReturnType<typeof createMessageStore>;
  let db: any;

  beforeEach(async () => {
    const testDb = await createTestDb();
    db = testDb;
    store = createMessageStore(testDb);
  });

  describe('saveMessage', () => {
    it('should save a message and return its id', () => {
      const msg = makeMessage();
      const id = store.saveMessage(msg);
      expect(id).toBe(msg.message_id);
    });

    it('should generate a new uuid if message_id is not provided', () => {
      const msg = makeMessage({ message_id: '' } as any);
      const id = store.saveMessage(msg);
      expect(id).toBeTruthy();
      expect(typeof id).toBe('string');
    });

    it('should save all fields including file metadata', () => {
      const msg = makeMessage({
        type: 'file',
        content: 'file content',
        file_id: 'file-123',
        file_name: 'test.pdf',
        file_size: 1024,
        caption: 'A test file',
      });
      store.saveMessage(msg);

      const retrieved = store.getMessage(msg.message_id)!;
      expect(retrieved.file_id).toBe('file-123');
      expect(retrieved.file_name).toBe('test.pdf');
      expect(retrieved.file_size).toBe(1024);
      expect(retrieved.caption).toBe('A test file');
    });

    it('should save messages with ref_id and session_id', () => {
      const msg = makeMessage({
        ref_id: 'ref-abc',
        session_id: 'session-xyz',
      });
      store.saveMessage(msg);

      const retrieved = store.getMessage(msg.message_id)!;
      expect(retrieved.ref_id).toBe('ref-abc');
      expect(retrieved.session_id).toBe('session-xyz');
    });
  });

  describe('getMessage', () => {
    it('should return null for non-existent message', () => {
      expect(store.getMessage('non-existent')).toBeNull();
    });

    it('should return a saved message with all fields', () => {
      const msg = makeMessage({ content: 'Get me!' });
      store.saveMessage(msg);

      const retrieved = store.getMessage(msg.message_id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.message_id).toBe(msg.message_id);
      expect(retrieved!.from_agent).toBe(msg.from_agent);
      expect(retrieved!.to_agent).toBe(msg.to_agent);
      expect(retrieved!.type).toBe(msg.type);
      expect(retrieved!.content).toBe('Get me!');
      expect(retrieved!.status).toBe('pending');
    });
  });

  describe('getMessageCount', () => {
    it('should return 0 initially', () => {
      expect(store.getMessageCount()).toBe(0);
    });

    it('should return correct count after saving messages', () => {
      store.saveMessage(makeMessage());
      store.saveMessage(makeMessage());
      store.saveMessage(makeMessage());
      expect(store.getMessageCount()).toBe(3);
    });
  });

  describe('getFileCount', () => {
    it('should return 0 when no file messages exist', () => {
      expect(store.getFileCount()).toBe(0);
    });

    it('should count only file-type messages', () => {
      store.saveMessage(makeMessage({ type: 'text' }));
      store.saveMessage(makeMessage({ type: 'file' }));
      store.saveMessage(makeMessage({ type: 'query' }));
      store.saveMessage(makeMessage({ type: 'file' }));

      expect(store.getFileCount()).toBe(2);
    });
  });

  describe('getTodayCount', () => {
    it('should return 0 when no messages from today', () => {
      const oldMsg = makeMessage({
        sent_at: '2020-01-01T00:00:00.000Z',
      });
      store.saveMessage(oldMsg);
      // Today's count should still be 0 since sent_at is ancient
      expect(store.getTodayCount()).toBe(0);
    });

    it('should count messages from today', () => {
      const today = new Date().toISOString().slice(0, 10);
      const msg = makeMessage({ sent_at: `${today}T12:00:00.000Z` });
      store.saveMessage(msg);
      expect(store.getTodayCount()).toBe(1);
    });
  });

  describe('getAgentMessageCount', () => {
    it('should return 0 for agent with no messages', () => {
      expect(store.getAgentMessageCount('some-agent')).toBe(0);
    });

    it('should count messages addressed to the agent', () => {
      store.saveMessage(makeMessage({ to_agent: 'agent-a' }));
      store.saveMessage(makeMessage({ to_agent: 'agent-a' }));
      store.saveMessage(makeMessage({ to_agent: 'agent-b' }));

      expect(store.getAgentMessageCount('agent-a')).toBe(2);
      expect(store.getAgentMessageCount('agent-b')).toBe(1);
    });
  });

  describe('fetchInbox', () => {
    it('should return empty inbox for agent with no messages', () => {
      const result = store.fetchInbox({ agent_id: 'no-messages' });
      expect(result.messages).toEqual([]);
      expect(result.total).toBe(0);
      expect(result.has_more).toBe(false);
    });

    it('should fetch messages for an agent and auto-mark as delivered in DB', () => {
      const msg = makeMessage({ to_agent: 'inbox-agent', content: 'Inbox test' });
      store.saveMessage(msg);

      // First fetch — the returned messages still show 'pending' because
      // the update happens after the array is built
      const result = store.fetchInbox({ agent_id: 'inbox-agent' });
      expect(result.messages).toHaveLength(1);
      expect(result.total).toBe(1);

      // Second fetch — DB records were updated, so now they show 'delivered'
      const result2 = store.fetchInbox({ agent_id: 'inbox-agent' });
      expect(result2.messages[0].status).toBe('delivered');
      expect(result2.messages[0].delivered_at).toBeTruthy();
    });

    it('should not mark already delivered messages again', () => {
      // Save a message and fetch twice (first marks delivered)
      const msg = makeMessage({ to_agent: 'inbox-agent2' });
      store.saveMessage(msg);
      store.fetchInbox({ agent_id: 'inbox-agent2' });
      store.fetchInbox({ agent_id: 'inbox-agent2' });

      // Third fetch — status should remain 'delivered'
      const result = store.fetchInbox({ agent_id: 'inbox-agent2' });
      expect(result.messages[0].status).toBe('delivered');
    });

    it('should respect limit and offset', () => {
      for (let i = 0; i < 10; i++) {
        store.saveMessage(makeMessage({
          to_agent: 'pagination-agent',
          content: `Message ${i}`,
          sent_at: new Date(Date.now() - i * 1000).toISOString(),
        }));
      }

      // First 3 messages
      const page1 = store.fetchInbox({ agent_id: 'pagination-agent', limit: 3, offset: 0 });
      expect(page1.messages).toHaveLength(3);
      expect(page1.total).toBe(10);
      expect(page1.has_more).toBe(true);

      // Last page (offset 9, should have 1)
      const page4 = store.fetchInbox({ agent_id: 'pagination-agent', limit: 3, offset: 9 });
      expect(page4.messages).toHaveLength(1);
      expect(page4.has_more).toBe(false);
    });

    it('should cap limit at 200', () => {
      for (let i = 0; i < 50; i++) {
        store.saveMessage(makeMessage({
          to_agent: 'cap-agent',
          content: `Msg ${i}`,
          sent_at: new Date(Date.now() - i * 1000).toISOString(),
        }));
      }

      const result = store.fetchInbox({ agent_id: 'cap-agent', limit: 999 });
      expect(result.messages.length).toBeLessThanOrEqual(200);
    });

    it('should filter by since date', () => {
      const oldMsg = makeMessage({
        to_agent: 'since-agent',
        sent_at: '2023-01-01T00:00:00.000Z',
        content: 'old',
      });
      const newMsg = makeMessage({
        to_agent: 'since-agent',
        sent_at: new Date().toISOString(),
        content: 'new',
      });
      store.saveMessage(oldMsg);
      store.saveMessage(newMsg);

      const result = store.fetchInbox({
        agent_id: 'since-agent',
        since: '2023-06-01T00:00:00.000Z',
      });
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].content).toBe('new');
    });
  });

  describe('queryMessages', () => {
    it('should return all messages when no filters', () => {
      store.saveMessage(makeMessage({ to_agent: 'a', from_agent: 'b' }));
      store.saveMessage(makeMessage({ to_agent: 'b', from_agent: 'a' }));
      const results = store.queryMessages({});
      expect(results).toHaveLength(2);
    });

    it('should filter by agent_id (from or to)', () => {
      store.saveMessage(makeMessage({ to_agent: 'target', from_agent: 'sender', content: 'to target' }));
      store.saveMessage(makeMessage({ to_agent: 'other', from_agent: 'target', content: 'from target' }));
      store.saveMessage(makeMessage({ to_agent: 'other', from_agent: 'other2', content: 'unrelated' }));

      const results = store.queryMessages({ agent_id: 'target' });
      expect(results).toHaveLength(2);
      const contents = results.map((r) => r.content_preview);
      expect(contents).toContain('to target');
      expect(contents).toContain('from target');
    });

    it('should filter by since and until', () => {
      store.saveMessage(makeMessage({
        content: 'old',
        sent_at: '2023-01-01T00:00:00.000Z',
      }));
      store.saveMessage(makeMessage({
        content: 'middle',
        sent_at: '2024-06-01T00:00:00.000Z',
      }));
      store.saveMessage(makeMessage({
        content: 'new',
        sent_at: new Date().toISOString(),
      }));

      const results = store.queryMessages({
        since: '2024-01-01T00:00:00.000Z',
        until: '2025-01-01T00:00:00.000Z',
      });
      expect(results).toHaveLength(1);
      expect(results[0].content_preview).toBe('middle');
    });

    it('should include content_preview truncated to 100 chars', () => {
      const longContent = 'x'.repeat(200);
      store.saveMessage(makeMessage({ content: longContent }));
      const results = store.queryMessages({});
      expect(results[0].content_preview).toBe('x'.repeat(100));
    });
  });

  describe('searchMessages', () => {
    it('should return paginated results', () => {
      for (let i = 0; i < 15; i++) {
        store.saveMessage(makeMessage({
          content: `searchable message ${i}`,
          sent_at: new Date(Date.now() - i * 1000).toISOString(),
        }));
      }

      const page1 = store.searchMessages({ page: 1, page_size: 10 });
      expect(page1.messages).toHaveLength(10);
      expect(page1.total).toBe(15);
      expect(page1.page).toBe(1);
      expect(page1.page_size).toBe(10);

      const page2 = store.searchMessages({ page: 2, page_size: 10 });
      expect(page2.messages).toHaveLength(5);
    });

    it('should filter by keyword with LIKE', () => {
      store.saveMessage(makeMessage({ content: 'apple banana cherry' }));
      store.saveMessage(makeMessage({ content: 'banana date' }));
      store.saveMessage(makeMessage({ content: 'elderberry fig' }));

      const results = store.searchMessages({ keyword: 'banana' });
      expect(results.messages).toHaveLength(2);
    });

    it('should filter by type', () => {
      store.saveMessage(makeMessage({ type: 'text', content: 'text msg' }));
      store.saveMessage(makeMessage({ type: 'file', content: 'file msg' }));
      store.saveMessage(makeMessage({ type: 'query', content: 'query msg' }));

      const results = store.searchMessages({ type: 'file' });
      expect(results.messages).toHaveLength(1);
      expect(results.messages[0].content).toBe('file msg');
    });

    it('should filter by agent_id', () => {
      store.saveMessage(makeMessage({ from_agent: 'alice', to_agent: 'bob', content: 'hi bob' }));
      store.saveMessage(makeMessage({ from_agent: 'bob', to_agent: 'alice', content: 'hi alice' }));
      store.saveMessage(makeMessage({ from_agent: 'charlie', to_agent: 'dave', content: 'private' }));

      const results = store.searchMessages({ agent_id: 'alice' });
      expect(results.messages).toHaveLength(2);
    });

    it('should filter by time range', () => {
      store.saveMessage(makeMessage({
        content: 'early',
        sent_at: '2023-01-01T00:00:00.000Z',
      }));
      store.saveMessage(makeMessage({
        content: 'late',
        sent_at: '2025-01-01T00:00:00.000Z',
      }));

      const results = store.searchMessages({
        time_start: '2024-01-01T00:00:00.000Z',
        time_end: '2026-01-01T00:00:00.000Z',
      });
      expect(results.messages).toHaveLength(1);
      expect(results.messages[0].content).toBe('late');
    });

    it('should cap page_size at 100', () => {
      for (let i = 0; i < 50; i++) {
        store.saveMessage(makeMessage({
          content: `msg ${i}`,
          sent_at: new Date(Date.now() - i * 1000).toISOString(),
        }));
      }

      const results = store.searchMessages({ page: 1, page_size: 9999 });
      expect(results.messages.length).toBeLessThanOrEqual(100);
    });
  });
});
