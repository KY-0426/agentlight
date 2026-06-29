export type AiToolId =
  | "claude_code"
  | "codex"
  | "cursor"
  | "github_copilot"
  | "qoder"
  | "codebuddy"
  | "antigravity";

export interface AiToolStatus {
  id: AiToolId;
  name: string;
  installed: boolean;
  configured: boolean;
  installable: boolean;
  detail: string;
}

export interface AiToolInstallResult {
  id: AiToolId;
  configured: boolean;
  message: string;
}

export type AiToolTokenKind = "official" | "estimated" | "pending" | "none";

export interface AiToolTokenUsage {
  id: AiToolId;
  name: string;
  installed: boolean;
  configured: boolean;
  installable: boolean;
  available: boolean;
  state: "standby" | "working" | "completed" | "attention";
  state_label: string;
  tokens_used: number | null;
  token_kind: AiToolTokenKind;
  activity_detail: string;
  detail: string;
}

export const aiToolOrder: AiToolId[] = [
  "codex",
  "cursor",
  "claude_code",
  "github_copilot",
  "qoder",
  "codebuddy",
  "antigravity",
];

export const aiToolAccent: Record<AiToolId, string> = {
  claude_code: "#d97757",
  codex: "#10a37f",
  cursor: "#7c3aed",
  github_copilot: "#24292f",
  qoder: "#2563eb",
  codebuddy: "#0ea5e9",
  antigravity: "#6366f1",
};

export const aiToolInitials: Record<AiToolId, string> = {
  claude_code: "CC",
  codex: "CX",
  cursor: "CU",
  github_copilot: "GH",
  qoder: "QD",
  codebuddy: "CB",
  antigravity: "AG",
};

export function isAiToolId(value: string): value is AiToolId {
  return value in aiToolAccent;
}
