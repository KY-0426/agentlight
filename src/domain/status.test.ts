import { describe, expect, it } from "vitest";
import {
  agentStates,
  createStatusEvent,
  defaultLightSettings,
  defaultPalette,
  hexToRgb,
  isAgentState,
  hardwareLightSettingsToLightSettings,
  lightSettingsEqual,
  normalizeLightSettings,
  normalizeAgentState,
  sanitizeMessage,
  statusDefinitions,
  scaleHexColorByBrightness,
  lightGlowColor,
  lightStateCssVars,
  lightStateDisplayColor,
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

    expect(settings.standby).toEqual({ color: "#123abc", brightness: 57, mode: "breathe" });
    expect(settings.working).toEqual({ color: "#ffbf00", brightness: 100, mode: "steady" });
    expect(settings.completed).toEqual({ color: "#00ff00", brightness: 100, mode: "repeat_pulse" });
  });

  it("normalizes custom light modes and falls back for invalid values", () => {
    const settings = normalizeLightSettings({
      attention: { mode: "pulse", color: "#ff0000", brightness: 80 },
      working: { mode: "invalid", color: "#ffbf00", brightness: 100 },
    });

    expect(settings.attention.mode).toBe("pulse");
    expect(settings.working.mode).toBe("steady");
  });

  it("converts hardware light colors to rgb channels", () => {
    expect(hexToRgb("#ffbf00")).toEqual({ red: 255, green: 191, blue: 0 });
  });

  it("derives ui colors from persisted light settings", () => {
    const settings = normalizeLightSettings({
      completed: { color: "#00ff1e", brightness: 100 },
    });

    expect(scaleHexColorByBrightness(settings.completed.color, settings.completed.brightness)).toBe(
      "#00ff1e",
    );
    expect(lightStateDisplayColor("completed", settings)).toBe("#00ff1e");
    expect(lightStateCssVars("completed", settings)).toEqual({
      "--state-color": "#00ff1e",
      "--state-glow": lightGlowColor("#00ff1e", 100),
    });
    expect(lightGlowColor("#00ff1e", 50)).toBe("rgba(0, 128, 15, 0.32)");
  });

  it("converts persisted hardware rgb settings back to ui light settings", () => {
    const settings = hardwareLightSettingsToLightSettings({
      standby: { red: 0, green: 0, blue: 255, brightness: 100 },
      working: { red: 255, green: 191, blue: 0, brightness: 100 },
      completed: { red: 0, green: 255, blue: 30, brightness: 100 },
      attention: { red: 255, green: 0, blue: 0, brightness: 100 },
    });

    expect(settings.completed.color).toBe("#00ff1e");
    expect(lightSettingsEqual(settings, settings)).toBe(true);
    expect(lightSettingsEqual(settings, defaultLightSettings)).toBe(false);
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
