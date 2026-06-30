import type { FastifyReply, FastifyRequest } from "fastify";
import type { ServerEnv } from "../config/env";
import { sendError } from "../auth/http";

export function authenticateAdmin(request: FastifyRequest, reply: FastifyReply, env: ServerEnv): boolean {
  const header = request.headers.authorization;
  if (typeof header !== "string" || !header.startsWith("Bearer ")) {
    sendError(reply, 401, "admin_unauthorized", "Admin authorization required");
    return false;
  }

  const token = header.slice("Bearer ".length).trim();
  if (!env.adminApiKey || token !== env.adminApiKey) {
    sendError(reply, 401, "admin_unauthorized", "Admin authorization required");
    return false;
  }

  return true;
}
