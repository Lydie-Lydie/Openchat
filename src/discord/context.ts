import {
  ChannelType,
  type Channel,
  type ForumChannel,
  type Message,
  type TextBasedChannel,
} from "discord.js";
import type { ContextMessage } from "../opencode/prompts.js";
import { formatClock } from "../util/time.js";

export type NameResolver = (message: Message) => string;
export type ReactionResolver = (messageId: string) => string | undefined;

const emojiTokenOf = (emoji: {
  id: string | null;
  name: string | null;
  animated?: boolean | null;
}): string => {
  if (emoji.id) {
    return emoji.animated ? `<a:${emoji.name}:${emoji.id}>` : `<:${emoji.name}:${emoji.id}>`;
  }
  return emoji.name ?? "?";
};

/** Count-only summary from the REST payload, used when the gateway cache has nothing. */
const fallbackReactions = (message: Message): string | undefined => {
  const cache = message.reactions?.cache;
  if (!cache || cache.size === 0) return undefined;
  return [...cache.values()]
    .map((reaction) => `${emojiTokenOf(reaction.emoji)}×${reaction.count}`)
    .join(" ");
};

export const toContextMessage = (
  message: Message,
  nameOf?: NameResolver,
  reactionsOf?: ReactionResolver,
): ContextMessage => {
  const reactions = reactionsOf?.(message.id) ?? fallbackReactions(message);
  return {
    author: nameOf ? nameOf(message) : message.author.username,
    content: message.content.replace(/\s+/gu, " ").trim(),
    at: formatClock(message.createdAt),
    ...(reactions ? { reactions } : {}),
  };
};

export const isForumLike = (channel: Channel): boolean =>
  channel.type === ChannelType.GuildForum || channel.type === ChannelType.GuildMedia;

const fetchForumMessages = async (channel: Channel, limit: number): Promise<Message[]> => {
  const forum = channel as ForumChannel;
  const active = await forum.threads.fetchActive().catch(() => null);
  if (!active) return [];
  const all: Message[] = [];
  for (const thread of active.threads.values()) {
    const batch = await thread.messages.fetch({ limit }).catch(() => null);
    if (batch) all.push(...batch.values());
  }
  all.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  return all.slice(-limit);
};

export const fetchRecentContext = async (
  channel: Channel,
  limit: number,
  nameOf?: NameResolver,
  excludeAuthorId?: string,
  reactionsOf?: ReactionResolver,
): Promise<ContextMessage[]> => {
  let raw: Message[];
  if (isForumLike(channel)) {
    raw = await fetchForumMessages(channel, limit);
  } else if ("messages" in channel && typeof (channel as TextBasedChannel).messages?.fetch === "function") {
    const fetched = await (channel as TextBasedChannel).messages.fetch({ limit });
    raw = [...fetched.values()];
  } else {
    return [];
  }

  return raw
    .filter((message) => message.content.trim().length > 0)
    .filter((message) => (excludeAuthorId ? message.author.id !== excludeAuthorId : true))
    .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
    .map((message) => toContextMessage(message, nameOf, reactionsOf));
};
