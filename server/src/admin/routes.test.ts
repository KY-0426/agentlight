import { describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { hashPassword } from "../auth/crypto";
import { InMemoryAuthRepository } from "../auth/in-memory-repository";
import { InMemoryAdminRepository } from "./repository";

const testEnv = {
  NODE_ENV: "test",
  LOG_LEVEL: "silent",
  DATABASE_URL: "postgresql://agent_light:agent_light@127.0.0.1:5432/agent_light",
  ACCESS_TOKEN_SECRET: "a".repeat(32),
  REFRESH_TOKEN_SECRET: "b".repeat(32),
  ACTIVATION_SIGNING_SECRET: "c".repeat(32),
};

const testAdminPassword = "test-admin-password";
const testAdminId = "00000000-0000-4000-8000-000000000001";

async function createTestApp() {
  const passwordHash = await hashPassword(testAdminPassword);
  return buildApp({
    env: testEnv,
    authRepository: new InMemoryAuthRepository(),
    adminRepository: new InMemoryAdminRepository({
      id: testAdminId,
      username: "admin",
      passwordHash,
      displayName: "Test Admin",
      disabledAt: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    }),
  });
}

async function loginAsAdmin(app: Awaited<ReturnType<typeof createTestApp>>) {
  const response = await app.inject({
    method: "POST",
    url: "/api/admin/login",
    payload: {
      username: "admin",
      password: testAdminPassword,
    },
  });

  expect(response.statusCode).toBe(200);
  return {
    authorization: `Bearer ${response.json().data.access_token}`,
  };
}

describe("admin activation routes", () => {
  it("rejects admin requests without a token", async () => {
    const app = await createTestApp();
    const response = await app.inject({
      method: "GET",
      url: "/api/admin/activation-codes",
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("admin_unauthorized");
  });

  it("rejects invalid admin login credentials", async () => {
    const app = await createTestApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/admin/login",
      payload: {
        username: "admin",
        password: "wrong-password",
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("admin_unauthorized");
  });

  it("logs in and creates, lists and revokes activation codes", async () => {
    const app = await createTestApp();
    const headers = await loginAsAdmin(app);

    const created = await app.inject({
      method: "POST",
      url: "/api/admin/activation-codes",
      headers,
      payload: {
        count: 2,
        label: "batch-a",
      },
    });

    expect(created.statusCode).toBe(201);
    const createdBody = created.json();
    expect(createdBody.data.codes).toHaveLength(2);
    expect(createdBody.data.codes[0].code).toMatch(/^AL-/);

    const listed = await app.inject({
      method: "GET",
      url: "/api/admin/activation-codes?status=active&limit=10&offset=0",
      headers,
    });

    expect(listed.statusCode).toBe(200);
    expect(listed.json().data.total).toBeGreaterThanOrEqual(2);

    const revoke = await app.inject({
      method: "POST",
      url: `/api/admin/activation-codes/${createdBody.data.codes[0].id}/revoke`,
      headers,
      payload: {},
    });

    expect(revoke.statusCode).toBe(200);
    expect(revoke.json().data.revoked).toBe(true);
  });
});
