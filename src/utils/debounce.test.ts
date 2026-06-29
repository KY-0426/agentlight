import { describe, expect, it, vi } from "vitest";
import { debounce } from "./debounce";

describe("debounce", () => {
  it("delays invocation until the wait window passes", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = debounce(fn, 200);

    debounced("a");
    debounced("b");
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(199);
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("b");

    vi.useRealTimers();
  });

  it("cancel prevents a pending call", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced();
    debounced.cancel();
    vi.advanceTimersByTime(100);
    expect(fn).not.toHaveBeenCalled();

    vi.useRealTimers();
  });
});
