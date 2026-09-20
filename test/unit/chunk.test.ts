import { describe, expect, it } from "vitest";
import { chunkMessage } from "../../src/discord/chunk.js";

describe("chunkMessage", () => {
  it("returns empty array for blank text", () => {
    expect(chunkMessage("   ")).toEqual([]);
  });

  it("keeps short text intact", () => {
    expect(chunkMessage("안녕")).toEqual(["안녕"]);
  });

  it("splits long text under the limit", () => {
    const text = `${"가나다라마".repeat(600)}`;
    const chunks = chunkMessage(text, 2000);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(2000);
    }
    expect(chunks.join("")).toBe(text);
  });

  it("prefers newline boundaries", () => {
    const text = `${"a".repeat(1500)}\n\n${"b".repeat(1000)}`;
    const chunks = chunkMessage(text, 2000);
    expect(chunks[0]?.endsWith("a")).toBe(true);
    expect(chunks[1]?.startsWith("b")).toBe(true);
  });
});
