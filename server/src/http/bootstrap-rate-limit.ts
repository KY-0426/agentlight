const BOOTSTRAP_LIMIT = 20;
const BOOTSTRAP_WINDOW_MS = 60_000;

const attemptsByKey = new Map<string, number[]>();

export function isBootstrapRateLimited(clientKey: string): boolean {
  const now = Date.now();
  const recent = (attemptsByKey.get(clientKey) ?? []).filter(
    (timestamp) => now - timestamp < BOOTSTRAP_WINDOW_MS,
  );

  if (recent.length >= BOOTSTRAP_LIMIT) {
    attemptsByKey.set(clientKey, recent);
    return true;
  }

  recent.push(now);
  attemptsByKey.set(clientKey, recent);
  return false;
}

export function resetBootstrapRateLimitForTests(): void {
  attemptsByKey.clear();
}
