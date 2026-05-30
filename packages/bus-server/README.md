# @agent-bus/bus-server

Agent 消息总线 — 总线服务端。

消息路由 + Agent 管理 + WebSocket 网关 + REST API。

## 快速启动

```bash
npm install
npm run dev     # 开发模式（tsx watch）
npm run build   # 编译
npm start       # 生产运行
```

默认端口：`4322`

## API 概览

| 方法 | 路径 | 说明 |
|:-----|:-----|:-----|
| POST | `/api/agents/register` | 注册 Agent |
| GET | `/api/agents` | Agent 列表 |
| GET | `/api/agents/:id` | Agent 详情 |
| DELETE | `/api/agents/:id` | 删除 Agent |
| POST | `/api/messages/send` | 发送消息 |
| GET | `/api/messages/inbox` | 收取消息 |
| POST | `/api/messages/search` | 搜索消息 |
| GET | `/api/messages/log` | 消息日志（需 Admin Token） |
| GET | `/api/files` | 文件列表（需 Admin Token） |
| GET | `/api/files/upload` | 上传文件 |
| GET | `/api/files/:id` | 下载文件 |
| GET | `/api/stats` | 总线统计 |
| GET | `/api/v1/panel/stats` | 面板统计（需 Admin Token，更多字段） |
| GET | `/health` | 健康检查 |
| WS | `/ws` | WebSocket 实时通信 |

## 配置

所有配置通过环境变量传入：

| 变量 | 默认值 | 说明 |
|:-----|:-------|:-----|
| `HTTP_PORT` | `4322` | 监听端口 |
| `DB_PATH` | `./data/bus.db` | 数据库路径 |
| `ADMIN_TOKEN` | `admin` | 管理员 Token |
| `AGENT_TOKEN_SECRET` | `agent-secret` | Agent Token 密钥 |
| `HEARTBEAT_TIMEOUT` | `60` | 心跳超时(秒) |
| `HEARTBEAT_CHECK_INTERVAL` | `15` | 检查间隔(秒) |
| `MAX_INBOX_MESSAGES` | `200` | 收件箱上限 |
| `LOG_LEVEL` | `info` | 日志级别 |

## 目录结构

```
src/
├── index.ts                  # 入口
├── config.ts                 # 配置加载
├── types/index.ts            # 类型定义
├── api/
│   ├── routes.ts             # 路由注册
│   ├── auth.ts               # 认证中间件
│   ├── agent-controller.ts   # Agent 管理
│   ├── message-controller.ts # 消息收发
│   └── middleware.ts         # 通用中间件
├── core/
│   ├── index.ts              # 核心模块组装
│   ├── ws-gateway.ts          # WebSocket 网关
│   ├── connection-pool.ts    # 连接池管理
│   └── heartbeat.ts          # 心跳检测
├── storage/
│   ├── database.ts           # 数据库初始化
│   ├── agent-store.ts        # Agent 存储
│   └── message-store.ts      # 消息存储
└── panel/
    └── panel-routes.ts       # 管理面板 API
```

## 关联项目

- [agent-bus](https://github.com/qqxucn/agent-bus) — 主仓库
- [panel-frontend](../panel-frontend) — 管理面板前端 (🔜)
