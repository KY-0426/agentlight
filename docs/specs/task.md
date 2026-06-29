# Agent Light 代办清单

最后更新：2026-06-28

## 目标

做真实多用户版本：

- Token 排行榜是真多用户，不是本地假数据。
- Win/Mac 客户端都能用。
- 硬件出厂预刷固件，用户插电脑即可识别。
- 本地桌宠和 ESP32 RGB 现有能力不能被破坏。

## 本轮软件 MVP 边界

- 本轮默认做软件 MVP：手机号验证码登录并自动创建账号、旧邮箱/邀请码兼容、服务端、Win/Mac 桌面同步、Token 上报、按 Agent 区分的全员 Token 排行榜、可选团队榜、设备绑定和硬件握手识别。
- 首版账号入口：用户输入手机号和验证码即可登录；手机号不存在时自动创建账号，旧邮箱/邀请码账号保留兼容。
- 未登录时仍保留本地桌宠、本地 loopback API、CLI、Codex 本地状态读取和 ESP32 RGB 本地控制。
- 登录后才开放云同步、Token 上报、团队榜、桌面设备注册、硬件设备绑定和跨设备数据归属；全员 Token 排行榜默认所有软件用户可见。
- 工厂量产工具、批次追踪、OTA、macOS 代码签名/公证、Windows 代码签名和自动更新移到 P2，不作为本轮完成条件。
- Windows Codex 数据路径当前无法在 macOS 仓库内证明，本轮先做可配置 provider，并在文档中标记实机待验证。
- 硬件灯效、刷写完成、Win/Mac 实机插拔等结论必须有实测记录；未跑不能写已通过。

## 状态说明

- `[ ]` 未开始
- `[~]` 进行中
- `[x]` 已完成
- `P0` 必须先做
- `P1` MVP 必须做
- `P2` 后续增强

## P0：先确认

- [x] P0 确认服务端技术栈：TypeScript + Fastify + PostgreSQL + Drizzle + Zod。
- [x] P0 确认新增 `server/` 和 `packages/shared/`。
- [x] P0 确认账号入口：手机号验证码登录并自动创建账号；邮箱登录兼容旧账号。
- [x] P0 确认账号模型：user、workspace、workspace_member，首个注册用户自动创建个人 workspace。
- [x] P0 确认 Token 口径：先按 Codex 本地线程 `tokens_used` 统计。
- [ ] P0 确认 Trae CN 本地数据路径与 token 统计口径：Codex 额度已用尽，新增 Trae CN 作为 agent 来源，需确认本地存储位置（候选 `~/Library/Application Support/Trae CN/`）和可读取的 token 字段。
- [~] P0 确认 Windows 上 Codex 本地数据路径：本轮先做可配置 provider，实机验证后改验收状态。
- [~] P0 确认 Trae CN 在 Windows 上的本地数据路径：与 Codex 同步做可配置 provider，实机验证后改验收状态。
- [~] P0 确认硬件量产方案：本轮只做 HELLO 握手和桌面识别；工厂量产工具移到 P2。
- [x] P0 确认普通用户不需要自己刷固件，出厂预刷。
- [x] P0 实现前补读远端 raw：`product-manager`、`backend-engineering`、`tauri-development`、`api-engineering`、`database-engineering`、`web-security`、`test-engineering`、`code-audit`、`embedded-firmware`。

## 后端服务端

- [x] P1 创建 `server/` 项目。
- [x] P1 创建 `packages/shared/`，放共享 Zod schema、DTO、错误码。
- [x] P1 配置 Fastify 启动、健康检查、环境变量校验。
- [x] P1 接入 PostgreSQL。
- [x] P1 接入 Drizzle 和 migration。
- [x] P1 建 `users` 表。
- [x] P1 建 `workspaces` 表。
- [x] P1 建 `workspace_members` 表。
- [x] P1 建 `devices` 表。
- [x] P1 建 `hardware_devices` 表。
- [x] P1 建 `codex_threads` 表。
- [x] P1 建 `usage_events` 表。
- [x] P1 建 `daily_usage_rollups` 表。
- [x] P1 建 `invite_codes` 表。
- [x] P1 建 `refresh_tokens` 表。
- [x] P1 建 `phone_verification_codes` 表。
- [x] P1 保留旧邮箱/邀请码注册接口兼容：`POST /api/auth/register`。
- [x] P1 实现手机号验证码发送：`POST /api/auth/phone/send-code`。
- [x] P1 实现手机号验证码登录并自动创建账号：`POST /api/auth/phone/verify`。
- [x] P1 实现登录接口：`POST /api/auth/login`。
- [x] P1 实现刷新 token 接口：`POST /api/auth/refresh`。
- [x] P1 实现当前用户接口：`GET /api/me`。
- [x] P1 实现桌面设备注册：`POST /api/devices/register`。
- [x] P1 实现硬件设备绑定：`POST /api/hardware-devices/bind`。
- [x] P1 实现 Codex 用量上报：`POST /api/usage/codex-thread`。
- [x] P1 实现 Token 排行榜：`GET /api/leaderboards/tokens`，默认全员榜，带 `workspace_id` 时为团队榜，带 `agent_provider` 时按 Codex / Claude Code / Trae CN 分榜。
- [ ] P1 扩展 `agent_provider` 枚举加入 `trae_cn`，并在 `usage_events` / `codex_threads` 之外补 `trae_cn_sessions` 来源（或复用同表加 provider 字段）。
- [ ] P1 实现 Trae CN 用量上报：`POST /api/usage/trae-cn-session`，复用同会话去重和旧值保护逻辑。
- [x] P1 做同线程去重：同一线程重复上报不能重复累计。
- [x] P1 做旧数据保护：旧 `tokens_used` 不能覆盖新值。
- [x] P1 做 workspace 权限校验：不能看其他团队数据。
- [x] P1 做日志脱敏：不能记录 Authorization、refresh token、完整本机路径。
- [x] P1 写服务端测试：手机号验证码登录自动建号、旧邮箱/邀请码注册兼容、登录、refresh、me、设备注册、硬件绑定、用量上报、去重、旧值保护、排行榜、越权、日志脱敏。
- [x] P2 增加 OpenAPI 文档。
- [ ] P2 增加数据备份和 migration 回滚策略。

## 桌面端 Win/Mac

- [x] P1 新增平台适配层：`src-tauri/src/platform/`。
- [x] P1 定义 `CodexStatusProvider`。
- [x] P1 定义 `SystemMetricsProvider`。
- [x] P1 定义 `SerialPortProvider`。
- [x] P1 定义 `SecureCredentialStore`。
- [x] P1 macOS 继续读取 `~/.codex/state_5.sqlite`。
- [ ] P1 macOS 实现 `TraeCnStatusProvider`：读取 Trae CN 本地用量数据（候选 `~/Library/Application Support/Trae CN/` 下的 sqlite / state 文件），实机验证后改验收状态。
- [~] P0 确认 Windows 上 Codex 本地数据路径：本轮先做可配置 provider，实机验证后改验收状态。
- [~] P0 确认 Trae CN 在 Windows 上的本地数据路径：与 Codex 同步做可配置 provider，实机验证后改验收状态。
- [x] P1 macOS 串口识别 `/dev/cu.*`。
- [x] P1 Windows 串口识别 `COMx`。
- [x] P1 增加服务端地址设置。
- [x] P1 增加手机号验证码登录入口，手机号不存在时自动建号。
- [x] P1 增加登录、登出入口。
- [x] P1 增加设备注册逻辑。
- [x] P1 增加 Token 用量上报队列。
- [x] P1 服务端不可用时，本地桌宠和 RGB 不崩溃。
- [x] P1 增加 Token 排行榜界面。
- [x] P1 Token 排行榜仅内置在设置页，不在主桌宠窗口放独立按钮。
- [x] P1 排行榜展示当前用户排名、Agent 分榜和合计 Token。
- [x] P1 增加同步状态：未登录、已登录、同步成功、同步失败、离线排队均已实现。
- [x] P1 客户端不上传完整本机路径。
- [x] P1 token 不写入 `localStorage`；先走 Rust-side 本地凭据文件。
- [ ] P2 macOS 凭据接 Keychain。
- [ ] P2 Windows 凭据接 Credential Manager。
- [ ] P2 增加托盘、自动启动、更新提示。

## 硬件和固件

- [ ] P0 确认目标硬件：开发板方案还是自研 PCB。
- [ ] P0 确认 USB 方案：CDC、HID、CH340、CP210x 或其他。
- [ ] P0 确认 Win/Mac 是否免驱。
- [ ] P0 确认 RGB 引脚定义和通道顺序。
- [x] P1 固件增加 `hello` 握手。
- [x] P1 固件返回 `hardware_device_id`。
- [x] P1 固件返回 `firmware_version`。
- [x] P1 固件返回 `protocol_version`。
- [x] P1 固件返回 `hardware_revision`。
- [x] P1 每台硬件写入唯一 `hardware_device_id`（基于 ESP32 MAC）。
- [x] P1 桌面端通过握手自动确认 Agent Light 硬件。
- [x] P1 桌面端不要要求普通用户手动选复杂串口参数。
- [x] P1 增加红、绿、蓝纯色测试固件命令。
- [ ] P1 验证硬件插拔后客户端不崩溃。
- [ ] P1 验证多个设备同时插入时的选择策略。
- [ ] P1 保留内部 USB 恢复刷机流程。
- [ ] P2 设计固件升级策略。
- [ ] P2 若做 OTA，单独设计签名、回滚、防断电变砖。

## 硬件量产

- [ ] P2 冻结硬件 revision。
- [ ] P2 冻结 BOM。
- [ ] P2 冻结固件烧录包。
- [ ] P2 建工厂烧录脚本或工具。
- [ ] P2 烧录 bootloader。
- [ ] P2 烧录 partition table。
- [ ] P2 烧录 app 固件。
- [ ] P2 写入设备唯一 ID。
- [ ] P2 记录固件 hash。
- [ ] P2 记录烧录时间、工站编号、硬件版本。
- [ ] P2 工厂执行 RGB 红色测试。
- [ ] P2 工厂执行 RGB 绿色测试。
- [ ] P2 工厂执行 RGB 蓝色测试。
- [ ] P2 工厂执行 USB 枚举测试。
- [ ] P2 工厂执行桌面端握手测试。
- [ ] P2 失败品隔离，不混入良品。
- [ ] P2 小批量试产并记录失败率。
- [ ] P2 建返工和恢复刷机流程。
- [ ] P2 建批次追踪后台。
- [ ] P2 建硬件售后诊断流程。

## 安全和隐私

- [x] P1 服务端所有写接口必须认证。
- [x] P1 用户只能上报自己的桌面设备。
- [x] P1 普通成员不能读取其他成员明细。
- [x] P1 排行榜只展示允许范围内的数据：全员榜展示昵称和 token 汇总；团队榜仍需 workspace 权限；当前登录用户只显示自己的排名。
- [x] P1 不上传 API key、cookie、token、私钥。
- [x] P1 不上传完整 rollout 文件路径。
- [x] P1 不在日志里打印完整请求体。
- [x] P1 本地服务端 token 不放 `localStorage`。
- [ ] P1 量产日志不记录用户私密凭据。
- [ ] P2 如果引入设备证书或私钥，单独设计密钥生命周期。

## 发布和运维

- [x] P1 建 Docker compose 本地开发环境。
- [x] P1 服务端生产环境变量校验。
- [ ] P1 macOS 打包冒烟。
- [ ] P1 Windows 打包冒烟。
- [ ] P1 Win/Mac 新机器插入硬件验证。
- [x] P1 写最小部署文档。
- [ ] P2 决定 macOS 代码签名和 notarization。
- [ ] P2 决定 Windows 代码签名。
- [ ] P2 设计自动更新。
- [ ] P2 设计服务端监控和告警。

## MVP 验收

- [x] 用户能用手机号验证码登录账号；手机号不存在时自动创建账号。（服务端测试通过）
- [x] 用户能登录桌面端。（代码已实现，待实机冒烟）
- [x] 用户能绑定桌面设备。（服务端测试通过）
- [x] 用户能绑定硬件设备。（服务端测试通过，待实机握手）
- [x] 未登录时，本地桌宠、RGB、本地 API 和 CLI 仍可用。
- [ ] macOS 能上报真实 Codex token。（代码已实现，待实机验证）
- [ ] Windows 能上报真实 Codex token。（provider 为骨架，待实机验证）
- [ ] macOS 能上报真实 Trae CN token。（provider 待实现，需先确认本地数据路径）
- [ ] Windows 能上报真实 Trae CN token。（provider 待实现，需先确认本地数据路径）
- [x] 同一 Codex 线程重复上报不会重复累计。（服务端测试通过）
- [x] 旧 `tokens_used` 上报不会覆盖较新累计值。（服务端测试通过）
- [x] Token 排行榜默认全员可见，能按团队展示，并能按 Codex / Claude Code 分榜。（服务端测试通过）
- [ ] Token 排行榜支持按 Trae CN 分榜（`agent_provider=trae_cn`）。（待实现）
- [x] 普通用户不能越权读取其他团队数据。（服务端测试通过）
- [x] 服务端断开时，本地桌宠和 RGB 仍可用。（离线队列已实现）
- [ ] 用户插上硬件后，桌面端能自动发现。（代码已实现，待实机验证）
- [ ] 桌面端通过 HELLO 握手识别 Agent Light 硬件。（固件+桌面端协议已实现，待实机验证）
- [ ] RGB 红、绿、蓝通道测试通过。（固件命令已实现，待实机验证）
- [ ] Win/Mac 都通过插拔、休眠唤醒、端口变化测试。
- [x] 工厂量产、OTA、签名、公证和自动更新不作为本轮软件 MVP Done 条件。

## 当前结论

- [x] 已确认真实多用户需要服务端。
- [x] 已确认 Java 可做，但首版推荐 TypeScript 后端更轻。
- [x] 已确认 Win/Mac 需要平台适配层。
- [x] 已确认硬件应出厂预刷固件，普通用户不自己刷。
- [x] 已确认首版账号入口为手机号验证码登录并自动创建账号，邮箱登录兼容旧账号。
- [x] 已确认未登录保留本地桌宠、RGB、本地 API 和 CLI。
- [x] 已确认工厂量产工具、OTA、签名发布和自动更新移到 P2。
- [x] 已读取 `embedded-firmware` raw，用于硬件和固件量产代办。
- [x] 已实现服务端后端 MVP 核心 API；服务端测试 17 passed，PostgreSQL 本地已跑通。
- [x] 已实现 Windows provider 骨架（Codex 路径可配置 + COMx 串口），实机验证待跑。
- [x] 已实现服务端 Token 排行榜 API；桌面端已增加默认全员榜、手机号登录入口、设备注册和在线自动上报。
- [x] 已实现离线同步队列、refresh token 自动续期；Keychain/Credential Manager 移到 P2。
- [x] 已实现 UI 大改：设置页 5 Tab（账号/排行榜/设备/灯效/硬件）+ 同步状态条。
- [x] 已实现 Docker compose 生产部署 + 最小部署文档（docs/engineering/deploy.md）。
- [x] 全部测试通过：前端 12 passed、服务端 17 passed、共享包 6 passed、cargo check 通过、tsc 通过。
- [ ] 已新增 Trae CN 作为 agent 来源（Codex 额度用尽后切换）：task.md 已补 P0 路径确认、后端 `trae_cn` provider 与上报接口、桌面端 `TraeCnStatusProvider`、MVP 验收 Trae CN token 上报与分榜；代码尚未实现，待确认本地数据路径后开工。
- [ ] 待实机验证：Win/Mac Codex token 上报、Trae CN token 上报、硬件 HELLO 握手、RGB 三色测试、插拔/休眠唤醒。
- [ ] 待 P2：macOS Keychain、Windows Credential Manager、代码签名、自动更新、OTA、工厂量产。
