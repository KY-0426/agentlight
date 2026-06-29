# Agent Light 文档索引

本目录是 Agent Light 的 spec 模式工作区。所有后续开发先落到 spec，再拆任务，实现后用验收矩阵和测试文档收口。

## 必读顺序

1. [MVP 产品规格](./specs/agent-light-mvp.md)
2. [验收矩阵](./product/acceptance-matrix.md)
3. [验收标准](./product/acceptance-standards.md)
4. [技术架构](./engineering/architecture.md)
5. [开发指南](./engineering/development.md)
6. [本地 API 文档](./engineering/api.md)
7. [ESP32 RGB 硬件规格](./specs/esp32-rgb-hardware.md)
8. [测试策略](./engineering/testing.md)
9. [发布说明](./operations/release.md)
10. [运行手册](./operations/runbook.md)

## 决策记录

- [ADR 0001: 采用 spec 模式开发](./decisions/0001-spec-mode.md)

## 当前文档边界

- 文档基于当前仓库代码、README、Tauri 配置和本地运行证据整理。
- 未把未验证事项写成已完成，例如 release build、安装包首启、开机启动和 ESP32 板级灯效验收。
- 后续新增功能必须先更新 spec 与验收矩阵，再进入实现。
