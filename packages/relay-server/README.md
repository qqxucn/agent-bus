# 🐉 小绿 — 中继服务端（Relay Server）

> **项目：** agent-bus / packages/relay-server
> **版本：** v1.0.0 (MVP)
> **技术栈：** TypeScript / Node.js / Express
> **对接总线：** packages/bus-server v1.0.0

---

## 中继层的定位

**中继层是一个无状态协议代理，让内网没有公网 IP 的 Agent 也能接入总线。**

```
Agent (外网) → relay:4324/relay/api/* → proxy → bus:4322/api/*
```

**中继层不做的事情：**
- ❌ 不存储消息（无数据库）
- ❌ 不处理业务逻辑
- ❌ 不做认证（透传总线认证）
- ❌ 不缓存

---

## 文件清单

| 文件 | 说明 |
|:-----|:------|
| `package.json` | 依赖定义（express） |
| `tsconfig.json` | TS 严格模式，NodeNext |
| `.gitignore` | git 忽略 |
| `src/config.ts` | 配置加载（环境变量） |
| `src/types.ts` | 共享类型定义 |
| `src/index.ts` | 入口文件（HTTP 服务启动） |
| `src/proxy/proxy.ts` | REST 代理核心（转发到总线） |
| `src/relay/routes.ts` | 中继 REST API 路由 |
| `src/tunnel/server.ts` | TCP 隧道服务端存根（MVP 暂缺） |
| `src/tunnel/client.ts` | TCP 隧道客户端存根（MVP 暂缺） |
| `README.md` | 本文件 |

---

## 完整路由表

| 方法 | 路由 | 认证 | 说明 |
|:-----|:------|:-----|:-------|
| POST | `/relay/api/agents/register` | relay_token | Agent 注册代理 |
| GET | `/relay/api/agents` | relay_token | Agent 列表代理 |
| GET | `/relay/api/agents/:id` | relay_token | Agent 详情 |
| DELETE | `/relay/api/agents/:id` | relay_token | 删除 Agent |
| POST | `/relay/api/messages/send` | relay_token | 发送消息代理 |
| GET | `/relay/api/messages/inbox` | relay_token | 收件箱代理 |
| POST | `/relay/api/messages/search` | relay_token | 消息搜索代理 |
| GET | `/relay/api/stats` | relay_token | 总线统计代理 |
| GET | `/relay/api/ping` | relay_token | 心跳代理 |
| GET | `/relay/health` | 无 | 中继自身健康检查 |

---

## 环境变量

| 变量 | 默认值 | 说明 |
|:-----|:-------|:-----|
| `RELAY_PORT` | `4324` | 中继 HTTP 端口 |
| `LISTEN_HOST` | `0.0.0.0` | 监听地址 |
| `BUS_HOST` | `localhost` | 总线地址（中继转发目标） |
| `BUS_PORT` | `4322` | 总线端口 |
| `RELAY_TOKEN` | `''` | 中继 Token（空=不校验） |
| `TUNNEL_PORT` | `4323` | 隧道端口（预留） |
| `TUNNEL_HOST` | `0.0.0.0` | 隧道地址（预留） |
| `MODE` | `tunnel` | 模式（预留） |

---

## 启动

```bash
# 开发模式
cd packages/relay-server
npm install
RELAY_TOKEN=my-secret npx tsx src/index.ts

# 生产模式
npm run build
RELAY_TOKEN=my-secret node dist/index.js
```

---

## 通过中继连接

Agent 配置只需改 busUrl：

```
# 原来（直连总线）
busUrl: http://localhost:4322

# 改为（通过中继）
busUrl: http://{relay_host}:4324/relay
```

请求示例：

```bash
curl -X POST http://relay_host:4324/relay/api/messages/send \
  -H "X-Relay-Token: my-secret" \
  -H "Authorization: Bearer <agent_token>" \
  -H "Content-Type: application/json" \
  -d '{"from":"agent-a","to":"agent-b","type":"text","content":"你好"}'
```

---

## 架构设计

### MVP 方案（已完成）

Agent → **relay:4324** → HTTP proxy → **bus:4322**

中继作为前置代理，用 `http.request` 将请求原封不动转发到总线。总线认证（Authorization 头）透传，中继只做 `X-Relay-Token` 校验。

### 未来扩展（TCP 隧道）

当总线部署在 NAT 后的内网时，中继可以通过 TCP 隧道将请求转发到内网总线：

```
Agent → relay:4324 → TCP Tunnel → NAS relay client → bus:4322 (localhost)
```

TCP 隧道存根已预留在 `src/tunnel/` 中，当前 `createTunnelServer()` 和 `connectTunnel()` 均抛出 `Error('not implemented')`。

---

## 与 bus-server 的关系

| 对比 | bus-server | relay-server |
|:-----|:-----------|:-------------|
| 职责 | 核心消息总线 | 协议代理 |
| 存储 | sql.js 数据库 | 无数据库 |
| 业务逻辑 | Agent 管理、消息存储 | 纯转发 |
| WS 网关 | ✅ 有 | ❌ 无 |
| 认证 | 自身做 token 校验 | 透传 + relay_token 简单校验 |
| 端口 | 4322 | 4324 |
