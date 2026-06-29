import { describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { InMemoryAuthRepository } from "./in-memory-repository";

const testEnv = {
  NODE_ENV: "test",
  LOG_LEVEL: "silent",
  DATABASE_URL: "postgresql://agent_light:agent_light@127.0.0.1:5432/agent_light",
  ACCESS_TOKEN_SECRET: "a".repeat(32),
  REFRESH_TOKEN_SECRET: "b".repeat(32),
};

function createRepository() {
  const repository = new InMemoryAuthRepository();
  repository.addInviteCode("INVITE-123");
  return repository;
}

describe("auth routes", () => {
  it("registers with an invite code and returns /api/me", async () => {
    const repository = createRepository();
    const app = await buildApp({ env: testEnv, authRepository: repository });
    const register = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        invite_code: "INVITE-123",
        email: "USER@example.com",
        password: "long-password",
        display_name: "Agent User",
      },
    });

    expect(register.statusCode).toBe(201);
    const body = register.json();
    expect(body.data.user.email).toBe("user@example.com");
    expect(body.data.workspaces[0].membership.role).toBe("owner");

    const me = await app.inject({
      method: "GET",
      url: "/api/me",
      headers: {
        authorization: `Bearer ${body.data.access_token}`,
      },
    });

    expect(me.statusCode).toBe(200);
    expect(me.json().data.user.email).toBe("user@example.com");

    await app.close();
  });

  it("rejects invalid invite codes", async () => {
    const app = await buildApp({ env: testEnv, authRepository: createRepository() });
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        invite_code: "BAD-123",
        email: "user@example.com",
        password: "long-password",
        display_name: "Agent User",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("invite_code_invalid");

    await app.close();
  });

  it("logs in with phone verification and auto-creates missing accounts", async () => {
    const repository = createRepository();
    const app = await buildApp({ env: testEnv, authRepository: repository });
    const sent = await app.inject({
      method: "POST",
      url: "/api/auth/phone/send-code",
      payload: {
        phone_number: "13800138000",
      },
    });

    expect(sent.statusCode).toBe(200);
    expect(sent.json().data.dev_code).toMatch(/^\d{6}$/);

    const register = await app.inject({
      method: "POST",
      url: "/api/auth/phone/verify",
      payload: {
        phone_number: "13800138000",
        verification_code: sent.json().data.dev_code,
        display_name: "手机用户",
      },
    });

    expect(register.statusCode).toBe(201);
    expect(register.json().data.user.phone_number).toBe("13800138000");
    expect(register.json().data.workspaces[0].membership.role).toBe("owner");

    const me = await app.inject({
      method: "GET",
      url: "/api/me",
      headers: {
        authorization: `Bearer ${register.json().data.access_token}`,
      },
    });

    expect(me.statusCode).toBe(200);
    expect(me.json().data.user.phone_number).toBe("13800138000");

    const reused = await app.inject({
      method: "POST",
      url: "/api/auth/phone/verify",
      payload: {
        phone_number: "13800138000",
        verification_code: sent.json().data.dev_code,
        display_name: "手机用户",
      },
    });

    expect(reused.statusCode).toBe(400);
    expect(reused.json().error.code).toBe("verification_code_invalid");

    const secondSent = await app.inject({
      method: "POST",
      url: "/api/auth/phone/send-code",
      payload: {
        phone_number: "13800138000",
      },
    });
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/phone/verify",
      payload: {
        phone_number: "13800138000",
        verification_code: secondSent.json().data.dev_code,
      },
    });

    expect(login.statusCode).toBe(200);
    expect(login.json().data.user.id).toBe(register.json().data.user.id);
    expect(login.json().data.user.display_name).toBe("手机用户");

    await app.close();
  });

  it("logs in and refreshes token pairs", async () => {
    const repository = createRepository();
    const app = await buildApp({ env: testEnv, authRepository: repository });
    await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        invite_code: "INVITE-123",
        email: "user@example.com",
        password: "long-password",
        display_name: "Agent User",
      },
    });

    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        email: "user@example.com",
        password: "long-password",
      },
    });

    expect(login.statusCode).toBe(200);

    const refresh = await app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      payload: {
        refresh_token: login.json().data.refresh_token,
      },
    });

    expect(refresh.statusCode).toBe(200);
    expect(refresh.json().data.refresh_token).not.toBe(login.json().data.refresh_token);

    const staleRefresh = await app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      payload: {
        refresh_token: login.json().data.refresh_token,
      },
    });

    expect(staleRefresh.statusCode).toBe(401);

    await app.close();
  });

  it("rejects wrong login passwords", async () => {
    const repository = createRepository();
    const app = await buildApp({ env: testEnv, authRepository: repository });
    await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        invite_code: "INVITE-123",
        email: "user@example.com",
        password: "long-password",
        display_name: "Agent User",
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        email: "user@example.com",
        password: "wrong-password",
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("unauthorized");

    await app.close();
  });
});
