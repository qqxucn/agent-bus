import { Router } from 'express';
import type { BusServerConfig, ApiResponse, BusMessage, SendMessageRequest, InboxQuery, InboxResponse, SendResult, MessageSearchRequest, MessageSearchResponse } from '../types/index.js';
import type { MessageStore } from '../storage/message-store.js';
import type { CoreProvider } from '../core/index.js';
import { v4 as uuidv4 } from 'uuid';

const MAX_MESSAGE_LENGTH = 65536;
const MESSAGE_TYPES = ['text', 'file', 'task', 'query'] as const;

export function createMessageController(
  config: BusServerConfig,
  messageStore: MessageStore,
  core: CoreProvider,
) {
  const router = Router();

  // POST /api/messages/send
  router.post('/send', (req, res) => {
    try {
      const body = req.body as SendMessageRequest;

      // Validate
      if (!body.from || !body.to || !body.type || !body.content) {
        return res.json({ code: 1002, message: 'invalid_message', data: null } as ApiResponse);
      }
      if (!MESSAGE_TYPES.includes(body.type as typeof MESSAGE_TYPES[number])) {
        return res.json({ code: 1002, message: 'invalid_message', data: null } as ApiResponse);
      }
      if (body.content.length > MAX_MESSAGE_LENGTH) {
        return res.json({ code: 2001, message: 'message_too_large', data: null } as ApiResponse);
      }

      const now = new Date().toISOString();
      const message: BusMessage = {
        message_id: uuidv4(),
        from_agent: body.from,
        sender_type: 'agent',
        to_agent: body.to,
        type: body.type,
        content: body.content,
        sent_at: now,
        ref_id: body.ref_id,
        session_id: body.session_id,
        file_id: body.file_id,
        file_ids: body.file_ids,
        caption: body.caption,
      };

      // Save message
      messageStore.saveMessage(message);

      // If target is online via WS, push it
      const online = core.getAgentStatus(body.to) === 'online';
      if (online) {
        core.pushToAgent(body.to, message).catch(() => {});
      }

      return res.json({
        code: 0, message: 'success',
        data: { success: true, message_id: message.message_id } as SendResult,
      } as ApiResponse<SendResult>);
    } catch (err) {
      return res.json({ code: 9000, message: 'internal_error', data: null } as ApiResponse);
    }
  });

  // GET /api/messages/inbox?agent_id=xxx&limit=20&offset=0&since=xxx&mark_read=true
  router.get('/inbox', (req, res) => {
    try {
      const authAgentId = (req as any).agentId as string;
      const agentId = authAgentId === '__admin__'
        ? (req.query.agent_id as string)
        : authAgentId;
      if (!agentId) {
        return res.json({ code: 1002, message: 'invalid_message', data: null } as ApiResponse);
      }

      const query: InboxQuery = {
        agent_id: agentId,
        limit: parseInt(req.query.limit as string, 10) || 50,
        offset: parseInt(req.query.offset as string, 10) || 0,
        since: req.query.since as string | undefined,
        mark_read: req.query.mark_read === 'true',
      };

      const inbox = messageStore.fetchInbox(query);
      return res.json({ code: 0, message: 'success', data: inbox } as ApiResponse<InboxResponse>);
    } catch (err) {
      return res.json({ code: 9000, message: 'internal_error', data: null } as ApiResponse);
    }
  });

  // POST /api/messages/search — search message history
  router.post('/search', (req, res) => {
    try {
      const body = req.body as MessageSearchRequest;
      const result = messageStore.searchMessages(body);
      return res.json({ code: 0, message: 'success', data: result } as ApiResponse<MessageSearchResponse>);
    } catch (err) {
      return res.json({ code: 9000, message: 'internal_error', data: null } as ApiResponse);
    }
  });

  return router;
}
