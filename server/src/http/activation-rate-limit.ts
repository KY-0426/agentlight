const ACTIVATION_LIMIT = 30;
const ACTIVATION_WINDOW_MS = 60_000;

const attemptsByKey = new Map<string, number[]>();

export function isActivationRateLimited(clientKey: string): boolean {
  const now = Date.now();
  const recent = (attemptsByKey.get(clientKey) ?? []).filter(
    (timestamp) => now - timestamp < ACTIVATION_WINDOW_MS,
  );

  if (recent.length >= ACTIVATION_LIMIT) {
    attemptsByKey.set(clientKey, recent);
    return true;
  }

  recent.push(now);
  attemptsByKey.set(clientKey, recent);
  return false;
}

export function resetActivationRateLimitForTests(): void {
  attemptsByKey.clear();
}
