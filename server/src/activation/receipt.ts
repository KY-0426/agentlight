import { createHmac, timingSafeEqual } from "node:crypto";

export type ActivationReceiptPayload = {
  activationId: string;
  installationId: string;
  activatedAt: string;
};

export function signActivationReceipt(secret: string, payload: ActivationReceiptPayload): string {
  const body = `${payload.activationId}:${payload.installationId}:${payload.activatedAt}`;
  return createHmac("sha256", secret).update(body).digest("base64url");
}

export function verifyActivationReceipt(
  secret: string,
  payload: ActivationReceiptPayload,
  receipt: string,
): boolean {
  const expected = signActivationReceipt(secret, payload);
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(receipt);
  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }
  return timingSafeEqual(expectedBuffer, actualBuffer);
}
