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
  const authRepository = new InMemoryAuthRepository();
  const app = await buildApp({
    env: testEnv,
    authRepository,
    adminRepository: new InMemoryAdminRepository({
      id: testAdminId,
      username: "admin",
      passwordHash,
      displayName: "Test Admin",
      disabledAt: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    }),
  });
  return { app, authRepository };
}

async function loginAsAdmin(app: Awaited<ReturnType<typeof createTestApp>>["app"]) {
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

async function seedPhoneUser(authRepository: InMemoryAuthRepository) {
  const identity = await authRepository.registerOrLoginWithPhone({
    phoneNumber: "13800138000",
    passwordHash: await hashPassword("phone-user-password"),
    displayName: "手机用户",
  });
  return identity.user;
}

describe("admin activation routes", () => {
  it("rejects admin requests without a token", async () => {
    const { app } = await createTestApp();
    const response = await app.inject({
      method: "GET",
      url: "/api/admin/activation-codes",
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("admin_unauthorized");
  });

  it("rejects invalid admin login credentials", async () => {
    const { app } = await createTestApp();
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
    const { app } = await createTestApp();
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

    const revokeAgain = await app.inject({
      method: "POST",
      url: `/api/admin/activation-codes/${createdBody.data.codes[0].id}/revoke`,
      headers,
      payload: {},
    });

    expect(revokeAgain.statusCode).toBe(200);
    expect(revokeAgain.json().data.revoked).toBe(true);
  });

  it("rejects revoking a used activation code", async () => {
    const { app, authRepository } = await createTestApp();
    const headers = await loginAsAdmin(app);

    const created = await app.inject({
      method: "POST",
      url: "/api/admin/activation-codes",
      headers,
      payload: { count: 1 },
    });

    const codeId = created.json().data.codes[0].id;
    const record = authRepository["activationCodes"].get(codeId);
    if (record) {
      record.status = "used";
    }

    const revoke = await app.inject({
      method: "POST",
      url: `/api/admin/activation-codes/${codeId}/revoke`,
      headers,
      payload: {},
    });

    expect(revoke.statusCode).toBe(409);
    expect(revoke.json().error.code).toBe("activation_code_used");
  });

  it("returns not found when revoking a missing activation code", async () => {
    const { app } = await createTestApp();
    const headers = await loginAsAdmin(app);

    const revoke = await app.inject({
      method: "POST",
      url: "/api/admin/activation-codes/00000000-0000-4000-8000-000000000099/revoke",
      headers,
      payload: {},
    });

    expect(revoke.statusCode).toBe(404);
    expect(revoke.json().error.code).toBe("not_found");
  });
});

describe("admin user routes", () => {
  it("lists, details, disables and enables end users", async () => {
    const { app, authRepository } = await createTestApp();
    const user = await seedPhoneUser(authRepository);
    const headers = await loginAsAdmin(app);

    const listed = await app.inject({
      method: "GET",
      url: "/api/admin/users?type=phone&limit=10&offset=0",
      headers,
    });

    expect(listed.statusCode).toBe(200);
    expect(listed.json().data.total).toBeGreaterThanOrEqual(1);
    expect(listed.json().data.items[0].user_type).toBe("phone");

    const detail = await app.inject({
      method: "GET",
      url: `/api/admin/users/${user.id}`,
      headers,
    });

    expect(detail.statusCode).toBe(200);
    expect(detail.json().data.user.id).toBe(user.id);

    const disabled = await app.inject({
      method: "POST",
      url: `/api/admin/users/${user.id}/disable`,
      headers,
      payload: {},
    });

    expect(disabled.statusCode).toBe(200);
    expect(disabled.json().data.disabled_at).not.toBeNull();

    const enabled = await app.inject({
      method: "POST",
      url: `/api/admin/users/${user.id}/enable`,
      headers,
      payload: {},
    });

    expect(enabled.statusCode).toBe(200);
    expect(enabled.json().data.disabled_at).toBeNull();
  });
});

describe("admin account routes", () => {
  it("creates, lists, updates and disables admin accounts with guardrails", async () => {
    const { app } = await createTestApp();
    const headers = await loginAsAdmin(app);

    const created = await app.inject({
      method: "POST",
      url: "/api/admin/admins",
      headers,
      payload: {
        username: "ops",
        password: "ops-password-12",
        display_name: "Ops Admin",
      },
    });

    expect(created.statusCode).toBe(201);
    const opsId = created.json().data.id;

    const listed = await app.inject({
      method: "GET",
      url: "/api/admin/admins?limit=10&offset=0",
      headers,
    });

    expect(listed.statusCode).toBe(200);
    expect(listed.json().data.total).toBeGreaterThanOrEqual(2);

    const updated = await app.inject({
      method: "PATCH",
      url: `/api/admin/admins/${opsId}`,
      headers,
      payload: {
        display_name: "Ops Updated",
        password: "ops-password-34",
      },
    });

    expect(updated.statusCode).toBe(200);
    expect(updated.json().data.display_name).toBe("Ops Updated");

    const disableSelf = await app.inject({
      method: "POST",
      url: `/api/admin/admins/${testAdminId}/disable`,
      headers,
      payload: {},
    });

    expect(disableSelf.statusCode).toBe(403);
    expect(disableSelf.json().error.code).toBe("admin_self_disable_forbidden");

    const disableOps = await app.inject({
      method: "POST",
      url: `/api/admin/admins/${opsId}/disable`,
      headers,
      payload: {},
    });

    expect(disableOps.statusCode).toBe(200);
    expect(disableOps.json().data.disabled_at).not.toBeNull();

    const enableOps = await app.inject({
      method: "POST",
      url: `/api/admin/admins/${opsId}/enable`,
      headers,
      payload: {},
    });

    expect(enableOps.statusCode).toBe(200);
    expect(enableOps.json().data.disabled_at).toBeNull();
  });
});
