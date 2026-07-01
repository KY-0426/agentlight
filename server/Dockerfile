# Agent Light 服务端镜像（外置 MySQL，启动时自动 migrate）
# 使用 tsx 运行，兼容 @agent-light/shared 直接导出 .ts 的开发约定。
# 生产环境通过 .env 注入 ACCESS_TOKEN_SECRET / REFRESH_TOKEN_SECRET / DATABASE_URL。
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
