#!/usr/bin/env bash
set -euo pipefail

APP="${1:-/Applications/Agent Light.app}"

if [[ ! -d "$APP" ]]; then
  echo "找不到应用：$APP" >&2
  echo "用法: bash scripts/macos-trust-agent-light.sh \"/Applications/Agent Light.app\"" >&2
  exit 1
fi

xattr -cr "$APP"
echo "已清除隔离标记：$APP"
echo ""
echo "接下来请用「右键 → 打开」启动（首次不要双击）。"
echo "若仍被拦截：系统设置 → 隐私与安全性 → 仍要打开"

open -a "$APP" 2>/dev/null || true
