import "dotenv/config";
import { readFileSync } from "node:fs";
import { loadConfig } from "../src/config.js";
import { createLogger } from "../src/logger.js";
import { openDatabase } from "../src/db/index.js";
import { importMessages } from "../src/jobs/import.js";
import {
  deleteSelfMessages,
  deleteStyleProfile,
  getStyleProfile,
  messageStats,
  selfMessageCount,
} from "../src/db/queries.js";
import { createOpenCodeGateway } from "../src/opencode/client.js";
import { rebuildStyleProfile } from "../src/memory/style-profile.js";

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
};
const has = (name: string): boolean => argv.includes(name);

const file = flag("--file");
if (!file) {
  process.stderr.write(
    "usage: tsx scripts/inject-dialogue.ts --file <dialogue.jsonl> [--channel <id>] [--guild <id>] [--author <id>] [--wipe-self] [--reset-style] [--rebuild]\n",
  );
  process.exit(1);
}

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

  const channelId = flag("--channel") ?? "dialogue";
  const guildId = flag("--guild") ?? config.discord.styleGuildIds[0] ?? null;
  const authorId = flag("--author") ?? config.discord.selfUserId;

  const lines = readFileSync(file, "utf8")
    .split(/\r?\n/u)
    .filter((line) => line.trim().length > 0);

  const base = Date.now() - lines.length * 1000;
  const raw: Record<string, unknown>[] = [];
  let malformed = 0;

  for (let i = 0; i < lines.length; i += 1) {
    let row: Record<string, unknown>;
    try {
      row = JSON.parse(lines[i] as string) as Record<string, unknown>;
    } catch {
      malformed += 1;
      continue;
    }
    const id = row.id;
    const content = row.text ?? row.content;
    if (typeof id !== "string" || typeof content !== "string" || content.trim().length === 0) {
      malformed += 1;
      continue;
    }
    raw.push({
      id,
      content,
      timestamp: new Date(base + i * 1000).toISOString(),
      author_id: authorId,
      channel_id: channelId,
      guild_id: guildId ?? undefined,
    });
  }

  process.stdout.write(
    `parsed=${raw.length} malformed=${malformed} channel=${channelId} guild=${guildId ?? "(none)"}\n`,
  );

  try {
    if (has("--wipe-self")) {
      process.stdout.write(`wiped self messages: ${deleteSelfMessages(db)}\n`);
    }
    if (has("--reset-style")) {
      process.stdout.write(`wiped style profile: ${deleteStyleProfile(db)}\n`);
    }

    const doImport = importMessages({ config, db, logger, assumeSelfWhenNoAuthor: true });
    const summary = doImport(raw as unknown as Parameters<typeof doImport>[0], {
      channelId,
      ...(guildId ? { guildId } : {}),
    });
    process.stdout.write(
      `imported=${summary.imported} skipped=${summary.skipped} errors=${summary.errors}\n`,
    );
    process.stdout.write(`self messages: ${selfMessageCount(db)}\n`);

    if (has("--rebuild")) {
      const built = await rebuildStyleProfile({ config, db, logger, gateway, force: true });
      const profile = getStyleProfile(db, "global", "self");
      process.stdout.write(
        `style profile built=${built} samples=${profile?.samples_count ?? 0}\n`,
      );
      if (profile) process.stdout.write(`--- summary ---\n${profile.summary}\n`);
    }

    process.stdout.write(`stats: ${JSON.stringify(messageStats(db))}\n`);
  } finally {
    gateway.close();
    db.close();
  }
};

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    process.stderr.write(
      `inject failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  });
