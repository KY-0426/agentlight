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
cp server/.env.example server/.env
# 编辑 server/.env，填入上面生成的两个密钥与 DATABASE_URL
```

## 三、启动服务

```bash
# 本地开发：MySQL 5.7
docker compose up -d mysql

# 启动 API + MySQL（生产 compose）
docker compose --profile prod up -d --build
```

## 四、数据库迁移

首次启动或 schema 变更后执行：

```bash
# 本地开发（需先创建库：docker compose up -d mysql）
npm run db:migrate

# Docker 生产环境（容器内执行；compose prod 镜像启动时会自动 migrate）
docker compose exec server npx drizzle-kit migrate
```

## 云托管（外置 MySQL / CynosDB）

部署时在云托管环境变量配置：

```bash
# 云托管容器（同 VPC，用内网）
DATABASE_URL=mysql://用户名:密码@10.15.108.198:3306/agent_light

# 本地 / 外网直连 CynosDB（用外网域名）
# DATABASE_URL=mysql://用户名:密码@sh-cynosdbmysql-grp-ohimgd96.sql.tencentcdb.com:21534/agent_light

ACCESS_TOKEN_SECRET=<openssl rand -hex 32>
REFRESH_TOKEN_SECRET=<openssl rand -hex 32>
ACTIVATION_SIGNING_SECRET=<openssl rand -hex 32>
NODE_ENV=production
HOST=0.0.0.0
PORT=8787
```

重新发布容器时，只要 MySQL 地址不变，**数据会保留**。

## 云托管部署检查清单

1. **环境变量 `DATABASE_URL`** 必须为 `mysql://...`（内网 `10.15.108.198:3306` 或 CynosDB 外网域名），不能只靠容器默认值。
2. 启动日志应出现 `Database: MySQL (external)`，随后 migration 成功，最后监听 `:8787`。
3. 健康检查失败 `connection refused` 通常是 migration 未跑完或进程崩溃——先看启动日志，不要只看 probe。

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
| `DATABASE_URL` | 是 | MySQL 5.7 连接串，如 `mysql://user:pass@10.15.108.198:3306/agent_light` |
| `HOST` | 否 | 默认 `0.0.0.0`（容器内需监听全部地址） |
| `PORT` | 否 | 默认 `8787` |
| `LOG_LEVEL` | 否 | 默认 `info` |

## 安全注意事项

- 生产环境必须设置 `NODE_ENV=production`，否则会使用开发态默认密钥
- `server/.env` 含敏感信息，切勿提交到版本库（已在 .gitignore）
- 本地 `compose.yaml` 中 MySQL 默认密码仅用于开发，生产请使用独立凭据与 CynosDB
- 桌面端上报 token 用量时会自动续期 access token，无需人工干预
