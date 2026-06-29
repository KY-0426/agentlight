# 测试策略

## 当前测试入口

| 命令 | 作用 |
| --- | --- |
| `npm run test` | 运行前端 Vitest 单元测试（`src/**/*.test.ts`） |
| `npm run test:shared` | 运行 `@agent-light/shared` 包测试 |
| `npm run server:test` | 运行 Fastify 服务端测试（内存仓储，无需 Postgres） |
| `npm run test:all` | 依次运行前端、shared、server Vitest 与 `cargo test` |
| `npm run test:rust` | 仅运行 `src-tauri/` Rust 单元测试 |
| `npm run build` | TypeScript build + Vite build |
| `npm run assets:placeholder` | 生成 `public/assets/` 占位 PNG（CI 与全新 clone 后必跑） |
| `cargo test`（在 `src-tauri/`） | Rust 桌面端单元测试 |
| `npm run tauri dev` | 开发态桌面应用冒烟 |
| `npm run tauri build` | Tauri release 产物构建 |

当前 Vitest 配置只包含 `src/**/*.test.ts`，运行环境是 node。服务端与 shared 包有独立 Vitest 入口。

## 已有测试覆盖

| 文件 / 模块 | 覆盖 |
| --- | --- |
| `src/domain/status.test.ts` | 状态识别、alias 归一化、默认颜色、消息清洗、fallback event |
| `src/domain/leaderboard.test.ts` | 排行榜 URL 构建、响应解析 |
| `src/utils/debounce.test.ts` | debounce 工具 |
| `src/domain/aiTools.test.ts` | AI 工具 id 与展示元数据 |
| `src/components/AiToolTokenOverview.test.tsx` | AI 工具 Token 面板渲染 |
| `packages/shared/src/index.test.ts` | 共享 Zod schema |
| `server/src/**/*.test.ts` | 认证、设备、用量上报、排行榜、权限、日志脱敏 |
| `src-tauri/src/**/*.rs`（`#[test]`） | 状态解析、串口协议、Cursor/Claude Code、AI 工具 hooks、sync 队列 |
| `firmware/agent_light_esp32_rgb/` | ESP32 RGB 固件；需 Arduino IDE 或 `arduino-cli` 编译/刷写 |

## 最小回归矩阵

每次改动后按影响面选择：

| 改动类型 | 必跑 |
| --- | --- |
| 状态域、alias、消息清洗 | `npm run test` |
| shared schema、server 路由 | `npm run test:all` |
| React UI 或 Tauri client | `npm run test:all`、`npm run build`、手工 Tauri dev |
| Rust command、本地 API、Codex 读取 | `cargo test`（`src-tauri/`）、`npm run tauri dev`、API curl 冒烟 |
| Tauri 配置、窗口、capability | `npm run tauri dev`、窗口手工验证 |
| 发布配置、bundle、icon | `npm run build`、`npm run tauri build`、安装包首启 |
| docs only | Markdown 链接/路径复核，不需要构建，除非文档声明验证结果 |

## 手工冒烟清单

开发态：

1. `npm run tauri dev` 启动成功。
2. 主桌宠窗口显示。
3. 点击桌宠打开设置窗口。
4. 状态测试按钮能切换四种状态。
5. `GET /api/state` 返回 JSON。
6. `POST /api/state` 能更新状态。
7. `npm run agent-light -- status` 返回 JSON。
8. `npm run agent-light -- state completed "Done"` 能更新状态。
9. 完成态点击桌宠能回到待命。
10. 拖动到顶部附近后能吸附并隐藏硬件方块。
11. ESP32 已连接时，状态变化能驱动 RGB 灯颜色和动画。
12. ESP32 断开时，桌面 UI 和本地 API 不崩溃，设置页显示硬件错误。

Codex 联动：

1. Codex 活跃时，设置面板显示 working。
2. Codex 从活跃转空闲后，状态进入 completed。
3. Codex 不可用时，状态进入 attention 或显示不可用说明。

发布候选：

1. `npm run tauri build` 成功。
2. `.app` 能首次启动。
3. 主窗口、设置窗口、API、CLI 关键链路可用。
4. 未支持平台明确写入 release note。

## 缺口

- Tauri window/capability 缺自动化验证。
- CLI 与 `@agent-light/shared` 共用 `normalizeAgentStatus`，alias 归一化由 shared 测试覆盖。
- React 组件仅覆盖 AI 工具 Token 面板 smoke；其余组件仍缺单测。
- Codex 状态读取依赖本地数据结构，缺 fixture 和降级测试。
- 视觉动画缺截图或 Playwright/Tauri 手工验收记录。
- release build 与安装包首启尚需单独记录。
- CI 已覆盖 `test:all`、`build`、`cargo test`；Postgres 集成与 E2E 仍缺。

## 文档声明规则

- 未运行的命令只能写“未运行”或“待验证”。
- `tauri dev` 通过不能替代 `tauri build`。
- 浏览器预览通过不能替代 Tauri WebView。
- 单元测试通过不能证明窗口权限、系统指标和本地 API 真实可用。
