import type { Guild } from "discord.js";

export type EmojiInfo = {
  readonly name: string;
  readonly id: string;
  readonly animated: boolean;
  readonly token: string;
};

const CUSTOM_EMOJI_PATTERN = /<(a?):([A-Za-z0-9_]+):(\d+)>/gu;

export const toEmojiToken = (name: string, id: string, animated: boolean): string =>
  animated ? `<a:${name}:${id}>` : `<:${name}:${id}>`;

export const collectGuildEmojis = (guild: Guild, max: number): EmojiInfo[] => {
  const emojis = [...guild.emojis.cache.values()].filter((emoji) => emoji.name);
  return emojis.slice(0, max).map((emoji) => {
    const name = emoji.name as string;
    const animated = emoji.animated ?? false;
    return { name, id: emoji.id, animated, token: toEmojiToken(name, emoji.id, animated) };
  });
};

export const emojiTokenSet = (emojis: readonly EmojiInfo[]): Set<string> =>
  new Set(emojis.map((emoji) => emoji.token));

export const sanitizeCustomEmojis = (
  text: string,
  allowed: ReadonlySet<string> | undefined,
): string => {
  const cleaned = text.replace(CUSTOM_EMOJI_PATTERN, (match) =>
    allowed && allowed.has(match) ? match : "",
  );
  return cleaned.replace(/[ \t]{2,}/gu, " ").trim();
};

export const formatEmojiList = (emojis: readonly EmojiInfo[]): string =>
  emojis.map((emoji) => `${emoji.token} ${emoji.name}`).join("\n");
