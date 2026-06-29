export type AiToolId =
  | "claude_code"
  | "codex"
  | "cursor"
  | "github_copilot"
  | "trae"
  | "trae_cn"
  | "qoder"
  | "qoder_cn"
  | "codebuddy"
  | "antigravity"
  | "kiro"
  | "devin";

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
  "trae",
  "trae_cn",
  "qoder",
  "qoder_cn",
  "codebuddy",
  "antigravity",
  "kiro",
  "devin",
];

export const aiToolAccent: Record<AiToolId, string> = {
  claude_code: "#d97757",
  codex: "#10a37f",
  cursor: "#7c3aed",
  github_copilot: "#24292f",
  trae: "#3370ff",
  trae_cn: "#245bdb",
  qoder: "#2563eb",
  qoder_cn: "#1d4ed8",
  codebuddy: "#0ea5e9",
  antigravity: "#6366f1",
  kiro: "#ff9900",
  devin: "#0d9488",
};

export const aiToolInitials: Record<AiToolId, string> = {
  claude_code: "CC",
  codex: "CX",
  cursor: "CU",
  github_copilot: "GH",
  trae: "TR",
  trae_cn: "TC",
  qoder: "QD",
  qoder_cn: "QC",
  codebuddy: "CB",
  antigravity: "AG",
  kiro: "KI",
  devin: "DV",
};

export function isAiToolId(value: string): value is AiToolId {
  return value in aiToolAccent;
}
