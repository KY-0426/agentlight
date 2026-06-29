import { describe, expect, it, vi } from "vitest";
import { throttle } from "./throttle";

describe("throttle", () => {
  it("runs immediately on the first call and ignores calls inside the wait window", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const throttled = throttle(fn, 200);

    throttled("a");
    throttled("b");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("a");

    vi.advanceTimersByTime(199);
    throttled("c");
    expect(fn).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    throttled("d");
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith("d");

    vi.useRealTimers();
  });

  it("cancel resets the wait window", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    throttled("a");
    throttled.cancel();
    throttled("b");
    expect(fn).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });
});
