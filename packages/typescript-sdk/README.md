# claw-bus

OpenClaw 原生消息总线渠道插件 — 像飞书/微信一样在 `openclaw.json` 里配了就自动启动。

## 文件结构

```
claw-bus/
├── package.json              # OpenClaw 插件元数据
├── openclaw.plugin.json      # 插件 manifest + 配置 schema
├── index.ts                  # 主入口：defineChannelPluginEntry
├── setup-entry.ts            # 轻量级设置入口：defineSetupPluginEntry
├── src/
│   ├── channel.ts            # ChannelPlugin 对象（createChatChannelPlugin）
│   ├── index.ts              # 通用层：createBusPlugin 工厂
│   ├── types.ts              # 核心类型定义
│   ├── config.ts             # 配置校验 + 默认值
│   ├── auth.ts               # Agent 注册 + Token 管理
│   ├── message.ts            # 消息去重 + 会话上下文
│   ├── ws-connection.ts      # WebSocket 连接（含心跳/重连）
│   ├── poll-connection.ts    # HTTP 轮询连接
│   └── file-transfer.ts      # 文件传输（沙箱/BASE64/共享目录）
├── tsconfig.json
└── types/
    └── node-globals.d.ts
```

## 快速开始

在 `openclaw.json` 中添加渠道配置：

```json
{
  "channels": {
    "claw-bus": {
      "busUrl": "http://47.104.247.64:4322",
      "busWsUrl": "ws://47.104.247.64:4322/ws",
      "busToken": "your-token-here",
      "agentId": "小绿",
      "mode": "websocket",
      "pollInterval": 3
    }
  }
}
```

然后启动 OpenClaw，claw-bus 会自动连接。

## TODO

- [ ] 端到端联调（与 Hermes 原生插件双向收发消息）
