import { describe, expect, it } from "vitest";
import {
  agentStates,
  createStatusEvent,
  defaultPalette,
  hexToRgb,
  isAgentState,
  normalizeLightSettings,
  normalizeAgentState,
  sanitizeMessage,
  statusDefinitions,
} from "./status";

describe("status domain", () => {
  it("recognizes only supported agent states", () => {
    expect(isAgentState("completed")).toBe(true);
    expect(isAgentState("attention")).toBe(true);
    expect(isAgentState("success")).toBe(false);
    expect(isAgentState("warning")).toBe(false);
  });

  it("normalizes legacy state aliases", () => {
    expect(normalizeAgentState("idle")).toBe("standby");
    expect(normalizeAgentState("running")).toBe("working");
    expect(normalizeAgentState("success")).toBe("completed");
    expect(normalizeAgentState("needs_action")).toBe("attention");
    expect(normalizeAgentState("warning")).toBeNull();
  });

  it("keeps a default color for every state", () => {
    for (const state of agentStates) {
      expect(defaultPalette[state]).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("keeps hardware light modes aligned with the product semantics", () => {
    expect(statusDefinitions.standby.mode).toBe("breathe");
    expect(statusDefinitions.working.mode).toBe("steady");
    expect(statusDefinitions.completed.mode).toBe("repeat_pulse");
    expect(statusDefinitions.attention.mode).toBe("pulse");
  });

  it("normalizes persisted hardware light settings", () => {
    const settings = normalizeLightSettings({
      standby: { color: "#123ABC", brightness: 57.4 },
      working: { color: "blue", brightness: 180 },
    });

    expect(settings.standby).toEqual({ color: "#123abc", brightness: 57 });
    expect(settings.working).toEqual({ color: "#ffbf00", brightness: 100 });
    expect(settings.completed).toEqual({ color: "#00ff00", brightness: 100 });
  });

  it("converts hardware light colors to rgb channels", () => {
    expect(hexToRgb("#ffbf00")).toEqual({ red: 255, green: 191, blue: 0 });
  });

  it("sanitizes noisy messages", () => {
    expect(sanitizeMessage("  approve\nthis\tcommand  ")).toBe("approve this command");
  });

  it("creates fallback events with safe messages", () => {
    const event = createStatusEvent("attention", "failed", "fallback");
    expect(event.state).toBe("attention");
    expect(event.message).toBe("failed");
    expect(event.source).toBe("fallback");
  });
});
