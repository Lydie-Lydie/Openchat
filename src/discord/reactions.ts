import type { MessageReaction, PartialMessageReaction } from "discord.js";

/**
 * In-memory reaction tracker.
 *
 * Reactions (and who reacted) are kept only in memory: they are social data about
 * other people, and this project deliberately stores only the target user's own
 * messages. Losing the cache on restart is acceptable because it is context only.
 */

const MAX_MESSAGES = 1000;
const MAX_USERS_PER_EMOJI = 6;

type EmojiUsers = Map<string, string[]>;
const messages = new Map<string, EmojiUsers>();

const touch = (messageId: string): EmojiUsers => {
  const existing = messages.get(messageId);
  if (existing) {
    messages.delete(messageId);
    messages.set(messageId, existing);
    return existing;
  }
  const created: EmojiUsers = new Map();
  messages.set(messageId, created);
  while (messages.size > MAX_MESSAGES) {
    const oldest = messages.keys().next().value;
    if (oldest === undefined) break;
    messages.delete(oldest);
  }
  return created;
};

export const reactionToken = (
  reaction: MessageReaction | PartialMessageReaction,
): string => {
  const { emoji } = reaction;
  if (emoji.id) {
    return emoji.animated
      ? `<a:${emoji.name}:${emoji.id}>`
      : `<:${emoji.name}:${emoji.id}>`;
  }
  return emoji.name ?? "?";
};

export const recordReactionAdd = (
  messageId: string,
  token: string,
  userId: string,
): void => {
  const entry = touch(messageId);
  const users = entry.get(token) ?? [];
  if (users.includes(userId)) {
    entry.set(token, users);
    return;
  }
  users.push(userId);
  entry.set(token, users);
};

export const recordReactionRemove = (
  messageId: string,
  token: string,
  userId: string,
): void => {
  const entry = messages.get(messageId);
  if (!entry) return;
  const users = entry.get(token);
  if (!users) return;
  const next = users.filter((id) => id !== userId);
  if (next.length === 0) entry.delete(token);
  else entry.set(token, next);
  if (entry.size === 0) messages.delete(messageId);
};

export const clearReactionEmoji = (messageId: string, token: string): void => {
  const entry = messages.get(messageId);
  if (!entry) return;
  entry.delete(token);
  if (entry.size === 0) messages.delete(messageId);
};

export const clearReactions = (messageId: string): void => {
  messages.delete(messageId);
};

export const formatReactionSummary = (
  messageId: string,
  userNameOf: (userId: string) => string,
): string | undefined => {
  const entry = messages.get(messageId);
  if (!entry || entry.size === 0) return undefined;
  const parts: string[] = [];
  for (const [token, users] of entry) {
    const shown = users.slice(0, MAX_USERS_PER_EMOJI).map(userNameOf).join(", ");
    const more = users.length > MAX_USERS_PER_EMOJI ? "…" : "";
    parts.push(`${token}×${users.length} (${shown}${more})`);
  }
  return parts.join(" ");
};

export const reactionCacheSize = (): number => messages.size;
