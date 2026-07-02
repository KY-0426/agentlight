export const agentStates = ["standby", "working", "completed", "attention"] as const;

export type AgentState = (typeof agentStates)[number];

export interface AgentStatusEvent {
  state: AgentState;
  message?: string | null;
  source: "boot" | "ui" | "local_api" | "fallback" | string;
  sequence: number;
  timestamp_ms: number;
}

export const lightModes = ["steady", "breathe", "pulse", "repeat_pulse"] as const;

export type LightMode = (typeof lightModes)[number];

export interface StatusDefinition {
  label: string;
  description: string;
  defaultColor: string;
  glowColor: string;
  mode: LightMode;
}

export type StatusPalette = Record<AgentState, string>;
export interface LightStateSettings {
  color: string;
  brightness: number;
  mode: LightMode;
}

export const lightModeLabels: Record<LightMode, string> = {
  steady: "常亮",
  breathe: "呼吸",
  pulse: "闪烁",
  repeat_pulse: "连闪",
};

export const lightModeHints: Record<LightMode, string> = {
  steady: "保持固定亮度",
  breathe: "缓慢明暗起伏",
  pulse: "单次明暗脉冲",
  repeat_pulse: "连续闪烁提醒",
};

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

const defaultLightSettingsColors: Record<AgentState, string> = {
  standby: "#0000ff",
  working: "#ffbf00",
  completed: "#00ff00",
  attention: "#ff0000",
};

export const defaultLightSettings: LightSettings = agentStates.reduce(
  (settings, state) => ({
    ...settings,
    [state]: {
      color: defaultLightSettingsColors[state],
      brightness: 100,
      mode: statusDefinitions[state].mode,
    },
  }),
  {} as LightSettings,
);

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
      mode: normalizeLightMode(stateInput.mode, fallback.mode),
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

export function scaleHexColorByBrightness(color: string, brightness: number): string {
  const { red, green, blue } = hexToRgb(color);
  const factor = Math.min(100, Math.max(0, brightness)) / 100;
  const channel = (value: number) =>
    Math.min(255, Math.max(0, Math.round(value * factor)))
      .toString(16)
      .padStart(2, "0");
  return `#${channel(red)}${channel(green)}${channel(blue)}`;
}

export function lightGlowColor(color: string, brightness: number, alpha = 0.48): string {
  const { red, green, blue } = hexToRgb(color);
  const factor = Math.min(100, Math.max(0, brightness)) / 100;
  const glowAlpha = alpha * (0.35 + factor * 0.65);
  return `rgba(${Math.round(red * factor)}, ${Math.round(green * factor)}, ${Math.round(blue * factor)}, ${glowAlpha.toFixed(2)})`;
}

export function lightStateCssVars(
  state: AgentState,
  settings: LightSettings,
): Record<"--state-color" | "--state-glow", string> {
  const { color, brightness } = settings[state];
  return {
    "--state-color": scaleHexColorByBrightness(color, brightness),
    "--state-glow": lightGlowColor(color, brightness),
  };
}

export function lightStateDisplayColor(state: AgentState, settings: LightSettings): string {
  const { color, brightness } = settings[state];
  return scaleHexColorByBrightness(color, brightness);
}

export function rgbToHex(red: number, green: number, blue: number): string {
  const channel = (value: number) =>
    Math.min(255, Math.max(0, Math.round(value)))
      .toString(16)
      .padStart(2, "0");
  return `#${channel(red)}${channel(green)}${channel(blue)}`;
}

export function hardwareLightSettingsToLightSettings(
  remote: Record<
    AgentState,
    { red: number; green: number; blue: number; brightness: number; mode?: string | null }
  >,
): LightSettings {
  return agentStates.reduce((settings, state) => {
    const entry = remote[state];
    const fallback = defaultLightSettings[state];
    settings[state] = {
      color: rgbToHex(entry.red, entry.green, entry.blue),
      brightness: entry.brightness,
      mode: normalizeLightMode(entry.mode, fallback.mode),
    };
    return settings;
  }, {} as LightSettings);
}

export function lightSettingsEqual(left: LightSettings, right: LightSettings): boolean {
  return agentStates.every(
    (state) =>
      left[state].color === right[state].color &&
      left[state].brightness === right[state].brightness &&
      left[state].mode === right[state].mode,
  );
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

function normalizeLightMode(value: unknown, fallback: LightMode): LightMode {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  return lightModes.includes(trimmed as LightMode) ? (trimmed as LightMode) : fallback;
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
