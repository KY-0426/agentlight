import { describe, expect, it } from "vitest";
import { buildApp, buildLoggerOptions } from "./app";

const testEnv = {
  NODE_ENV: "test",
  LOG_LEVEL: "silent",
  DATABASE_URL: "mysql://agent_light:agent_light@127.0.0.1:3306/agent_light",
};

describe("server app", () => {
  it("serves the marketing website at /", async () => {
    const app = await buildApp({ env: testEnv });
    const response = await app.inject({ method: "GET", url: "/" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toMatch(/text\/html/);
    expect(response.body).toContain("Agent Light");

    await app.close();
  });

  it("serves health checks without secrets", async () => {
    const app = await buildApp({ env: testEnv });
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      service: "agent-light-server",
      environment: "test",
    });
    expect(response.body).not.toContain("agent_light:agent_light");

    await app.close();
  });

  it("returns structured errors", async () => {
    const app = await buildApp({ env: testEnv });
    app.get("/boom", async () => {
      throw new Error("boom");
    });

    const response = await app.inject({ method: "GET", url: "/boom" });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({
      ok: false,
      error: {
        code: "internal_error",
        message: "Internal server error",
      },
    });

    await app.close();
  });

  it("allows only local desktop origins for browser leaderboard requests", async () => {
    const app = await buildApp({ env: testEnv });
    const allowed = await app.inject({
      method: "OPTIONS",
      url: "/api/leaderboards/tokens",
      headers: {
        origin: "http://127.0.0.1:1420",
        "access-control-request-method": "GET",
        "access-control-request-headers": "authorization",
      },
    });
    const blocked = await app.inject({
      method: "OPTIONS",
      url: "/api/leaderboards/tokens",
      headers: {
        origin: "https://example.invalid",
        "access-control-request-method": "GET",
      },
    });

    expect(allowed.statusCode).toBe(204);
    expect(allowed.headers["access-control-allow-origin"]).toBe("http://127.0.0.1:1420");
    expect(allowed.headers["access-control-allow-headers"]).toContain("Authorization");
    expect(blocked.statusCode).toBe(204);
    expect(blocked.headers["access-control-allow-origin"]).toBeUndefined();

    await app.close();
  });

  it("allows PATCH preflight for desktop profile updates", async () => {
    const app = await buildApp({ env: testEnv });
    const response = await app.inject({
      method: "OPTIONS",
      url: "/api/me",
      headers: {
        origin: "https://tauri.localhost",
        "access-control-request-method": "PATCH",
        "access-control-request-headers": "authorization, content-type",
      },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe("https://tauri.localhost");
    expect(response.headers["access-control-allow-methods"]).toContain("PATCH");

    await app.close();
  });

  it("redacts auth and token-bearing log fields", () => {
    const options = buildLoggerOptions({
      nodeEnv: "test",
      host: "127.0.0.1",
      port: 8787,
      logLevel: "info",
      databaseUrl: "mysql://agent_light:agent_light@127.0.0.1:3306/agent_light",
      accessTokenSecret: "a".repeat(32),
      refreshTokenSecret: "b".repeat(32),
      activationSigningSecret: "d".repeat(32),
    });

    expect(options.redact.paths).toEqual(
      expect.arrayContaining([
        "req.headers.authorization",
        "req.headers.cookie",
        "req.body.password",
        "req.body.verification_code",
        "req.body.activation_code",
        "req.body.refresh_token",
        "req.body.access_token",
        "req.body.token",
      ]),
    );
  });
});
