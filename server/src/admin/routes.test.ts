import { describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { InMemoryAuthRepository } from "../auth/in-memory-repository";

const testEnv = {
  NODE_ENV: "test",
  LOG_LEVEL: "silent",
  DATABASE_URL: "postgresql://agent_light:agent_light@127.0.0.1:5432/agent_light",
  ACCESS_TOKEN_SECRET: "a".repeat(32),
  REFRESH_TOKEN_SECRET: "b".repeat(32),
  ADMIN_API_KEY: "test-admin-key-123456",
  ACTIVATION_SIGNING_SECRET: "c".repeat(32),
};

describe("admin activation routes", () => {
  it("rejects admin requests without a key", async () => {
    const app = await buildApp({ env: testEnv, authRepository: new InMemoryAuthRepository() });
    const response = await app.inject({
      method: "GET",
      url: "/api/admin/activation-codes",
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("admin_unauthorized");
  });

  it("creates, lists and revokes activation codes", async () => {
    const app = await buildApp({ env: testEnv, authRepository: new InMemoryAuthRepository() });
    const headers = { authorization: "Bearer test-admin-key-123456" };

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
