import type { Db } from "./index.js";
import { normalizeContent } from "./index.js";
import { isChatLike } from "../safety/filters.js";

export type MessageRow = {
  readonly id: string;
  readonly guild_id: string | null;
  readonly channel_id: string;
  readonly thread_id: string | null;
  readonly author_id: string;
  readonly author_is_self: number;
  readonly content: string;
  readonly created_at: number;
  readonly edited_at: number | null;
  readonly deleted: number;
  readonly source: string;
};

export type MessageInput = {
  readonly id: string;
  readonly guildId: string | null;
  readonly channelId: string;
  readonly threadId: string | null;
  readonly authorId: string;
  readonly authorIsSelf: boolean;
  readonly content: string;
  readonly createdAt: number;
  readonly source: "live" | "import";
};

export const insertMessage = (db: Db, input: MessageInput): void => {
  db.prepare(
    `INSERT INTO messages
       (id, guild_id, channel_id, thread_id, author_id, author_is_self,
        content, content_norm, created_at, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       content = excluded.content,
       content_norm = excluded.content_norm,
       edited_at = ?`,
  ).run(
    input.id,
    input.guildId,
    input.channelId,
    input.threadId,
    input.authorId,
    input.authorIsSelf ? 1 : 0,
    input.content,
    normalizeContent(input.content),
    input.createdAt,
    input.source,
    Date.now(),
  );
};

export const markMessageDeleted = (db: Db, id: string): void => {
  db.prepare("UPDATE messages SET deleted = 1 WHERE id = ?").run(id);
};

export const updateMessageContent = (
  db: Db,
  id: string,
  content: string,
  editedAt: number,
): void => {
  db.prepare(
    "UPDATE messages SET content = ?, content_norm = ?, edited_at = ? WHERE id = ?",
  ).run(content, normalizeContent(content), editedAt, id);
};

export type RecentMessagesQuery = {
  readonly channelId: string;
  readonly limit: number;
  readonly before?: number;
  readonly selfOnly?: boolean;
  readonly includeDeleted?: boolean;
};

export const recentMessages = (db: Db, query: RecentMessagesQuery): MessageRow[] => {
  const clauses = ["channel_id = ?"];
  const params: (string | number)[] = [query.channelId];
  if (!query.includeDeleted) clauses.push("deleted = 0");
  if (query.selfOnly) clauses.push("author_is_self = 1");
  if (query.before !== undefined) {
    clauses.push("created_at < ?");
    params.push(query.before);
  }
  params.push(query.limit);
  return db
    .prepare(
      `SELECT * FROM messages WHERE ${clauses.join(" AND ")}
       ORDER BY created_at DESC LIMIT ?`,
    )
    .all(...params) as unknown as MessageRow[];
};

const inClause = (
  column: string,
  values: readonly string[] | undefined,
): { sql: string; params: string[] } =>
  values && values.length > 0
    ? {
        sql: ` AND ${column} IN (${values.map(() => "?").join(", ")})`,
        params: [...values],
      }
    : { sql: "", params: [] };

export type StyleScope = {
  readonly guildIds?: readonly string[];
  readonly channelIds?: readonly string[];
};

const scopeClause = (
  scope: StyleScope | undefined,
  guildColumn = "guild_id",
  channelColumn = "channel_id",
): { sql: string; params: string[] } => {
  const guild = inClause(guildColumn, scope?.guildIds);
  const channel = inClause(channelColumn, scope?.channelIds);
  return { sql: guild.sql + channel.sql, params: [...guild.params, ...channel.params] };
};

export type SearchMessagesQuery = {
  readonly text: string;
  readonly limit: number;
  readonly selfOnly?: boolean;
  readonly channelId?: string;
  readonly guildIds?: readonly string[];
  readonly channelIds?: readonly string[];
};

export const searchMessages = (db: Db, query: SearchMessagesQuery): MessageRow[] => {
  const normalized = normalizeContent(query.text);
  if (normalized.length === 0) return [];

  const clauses = ["m.deleted = 0"];
  const params: (string | number)[] = [];
  if (query.selfOnly) clauses.push("m.author_is_self = 1");
  if (query.channelId) {
    clauses.push("m.channel_id = ?");
    params.push(query.channelId);
  }
  if (query.guildIds && query.guildIds.length > 0) {
    clauses.push(`m.guild_id IN (${query.guildIds.map(() => "?").join(", ")})`);
    params.push(...query.guildIds);
  }
  if (query.channelIds && query.channelIds.length > 0) {
    clauses.push(`m.channel_id IN (${query.channelIds.map(() => "?").join(", ")})`);
    params.push(...query.channelIds);
  }

  if (normalized.length >= 3) {
    const phrase = `"${normalized.replace(/"/g, '""')}"`;
    const rows = db
      .prepare(
        `SELECT m.* FROM messages_fts f
         JOIN messages m ON m.rowid_pk = f.rowid
         WHERE messages_fts MATCH ? AND ${clauses.join(" AND ")}
         ORDER BY bm25(messages_fts) LIMIT ?`,
      )
      .all(phrase, ...params, query.limit) as unknown as MessageRow[];
    if (rows.length > 0) return rows;
  }

  return db
    .prepare(
      `SELECT m.* FROM messages m
       WHERE ${clauses.join(" AND ")} AND m.content_norm LIKE ?
       ORDER BY m.created_at DESC LIMIT ?`,
    )
    .all(...params, `%${normalized}%`, query.limit) as unknown as MessageRow[];
};

export const selfMessageSample = (
  db: Db,
  limit: number,
  maxLength?: number,
  scope?: StyleScope,
): string[] => {
  const base = `SELECT content FROM messages
    WHERE author_is_self = 1 AND deleted = 0 AND length(content) >= 2`;
  const guild = scopeClause(scope);

  if (maxLength === undefined) {
    const rows = db
      .prepare(`${base}${guild.sql} ORDER BY RANDOM() LIMIT ?`)
      .all(...guild.params, limit) as unknown as { content: string }[];
    return rows.map((r) => r.content);
  }

  const short = db
    .prepare(`${base}${guild.sql} AND length(content) <= ? ORDER BY RANDOM() LIMIT ?`)
    .all(...guild.params, maxLength, limit) as unknown as { content: string }[];
  const result = short.map((r) => r.content);
  if (result.length >= limit) return result;

  const seen = new Set(result);
  const extra = db
    .prepare(`${base}${guild.sql} ORDER BY RANDOM() LIMIT ?`)
    .all(...guild.params, limit * 3) as unknown as { content: string }[];
  for (const row of extra) {
    if (result.length >= limit) break;
    if (seen.has(row.content)) continue;
    seen.add(row.content);
    result.push(row.content);
  }
  return result;
};

export const selfMessageFirstLines = (
  db: Db,
  limit: number,
  scope?: StyleScope,
): string[] => {
  const guild = scopeClause(scope);
  const rows = db
    .prepare(
      `SELECT substr(content, 1, 80) AS line FROM messages
       WHERE author_is_self = 1 AND deleted = 0 AND length(content) >= 4${guild.sql}
       ORDER BY RANDOM() LIMIT ?`,
    )
    .all(...guild.params, limit) as unknown as { line: string }[];
  return rows.map((r) => r.line.replace(/\s+/gu, " ").trim());
};

export const selfMessageCount = (db: Db, scope?: StyleScope): number => {
  const guild = scopeClause(scope);
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c FROM messages
       WHERE author_is_self = 1 AND deleted = 0${guild.sql}`,
    )
    .get(...guild.params) as { c: number };
  return row.c;
};

export type ChannelSettingsRow = {
  readonly channel_id: string;
  readonly collector_enabled: number;
  readonly mention_enabled: number;
  readonly spontaneous_enabled: number;
  readonly min_interval_sec: number | null;
  readonly daily_cap: number | null;
  readonly quiet_hours: string | null;
  readonly last_spontaneous_at: number | null;
};

export const getChannelSettings = (
  db: Db,
  channelId: string,
): ChannelSettingsRow | undefined =>
  db.prepare("SELECT * FROM channel_settings WHERE channel_id = ?").get(channelId) as
    | ChannelSettingsRow
    | undefined;

export const upsertChannelSettings = (
  db: Db,
  channelId: string,
  patch: Partial<Omit<ChannelSettingsRow, "channel_id">>,
): void => {
  const existing = getChannelSettings(db, channelId);
  const merged = {
    collector_enabled: patch.collector_enabled ?? existing?.collector_enabled ?? 0,
    mention_enabled: patch.mention_enabled ?? existing?.mention_enabled ?? 1,
    spontaneous_enabled: patch.spontaneous_enabled ?? existing?.spontaneous_enabled ?? 0,
    min_interval_sec: patch.min_interval_sec ?? existing?.min_interval_sec ?? null,
    daily_cap: patch.daily_cap ?? existing?.daily_cap ?? null,
    quiet_hours: patch.quiet_hours ?? existing?.quiet_hours ?? null,
    last_spontaneous_at: patch.last_spontaneous_at ?? existing?.last_spontaneous_at ?? null,
  };
  db.prepare(
    `INSERT INTO channel_settings
       (channel_id, collector_enabled, mention_enabled, spontaneous_enabled,
        min_interval_sec, daily_cap, quiet_hours, last_spontaneous_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(channel_id) DO UPDATE SET
       collector_enabled = excluded.collector_enabled,
       mention_enabled = excluded.mention_enabled,
       spontaneous_enabled = excluded.spontaneous_enabled,
       min_interval_sec = excluded.min_interval_sec,
       daily_cap = excluded.daily_cap,
       quiet_hours = excluded.quiet_hours,
       last_spontaneous_at = excluded.last_spontaneous_at,
       updated_at = excluded.updated_at`,
  ).run(
    channelId,
    merged.collector_enabled,
    merged.mention_enabled,
    merged.spontaneous_enabled,
    merged.min_interval_sec,
    merged.daily_cap,
    merged.quiet_hours,
    merged.last_spontaneous_at,
    Date.now(),
  );
};

export const insertGenerated = (
  db: Db,
  input: {
    readonly channelId: string;
    readonly kind: "spontaneous" | "mention_reply";
    readonly content: string;
    readonly model: string;
    readonly sentMessageId: string | null;
    readonly accepted: boolean;
    readonly reason: string | null;
  },
): void => {
  db.prepare(
    `INSERT INTO generated_messages
       (channel_id, kind, content, model, sent_message_id, accepted, reason, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.channelId,
    input.kind,
    input.content,
    input.model,
    input.sentMessageId,
    input.accepted ? 1 : 0,
    input.reason,
    Date.now(),
  );
};

export const countSpontaneousToday = (db: Db, channelId: string): number => {
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c FROM generated_messages
       WHERE channel_id = ? AND kind = 'spontaneous' AND accepted = 1 AND created_at >= ?`,
    )
    .get(channelId, since.getTime()) as { c: number };
  return row.c;
};

export const recentGeneratedContents = (
  db: Db,
  channelId: string,
  limit: number,
): string[] => {
  const rows = db
    .prepare(
      `SELECT content FROM generated_messages
       WHERE channel_id = ? AND kind = 'spontaneous'
       ORDER BY created_at DESC LIMIT ?`,
    )
    .all(channelId, limit) as unknown as { content: string }[];
  return rows.map((r) => r.content);
};

export const insertApiCall = (
  db: Db,
  input: {
    readonly kind: string;
    readonly model: string;
    readonly latencyMs: number;
    readonly ok: boolean;
    readonly error: string | null;
    readonly inputTokens: number | null;
    readonly outputTokens: number | null;
    readonly cost: number | null;
  },
): void => {
  db.prepare(
    `INSERT INTO api_calls
       (kind, model, latency_ms, ok, error, input_tokens, output_tokens, cost, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.kind,
    input.model,
    input.latencyMs,
    input.ok ? 1 : 0,
    input.error,
    input.inputTokens,
    input.outputTokens,
    input.cost,
    Date.now(),
  );
};

export type StyleProfileRow = {
  readonly scope: string;
  readonly scope_id: string;
  readonly summary: string;
  readonly samples_count: number;
  readonly model: string;
  readonly version: number;
};

export const upsertStyleProfile = (
  db: Db,
  input: {
    readonly scope: string;
    readonly scopeId: string;
    readonly summary: string;
    readonly samplesCount: number;
    readonly model: string;
  },
): void => {
  const existing = db
    .prepare("SELECT version FROM style_profiles WHERE scope = ? AND scope_id = ?")
    .get(input.scope, input.scopeId) as { version: number } | undefined;
  const version = (existing?.version ?? 0) + 1;
  db.prepare(
    `INSERT INTO style_profiles
       (scope, scope_id, summary, samples_count, model, version, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(scope, scope_id) DO UPDATE SET
       summary = excluded.summary,
       samples_count = excluded.samples_count,
       model = excluded.model,
       version = excluded.version,
       created_at = excluded.created_at`,
  ).run(
    input.scope,
    input.scopeId,
    input.summary,
    input.samplesCount,
    input.model,
    version,
    Date.now(),
  );
};

export const getStyleProfile = (
  db: Db,
  scope: string,
  scopeId: string,
): StyleProfileRow | undefined =>
  db
    .prepare("SELECT * FROM style_profiles WHERE scope = ? AND scope_id = ?")
    .get(scope, scopeId) as StyleProfileRow | undefined;

export const deleteStyleProfile = (
  db: Db,
  scope = "global",
  scopeId = "self",
): number => {
  const result = db
    .prepare("DELETE FROM style_profiles WHERE scope = ? AND scope_id = ?")
    .run(scope, scopeId);
  return Number(result.changes);
};

export const deleteSelfMessages = (db: Db): number => {
  const result = db
    .prepare("DELETE FROM messages WHERE author_is_self = 1")
    .run();
  return Number(result.changes);
};

export const deleteAllGenerated = (db: Db): number => {
  const result = db.prepare("DELETE FROM generated_messages").run();
  return Number(result.changes);
};

export const selfMessageIdsWithContent = (
  db: Db,
  limit = 5000,
): { id: string; content: string }[] =>
  db
    .prepare(
      `SELECT id, content FROM messages
       WHERE author_is_self = 1 AND deleted = 0
       ORDER BY created_at DESC LIMIT ?`,
    )
    .all(limit) as unknown as { id: string; content: string }[];

export const deleteMessagesByIds = (db: Db, ids: readonly string[]): number => {
  if (ids.length === 0) return 0;
  const statement = db.prepare("DELETE FROM messages WHERE id = ?");
  let removed = 0;
  for (const id of ids) {
    removed += Number(statement.run(id).changes);
  }
  return removed;
};

export const selfMessagesByGuild = (
  db: Db,
): { guildId: string | null; count: number; chatLike: number }[] => {
  const rows = db
    .prepare(
      `SELECT guild_id AS guildId, content FROM messages
       WHERE author_is_self = 1 AND deleted = 0`,
    )
    .all() as unknown as { guildId: string | null; content: string }[];

  const map = new Map<string | null, { count: number; chatLike: number }>();
  for (const row of rows) {
    const entry = map.get(row.guildId) ?? { count: 0, chatLike: 0 };
    entry.count += 1;
    if (isChatLike(row.content)) entry.chatLike += 1;
    map.set(row.guildId, entry);
  }

  return [...map.entries()].map(([guildId, value]) => ({
    guildId,
    count: value.count,
    chatLike: value.chatLike,
  }));
};

export const messageStats = (
  db: Db,
): { total: number; self: number; channels: number } => {
  const row = db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(author_is_self) AS self,
         COUNT(DISTINCT channel_id) AS channels
       FROM messages WHERE deleted = 0`,
    )
    .get() as { total: number; self: number | null; channels: number };
  return { total: row.total, self: row.self ?? 0, channels: row.channels };
};

export const pruneMessages = (db: Db, retentionDays: number): number => {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const result = db
    .prepare("DELETE FROM messages WHERE author_is_self = 0 AND created_at < ?")
    .run(cutoff);
  return Number(result.changes);
};

export const pruneGenerated = (db: Db, retentionDays: number): number => {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const result = db
    .prepare("DELETE FROM generated_messages WHERE created_at < ?")
    .run(cutoff);
  return Number(result.changes);
};

export const pruneApiCalls = (db: Db, retentionDays: number): number => {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const result = db.prepare("DELETE FROM api_calls WHERE created_at < ?").run(cutoff);
  return Number(result.changes);
};

export const apiUsageToday = (
  db: Db,
): { calls: number; failures: number; cost: number; avgLatencyMs: number } => {
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  const row = db
    .prepare(
      `SELECT
         COUNT(*) AS calls,
         SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) AS failures,
         COALESCE(SUM(cost), 0) AS cost,
         COALESCE(AVG(latency_ms), 0) AS avgLatencyMs
       FROM api_calls WHERE created_at >= ?`,
    )
    .get(since.getTime()) as {
    calls: number;
    failures: number | null;
    cost: number;
    avgLatencyMs: number;
  };
  return {
    calls: row.calls,
    failures: row.failures ?? 0,
    cost: row.cost,
    avgLatencyMs: Math.round(row.avgLatencyMs),
  };
};

export const getUserAlias = (db: Db, userId: string): string | undefined => {
  const row = db
    .prepare("SELECT alias FROM user_aliases WHERE user_id = ?")
    .get(userId) as { alias: string } | undefined;
  return row?.alias;
};

export const setUserAlias = (db: Db, userId: string, alias: string): void => {
  db.prepare(
    `INSERT INTO user_aliases (user_id, alias, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       alias = excluded.alias,
       updated_at = excluded.updated_at`,
  ).run(userId, alias, Date.now());
};

export const deleteUserAlias = (db: Db, userId: string): number => {
  const result = db.prepare("DELETE FROM user_aliases WHERE user_id = ?").run(userId);
  return Number(result.changes);
};

export const userAliasCount = (db: Db): number => {
  const row = db.prepare("SELECT COUNT(*) AS c FROM user_aliases").get() as { c: number };
  return row.c;
};

export const spontaneousChannelIds = (db: Db): string[] => {
  const rows = db
    .prepare("SELECT channel_id FROM channel_settings WHERE spontaneous_enabled = 1")
    .all() as { channel_id: string }[];
  return rows.map((row) => row.channel_id);
};

export const allChannelSettings = (db: Db): ChannelSettingsRow[] =>
  db
    .prepare("SELECT * FROM channel_settings ORDER BY channel_id")
    .all() as unknown as ChannelSettingsRow[];

export const selfMessageSignature = (
  db: Db,
  scope?: StyleScope,
): { count: number; maxCreatedAt: number } => {
  const guild = scopeClause(scope);
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c, COALESCE(MAX(created_at), 0) AS m FROM messages
       WHERE author_is_self = 1 AND deleted = 0${guild.sql}`,
    )
    .get(...guild.params) as { c: number; m: number };
  return { count: row.c, maxCreatedAt: row.m };
};

export type MemoryStateRow = {
  readonly id: number;
  readonly source_count: number;
  readonly source_max_created_at: number;
  readonly updated_at: number;
};

export const getMemoryState = (db: Db): MemoryStateRow | undefined =>
  db.prepare("SELECT * FROM memory_state WHERE id = 1").get() as MemoryStateRow | undefined;

export const saveMemoryState = (db: Db, count: number, maxCreatedAt: number): void => {
  db.prepare(
    `INSERT INTO memory_state (id, source_count, source_max_created_at, updated_at)
     VALUES (1, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       source_count = excluded.source_count,
       source_max_created_at = excluded.source_max_created_at,
       updated_at = excluded.updated_at`,
  ).run(count, maxCreatedAt, Date.now());
};
