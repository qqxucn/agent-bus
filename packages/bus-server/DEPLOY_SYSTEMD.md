# Agent 消息总线 — Systemd 部署指南

如果目标机器没有 Docker（或不方便使用 Docker），可以通过 systemd 直接管理 bus-server。
本指南基于 Node.js 18+，使用 tsx 运行时。

---

## 前置要求

- Node.js 18+（建议 20+）
- npm（随 Node.js 一起安装）
- Git（用于拉取代码）
- 网络：能访问 GitHub

## 一键部署

```bash
# 1. 克隆仓库
git clone https://github.com/qqxucn/agent-bus.git /opt/agent-bus --depth 1

# 2. 安装依赖
cd /opt/agent-bus/packages/bus-server
npm install

# 3. 创建数据目录
mkdir -p /opt/agent-bus/data

# 4. 创建 systemd 服务（见下方）
```

## Systemd 服务配置

创建 `/etc/systemd/system/agent-bus.service`：

```ini
[Unit]
Description=Agent Message Bus Server
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/agent-bus/packages/bus-server
ExecStart=/opt/agent-bus/packages/bus-server/node_modules/.bin/tsx src/index.ts
Restart=always
RestartSec=5
Environment=NODE_ENV=production
# ── 服务端口 ──
Environment=HTTP_PORT=4322
# ── 数据文件路径 ──
Environment=DB_PATH=/opt/agent-bus/data/bus.db
# ── 🔴 重要：修改为强密码 ──
# 管理面板登录密码，默认 'admin'
Environment=ADMIN_TOKEN=7424994884
# ── 🔴 重要：修改为强密钥 ──
# 用于 HMAC-SHA256 生成 Agent 认证 Token
Environment=AGENT_TOKEN_SECRET=agent-bus-secret-2026
# ── 日志级别 ──
Environment=LOG_LEVEL=info

[Install]
WantedBy=multi-user.target
```

> ⚠️ **务必修改** `ADMIN_TOKEN` 和 `AGENT_TOKEN_SECRET`！
> - `ADMIN_TOKEN` 控制管理面板的访问权限，泄露后他人可查看/管理总线
> - `AGENT_TOKEN_SECRET` 控制 Agent 身份认证，泄露后可伪造 Agent 身份

## 启动服务

```bash
# 重新加载 systemd
systemctl daemon-reload

# 启动服务
systemctl start agent-bus

# 设置开机自启
systemctl enable agent-bus

# 查看状态
systemctl status agent-bus

# 查看日志
journalctl -u agent-bus -n 50 --output cat

# 重启服务
systemctl restart agent-bus

# 停止服务
systemctl stop agent-bus
```

## 验证部署

```bash
# 健康检查（两个端点均可）
curl http://localhost:4322/health
# 应返回: {"status":"healthy","uptime":12345,...}
curl http://localhost:4322/api/health
# 应返回: {"code":0,"data":{"status":"healthy",...}}

# 管理面板
# 浏览器访问 http://<服务器IP>:4322/panel/
# 使用 ADMIN_TOKEN 登录
```

## 更新服务

```bash
cd /opt/agent-bus
git pull
cd packages/bus-server
npm install
systemctl restart agent-bus
```

## 注意事项

1. **端口放行**：确保防火墙已放行 `4322/tcp`
2. **磁盘空间**：总线数据存储在 `DB_PATH` 指定路径，需保证挂载目录有足够空间
3. **内存占用**：单实例运行约 50-100MB RAM（基于 Node.js）
4. **日志轮转**：推荐配置 journald 日志大小上限，避免日志撑满磁盘：
   ```bash
   journalctl --vacuum-size=200M
   ```
