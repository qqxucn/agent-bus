import type { BusMessage, InboxQuery, InboxResponse, StoredMessage, MessageLogQuery, MessageLogEntry, MessageSearchRequest, MessageSearchResponse } from '../types/index.js';
import type { Database } from './database.js';
import { v4 as uuidv4 } from 'uuid';

export function createMessageStore(db: Database) {
  return {
    saveMessage(msg: BusMessage): string {
      const messageId = msg.message_id || uuidv4();
      const stmt = db.db.prepare(
        `INSERT INTO messages (
          message_id, from_agent, sender_type, to_agent, type, content,
          status, sent_at, ref_id, session_id,
          file_id, file_name, file_size, caption
        ) VALUES (
          $id, $from, $sender, $to, $type, $content,
          'pending', $sent_at, $ref, $session,
          $file_id, $file_name, $file_size, $caption
        )`
      );
      stmt.bind({
        $id: messageId,
        $from: msg.from_agent,
        $sender: msg.sender_type,
        $to: msg.to_agent,
        $type: msg.type,
        $content: msg.content,
        $sent_at: msg.sent_at,
        $ref: msg.ref_id ?? null,
        $session: msg.session_id ?? null,
        $file_id: msg.file_id ?? null,
        $file_name: msg.file_name ?? null,
        $file_size: msg.file_size ?? null,
        $caption: msg.caption ?? null,
      });
      stmt.step();
      stmt.free();
      db.save();
      return messageId;
    },

    fetchInbox(query: InboxQuery): InboxResponse {
      const limit = Math.min(query.limit ?? 50, 200);
      const offset = query.offset ?? 0;

      // Count total
      let countSql =
        'SELECT COUNT(*) as cnt FROM messages WHERE to_agent = $agent';
      const countParams: Record<string, any> = { $agent: query.agent_id };
      if (query.since) {
        countSql += ' AND sent_at >= $since';
        countParams.$since = query.since;
      }
      const countStmt = db.db.prepare(countSql);
      countStmt.bind(countParams);
      countStmt.step();
      const total = (countStmt.getAsObject() as any).cnt;
      countStmt.free();

      // Fetch messages
      let sql = 'SELECT * FROM messages WHERE to_agent = $agent';
      if (query.since) {
        sql += ' AND sent_at >= $since';
      }
      sql += ' ORDER BY sent_at DESC LIMIT $limit OFFSET $offset';

      const params: Record<string, any> = {
        $agent: query.agent_id,
        $limit: limit,
        $offset: offset,
      };
      if (query.since) {
        params.$since = query.since;
      }

      const stmt = db.db.prepare(sql);
      stmt.bind(params);

      const messages: StoredMessage[] = [];
      const now = new Date().toISOString();
      const updateIds: string[] = [];

      while (stmt.step()) {
        const row = stmt.getAsObject() as any;
        messages.push({
          message_id: row.message_id,
          from_agent: row.from_agent,
          sender_type: row.sender_type,
          to_agent: row.to_agent,
          type: row.type,
          content: row.content,
          sent_at: row.sent_at,
          status: row.status,
          delivered_at: row.delivered_at,
          read_at: row.read_at,
          ref_id: row.ref_id,
          session_id: row.session_id,
          file_id: row.file_id,
          file_name: row.file_name,
          file_size: row.file_size,
          caption: row.caption,
        });

        if (row.status === 'pending') {
          updateIds.push(row.message_id);
        }
      }
      stmt.free();

      // Auto-mark delivered (first version: pull-to-read simple mode)
      if (updateIds.length > 0) {
        const updateStmt = db.db.prepare(
          'UPDATE messages SET status = $status, delivered_at = $at WHERE message_id = $id'
        );
        for (const id of updateIds) {
          updateStmt.bind({ $status: 'delivered', $at: now, $id: id });
          updateStmt.step();
          updateStmt.reset();
        }
        updateStmt.free();
        db.save();
      }

      return {
        messages,
        total,
        has_more: offset + limit < total,
      };
    },

    getMessage(messageId: string): StoredMessage | null {
      const stmt = db.db.prepare('SELECT * FROM messages WHERE message_id = $id');
      stmt.bind({ $id: messageId });
      if (stmt.step()) {
        const row = stmt.getAsObject() as any;
        stmt.free();
        return {
          message_id: row.message_id,
          from_agent: row.from_agent,
          sender_type: row.sender_type,
          to_agent: row.to_agent,
          type: row.type,
          content: row.content,
          sent_at: row.sent_at,
          status: row.status,
          delivered_at: row.delivered_at,
          read_at: row.read_at,
          ref_id: row.ref_id,
          session_id: row.session_id,
          file_id: row.file_id,
          file_name: row.file_name,
          file_size: row.file_size,
          caption: row.caption,
        };
      }
      stmt.free();
      return null;
    },

    getMessageCount(): number {
      const stmt = db.db.prepare('SELECT COUNT(*) as cnt FROM messages');
      stmt.step();
      const row = stmt.getAsObject() as any;
      stmt.free();
      return row.cnt;
    },

    getFileCount(): number {
      const stmt = db.db.prepare("SELECT COUNT(*) as cnt FROM messages WHERE type = 'file'");
      stmt.step();
      const row = stmt.getAsObject() as any;
      stmt.free();
      return row.cnt;
    },

    getTodayCount(): number {
      const today = new Date().toISOString().slice(0, 10);
      const stmt = db.db.prepare(
        'SELECT COUNT(*) as cnt FROM messages WHERE sent_at >= $today'
      );
      stmt.bind({ $today: today });
      stmt.step();
      const row = stmt.getAsObject() as any;
      stmt.free();
      return row.cnt;
    },

    getAgentMessageCount(agentId: string): number {
      const stmt = db.db.prepare(
        'SELECT COUNT(*) as cnt FROM messages WHERE to_agent = $id'
      );
      stmt.bind({ $id: agentId });
      stmt.step();
      const row = stmt.getAsObject() as any;
      stmt.free();
      return row.cnt;
    },

    queryMessages(query: MessageLogQuery): MessageLogEntry[] {
      let sql = 'SELECT * FROM messages WHERE 1=1';
      const params: Record<string, any> = {};

      if (query.agent_id) {
        sql +=
          ' AND (from_agent = $agent OR to_agent = $agent)';
        params.$agent = query.agent_id;
      }
      if (query.since) {
        sql += ' AND sent_at >= $since';
        params.$since = query.since;
      }
      if (query.until) {
        sql += ' AND sent_at <= $until';
        params.$until = query.until;
      }

      const limit = Math.min(query.limit ?? 50, 200);
      const offset = query.offset ?? 0;
      sql += ' ORDER BY sent_at DESC LIMIT $limit OFFSET $offset';
      params.$limit = limit;
      params.$offset = offset;

      const stmt = db.db.prepare(sql);
      stmt.bind(params);

      const results: MessageLogEntry[] = [];
      while (stmt.step()) {
        const row = stmt.getAsObject() as any;
        results.push({
          message_id: row.message_id,
          from_agent: row.from_agent,
          to_agent: row.to_agent,
          type: row.type,
          content_preview: row.content.slice(0, 100),
          sent_at: row.sent_at,
          status: row.status,
        });
      }
      stmt.free();
      return results;
    },

    searchMessages(query: MessageSearchRequest): MessageSearchResponse {
      const page = query.page ?? 1;
      const pageSize = Math.min(query.page_size ?? 20, 100);
      const offset = (page - 1) * pageSize;

      let where = 'WHERE 1=1';
      const params: Record<string, any> = {};

      if (query.agent_id) {
        where += ' AND (from_agent = $agent OR to_agent = $agent)';
        params.$agent = query.agent_id;
      }
      if (query.type) {
        where += ' AND type = $type';
        params.$type = query.type;
      }
      if (query.keyword) {
        where += ' AND content LIKE $keyword';
        params.$keyword = `%${query.keyword}%`;
      }
      if (query.time_start) {
        where += ' AND sent_at >= $time_start';
        params.$time_start = query.time_start;
      }
      if (query.time_end) {
        where += ' AND sent_at <= $time_end';
        params.$time_end = query.time_end;
      }

      const countStmt = db.db.prepare(`SELECT COUNT(*) as cnt FROM messages ${where}`);
      countStmt.bind(params);
      countStmt.step();
      const total = (countStmt.getAsObject() as any).cnt;
      countStmt.free();

      const sql = `SELECT * FROM messages ${where} ORDER BY sent_at DESC LIMIT $limit OFFSET $offset`;
      params.$limit = pageSize;
      params.$offset = offset;

      const stmt = db.db.prepare(sql);
      stmt.bind(params);

      const messages: StoredMessage[] = [];
      while (stmt.step()) {
        const row = stmt.getAsObject() as any;
        messages.push({
          message_id: row.message_id, from_agent: row.from_agent,
          sender_type: row.sender_type, to_agent: row.to_agent,
          type: row.type, content: row.content, sent_at: row.sent_at,
          status: row.status, delivered_at: row.delivered_at, read_at: row.read_at,
          ref_id: row.ref_id, session_id: row.session_id,
          file_id: row.file_id, file_name: row.file_name,
          file_size: row.file_size, caption: row.caption,
        });
      }
      stmt.free();

      return { messages, total, page, page_size: pageSize };
    },
  };
}

export type MessageStore = ReturnType<typeof createMessageStore>;
