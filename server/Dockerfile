# Agent Light 服务端镜像
# 使用 tsx 运行，兼容 @agent-light/shared 直接导出 .ts 的开发约定。
# 生产环境通过 .env 注入 ACCESS_TOKEN_SECRET / REFRESH_TOKEN_SECRET。
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY packages/shared/package.json ./packages/shared/
RUN npm ci

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY tsconfig.json tsconfig.node.json ./
COPY server/ ./server/
COPY packages/ ./packages/
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT:-8787}/health || exit 1
CMD ["npx", "tsx", "server/src/index.ts"]
