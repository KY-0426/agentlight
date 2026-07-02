import { agentProviderValues, type AgentProvider } from "@agent-light/shared";

export const DEFAULT_LOCAL_SERVER_URL = "http://127.0.0.1:8787";
export const DEFAULT_CLOUD_SERVER_URL =
  (import.meta.env.VITE_CLOUD_SERVER_URL as string | undefined)?.trim() ||
  "https://agentlight-276211-9-1310055760.sh.run.tcloudbase.com";

export const DEFAULT_LEADERBOARD_SERVER_URL = DEFAULT_CLOUD_SERVER_URL;

export function resolveDefaultCloudServerUrl(): string {
  return DEFAULT_CLOUD_SERVER_URL;
}
export const DEFAULT_LEADERBOARD_LIMIT = 20;
export const DEFAULT_AGENT_PROVIDER: AgentProvider = "codex";

export type { AgentProvider };

export const agentProviderOrder: AgentProvider[] = [...agentProviderValues];

export const agentProviderLabels: Record<AgentProvider, string> = {
  codex: "Codex",
  cursor: "Cursor",
  claude_code: "Claude Code",
  github_copilot: "GitHub Copilot",
  trae: "Trae",
  trae_cn: "Trae CN",
  qoder: "Qoder",
  qoder_cn: "Qoder CN",
  codebuddy: "CodeBuddy",
  antigravity: "Antigravity",
  kiro: "Kiro",
  devin: "Devin",
};

export type LeaderboardTimePeriod = "day" | "week" | "month" | "total";

export const leaderboardTimePeriodOrder: LeaderboardTimePeriod[] = ["day", "week", "month", "total"];

export const leaderboardTimePeriodLabels: Record<LeaderboardTimePeriod, string> = {
  day: "今日",
  week: "本周",
  month: "本月",
  total: "总计",
};

export interface LeaderboardDateRange {
  from?: string;
  to?: string;
}

export interface TokenLeaderboardEntry {
  user_id: string;
  display_name: string;
  tokens_used: number;
  rank: number;
}

export interface TokenLeaderboardResponse {
  scope: "global" | "workspace";
  workspace_id: string | null;
  agent_provider: AgentProvider;
  total_tokens: number;
  current_user_rank: number | null;
  entries: TokenLeaderboardEntry[];
}

export interface TokenLeaderboardRequest {
  serverUrl: string;
  accessToken?: string | null;
  agentProvider?: AgentProvider;
  workspaceId?: string;
  limit?: number;
  timePeriod?: LeaderboardTimePeriod;
  from?: string;
  to?: string;
}

export interface ApiErrorPayload {
  ok: false;
  error: {
    code: string;
    message: string;
    request_id?: string;
  };
}

export function resolveLeaderboardDateRange(
  period: LeaderboardTimePeriod,
  now: Date = new Date(),
): LeaderboardDateRange {
  if (period === "total") {
    return {};
  }

  const end = startOfLocalDay(now);
  if (period === "day") {
    return { from: formatLocalDate(end), to: formatLocalDate(end) };
  }

  if (period === "week") {
    const start = new Date(end);
    const weekday = start.getDay();
    const diffToMonday = weekday === 0 ? -6 : 1 - weekday;
    start.setDate(start.getDate() + diffToMonday);
    return { from: formatLocalDate(start), to: formatLocalDate(end) };
  }

  const start = new Date(end.getFullYear(), end.getMonth(), 1);
  return { from: formatLocalDate(start), to: formatLocalDate(end) };
}

export function normalizeLeaderboardServerUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("请填写服务端地址");
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("服务端地址格式不正确");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("服务端地址只支持 http 或 https");
  }

  return parsed.origin;
}

export function normalizeLeaderboardLimit(value: number | null | undefined): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_LEADERBOARD_LIMIT;
  }

  return Math.min(100, Math.max(1, Math.trunc(value as number)));
}

export function buildTokenLeaderboardUrl(request: Omit<TokenLeaderboardRequest, "accessToken">): string {
  const url = new URL("/api/leaderboards/tokens", normalizeLeaderboardServerUrl(request.serverUrl));
  const workspaceId = request.workspaceId?.trim();
  if (workspaceId) {
    url.searchParams.set("workspace_id", workspaceId);
  }
  url.searchParams.set("agent_provider", request.agentProvider ?? DEFAULT_AGENT_PROVIDER);
  url.searchParams.set("limit", String(normalizeLeaderboardLimit(request.limit)));

  const dateRange =
    request.from || request.to
      ? { from: request.from, to: request.to }
      : resolveLeaderboardDateRange(request.timePeriod ?? "total");
  if (dateRange.from) {
    url.searchParams.set("from", toIsoDateStart(dateRange.from));
  }
  if (dateRange.to) {
    url.searchParams.set("to", toIsoDateEnd(dateRange.to));
  }

  return url.toString();
}

export function parseTokenLeaderboardResponse(value: unknown): TokenLeaderboardResponse {
  if (!isRecord(value) || value.ok !== true || !isRecord(value.data)) {
    throw new Error("排行榜响应格式不正确");
  }

  const { data } = value;
  if (
    (data.scope !== "global" && data.scope !== "workspace") ||
    (data.workspace_id !== null && typeof data.workspace_id !== "string") ||
    !isAgentProvider(data.agent_provider) ||
    typeof data.total_tokens !== "number" ||
    (data.current_user_rank !== null && typeof data.current_user_rank !== "number") ||
    !Array.isArray(data.entries)
  ) {
    throw new Error("排行榜响应缺少 scope、workspace、agent 或 entries");
  }

  const entries = data.entries.map((entry) => {
    if (!isRecord(entry)) {
      throw new Error("排行榜条目格式不正确");
    }
    if (
      typeof entry.user_id !== "string" ||
      typeof entry.display_name !== "string" ||
      typeof entry.tokens_used !== "number" ||
      typeof entry.rank !== "number"
    ) {
      throw new Error("排行榜条目字段格式不正确");
    }

    return {
      user_id: entry.user_id,
      display_name: entry.display_name,
      tokens_used: entry.tokens_used,
      rank: entry.rank,
    };
  });

  return {
    scope: data.scope,
    workspace_id: data.workspace_id,
    agent_provider: data.agent_provider,
    total_tokens: data.total_tokens,
    current_user_rank: data.current_user_rank,
    entries,
  };
}

export function getApiErrorMessage(value: unknown): string | null {
  if (!isRecord(value) || value.ok !== false || !isRecord(value.error)) {
    return null;
  }

  return typeof value.error.message === "string" ? value.error.message : null;
}

export function resolveLeaderboardSelfRankHint(
  hasCloudSession: boolean,
  currentUserRank: number | null | undefined,
): string {
  if (!hasCloudSession) {
    return "登录并开启云端同步后可显示个人排名";
  }

  if (currentUserRank != null) {
    return `已排名第 ${currentUserRank}，当前页仅展示前若干名`;
  }

  return "同步已开启，产生用量后将显示个人排名";
}

export function resolveLeaderboardEmptyHint(hasCloudSession: boolean): string {
  if (!hasCloudSession) {
    return "开启云端同步并上报用量后，这里会显示排名。";
  }

  return "同步已开启，使用 AI 工具产生用量并上报后，这里会显示排名。";
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function toIsoDateStart(date: string): string {
  return new Date(`${date}T00:00:00.000`).toISOString();
}

function toIsoDateEnd(date: string): string {
  return new Date(`${date}T23:59:59.999`).toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isAgentProvider(value: unknown): value is AgentProvider {
  return typeof value === "string" && agentProviderOrder.includes(value as AgentProvider);
}
