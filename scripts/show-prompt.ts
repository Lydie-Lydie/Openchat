import "dotenv/config";
import { loadConfig } from "../src/config.js";
import { createLogger } from "../src/logger.js";
import { openDatabase } from "../src/db/index.js";
import { messageStats } from "../src/db/queries.js";
import { MENTION_SYSTEM, type ContextMessage } from "../src/opencode/prompts.js";
import { assembleMentionPrompt } from "../src/opencode/assemble.js";

const request = process.argv.slice(2).join(" ").trim() || "안녕 오늘 뭐해";

const config = loadConfig();
const logger = createLogger("error", "test");
const db = openDatabase(config.runtime.dbPath, logger);

const context: ContextMessage[] = [
  { author: "friend", content: "오늘 뭐해?", at: "12:00" },
  { author: "user", content: "그냥 집에 있어", at: "12:01" },
];

const assembly = assembleMentionPrompt({
  config,
  db,
  request,
  requester: "user",
  context,
});

process.stdout.write(
  [
    `stats: ${JSON.stringify(messageStats(db))}`,
    `style guilds: ${JSON.stringify(config.discord.styleGuildIds)}`,
    `style channels: ${JSON.stringify(config.discord.styleChannelIds)}`,
    `profile: ${assembly.profileVersion !== undefined ? `yes (v${assembly.profileVersion})` : "no"}`,
    `lexicon: ${assembly.hasLexicon ? "yes" : "no"}`,
    `persona: ${assembly.hasPersona ? "yes" : "no"}`,
    `style samples: ${assembly.samples.length}`,
    `conversation context: ${context.length} (실제 실행 시 Discord에서 최근 15개 조회)`,
    "",
    "========== SYSTEM ==========",
    MENTION_SYSTEM,
    "",
    "========== USER PROMPT ==========",
    assembly.prompt,
    "",
  ].join("\n"),
);

db.close();
