# 开发指南

## 环境要求

- Node.js 24 或兼容当前依赖的 Node 版本
- npm
- Rust toolchain: `cargo` 和 `rustc`
- Arduino IDE 或 `arduino-cli`，用于 ESP32 RGB 固件
- macOS，当前 MVP 以 macOS 桌面为优先目标

## 安装依赖

```bash
npm install
```

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 只启动 Vite 前端预览 |
| `npm run tauri dev` | 启动完整 Tauri 桌面开发态 |
| `npm run test` | 运行 Vitest 单元测试 |
| `npm run build` | TypeScript build + Vite build |
| `npm run tauri build` | 构建 Tauri `.app` 产物 |
| `npm run agent-light -- status` | 通过 CLI 读取当前状态 |
| `npm run agent-light -- state completed "Done"` | 通过 CLI 写入状态 |

## 推荐开发流程

1. 更新或新增 spec。
2. 更新验收矩阵。
3. 实现最小任务切片。
4. 运行与切片匹配的测试。
5. 更新文档中的状态和缺口。
6. 提交前复核是否有未跟踪文件和未验证声明。

## 目录约定

| 路径 | 说明 |
| --- | --- |
| `src/` | React/TypeScript 前端 |
| `src/domain/` | 纯状态域逻辑 |
| `src/components/` | UI 组件 |
| `src-tauri/` | Tauri/Rust 桌面壳和本地 API |
| `firmware/agent_light_esp32_rgb/` | ESP32 RGB 灯固件 |
| `public/assets/` | 静态图像资源 |
| `bin/` | CLI wrapper |
| `docs/` | spec 模式文档 |

## 开发注意事项

- ESP32 硬件变更先更新 [ESP32 RGB 硬件规格](../specs/esp32-rgb-hardware.md)。
- 不要用浏览器预览结果代替 Tauri 运行结果。
- 不要在 release 文档中声称 `tauri build` 通过，除非实际运行并记录。
- 状态变更必须同时考虑 UI、CLI、本地 API、Codex 同步和测试断言。
- 改状态枚举时必须同步 TS、Rust、CLI、测试、README 和 API 文档。
- 改窗口 label 时必须同步 `tauri.conf.json`、capability 和 `get_webview_window` 调用。

## 本地调试样例

启动完整应用：

```bash
npm run tauri dev
```

读取状态：

```bash
curl -fsS http://127.0.0.1:18765/api/state
```

写入状态：

```bash
curl -fsS -X POST http://127.0.0.1:18765/api/state \
  -H 'Content-Type: application/json' \
  -d '{"state":"attention","message":"Review requested"}'
```

读取硬件状态：

```bash
curl -fsS http://127.0.0.1:18765/api/hardware
```

指定 ESP32 串口启动：

```bash
AGENT_LIGHT_SERIAL_PORT=/dev/cu.usbmodemXXXX npm run tauri dev
```

临时关闭硬件写入：

```bash
AGENT_LIGHT_HARDWARE=0 npm run tauri dev
```

检查 ESP32 串口占用：

```bash
lsof /dev/cu.usbmodemXXXX
ps -p <PID> -o pid,ppid,comm,args
```

旧的 `~/.codex/traffic_light/codex_status_light_daemon.py` 会占住同一个 USB 串口；硬件联调前应先关闭它或其他串口监视器。
