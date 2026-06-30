# 验收矩阵

本矩阵用于 spec 模式下的需求对账。状态含义：

- Done: 代码已实现，且有可复核证据。
- Partial: 代码或 UI 有痕迹，但链路未闭合。
- Planned: 已纳入当前软件 MVP，但代码尚未完成或尚未进入验证。
- Deferred: 明确不在当前 MVP。
- Unverified: 可能已实现，但本轮未运行验证，不能报通过。

| ID | 需求 | 状态 | 验收证据 | 缺口 |
| --- | --- | --- | --- | --- |
| F1 | 透明置顶主桌宠窗口 | Done | `src-tauri/tauri.conf.json` main window 配置 | release 包首启未在本轮验证 |
| F1.1 | 窗口拖动 | Done | `AgentPet.tsx` pointer drag，`tauriClient.ts` startDragging | 需手工回归不同显示器 |
| F1.2 | 顶部吸附 | Done | `snap_main_window_to_top`、`TOP_SNAP_THRESHOLD` | 需多屏幕验证 |
| F1.3 | 顶部隐藏硬件方块 | Done | `placement.near_top` 控制 `showHardwareBlock` | 需视觉截图验收 |
| F2 | 四状态视觉语义 | Done | `statusDefinitions`、`petFrames` | 需视觉 QA |
| F2.1 | 完成态点击确认 | Done | `acknowledgeCompleted` | 需手工回归 |
| F3 | `GET /api/state` | Done | `handle_connection` 分支 | 本轮曾读到 JSON，但自动测试未覆盖 |
| F3.1 | `POST /api/state` | Done | `StateRequest` + `runtime.apply` | 需补 API 自动化测试 |
| F3.2 | alias 归一化 | Done | Rust `Deserialize` 与 TS `stateAliases` | 需 Rust 侧测试 |
| F3.3 | body 长度限制 | Done | `MAX_BODY_LEN` | 需负向测试 |
| F4 | CLI status/state | Done | `bin/agent-light.mjs` | 需 CLI 自动化或手工记录 |
| F5 | 设置面板 | Done | `PetSettingsPanel.tsx` | 需视觉/交互 QA |
| F5.1 | 状态测试按钮 | Done | `onTrigger` -> `setAgentState` | 需手工回归 |
| F5.2 | 系统指标 | Done | `get_system_metrics` | macOS 优先，跨平台未验证 |
| F5.3 | Codex 概览 | Done | `get_codex_status` | 依赖本地 Codex 数据结构 |
| F5.4 | 开机启动开关 | Partial | UI 和 localStorage 配置存在 | 未见系统开机启动实现 |
| F6 | Codex 工作中自动同步 | Done | `syncFromCodexStatus` | 需长任务场景验证 |
| F6.1 | Codex 完成态提醒 | Done | `codexWasWorkingRef` 转换逻辑 | 需手工回归 |
| F6.2 | 手动状态保持窗口 | Done | UI/local API 写入后 15 秒内 Rust 拒绝 `codex_monitor` 覆盖；6 秒复测仍保持 `local_api/standby` | 无 |
| F7 | 小游戏入口 | Partial | 游戏标签和菜单 UI | 无可玩规则 |
| H1 | ESP32 RGB 固件源码 | Done | `firmware/agent_light_esp32_rgb/agent_light_esp32_rgb.ino` | 未上板刷写验证 |
| H1.1 | 桌面端串口写入 | Done | 释放旧 daemon 并非受限重启后，`/dev/cu.usbmodem101` 四状态写入均返回 `connected:true`、`last_error:null` | 需用户肉眼确认灯效 |
| H1.2 | 硬件状态 API | Done | `GET /api/hardware` 返回 `connected:true`、`port:/dev/cu.usbmodem101`、`last_state` | 无 |
| H1.3 | 断连/占用兜底 | Partial | 端口被旧 Python daemon 占用时，`GET /api/hardware` 返回 `connected:false` 和 `last_error`，`GET /api/state` 仍可用；释放后恢复连接 | 需拔插断连实测 |
| C1 | 邀请码注册 | Planned | 规格已确认首版为“邀请码注册 + 登录” | 尚未实现 `POST /api/auth/register`、邀请码表和注册测试 |
| C1.1 | 登录、refresh、当前用户 | Planned | API 范围已确认 `POST /api/auth/login`、`POST /api/auth/refresh`、`GET /api/me` | 尚未实现认证、refresh token 存储和负向测试 |
| C1.2 | 未登录本地能力保留 | Planned | MVP 边界要求未登录仍保留本地桌宠、RGB、本地 API、CLI | 尚未做回归记录 |
| C2 | 桌面设备注册 | Planned | API 范围已确认 `POST /api/devices/register` | 尚未实现设备模型、认证和桌面调用 |
| C3 | 硬件设备绑定 | Planned | API 范围已确认 `POST /api/hardware-devices/bind`；固件 HELLO 需返回硬件身份 | 尚未实现服务端绑定、固件 HELLO 和桌面握手识别 |
| C4 | Codex token 上报 | Planned | 口径已确认使用本地线程 `tokens_used`；客户端不得上传完整 `cwd` 或 `rollout_path` | 尚未实现上传队列、幂等和脱敏 payload 测试 |
| C4.1 | 同线程幂等和旧值保护 | Planned | 规则已确认同一 `workspace_id + user_id + device_id + codex_thread_id` 幂等，新值小于旧值不覆盖 | 尚未实现 DB 约束、upsert 逻辑和集成测试 |
| C5 | 团队 Token 排行榜 | Planned | API 范围已确认 `GET /api/leaderboards/tokens`，按 workspace 隔离 | 尚未实现 rollup、权限校验、越权测试和桌面 UI |
| C6 | 跨平台 provider | Planned | Win/Mac 平台适配层已纳入 MVP；Windows Codex 路径先可配置并标 Unverified | 尚未实现 `CodexStatusProvider`、`SystemMetricsProvider`、`SerialPortProvider`、`SecureCredentialStore` |
| C7 | 本地凭据不进 localStorage | Planned | 安全边界已确认 token 先走 Rust-side 本地凭据文件，P2 再接 Keychain/Credential Manager | 尚未实现凭据存储读写、失败降级和测试 |
| C8 | 服务端断开离线队列 | Planned | MVP 要求服务端不可用时本地桌宠/RGB 不崩溃，并进入离线排队 | 尚未实现队列、重试、同步状态 UI 和冒烟记录 |
| C9 | 客户激活码 | Done | `POST /api/activation/activate`、admin API、`/admin/` 管理页、桌面激活页与 Rust 本地凭证 | 需 Win/Mac 实机激活与离线复测 |
| D1 | 工厂量产工具、OTA、签名、公证、自动更新 | Deferred | 本轮软件 MVP 明确移到 P2 | 后续单独拆量产与发布计划 |
| R1 | `npm run test` | Done | 2026-06-22 本地运行通过：1 个测试文件，5 个用例 | 无 |
| R2 | `npm run build` | Done | 2026-06-22 本地运行通过：`tsc -b && vite build` | 无 |
| R3 | `npm run tauri build` | Unverified | Tauri 配置存在 | 本文档更新未运行 |

## MVP 出口标准

MVP 可进入版本化基线的最低条件：

1. 所有 Done 项都有一次手工或自动验收记录。
2. Partial 项被明确拆为“补实现”或“移出 MVP”。
3. `npm run test` 和 `npm run build` 通过。
4. `npm run tauri dev`、`GET /api/state`、`POST /api/state` 冒烟通过。
5. 当前代码进入首个 git commit。

## 多用户软件 MVP 出口标准

本轮多用户软件 MVP 进入 Done 前，还必须满足：

1. 邀请码注册、登录、refresh、`GET /api/me`、设备注册、硬件绑定、用量上报和排行榜接口均有自动化测试。
2. 云端写接口默认认证，workspace 数据隔离和越权读取有负向测试。
3. Codex 用量上报满足同线程幂等、旧 `tokens_used` 不覆盖新累计值，且 payload 不包含完整本机路径。
4. 桌面端未登录时本地桌宠、RGB、本地 API 和 CLI 仍可用；服务端断开时进入离线队列。
5. macOS 路径、Windows 可配置 provider、串口发现、硬件 HELLO 握手均有验证记录；Windows 实机未跑前保持 Unverified。
6. 工厂量产工具、OTA、签名、公证和自动更新不作为本轮 Done 条件。
