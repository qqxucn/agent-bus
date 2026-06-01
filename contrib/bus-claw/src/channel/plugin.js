"use strict";
/**
 * Bus-claw channel plugin entry point.
 *
 * This plugin connects to the Agent Bus via WebSocket, receives messages,
 * and dispatches them through the OpenClaw agent pipeline.  Outbound
 * messages are sent back through the bus.
 *
 * The plugin exports a `feishuPlugin`-compatible object so it can be
 * registered via `gateway.startAccount()` just like a native Feishu
 * plugin.
 */

const lark_logger_1 = require("../core/lark-logger.js");

const pluginLog = (0, lark_logger_1.larkLogger)('channel/plugin');

// ---------------------------------------------------------------------------
// Plugin definition
// ---------------------------------------------------------------------------

const busClawPlugin = {
    id: 'bus-claw',

    meta: {
        id: 'bus-claw',
        label: 'Agent Bus',
        selectionLabel: 'Agent Bus (WebSocket)',
        docsPath: '/channels/bus-claw',
        docsLabel: 'bus-claw',
        blurb: 'Agent Bus messaging via WebSocket.',
        order: 80,
    },

    capabilities: {
        chatTypes: ['direct'],
        media: false,
        reactions: false,
        threads: false,
        polls: false,
        nativeCommands: false,
        blockStreaming: true,
    },

    agentPrompt: {
        messageToolHints: () => [
            '- Agent Bus targeting: messages are sent directly to agents by their agent ID.',
            '- Use `sendBusMessage` to reply to the current conversation.',
        ],
    },

    messaging: {
        normalizeTarget: (raw) => raw?.trim() || undefined,
        targetResolver: {
            looksLikeId: (raw) => /^[\w\u4e00-\u9fff_-]+$/.test(raw ?? ''),
            hint: '<agentId>',
        },
    },

    // -------------------------------------------------------------------------
    // Config — resolve bus accounts from config
    // -------------------------------------------------------------------------
    config: {
        listAccountIds: (cfg) => {
            const cc = cfg?.channels?.['bus-claw'] ?? {};
            return cc.accountId ? [cc.accountId] : ['default'];
        },
        resolveAccount: (cfg, accountId) => {
            const cc = cfg?.channels?.['bus-claw'] ?? {};
            return {
                accountId: accountId ?? 'default',
                enabled: true,
                configured: !!(cc.busUrl && cc.busToken),
                name: cc.agentId ?? accountId ?? 'default',
                config: cc,
            };
        },
        defaultAccountId: () => 'default',
        isConfigured: (account) => account.configured,
        describeAccount: (account) => ({
            accountId: account.accountId,
            enabled: account.enabled,
            configured: account.configured,
            name: account.name,
        }),
    },

    outbound: {
        send: async ({ cfg, to, content, opts }) => {
            const send_1 = require("../messaging/outbound/send.js");
            return (0, send_1.sendBusMessage)(to, content, opts);
        },
        sendFile: async ({ cfg, to, filePath, opts }) => {
            const send_1 = require("../messaging/outbound/send.js");
            return (0, send_1.sendBusFile)(to, filePath, opts);
        },
    },

    // -------------------------------------------------------------------------
    // Gateway: start / stop account monitors
    // -------------------------------------------------------------------------
    gateway: {
        startAccount: async (ctx) => {
            const { monitorBusProvider } = await Promise.resolve().then(() => require('./monitor.js'));
            const accountId = ctx.accountId ?? 'default';

            ctx.log?.info(`starting bus-claw[${accountId}]`);

            const stop = await monitorBusProvider({
                config: ctx.cfg,
                runtime: ctx.runtime,
                abortSignal: ctx.abortSignal,
                accountId,
            });

            ctx.log?.info(`started bus-claw[${accountId}]`);

            // Return a cleanup / stop function
            return {
                stop: async () => {
                    ctx.log?.info(`stopping bus-claw[${accountId}]`);
                    stop();
                    ctx.log?.info(`stopped bus-claw[${accountId}]`);
                },
            };
        },

        stopAccount: async (ctx) => {
            ctx.log?.info(`stopping bus-claw[${ctx.accountId ?? 'default'}]`);
            ctx.log?.info(`stopped bus-claw[${ctx.accountId ?? 'default'}]`);
        },
    },
};

module.exports = { busClawPlugin };
