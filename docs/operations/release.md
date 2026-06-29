# 发布说明

## 当前发布范围

当前 MVP 的发布目标是 macOS `.app` bundle。DMG、签名、公证、自动更新和跨平台安装包均为后续 release 阶段事项。

## 版本信息

| 项 | 当前值 |
| --- | --- |
| package version | `0.1.0` |
| Tauri productName | `Agent Light` |
| Tauri identifier | `tf.anna.agent-light` |
| Tauri bundle target | `app` |
| category | `DeveloperTool` |

## 发布前检查

必须完成：

1. 确认 spec 和验收矩阵已更新。
2. `npm run test` 通过。
3. `npm run build` 通过。
4. `npm run tauri build` 通过。
5. 首次启动 `.app` 成功。
6. 主窗口和设置窗口加载成功。
7. `GET /api/state` 与 `POST /api/state` 成功。
8. `GET /api/hardware` 能返回硬件快照。
9. CLI `status` 与 `state` 成功。
10. Codex 状态不可用时有可理解降级。
11. release note 写明未支持平台和已知限制。

## 手工验收

| 项 | 验收方式 |
| --- | --- |
| 主窗口 | 启动后看到透明置顶桌宠 |
| 设置窗口 | 点击桌宠打开设置 |
| 状态切换 | 设置按钮、curl、CLI 均可更新 |
| 完成确认 | completed 点击回到 standby |
| 顶部吸附 | 拖动靠近顶部后吸附 |
| Codex 概览 | 能读取或显示不可用说明 |
| 系统指标 | CPU、内存、开机时长展示或降级 |
| ESP32 RGB | 连接 ESP32 后四状态灯效可观察；未连接时设置页显示错误 |

## 已知限制

- 未完成签名、公证和 Gatekeeper 分发验证。
- 未完成 DMG 包装。
- 未完成自动更新。
- 开机启动 UI 有配置痕迹，但没有确认系统级实现。
- 小游戏只是占位入口。
- ESP32 RGB 硬件源码已接入，但板级刷写、串口和灯效验收需要单独记录。
- Windows、Linux、iOS、Android 未验证。

## 回滚策略

当前尚未建立正式发布渠道。发布候选出问题时：

1. 停止分发当前 `.app`。
2. 回到上一个 git tag 或上一个可运行 commit。
3. 用 `npm run tauri dev` 复现问题。
4. 更新验收矩阵，把失败项标为阻断。
5. 修复后重新跑发布前检查。

## Release note 模板

```md
# Agent Light vX.Y.Z

## 新增

- ...

## 修复

- ...

## 已验证

- npm run test
- npm run build
- npm run tauri build
- macOS .app 首次启动

## 已知限制

- ...

## 回滚

- 回滚到 tag/commit: ...
```
