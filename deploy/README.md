# Agent 消息总线 — 部署指南

本文档说明 **agent-bus** 的两种部署场景。

---

## 场景一：服务端部署（VPS / 云服务器）

总线服务端（bus-server）+ 中继层（relay-server）+ 管理面板，全部通过 Docker Compose 一键启动。

### 前置条件

- 服务器已安装 **Docker** 和 **Docker Compose**（v2+）
- 服务器有公网 IP（或内网可达地址）
- 端口 4322（总线）和 4324（中继）已开放

### 一键启动

```bash
# 1. 克隆仓库
git clone https://github.com/qqxucn/agent-bus.git
cd agent-bus

# 2. 启动全部服务（总线 + 中继 + 面板）
docker compose -f compose.server.yaml up -d

# 3. 查看状态
docker compose -f compose.server.yaml ps
```

启动后访问：
| 服务 | 地址 |
|:-----|:-----|
| 总线 API | `http://<服务器IP>:4322` |
| WebSocket | `ws://<服务器IP>:4322/ws` |
| 管理面板 | `http://<服务器IP>:4322/panel/` |
| 中继 API（可选） | `http://<服务器IP>:4324` |

### 安全加固（推荐）

创建 `.env.server` 文件，替换默认密码：

```bash
# .env.server
ADMIN_TOKEN=你的管理密码           # 面板和 API 管理认证
AGENT_TOKEN_SECRET=你的Agent注册密钥  # Agent 注册令牌
RELAY_TOKEN=你的中继访问令牌          # 中继层访问控制（不设则无认证）
```

然后重新启动：

```bash
docker compose -f compose.server.yaml --env-file .env.server up -d
```

### 仅启动部分服务

```bash
# 仅启动总线（不含中继）
docker compose -f compose.server.yaml up -d bus-server

# 全部启动
docker compose -f compose.server.yaml up -d
```

### 查看日志

```bash
docker compose -f compose.server.yaml logs -f bus-server
docker compose -f compose.server.yaml logs -f relay-server
```

### 停止

```bash
docker compose -f compose.server.yaml down
# 加上 -v 会删除数据卷（注意数据会丢失！）
docker compose -f compose.server.yaml down -v
```

---

## 场景二：Agent 接入（Python / TypeScript）

Agent 需要作为**客户端**接入消息总线，不是跑 Docker 容器，而是安装 SDK 并配置连接。

### Python Agent

```bash
# 1. 安装 SDK
pip install claw-bus

# 2. 配置连接（创建 config.py 或环境变量）
export BUS_URL=http://<服务器IP>:4322
export AGENT_ID=my-agent
export AGENT_TOKEN=<注册密钥>
```

如果 Agent 在内网不能直连总线，也可以通过**中继层**接入：

```bash
export BUS_URL=http://<中继IP>:4324/relay
```

示例代码：

```python
from bus_channel import BusChannel

bus = BusChannel(
    agent_id="my-agent",
    bus_url="http://<服务器IP>:4322",
    agent_token="<注册密钥>",
)

# 发送消息
bus.send_message("recipient-agent", {"type": "text", "content": "Hello"})

# 轮询收件箱
for msg in bus.poll_inbox():
    print(f"收到消息: {msg}")
```

### TypeScript Agent

```bash
# 1. 安装 SDK
npm install claw-bus

# 2. 配置连接（创建 .env 或环境变量）
BUS_URL=http://<服务器IP>:4322
AGENT_ID=my-agent
AGENT_TOKEN=<注册密钥>
```

示例代码：

```typescript
import { BusClient } from 'claw-bus';

const bus = new BusClient({
  agentId: 'my-agent',
  busUrl: 'http://<服务器IP>:4322',
  agentToken: '<注册密钥>',
});

// 发送消息
await bus.sendMessage('recipient-agent', { type: 'text', content: 'Hello' });

// WebSocket 实时接收
bus.onMessage((msg) => {
  console.log('收到消息:', msg);
});
```

---

## 架构总览

```
┌─────────────────────────────────────────────────────────┐
│                     VPS / 服务器                         │
│                                                         │
│  ┌──────────────┐    ┌──────────────┐                   │
│  │ 管理面板      │    │  中继层      │                   │
│  │ (静态文件)    │◄──►│ (relay-srv)  │── 可选：内网Agent  │
│  └──────┬───────┘    └──────┬───────┘                   │
│         │                   │                            │
│  ┌──────▼───────────────────▼───────┐                   │
│  │       总线服务端 (bus-server)      │                   │
│  │   HTTP API + WebSocket + 存储    │                   │
│  └──────────────────────────────────┘                   │
│         │                                               │
├─────────┼───────────────────────────────────────────────┤
│         │ 直连     │ 走中继                              │
│         ▼         ▼                                     │
│  ┌──────────┐  ┌──────────┐                             │
│  │ Agent A  │  │ Agent B  │  ← 内网/远程                 │
│  │ (Python) │  │ (TS)     │                             │
│  └──────────┘  └──────────┘                             │
└─────────────────────────────────────────────────────────┘
```

---

## 常见问题

**Q: 总线和中继必须一起部署吗？**
不必须。如果所有 Agent 都能直连总线（同一网络），只需要 bus-server。中继是为内网 Agent 准备的桥梁。

**Q: 面板单独部署怎么用？**
面板已内嵌在 bus-server 镜像中，无需单独部署。访问 `http://<IP>:4322/panel/` 即可。

**Q: Agent 端需要 Docker 吗？**
不需要。Agent 端是 SDK 集成（pip install / npm install），不是容器化部署。
