import type { AiToolTokenUsage } from "../domain/aiTools";
import { aiToolAccent, aiToolInitials } from "../domain/aiTools";

interface AiToolTokenOverviewProps {
  tools: AiToolTokenUsage[];
  loading?: boolean;
  refreshIntervalSec?: number;
  onManageTools?: () => void;
  manageToolsBusy?: boolean;
}

export function AiToolTokenOverview({
  tools,
  loading,
  refreshIntervalSec = 5,
  onManageTools,
  manageToolsBusy = false,
}: AiToolTokenOverviewProps) {
  const trackedTotal = tools.reduce((sum, tool) => sum + (tool.tokens_used ?? 0), 0);
  const trackedCount = tools.filter((tool) => typeof tool.tokens_used === "number").length;

  return (
    <section className="settings-section ai-tool-token-panel" aria-labelledby="ai-tool-token-heading">
      <div className="settings-section__title">
        <div>
          <h2 id="ai-tool-token-heading">AI 助手</h2>
          <p className="settings-section__hint">
            {tools.length > 0
              ? `已连接 ${trackedCount} 个 · 本机累计 ${formatTokens(trackedTotal)}`
              : "连接 AI 编程助手后，桌宠会跟随工作状态变化"}
          </p>
        </div>
        <div className="settings-section__actions">
          {onManageTools ? (
            <button
              className="settings-inline-button"
              type="button"
              disabled={manageToolsBusy}
              onClick={onManageTools}
            >
              接入 AI 工具
            </button>
          ) : null}
          <span className="settings-badge">{refreshIntervalSec} 秒刷新</span>
        </div>
      </div>

      <div className={`ai-tool-token-table ${loading ? "ai-tool-token-table--loading" : ""}`} role="table">
        <div className="ai-tool-token-table__head" role="row">
          <span role="columnheader">工具</span>
          <span role="columnheader">状态</span>
          <span role="columnheader">用量</span>
          <span role="columnheader">说明</span>
        </div>
        {tools.map((tool) => (
          <div
            className={`ai-tool-token-row ai-tool-token-row--${tool.state} ${tool.configured ? "ai-tool-token-row--configured" : ""}`}
            role="row"
            key={tool.id}
          >
            <div className="ai-tool-token-row__tool" role="cell">
              <span
                className="ai-tool-token-row__icon"
                style={{ backgroundColor: aiToolAccent[tool.id] }}
                aria-hidden="true"
              >
                {aiToolInitials[tool.id]}
              </span>
              <span className="ai-tool-token-row__meta">
                <strong>{tool.name}</strong>
                <small>{formatInstallState(tool)}</small>
              </span>
            </div>
            <span className="ai-tool-token-row__state" role="cell">
              {tool.state_label}
            </span>
            <span className="ai-tool-token-row__tokens" role="cell">
              <strong>{formatTokens(tool.tokens_used)}</strong>
              <small>{formatTokenKind(tool.token_kind)}</small>
            </span>
            <span className="ai-tool-token-row__detail" role="cell">
              {tool.activity_detail}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function formatInstallState(tool: AiToolTokenUsage): string {
  if (tool.configured) {
    return "已接入";
  }
  if (tool.installed) {
    return "已安装";
  }
  return tool.installable ? "可安装" : "未安装";
}

function formatTokenKind(kind: AiToolTokenUsage["token_kind"]): string {
  if (kind === "official") {
    return "官方统计";
  }
  if (kind === "estimated") {
    return "估算值";
  }
  if (kind === "pending") {
    return "即将支持";
  }
  return "暂无数据";
}

function formatTokens(value: number | null | undefined): string {
  if (typeof value !== "number") {
    return "—";
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${Math.round(value / 1_000)}K`;
  }
  return `${value}`;
}
