import type { AppConfig } from "../config.js";
import type { Db } from "../db/index.js";
import type { Logger } from "../logger.js";
import type { RuntimeState } from "../state.js";
import type { OpenCodeGateway } from "../opencode/client.js";
import type { DiscordBot } from "../discord/client.js";
import { createSpontaneousGenerator, type SpontaneousOutcome } from "./generator.js";

export type Scheduler = {
  start(): void;
  stop(): void;
  runOnce(force?: boolean, channelIds?: readonly string[]): Promise<SpontaneousOutcome[]>;
};

export const startScheduler = (deps: {
  readonly config: AppConfig;
  readonly db: Db;
  readonly logger: Logger;
  readonly state: RuntimeState;
  readonly gateway: OpenCodeGateway;
  readonly discord: DiscordBot;
}): Scheduler => {
  const { config, logger, state } = deps;
  const generator = createSpontaneousGenerator(deps);

  let interval: NodeJS.Timeout | undefined;
  let initial: NodeJS.Timeout | undefined;
  let running = false;
  let stopped = false;

  const runOnce = async (
    force = false,
    channelIds?: readonly string[],
  ): Promise<SpontaneousOutcome[]> => {
    if (running || stopped) return [];
    running = true;
    state.lastTickAt = Date.now();
    try {
      return await generator.run(new Date(), force, channelIds);
    } finally {
      running = false;
    }
  };

  return {
    runOnce,

    start() {
      if (!config.spontaneous.enabled) {
        logger.info("spontaneous messaging disabled; scheduler idle");
        return;
      }
      const jitterMs = Math.floor(Math.random() * 30_000);
      initial = setTimeout(() => void runOnce(), jitterMs);
      interval = setInterval(() => void runOnce(), config.spontaneous.tickMs);
      logger.info(
        {
          tickMs: config.spontaneous.tickMs,
          channels: config.channels.spontaneousIds.length,
          dryRun: state.dryRun,
        },
        "spontaneous scheduler started",
      );
    },

    stop() {
      stopped = true;
      if (initial) clearTimeout(initial);
      if (interval) clearInterval(interval);
    },
  };
};
