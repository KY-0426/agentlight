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
- `POST /api/devices/register`
- `POST /api/hardware-devices/bind`
- `POST /api/usage/codex-thread`
- `GET /api/leaderboards/tokens`，不带 `workspace_id` 返回全员榜，带 `workspace_id` 返回需鉴权的团队榜，`agent_provider` 区分 Codex / Claude Code
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
npm run server:dev
```

本地 PostgreSQL：

```bash
docker compose up -d postgres
```

## 边界

- 本地单元测试使用内存仓储；真实 PostgreSQL migration 执行和数据库集成测试仍需单独跑。
- 桌面端已接入登录、排行榜 UI、设备注册和在线 token 上报；离线同步队列、refresh token 自动续期和硬件 HELLO 握手还未接入。
