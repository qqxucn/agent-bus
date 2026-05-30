# =====================================================
# Agent 消息总线 — 总线服务端 Dockerfile
# 多阶段构建：编译 → 运行
# =====================================================

# ── Stage 1: Build ──
FROM node:22-alpine AS build

WORKDIR /build

# 依赖层（利用 Docker 缓存）
COPY package.json tsconfig.json ./
RUN npm install

# 源码层
COPY src/ ./src/
RUN npm run build

# ── Stage 2: Runtime ──
FROM node:22-alpine AS runtime

WORKDIR /app

# 只复制运行时依赖和编译产物
COPY package.json tsconfig.json ./
RUN npm install --omit=dev

COPY --from=build /build/dist/ ./dist/

# 默认数据目录（可挂载 volume）
RUN mkdir -p /app/data && chown -R node:node /app/data

USER node

EXPOSE 4322

ENV HTTP_PORT=4322
ENV DB_PATH=/app/data/bus.db
ENV PANEL_FRONTEND_PATH=/app/panel

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:4322/api/health || exit 1

CMD ["node", "dist/index.js"]
