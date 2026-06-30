import type { FastifyReply, FastifyRequest } from "fastify";
import type { ServerEnv } from "../config/env";
import { sendError } from "../auth/http";
import type { AdminRepository, AdminUserRecord } from "./repository";
import { verifyAdminAccessToken } from "./tokens";

export async function authenticateAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
  env: ServerEnv,
  adminRepository: AdminRepository,
): Promise<AdminUserRecord | null> {
  const header = request.headers.authorization;
  if (typeof header !== "string" || !header.startsWith("Bearer ")) {
    sendError(reply, 401, "admin_unauthorized", "Admin authorization required");
    return null;
  }

  const token = header.slice("Bearer ".length).trim();
  const payload = verifyAdminAccessToken(token, env.accessTokenSecret);
  if (!payload) {
    sendError(reply, 401, "admin_unauthorized", "Admin authorization required");
    return null;
  }

  const admin = await adminRepository.findAdminById(payload.sub);
  if (!admin || admin.disabledAt) {
    sendError(reply, 401, "admin_unauthorized", "Admin authorization required");
    return null;
  }

  return admin;
}
