import { describe, expect, it } from "vitest";
import {
  formatShanghaiDate,
  parseLeaderboardDateParam,
  resolveUsageRollupDate,
  toUsageDateObject,
} from "./shanghai-date";

describe("shanghai-date", () => {
  it("maps UTC evening to the next Shanghai calendar day", () => {
    const serverNow = new Date("2026-07-01T18:00:00Z");

    expect(formatShanghaiDate(serverNow)).toBe("2026-07-02");
    expect(resolveUsageRollupDate(serverNow)).toBe("2026-07-02");
  });

  it("parses leaderboard ISO datetimes into Shanghai calendar dates", () => {
    expect(parseLeaderboardDateParam("2026-07-01T18:00:00Z")).toBe("2026-07-02");
    expect(parseLeaderboardDateParam("2026-07-01T16:00:00+08:00")).toBe("2026-07-01");
  });

  it("converts Shanghai date strings into UTC midnight Date objects", () => {
    const date = toUsageDateObject("2026-07-02");

    expect(date.toISOString()).toBe("2026-07-02T00:00:00.000Z");
  });
});
