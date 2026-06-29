import { describe, expect, it } from "vitest";
import { loadEnv } from "./env";

describe("loadEnv", () => {
  it("loads safe development defaults", () => {
    expect(loadEnv({}).port).toBe(8787);
  });

  it("requires auth secrets in production", () => {
    expect(() =>
      loadEnv({
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://agent_light:agent_light@127.0.0.1:5432/agent_light",
      }),
    ).toThrow();
  });

  it("accepts explicit production secrets", () => {
    const env = loadEnv({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://agent_light:agent_light@127.0.0.1:5432/agent_light",
      ACCESS_TOKEN_SECRET: "a".repeat(32),
      REFRESH_TOKEN_SECRET: "b".repeat(32),
    });

    expect(env.nodeEnv).toBe("production");
  });
});
