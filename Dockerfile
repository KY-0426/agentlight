# Agent Light — 云托管 API 容器（外置 MySQL，数据持久化）
# 构建上下文：仓库根目录
# 云托管：Dockerfile 名称 Dockerfile，端口 8787
# 默认连接与密钥写在本文件 ENV；云托管环境变量可覆盖同名项

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
    LOG_LEVEL=info \
    DATABASE_URL=mysql://root:J6psd2ts@sh-cynosdbmysql-grp-ohimgd96.sql.tencentcdb.com:21534/agent_light \
    ACCESS_TOKEN_SECRET=d66a6245bec826d0014e2315fd40aeb7b93638cbbbe204a833e44044cd5cc28e \
    REFRESH_TOKEN_SECRET=271c7aceaff0047b88e14d5a4ad827eac09db27f1055a47a5ce81a8b620ac715 \
    ACTIVATION_SIGNING_SECRET=dd378a41cf8b76037a7556f0bb738d73c30a154b96422a6e34721fae4cc71cb4

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
