import {
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  type ForumChannel,
  type Guild,
  type Message,
  type TextChannel,
  type ThreadChannel,
} from "discord.js";
import { isGuildAllowed, type AppConfig } from "../config.js";
import type { Db } from "../db/index.js";
import { getUserAlias } from "../db/queries.js";
import type { Logger } from "../logger.js";
import type { OpenCodeGateway } from "../opencode/client.js";
import type { RuntimeState } from "../state.js";
import type { RateLimiter } from "../safety/rate-limit.js";
import { createCollector } from "./collector.js";
import { createMentionHandler } from "./mention-handler.js";
import { createAdminCommands } from "./admin-commands.js";
import type { ContextMessage } from "../opencode/prompts.js";
import type { SpontaneousOutcome } from "../spontaneous/generator.js";
import { fetchRecentContext, isForumLike } from "./context.js";
import { collectGuildEmojis, type EmojiInfo } from "./emoji.js";

export type DiscordBot = {
  readonly client: Client;
  login(token: string): Promise<void>;
  destroy(): Promise<void>;
  sendMessage(channelId: string, content: string): Promise<string | null>;
  fetchContext(channelId: string, limit: number): Promise<ContextMessage[]>;
  emojiList(channelId: string): Promise<EmojiInfo[]>;
  emojiListForMessage(guildId: string | null): Promise<EmojiInfo[]>;
  refreshEmojis(): Promise<{ guildId: string; count: number }[]>;
  onReady(handler: () => Promise<void> | void): void;
};

export const createDiscordClient = (deps: {
  readonly config: AppConfig;
  readonly db: Db;
  readonly logger: Logger;
  readonly gateway: OpenCodeGateway;
  readonly state: RuntimeState;
  readonly rateLimiter: RateLimiter;
  readonly rebuildStyleProfile: (force?: boolean) => Promise<void>;
  readonly runSpontaneousOnce: (
    force?: boolean,
    channelIds?: readonly string[],
  ) => Promise<SpontaneousOutcome[]>;
}): DiscordBot => {
  const {
    config,
    db,
    logger,
    gateway,
    state,
    rateLimiter,
    rebuildStyleProfile,
    runSpontaneousOnce,
  } = deps;

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Message, Partials.Channel],
  });

  const emojiCache = new Map<string, EmojiInfo[]>();

  const loadGuildEmojis = async (guild: Guild): Promise<EmojiInfo[]> => {
    if (guild.emojis.cache.size === 0) {
      await guild.emojis.fetch().catch(() => undefined);
    }
    const list = collectGuildEmojis(guild, config.discord.emojiMax);
    emojiCache.set(guild.id, list);
    return list;
  };

  const emojisForGuild = async (
    guild: Guild | null,
    force = false,
  ): Promise<EmojiInfo[]> => {
    if (!config.discord.emojiEnabled || !guild) return [];
    if (!force) {
      const cached = emojiCache.get(guild.id);
      if (cached) return cached;
    }
    return loadGuildEmojis(guild);
  };

  const refreshEmojis = async (): Promise<
    { guildId: string; count: number }[]
  > => {
    if (!config.discord.emojiEnabled || !client.isReady()) return [];
    const guildIds =
      config.discord.allowedGuildIds.length > 0
        ? config.discord.allowedGuildIds
        : [...client.guilds.cache.keys()];
    const results: { guildId: string; count: number }[] = [];
    for (const guildId of guildIds) {
      const guild = await client.guilds.fetch(guildId).catch(() => null);
      if (!guild) continue;
      const list = await emojisForGuild(guild, true);
      results.push({ guildId, count: list.length });
    }
    return results;
  };

  const sendMessage = async (channelId: string, content: string): Promise<string | null> => {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) {
      logger.warn({ channelId }, "channel not found");
      return null;
    }
    if (isForumLike(channel)) {
      const forum = channel as ForumChannel;
      const active = await forum.threads.fetchActive().catch(() => null);
      const latest = active
        ? [...active.threads.values()].sort(
            (a, b) => (b.createdTimestamp ?? 0) - (a.createdTimestamp ?? 0),
          )[0]
        : undefined;
      if (latest) {
        const sent = await latest.send(content);
        return sent.id;
      }
      const created = await forum.threads.create({
        name: `hiro ${new Date().toISOString().slice(0, 10)}`,
        message: { content },
      });
      return created.id;
    }
    if (!channel.isTextBased() || !("send" in channel)) {
      logger.warn({ channelId }, "channel not sendable");
      return null;
    }
    const sent = await (channel as TextChannel | ThreadChannel).send(content);
    return sent.id;
  };

  const collector = createCollector({ config, db, logger });
  const mentionHandler = createMentionHandler({
    config,
    db,
    logger,
    gateway,
    rateLimiter,
    state,
    emojiProvider: emojisForGuild,
    sendToChannel: sendMessage,
  });
  const admin = createAdminCommands({
    config,
    db,
    logger,
    state,
    rebuildStyleProfile,
    runSpontaneousOnce,
    refreshEmojis,
  });

  const readyHandlers: (() => Promise<void> | void)[] = [];

  client.once(Events.ClientReady, (ready) => {
    logger.info({ user: ready.user.tag, guilds: ready.guilds.cache.size }, "discord ready");
    void (async () => {
      try {
        const emojis = await refreshEmojis();
        logger.info({ emojis }, "refreshed guild emojis");
      } catch (error) {
        logger.error({ error: String(error) }, "failed to refresh emojis");
      }
      try {
        await admin.register(client);
      } catch (error) {
        logger.error({ error: String(error) }, "failed to register commands");
      }
      for (const handler of readyHandlers) {
        await Promise.resolve(handler()).catch((error: unknown) => {
          logger.error({ error: String(error) }, "ready handler failed");
        });
      }
    })();
  });

  client.on(Events.MessageCreate, (message: Message) => {
    if (!isGuildAllowed(config, message.guildId)) return;
    collector.onMessage(message);
    void mentionHandler.handle(message).catch((error: unknown) => {
      logger.error({ error: String(error) }, "mention handler error");
    });
  });

  client.on(Events.MessageDelete, (message) => {
    if (!isGuildAllowed(config, message.guildId)) return;
    collector.onMessageDelete(message);
  });

  client.on(Events.MessageUpdate, (oldMessage, newMessage) => {
    if (!isGuildAllowed(config, newMessage.guildId)) return;
    collector.onMessageUpdate(oldMessage, newMessage);
  });

  client.on(Events.InteractionCreate, (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (!isGuildAllowed(config, interaction.guildId)) return;
    void admin.handle(interaction).catch((error: unknown) => {
      logger.error({ error: String(error) }, "admin interaction error");
    });
  });

  // When the bot is invited to a new (allowed) guild, register commands there
  // immediately instead of waiting for a restart.
  client.on(Events.GuildCreate, (guild) => {
    if (!isGuildAllowed(config, guild.id)) return;
    logger.info({ guildId: guild.id, name: guild.name }, "joined guild");
    void admin.register(client).catch((error: unknown) => {
      logger.error({ error: String(error) }, "failed to register commands on guild join");
    });
  });

  client.on(Events.Error, (error) => {
    logger.error({ error: error.message }, "discord client error");
  });

  return {
    client,

    async login(token) {
      await client.login(token);
    },

    async destroy() {
      await client.destroy();
    },

    sendMessage,

    async fetchContext(channelId, limit) {
      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (!channel) return [];
      if (!channel.isTextBased() && !isForumLike(channel)) return [];
      return fetchRecentContext(
        channel,
        limit,
        (message) => getUserAlias(db, message.author.id) ?? message.author.username,
        config.discord.appId,
      );
    },

    async emojiList(channelId) {
      const channel = await client.channels.fetch(channelId).catch(() => null);
      const guild = channel && "guild" in channel ? channel.guild : null;
      return emojisForGuild(guild);
    },

    async emojiListForMessage(guildId) {
      if (!guildId) return [];
      const guild = await client.guilds.fetch(guildId).catch(() => null);
      return emojisForGuild(guild);
    },

    refreshEmojis,

    onReady(handler) {
      readyHandlers.push(handler);
    },
  };
};
