import { describe, expect, it } from "vitest";
import { isWithinQuietHours } from "../../src/util/time.js";

const at = (hour: number, minute = 0): Date => {
  const d = new Date(2026, 0, 1, hour, minute, 0, 0);
  return d;
};

describe("isWithinQuietHours", () => {
  const quiet = { start: "00:00", end: "08:00" };

  it("returns false when no quiet hours", () => {
    expect(isWithinQuietHours(at(3), null)).toBe(false);
  });

  it("detects inside range", () => {
    expect(isWithinQuietHours(at(3), quiet)).toBe(true);
    expect(isWithinQuietHours(at(7, 59), quiet)).toBe(true);
  });

  it("detects outside range", () => {
    expect(isWithinQuietHours(at(8), quiet)).toBe(false);
    expect(isWithinQuietHours(at(23), quiet)).toBe(false);
  });

  it("handles wrap-around range", () => {
    const wrap = { start: "23:00", end: "06:00" };
    expect(isWithinQuietHours(at(23, 30), wrap)).toBe(true);
    expect(isWithinQuietHours(at(2), wrap)).toBe(true);
    expect(isWithinQuietHours(at(12), wrap)).toBe(false);
  });
});
