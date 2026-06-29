import type { FastifyInstance } from "fastify";
import {
  codexThreadUsageRequestSchema,
  codexThreadUsageResponseSchema,
  deviceBootstrapRequestSchema,
  deviceBootstrapResponseSchema,
  deviceDtoSchema,
  deviceRegisterRequestSchema,
  forbiddenUsagePayloadKeys,
  hardwareBindRequestSchema,
  hardwareDeviceDtoSchema,
  leaderboardTokensQuerySchema,
  leaderboardTokensResponseSchema,
} from "@agent-light/shared";
import type { AuthRepository, DeviceRecord, HardwareDeviceRecord, LeaderboardEntryRecord, UserRecord } from "../auth/repository";
import { AuthRepositoryError } from "../auth/repository";
import { createOpaqueToken, hashPassword } from "../auth/crypto";
import { authenticate, requireWorkspaceMembership, sendError, toUserDto, toWorkspaceDtos } from "../auth/http";
import { issueTokenPair } from "../auth/tokens";
import { isBootstrapRateLimited } from "../http/bootstrap-rate-limit";
import type { ServerEnv } from "../config/env";

export type MvpRoutesOptions = {
  env: ServerEnv;
  repository: AuthRepository;
};

export async function registerMvpRoutes(app: FastifyInstance, options: MvpRoutesOptions): Promise<void> {
  const { env, repository } = options;

  app.post("/api/devices/bootstrap", async (request, reply) => {
    const clientKey = request.ip || "unknown";
    if (isBootstrapRateLimited(clientKey)) {
      return sendError(reply, 429, "rate_limited", "Too many bootstrap requests, try again later");
    }

    const parsed = deviceBootstrapRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, "validation_failed", "Invalid device bootstrap payload");
    }

    try {
      const bootstrap = await repository.bootstrapDevice({
        installationId: parsed.data.installation_id,
        platform: parsed.data.platform,
        appVersion: parsed.data.app_version,
        deviceLabel: parsed.data.device_label,
        passwordHash: await hashPassword(createOpaqueToken()),
      });
      if (bootstrap.identity.user.disabledAt) {
        return sendError(reply, 401, "unauthorized", "User is disabled");
      }

      const tokens = await issueTokenPair(bootstrap.identity.user.id, repository, env);
      const response = deviceBootstrapResponseSchema.parse({
        ...tokens,
        user: toUserDto(bootstrap.identity.user),
        workspaces: toWorkspaceDtos(bootstrap.identity.workspaces),
        device: toDeviceDto(bootstrap.device),
        created: bootstrap.created,
      });

      return reply.status(bootstrap.created ? 201 : 200).send({ ok: true, data: response });
    } catch (error) {
      if (error instanceof AuthRepositoryError) {
        return sendError(reply, error.statusCode, error.code, error.message);
      }

      throw error;
    }
  });

  app.post("/api/devices/register", async (request, reply) => {
    const user = await authenticate(request, reply, env, repository);
    if (!user) {
      return reply;
    }

    const parsed = deviceRegisterRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, "validation_failed", "Invalid device registration payload");
    }

    const membership = await requireWorkspaceMembership(reply, repository, user.id, parsed.data.workspace_id);
    if (!membership) {
      return reply;
    }

    try {
      const device = await repository.upsertDevice({
        userId: user.id,
        workspaceId: membership.workspace.id,
        installationId: parsed.data.installation_id,
        platform: parsed.data.platform,
        appVersion: parsed.data.app_version,
        deviceLabel: parsed.data.device_label,
      });
      const response = deviceDtoSchema.parse(toDeviceDto(device));

      return reply.send({ ok: true, data: response });
    } catch (error) {
      if (error instanceof AuthRepositoryError) {
        return sendError(reply, error.statusCode, error.code, error.message);
      }

      throw error;
    }
  });

  app.post("/api/hardware-devices/bind", async (request, reply) => {
    const user = await authenticate(request, reply, env, repository);
    if (!user) {
      return reply;
    }

    const parsed = hardwareBindRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, "validation_failed", "Invalid hardware bind payload");
    }

    try {
      const hardwareDevice = await repository.bindHardwareDevice({
        userId: user.id,
        deviceId: parsed.data.device_id,
        hardwareDeviceId: parsed.data.hardware_device_id,
        firmwareVersion: parsed.data.firmware_version,
        protocolVersion: parsed.data.protocol_version,
        hardwareRevision: parsed.data.hardware_revision,
      });
      const response = hardwareDeviceDtoSchema.parse(toHardwareDeviceDto(hardwareDevice));

      return reply.send({ ok: true, data: response });
    } catch (error) {
      if (error instanceof AuthRepositoryError) {
        return sendError(reply, error.statusCode, error.code, error.message);
      }

      throw error;
    }
  });

  app.post("/api/usage/codex-thread", async (request, reply) => {
    const user = await authenticate(request, reply, env, repository);
    if (!user) {
      return reply;
    }

    const forbiddenKey = findForbiddenPayloadKey(request.body);
    if (forbiddenKey) {
      return sendError(reply, 400, "validation_failed", `Usage payload includes forbidden field: ${forbiddenKey}`);
    }

    const parsed = codexThreadUsageRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, "validation_failed", "Invalid usage payload");
    }

    const membership = await requireWorkspaceMembership(reply, repository, user.id, parsed.data.workspace_id);
    if (!membership) {
      return reply;
    }

    try {
      const usage = await repository.recordCodexThreadUsage({
        userId: user.id,
        workspaceId: membership.workspace.id,
        deviceId: parsed.data.device_id,
        agentProvider: parsed.data.agent_provider,
        codexThreadId: parsed.data.codex_thread_id,
        model: parsed.data.model,
        tokensUsed: parsed.data.tokens_used,
        threadUpdatedAtMs: parsed.data.thread_updated_at_ms,
        sampledAtMs: parsed.data.sampled_at_ms,
      });
      const response = codexThreadUsageResponseSchema.parse({
        codex_thread_id: usage.codexThreadId,
        tokens_used: usage.tokensUsed,
        accepted_tokens_used: usage.acceptedTokensUsed,
        ignored_stale_value: usage.ignoredStaleValue,
      });

      return reply.send({ ok: true, data: response });
    } catch (error) {
      if (error instanceof AuthRepositoryError) {
        return sendError(reply, error.statusCode, error.code, error.message);
      }

      throw error;
    }
  });

  app.get("/api/leaderboards/tokens", async (request, reply) => {
    const parsed = leaderboardTokensQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return sendError(reply, 400, "validation_failed", "Invalid leaderboard query");
    }

    let workspaceId = parsed.data.workspace_id;
    let currentUser: UserRecord | undefined;
    if (request.headers.authorization) {
      currentUser = await authenticate(request, reply, env, repository);
      if (!currentUser) {
        return reply;
      }
    }

    if (workspaceId) {
      if (!currentUser) {
        currentUser = await authenticate(request, reply, env, repository);
      }
      if (!currentUser) {
        return reply;
      }

      const membership = await requireWorkspaceMembership(reply, repository, currentUser.id, workspaceId);
      if (!membership) {
        return reply;
      }
      workspaceId = membership.workspace.id;
    }

    const leaderboardInput = {
      agentProvider: parsed.data.agent_provider,
      workspaceId,
      fromDate: parsed.data.from ? toUsageDate(Date.parse(parsed.data.from)) : undefined,
      toDate: parsed.data.to ? toUsageDate(Date.parse(parsed.data.to)) : undefined,
    };
    const [entries, totalTokens, currentUserRank] = await Promise.all([
      repository.getTokenLeaderboard({
        ...leaderboardInput,
        limit: parsed.data.limit,
      }),
      repository.getTokenLeaderboardTotal(leaderboardInput),
      currentUser ? repository.getTokenRank({ ...leaderboardInput, userId: currentUser.id }) : Promise.resolve(null),
    ]);
    const response = leaderboardTokensResponseSchema.parse({
      scope: workspaceId ? "workspace" : "global",
      workspace_id: workspaceId ?? null,
      agent_provider: parsed.data.agent_provider,
      total_tokens: totalTokens,
      current_user_rank: currentUserRank,
      entries: entries.map(toLeaderboardEntryDto),
    });

    return reply.send({ ok: true, data: response });
  });
}

function toDeviceDto(device: DeviceRecord) {
  return {
    id: device.id,
    workspace_id: device.workspaceId,
    user_id: device.userId,
    installation_id: device.installationId,
    platform: device.platform,
    app_version: device.appVersion,
    device_label: device.deviceLabel,
    created_at: device.createdAt.toISOString(),
  };
}

function toHardwareDeviceDto(hardwareDevice: HardwareDeviceRecord) {
  return {
    id: hardwareDevice.id,
    workspace_id: hardwareDevice.workspaceId,
    device_id: hardwareDevice.deviceId,
    hardware_device_id: hardwareDevice.hardwareDeviceId,
    firmware_version: hardwareDevice.firmwareVersion,
    protocol_version: hardwareDevice.protocolVersion,
    hardware_revision: hardwareDevice.hardwareRevision,
    bound_at: hardwareDevice.boundAt.toISOString(),
  };
}

function toLeaderboardEntryDto(entry: LeaderboardEntryRecord) {
  return {
    user_id: entry.userId,
    display_name: entry.displayName,
    tokens_used: entry.tokensUsed,
    rank: entry.rank,
  };
}

function findForbiddenPayloadKey(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const match = findForbiddenPayloadKey(item);
      if (match) {
        return match;
      }
    }
    return undefined;
  }

  for (const [key, child] of Object.entries(value)) {
    if ((forbiddenUsagePayloadKeys as readonly string[]).includes(key.toLowerCase())) {
      return key;
    }

    const match = findForbiddenPayloadKey(child);
    if (match) {
      return match;
    }
  }

  return undefined;
}

function toUsageDate(value: number): string {
  return new Date(value).toISOString().slice(0, 10);
}
