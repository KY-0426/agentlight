# 本地 API 文档

Agent Light 的本地 API 只面向本机开发和本地工具集成。默认监听：

```text
http://127.0.0.1:18765
```

## 状态对象

```json
{
  "state": "working",
  "message": "Codex 正在工作",
  "source": "codex_monitor",
  "sequence": 14,
  "timestamp_ms": 1782106529868
}
```

字段说明：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `state` | string | 标准状态：`standby`、`working`、`completed`、`attention` |
| `message` | string/null | 可选展示消息，服务端会清洗并限制长度 |
| `source` | string | 来源：`boot`、`ui`、`local_api`、`codex_monitor` 等 |
| `sequence` | number | 运行期递增序号 |
| `timestamp_ms` | number | 生成时间戳 |

## `GET /api/state`

读取当前状态。

示例：

```bash
curl -fsS http://127.0.0.1:18765/api/state
```

成功响应：

```json
{
  "state": "standby",
  "message": "待命中",
  "source": "boot",
  "sequence": 0,
  "timestamp_ms": 1782100000000
}
```

## `POST /api/state`

写入当前状态。

请求：

```json
{
  "state": "completed",
  "message": "Task finished"
}
```

示例：

```bash
curl -fsS -X POST http://127.0.0.1:18765/api/state \
  -H 'Content-Type: application/json' \
  -d '{"state":"completed","message":"Task finished"}'
```

支持 alias：

| alias | 标准状态 |
| --- | --- |
| `idle` | `standby` |
| `running` | `working` |
| `success` | `completed` |
| `error` | `attention` |
| `needs_action` | `attention` |

约束：

- body 最大 4096 bytes。
- message 会 trim，并替换换行、回车、tab。
- message 最多保留 180 个字符。

## `OPTIONS /api/state`

用于本地调试 CORS 预检，成功返回 204。

## `GET /api/codex`

读取本地 Codex 状态快照。

字段：

| 字段 | 说明 |
| --- | --- |
| `available` | 是否检测到可用线索 |
| `logged_in` | 是否推断已登录 |
| `login_label` | 登录状态展示文本 |
| `quota_label` | 额度摘要，当前本地 schema 未提供剩余额度 |
| `quota_detail` | 额度说明 |
| `state` | 映射后的 Agent Light 状态 |
| `is_working` | 最近线程是否处于活跃窗口 |
| `latest_thread_id` | 最近线程 ID |
| `latest_model` | 最近模型 |
| `latest_source` | 最近线程来源 |
| `latest_cwd` | 最近工作目录 |
| `tokens_used` | 已用 token |
| `thread_updated_at_ms` | 最近更新时间 |
| `active_age_seconds` | 距离最近活动秒数 |
| `sampled_at_ms` | 采样时间 |

## `GET /api/hardware`

读取 ESP32 RGB 硬件连接快照。

示例：

```bash
curl -fsS http://127.0.0.1:18765/api/hardware
```

成功响应：

```json
{
  "enabled": true,
  "connected": true,
  "protocol": "agent-light-rgb-v1",
  "firmware_version": "0.2.0",
  "protocol_version": "agent-light-rgb-v1",
  "hardware_revision": "esp32-mini-rgb-dev",
  "port": "/dev/cu.usbmodemXXXX",
  "baud": 115200,
  "last_state": "working",
  "last_error": null,
  "updated_at_ms": 1782100000000
}
```

字段：

| 字段 | 说明 |
| --- | --- |
| `enabled` | 是否启用硬件写入，可用 `AGENT_LIGHT_HARDWARE=0` 关闭 |
| `connected` | 当前是否已打开 ESP32 串口且最近一次写入无错误 |
| `protocol` | 当前串口协议版本 |
| `firmware_version` | ESP32 固件回报的固件版本；未回报时为 `null` |
| `protocol_version` | ESP32 固件回报的协议版本；未回报时为 `null` |
| `hardware_revision` | ESP32 固件回报的硬件版本；未回报时为 `null` |
| `port` | 当前串口路径；未发现时可能为 `null` |
| `baud` | 串口 baud，默认 `115200` |
| `last_state` | 最近一次成功写入硬件的 Agent Light 状态 |
| `last_error` | 最近一次硬件错误；成功后为 `null` |
| `updated_at_ms` | 硬件状态更新时间 |

## 错误响应

```json
{
  "code": "invalid_json",
  "message": "Invalid JSON body: ..."
}
```

常见错误：

| code | 说明 |
| --- | --- |
| `invalid_request_line` | 请求行缺 method 或 path |
| `invalid_content_length` | Content-Length 非数字 |
| `body_too_large` | 请求体超过限制 |
| `invalid_json` | JSON 无效 |
| `not_found` | 路径不支持 |
| `state_lock_failed` | 状态锁读取或写入失败 |
| `hardware_lock_failed` | 硬件状态锁读取失败 |
| `serialize_failed` | 响应序列化失败 |

## 安全边界

- 当前 API 是本机 loopback API，不应暴露到局域网或公网。
- 当前响应允许 `Access-Control-Allow-Origin: *`，便于本地调试；发布前如威胁模型变化，需要重新评估。
- 不要在 message 中传入 token、cookie、私钥或完整用户数据。
