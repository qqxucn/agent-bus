# =====================================================
# Agent 消息总线 — 服务端 ALL-IN-ONE Dockerfile
# 多阶段构建：面板前端 → 总线服务端 → 运行
#
# 构建方式（在项目根目录）：
#   docker build -t agent-bus/bus-server -f Dockerfile .
# =====================================================

# ── Stage 1: 构建面板前端 ──
FROM node:22-alpine AS panel-build

WORKDIR /build/panel

COPY panel-frontend/package.json ./
RUN npm install

COPY panel-frontend/tsconfig*.json panel-frontend/vite.config.ts panel-frontend/index.html ./
COPY panel-frontend/public/ ./public/
COPY panel-frontend/src/ ./src/

RUN npm run build

# ── Stage 2: 构建总线服务端 ──
FROM node:22-alpine AS server-build

WORKDIR /build/server

COPY packages/bus-server/package.json packages/bus-server/tsconfig.json ./
RUN npm install

COPY packages/bus-server/src/ ./src/
RUN npm run build

# ── Stage 3: 运行 ──
FROM node:22-alpine

WORKDIR /app

# 只复制运行时依赖
COPY packages/bus-server/package.json packages/bus-server/tsconfig.json ./
RUN npm install --omit=dev

# 编译产物
COPY --from=server-build /build/server/dist/ ./dist/

# 面板静态文件（由 bus-server 的 /panel/ 路由 serve）
COPY --from=panel-build /build/panel/dist/ ./panel/

# 数据目录
RUN mkdir -p /app/data && chown -R node:node /app/data

USER node

EXPOSE 4322

ENV HTTP_PORT=4322
ENV DB_PATH=/app/data/bus.db

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:4322/api/health || exit 1

CMD ["node", "dist/index.js"]
