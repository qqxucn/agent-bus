"use strict";
/**
 * Event handlers for incoming bus messages.
 *
 * Replaces the original Feishu-specific event-handlers module.
 * Receives bus messages (from BusClient.onMessage) and routes them
 * through the inbound processing pipeline.
 *
 * The bus message format:
 *   { message_id, from_agent, content, type, session_id, ref_id }
 */

Object.defineProperty(exports, "__esModule", { value: true });
exports.handleMessageEvent = handleMessageEvent;

const handler_1 = require("../messaging/inbound/handler.js");
const lark_logger_1 = require("../core/lark-logger.js");

const log = (0, lark_logger_1.larkLogger)('channel/event-handlers');

// ---------------------------------------------------------------------------
// Message event handler
// ---------------------------------------------------------------------------

/**
 * Handle an incoming bus message event.
 *
 * Converts the bus message format to the MessageContext format expected
 * by the handler pipeline and dispatches it for processing.
 *
 * @param {object} params
 * @param {object}   params.msg         - The bus message from BusClient.onMessage
 * @param {object}   params.config      - OpenClaw config (full cfg, with channels.bus-claw)
 * @param {object}   [params.runtime]   - Runtime environment
 * @param {string}   params.accountId   - Account identifier
 */
async function handleMessageEvent(params) {
    const { msg, config, runtime, accountId } = params;

    // 防回声：忽略来自我自己的消息
    const agentId = (config?.channels?.['bus-claw'])?.agentId || config?.agentId || '小绿';
    if (msg.from_agent && msg.from_agent === agentId) {
      return;
    }

    // Build a MessageContext-like object from the bus message
    const ctx = {
        chatId: msg.from_agent,                    // source agent ID acts as "chat"
        messageId: msg.message_id,
        senderId: msg.from_agent,
        chatType: 'direct',                        // bus messages are always direct
        content: msg.content ?? '',
        contentType: msg.type ?? 'text',
        resources: [],
        mentions: [],
        mentionAll: false,
        senderIsBot: false,
        createTime: Date.now(),
        parentId: msg.ref_id || undefined,
        threadId: msg.session_id || undefined,
        rawMessage: msg,
        rawSender: { sender_type: 'bus' },
    };

    log.info(`received bus message from=${msg.from_agent} id=${msg.message_id} type=${msg.type}`);

    // Extract botOpenId from channels.bus-claw config
    const busChannelCfg = config?.channels?.['bus-claw'] ?? {};
    const botOpenId = busChannelCfg.agentId || busChannelCfg.agent_id || config.agentId || '小绿';

    try {
        await (0, handler_1.handleBusMessage)({
            cfg: config,
            event: ctx,
            botOpenId,
            runtime,
            chatHistories: undefined,
            accountId,
            replyToMessageId: undefined,
            forceMention: false,
            skipTyping: true,   // bus has no typing indicator
        });
    }
    catch (err) {
        log.error(`failed to handle bus message: ${String(err)}`);
    }
}
