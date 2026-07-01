# Agent Light — 云托管 API 容器（外置 MySQL，数据持久化）
# 构建上下文：仓库根目录
# 云托管：Dockerfile 名称 Dockerfile，端口 8787
# 必填环境变量：DATABASE_URL=mysql://user:pass@10.15.108.198:3306/agent_light

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY packages/shared/package.json ./packages/shared/
RUN npm ci

FROM node:20-alpine AS runner
WORKDIR /app

RUN apk add --no-cache wget

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    LOG_LEVEL=info

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY tsconfig.json tsconfig.node.json ./
COPY server/ ./server/
COPY packages/ ./packages/

COPY server/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=5 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-8787}/health" || exit 1

ENTRYPOINT ["/docker-entrypoint.sh"]
