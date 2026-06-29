import { describe, expect, it } from "vitest";
import type { AiToolTokenUsage } from "./aiTools";
import { pickActiveAiToolLabel, pickPrimaryAgentMonitor } from "./agentMonitor";

function snapshot(state: "standby" | "working" | "completed" | "attention", available = true) {
  return { available, state };
}

describe("pickPrimaryAgentMonitor", () => {
  it("prefers working agent over idle cursor", () => {
    const primary = pickPrimaryAgentMonitor(
      snapshot("standby"),
      snapshot("working"),
    );

    expect(primary?.label).toBe("Codex");
    expect(primary?.source).toBe("codex_monitor");
  });

  it("prefers working cursor over idle codex", () => {
    const primary = pickPrimaryAgentMonitor(
      snapshot("working"),
      snapshot("standby"),
    );

    expect(primary?.label).toBe("Cursor");
    expect(primary?.source).toBe("cursor_monitor");
  });

  it("falls back to cursor when both are standby", () => {
    const primary = pickPrimaryAgentMonitor(
      snapshot("standby"),
      snapshot("standby"),
    );

    expect(primary?.label).toBe("Cursor");
  });

  it("returns null when no agent is available", () => {
    expect(pickPrimaryAgentMonitor(snapshot("standby", false), snapshot("standby", false))).toBeNull();
  });
});

describe("pickActiveAiToolLabel", () => {
  const baseTool: Omit<AiToolTokenUsage, "id" | "name" | "state" | "state_label" | "available"> = {
    installed: true,
    configured: true,
    installable: true,
    tokens_used: null,
    token_kind: "none",
    activity_detail: "",
    detail: "",
  };

  it("shows working tool first", () => {
    const label = pickActiveAiToolLabel([
      {
        ...baseTool,
        id: "cursor",
        name: "Cursor",
        available: true,
        state: "standby",
        state_label: "待命中",
      },
      {
        ...baseTool,
        id: "codex",
        name: "Codex",
        available: true,
        state: "working",
        state_label: "工作中",
      },
    ]);

    expect(label).toBe("Codex · 工作中");
  });

  it("falls back when nothing is available", () => {
    expect(pickActiveAiToolLabel([])).toBe("暂无可用工具");
  });
});
