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
  working: 4,
  attention: 3,
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

export function pickActiveAiToolLabel(tools: AiToolTokenUsage[]): string {
  const working = tools.find((tool) => tool.available && tool.state === "working");
  if (working) {
    return `${working.name} · ${working.state_label}`;
  }

  const attention = tools.find((tool) => tool.available && tool.state === "attention");
  if (attention) {
    return `${attention.name} · ${attention.state_label}`;
  }

  const completed = tools.find((tool) => tool.available && tool.state === "completed");
  if (completed) {
    return `${completed.name} · ${completed.state_label}`;
  }

  const available = tools.find((tool) => tool.available);
  if (available) {
    return `${available.name} · ${available.state_label}`;
  }

  return "暂无可用工具";
}
