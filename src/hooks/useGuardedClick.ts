import { useCallback, useRef, useState } from "react";

export interface GuardedClickOptions {
  waitMs?: number;
  lockWhileBusy?: boolean;
}

export function useGuardedClick<T extends (...args: never[]) => void | Promise<void>>(
  handler: T,
  options: GuardedClickOptions = {},
): {
  onClick: (...args: Parameters<T>) => void;
  busy: boolean;
} {
  const { waitMs = 300, lockWhileBusy = true } = options;
  const handlerRef = useRef(handler);
  const lastClickAtRef = useRef(0);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);

  handlerRef.current = handler;

  const onClick = useCallback(
    (...args: Parameters<T>) => {
      const now = Date.now();
      if (busyRef.current || now - lastClickAtRef.current < waitMs) {
        return;
      }
      lastClickAtRef.current = now;

      const result = handlerRef.current(...args);
      if (lockWhileBusy && result instanceof Promise) {
        busyRef.current = true;
        setBusy(true);
        void result.finally(() => {
          busyRef.current = false;
          setBusy(false);
        });
      }
    },
    [waitMs, lockWhileBusy],
  );

  return { onClick, busy };
}
