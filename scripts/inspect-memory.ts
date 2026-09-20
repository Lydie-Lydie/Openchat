import "dotenv/config";
import { loadConfig } from "../src/config.js";
import { createLogger } from "../src/logger.js";
import { openDatabase } from "../src/db/index.js";
import { getStyleProfile, messageStats, selfMessageCount } from "../src/db/queries.js";
import { selectStyleSamples } from "../src/memory/samples.js";
import { isChatLike } from "../src/safety/filters.js";
import { selfMessageSample } from "../src/db/queries.js";

const config = loadConfig();
const db = openDatabase(config.runtime.dbPath, createLogger("error", "test"));

const guildIds = config.discord.styleGuildIds;
const channelIds = config.discord.styleChannelIds;
const scope = { guildIds, channelIds };
const stats = messageStats(db);
const pool = selfMessageSample(db, 2000, undefined, scope);
const chatLike = pool.filter((m) => isChatLike(m));
const samples = selectStyleSamples(db, 20, scope);
const profile = getStyleProfile(db, "global", "self");

process.stdout.write(`style guilds: ${JSON.stringify(guildIds)}\n`);
process.stdout.write(`style channels: ${JSON.stringify(channelIds)}\n`);
process.stdout.write(`self messages (all): ${selfMessageCount(db)}\n`);
process.stdout.write(`self messages (in scope): ${selfMessageCount(db, scope)}\n`);
process.stdout.write(`stats: ${JSON.stringify(stats)}\n`);
process.stdout.write(
  `chat-like in random pool of ${pool.length}: ${chatLike.length} (${((chatLike.length / Math.max(pool.length, 1)) * 100).toFixed(1)}%)\n`,
);
process.stdout.write(`\n--- style samples used (${samples.length}) ---\n`);
process.stdout.write(samples.map((s) => `  - ${s}`).join("\n"));
process.stdout.write("\n\n--- style profile ---\n");
process.stdout.write(`${profile?.summary ?? "(none)"}\n`);

db.close();
