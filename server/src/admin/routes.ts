import type { FastifyInstance } from "fastify";
import {
  activationCodeDtoSchema,
  adminLoginRequestSchema,
  adminLoginResponseSchema,
  createActivationCodesRequestSchema,
  createActivationCodesResponseSchema,
  listActivationCodesQuerySchema,
  listActivationCodesResponseSchema,
} from "@agent-light/shared";
import { sendError } from "../auth/http";
import { verifyPassword } from "../auth/crypto";
import { AuthRepositoryError, type ActivationCodeRecord, type AuthRepository } from "../auth/repository";
import type { ServerEnv } from "../config/env";
import { authenticateAdmin } from "./auth";
import type { AdminRepository } from "./repository";
import { issueAdminAccessToken } from "./tokens";

export type AdminRoutesOptions = {
  env: ServerEnv;
  repository: AuthRepository;
  adminRepository: AdminRepository;
};

export async function registerAdminRoutes(app: FastifyInstance, options: AdminRoutesOptions): Promise<void> {
  const { env, repository, adminRepository } = options;

  app.post("/api/admin/login", async (request, reply) => {
    const parsed = adminLoginRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, "validation_failed", "Invalid admin login payload");
    }

    const admin = await adminRepository.findAdminByUsername(parsed.data.username);
    if (!admin || admin.disabledAt || !(await verifyPassword(parsed.data.password, admin.passwordHash))) {
      return sendError(reply, 401, "admin_unauthorized", "Invalid username or password");
    }

    const token = issueAdminAccessToken(admin.id, env);
    const response = adminLoginResponseSchema.parse({
      ...token,
      username: admin.username,
      display_name: admin.displayName,
    });

    return reply.send({ ok: true, data: response });
  });

  app.post("/api/admin/activation-codes", async (request, reply) => {
    if (!(await authenticateAdmin(request, reply, env, adminRepository))) {
      return reply;
    }

    const parsed = createActivationCodesRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, "validation_failed", "Invalid activation code creation payload");
    }

    const expiresAt =
      parsed.data.expires_in_days !== undefined
        ? new Date(Date.now() + parsed.data.expires_in_days * 24 * 60 * 60 * 1000)
        : null;

    const created = await repository.createActivationCodes({
      count: parsed.data.count,
      expiresAt,
      label: parsed.data.label ?? null,
    });

    const response = createActivationCodesResponseSchema.parse({
      codes: created.codes,
    });

    return reply.status(201).send({ ok: true, data: response });
  });

  app.get("/api/admin/activation-codes", async (request, reply) => {
    if (!(await authenticateAdmin(request, reply, env, adminRepository))) {
      return reply;
    }

    const parsed = listActivationCodesQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return sendError(reply, 400, "validation_failed", "Invalid activation code list query");
    }

    const result = await repository.listActivationCodes(parsed.data);
    const response = listActivationCodesResponseSchema.parse({
      items: result.items.map(toActivationCodeDto),
      total: result.total,
    });

    return reply.send({ ok: true, data: response });
  });

  app.post("/api/admin/activation-codes/:id/revoke", async (request, reply) => {
    if (!(await authenticateAdmin(request, reply, env, adminRepository))) {
      return reply;
    }

    const params = request.params as { id?: string };
    if (!params.id) {
      return sendError(reply, 400, "validation_failed", "Activation code id is required");
    }

    try {
      await repository.revokeActivationCode(params.id);
      return reply.send({ ok: true, data: { revoked: true } });
    } catch (error) {
      if (error instanceof AuthRepositoryError) {
        return sendError(reply, error.statusCode, error.code, error.message);
      }

      throw error;
    }
  });
}

function toActivationCodeDto(record: ActivationCodeRecord) {
  return activationCodeDtoSchema.parse({
    id: record.id,
    status: record.status,
    label: record.label,
    expires_at: record.expiresAt?.toISOString() ?? null,
    used_at: record.usedAt?.toISOString() ?? null,
    activated_installation_id: record.activatedInstallationId,
    activated_platform: record.activatedPlatform,
    activated_app_version: record.activatedAppVersion,
    created_at: record.createdAt.toISOString(),
  });
}
