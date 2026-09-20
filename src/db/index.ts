import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { migrations, type Migration } from "./migrations.js";
import type { Logger } from "../logger.js";

const require = createRequire(import.meta.url);
const sqlite = require("node:sqlite") as {
  DatabaseSync: new (path: string) => DatabaseSync;
};

export type Db = DatabaseSync;

const appliedVersions = (db: Db): Set<number> => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `);
  const rows = db.prepare("SELECT version FROM schema_migrations").all() as {
    version: number;
  }[];
  return new Set(rows.map((r) => r.version));
};

const applyMigration = (db: Db, migration: Migration): void => {
  db.exec("BEGIN");
  try {
    db.exec(migration.sql);
    db.prepare(
      "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
    ).run(migration.version, migration.name, Date.now());
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
};

export const migrate = (db: Db, logger?: Logger): void => {
  const applied = appliedVersions(db);
  const pending = migrations
    .filter((m) => !applied.has(m.version))
    .sort((a, b) => a.version - b.version);

  for (const migration of pending) {
    applyMigration(db, migration);
    logger?.info(
      { version: migration.version, name: migration.name },
      "applied migration",
    );
  }
};

export const openDatabase = (path: string, logger?: Logger): Db => {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new sqlite.DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  migrate(db, logger);
  return db;
};

export const normalizeContent = (content: string): string =>
  content.toLowerCase().replace(/\s+/gu, "").trim();
