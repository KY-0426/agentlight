import type { FastifyInstance } from "fastify";
import { activateClientRequestSchema, activateClientResponseSchema } from "@agent-light/shared";
import { hashOpaqueValue } from "../auth/crypto";
import { sendError } from "../auth/http";
import { AuthRepositoryError, type AuthRepository } from "../auth/repository";
import type { ServerEnv } from "../config/env";
import { isActivationRateLimited } from "../http/activation-rate-limit";
import { signActivationReceipt } from "./receipt";

export type ActivationRoutesOptions = {
  env: ServerEnv;
  repository: AuthRepository;
};

export async function registerActivationRoutes(
  app: FastifyInstance,
  options: ActivationRoutesOptions,
): Promise<void> {
  const { env, repository } = options;

  app.post("/api/activation/activate", async (request, reply) => {
    const clientKey = request.ip || "unknown";
    if (isActivationRateLimited(clientKey)) {
      return sendError(reply, 429, "rate_limited", "Too many activation attempts, try again later");
    }

    const parsed = activateClientRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, "validation_failed", "Invalid activation payload");
    }

    try {
      const result = await repository.activateClient({
        activationCodeHash: hashOpaqueValue(parsed.data.activation_code),
        installationId: parsed.data.installation_id,
        platform: parsed.data.platform,
        appVersion: parsed.data.app_version,
      });

      const activatedAt = result.activatedAt.toISOString();
      const receipt = signActivationReceipt(env.activationSigningSecret, {
        activationId: result.activationId,
        installationId: result.installationId,
        activatedAt,
      });

      const response = activateClientResponseSchema.parse({
        activation_id: result.activationId,
        installation_id: result.installationId,
        activated_at: activatedAt,
        receipt,
      });

      return reply.send({ ok: true, data: response });
    } catch (error) {
      if (error instanceof AuthRepositoryError) {
        return sendError(reply, error.statusCode, error.code, error.message);
      }

      throw error;
    }
  });
}
