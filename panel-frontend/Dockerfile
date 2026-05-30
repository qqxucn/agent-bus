# =====================================================
# Agent 消息总线 — 管理面板 Dockerfile
# 构建前端静态资源，输出到 dist/
# 最终产物由 bus-server 的 /panel/ 路由 serve
# =====================================================

FROM node:22-alpine AS build

WORKDIR /build

# 依赖层
COPY package.json ./
RUN npm install

# 源码层
COPY tsconfig*.json vite.config.ts index.html ./
COPY public/ ./public/
COPY src/ ./src/

# 构建
RUN npm run build

# ── 输出阶段 ──
# 产物直接给 bus-server 用，不另起服务
FROM scratch AS export

COPY --from=build /build/dist/ /dist/
