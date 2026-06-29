# Agent Light MVP 产品需求文档

最后更新：2026-06-23

## 1. 结论边界

Agent Light 是一个面向 AI coding agent 工作流的 macOS-first 桌面状态伴侣。MVP 的核心价值是：用户不必持续盯着终端，也能通过桌宠、完成提醒、本地 API/CLI 和可选 ESP32 RGB 灯判断 agent 当前状态。

本文档基于当前仓库代码、README、Tauri 配置、工程文档和硬件规格整理。未运行的新测试、未刷写的新固件、未签名发布的安装包、未验证的硬件灯效，不在本文中声明为已通过。

## 2. 问题定义

AI coding agent 的工作经常持续数分钟到更久。用户在等待期间会切换上下文，常见问题是：

- 不知道 agent 是否仍在工作、已经完成、还是卡在需要人工确认。
- 只能依赖终端或 IDE 信息，离开屏幕后状态不可见。
- 外部脚本、CLI 或本地自动化缺少统一的轻量状态入口。
- 后续实体灯接入需要稳定状态语义和失败兜底，不能把硬件失败反向拖垮桌面体验。

当前 MVP 先解决“本机可见、低打扰、可集成、可扩展到硬件”的最短闭环。

## 3. 目标与成功标准

### 3.1 用户目标

- 用户能在桌面任意位置看到 agent 当前状态。
- 用户能在完成态被持续提醒，并可手动确认已看到结果。
- 用户能通过本地 CLI/API 手动或脚本化更新状态。
- 用户能在 Codex 本地线程活跃或结束时获得自动状态同步。
- 用户能在 ESP32 已连接时用实体 RGB 灯看到同一套状态语义。

### 3.2 业务/项目目标

- 固化一个可持续迭代的 macOS 桌面 MVP 基线。
- 让后续硬件、小游戏、发布打包、开机启动等能力有明确入口和边界。
- 用 spec 模式管理范围，避免 UI、硬件、自动化和发布能力混在一起无证据推进。

### 3.3 成功指标

| 指标 | 口径 | MVP 目标 |
| --- | --- | --- |
| 状态写入成功率 | `POST /api/state` 或 CLI 写入后，UI/API 当前状态一致 | 开发态冒烟必须通过 |
| 状态可见性 | 四种状态在主桌宠和设置面板中可区分 | 手工视觉验收通过 |
| 完成提醒可恢复 | `completed` 点击确认后回到 `standby` | 手工验收通过 |
| 本机集成可用 | `GET /api/state`、`POST /api/state`、CLI `status/state` 可用 | 冒烟通过 |
| 基础质量 | `npm run test`、`npm run build` | 发布候选前通过 |
| 硬件兜底 | ESP32 未连接或写入失败时，桌宠 UI 和 API 不崩溃 | 手工或 API 验收 |

护栏指标：

- 本地 API 不暴露到非 loopback 网络。
- 硬件失败不阻断桌面状态更新。
- Codex 不可用时降级展示，不阻断手动状态和 API。
- 文档不把未验证事项写成已完成。

## 4. 用户与 JTBD

| 用户 | 场景 | JTBD | 成功结果 |
| --- | --- | --- | --- |
| AI coding agent 使用者 | agent 长时间执行任务 | 当我离开终端做其他事时，我想一眼知道 agent 是否仍在工作 | 看到黄色工作态或绿色完成态 |
| AI coding agent 使用者 | agent 完成后等待确认 | 当任务结束时，我想被持续提醒，直到我确认结果已看到 | `completed` 持续提醒，点击后回到 `standby` |
| AI coding agent 使用者 | agent 需要人工批准或处理 | 当 agent 卡在人工步骤时，我想快速知道需要介入 | 红色 `attention` 明确出现 |
| 本地开发者 | 写脚本或调试集成 | 当脚本完成/失败时，我想用本地 API 或 CLI 更新状态 | API/CLI 能写入标准状态和消息 |
| 硬件开发者 | 接入实体 RGB 灯 | 当状态变化时，我想复用同一状态语义驱动 ESP32 | 串口协议和灯效映射稳定，失败可诊断 |

## 5. MVP 范围

### 5.1 本期范围

- macOS-first Tauri v2 桌面应用。
- 透明、置顶、可拖动的主桌宠窗口。
- 设置窗口：状态测试、运行概览、Codex 摘要、系统指标、硬件状态、小游戏占位。
- 四种标准状态：`standby`、`working`、`completed`、`attention`。
- 状态 alias 兼容：`idle`、`running`、`success`、`error`、`needs_action`。
- 本机 loopback API：`GET/POST /api/state`、`GET /api/codex`、`GET /api/hardware`。
- CLI 包装器：`agent-light status`、`agent-light state <state> [message]`。
- Codex 本地状态读取与自动同步。
- ESP32 USB Serial RGB 写入链路、固件源码、硬件状态快照。
- 文档、验收矩阵、测试策略、运行手册和发布说明。

### 5.2 非目标

- 不做账号系统、云同步、远程 API、团队协作或多设备同步。
- 不做移动端、Windows、Linux 的正式支持承诺。
- 不做 BLE、Wi-Fi、本地网络设备、多灯同步或 OTA。
- 不做生产签名、公证、DMG 分发、自动更新。
- 不做完整小游戏玩法、关卡、计分、碰撞、音效。
- 不把开机启动作为已交付能力；当前只保留 UI/配置占位，除非后续补系统实现。
- 不承诺 Codex 内部数据库 schema 长期稳定。

## 6. 优先级与版本切片

| 优先级 | 需求 | 说明 |
| --- | --- | --- |
| P0 | 状态模型、主桌宠、本地 API、CLI、完成态确认 | MVP 核心闭环 |
| P0 | 文档与验收矩阵 | spec 模式基线，防止范围漂移 |
| P1 | 设置面板、Codex 同步、系统指标、硬件状态 | 提升可用性和可观测性 |
| P1 | ESP32 USB Serial 写入、固件源码 | 硬件 MVP，允许板级验收滞后但需明确标注 |
| P2 | 发布候选、`.app` 首启、release checklist | 进入可分发前置 |
| P3 | 开机启动、小游戏可玩化、自定义皮肤、多灯/无线 | 后续扩展 |

MVP 出口标准以 [验收矩阵](../product/acceptance-matrix.md) 为准。`Partial` 项必须在发布候选前明确为“补实现”“补验证”或“移出 MVP”。

## 7. 状态模型

| 状态 | 含义 | 主视觉 | 硬件 RGB | 模式 | 典型来源 |
| --- | --- | --- | --- | --- | --- |
| `standby` | 待命 | 蓝色呼吸 | `0,0,255` | `breathe` | 启动默认、完成确认、手动/CLI/API |
| `working` | 工作中 | 黄色常亮 | `255,191,0` | `steady` | Codex 活跃、手动/CLI/API |
| `completed` | 已完成 | 绿色闪烁提醒 | `0,255,0` | `repeat_pulse` | Codex 从工作转空闲、手动/CLI/API |
| `attention` | 需处理 | 红色闪烁提醒 | `255,0,0` | `pulse` | Codex 不可用、需授权、故障、手动/CLI/API |

规则：

- API、CLI、前端和 Rust 后端都必须使用同一状态语义。
- Legacy alias 必须归一化为标准状态再返回。
- 状态消息必须 trim、压缩空白并限制长度，避免破坏 UI。
- 当前优先级策略是 last writer wins；UI/API 手动写入后短时间内保护手动状态，避免 Codex 轮询立刻覆盖。
- `completed` 是提醒态，不是永久结束状态；用户点击确认或新状态写入后可以离开该状态。

## 8. 用户旅程

### 8.1 等待 agent 工作

1. 用户启动 Agent Light。
2. 主桌宠窗口出现在桌面，默认 `standby`。
3. Codex 本地线程活跃，或用户/API 写入 `working`。
4. 桌宠和可选硬件灯变为工作态。
5. Codex 从活跃转空闲，或外部脚本写入 `completed`。
6. 桌宠持续完成提醒，直到用户点击确认或新任务覆盖状态。

### 8.2 本地脚本集成

1. 外部脚本执行任务。
2. 脚本通过 CLI 或 `POST /api/state` 写入 `working`、`completed` 或 `attention`。
3. Rust 后端更新状态、广播给前端，并 best-effort 写 ESP32 串口。
4. 脚本可通过 `GET /api/state` 读取当前状态。

### 8.3 硬件异常兜底

1. ESP32 未连接、端口被占用或写入失败。
2. 桌宠 UI、API、CLI 仍更新状态。
3. 设置面板和 `GET /api/hardware` 展示 `connected:false` 或 `last_error`。
4. 用户按运行手册检查串口、固件、接线和权限。

## 9. 功能需求

### F1 主桌宠窗口

用户故事：作为 AI coding agent 使用者，我想看到一个低打扰、透明、置顶、可移动的桌宠窗口，以便持续观察 agent 状态。

验收标准：

- Given 应用启动，When 主窗口加载，Then 显示透明、无装饰、置顶、跳过任务栏的桌宠窗口。
- Given 用户拖动桌宠，When 拖动结束靠近屏幕顶端，Then 窗口吸附到顶端。
- Given 窗口远离顶部，When 桌宠显示，Then 头顶硬件方块出现。
- Given 窗口靠近顶部，When 桌宠显示，Then 硬件方块隐藏，便于对齐真实灯。
- Edge：多屏幕、不同菜单栏高度、窗口权限异常需要标为手工回归项。

### F2 状态显示与完成确认

用户故事：作为用户，我想不同状态有明显颜色和动画差异，以便一眼判断任务阶段。

验收标准：

- Given 状态为 `standby`，Then 显示蓝色呼吸待命语义。
- Given 状态为 `working`，Then 显示黄色常亮工作语义。
- Given 状态为 `completed`，Then 显示绿色完成提醒，且桌宠持续跳动或明显提醒。
- Given 状态为 `completed`，When 用户点击桌宠确认，Then 状态回到 `standby`。
- Given 状态为 `attention`，Then 显示红色闪烁需处理语义。
- Given 消息过长、含换行或多余空白，Then 展示前被清洗和截断。

### F3 设置面板

用户故事：作为用户，我想打开设置面板，以便手动测试状态、查看 Codex/系统/硬件摘要和未来扩展入口。

验收标准：

- Given 点击非完成态桌宠，Then 打开设置窗口。
- Given 设置窗口打开，Then 能看到当前状态、状态测试按钮、最近事件、系统指标、Codex 摘要和硬件状态。
- Given 点击状态测试按钮，Then 当前状态更新并广播到主窗口。
- Given 系统指标或 Codex 状态读取失败，Then 设置面板降级展示，不阻断状态测试。
- Given 切到小游戏标签，Then 显示占位菜单和视觉预览；本期不要求可玩。

### F4 本地状态 API

用户故事：作为本地开发者，我想通过 HTTP API 读写状态，以便脚本、agent 或调试工具集成。

验收标准：

- Given 应用运行，When 请求 `GET /api/state`，Then 返回当前 `StatusSnapshot` JSON。
- Given 应用运行，When 请求 `POST /api/state` 且 body 合法，Then 状态更新、返回新快照并广播到前端。
- Given 请求状态 alias，Then API 归一化为标准状态。
- Given body 超过 4096 bytes、JSON 无效或状态未知，Then 返回结构化错误 JSON。
- Given 请求未知路径，Then 返回 `not_found`。
- Edge：API 只绑定 `127.0.0.1`；如果未来开放局域网或公网，必须重做认证、CORS 和威胁模型。

### F5 CLI

用户故事：作为本地开发者，我想用命令行读写 Agent Light 状态，以便接入 shell、npm script 或自动化任务。

验收标准：

- Given 应用运行，When 执行 `npm run agent-light -- status`，Then 打印当前状态 JSON。
- Given 应用运行，When 执行 `npm run agent-light -- state completed "Done"`，Then API 状态更新为 `completed`。
- Given 输入非法状态，Then CLI 输出错误和用法，进程返回失败状态。
- Given 设置 `AGENT_LIGHT_URL`，Then CLI 使用指定 API base。

### F6 Codex 状态联动

用户故事：作为 Codex 用户，我想 Agent Light 自动识别本机 Codex 活跃情况，以便减少手动切换状态。

验收标准：

- Given 读取到最近 Codex 线程处于活跃窗口，Then 状态同步为 `working`。
- Given 之前处于 `working` 且 Codex 不再活跃，Then 状态同步为 `completed`。
- Given Codex CLI 或本地状态不可用，Then 设置面板展示不可用说明，并可同步为 `attention`。
- Given 用户刚通过 UI 或 local API 手动写入状态，Then Codex 轮询不得立刻覆盖手动状态。
- Edge：Codex CLI 路径、SQLite schema、token 字段和线程更新时间都属于易变依赖，必须允许降级。

### F7 ESP32 RGB 硬件联动

用户故事：作为用户，我想实体 RGB 灯随 Agent Light 状态变化，以便离开屏幕也能看到 agent 状态。

验收标准：

- Given ESP32 已刷入固件并通过 USB 连接，When 状态变为 `standby`，Then RGB 灯显示蓝色呼吸灯效。
- Given 状态变为 `working`，Then RGB 灯显示黄色常亮灯效。
- Given 状态变为 `completed`，Then RGB 灯显示绿色一亮一灭闪烁提醒。
- Given 状态变为 `attention`，Then RGB 灯显示红色一亮一灭闪烁提醒。
- Given ESP32 未连接、串口被占用或写入失败，Then UI/API/CLI 仍可用，硬件状态快照记录错误。
- Given 用户问固件是否已刷写，Then 只能用 `arduino-cli upload`、Arduino IDE 上传成功或等价上传日志作为刷写完成证据。

### F8 小游戏入口占位

用户故事：作为用户，我想看到未来小游戏入口，以便理解后续体验扩展方向。

验收标准：

- Given 打开设置窗口，When 切到小游戏，Then 显示小游戏菜单和视觉预览。
- 本期不要求开始游戏、关卡选择、计分、碰撞、音效或存档真实可用。

## 10. 非功能需求

| 类别 | 要求 |
| --- | --- |
| 本地优先 | 默认只监听 `127.0.0.1`，不依赖云端服务 |
| 低打扰 | 主窗口置顶但小尺寸、无装饰、跳过任务栏 |
| 稳定性 | 硬件、Codex、系统指标失败不得阻断状态 API 和 UI |
| 安全边界 | loopback API 不承诺公网安全；消息不应包含 token、cookie、私钥或完整用户数据 |
| 权限最小化 | Tauri capability 只开放当前窗口能力需要的权限 |
| 可诊断 | API、CLI、设置面板、运行手册都能定位状态和硬件问题 |
| 可测试 | 状态域有单测；API、CLI、窗口、硬件链路有明确手工/自动验收入口 |
| 可发布 | 发布候选前必须区分 dev 成功、build 成功、`.app` 首启成功 |

## 11. 数据与状态对象

`StatusSnapshot` 字段：

| 字段 | 说明 |
| --- | --- |
| `state` | 标准状态值 |
| `message` | 可选展示消息，服务端和前端都需清洗 |
| `source` | 来源：`boot`、`ui`、`local_api`、`codex_monitor`、`fallback` 等 |
| `sequence` | 运行期递增序号 |
| `timestamp_ms` | 生成时间戳 |

持久化边界：

- 当前不持久化状态历史。
- 前端只用 `localStorage` 保存用户配置，例如 `agent-light-config-v1`。
- 硬件状态是运行期快照，通过 `GET /api/hardware` 读取。

## 12. 埋点与观测口径

当前 MVP 没有远程 analytics。最小观测用以下本机证据替代：

| 事件/证据 | 触发时机 | 用途 |
| --- | --- | --- |
| `agent-state` Tauri event | 状态更新后广播 | 前端同步和最近事件 |
| `GET /api/state` 响应 | 手工或 CLI 读取 | 状态一致性验证 |
| `POST /api/state` 响应 | 外部写入状态 | API 集成验证 |
| `GET /api/hardware` 响应 | 查看硬件状态 | 串口连接和错误诊断 |
| Rust stderr 日志 | 启动 API、硬件写入失败 | 本机排障 |
| 手工截图/录屏/灯效记录 | UI 或硬件验收 | 视觉和硬件证据 |

后续如加入正式埋点，需要补事件名、触发时机、去重、分母、保留周期、隐私边界和看板 owner。

## 13. 依赖与 owner

| 依赖 | 当前来源 | owner | 风险 | 处理口径 |
| --- | --- | --- | --- | --- |
| Tauri v2 / Rust 后端 | `src-tauri/**` | 工程 | macOS private API、窗口权限 | 发布候选前复核 |
| React/TS 前端 | `src/**` | 工程 | 浏览器预览不等于 Tauri WebView | Tauri dev 手工验收 |
| 本地 API | Rust `TcpListener` | 工程 | 无认证、CORS 宽松 | 限定 loopback |
| CLI | `bin/agent-light.mjs` | 工程 | 依赖 API 运行 | CLI 冒烟 |
| Codex 本地状态 | Codex CLI + SQLite | 工程/用户环境 | schema 易变 | best-effort 降级 |
| ESP32 硬件 | USB Serial + 固件 | 硬件/工程 | GPIO、串口占用、刷写证据 | 板级验收单独记录 |
| 发布打包 | Tauri bundle | 工程 | 未签名、公证、DMG | release 阶段处理 |
| 用户文档 | `docs/**` | 产品/工程 | 文档与实现漂移 | spec 先行，验收矩阵对账 |

## 14. 验收计划

### 14.1 开发态最低验收

- `npm run test`
- `npm run build`
- `npm run tauri dev`
- 主桌宠窗口显示。
- 设置窗口可打开。
- 四状态按钮可切换。
- `GET /api/state` 返回 JSON。
- `POST /api/state` 更新状态。
- CLI `status/state` 可用。
- `GET /api/hardware` 返回硬件快照，未连接时也能给出可诊断错误。

### 14.2 发布候选额外验收

- `npm run tauri build`
- macOS `.app` 首次启动。
- 主窗口、设置窗口、API、CLI、Codex 摘要、硬件状态关键链路手工回归。
- 未支持平台和未验证能力写入 release note。
- Partial/Unverified 项有 owner、处理决定和复盘时间。

### 14.3 硬件验收

- 固件编译记录。
- 固件上传成功记录。
- `PING/PONG` 串口回读。
- 四状态肉眼灯效确认。
- `/api/hardware` 连接、断连、指定端口、关闭硬件写入的快照记录。

## 15. 需求对账状态

| 项 | 当前状态 | 证据 | 缺口 |
| --- | --- | --- | --- |
| Tauri v2 桌面壳 | 已实现 | `src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml` | release 包首启需验证 |
| 主桌宠窗口 | 已实现 | `src/components/AgentPet.tsx`、Tauri main window 配置 | 多屏视觉回归 |
| 设置窗口 | 已实现 | `src/components/PetSettingsPanel.tsx`、settings window 配置 | 交互/视觉手工记录 |
| 状态域 | 已实现 | `src/domain/status.ts`、`src-tauri/src/main.rs` | Rust 状态域自动化测试不足 |
| 本地 API | 已实现 | `src-tauri/src/main.rs` | API 负向自动化测试不足 |
| CLI | 已实现 | `bin/agent-light.mjs` | CLI 自动化测试不足 |
| Codex 状态联动 | 已实现，需持续验证 | `src/App.tsx`、`src-tauri/src/main.rs` | 依赖 Codex 本地 schema |
| 系统指标 | 已实现，macOS 优先 | `src-tauri/src/main.rs` | 跨平台不承诺 |
| 开机启动 | UI 占位 | `src/App.tsx` | 未见系统实现 |
| 小游戏 | 占位 | `src/components/PetSettingsPanel.tsx` | 无可玩规则 |
| ESP32 RGB 硬件 | 源码和桌面写入链路存在 | `src-tauri/src/main.rs`、`firmware/agent_light_esp32_rgb/` | 固件刷写、串口回读、肉眼灯效需单独证据 |
| 打包发布 | 配置存在 | `src-tauri/tauri.conf.json` | `tauri build` 和 `.app` 首启需验证 |

## 16. 风险与关闭条件

| 风险 | 影响 | owner | 关闭条件 |
| --- | --- | --- | --- |
| 本地 API 无认证 | 同机进程可写状态 | 工程 | 保持 loopback；若开放网络，先补安全设计 |
| CORS 当前允许所有 origin | 本机调试方便但边界需复核 | 工程 | release 前确认是否收紧 |
| Codex schema 易变 | 自动状态同步可能误判 | 工程 | 降级展示；补 fixture 或手工回归 |
| ESP32 GPIO 1/3 可能冲突 | 红/蓝通道不工作或串口异常 | 硬件/工程 | 确认 board revision、接线、共阴/共阳和纯色测试 |
| 固件刷写未记录 | 不能证明实体灯运行的是当前固件 | 硬件/工程 | 上传日志 + 串口 `PING/PONG` + 灯效记录 |
| 开机启动仅 UI 占位 | 用户误以为已生效 | 产品/工程 | 移出 MVP 或补系统实现和验收 |
| macOS private API | 发布签名/公证风险 | 工程 | release 阶段复核 |
| 文档与实现漂移 | 后续开发误判范围 | 产品/工程 | 每次功能变更同步 spec 和验收矩阵 |

## 17. 决策日志

| 日期 | 决策 | 理由 | 后续复盘 |
| --- | --- | --- | --- |
| 2026-06-22 | 采用 spec 模式管理需求和验收 | 当前项目跨 UI、Tauri、API、CLI、硬件，需先固化边界 | 后续开发先改 spec |
| 2026-06-22 | ESP32 第一阶段使用 USB Serial + RGB | 最短硬件闭环，便于本机调试 | 硬件稳定后再评估 BLE/网络 |
| 2026-06-22 | 纯色映射用于 RGB bring-up | 蓝/绿/红通道更容易定位接线和极性问题 | 实机验收后再考虑更丰富灯效 |
| 2026-06-23 | MVP 需求文档升级为 PRD 口径 | 补齐目标、范围、验收、指标、依赖和风险，便于后续交付 | 下次实现前同步验收矩阵 |

## 18. 证据索引

| 结论 | 证据 |
| --- | --- |
| 项目是 Tauri v2 + React/TS 桌面应用 | `README.md`、`package.json`、`src-tauri/tauri.conf.json` |
| 主窗口是透明置顶桌宠窗口 | `src-tauri/tauri.conf.json`、`src/components/AgentPet.tsx` |
| 设置窗口存在并包含状态/Codex/硬件摘要 | `src/components/PetSettingsPanel.tsx` |
| 状态域包含四种标准状态和 alias | `src/domain/status.ts`、`src-tauri/src/main.rs`、`bin/agent-light.mjs` |
| 本地 API 绑定 `127.0.0.1:18765` | `src-tauri/src/main.rs`、`docs/engineering/api.md` |
| CLI 通过本地 API 读写状态 | `bin/agent-light.mjs` |
| Codex 状态读取是 best-effort 本机集成 | `src/App.tsx`、`src-tauri/src/main.rs`、`docs/engineering/architecture.md` |
| ESP32 RGB 串口协议和固件存在 | `src-tauri/src/main.rs`、`firmware/agent_light_esp32_rgb/agent_light_esp32_rgb.ino` |
| 当前硬件板级刷写/灯效仍需证据 | `docs/specs/esp32-rgb-hardware.md`、`docs/product/acceptance-standards.md` |
| 测试入口和缺口已记录 | `docs/engineering/testing.md`、`vitest.config.ts` |
