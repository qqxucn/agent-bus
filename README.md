# Agent 消息总线 (agent-bus)

为 AI Agent 之间实时通信设计的消息中间件。

## 仓库结构

```
agent-bus/
├── packages/
│   ├── python-sdk/        ← agent-bus-channel-plugin (v1.1.2, Python)
│   ├── typescript-sdk/    ← claw-bus (v2.0.0, TypeScript) — OpenClaw 原生插件
│   └── bus-server/        ← 总线服务端 (v1.1.0, TypeScript/Node.js)
├── contrib/
│   └── hermes-adapter/    ← Hermes 原生平台适配器 (v2.0.0, Python)
├── panel-frontend/        ← 管理面板 (✅ 已就绪)
├── docs/                  ← 协议接口规范文档
├── VERSION                ← 全局版本声明
└── README.md
```

## 快速开始

> **对接方式**
> 
> 当前推荐各 Agent 通过**原生平台适配器**接入总线：
> - **Hermes** → `contrib/hermes-adapter/agent_bus.py`（作为原生平台加载）
> - **OpenClaw** → `packages/typescript-sdk/`（作为 ChannelPlugin 加载）
> - **其他语言/项目** → 参照 `packages/python-sdk/` 协议实现

### 总线服务端（开发模式）

```bash
cd packages/bus-server
npm install
npm run dev
```

> **⚠️ 安全提醒**
>
> 管理面板的登录密码由 `ADMIN_TOKEN` 环境变量控制，**默认值为 `'admin'`**。
> 生产部署前请务必设置为强密码。详见 `.env.server.example` 或 `DEPLOY_SYSTEMD.md`。

## 组件说明

| 组件 | 语言 | 版本 | 维护者 |
|:-----|:-----|:----:|:------|
| **总线服务端** | TypeScript / Node.js | v1.1.0 | 小绿 |
| **Python SDK** | Python 3.10+ | v1.1.2 | 通用 |
| **TypeScript SDK** | TypeScript 5+ | v2.0.0 | 小绿 |
| **Hermes 适配器** | Python 3.13+ | v2.0.0 | 小和 |
| **管理面板** | React + TypeScript + Vite | v1.0 | 小艺 |

## 协议版本

总线通信协议: **v1.1**（详见 `docs/`）

## License

MIT

---

## 🚨 部署注意事项

### bus-server 只能部署在独立服务器上！

**不要**在 Hermes / OpenClaw 等 Agent 所在的环境中运行 bus-server。

| 环境 | 应该部署什么 |
|:-----|:------------|
| 🖥️ VPS / 云服务器 | `bus-server`（服务端） → `npm run build && npm start` |
| 🤖 Hermes / OpenClaw Agent | 只连接远程总线（作为客户端），通过适配器 SDK |
| 🐳 Docker 容器 | 参考 `compose.yaml`，在独立容器中运行 |

### 安全防护

bus-server 入口文件（`src/index.ts`）内置了**环境检测**：
- 检测到 `AGENT_BUS_ENABLED`、`AGENT_BUS_AGENT_ID` 等 Agent 环境变量时
- 自动拒绝启动并给出清晰的错误提示
- 防止误将服务端部署到 Agent 环境

### 正确部署流程

```bash
# ✅ 在独立服务器上
git clone https://github.com/qqxucn/agent-bus.git
cd agent-bus/packages/bus-server
npm install
npm run build
ADMIN_TOKEN=your_secret AGENT_TOKEN_SECRET=your_secret npm start
```

### Agent 连接示例

```env
# Hermes / OpenClaw 的 .env 配置（无需安装 bus-server）
AGENT_BUS_ENABLED=true
AGENT_BUS_URL=http://your-server:4322
AGENT_BUS_WS_URL=ws://your-server:4322/ws
AGENT_BUS_AGENT_ID=my-agent
AGENT_BUS_MODE=websocket
```

