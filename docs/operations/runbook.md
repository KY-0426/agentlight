# 运行手册

## 开发态启动

```bash
npm run tauri dev
```

预期：

- Vite 显示 `http://127.0.0.1:1420/`
- Tauri/Rust 打印本地 API 监听 `http://127.0.0.1:18765`
- macOS 桌面出现 Agent Light 桌宠窗口

## 浏览器预览

```bash
npm run dev
```

浏览器访问：

```text
http://127.0.0.1:1420/
```

注意：浏览器预览只验证前端 fallback，不验证 Tauri WebView、窗口权限和本地 Rust API。

## 读取状态

```bash
curl -fsS http://127.0.0.1:18765/api/state
```

或：

```bash
npm run agent-light -- status
```

## 写入状态

```bash
npm run agent-light -- state working "Codex 正在工作"
```

或：

```bash
curl -fsS -X POST http://127.0.0.1:18765/api/state \
  -H 'Content-Type: application/json' \
  -d '{"state":"attention","message":"需要人工处理"}'
```

## 读取硬件状态

```bash
curl -fsS http://127.0.0.1:18765/api/hardware
```

ESP32 默认自动发现 `/dev/cu.usbmodem*` 和 `/dev/cu.usbserial*`。如需指定端口：

```bash
AGENT_LIGHT_SERIAL_PORT=/dev/cu.usbmodemXXXX npm run tauri dev
```

临时关闭硬件写入：

```bash
AGENT_LIGHT_HARDWARE=0 npm run tauri dev
```

## 常见问题

### 端口 1420 被占用

Vite 配置了 `strictPort: true`。释放端口后重新运行：

```bash
npm run tauri dev
```

### 端口 18765 被占用

Rust 本地 API 会打印 bind 失败，并禁用本地 API。检查是否已有 Agent Light 实例运行，或释放端口后重启。

### 浏览器能打开，但桌面没有窗口

只运行 `npm run dev` 不会启动 Tauri。需要运行：

```bash
npm run tauri dev
```

### CLI 连接失败

确认桌面应用正在运行，并确认 `AGENT_LIGHT_URL` 是否被覆盖：

```bash
echo $AGENT_LIGHT_URL
```

默认应连接：

```text
http://127.0.0.1:18765
```

### Codex 显示不可用

可能原因：

- 本机没有可读的 Codex 线程线索。
- Codex CLI/schema 没提供登录或额度字段。
- 最近线程超过活跃窗口。

这是可降级状态，不应阻塞桌宠基础状态 API。

### ESP32 RGB 未连接

检查：

- ESP32 是否已刷入 `firmware/agent_light_esp32_rgb` 固件。
- macOS 是否能看到 `/dev/cu.usbmodem*` 或 `/dev/cu.usbserial*`。
- 串口是否被 Arduino Serial Monitor、Python、screen 或其他程序占用：

```bash
lsof /dev/cu.usbmodemXXXX
```

- 如果占用进程是旧的 `~/.codex/traffic_light/codex_status_light_daemon.py`，先关闭该守护进程或串口监视器，再重新触发一次 Agent Light 状态写入。
- 如果 shell 可以 `stty` 或写入串口，但 Agent Light 仍返回 `Operation not permitted`，通常是开发进程从受限 shell 启动；停止当前 `npm run tauri dev` 后从非受限终端重新启动。
- `AGENT_LIGHT_SERIAL_PORT` 是否指向正确端口。
- RGB LED 是否按 GPIO `1/2/3/G` 接线。
- 如果是共阳 RGB LED，固件中 `RGB_COMMON_ANODE` 是否设为 `true`。
- 如果四个状态肉眼一直是绿色，说明绿通道在工作但红/蓝通道没有按预期工作；优先检查 R/B 两根线、GPIO 1/3 是否与 USB 串口冲突，以及 LED 共阴/共阳类型。

硬件错误不应阻塞 `GET /api/state`、`POST /api/state`、CLI 或桌宠 UI。

## 停止开发态

在运行 `npm run tauri dev` 的终端按 `Ctrl+C`。
