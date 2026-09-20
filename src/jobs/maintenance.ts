import type { AppConfig } from "../config.js";
import type { Db } from "../db/index.js";
import type { Logger } from "../logger.js";
import { pruneApiCalls, pruneGenerated, pruneMessages } from "../db/queries.js";
import { purgeSecretMessages } from "./redact.js";

const INTERVAL_MS = 6 * 60 * 60 * 1000;

export type Maintenance = {
  start(): void;
  stop(): void;
  run(): Promise<void>;
};

export const createMaintenance = (deps: {
  readonly config: AppConfig;
  readonly db: Db;
  readonly logger: Logger;
  readonly rebuildStyleProfile: () => Promise<boolean>;
  readonly refreshEmojis?: () => Promise<{ guildId: string; count: number }[]>;
}): Maintenance => {
  const { config, db, logger } = deps;
  let interval: NodeJS.Timeout | undefined;
  let running = false;

  const run = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      await deps.rebuildStyleProfile().catch((error: unknown) => {
        logger.error({ error: String(error) }, "style profile rebuild failed");
      });
      await deps
        .refreshEmojis?.()
        .then((results) => {
          if (results && results.length > 0) {
            logger.info({ emojis: results }, "refreshed guild emojis");
          }
        })
        .catch((error: unknown) => {
          logger.error({ error: String(error) }, "emoji refresh failed");
        });
      const redacted = purgeSecretMessages(db);
      const retention = config.runtime.retentionDays;
      const messages = pruneMessages(db, retention);
      const generated = pruneGenerated(db, retention);
      const apiCalls = pruneApiCalls(db, retention);
      logger.info(
        { redacted, messages, generated, apiCalls, retention },
        "pruned old data",
      );
    } finally {
      running = false;
    }
  };

  return {
    run,
    start() {
      interval = setInterval(() => void run(), INTERVAL_MS);
      void run();
      logger.info({ intervalMs: INTERVAL_MS }, "maintenance started");
    },
    stop() {
      if (interval) clearInterval(interval);
    },
  };
};
