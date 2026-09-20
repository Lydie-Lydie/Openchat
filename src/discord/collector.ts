import { type Message, type PartialMessage } from "discord.js";
import type { AppConfig } from "../config.js";
import type { Db } from "../db/index.js";
import type { Logger } from "../logger.js";
import {
  getChannelSettings,
  insertMessage,
  markMessageDeleted,
  updateMessageContent,
} from "../db/queries.js";

export type Collector = {
  onMessage(message: Message): void;
  onMessageDelete(message: Message | PartialMessage): void;
  onMessageUpdate(_old: Message | PartialMessage, next: Message | PartialMessage): void;
};

const isChannelEnabled = (config: AppConfig, db: Db, channelId: string): boolean => {
  const settings = getChannelSettings(db, channelId);
  if (settings?.collector_enabled === 1) return true;
  return config.channels.collectorIds.includes(channelId);
};

const isCollectable = (
  config: AppConfig,
  db: Db,
  channelId: string,
  parentId?: string | null,
): boolean => {
  if (isChannelEnabled(config, db, channelId)) return true;
  // Forum posts are threads: fall back to the parent forum channel.
  if (parentId && isChannelEnabled(config, db, parentId)) return true;
  return false;
};

export const createCollector = (deps: {
  readonly config: AppConfig;
  readonly db: Db;
  readonly logger: Logger;
}): Collector => {
  const { config, db, logger } = deps;

  return {
    onMessage(message) {
      if (message.author.bot || message.system) return;
      if (message.author.id !== config.discord.selfUserId) return;
      const parentId = (message.channel as { parentId?: string | null }).parentId ?? null;
      if (!isCollectable(config, db, message.channelId, parentId)) return;
      if (message.content.trim().length === 0) return;

      insertMessage(db, {
        id: message.id,
        guildId: message.guildId,
        channelId: message.channelId,
        threadId: message.channel.isThread() ? message.channelId : null,
        authorId: message.author.id,
        authorIsSelf: true,
        content: message.content,
        createdAt: message.createdTimestamp,
        source: "live",
      });
    },

    onMessageDelete(message) {
      if (!message.id) return;
      markMessageDeleted(db, message.id);
    },

    onMessageUpdate(_old, next) {
      const content = next.content;
      if (content === null) return;
      if (!next.editedTimestamp) return;
      updateMessageContent(db, next.id, content, next.editedTimestamp);
      logger.debug({ messageId: next.id }, "message updated");
    },
  };
};
