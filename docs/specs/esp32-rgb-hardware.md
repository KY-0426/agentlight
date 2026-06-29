# ESP32 RGB 硬件规格

最后更新：2026-06-24

## 1. 背景

用户已连接 ESP32 Mini 板，并将 RGB 灯接到 `1 / 2 / 3 / G` 口。Agent Light 从本阶段开始进入真实硬件开发：桌面应用仍负责状态源，ESP32 固件负责把状态显示为实体 RGB 灯效。

## 2. 目标

- 状态变化时，桌面应用通过 USB 串口把颜色和动画模式推送给 ESP32。
- ESP32 固件按 `standby`、`working`、`completed`、`attention` 四种状态驱动 RGB LED。
- 移除原先 TS 层虚拟硬件/Deferred adapter，占位逻辑不再作为硬件源码。
- 硬件链路失败时不影响桌宠 UI、本地 API、CLI 和 Codex 同步。

## 3. 非目标

- 不做 BLE、Wi-Fi、本地网络设备发现。
- 不做 OTA、量产烧录、安全启动或固件签名。
- 不做多灯、多设备同步。
- 不声明已上板验证，除非记录实际刷写、串口和灯效结果。

## 4. 硬件假设

| 项 | 当前规格 |
| --- | --- |
| 板卡 | ESP32 Mini，具体芯片/board revision 待确认 |
| LED | 4-pin RGB LED |
| 接线 | R -> GPIO 1，G -> GPIO 2，B -> GPIO 3，GND -> G |
| 电气假设 | 默认共阴 RGB LED；共阳需在固件设置 `RGB_COMMON_ANODE = true` |
| 传输 | USB Serial，默认 `115200` baud |
| 桌面端 | macOS Tauri Rust 后端写 `/dev/cu.usbmodem*` 或 `/dev/cu.usbserial*` |

注意：部分 classic ESP32 板会把 GPIO 1/3 用作 UART0 TX/RX。如果该板 USB 串口依赖这些脚，需改接到其他 PWM-capable GPIO，并同步修改固件常量。

## 5. 状态与灯效映射

| Agent Light 状态 | RGB | 模式 |
| --- | --- | --- |
| `standby` | `0,0,255` | `breathe` |
| `working` | `255,191,0` | `steady` |
| `completed` | `0,255,0` | `repeat_pulse`，一亮一灭闪烁 |
| `attention` | `255,0,0` | `pulse`，一亮一灭闪烁 |

这组颜色优先服务板级 bring-up：`standby` 只测蓝通道，`completed` 只测绿通道，`attention` 只测红通道。如果四种状态肉眼都偏绿，优先检查红/蓝接线、GPIO 1/3 是否被 USB 串口占用，以及 LED 是否为共阳。

## 6. 串口协议

桌面端每次状态变化发送一行：

```text
AGENT_LIGHT protocol=agent-light-rgb-v1 state=working r=255 g=191 b=0 mode=steady seq=12
```

字段：

| 字段 | 说明 |
| --- | --- |
| `protocol` | 协议版本，当前为 `agent-light-rgb-v1` |
| `state` | 标准状态值 |
| `r/g/b` | 0-255 PWM 颜色值 |
| `mode` | `steady`、`breathe`、`pulse`、`repeat_pulse`；`pulse`/`repeat_pulse` 在当前固件中是全亮/全灭闪烁 |
| `seq` | Agent Light 运行期状态序号 |

固件支持 `PING`，返回 `PONG protocol=agent-light-rgb-v1`。

## 7. 桌面端行为

- 默认启用硬件写入。
- 自动发现串口顺序：`/dev/cu.usbmodem*`、`/dev/cu.usbserial*`、`/dev/tty.usbmodem*`、`/dev/tty.usbserial*`。
- `AGENT_LIGHT_SERIAL_PORT` 可指定端口。
- `AGENT_LIGHT_SERIAL_BAUD` 可指定 baud。
- `AGENT_LIGHT_HARDWARE=0` 可关闭硬件写入。
- `GET /api/hardware` 返回当前硬件连接快照。

## 8. 验收标准

| ID | 验收项 | 判定 |
| --- | --- | --- |
| H1 | 固件可编译并上传到 ESP32 | 需 `arduino-cli` 或 Arduino IDE 记录 |
| H2 | ESP32 串口收到 `PING` 后返回 `PONG` | 需串口日志 |
| H3 | `POST /api/state` 写 `working` 后 RGB 灯黄色常亮 | 需板级观察 |
| H4 | 四个状态颜色和模式符合映射表 | 需手工或 HIL 记录 |
| H5 | 断开 ESP32 后桌面 UI/API 不崩溃，设置页展示错误 | 需手工验证 |
| H6 | 设置 `AGENT_LIGHT_SERIAL_PORT` 后桌面端使用指定串口 | 需日志/API 快照 |

当前桌面端串口写入已在 `/dev/cu.usbmodem101` 上验证到 `connected:true` 和四状态 `last_state` 更新；固件刷写日志、`PING/PONG` 串口回读和肉眼灯效仍需补记录。

## 9. 风险

- 未确认具体 ESP32 Mini 芯片和 board revision，GPIO 1/3 可能与 USB 串口冲突。
- 未读目标板原理图、datasheet、errata；硬件结论只能标为部分验证或未验证。
- macOS 串口配置依赖 `/bin/stty`，跨平台未支持。
- 当前串口协议无认证，边界是本机 USB 设备和本机桌面应用。
