import { describe, expect, it } from "vitest";
import { extractJson } from "../../src/opencode/json.js";

describe("extractJson", () => {
  it("parses a plain object", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("parses fenced json", () => {
    const text = 'Here you go:\n```json\n{"should_send": true, "message": "ㅇㅇ"}\n```';
    expect(extractJson(text)).toEqual({ should_send: true, message: "ㅇㅇ" });
  });

  it("extracts object embedded in prose", () => {
    expect(extractJson('decision: {"ok": false} thanks')).toEqual({ ok: false });
  });

  it("handles braces inside strings", () => {
    expect(extractJson('{"text": "a } b { c", "n": 2}')).toEqual({
      text: "a } b { c",
      n: 2,
    });
  });

  it("returns undefined for invalid json", () => {
    expect(extractJson("no json here")).toBeUndefined();
    expect(extractJson("{not valid}")).toBeUndefined();
  });
});
