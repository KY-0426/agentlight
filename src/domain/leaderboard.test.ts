import { describe, expect, it } from "vitest";
import {
  buildTokenLeaderboardUrl,
  normalizeLeaderboardLimit,
  normalizeLeaderboardServerUrl,
  parseTokenLeaderboardResponse,
  resolveLeaderboardDateRange,
} from "./leaderboard";

describe("leaderboard domain", () => {
  it("builds the real token leaderboard API URL", () => {
    expect(
      buildTokenLeaderboardUrl({
        serverUrl: "http://127.0.0.1:8787/",
        limit: 20,
      }),
    ).toBe("http://127.0.0.1:8787/api/leaderboards/tokens?agent_provider=codex&limit=20");

    expect(
      buildTokenLeaderboardUrl({
        serverUrl: "http://127.0.0.1:8787/",
        agentProvider: "claude_code",
        workspaceId: "018f6d66-60ce-7b6f-96f8-111111111111",
        limit: 10,
      }),
    ).toBe(
      "http://127.0.0.1:8787/api/leaderboards/tokens?workspace_id=018f6d66-60ce-7b6f-96f8-111111111111&agent_provider=claude_code&limit=10",
    );

    expect(
      buildTokenLeaderboardUrl({
        serverUrl: "http://127.0.0.1:8787/",
        agentProvider: "github_copilot",
        timePeriod: "day",
        from: "2026-06-29",
        to: "2026-06-29",
        limit: 20,
      }),
    ).toContain("agent_provider=github_copilot");
    expect(
      buildTokenLeaderboardUrl({
        serverUrl: "http://127.0.0.1:8787/",
        agentProvider: "github_copilot",
        timePeriod: "day",
        from: "2026-06-29",
        to: "2026-06-29",
        limit: 20,
      }),
    ).toContain("from=");
    expect(
      buildTokenLeaderboardUrl({
        serverUrl: "http://127.0.0.1:8787/",
        agentProvider: "github_copilot",
        timePeriod: "day",
        from: "2026-06-29",
        to: "2026-06-29",
        limit: 20,
      }),
    ).toContain("to=");
  });

  it("resolves calendar date ranges for day, week, month, and total", () => {
    const now = new Date(2026, 5, 25, 15, 30, 0);

    expect(resolveLeaderboardDateRange("total", now)).toEqual({});
    expect(resolveLeaderboardDateRange("day", now)).toEqual({
      from: "2026-06-25",
      to: "2026-06-25",
    });
    expect(resolveLeaderboardDateRange("week", now)).toEqual({
      from: "2026-06-22",
      to: "2026-06-25",
    });
    expect(resolveLeaderboardDateRange("month", now)).toEqual({
      from: "2026-06-01",
      to: "2026-06-25",
    });
  });

  it("keeps server URLs on http or https origins only", () => {
    expect(normalizeLeaderboardServerUrl(" https://agent-light.example.com/api ")).toBe(
      "https://agent-light.example.com",
    );
    expect(() => normalizeLeaderboardServerUrl("file:///tmp/agent-light")).toThrow("http 或 https");
  });

  it("clamps leaderboard limits to the API contract", () => {
    expect(normalizeLeaderboardLimit(undefined)).toBe(20);
    expect(normalizeLeaderboardLimit(0)).toBe(1);
    expect(normalizeLeaderboardLimit(150)).toBe(100);
  });

  it("parses the success envelope without accepting malformed entries", () => {
    expect(
      parseTokenLeaderboardResponse({
        ok: true,
        data: {
          scope: "global",
          workspace_id: null,
          agent_provider: "codex",
          total_tokens: 1200,
          current_user_rank: 1,
          entries: [
            {
              user_id: "018f6d66-60ce-7b6f-96f8-222222222222",
              display_name: "anna",
              tokens_used: 1200,
              rank: 1,
            },
          ],
        },
      }).scope,
    ).toBe("global");

    expect(
      parseTokenLeaderboardResponse({
        ok: true,
        data: {
          scope: "workspace",
          workspace_id: "018f6d66-60ce-7b6f-96f8-111111111111",
          agent_provider: "claude_code",
          total_tokens: 1200,
          current_user_rank: null,
          entries: [
            {
              user_id: "018f6d66-60ce-7b6f-96f8-222222222222",
              display_name: "anna",
              tokens_used: 1200,
              rank: 1,
            },
          ],
        },
      }).entries[0].display_name,
    ).toBe("anna");

    expect(
      parseTokenLeaderboardResponse({
        ok: true,
        data: {
          scope: "global",
          workspace_id: null,
          agent_provider: "antigravity",
          total_tokens: 0,
          current_user_rank: null,
          entries: [],
        },
      }).agent_provider,
    ).toBe("antigravity");

    expect(() =>
      parseTokenLeaderboardResponse({
        ok: true,
        data: {
          scope: "global",
          workspace_id: "018f6d66-60ce-7b6f-96f8-111111111111",
          agent_provider: "codex",
          total_tokens: 0,
          current_user_rank: null,
          entries: [{ display_name: "missing fields" }],
        },
      }),
    ).toThrow("条目字段");
  });
});
