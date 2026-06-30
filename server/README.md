# Agent Light Server

Agent Light 多用户软件 MVP 的 Fastify 服务端。

## 当前能力

- `GET /health`
- `GET /api/health`
- `POST /api/auth/phone/send-code`
- `POST /api/auth/phone/verify`，手机号验证码登录；手机号不存在时自动创建账号
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `GET /api/me`
- `POST /api/devices/bootstrap`，安装时自动创建设备账户（无需登录），重复调用幂等返回同一用户
- `POST /api/activation/activate`，桌面客户端激活（消耗客户激活码并返回签名凭证）
- `GET /api/admin/activation-codes` / `POST /api/admin/activation-codes` / `POST /api/admin/activation-codes/:id/revoke`（需 `ADMIN_API_KEY`）
- `/admin/` 管理后台：生成、列表、作废客户激活码
- `POST /api/devices/register`（需登录，用于手机号账户绑定设备）
- `POST /api/hardware-devices/bind`
- `POST /api/usage/codex-thread`
- `GET /api/leaderboards/tokens`，不带 `workspace_id` 返回全员榜，带 `workspace_id` 返回需鉴权的团队榜，`agent_provider` 区分 Codex / Cursor / Claude Code
- Zod 环境变量校验
- Fastify 结构化错误响应
- Pino 日志脱敏配置
- 本地 PostgreSQL `compose.yaml`
- Drizzle schema 和 migration
- 共享 DTO/schema 来自 `@agent-light/shared`
- 服务端测试覆盖手机号验证码登录自动建号、邮箱登录、refresh、me、设备注册、硬件绑定、用量去重、旧值保护、Agent 分榜、排行榜、越权和日志脱敏配置

## 本地开发

```bash
cp server/.env.example server/.env
npm run db:setup
npm run db:migrate
npm run server:dev
```

本地 PostgreSQL（二选一）：

```bash
# Docker
docker compose up -d postgres

# 或本机已安装 PostgreSQL 17 时，用超级用户创建 agent_light 库/账号
npm run db:setup
npm run db:migrate
```

若本机 `postgres` 超级用户密码不是默认值，先设置：

```bash
set POSTGRES_ADMIN_PASSWORD=你的密码   # Windows CMD
$env:POSTGRES_ADMIN_PASSWORD='你的密码' # PowerShell
npm run db:setup
```

## 边界

- 本地单元测试使用内存仓储；真实 PostgreSQL migration 执行和数据库集成测试仍需单独跑。
- 桌面端启动时自动调用 bootstrap，无需登录即可上报 token 并上榜；手机号绑定与多设备合并即将推出
- Win/Mac 桌面端首次启动需客户激活码；激活成功后本地持久化，可离线使用
- 管理端通过 `/admin/` 生成激活码；生产环境需配置 `ADMIN_API_KEY` 与 `ACTIVATION_SIGNING_SECRET`
