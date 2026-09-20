export type Migration = {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
};

export const migrations: readonly Migration[] = [
  {
    version: 1,
    name: "init",
    sql: `
      CREATE TABLE messages (
        rowid_pk INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        guild_id TEXT,
        channel_id TEXT NOT NULL,
        thread_id TEXT,
        author_id TEXT NOT NULL,
        author_is_self INTEGER NOT NULL DEFAULT 0,
        content TEXT NOT NULL,
        content_norm TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        edited_at INTEGER,
        deleted INTEGER NOT NULL DEFAULT 0,
        source TEXT NOT NULL DEFAULT 'live',
        indexed INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX idx_messages_channel_created
        ON messages(channel_id, created_at DESC);
      CREATE INDEX idx_messages_self_created
        ON messages(author_is_self, created_at DESC);
      CREATE INDEX idx_messages_author ON messages(author_id);

      CREATE VIRTUAL TABLE messages_fts USING fts5(
        content_norm,
        content='messages',
        content_rowid='rowid_pk',
        tokenize='trigram'
      );

      CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN
        INSERT INTO messages_fts(rowid, content_norm)
        VALUES (new.rowid_pk, new.content_norm);
      END;

      CREATE TRIGGER messages_ad AFTER DELETE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, content_norm)
        VALUES ('delete', old.rowid_pk, old.content_norm);
      END;

      CREATE TRIGGER messages_au AFTER UPDATE OF content_norm ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, content_norm)
        VALUES ('delete', old.rowid_pk, old.content_norm);
        INSERT INTO messages_fts(rowid, content_norm)
        VALUES (new.rowid_pk, new.content_norm);
      END;

      CREATE TABLE channel_settings (
        channel_id TEXT PRIMARY KEY,
        collector_enabled INTEGER NOT NULL DEFAULT 0,
        mention_enabled INTEGER NOT NULL DEFAULT 1,
        spontaneous_enabled INTEGER NOT NULL DEFAULT 0,
        min_interval_sec INTEGER,
        daily_cap INTEGER,
        quiet_hours TEXT,
        last_spontaneous_at INTEGER,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE style_profiles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scope TEXT NOT NULL,
        scope_id TEXT NOT NULL,
        summary TEXT NOT NULL,
        samples_count INTEGER NOT NULL,
        model TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        UNIQUE(scope, scope_id)
      );

      CREATE TABLE generated_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        content TEXT NOT NULL,
        model TEXT NOT NULL,
        sent_message_id TEXT,
        accepted INTEGER NOT NULL DEFAULT 0,
        reason TEXT,
        prompt_hash TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX idx_generated_channel_created
        ON generated_messages(channel_id, created_at DESC);

      CREATE TABLE api_calls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        model TEXT NOT NULL,
        latency_ms INTEGER NOT NULL,
        ok INTEGER NOT NULL,
        error TEXT,
        input_tokens INTEGER,
        output_tokens INTEGER,
        cost REAL,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX idx_api_calls_created ON api_calls(created_at DESC);
    `,
  },
  {
    version: 2,
    name: "user_aliases",
    sql: `
      CREATE TABLE user_aliases (
        user_id TEXT PRIMARY KEY,
        alias TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `,
  },
  {
    version: 3,
    name: "memory_state",
    sql: `
      CREATE TABLE memory_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        source_count INTEGER NOT NULL,
        source_max_created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `,
  },
];
