import { describe, expect, it } from "vitest";
import { openDatabase } from "../../src/db/index.js";
import {
  countSpontaneousToday,
  getStyleProfile,
  insertGenerated,
  insertMessage,
  markMessageDeleted,
  messageStats,
  pruneMessages,
  recentMessages,
  searchMessages,
  selfMessageCount,
  selfMessageFirstLines,
  selfMessageSample,
  upsertStyleProfile,
} from "../../src/db/queries.js";
import { selectStyleSamples } from "../../src/memory/samples.js";
import type { MessageInput } from "../../src/db/queries.js";

const message = (overrides: Partial<MessageInput> & { id: string }): MessageInput => ({
  guildId: "g",
  channelId: "c1",
  threadId: null,
  authorId: "self",
  authorIsSelf: true,
  content: "내용",
  createdAt: Date.now(),
  source: "live",
  ...overrides,
});

describe("database", () => {
  it("applies migrations and searches with trigram and like fallback", () => {
    const db = openDatabase(":memory:");
    insertMessage(db, message({ id: "1", content: "오늘 날씨 진짜 좋다" }));
    insertMessage(db, message({ id: "2", content: "내일은 비가 온다고 하네" }));
    insertMessage(
      db,
      message({ id: "3", content: "다른 사람 메시지", authorId: "other", authorIsSelf: false }),
    );

    const short = searchMessages(db, { text: "날씨", limit: 5, selfOnly: true });
    expect(short.map((r) => r.id)).toContain("1");

    const long = searchMessages(db, { text: "오늘날씨", limit: 5, selfOnly: true });
    expect(long.map((r) => r.id)).toContain("1");

    const other = searchMessages(db, { text: "다른사람", limit: 5, selfOnly: true });
    expect(other).toHaveLength(0);

    db.close();
  });

  it("excludes soft-deleted messages from search and stats", () => {
    const db = openDatabase(":memory:");
    insertMessage(db, message({ id: "1", content: "삭제될 메시지" }));
    markMessageDeleted(db, "1");
    expect(searchMessages(db, { text: "삭제될", limit: 5, selfOnly: true })).toHaveLength(0);
    expect(messageStats(db).self).toBe(0);
    db.close();
  });

  it("orders recent messages by time", () => {
    const db = openDatabase(":memory:");
    const now = Date.now();
    insertMessage(db, message({ id: "1", content: "first", createdAt: now - 2000 }));
    insertMessage(db, message({ id: "2", content: "second", createdAt: now }));
    const recent = recentMessages(db, { channelId: "c1", limit: 10 });
    expect(recent.map((r) => r.id)).toEqual(["2", "1"]);
    db.close();
  });

  it("stores style profiles with incrementing version", () => {
    const db = openDatabase(":memory:");
    upsertStyleProfile(db, {
      scope: "global",
      scopeId: "self",
      summary: "v1",
      samplesCount: 10,
      model: "m",
    });
    upsertStyleProfile(db, {
      scope: "global",
      scopeId: "self",
      summary: "v2",
      samplesCount: 20,
      model: "m",
    });
    const profile = getStyleProfile(db, "global", "self");
    expect(profile?.summary).toBe("v2");
    expect(profile?.version).toBe(2);
    db.close();
  });

  it("restricts style data to allowed guilds", () => {
    const db = openDatabase(":memory:");
    insertMessage(db, message({ id: "a", content: "우리 서버 좋아", guildId: "g1" }));
    insertMessage(db, message({ id: "b", content: "다른 서버 별로야", guildId: "g2" }));

    expect(selectStyleSamples(db, 10, { guildIds: ["g1"] })).toEqual(["우리 서버 좋아"]);
    expect(selfMessageSample(db, 10, undefined, { guildIds: ["g2"] })).toEqual([
      "다른 서버 별로야",
    ]);
    expect(selfMessageFirstLines(db, 10, { guildIds: ["g1"] })).toEqual(["우리 서버 좋아"]);
    expect(
      searchMessages(db, { text: "서버", limit: 10, selfOnly: true, guildIds: ["g1"] }).map(
        (r) => r.id,
      ),
    ).toEqual(["a"]);
    db.close();
  });

  it("restricts style data to specific channels", () => {
    const db = openDatabase(":memory:");
    insertMessage(
      db,
      message({ id: "a", content: "일반 채널 놀자", guildId: "g1", channelId: "c-general" }),
    );
    insertMessage(
      db,
      message({ id: "b", content: "테스트 좋아", guildId: "g1", channelId: "c-style-channel" }),
    );

    expect(selectStyleSamples(db, 10, { channelIds: ["c-style-channel"] })).toEqual(["테스트 좋아"]);
    expect(selfMessageCount(db, { channelIds: ["c-style-channel"] })).toBe(1);
    expect(
      searchMessages(db, {
        text: "테스트",
        limit: 10,
        selfOnly: true,
        channelIds: ["c-style-channel"],
      }).map((r) => r.id),
    ).toEqual(["b"]);
    db.close();
  });

  it("never prunes self messages but prunes others", () => {
    const db = openDatabase(":memory:");
    const old = Date.now() - 100 * 24 * 60 * 60 * 1000;
    insertMessage(db, message({ id: "self-old", content: "오래된 내 메시지", createdAt: old }));
    insertMessage(
      db,
      message({
        id: "other-old",
        content: "오래된 타인 메시지",
        authorId: "other",
        authorIsSelf: false,
        createdAt: old,
      }),
    );
    const removed = pruneMessages(db, 30);
    expect(removed).toBe(1);
    expect(selfMessageSample(db, 10)).toEqual(["오래된 내 메시지"]);
    db.close();
  });

  it("counts accepted spontaneous messages today", () => {
    const db = openDatabase(":memory:");
    insertGenerated(db, {
      channelId: "c1",
      kind: "spontaneous",
      content: "안녕",
      model: "m",
      sentMessageId: "s1",
      accepted: true,
      reason: null,
    });
    insertGenerated(db, {
      channelId: "c1",
      kind: "spontaneous",
      content: "거절",
      model: "m",
      sentMessageId: null,
      accepted: false,
      reason: "no_send",
    });
    expect(countSpontaneousToday(db, "c1")).toBe(1);
    db.close();
  });

  it("samples self messages", () => {
    const db = openDatabase(":memory:");
    insertMessage(db, message({ id: "1", content: "안녕하세요" }));
    insertMessage(
      db,
      message({ id: "2", content: "타인", authorId: "other", authorIsSelf: false }),
    );
    expect(selfMessageSample(db, 10)).toEqual(["안녕하세요"]);
    db.close();
  });

  it("never mixes other users into style samples", () => {
    const db = openDatabase(":memory:");
    insertMessage(db, message({ id: "s1", content: "내 말투야" }));
    insertMessage(
      db,
      message({ id: "o1", content: "다른 사람 말투다", authorId: "u2", authorIsSelf: false }),
    );
    insertMessage(
      db,
      message({ id: "o2", content: "또 다른 사람", authorId: "u3", authorIsSelf: false }),
    );

    const samples = selectStyleSamples(db, 20);
    expect(samples).toEqual(["내 말투야"]);

    const searched = searchMessages(db, { text: "사람", limit: 10, selfOnly: true });
    expect(searched.map((r) => r.id)).toEqual([]);

    const hints = selfMessageFirstLines(db, 50);
    expect(hints).toEqual(["내 말투야"]);
    db.close();
  });
});
