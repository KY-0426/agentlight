import { z } from "zod";

const devAccessTokenSecret = "dev-access-token-secret-change-before-production";
const devRefreshTokenSecret = "dev-refresh-token-secret-change-before-production";
const devActivationSigningSecret = "dev-activation-signing-secret-change-before-production";

const rawEnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    HOST: z.string().min(1).default("127.0.0.1"),
    PORT: z.coerce.number().int().min(1).max(65535).default(8787),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
    DATABASE_URL: z
      .string()
      .url()
      .default("mysql://agent_light:agent_light@127.0.0.1:3306/agent_light"),
    ACCESS_TOKEN_SECRET: z.string().min(32).optional(),
    REFRESH_TOKEN_SECRET: z.string().min(32).optional(),
    ACTIVATION_SIGNING_SECRET: z.string().min(32).optional(),
  })
  .superRefine((env, context) => {
    if (env.NODE_ENV !== "production") {
      return;
    }

    if (!env.ACCESS_TOKEN_SECRET) {
      context.addIssue({
        code: "custom",
        path: ["ACCESS_TOKEN_SECRET"],
        message: "ACCESS_TOKEN_SECRET is required in production",
      });
    }

    if (!env.REFRESH_TOKEN_SECRET) {
      context.addIssue({
        code: "custom",
        path: ["REFRESH_TOKEN_SECRET"],
        message: "REFRESH_TOKEN_SECRET is required in production",
      });
    }

    if (!env.ACTIVATION_SIGNING_SECRET) {
      context.addIssue({
        code: "custom",
        path: ["ACTIVATION_SIGNING_SECRET"],
        message: "ACTIVATION_SIGNING_SECRET is required in production",
      });
    }
  });

export type ServerEnv = {
  nodeEnv: "development" | "test" | "production";
  host: string;
  port: number;
  logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";
  databaseUrl: string;
  accessTokenSecret: string;
  refreshTokenSecret: string;
  activationSigningSecret: string;
};

export function loadEnv(input: NodeJS.ProcessEnv = process.env): ServerEnv {
  const env = rawEnvSchema.parse(input);

  return {
    nodeEnv: env.NODE_ENV,
    host: env.HOST,
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
    databaseUrl: env.DATABASE_URL,
    accessTokenSecret: env.ACCESS_TOKEN_SECRET ?? devAccessTokenSecret,
    refreshTokenSecret: env.REFRESH_TOKEN_SECRET ?? devRefreshTokenSecret,
    activationSigningSecret: env.ACTIVATION_SIGNING_SECRET ?? devActivationSigningSecret,
  };
}
