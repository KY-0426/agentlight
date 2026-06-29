import type { AiToolTokenUsage } from "./aiTools";
import type { AgentState } from "./status";

export interface AgentMonitorSnapshot {
  available: boolean;
  state: AgentState;
}

export interface AgentMonitorTarget<T extends AgentMonitorSnapshot> {
  snapshot: T;
  label: string;
  source: "cursor_monitor" | "codex_monitor";
}

const STATE_PRIORITY: Record<AgentState, number> = {
  attention: 5,
  working: 4,
  completed: 2,
  standby: 1,
};

export function pickPrimaryAgentMonitor<T extends AgentMonitorSnapshot>(
  cursorSnapshot: T | null,
  codexSnapshot: T | null,
): AgentMonitorTarget<T> | null {
  const candidates: Array<AgentMonitorTarget<T> & { priority: number }> = [];

  if (cursorSnapshot?.available) {
    candidates.push({
      snapshot: cursorSnapshot,
      label: "Cursor",
      source: "cursor_monitor",
      priority: STATE_PRIORITY[cursorSnapshot.state],
    });
  }
  if (codexSnapshot?.available) {
    candidates.push({
      snapshot: codexSnapshot,
      label: "Codex",
      source: "codex_monitor",
      priority: STATE_PRIORITY[codexSnapshot.state],
    });
  }

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((left, right) => {
    if (right.priority !== left.priority) {
      return right.priority - left.priority;
    }
    if (left.source === "cursor_monitor" && right.source !== "cursor_monitor") {
      return -1;
    }
    if (right.source === "cursor_monitor" && left.source !== "cursor_monitor") {
      return 1;
    }
    return 0;
  });

  const best = candidates[0];
  return {
    snapshot: best.snapshot,
    label: best.label,
    source: best.source,
  };
}

function pickActiveAiTool(tools: AiToolTokenUsage[]): AiToolTokenUsage | null {
  const priority = ["working", "attention", "completed"] as const;
  for (const state of priority) {
    const tool = tools.find((item) => item.available && item.state === state);
    if (tool) {
      return tool;
    }
  }

  return tools.find((item) => item.available) ?? null;
}

export function pickActiveAiToolName(tools: AiToolTokenUsage[]): string {
  return pickActiveAiTool(tools)?.name ?? "未连接";
}

export function pickActiveAiToolLabel(tools: AiToolTokenUsage[]): string {
  const tool = pickActiveAiTool(tools);
  if (!tool) {
    return "暂无可用工具";
  }

  return `${tool.name} · ${tool.state_label}`;
}
