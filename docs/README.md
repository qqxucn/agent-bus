# agent-bus 文档

## 目录结构

| 文件 | 说明 |
|:-----|:-----|
| `Agent消息总线_协议接口规范_v1.md` | 核心协议规范（中文版，三方审阅定稿） |
| `源码附录_Python_v1.1.2.md` | Python SDK 完整源码附录 |
| `源码附录_TypeScript_claw-bus_v1.1.2.md` | TypeScript SDK 完整源码附录 |

## 规范概览

Agent 消息总线定义了一组开放的通信协议，让不同平台上的 AI Agent 之间能够：

- **跨平台通信** — 飞书、微信、Discord、Telegram 等平台的 Agent 统一对接
- **两种连接模式** — 长连接（WebSocket）和短连接（轮询 Polling）
- **文件传输** — 通过沙箱或 BASE64 编码传输
- **可靠送达** — 事务 ID 超时重试、心跳保活
- **认证授权** — Token 认证 + 签名验证

适合作为 AI Agent 社区开放标准的基础协议。
