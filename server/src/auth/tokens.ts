import { createHmac, timingSafeEqual } from "node:crypto";
import { createOpaqueToken, hashOpaqueValue } from "./crypto";
import type { AuthRepository } from "./repository";
import type { ServerEnv } from "../config/env";

const accessTokenTtlSeconds = 15 * 60;
const refreshTokenTtlMs = 30 * 24 * 60 * 60 * 1000;

export type AccessTokenPayload = {
  typ: "access";
  sub: string;
  iat: number;
  exp: number;
};

export async function issueTokenPair(userId: string, repository: AuthRepository, env: ServerEnv) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const accessPayload: AccessTokenPayload = {
    typ: "access",
    sub: userId,
    iat: nowSeconds,
    exp: nowSeconds + accessTokenTtlSeconds,
  };
  const refreshToken = createOpaqueToken();
  await repository.createRefreshToken({
    userId,
    tokenHash: hashOpaqueValue(refreshToken),
    expiresAt: new Date(Date.now() + refreshTokenTtlMs),
  });

  return {
    access_token: signAccessToken(accessPayload, env.accessTokenSecret),
    refresh_token: refreshToken,
    expires_in_seconds: accessTokenTtlSeconds,
  };
}

export function signAccessToken(payload: AccessTokenPayload, secret: string): string {
  const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64UrlEncode(JSON.stringify(payload));
  const signature = sign(`${header}.${body}`, secret);
  return `${header}.${body}.${signature}`;
}

export function verifyAccessToken(token: string, secret: string): AccessTokenPayload | undefined {
  const [header, body, signature] = token.split(".");
  if (!header || !body || !signature) {
    return undefined;
  }

  const expected = sign(`${header}.${body}`, secret);
  if (!safeEqual(signature, expected)) {
    return undefined;
  }

  let payload: AccessTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as AccessTokenPayload;
  } catch {
    return undefined;
  }
  if (payload.typ !== "access" || !payload.sub || payload.exp <= Math.floor(Date.now() / 1000)) {
    return undefined;
  }

  return payload;
}

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}
