import type { FastifyInstance } from "fastify";
import {
  activationCodeDtoSchema,
  adminAccountDtoSchema,
  adminEndUserDetailSchema,
  adminEndUserDtoSchema,
  adminLoginRequestSchema,
  adminLoginResponseSchema,
  createActivationCodesRequestSchema,
  createActivationCodesResponseSchema,
  createAdminAccountRequestSchema,
  listActivationCodesQuerySchema,
  listActivationCodesResponseSchema,
  listAdminAccountsQuerySchema,
  listAdminAccountsResponseSchema,
  listAdminEndUsersQuerySchema,
  listAdminEndUsersResponseSchema,
  updateAdminAccountRequestSchema,
} from "@agent-light/shared";
import { sendError } from "../auth/http";
import { hashPassword, verifyPassword } from "../auth/crypto";
import {
  AuthRepositoryError,
  type ActivationCodeRecord,
  type AdminEndUserDetailResult,
  type AdminEndUserListItem,
  type AuthRepository,
  inferAdminEndUserType,
} from "../auth/repository";
import type { ServerEnv } from "../config/env";
import { authenticateAdmin } from "./auth";
import { AdminRepositoryError, type AdminRepository, type AdminUserRecord } from "./repository";
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
    const admin = await authenticateAdmin(request, reply, env, adminRepository);
    if (!admin) {
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
    const admin = await authenticateAdmin(request, reply, env, adminRepository);
    if (!admin) {
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
    const admin = await authenticateAdmin(request, reply, env, adminRepository);
    if (!admin) {
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

  app.get("/api/admin/users", async (request, reply) => {
    const admin = await authenticateAdmin(request, reply, env, adminRepository);
    if (!admin) {
      return reply;
    }

    const parsed = listAdminEndUsersQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return sendError(reply, 400, "validation_failed", "Invalid admin user list query");
    }

    const result = await repository.listUsersForAdmin(parsed.data);
    const response = listAdminEndUsersResponseSchema.parse({
      items: result.items.map(toAdminEndUserDto),
      total: result.total,
    });

    return reply.send({ ok: true, data: response });
  });

  app.get("/api/admin/users/:id", async (request, reply) => {
    const admin = await authenticateAdmin(request, reply, env, adminRepository);
    if (!admin) {
      return reply;
    }

    const params = request.params as { id?: string };
    if (!params.id) {
      return sendError(reply, 400, "validation_failed", "User id is required");
    }

    const detail = await repository.getUserAdminDetail(params.id);
    if (!detail) {
      return sendError(reply, 404, "not_found", "User not found");
    }

    const response = adminEndUserDetailSchema.parse(toAdminEndUserDetailDto(detail));
    return reply.send({ ok: true, data: response });
  });

  app.post("/api/admin/users/:id/disable", async (request, reply) => {
    const admin = await authenticateAdmin(request, reply, env, adminRepository);
    if (!admin) {
      return reply;
    }

    const params = request.params as { id?: string };
    if (!params.id) {
      return sendError(reply, 400, "validation_failed", "User id is required");
    }

    try {
      const user = await repository.setUserDisabled(params.id, true);
      const detail = await repository.getUserAdminDetail(user.id);
      return reply.send({
        ok: true,
        data: toAdminEndUserDto({
          user,
          deviceCount: detail?.deviceCount ?? 0,
          userType: inferAdminEndUserType(user.email),
        }),
      });
    } catch (error) {
      if (error instanceof AuthRepositoryError) {
        return sendError(reply, error.statusCode, error.code, error.message);
      }

      throw error;
    }
  });

  app.post("/api/admin/users/:id/enable", async (request, reply) => {
    const admin = await authenticateAdmin(request, reply, env, adminRepository);
    if (!admin) {
      return reply;
    }

    const params = request.params as { id?: string };
    if (!params.id) {
      return sendError(reply, 400, "validation_failed", "User id is required");
    }

    try {
      const user = await repository.setUserDisabled(params.id, false);
      const detail = await repository.getUserAdminDetail(user.id);
      return reply.send({
        ok: true,
        data: toAdminEndUserDto({
          user,
          deviceCount: detail?.deviceCount ?? 0,
          userType: inferAdminEndUserType(user.email),
        }),
      });
    } catch (error) {
      if (error instanceof AuthRepositoryError) {
        return sendError(reply, error.statusCode, error.code, error.message);
      }

      throw error;
    }
  });

  app.get("/api/admin/admins", async (request, reply) => {
    const admin = await authenticateAdmin(request, reply, env, adminRepository);
    if (!admin) {
      return reply;
    }

    const parsed = listAdminAccountsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return sendError(reply, 400, "validation_failed", "Invalid admin account list query");
    }

    const result = await adminRepository.listAdmins(parsed.data);
    const response = listAdminAccountsResponseSchema.parse({
      items: result.items.map(toAdminAccountDto),
      total: result.total,
    });

    return reply.send({ ok: true, data: response });
  });

  app.post("/api/admin/admins", async (request, reply) => {
    const admin = await authenticateAdmin(request, reply, env, adminRepository);
    if (!admin) {
      return reply;
    }

    const parsed = createAdminAccountRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, "validation_failed", "Invalid admin account creation payload");
    }

    try {
      const created = await adminRepository.createAdmin({
        username: parsed.data.username,
        passwordHash: await hashPassword(parsed.data.password),
        displayName: parsed.data.display_name,
      });

      return reply.status(201).send({
        ok: true,
        data: toAdminAccountDto(created),
      });
    } catch (error) {
      if (error instanceof AdminRepositoryError) {
        return sendError(reply, error.statusCode, error.code, error.message);
      }

      throw error;
    }
  });

  app.patch("/api/admin/admins/:id", async (request, reply) => {
    const currentAdmin = await authenticateAdmin(request, reply, env, adminRepository);
    if (!currentAdmin) {
      return reply;
    }

    const params = request.params as { id?: string };
    if (!params.id) {
      return sendError(reply, 400, "validation_failed", "Admin id is required");
    }

    const parsed = updateAdminAccountRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, "validation_failed", "Invalid admin account update payload");
    }

    if (parsed.data.display_name === undefined && parsed.data.password === undefined) {
      return sendError(reply, 400, "validation_failed", "At least one field must be provided");
    }

    try {
      const updated = await adminRepository.updateAdmin(params.id, {
        displayName: parsed.data.display_name,
        passwordHash:
          parsed.data.password !== undefined ? await hashPassword(parsed.data.password) : undefined,
      });

      return reply.send({
        ok: true,
        data: toAdminAccountDto(updated),
      });
    } catch (error) {
      if (error instanceof AdminRepositoryError) {
        return sendError(reply, error.statusCode, error.code, error.message);
      }

      throw error;
    }
  });

  app.post("/api/admin/admins/:id/disable", async (request, reply) => {
    const currentAdmin = await authenticateAdmin(request, reply, env, adminRepository);
    if (!currentAdmin) {
      return reply;
    }

    const params = request.params as { id?: string };
    if (!params.id) {
      return sendError(reply, 400, "validation_failed", "Admin id is required");
    }

    if (params.id === currentAdmin.id) {
      return sendError(reply, 403, "admin_self_disable_forbidden", "Cannot disable your own admin account");
    }

    const activeCount = await adminRepository.countActiveAdmins();
    const target = await adminRepository.findAdminById(params.id);
    if (!target) {
      return sendError(reply, 404, "not_found", "Admin account not found");
    }

    if (!target.disabledAt && activeCount <= 1) {
      return sendError(reply, 403, "admin_last_account", "Cannot disable the last active admin account");
    }

    try {
      const updated = await adminRepository.setAdminDisabled(params.id, true);
      return reply.send({ ok: true, data: toAdminAccountDto(updated) });
    } catch (error) {
      if (error instanceof AdminRepositoryError) {
        return sendError(reply, error.statusCode, error.code, error.message);
      }

      throw error;
    }
  });

  app.post("/api/admin/admins/:id/enable", async (request, reply) => {
    const admin = await authenticateAdmin(request, reply, env, adminRepository);
    if (!admin) {
      return reply;
    }

    const params = request.params as { id?: string };
    if (!params.id) {
      return sendError(reply, 400, "validation_failed", "Admin id is required");
    }

    try {
      const updated = await adminRepository.setAdminDisabled(params.id, false);
      return reply.send({ ok: true, data: toAdminAccountDto(updated) });
    } catch (error) {
      if (error instanceof AdminRepositoryError) {
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
    user_id: record.userId,
    activated_installation_id: record.activatedInstallationId,
    activated_platform: record.activatedPlatform,
    activated_app_version: record.activatedAppVersion,
    created_at: record.createdAt.toISOString(),
  });
}

function toAdminEndUserDto(item: AdminEndUserListItem) {
  return adminEndUserDtoSchema.parse({
    id: item.user.id,
    email: item.user.email,
    phone_number: item.user.phoneNumber,
    display_name: item.user.displayName,
    user_type: item.userType,
    disabled_at: item.user.disabledAt?.toISOString() ?? null,
    device_count: item.deviceCount,
    created_at: item.user.createdAt.toISOString(),
  });
}

function toAdminEndUserDetailDto(detail: AdminEndUserDetailResult) {
  return {
    user: toAdminEndUserDto({
      user: detail.user,
      deviceCount: detail.deviceCount,
      userType: detail.userType,
    }),
    devices: detail.devices.map((device) => ({
      id: device.id,
      installation_id: device.installationId,
      platform: device.platform,
      app_version: device.appVersion,
      device_label: device.deviceLabel,
      last_seen_at: device.lastSeenAt?.toISOString() ?? null,
      created_at: device.createdAt.toISOString(),
    })),
    activation_code: detail.activationCode
      ? {
          id: detail.activationCode.id,
          status: detail.activationCode.status,
          label: detail.activationCode.label,
          used_at: detail.activationCode.usedAt?.toISOString() ?? null,
        }
      : null,
  };
}

function toAdminAccountDto(record: AdminUserRecord) {
  return adminAccountDtoSchema.parse({
    id: record.id,
    username: record.username,
    display_name: record.displayName,
    disabled_at: record.disabledAt?.toISOString() ?? null,
    created_at: record.createdAt.toISOString(),
  });
}
