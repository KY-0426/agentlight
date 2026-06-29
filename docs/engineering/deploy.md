# Agent Light 部署指南

## 前置要求
- Docker 24+ 与 Docker Compose v2
- OpenSSL（生成密钥）

## 一、生成生产密钥

```bash
echo "ACCESS_TOKEN_SECRET=$(openssl rand -hex 32)"
echo "REFRESH_TOKEN_SECRET=$(openssl rand -hex 32)"
```

## 二、准备环境变量

```bash
cp server/.env.production.example server/.env
# 编辑 server/.env，填入上面生成的两个密钥
```

## 三、启动服务

```bash
# 仅启动 PostgreSQL（本地开发，服务端用 npm run server:dev）
docker compose up -d postgres

# 启动 PostgreSQL + 服务端（生产）
docker compose --profile prod up -d --build
```

## 四、数据库迁移

首次启动或 schema 变更后执行：

```bash
# 本地开发
npm run db:migrate

# Docker 生产环境（容器内执行）
docker compose exec server npx drizzle-kit migrate
```

## 五、健康检查

```bash
curl http://127.0.0.1:8787/health
# 期望返回 {"ok":true,"service":"agent-light-server",...}
```

## 六、桌面端连接

桌面端设置页 → 账号 → 服务端地址填写 `http://<服务器IP>:8787`，用手机验证码登录即可。

## 配置项说明

| 变量 | 必填 | 说明 |
|------|------|------|
| `NODE_ENV` | 是 | 生产环境必须为 `production`，否则 secret 校验跳过 |
| `ACCESS_TOKEN_SECRET` | 生产必填 | ≥32 字符，用于签发 access token |
| `REFRESH_TOKEN_SECRET` | 生产必填 | ≥32 字符，用于签发 refresh token |
| `DATABASE_URL` | 是 | PostgreSQL 连接串 |
| `HOST` | 否 | 默认 `0.0.0.0`（容器内需监听全部地址） |
| `PORT` | 否 | 默认 `8787` |
| `LOG_LEVEL` | 否 | 默认 `info` |

## 安全注意事项

- 生产环境必须设置 `NODE_ENV=production`，否则会使用开发态默认密钥
- `server/.env` 含敏感信息，切勿提交到版本库（已在 .gitignore）
- PostgreSQL 默认密码仅用于开发，生产请修改 `compose.yaml` 中的凭据
- 桌面端上报 token 用量时会自动续期 access token，无需人工干预
