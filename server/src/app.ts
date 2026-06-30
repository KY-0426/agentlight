import Fastify, {
  type FastifyError,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import { apiErrorCodeSchema } from "@agent-light/shared";
import { loadEnv, type ServerEnv } from "./config/env";
import { createDb } from "./db";
import { DrizzleAuthRepository, type AuthRepository } from "./auth/repository";
import { registerAuthRoutes } from "./auth/routes";
import { registerMvpRoutes } from "./api/routes";
import { registerActivationRoutes } from "./activation/routes";
import { registerAdminRoutes } from "./admin/routes";
import { registerWebsite } from "./website/register";

export type BuildAppOptions = {
  env?: NodeJS.ProcessEnv;
  authRepository?: AuthRepository;
};

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const env = loadEnv(options.env);
  const dbClient = options.authRepository ? undefined : createDb(env);
  const authRepository = options.authRepository ?? new DrizzleAuthRepository(dbClient!.db);
  const app = Fastify({
    logger: buildLoggerOptions(env),
  });

  if (dbClient) {
    app.addHook("onClose", async () => {
      await dbClient.pool.end();
    });
  }

  app.addHook("onRequest", async (request, reply) => {
    applyLocalCorsHeaders(request, reply);
  });
  app.options("/*", async (request, reply) => {
    applyLocalCorsHeaders(request, reply);
    return reply.status(204).send();
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    request.log.error({ err: error }, "request failed");

    const statusCode = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    const code = statusCode >= 500 ? "internal_error" : "bad_request";

    reply.status(statusCode).send({
      ok: false,
      error: {
        code: apiErrorCodeSchema.parse(code),
        message: statusCode >= 500 ? "Internal server error" : error.message,
        request_id: request.id,
      },
    });
  });

  app.get("/health", async () => healthPayload(env));
  app.get("/api/health", async () => healthPayload(env));
  await registerAuthRoutes(app, { env, repository: authRepository });
  await registerMvpRoutes(app, { env, repository: authRepository });
  await registerActivationRoutes(app, { env, repository: authRepository });
  await registerAdminRoutes(app, { env, repository: authRepository });
  await registerWebsite(app);

  return app;
}

function healthPayload(env: ServerEnv) {
  return {
    ok: true,
    service: "agent-light-server",
    environment: env.nodeEnv,
    uptime_seconds: Math.floor(process.uptime()),
  };
}

const localDesktopOrigins = new Set([
  "http://127.0.0.1:1420",
  "http://localhost:1420",
  "tauri://localhost",
  "http://tauri.localhost",
  "https://tauri.localhost",
]);

function applyLocalCorsHeaders(request: FastifyRequest, reply: FastifyReply) {
  const { origin } = request.headers;
  if (typeof origin !== "string" || !localDesktopOrigins.has(origin)) {
    return;
  }

  reply.header("Access-Control-Allow-Origin", origin);
  reply.header("Vary", "Origin");
  reply.header("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
  reply.header("Access-Control-Allow-Headers", "Authorization, Content-Type");
  reply.header("Access-Control-Max-Age", "7200");
}

export function buildLoggerOptions(env: ServerEnv) {
  return {
    level: env.logLevel,
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "req.headers['x-api-key']",
        "req.body.password",
        "req.body.verification_code",
        "req.body.activation_code",
        "req.body.refresh_token",
        "req.body.access_token",
        "req.body.token",
        "req.body.phone_number",
        "res.headers['set-cookie']",
      ],
      censor: "[redacted]",
    },
  };
}
