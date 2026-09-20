import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../../src/db/index.js";
import { messageStats, selfMessageSample } from "../../src/db/queries.js";
import { importFromPath } from "../../src/jobs/import.js";
import { createLogger } from "../../src/logger.js";
import { makeConfig } from "../helpers.js";

const logger = createLogger("error", "test");
const SELF = "self";

describe("importFromPath", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "openchat-import-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("imports self messages from a json array", () => {
    const file = join(dir, "messages.json");
    writeFileSync(
      file,
      JSON.stringify([
        {
          id: "m1",
          content: "오늘 좀 피곤하네",
          timestamp: "2026-01-01T10:00:00.000Z",
          author: { id: SELF, username: "me" },
          channel_id: "c1",
        },
        {
          id: "m2",
          content: "다른 사람 메시지",
          timestamp: "2026-01-01T10:01:00.000Z",
          author: { id: "other", username: "friend" },
          channel_id: "c1",
        },
      ]),
    );

    const db = openDatabase(":memory:");
    const run = importFromPath({ config: makeConfig(), db, logger });
    const summary = run(file);

    expect(summary).toEqual({ imported: 1, skipped: 1, errors: 0 });
    expect(messageStats(db).self).toBe(1);
    expect(selfMessageSample(db, 5)).toEqual(["오늘 좀 피곤하네"]);
    db.close();
  });

  it("imports others when requested", () => {
    const file = join(dir, "messages.json");
    writeFileSync(
      file,
      JSON.stringify([
        { id: "m2", content: "타인 메시지", author: { id: "other" }, channel_id: "c1" },
      ]),
    );
    const db = openDatabase(":memory:");
    const run = importFromPath({ config: makeConfig(), db, logger, includeOthers: true });
    const summary = run(file);
    expect(summary.imported).toBe(1);
    db.close();
  });

  it("skips entries without an author id by default", () => {
    const file = join(dir, "messages.json");
    writeFileSync(
      file,
      JSON.stringify([{ id: "m1", content: "작성자 없는 메시지", channel_id: "c1" }]),
    );
    const db = openDatabase(":memory:");
    const run = importFromPath({ config: makeConfig(), db, logger });
    const summary = run(file);
    expect(summary).toEqual({ imported: 0, skipped: 1, errors: 0 });
    expect(messageStats(db).total).toBe(0);
    db.close();
  });

  it("treats author-less entries as self when explicitly allowed", () => {
    const file = join(dir, "messages.json");
    writeFileSync(
      file,
      JSON.stringify([{ id: "m1", content: "작성자 없는 메시지", channel_id: "c1" }]),
    );
    const db = openDatabase(":memory:");
    const run = importFromPath({
      config: makeConfig(),
      db,
      logger,
      assumeSelfWhenNoAuthor: true,
    });
    const summary = run(file);
    expect(summary.imported).toBe(1);
    expect(messageStats(db).self).toBe(1);
    db.close();
  });

  it("imports a discord data package directory", () => {
    const channelDir = join(dir, "messages", "123456");
    mkdirSync(channelDir, { recursive: true });
    writeFileSync(join(channelDir, "channel.json"), JSON.stringify({ id: "999" }));
    writeFileSync(
      join(channelDir, "messages.json"),
      JSON.stringify([
        {
          id: "m1",
          content: "디렉터리 임포트",
          timestamp: "2026-01-01T10:00:00.000Z",
          author: { id: SELF },
        },
      ]),
    );

    const db = openDatabase(":memory:");
    const run = importFromPath({ config: makeConfig(), db, logger });
    const summary = run(dir);
    expect(summary.imported).toBe(1);
    db.close();
  });
});
