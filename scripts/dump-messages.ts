import "dotenv/config";
import { loadConfig } from "../src/config.js";
import { createLogger } from "../src/logger.js";
import { openDatabase } from "../src/db/index.js";
import { type MessageRow, recentMessages } from "../src/db/queries.js";
import { isChatLike } from "../src/safety/filters.js";

const config = loadConfig();
const db = openDatabase(config.runtime.dbPath, createLogger("error", "test"));
const rows = recentMessages(db, { channelId: config.channels.collectorIds[0] ?? "", limit: 500 })
  .reverse();

const clip = (s: string, n = 70): string => s.replace(/\s+/gu, " ").slice(0, n);

let pass = 0;
process.stdout.write(
  ["pass len sp tok end | text", "---- --- -- --- --- | ----"].join("\n") + "\n",
);
for (const r of rows as MessageRow[]) {
  const t = r.content.trim();
  const ok = isChatLike(t);
  if (ok) pass += 1;
  const spaces = (t.match(/\s/gu) ?? []).length;
  const longest = Math.max(...t.split(/\s+/u).map((w) => w.length), 0);
  process.stdout.write(
    [
      ok ? "  Y " : "  . ",
      String(t.length).padStart(3),
      String(spaces).padStart(2),
      String(longest).padStart(3),
      JSON.stringify(t.slice(-2)),
      clip(t),
    ].join(" ") + "\n",
  );
}
process.stdout.write(`\nchat-like: ${pass}/${rows.length}\n`);
db.close();
