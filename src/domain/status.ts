export const agentStates = ["standby", "working", "completed", "attention"] as const;

export type AgentState = (typeof agentStates)[number];

export interface AgentStatusEvent {
  state: AgentState;
  message?: string | null;
  source: "boot" | "ui" | "local_api" | "fallback" | string;
  sequence: number;
  timestamp_ms: number;
}

export interface StatusDefinition {
  label: string;
  description: string;
  defaultColor: string;
  glowColor: string;
  mode: "steady" | "breathe" | "pulse" | "repeat_pulse";
}

export type StatusPalette = Record<AgentState, string>;
export interface LightStateSettings {
  color: string;
  brightness: number;
}

export type LightSettings = Record<AgentState, LightStateSettings>;

export const statusDefinitions: Record<AgentState, StatusDefinition> = {
  standby: {
    label: "待命中",
    description: "等待新的 AI agent 任务",
    defaultColor: "#2f7fff",
    glowColor: "rgba(47, 127, 255, 0.48)",
    mode: "breathe",
  },
  working: {
    label: "工作中",
    description: "agent 正在工作",
    defaultColor: "#ffbf32",
    glowColor: "rgba(255, 191, 50, 0.52)",
    mode: "steady",
  },
  completed: {
    label: "已完成",
    description: "任务完成，绿色灯会闪烁提醒",
    defaultColor: "#38d66b",
    glowColor: "rgba(56, 214, 107, 0.58)",
    mode: "repeat_pulse",
  },
  attention: {
    label: "需处理",
    description: "需要用户确认、授权或故障处理",
    defaultColor: "#ff4b55",
    glowColor: "rgba(255, 75, 85, 0.58)",
    mode: "pulse",
  },
};

export const stateAliases: Record<string, AgentState> = {
  idle: "standby",
  running: "working",
  success: "completed",
  error: "attention",
  needs_action: "attention",
};

export const defaultPalette: StatusPalette = agentStates.reduce(
  (palette, state) => ({
    ...palette,
    [state]: statusDefinitions[state].defaultColor,
  }),
  {} as StatusPalette,
);

export const defaultLightSettings: LightSettings = {
  standby: {
    color: "#0000ff",
    brightness: 100,
  },
  working: {
    color: "#ffbf00",
    brightness: 100,
  },
  completed: {
    color: "#00ff00",
    brightness: 100,
  },
  attention: {
    color: "#ff0000",
    brightness: 100,
  },
};

export function isAgentState(value: unknown): value is AgentState {
  return typeof value === "string" && agentStates.includes(value as AgentState);
}

export function normalizeAgentState(value: unknown): AgentState | null {
  if (isAgentState(value)) {
    return value;
  }
  if (typeof value !== "string") {
    return null;
  }
  return stateAliases[value] ?? null;
}

export function sanitizeMessage(message: string | null | undefined): string | null {
  if (!message) {
    return null;
  }
  const compact = message.replace(/\s+/g, " ").trim();
  return compact.length > 180 ? `${compact.slice(0, 180)}...` : compact;
}

export function normalizeLightSettings(value: unknown): LightSettings {
  const input = isRecord(value) ? value : {};
  return agentStates.reduce((settings, state) => {
    const stateInput = isRecord(input[state]) ? input[state] : {};
    const fallback = defaultLightSettings[state];
    settings[state] = {
      color: normalizeHexColor(stateInput.color, fallback.color),
      brightness: normalizeBrightness(stateInput.brightness, fallback.brightness),
    };
    return settings;
  }, {} as LightSettings);
}

export function hexToRgb(color: string): { red: number; green: number; blue: number } {
  const normalized = normalizeHexColor(color, "#000000").slice(1);
  return {
    red: Number.parseInt(normalized.slice(0, 2), 16),
    green: Number.parseInt(normalized.slice(2, 4), 16),
    blue: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

function normalizeHexColor(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  return /^#[0-9a-f]{6}$/i.test(trimmed) ? trimmed.toLowerCase() : fallback;
}

function normalizeBrightness(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(100, Math.max(0, Math.round(value)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function createStatusEvent(
  state: AgentState,
  message?: string | null,
  source: AgentStatusEvent["source"] = "fallback",
): AgentStatusEvent {
  return {
    state,
    message: sanitizeMessage(message),
    source,
    sequence: Date.now(),
    timestamp_ms: Date.now(),
  };
}
