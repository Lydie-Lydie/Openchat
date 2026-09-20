import "dotenv/config";
import {
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  type Collection,
  type Message,
  type Snowflake,
} from "discord.js";
import { loadConfig } from "../src/config.js";
import { createLogger } from "../src/logger.js";
import { openDatabase } from "../src/db/index.js";
import { insertMessage, messageStats, selfMessageCount } from "../src/db/queries.js";
import { createOpenCodeGateway } from "../src/opencode/client.js";
import { rebuildStyleProfile } from "../src/memory/style-profile.js";

const PAGES = Number(process.env.SEED_PAGES ?? 3);
const ALL_CHANNELS = /^(1|true|yes)$/i.test(process.env.SEED_ALL_CHANNELS ?? "");

type MessageFetchable = {
  id: string;
  messages: {
    fetch(options: { limit: number; before?: string }): Promise<Collection<Snowflake, Message>>;
  };
};

const main = async (): Promise<void> => {
  const config = loadConfig();
  const logger = createLogger(config.runtime.logLevel, config.runtime.nodeEnv);
  const db = openDatabase(config.runtime.dbPath, logger);
  const gateway = createOpenCodeGateway({
    baseUrl: config.opencode.baseUrl,
    username: config.opencode.username,
    password: config.opencode.password,
    timeoutMs: config.opencode.timeoutMs,
    logger,
  });

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  await new Promise<void>((resolve, reject) => {
    client.once(Events.ClientReady, () => resolve());
    client.once(Events.Error, (error) => reject(error));
    client.login(config.discord.token).catch(reject);
  });

  const seen = new Set<string>();

  const scanTarget = async (target: MessageFetchable, label: string): Promise<void> => {
    if (seen.has(target.id)) return;
    seen.add(target.id);

    let before: string | undefined;
    let imported = 0;
    let scanned = 0;

    for (let page = 0; page < PAGES; page += 1) {
      const batch = await target.messages
        .fetch({ limit: 100, ...(before ? { before } : {}) })
        .catch(() => null);
      if (!batch || batch.size === 0) break;

      for (const message of batch.values()) {
        scanned += 1;
        if (message.author.id !== config.discord.selfUserId) continue;
        if (message.content.trim().length === 0) continue;
        const channel = message.channel as { isThread?: () => boolean };
        insertMessage(db, {
          id: message.id,
          guildId: message.guildId,
          channelId: message.channelId,
          threadId: channel.isThread?.() ? message.channelId : null,
          authorId: message.author.id,
          authorIsSelf: true,
          content: message.content,
          createdAt: message.createdTimestamp,
          source: "import",
        });
        imported += 1;
      }

      before = batch.last()?.id;
      if (!before) break;
    }

    process.stdout.write(`${label} ${target.id}: scanned=${scanned} imported=${imported}\n`);
  };

  try {
    const targetIds = new Set<string>();
    if (ALL_CHANNELS) {
      for (const guild of client.guilds.cache.values()) {
        const channels = await guild.channels.fetch();
        for (const channel of channels.values()) {
          if (
            channel &&
            (channel.type === ChannelType.GuildText ||
              channel.type === ChannelType.GuildAnnouncement)
          ) {
            targetIds.add(channel.id);
          }
        }
      }
    } else {
      for (const id of config.channels.collectorIds) targetIds.add(id);
      for (const id of config.channels.spontaneousIds) targetIds.add(id);
      if (config.channels.dryRunId) targetIds.add(config.channels.dryRunId);
    }

    process.stdout.write(`channels to scan: ${targetIds.size}\n`);

    // 1) Top-level text/announcement channels.
    for (const channelId of targetIds) {
      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (
        !channel ||
        !("messages" in channel) ||
        (channel.type !== ChannelType.GuildText &&
          channel.type !== ChannelType.GuildAnnouncement)
      ) {
        process.stdout.write(`skip ${channelId} (not a usable text channel)\n`);
        continue;
      }
      await scanTarget(channel as unknown as MessageFetchable, "channel");
    }

    // 2) Threads (forum posts and text-channel threads), active and archived.
    for (const guild of client.guilds.cache.values()) {
      const active = await guild.channels.fetchActiveThreads().catch(() => null);
      for (const thread of active?.threads.values() ?? []) {
        const parentId = thread.parentId ?? "";
        if (!ALL_CHANNELS && !targetIds.has(thread.id) && !targetIds.has(parentId)) continue;
        await scanTarget(thread as unknown as MessageFetchable, "thread");
      }

      const channels = await guild.channels.fetch();
      for (const channel of channels.values()) {
        if (!channel) continue;
        const isForum =
          channel.type === ChannelType.GuildForum || channel.type === ChannelType.GuildMedia;
        const isText = channel.type === ChannelType.GuildText;
        if (!isForum && !isText) continue;
        if (!ALL_CHANNELS && !targetIds.has(channel.id)) continue;
        if (!("threads" in channel)) continue;

        const archived = await channel.threads
          .fetchArchived({ limit: 100 })
          .catch(() => null);
        for (const thread of archived?.threads.values() ?? []) {
          await scanTarget(thread as unknown as MessageFetchable, "archived");
        }
      }
    }

    process.stdout.write(`self messages in db: ${selfMessageCount(db)}\n`);
    const built = await rebuildStyleProfile({ config, db, logger, gateway, force: true });
    process.stdout.write(`style profile built: ${built}\n`);
    process.stdout.write(`stats: ${JSON.stringify(messageStats(db))}\n`);
  } finally {
    gateway.close();
    await client.destroy();
    db.close();
  }
};

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    process.stderr.write(`seed failed: ${error instanceof Error ? error.message : error}\n`);
    process.exit(1);
  });
