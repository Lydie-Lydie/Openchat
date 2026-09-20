import "dotenv/config";
import { loadConfig } from "../src/config.js";
import { createLogger } from "../src/logger.js";
import { openDatabase } from "../src/db/index.js";
import { createOpenCodeGateway } from "../src/opencode/client.js";
import { MENTION_SYSTEM } from "../src/opencode/prompts.js";
import { assembleMentionPrompt } from "../src/opencode/assemble.js";
import { DISABLED_TOOLS } from "../src/opencode/tools.js";
import { Client, Events, GatewayIntentBits } from "discord.js";
import {
  collectGuildEmojis,
  emojiTokenSet,
  formatEmojiList,
  sanitizeCustomEmojis,
  type EmojiInfo,
} from "../src/discord/emoji.js";

const request =
  process.argv.slice(2).join(" ").trim() || "이번 주말에 뭐 할지 추천해줘";

const config = loadConfig();
const logger = createLogger("warn", config.runtime.nodeEnv);
const db = openDatabase(config.runtime.dbPath, logger);
const gateway = createOpenCodeGateway({
  baseUrl: config.opencode.baseUrl,
  username: config.opencode.username,
  password: config.opencode.password,
  timeoutMs: config.opencode.timeoutMs,
  logger,
});

const loadEmojis = async (): Promise<EmojiInfo[]> => {
  if (!config.discord.emojiEnabled || !config.discord.guildId) return [];
  const discord = new Client({ intents: [GatewayIntentBits.Guilds] });
  await new Promise<void>((resolve, reject) => {
    discord.once(Events.ClientReady, () => resolve());
    discord.login(config.discord.token).catch(reject);
  });
  try {
    const guild = await discord.guilds.fetch(config.discord.guildId).catch(() => null);
    if (!guild) return [];
    if (guild.emojis.cache.size === 0) {
      await guild.emojis.fetch().catch(() => undefined);
    }
    return collectGuildEmojis(guild, config.discord.emojiMax);
  } finally {
    await discord.destroy();
  }
};

const main = async (): Promise<void> => {
  const emojis = await loadEmojis();

  const assembly = assembleMentionPrompt({
    config,
    db,
    request,
    requester: "user",
    context: [{ author: "user", content: "ㅇㅇ", at: "18:00" }],
    availableEmojis: formatEmojiList(emojis),
  });

  process.stdout.write(`request: ${request}\n`);
  process.stdout.write(`profile: ${assembly.profileVersion !== undefined ? "yes" : "no"}\n`);
  process.stdout.write(`available emojis: ${emojis.length}\n`);
  process.stdout.write(
    `samples (${assembly.samples.length}):\n${assembly.samples
      .map((s) => `  - ${s}`)
      .join("\n")}\n\n`,
  );

  const result = await gateway.generate({
    model: config.opencode.models.mention,
    system: MENTION_SYSTEM,
    tools: DISABLED_TOOLS,
    prompt: assembly.prompt,
  });

  const sanitized = sanitizeCustomEmojis(result.text.trim(), emojiTokenSet(emojis));

  process.stdout.write(`latency=${result.latencyMs}ms error=${result.errorName ?? "none"}\n`);
  process.stdout.write(`reply:\n${sanitized}\n`);
  gateway.close();
  db.close();
};

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    process.stderr.write(`preview failed: ${error instanceof Error ? error.message : error}\n`);
    process.exit(1);
  });
