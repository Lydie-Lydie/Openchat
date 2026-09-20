import { describe, expect, it } from "vitest";
import { createRateLimiter } from "../../src/safety/rate-limit.js";

describe("createRateLimiter", () => {
  it("allows up to the limit within a window", () => {
    const current = 0;
    const limiter = createRateLimiter(() => current);
    expect(limiter.tryConsume("a", 2, 1000)).toBe(true);
    expect(limiter.tryConsume("a", 2, 1000)).toBe(true);
    expect(limiter.tryConsume("a", 2, 1000)).toBe(false);
  });

  it("resets after the window", () => {
    let current = 0;
    const limiter = createRateLimiter(() => current);
    expect(limiter.tryConsume("a", 1, 1000)).toBe(true);
    expect(limiter.tryConsume("a", 1, 1000)).toBe(false);
    current = 1001;
    expect(limiter.tryConsume("a", 1, 1000)).toBe(true);
  });

  it("tracks keys independently", () => {
    const limiter = createRateLimiter();
    expect(limiter.tryConsume("a", 1, 1000)).toBe(true);
    expect(limiter.tryConsume("b", 1, 1000)).toBe(true);
  });
});
