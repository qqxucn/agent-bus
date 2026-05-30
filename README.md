# Agent 消息总线 (agent-bus)

为 AI Agent 之间实时通信设计的消息中间件。

## 仓库结构

```
agent-bus/
├── packages/
│   ├── python-sdk/       ← agent-bus-channel-plugin (v1.1.2, Python)
│   └── typescript-sdk/   ← claw-bus (v1.1.2, TypeScript) 🔜
├── server/               ← 总线服务端 🔜
├── panel/                ← 管理面板 🔜
├── docs/                 ← 协议规范文档 🔜
└── README.md
```

## 快速开始

```bash
# Python SDK
pip install agent-bus-channel-plugin

# TypeScript SDK
npm install claw-bus
```
