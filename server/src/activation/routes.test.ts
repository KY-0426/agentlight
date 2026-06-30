import { describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { InMemoryAuthRepository } from "../auth/in-memory-repository";
import { resetActivationRateLimitForTests } from "../http/activation-rate-limit";
import { verifyActivationReceipt } from "../activation/receipt";

const testEnv = {
  NODE_ENV: "test",
  LOG_LEVEL: "silent",
  DATABASE_URL: "postgresql://agent_light:agent_light@127.0.0.1:5432/agent_light",
  ACCESS_TOKEN_SECRET: "a".repeat(32),
  REFRESH_TOKEN_SECRET: "b".repeat(32),
  ADMIN_API_KEY: "test-admin-key-123456",
  ACTIVATION_SIGNING_SECRET: "c".repeat(32),
};

function createRepository() {
  const repository = new InMemoryAuthRepository();
  repository.addActivationCode("AL-TESTCODE123456");
  return repository;
}

describe("activation routes", () => {
  it("activates a client with a valid code", async () => {
    resetActivationRateLimitForTests();
    const repository = createRepository();
    const app = await buildApp({ env: testEnv, authRepository: repository });

    const response = await app.inject({
      method: "POST",
      url: "/api/activation/activate",
      payload: {
        activation_code: "AL-TESTCODE123456",
        installation_id: "install-activation-001",
        platform: "macos",
        app_version: "0.1.3",
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.ok).toBe(true);
    expect(body.data.installation_id).toBe("install-activation-001");
    expect(body.data.receipt).toBeTruthy();
    expect(
      verifyActivationReceipt(testEnv.ACTIVATION_SIGNING_SECRET, {
        activationId: body.data.activation_id,
        installationId: body.data.installation_id,
        activatedAt: body.data.activated_at,
      }, body.data.receipt),
    ).toBe(true);
  });

  it("rejects invalid activation codes", async () => {
    resetActivationRateLimitForTests();
    const repository = createRepository();
    const app = await buildApp({ env: testEnv, authRepository: repository });

    const response = await app.inject({
      method: "POST",
      url: "/api/activation/activate",
      payload: {
        activation_code: "AL-BADCODE00000000",
        installation_id: "install-activation-002",
        platform: "windows",
        app_version: "0.1.3",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("activation_code_invalid");
  });

  it("allows recovery for the same installation after activation", async () => {
    resetActivationRateLimitForTests();
    const repository = createRepository();
    const app = await buildApp({ env: testEnv, authRepository: repository });
    const payload = {
      activation_code: "AL-TESTCODE123456",
      installation_id: "install-activation-003",
      platform: "macos",
      app_version: "0.1.3",
    };

    const first = await app.inject({ method: "POST", url: "/api/activation/activate", payload });
    const second = await app.inject({ method: "POST", url: "/api/activation/activate", payload });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json().data.activation_id).toBe(first.json().data.activation_id);
  });
});
