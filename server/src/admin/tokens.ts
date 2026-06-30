import { createHmac, timingSafeEqual } from "node:crypto";
import type { ServerEnv } from "../config/env";

const adminAccessTokenTtlSeconds = 8 * 60 * 60;

export type AdminAccessTokenPayload = {
  typ: "admin_access";
  sub: string;
  iat: number;
  exp: number;
};

export function issueAdminAccessToken(adminUserId: string, env: ServerEnv) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const payload: AdminAccessTokenPayload = {
    typ: "admin_access",
    sub: adminUserId,
    iat: nowSeconds,
    exp: nowSeconds + adminAccessTokenTtlSeconds,
  };

  return {
    access_token: signAdminAccessToken(payload, env.accessTokenSecret),
    expires_in_seconds: adminAccessTokenTtlSeconds,
  };
}

export function signAdminAccessToken(payload: AdminAccessTokenPayload, secret: string): string {
  const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64UrlEncode(JSON.stringify(payload));
  const signature = sign(`${header}.${body}`, secret);
  return `${header}.${body}.${signature}`;
}

export function verifyAdminAccessToken(token: string, secret: string): AdminAccessTokenPayload | undefined {
  const [header, body, signature] = token.split(".");
  if (!header || !body || !signature) {
    return undefined;
  }

  const expected = sign(`${header}.${body}`, secret);
  if (!safeEqual(signature, expected)) {
    return undefined;
  }

  let payload: AdminAccessTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as AdminAccessTokenPayload;
  } catch {
    return undefined;
  }

  if (payload.typ !== "admin_access" || !payload.sub || payload.exp <= Math.floor(Date.now() / 1000)) {
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
