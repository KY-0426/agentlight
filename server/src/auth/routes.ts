import { randomInt } from "node:crypto";
import type { FastifyInstance } from "fastify";
import {
  authSessionResponseSchema,
  loginRequestSchema,
  meResponseSchema,
  refreshRequestSchema,
  registerRequestSchema,
  sendPhoneVerificationCodeRequestSchema,
  sendPhoneVerificationCodeResponseSchema,
  updateProfileRequestSchema,
  updateProfileResponseSchema,
  verifyPhoneLoginRequestSchema,
} from "@agent-light/shared";
import { createOpaqueToken, hashOpaqueValue, hashPassword, verifyPassword } from "./crypto";
import { issueTokenPair } from "./tokens";
import { AuthRepositoryError, type AuthRepository } from "./repository";
import { authenticate, sendError, toUserDto, toWorkspaceDtos } from "./http";
import type { ServerEnv } from "../config/env";

export type AuthRoutesOptions = {
  env: ServerEnv;
  repository: AuthRepository;
};

export async function registerAuthRoutes(app: FastifyInstance, options: AuthRoutesOptions): Promise<void> {
  const { env, repository } = options;

  app.post("/api/auth/phone/send-code", async (request, reply) => {
    const parsed = sendPhoneVerificationCodeRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, "validation_failed", "Invalid phone verification payload");
    }

    const phoneNumber = normalizePhoneNumber(parsed.data.phone_number);
    const verificationCode = createVerificationCode();
    const expiresInSeconds = 600;
    await repository.createPhoneVerificationCode({
      phoneNumber,
      codeHash: hashPhoneVerificationCode(phoneNumber, verificationCode),
      purpose: "register",
      expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
    });

    const response = sendPhoneVerificationCodeResponseSchema.parse({
      phone_number: phoneNumber,
      expires_in_seconds: expiresInSeconds,
      delivery: "dev",
      dev_code: env.nodeEnv === "production" ? undefined : verificationCode,
    });

    return reply.send({ ok: true, data: response });
  });

  app.post("/api/auth/phone/verify", async (request, reply) => {
    const parsed = verifyPhoneLoginRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, "validation_failed", "Invalid phone login payload");
    }

    const phoneNumber = normalizePhoneNumber(parsed.data.phone_number);
    const verificationCode = parsed.data.verification_code.trim();

    try {
      await repository.consumePhoneVerificationCode({
        phoneNumber,
        codeHash: hashPhoneVerificationCode(phoneNumber, verificationCode),
        purpose: "register",
        now: new Date(),
      });

      const identity = await repository.registerOrLoginWithPhone({
        phoneNumber,
        passwordHash: await hashPassword(createOpaqueToken()),
        displayName: parsed.data.display_name?.trim() || defaultPhoneDisplayName(phoneNumber),
      });
      if (identity.user.disabledAt) {
        return sendError(reply, 401, "unauthorized", "User is disabled");
      }

      const tokens = await issueTokenPair(identity.user.id, repository, env);
      const response = authSessionResponseSchema.parse({
        ...tokens,
        user: toUserDto(identity.user),
        workspaces: toWorkspaceDtos(identity.workspaces),
      });

      return reply.status(identity.created ? 201 : 200).send({ ok: true, data: response });
    } catch (error) {
      if (error instanceof AuthRepositoryError) {
        return sendError(reply, error.statusCode, error.code, error.message);
      }

      throw error;
    }
  });

  app.post("/api/auth/register", async (request, reply) => {
    const parsed = registerRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, "validation_failed", "Invalid registration payload");
    }

    const email = parsed.data.email.toLowerCase();
    const passwordHash = await hashPassword(parsed.data.password);

    try {
      const identity = await repository.registerWithInvite({
        inviteCodeHash: hashOpaqueValue(parsed.data.invite_code),
        email,
        passwordHash,
        displayName: parsed.data.display_name,
      });
      const tokens = await issueTokenPair(identity.user.id, repository, env);
      const response = authSessionResponseSchema.parse({
        ...tokens,
        user: toUserDto(identity.user),
        workspaces: toWorkspaceDtos(identity.workspaces),
      });

      return reply.status(201).send({ ok: true, data: response });
    } catch (error) {
      if (error instanceof AuthRepositoryError) {
        return sendError(reply, error.statusCode, error.code, error.message);
      }

      throw error;
    }
  });

  app.post("/api/auth/login", async (request, reply) => {
    const parsed = loginRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, "validation_failed", "Invalid login payload");
    }

    const user = await repository.findUserByEmail(parsed.data.email.toLowerCase());
    if (!user || user.disabledAt || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
      return sendError(reply, 401, "unauthorized", "Invalid email or password");
    }

    const memberships = await repository.listMemberships(user.id);
    const tokens = await issueTokenPair(user.id, repository, env);
    const response = authSessionResponseSchema.parse({
      ...tokens,
      user: toUserDto(user),
      workspaces: toWorkspaceDtos(memberships),
    });

    return reply.send({ ok: true, data: response });
  });

  app.post("/api/auth/refresh", async (request, reply) => {
    const parsed = refreshRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, "validation_failed", "Invalid refresh payload");
    }

    const tokenHash = hashOpaqueValue(parsed.data.refresh_token);
    const token = await repository.findRefreshToken(tokenHash);
    if (!token || token.revokedAt || token.expiresAt <= new Date()) {
      return sendError(reply, 401, "unauthorized", "Invalid refresh token");
    }

    const user = await repository.findUserById(token.userId);
    if (!user || user.disabledAt) {
      return sendError(reply, 401, "unauthorized", "Invalid refresh token");
    }

    await repository.revokeRefreshToken(token.id);
    const tokens = await issueTokenPair(user.id, repository, env);

    return reply.send({ ok: true, data: tokens });
  });

  app.get("/api/me", async (request, reply) => {
    const user = await authenticate(request, reply, env, repository);
    if (!user) {
      return reply;
    }

    const memberships = await repository.listMemberships(user.id);
    const response = meResponseSchema.parse({
      user: toUserDto(user),
      workspaces: toWorkspaceDtos(memberships),
    });

    return reply.send({ ok: true, data: response });
  });

  app.patch("/api/me", async (request, reply) => {
    const user = await authenticate(request, reply, env, repository);
    if (!user) {
      return reply;
    }

    const parsed = updateProfileRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, "validation_failed", "Invalid profile update payload");
    }

    try {
      const updated = await repository.updateUserDisplayName(user.id, parsed.data.display_name);
      const response = updateProfileResponseSchema.parse({
        user: toUserDto(updated),
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

function normalizePhoneNumber(phoneNumber: string): string {
  return phoneNumber.trim();
}

function createVerificationCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

function hashPhoneVerificationCode(phoneNumber: string, verificationCode: string): string {
  return hashOpaqueValue(`${phoneNumber}:register:${verificationCode}`);
}

function defaultPhoneDisplayName(phoneNumber: string): string {
  return `用户 ${phoneNumber.slice(-4)}`;
}
