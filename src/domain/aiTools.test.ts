import { describe, expect, it } from "vitest";
import { aiToolOrder, aiToolAccent, isAiToolId } from "./aiTools";

describe("aiTools domain", () => {
  it("recognizes supported tool ids", () => {
    expect(isAiToolId("codex")).toBe(true);
    expect(isAiToolId("cursor")).toBe(true);
    expect(isAiToolId("unknown")).toBe(false);
  });

  it("keeps display metadata for every ordered tool", () => {
    for (const id of aiToolOrder) {
      expect(aiToolAccent[id]).toMatch(/^#[0-9a-f]{6}$/i);
      expect(isAiToolId(id)).toBe(true);
    }
  });
});
