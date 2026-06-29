export function throttle<T extends (...args: never[]) => void>(
  fn: T,
  waitMs: number,
): T & { cancel: () => void } {
  let lastRunAt = 0;

  const throttled = ((...args: Parameters<T>) => {
    const now = Date.now();
    if (now - lastRunAt < waitMs) {
      return;
    }
    lastRunAt = now;
    fn(...args);
  }) as T & { cancel: () => void };

  throttled.cancel = () => {
    lastRunAt = 0;
  };

  return throttled;
}
