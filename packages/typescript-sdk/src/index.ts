/**
 * claw-bus TypeScript 版 — 工厂入口
 *
 * createBusPlugin() 组装所有模块，返回 BusChannelPlugin 实例。
 * 通用层，不依赖 OpenClaw SDK。
 */

/** 总线协议版本（两端共用，用于对齐排查） */
export const AGENT_BUS_PROTOCOL_VERSION = '1.1';
/** 实现版本 */
export const AGENT_BUS_IMPLEMENTATION_VERSION = '2.0.0';

import type { BusChannelConfig, BusChannelPlugin, BusMessage, OutboundMessage, SendResult } from './types';
import { ConfigManager } from './config';
import { AuthManager } from './auth';
import { MessageManager } from './message';
import { WsConnection } from './ws-connection';
import { PollConnection } from './poll-connection';
import { FileTransfer } from './file-transfer';

export { ConfigManager } from './config';
export { AuthManager } from './auth';
export { MessageManager } from './message';
export { SessionContext } from './message';
export { WsConnection } from './ws-connection';
export { PollConnection } from './poll-connection';
export { FileTransfer } from './file-transfer';
export { isSupportedFileType, getFileExtension } from './utils';

export type {
  BusChannelConfig,
  BusChannelPlugin,
  BusMessage,
  OutboundMessage,
  SendResult,
  FileMode,
  WsFrame,
  WsFrameType,
  ConnectionStateCallback,
  ErrorCallback,
} from './types';

/**
 * 创建 BusChannelPlugin 实例。
 * 根据 mode 自动选择 WS 或 HTTP 轮询连接。
 */
export function createBusPlugin(config: BusChannelConfig): BusChannelPlugin {
  const configMgr = new ConfigManager();
  let validatedConfig = configMgr.validate(config);

  let auth = new AuthManager(
    validatedConfig.busUrl,
    validatedConfig.agentId,
    validatedConfig.agentToken,
    validatedConfig.skipRegistrationIfTokenSet,
  );
  let messageMgr = new MessageManager();
  let fileTransfer = new FileTransfer(validatedConfig, auth);
  let connection: WsConnection | PollConnection;

  function initConnection(cfg: BusChannelConfig): void {
    if (cfg.mode === 'websocket') {
      connection = new WsConnection(cfg, auth, messageMgr);
    } else {
      connection = new PollConnection(cfg, auth, messageMgr);
    }
  }

  initConnection(validatedConfig);

  let userHandler: ((msg: BusMessage) => Promise<void>) | null = null;

  // 消息去重 + handler 调用统一通过 messageMgr.handleMessage()
  messageMgr.setMessageHandler(async (msg) => {
    if (userHandler) {
      await userHandler(msg);
    }
  });

  return {
    async connect(overrideConfig?: BusChannelConfig): Promise<boolean> {
      try {
        if (overrideConfig) {
          validatedConfig = configMgr.validate(overrideConfig);
          auth = new AuthManager(
            validatedConfig.busUrl,
            validatedConfig.agentId,
            validatedConfig.agentToken,
            validatedConfig.skipRegistrationIfTokenSet,
          );
          messageMgr = new MessageManager();
          fileTransfer = new FileTransfer(validatedConfig, auth);
          initConnection(validatedConfig);
          messageMgr.setMessageHandler(async (msg) => {
            if (userHandler) await userHandler(msg);
          });
        }

        await auth.register();
        if (validatedConfig.mode === 'websocket') {
          await (connection as WsConnection).connect();
        } else {
          await (connection as PollConnection).start();
        }
        return true;
      } catch (e) {
        const errorMsg = `连接失败: ${String(e)}`;
        console.error(`[claw-bus] ${errorMsg}`);
        validatedConfig.onError?.(new Error(errorMsg));
        return false;
      }
    },

    async disconnect(): Promise<void> {
      try {
        if (validatedConfig.mode === 'websocket') {
          await (connection as WsConnection).disconnect();
        } else {
          await (connection as PollConnection).stop();
        }
      } catch (e) {
        console.error(`[claw-bus] 断开连接失败: ${String(e)}`);
      }
    },

    isConnected(): boolean {
      if (validatedConfig.mode === 'websocket') {
        return (connection as WsConnection).connected;
      }
      return (connection as PollConnection).isRunning;
    },

    getAgentId(): string {
      return validatedConfig.agentId;
    },

    setMessageHandler(handler: (msg: BusMessage) => Promise<void>): void {
      userHandler = handler;
    },

    async send(msg: OutboundMessage): Promise<SendResult> {
      return connection.sendOutbound(msg);
    },

    async sendFile(to: string, filePath: string, caption?: string): Promise<SendResult> {
      return fileTransfer.sendFile(to, filePath, caption);
    },
  };
}
