import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { AppConfig } from "../config.js";
import type { Db } from "../db/index.js";
import type { Logger } from "../logger.js";
import { insertMessage } from "../db/queries.js";

export type ImportSummary = {
  imported: number;
  skipped: number;
  errors: number;
};

type RawAuthor = { id?: string; name?: string; username?: string; nickname?: string };

type RawMessage = {
  id?: string;
  content?: string;
  timestamp?: string;
  author?: RawAuthor | string;
  author_id?: string;
  authorId?: string;
  channel_id?: string;
  channelId?: string;
  guild_id?: string;
  guildId?: string;
};

const emptySummary = (): ImportSummary => ({ imported: 0, skipped: 0, errors: 0 });

const addInto = (target: ImportSummary, source: ImportSummary): void => {
  target.imported += source.imported;
  target.skipped += source.skipped;
  target.errors += source.errors;
};

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

const asArray = (value: unknown): RawMessage[] => {
  if (Array.isArray(value)) return value as RawMessage[];
  if (typeof value === "object" && value !== null && "messages" in value) {
    const messages = (value as { messages: unknown }).messages;
    if (Array.isArray(messages)) return messages as RawMessage[];
  }
  return [];
};

const authorIdOf = (message: RawMessage): string | undefined => {
  if (typeof message.author === "string") return message.author;
  return message.author?.id ?? message.author_id ?? message.authorId;
};

const channelIdOf = (message: RawMessage, fallback: string | undefined): string | undefined =>
  message.channel_id ?? message.channelId ?? fallback;

export const importMessages = (deps: {
  readonly config: AppConfig;
  readonly db: Db;
  readonly logger: Logger;
  readonly includeOthers?: boolean;
  readonly assumeSelfWhenNoAuthor?: boolean;
}): ((
  raw: RawMessage[],
  defaults?: { readonly channelId?: string; readonly guildId?: string },
) => ImportSummary) => {
  const {
    config,
    db,
    logger,
    includeOthers = false,
    assumeSelfWhenNoAuthor = false,
  } = deps;

  return (raw, defaults = {}) => {
    const summary = emptySummary();

    for (const message of raw) {
      try {
        const id = message.id;
        const content = message.content;
        const channelId = channelIdOf(message, defaults.channelId);
        const authorId = authorIdOf(message);

        if (!id || typeof content !== "string" || content.trim().length === 0 || !channelId) {
          summary.skipped += 1;
          continue;
        }

        if (authorId === undefined && !assumeSelfWhenNoAuthor && !includeOthers) {
          summary.skipped += 1;
          logger.warn(
            { id },
            "skipped import entry without author id (pass --assume-self to treat as self)",
          );
          continue;
        }

        const isSelf =
          authorId === undefined ? assumeSelfWhenNoAuthor : authorId === config.discord.selfUserId;
        if (!isSelf && !includeOthers) {
          summary.skipped += 1;
          continue;
        }

        const createdAt = message.timestamp
          ? Date.parse(message.timestamp)
          : Number.NaN;

        insertMessage(db, {
          id,
          guildId: message.guild_id ?? message.guildId ?? defaults.guildId ?? null,
          channelId,
          threadId: null,
          authorId: authorId ?? (isSelf ? config.discord.selfUserId : "unknown"),
          authorIsSelf: isSelf,
          content,
          createdAt: Number.isNaN(createdAt) ? Date.now() : createdAt,
          source: "import",
        });
        summary.imported += 1;
      } catch (error) {
        summary.errors += 1;
        logger.warn({ error: String(error) }, "failed to import message");
      }
    }

    return summary;
  };
};

export const importFromPath = (deps: {
  readonly config: AppConfig;
  readonly db: Db;
  readonly logger: Logger;
  readonly includeOthers?: boolean;
  readonly assumeSelfWhenNoAuthor?: boolean;
}): ((path: string, fallbackChannelId?: string) => ImportSummary) => {
  const importRaw = importMessages(deps);
  const { logger } = deps;

  const importDirectory = (path: string): ImportSummary => {
    const summary = emptySummary();
    const messagesDir = join(path, "messages");
    const root = existsSync(messagesDir) ? messagesDir : path;

    for (const entry of readdirSync(root)) {
      const dir = join(root, entry);
      if (!statSync(dir).isDirectory()) continue;
      const messagesFile = join(dir, "messages.json");
      if (!existsSync(messagesFile)) continue;

      let channelId = entry;
      const channelFile = join(dir, "channel.json");
      if (existsSync(channelFile)) {
        const channel = readJson(channelFile) as { id?: string };
        if (channel.id) channelId = channel.id;
      }

      const raw = asArray(readJson(messagesFile));
      addInto(summary, importRaw(raw, { channelId }));
    }

    logger.info(summary, "directory import finished");
    return summary;
  };

  return (path, fallbackChannelId) => {
    if (!existsSync(path)) throw new Error(`import path not found: ${path}`);
    if (statSync(path).isDirectory()) return importDirectory(path);

    const raw = asArray(readJson(path));
    const summary = importRaw(raw, fallbackChannelId ? { channelId: fallbackChannelId } : {});
    logger.info(summary, "file import finished");
    return summary;
  };
};
