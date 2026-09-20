import { describe, expect, it } from "vitest";
import type { Guild } from "discord.js";
import {
  collectGuildEmojis,
  emojiTokenSet,
  formatEmojiList,
  sanitizeCustomEmojis,
  toEmojiToken,
  type EmojiInfo,
} from "../../src/discord/emoji.js";

const fakeGuild = (
  emojis: { name: string | null; id: string; animated?: boolean }[],
): Guild =>
  ({
    emojis: { cache: new Map(emojis.map((e) => [e.id, e])) },
  }) as unknown as Guild;

const meow: EmojiInfo = {
  name: "meow",
  id: "111222333",
  animated: false,
  token: "<:meow:111222333>",
};
const dance: EmojiInfo = {
  name: "dance",
  id: "444555666",
  animated: true,
  token: "<a:dance:444555666>",
};

describe("discord emoji helpers", () => {
  it("builds tokens for static and animated emojis", () => {
    expect(toEmojiToken("meow", "111", false)).toBe("<:meow:111>");
    expect(toEmojiToken("dance", "222", true)).toBe("<a:dance:222>");
  });

  it("formats the allowed emoji list", () => {
    expect(formatEmojiList([meow, dance])).toBe(
      "<:meow:111222333> meow\n<a:dance:444555666> dance",
    );
  });

  it("keeps allowed emojis and strips unknown ones", () => {
    const allowed = emojiTokenSet([meow]);
    expect(sanitizeCustomEmojis("안녕 <:meow:111222333>", allowed)).toBe(
      "안녕 <:meow:111222333>",
    );
    expect(sanitizeCustomEmojis("안녕 <:fake:999>", allowed)).toBe("안녕");
    expect(sanitizeCustomEmojis("안녕 <a:dance:444555666>", allowed)).toBe("안녕");
  });

  it("strips all custom emoji when the allowed set is empty", () => {
    expect(sanitizeCustomEmojis("<:meow:111222333> 반가워", new Set())).toBe("반가워");
    expect(sanitizeCustomEmojis("<:meow:111222333> 반가워", undefined)).toBe("반가워");
  });

  it("leaves normal text untouched", () => {
    expect(sanitizeCustomEmojis("그냥 평범한 문장", new Set())).toBe("그냥 평범한 문장");
  });

  it("collects guild emojis with max limit and skips unnamed", () => {
    const guild = fakeGuild([
      { name: "cat", id: "1", animated: false },
      { name: null, id: "2" },
      { name: "dog", id: "3", animated: true },
      { name: "bird", id: "4" },
    ]);
    const all = collectGuildEmojis(guild, 10);
    expect(all.map((e) => e.token)).toEqual([
      "<:cat:1>",
      "<a:dog:3>",
      "<:bird:4>",
    ]);

    const limited = collectGuildEmojis(guild, 2);
    expect(limited.map((e) => e.name)).toEqual(["cat", "dog"]);
  });

  it("returns an empty list when the guild has no emojis", () => {
    expect(collectGuildEmojis(fakeGuild([]), 30)).toEqual([]);
  });
});
