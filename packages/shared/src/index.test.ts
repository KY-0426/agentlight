import { describe, expect, it } from "vitest";
import {
  codexThreadUsageRequestSchema,
  deviceBootstrapRequestSchema,
  forbiddenUsagePayloadKeys,
  leaderboardTokensQuerySchema,
  normalizeAgentStatus,
  sendPhoneVerificationCodeRequestSchema,
  verifyPhoneLoginRequestSchema,
  updateProfileRequestSchema,
  registerRequestSchema,
  sanitizeDisplayMessage,
} from "./index";

describe("shared schemas", () => {
  it("normalizes legacy status aliases", () => {
    expect(normalizeAgentStatus("running")).toBe("working");
    expect(normalizeAgentStatus("needs_action")).toBe("attention");
    expect(normalizeAgentStatus("standby")).toBe("standby");
    expect(normalizeAgentStatus("unknown")).toBeUndefined();
  });

  it("sanitizes display messages without preserving control whitespace", () => {
    expect(sanitizeDisplayMessage("  hello\n\tworld  ")).toBe("hello world");
    expect(sanitizeDisplayMessage("   ")).toBeNull();
    expect(sanitizeDisplayMessage("abcdef", 3)).toBe("abc");
  });

  it("accepts invite registration shape", () => {
    expect(
      registerRequestSchema.parse({
        invite_code: "TEAM-123",
        email: "user@example.com",
        password: "long-password",
        display_name: "Agent User",
      }),
    ).toMatchObject({ email: "user@example.com" });
  });

  it("accepts phone verification login shape", () => {
    expect(
      sendPhoneVerificationCodeRequestSchema.parse({
        phone_number: "13800138000",
      }),
    ).toMatchObject({ phone_number: "13800138000" });

    expect(
      verifyPhoneLoginRequestSchema.parse({
        phone_number: "13800138000",
        verification_code: "123456",
        display_name: "手机用户",
      }),
    ).toMatchObject({ verification_code: "123456" });
  });

  it("accepts profile update shape", () => {
    expect(
      updateProfileRequestSchema.parse({
        display_name: "新昵称",
      }),
    ).toMatchObject({ display_name: "新昵称" });
  });

  it("defaults usage and leaderboard agent provider to Codex", () => {
    expect(
      codexThreadUsageRequestSchema.parse({
        workspace_id: "018f6d66-60ce-7b6f-96f8-111111111111",
        device_id: "018f6d66-60ce-7b6f-96f8-222222222222",
        codex_thread_id: "thread-1",
        tokens_used: 42,
        thread_updated_at_ms: 100,
        sampled_at_ms: 110,
      }).agent_provider,
    ).toBe("codex");

    expect(leaderboardTokensQuerySchema.parse({}).agent_provider).toBe("codex");
  });

  it("accepts device bootstrap payload shape", () => {
    expect(
      deviceBootstrapRequestSchema.parse({
        installation_id: "install-bootstrap-0001",
        platform: "windows",
        app_version: "0.1.0",
      }).installation_id,
    ).toBe("install-bootstrap-0001");
  });

  it("accepts cursor as agent provider for usage and leaderboard queries", () => {
    expect(
      codexThreadUsageRequestSchema.parse({
        agent_provider: "cursor",
        workspace_id: "018f6d66-60ce-7b6f-96f8-111111111111",
        device_id: "018f6d66-60ce-7b6f-96f8-222222222222",
        codex_thread_id: "composer-abc123",
        tokens_used: 420,
        thread_updated_at_ms: 100,
        sampled_at_ms: 110,
      }).agent_provider,
    ).toBe("cursor");

    expect(leaderboardTokensQuerySchema.parse({ agent_provider: "cursor" }).agent_provider).toBe("cursor");
  });

  it("accepts extended agent providers for usage and leaderboard queries", () => {
    for (const agentProvider of [
      "github_copilot",
      "trae",
      "trae_cn",
      "qoder",
      "qoder_cn",
      "codebuddy",
      "antigravity",
      "kiro",
      "devin",
    ] as const) {
      expect(
        codexThreadUsageRequestSchema.parse({
          agent_provider: agentProvider,
          workspace_id: "018f6d66-60ce-7b6f-96f8-111111111111",
          device_id: "018f6d66-60ce-7b6f-96f8-222222222222",
          codex_thread_id: "thread-extended",
          tokens_used: 42,
          thread_updated_at_ms: 100,
          sampled_at_ms: 110,
        }).agent_provider,
      ).toBe(agentProvider);

      expect(leaderboardTokensQuerySchema.parse({ agent_provider: agentProvider }).agent_provider).toBe(
        agentProvider,
      );
    }
  });

  it("rejects path-bearing Codex usage payloads by schema shape", () => {
    const result = codexThreadUsageRequestSchema.safeParse({
      workspace_id: "018f6d66-60ce-7b6f-96f8-111111111111",
      device_id: "018f6d66-60ce-7b6f-96f8-222222222222",
      codex_thread_id: "thread-1",
      tokens_used: 42,
      thread_updated_at_ms: 100,
      sampled_at_ms: 110,
      cwd: "/Users/example/private-project",
    });

    expect(result.success).toBe(false);
    expect(forbiddenUsagePayloadKeys).toContain("rollout_path");
  });
});
