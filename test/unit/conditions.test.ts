import { describe, expect, it } from "vitest";
import { openDatabase } from "../../src/db/index.js";
import { insertGenerated, upsertChannelSettings } from "../../src/db/queries.js";
import { evaluateConditions } from "../../src/spontaneous/conditions.js";
import { createRuntimeState } from "../../src/state.js";
import { makeConfig } from "../helpers.js";

const noon = new Date(2026, 0, 1, 12, 0, 0, 0);

describe("evaluateConditions", () => {
  it("blocks when the feature is disabled", () => {
    const db = openDatabase(":memory:");
    const result = evaluateConditions({
      config: makeConfig({ spontaneous: { ...makeConfig().spontaneous, enabled: false } }),
      db,
      state: createRuntimeState(true),
      channelId: "chan-1",
      now: noon,
    });
    expect(result).toEqual({ ok: false, reason: "feature_disabled" });
    db.close();
  });

  it("blocks when paused", () => {
    const db = openDatabase(":memory:");
    const state = createRuntimeState(true);
    state.spontaneousPaused = true;
    const result = evaluateConditions({
      config: makeConfig(),
      db,
      state,
      channelId: "chan-1",
      now: noon,
    });
    expect(result).toEqual({ ok: false, reason: "paused" });
    db.close();
  });

  it("blocks non-allowlisted channels", () => {
    const db = openDatabase(":memory:");
    const result = evaluateConditions({
      config: makeConfig(),
      db,
      state: createRuntimeState(true),
      channelId: "unknown",
      now: noon,
    });
    expect(result).toEqual({ ok: false, reason: "channel_not_allowed" });
    db.close();
  });

  it("blocks during quiet hours", () => {
    const db = openDatabase(":memory:");
    const result = evaluateConditions({
      config: makeConfig(),
      db,
      state: createRuntimeState(true),
      channelId: "chan-1",
      now: new Date(2026, 0, 1, 3, 0, 0, 0),
    });
    expect(result).toEqual({ ok: false, reason: "quiet_hours" });
    db.close();
  });

  it("blocks within the minimum interval", () => {
    const db = openDatabase(":memory:");
    upsertChannelSettings(db, "chan-1", {
      spontaneous_enabled: 1,
      last_spontaneous_at: noon.getTime() - 1000,
      min_interval_sec: 3600,
    });
    const result = evaluateConditions({
      config: makeConfig(),
      db,
      state: createRuntimeState(true),
      channelId: "chan-1",
      now: noon,
    });
    expect(result).toEqual({ ok: false, reason: "min_interval" });
    db.close();
  });

  it("blocks when the daily cap is reached", () => {
    const db = openDatabase(":memory:");
    upsertChannelSettings(db, "chan-1", { spontaneous_enabled: 1 });
    insertGenerated(db, {
      channelId: "chan-1",
      kind: "spontaneous",
      content: "이미 보냄",
      model: "m",
      sentMessageId: "s1",
      accepted: true,
      reason: null,
    });
    const result = evaluateConditions({
      config: makeConfig({
        spontaneous: { ...makeConfig().spontaneous, dailyCap: 1 },
      }),
      db,
      state: createRuntimeState(true),
      channelId: "chan-1",
      now: noon,
    });
    expect(result).toEqual({ ok: false, reason: "daily_cap" });
    db.close();
  });

  it("allows when all conditions pass", () => {
    const db = openDatabase(":memory:");
    upsertChannelSettings(db, "chan-1", { spontaneous_enabled: 1 });
    const result = evaluateConditions({
      config: makeConfig(),
      db,
      state: createRuntimeState(true),
      channelId: "chan-1",
      now: noon,
    });
    expect(result).toEqual({ ok: true });
    db.close();
  });
});
