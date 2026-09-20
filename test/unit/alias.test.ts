import { describe, expect, it } from "vitest";
import { normalizeAlias } from "../../src/discord/alias.js";
import { openDatabase } from "../../src/db/index.js";
import { deleteUserAlias, getUserAlias, setUserAlias } from "../../src/db/queries.js";

describe("alias", () => {
  it("normalizes and validates aliases", () => {
    expect(normalizeAlias("  별명  ")).toEqual({ ok: true, alias: "별명" });
    expect(normalizeAlias("line\nbreak")).toEqual({ ok: true, alias: "linebreak" });
    expect(normalizeAlias("")).toMatchObject({ ok: false });
    expect(normalizeAlias("   ")).toMatchObject({ ok: false });
    expect(normalizeAlias("a".repeat(33))).toMatchObject({ ok: false });
    expect(normalizeAlias("<@123>")).toMatchObject({ ok: false });
    expect(normalizeAlias("name`code`")).toMatchObject({ ok: false });
  });

  it("stores aliases per user", () => {
    const db = openDatabase(":memory:");
    expect(getUserAlias(db, "u1")).toBeUndefined();
    setUserAlias(db, "u1", "별명");
    setUserAlias(db, "u2", "에마");
    expect(getUserAlias(db, "u1")).toBe("별명");
    expect(getUserAlias(db, "u2")).toBe("에마");
    setUserAlias(db, "u1", "새이름");
    expect(getUserAlias(db, "u1")).toBe("새이름");
    expect(deleteUserAlias(db, "u1")).toBe(1);
    expect(getUserAlias(db, "u1")).toBeUndefined();
    db.close();
  });
});
