import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { openDatabase } from "./db/index.js";
import { createOpenCodeGateway } from "./opencode/client.js";
import { createDiscordClient } from "./discord/client.js";
import { createRuntimeState } from "./state.js";
import { createRateLimiter } from "./safety/rate-limit.js";
import { rebuildStyleProfile } from "./memory/style-profile.js";
import { startScheduler } from "./spontaneous/scheduler.js";
import type { SpontaneousOutcome } from "./spontaneous/generator.js";
import { createMaintenance } from "./jobs/maintenance.js";

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

  const state = createRuntimeState(config.runtime.dryRun);
  const rateLimiter = createRateLimiter();
  const rebuild = (force = false): Promise<boolean> =>
    rebuildStyleProfile({ config, db, logger, gateway, force });

  const late: {
    runOnce?: (force?: boolean, channelIds?: readonly string[]) => Promise<SpontaneousOutcome[]>;
  } = {};

  const discord = createDiscordClient({
    config,
    db,
    logger,
    gateway,
    state,
    rateLimiter,
    rebuildStyleProfile: async (force) => {
      await rebuild(force);
    },
    runSpontaneousOnce: (force, channelIds) =>
      late.runOnce?.(force, channelIds) ?? Promise.resolve([]),
  });

  const maintenance = createMaintenance({
    config,
    db,
    logger,
    rebuildStyleProfile: rebuild,
    refreshEmojis: () => discord.refreshEmojis(),
  });
  const scheduler = startScheduler({ config, db, logger, state, gateway, discord });
  late.runOnce = (force) => scheduler.runOnce(force);

  gateway
    .health()
    .then((health) => logger.info(health, "opencode server healthy"))
    .catch((error: unknown) =>
      logger.warn(
        { error: String(error), baseUrl: config.opencode.baseUrl },
        "opencode server unreachable; mention replies will fail until it is up",
      ),
    );

  await discord.login(config.discord.token);

  if (config.discord.allowedGuildIds.length === 0) {
    logger.warn(
      "ALLOWED_GUILD_IDS is empty: the bot will respond in ANY server it joins. Set ALLOWED_GUILD_IDS for safety.",
    );
  }
  if (config.discord.mentionAllowedUserIds.length === 0) {
    logger.warn(
      "MENTION_ALLOWED_USER_IDS is empty: ANY user can trigger style-mimicking replies.",
    );
  }

  logger.info(
    {
      nodeEnv: config.runtime.nodeEnv,
      dryRun: state.dryRun,
      spontaneousEnabled: config.spontaneous.enabled,
      model: config.opencode.models.default,
      allowedGuilds: config.discord.allowedGuildIds.length,
      styleGuilds: config.discord.styleGuildIds.length,
      mentionAllowedUsers: config.discord.mentionAllowedUserIds.length,
      collectorChannels: config.channels.collectorIds.length,
      spontaneousChannels: config.channels.spontaneousIds.length,
    },
    "user started",
  );

  maintenance.start();
  scheduler.start();

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, "shutting down");
    scheduler.stop();
    maintenance.stop();
    gateway.close();
    await discord.destroy();
    db.close();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
};

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`fatal: ${message}\n`);
  process.exit(1);
});
