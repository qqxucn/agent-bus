# =====================================================
# Agent 消息总线 — 中继层 Dockerfile
# 多阶段构建：编译 → 运行
# =====================================================

# ── Stage 1: Build ──
FROM node:22-alpine AS build

WORKDIR /build

COPY package.json tsconfig.json ./
RUN npm install

COPY src/ ./src/
RUN npm run build

# ── Stage 2: Runtime ──
FROM node:22-alpine AS runtime

WORKDIR /app

COPY package.json tsconfig.json ./
RUN npm install --omit=dev

COPY --from=build /build/dist/ ./dist/

USER node

EXPOSE 4324

ENV RELAY_PORT=4324
ENV LISTEN_HOST=0.0.0.0

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:4324/relay/health || exit 1

CMD ["node", "dist/index.js"]
