export const DEFAULT_LEADERBOARD_SERVER_URL = "http://127.0.0.1:8787";
export const DEFAULT_LEADERBOARD_LIMIT = 20;
export const DEFAULT_AGENT_PROVIDER: AgentProvider = "codex";

export type AgentProvider = "codex" | "claude_code" | "cursor";

export const agentProviderLabels: Record<AgentProvider, string> = {
  codex: "Codex",
  claude_code: "Claude Code",
  cursor: "Cursor",
};

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
}

export interface ApiErrorPayload {
  ok: false;
  error: {
    code: string;
    message: string;
    request_id?: string;
  };
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isAgentProvider(value: unknown): value is AgentProvider {
  return value === "codex" || value === "claude_code" || value === "cursor";
}
