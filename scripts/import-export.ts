import { loadConfig } from "../src/config.js";
import { createLogger } from "../src/logger.js";
import { openDatabase } from "../src/db/index.js";
import { importFromPath } from "../src/jobs/import.js";

const parseArgs = (argv: readonly string[]): {
  path: string | undefined;
  channelId: string | undefined;
  includeOthers: boolean;
  assumeSelf: boolean;
} => {
  let path: string | undefined;
  let channelId: string | undefined;
  let includeOthers = false;
  let assumeSelf = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--channel") {
      channelId = argv[i + 1];
      i += 1;
    } else if (arg === "--include-others") {
      includeOthers = true;
    } else if (arg === "--assume-self") {
      assumeSelf = true;
    } else if (arg && !arg.startsWith("--")) {
      path = arg;
    }
  }

  return { path, channelId, includeOthers, assumeSelf };
};

const main = (): void => {
  const { path, channelId, includeOthers, assumeSelf } = parseArgs(
    process.argv.slice(2),
  );
  if (!path) {
    process.stderr.write(
      "usage: npm run db:import -- <path-to-export.json|dir> [--channel <id>] [--include-others] [--assume-self]\n",
    );
    process.exit(1);
    return;
  }

  const config = loadConfig();
  const logger = createLogger(config.runtime.logLevel, config.runtime.nodeEnv);
  const db = openDatabase(config.runtime.dbPath, logger);

  try {
    const runImport = importFromPath({
      config,
      db,
      logger,
      includeOthers,
      assumeSelfWhenNoAuthor: assumeSelf,
    });
    const summary = runImport(path, channelId);
    process.stdout.write(
      `imported=${summary.imported} skipped=${summary.skipped} errors=${summary.errors}\n`,
    );
  } finally {
    db.close();
  }
};

try {
  main();
} catch (error) {
  process.stderr.write(`import failed: ${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
}
