import { describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { InMemoryAuthRepository } from "../auth/in-memory-repository";

const testEnv = {
  NODE_ENV: "test",
  LOG_LEVEL: "silent",
  DATABASE_URL: "postgresql://agent_light:agent_light@127.0.0.1:5432/agent_light",
  ACCESS_TOKEN_SECRET: "a".repeat(32),
  REFRESH_TOKEN_SECRET: "b".repeat(32),
  ACTIVATION_SIGNING_SECRET: "c".repeat(32),
};

async function registerUser(app: Awaited<ReturnType<typeof buildApp>>, inviteCode: string, email: string) {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: {
      invite_code: inviteCode,
      email,
      password: "long-password",
      display_name: email.split("@")[0],
    },
  });

  expect(response.statusCode).toBe(201);
  return response.json().data as {
    access_token: string;
    user: { id: string };
    workspaces: Array<{ workspace: { id: string } }>;
  };
}

async function registerDevice(app: Awaited<ReturnType<typeof buildApp>>, accessToken: string, installationId: string) {
  const response = await app.inject({
    method: "POST",
    url: "/api/devices/register",
    headers: {
      authorization: `Bearer ${accessToken}`,
    },
    payload: {
      installation_id: installationId,
      platform: "macos",
      app_version: "0.1.0",
      device_label: "Mac Studio",
    },
  });

  expect(response.statusCode).toBe(200);
  return response.json().data as { id: string; workspace_id: string; user_id: string };
}

describe("mvp api routes", () => {
  async function activateInstallation(
    app: Awaited<ReturnType<typeof buildApp>>,
    installationId: string,
    repository: InMemoryAuthRepository,
  ) {
    repository.addActivationCode("AL-TESTCODE123456");
    const response = await app.inject({
      method: "POST",
      url: "/api/activation/activate",
      payload: {
        activation_code: "AL-TESTCODE123456",
        installation_id: installationId,
        platform: "windows",
        app_version: "0.1.0",
      },
    });
    expect(response.statusCode).toBe(200);
  }

  it("requires activation before bootstrap", async () => {
    const repository = new InMemoryAuthRepository();
    const app = await buildApp({ env: testEnv, authRepository: repository });
    const response = await app.inject({
      method: "POST",
      url: "/api/devices/bootstrap",
      payload: {
        installation_id: "install-bootstrap-unactivated",
        platform: "windows",
        app_version: "0.1.0",
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("activation_code_required");
  });

  it("bootstraps an activation account and reuses the same user on repeat", async () => {
    const repository = new InMemoryAuthRepository();
    const app = await buildApp({ env: testEnv, authRepository: repository });
    const installationId = "install-bootstrap-0001";
    await activateInstallation(app, installationId, repository);
    const payload = {
      installation_id: installationId,
      platform: "windows" as const,
      app_version: "0.1.0",
    };

    const first = await app.inject({ method: "POST", url: "/api/devices/bootstrap", payload });
    const second = await app.inject({ method: "POST", url: "/api/devices/bootstrap", payload });

    expect(first.statusCode).toBe(201);
    expect(first.json().data).toMatchObject({
      created: true,
      device: {
        installation_id: payload.installation_id,
        platform: payload.platform,
      },
      user: {
        display_name: expect.stringMatching(/^玩家_/),
        phone_number: null,
      },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().data.created).toBe(false);
    expect(second.json().data.user.id).toBe(first.json().data.user.id);
    expect(second.json().data.device.id).toBe(first.json().data.device.id);

    const renamed = await app.inject({
      method: "PATCH",
      url: "/api/me",
      headers: { authorization: `Bearer ${first.json().data.access_token}` },
      payload: { display_name: "我的固定用户名" },
    });
    expect(renamed.statusCode).toBe(200);

    const third = await app.inject({ method: "POST", url: "/api/devices/bootstrap", payload });
    expect(third.statusCode).toBe(200);
    expect(third.json().data.user.display_name).toBe("我的固定用户名");

    const usage = await app.inject({
      method: "POST",
      url: "/api/usage/codex-thread",
      headers: { authorization: `Bearer ${first.json().data.access_token}` },
      payload: {
        workspace_id: first.json().data.device.workspace_id,
        device_id: first.json().data.device.id,
        agent_provider: "cursor",
        codex_thread_id: "composer-bootstrap",
        tokens_used: 88,
        thread_updated_at_ms: 1_780_000_000_000,
        sampled_at_ms: 1_780_000_000_000,
      },
    });
    const leaderboard = await app.inject({
      method: "GET",
      url: "/api/leaderboards/tokens?agent_provider=cursor",
      headers: { authorization: `Bearer ${first.json().data.access_token}` },
    });

    expect(usage.statusCode).toBe(200);
    expect(leaderboard.statusCode).toBe(200);
    expect(leaderboard.json().data).toMatchObject({
      agent_provider: "cursor",
      total_tokens: 88,
      current_user_rank: 1,
    });

    await app.close();
  });

  it("registers desktop devices and binds hardware hello payloads", async () => {
    const repository = new InMemoryAuthRepository();
    repository.addInviteCode("INVITE-123");
    const app = await buildApp({ env: testEnv, authRepository: repository });
    const identity = await registerUser(app, "INVITE-123", "user@example.com");
    const device = await registerDevice(app, identity.access_token, "install-macos-0001");

    expect(device.workspace_id).toBe(identity.workspaces[0].workspace.id);
    expect(device.user_id).toBe(identity.user.id);

    const bind = await app.inject({
      method: "POST",
      url: "/api/hardware-devices/bind",
      headers: {
        authorization: `Bearer ${identity.access_token}`,
      },
      payload: {
        device_id: device.id,
        hardware_device_id: "agent-rgb-0001",
        firmware_version: "0.1.0",
        protocol_version: "1",
        hardware_revision: "devkit-c3",
      },
    });

    expect(bind.statusCode).toBe(200);
    expect(bind.json().data).toMatchObject({
      workspace_id: device.workspace_id,
      device_id: device.id,
      hardware_device_id: "agent-rgb-0001",
      firmware_version: "0.1.0",
    });

    await app.close();
  });

  it("records Codex thread usage with dedupe, stale protection, and leaderboard rollups", async () => {
    const repository = new InMemoryAuthRepository();
    repository.addInviteCode("INVITE-123");
    const app = await buildApp({ env: testEnv, authRepository: repository });
    const identity = await registerUser(app, "INVITE-123", "user@example.com");
    const device = await registerDevice(app, identity.access_token, "install-macos-0002");
    const headers = { authorization: `Bearer ${identity.access_token}` };
    const usagePayload = {
      workspace_id: device.workspace_id,
      device_id: device.id,
      codex_thread_id: "thread-1",
      model: "gpt-5",
      tokens_used: 100,
      thread_updated_at_ms: 1_780_000_000_000,
      sampled_at_ms: 1_780_000_000_000,
    };

    const first = await app.inject({ method: "POST", url: "/api/usage/codex-thread", headers, payload: usagePayload });
    const duplicate = await app.inject({ method: "POST", url: "/api/usage/codex-thread", headers, payload: usagePayload });
    const stale = await app.inject({
      method: "POST",
      url: "/api/usage/codex-thread",
      headers,
      payload: { ...usagePayload, tokens_used: 80, thread_updated_at_ms: 1_780_000_000_001 },
    });
    const newer = await app.inject({
      method: "POST",
      url: "/api/usage/codex-thread",
      headers,
      payload: { ...usagePayload, tokens_used: 150, thread_updated_at_ms: 1_780_000_000_002 },
    });
    const claude = await app.inject({
      method: "POST",
      url: "/api/usage/codex-thread",
      headers,
      payload: {
        ...usagePayload,
        agent_provider: "claude_code",
        codex_thread_id: "thread-claude",
        tokens_used: 900,
        thread_updated_at_ms: 1_780_000_000_003,
      },
    });
    const cursor = await app.inject({
      method: "POST",
      url: "/api/usage/codex-thread",
      headers,
      payload: {
        ...usagePayload,
        agent_provider: "cursor",
        codex_thread_id: "composer-abc123",
        model: "composer-2",
        tokens_used: 420,
        thread_updated_at_ms: 1_780_000_000_004,
      },
    });

    expect(first.statusCode).toBe(200);
    expect(first.json().data).toMatchObject({ accepted_tokens_used: 100, ignored_stale_value: false });
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json().data).toMatchObject({ accepted_tokens_used: 100, ignored_stale_value: false });
    expect(stale.statusCode).toBe(200);
    expect(stale.json().data).toMatchObject({ tokens_used: 80, accepted_tokens_used: 100, ignored_stale_value: true });
    expect(newer.statusCode).toBe(200);
    expect(newer.json().data).toMatchObject({ accepted_tokens_used: 150, ignored_stale_value: false });
    expect(claude.statusCode).toBe(200);
    expect(cursor.statusCode).toBe(200);
    expect(cursor.json().data).toMatchObject({ accepted_tokens_used: 420, ignored_stale_value: false });

    const leaderboard = await app.inject({
      method: "GET",
      url: `/api/leaderboards/tokens?workspace_id=${device.workspace_id}&agent_provider=codex`,
      headers,
    });
    const claudeLeaderboard = await app.inject({
      method: "GET",
      url: `/api/leaderboards/tokens?workspace_id=${device.workspace_id}&agent_provider=claude_code`,
      headers,
    });
    const cursorLeaderboard = await app.inject({
      method: "GET",
      url: `/api/leaderboards/tokens?workspace_id=${device.workspace_id}&agent_provider=cursor`,
      headers,
    });

    expect(leaderboard.statusCode).toBe(200);
    expect(leaderboard.json().data).toMatchObject({
      scope: "workspace",
      workspace_id: device.workspace_id,
      agent_provider: "codex",
      total_tokens: 150,
      current_user_rank: 1,
    });
    expect(leaderboard.json().data.entries).toEqual([
      {
        user_id: identity.user.id,
        display_name: "user",
        tokens_used: 150,
        rank: 1,
      },
    ]);
    expect(claudeLeaderboard.statusCode).toBe(200);
    expect(claudeLeaderboard.json().data).toMatchObject({
      agent_provider: "claude_code",
      total_tokens: 900,
      current_user_rank: 1,
    });
    expect(claudeLeaderboard.json().data.entries[0]).toMatchObject({
      user_id: identity.user.id,
      tokens_used: 900,
      rank: 1,
    });
    expect(cursorLeaderboard.statusCode).toBe(200);
    expect(cursorLeaderboard.json().data).toMatchObject({
      agent_provider: "cursor",
      total_tokens: 420,
      current_user_rank: 1,
    });
    expect(cursorLeaderboard.json().data.entries[0]).toMatchObject({
      user_id: identity.user.id,
      tokens_used: 420,
      rank: 1,
    });

    await app.close();
  });

  it("shows a global token leaderboard to every app user without exposing usage write access", async () => {
    const repository = new InMemoryAuthRepository();
    repository.addInviteCode("INVITE-123");
    repository.addInviteCode("INVITE-456");
    const app = await buildApp({ env: testEnv, authRepository: repository });
    const firstUser = await registerUser(app, "INVITE-123", "first@example.com");
    const secondUser = await registerUser(app, "INVITE-456", "second@example.com");
    const firstDevice = await registerDevice(app, firstUser.access_token, "install-macos-first");
    const secondDevice = await registerDevice(app, secondUser.access_token, "install-macos-second");

    await app.inject({
      method: "POST",
      url: "/api/usage/codex-thread",
      headers: { authorization: `Bearer ${firstUser.access_token}` },
      payload: {
        workspace_id: firstDevice.workspace_id,
        device_id: firstDevice.id,
        codex_thread_id: "thread-first",
        tokens_used: 100,
        thread_updated_at_ms: 1_780_000_000_000,
        sampled_at_ms: 1_780_000_000_000,
      },
    });
    await app.inject({
      method: "POST",
      url: "/api/usage/codex-thread",
      headers: { authorization: `Bearer ${secondUser.access_token}` },
      payload: {
        workspace_id: secondDevice.workspace_id,
        device_id: secondDevice.id,
        codex_thread_id: "thread-second",
        tokens_used: 250,
        thread_updated_at_ms: 1_780_000_000_000,
        sampled_at_ms: 1_780_000_000_000,
      },
    });

    const leaderboard = await app.inject({
      method: "GET",
      url: "/api/leaderboards/tokens",
    });
    const unauthorizedWrite = await app.inject({
      method: "POST",
      url: "/api/usage/codex-thread",
      payload: {
        workspace_id: firstDevice.workspace_id,
        device_id: firstDevice.id,
        codex_thread_id: "spoofed-thread",
        tokens_used: 999_999,
        thread_updated_at_ms: 1_780_000_000_001,
        sampled_at_ms: 1_780_000_000_001,
      },
    });

    expect(leaderboard.statusCode).toBe(200);
    expect(leaderboard.json().data).toMatchObject({
      scope: "global",
      workspace_id: null,
      agent_provider: "codex",
      total_tokens: 350,
      current_user_rank: null,
    });
    expect(leaderboard.json().data.entries).toEqual([
      {
        user_id: secondUser.user.id,
        display_name: "second",
        tokens_used: 250,
        rank: 1,
      },
      {
        user_id: firstUser.user.id,
        display_name: "first",
        tokens_used: 100,
        rank: 2,
      },
    ]);
    expect(unauthorizedWrite.statusCode).toBe(401);

    await app.close();
  });

  it("rejects forbidden local-path and secret-like usage payload keys", async () => {
    const repository = new InMemoryAuthRepository();
    repository.addInviteCode("INVITE-123");
    const app = await buildApp({ env: testEnv, authRepository: repository });
    const identity = await registerUser(app, "INVITE-123", "user@example.com");
    const device = await registerDevice(app, identity.access_token, "install-macos-0003");

    const response = await app.inject({
      method: "POST",
      url: "/api/usage/codex-thread",
      headers: {
        authorization: `Bearer ${identity.access_token}`,
      },
      payload: {
        workspace_id: device.workspace_id,
        device_id: device.id,
        codex_thread_id: "thread-1",
        tokens_used: 100,
        thread_updated_at_ms: 1_780_000_000_000,
        sampled_at_ms: 1_780_000_000_000,
        cwd: "/Users/example/.codex",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("validation_failed");

    await app.close();
  });

  it("enforces workspace and device ownership on usage and leaderboard APIs", async () => {
    const repository = new InMemoryAuthRepository();
    repository.addInviteCode("INVITE-123");
    repository.addInviteCode("INVITE-456");
    const app = await buildApp({ env: testEnv, authRepository: repository });
    const owner = await registerUser(app, "INVITE-123", "owner@example.com");
    const intruder = await registerUser(app, "INVITE-456", "intruder@example.com");
    const ownerDevice = await registerDevice(app, owner.access_token, "install-macos-owner");
    const intruderHeaders = { authorization: `Bearer ${intruder.access_token}` };

    const usage = await app.inject({
      method: "POST",
      url: "/api/usage/codex-thread",
      headers: intruderHeaders,
      payload: {
        workspace_id: ownerDevice.workspace_id,
        device_id: ownerDevice.id,
        codex_thread_id: "thread-1",
        tokens_used: 100,
        thread_updated_at_ms: 1_780_000_000_000,
        sampled_at_ms: 1_780_000_000_000,
      },
    });
    const leaderboard = await app.inject({
      method: "GET",
      url: `/api/leaderboards/tokens?workspace_id=${ownerDevice.workspace_id}`,
      headers: intruderHeaders,
    });

    expect(usage.statusCode).toBe(403);
    expect(leaderboard.statusCode).toBe(403);

    await app.close();
  });
});
