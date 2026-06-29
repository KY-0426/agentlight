import type { FastifyReply, FastifyRequest } from "fastify";
import type { ApiErrorCode } from "@agent-light/shared";
import { verifyAccessToken } from "./tokens";
import type { AuthRepository, UserRecord, WorkspaceMembershipRecord } from "./repository";
import type { ServerEnv } from "../config/env";

export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
  env: ServerEnv,
  repository: AuthRepository,
): Promise<UserRecord | undefined> {
  const authorization = request.headers.authorization;
  const token = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : undefined;
  if (!token) {
    sendError(reply, 401, "unauthorized", "Missing bearer token");
    return undefined;
  }

  const payload = verifyAccessToken(token, env.accessTokenSecret);
  if (!payload) {
    sendError(reply, 401, "unauthorized", "Invalid bearer token");
    return undefined;
  }

  const user = await repository.findUserById(payload.sub);
  if (!user || user.disabledAt) {
    sendError(reply, 401, "unauthorized", "Invalid bearer token");
    return undefined;
  }

  return user;
}

export function sendError(reply: FastifyReply, statusCode: number, code: ApiErrorCode, message: string) {
  return reply.status(statusCode).send({
    ok: false,
    error: {
      code,
      message,
    },
  });
}

export function toUserDto(user: UserRecord) {
  return {
    id: user.id,
    email: user.email,
    phone_number: user.phoneNumber,
    display_name: user.displayName,
    created_at: user.createdAt.toISOString(),
  };
}

export function toWorkspaceDtos(workspaces: WorkspaceMembershipRecord[]) {
  return workspaces.map((item) => ({
    workspace: {
      id: item.workspace.id,
      name: item.workspace.name,
      created_at: item.workspace.createdAt.toISOString(),
    },
    membership: {
      workspace_id: item.membership.workspaceId,
      user_id: item.membership.userId,
      role: item.membership.role,
      joined_at: item.membership.joinedAt.toISOString(),
    },
  }));
}

export async function requireWorkspaceMembership(
  reply: FastifyReply,
  repository: AuthRepository,
  userId: string,
  workspaceId?: string,
): Promise<WorkspaceMembershipRecord | undefined> {
  const memberships = await repository.listMemberships(userId);
  const membership = workspaceId ? memberships.find((item) => item.workspace.id === workspaceId) : memberships[0];
  if (!membership) {
    sendError(reply, 403, "forbidden", "Workspace access denied");
    return undefined;
  }

  return membership;
}
