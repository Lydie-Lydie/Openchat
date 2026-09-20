import "dotenv/config";
import { z } from "zod";

const csv = (raw: string): string[] =>
  raw
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);

const booleanish = z
  .string()
  .transform((v) => v.trim().toLowerCase())
  .pipe(z.enum(["true", "false", "1", "0", "yes", "no"]))
  .transform((v) => v === "true" || v === "1" || v === "yes");

const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_APP_ID: z.string().min(1),
  DISCORD_GUILD_ID: z.string().min(1).optional(),
  SELF_USER_ID: z.string().min(1),
  ADMIN_USER_IDS: z.string().default("").transform(csv),
  ALLOWED_GUILD_IDS: z.string().default("").transform(csv),
  STYLE_GUILD_IDS: z.string().default("").transform(csv),
  STYLE_CHANNEL_IDS: z.string().default("").transform(csv),
  MENTION_ALLOWED_USER_IDS: z.string().default("").transform(csv),
  MENTION_GLOBAL_PER_MIN: z.coerce.number().int().positive().default(20),
  MENTION_REPLY_INLINE: booleanish.default("true"),
  EMOJI_ENABLED: booleanish.default("true"),
  EMOJI_MAX: z.coerce.number().int().positive().default(30),

  COLLECTOR_CHANNEL_IDS: z.string().default("").transform(csv),
  SPONTANEOUS_CHANNEL_IDS: z.string().default("").transform(csv),
  DRY_RUN_CHANNEL_ID: z.string().min(1).optional(),

  OPENCODE_BASE_URL: z.string().url().default("http://127.0.0.1:4096"),
  OPENCODE_SERVER_USERNAME: z.string().default("opencode"),
  OPENCODE_SERVER_PASSWORD: z.string().optional(),
  OPENCODE_MODEL: z.string().default("opencode-go/deepseek-v4.1-flash"),
  OPENCODE_MODEL_MENTION: z.string().optional(),
  OPENCODE_MODEL_SPONTANEOUS: z.string().optional(),
  OPENCODE_MODEL_STYLE_SUMMARY: z.string().optional(),
  OPENCODE_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),

  DB_PATH: z.string().default("./data/openchat.db"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  BOT_NAME: z.string().min(1).default("openchat"),
  COMMAND_NAME: z
    .string()
    .regex(/^[-_\p{L}\p{N}]{1,32}$/u, "COMMAND_NAME must be 1-32 word characters")
    .default("openchat"),

  DRY_RUN: booleanish.default("true"),
  SPONTANEOUS_ENABLED: booleanish.default("false"),
  SPONTANEOUS_TICK_MS: z.coerce.number().int().positive().default(600_000),
  SPONTANEOUS_MIN_INTERVAL_SEC: z.coerce.number().int().positive().default(3_600),
  SPONTANEOUS_DAILY_CAP: z.coerce.number().int().positive().default(5),
  SPONTANEOUS_QUIET_HOURS: z
    .string()
    .regex(/^\d{2}:\d{2}-\d{2}:\d{2}$/)
    .default("00:00-08:00"),
  RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  STYLE_LEARNING_ENABLED: booleanish.default("true"),
  LEXICON_ENABLED: booleanish.default("true"),
  LEXICON_PATH: z.string().default("./data/lexicon.json"),
  PERSONA_ENABLED: booleanish.default("true"),
  PERSONA_PATH: z.string().default("./data/persona.md"),
  PERSONA_PROMPT: z.string().default(""),
  PERSONA_AUTO_ENABLED: booleanish.default("true"),
  PERSONA_AUTO_PATH: z.string().default("./data/persona.auto.md"),
});

export type AppConfig = {
  readonly botName: string;
  readonly commandName: string;
  readonly discord: {
    readonly token: string;
    readonly appId: string;
    readonly guildId: string | undefined;
    readonly selfUserId: string;
    readonly adminUserIds: readonly string[];
    readonly allowedGuildIds: readonly string[];
    readonly styleGuildIds: readonly string[];
    readonly styleChannelIds: readonly string[];
    readonly mentionAllowedUserIds: readonly string[];
    readonly mentionGlobalPerMin: number;
    readonly mentionReplyInline: boolean;
    readonly emojiEnabled: boolean;
    readonly emojiMax: number;
  };
  readonly channels: {
    readonly collectorIds: readonly string[];
    readonly spontaneousIds: readonly string[];
    readonly dryRunId: string | undefined;
  };
  readonly opencode: {
    readonly baseUrl: string;
    readonly username: string;
    readonly password: string | undefined;
    readonly timeoutMs: number;
    readonly models: {
      readonly default: string;
      readonly mention: string;
      readonly spontaneous: string;
      readonly styleSummary: string;
    };
  };
  readonly runtime: {
    readonly dbPath: string;
    readonly logLevel: string;
    readonly nodeEnv: string;
    readonly dryRun: boolean;
    readonly retentionDays: number;
    readonly styleLearningEnabled: boolean;
    readonly lexiconEnabled: boolean;
    readonly lexiconPath: string;
    readonly personaEnabled: boolean;
    readonly personaPath: string;
    readonly personaPrompt: string;
    readonly personaAutoEnabled: boolean;
    readonly personaAutoPath: string;
  };
  readonly spontaneous: {
    readonly enabled: boolean;
    readonly tickMs: number;
    readonly minIntervalSec: number;
    readonly dailyCap: number;
    readonly quietHours: { readonly start: string; readonly end: string };
  };
};

const parseQuietHours = (raw: string): { start: string; end: string } => {
  const [start, end] = raw.split("-");
  if (!start || !end) throw new Error(`Invalid SPONTANEOUS_QUIET_HOURS: ${raw}`);
  return { start, end };
};

export const isGuildAllowed = (config: AppConfig, guildId: string | null): boolean => {
  if (config.discord.allowedGuildIds.length === 0) return true;
  if (guildId === null) return false;
  return config.discord.allowedGuildIds.includes(guildId);
};

export const isMentionUserAllowed = (config: AppConfig, userId: string): boolean =>
  config.discord.mentionAllowedUserIds.length === 0 ||
  config.discord.mentionAllowedUserIds.includes(userId);

export const loadConfig = (source: NodeJS.ProcessEnv = process.env): AppConfig => {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const env = parsed.data;
  const model = env.OPENCODE_MODEL;

  const allowedGuildIds =
    env.ALLOWED_GUILD_IDS.length > 0
      ? env.ALLOWED_GUILD_IDS
      : env.DISCORD_GUILD_ID
        ? [env.DISCORD_GUILD_ID]
        : [];

  const styleGuildIds =
    env.STYLE_GUILD_IDS.length > 0 ? env.STYLE_GUILD_IDS : allowedGuildIds;

  // Empty = any user may trigger mentions (matches .env.example and isMentionUserAllowed).
  const mentionAllowedUserIds = env.MENTION_ALLOWED_USER_IDS;

  return {
    botName: env.BOT_NAME,
    commandName: env.COMMAND_NAME,
    discord: {
      token: env.DISCORD_TOKEN,
      appId: env.DISCORD_APP_ID,
      guildId: env.DISCORD_GUILD_ID,
      selfUserId: env.SELF_USER_ID,
      adminUserIds: env.ADMIN_USER_IDS,
      allowedGuildIds,
      styleGuildIds,
      styleChannelIds: env.STYLE_CHANNEL_IDS,
      mentionAllowedUserIds,
      mentionGlobalPerMin: env.MENTION_GLOBAL_PER_MIN,
      mentionReplyInline: env.MENTION_REPLY_INLINE,
      emojiEnabled: env.EMOJI_ENABLED,
      emojiMax: env.EMOJI_MAX,
    },
    channels: {
      collectorIds: env.COLLECTOR_CHANNEL_IDS,
      spontaneousIds: env.SPONTANEOUS_CHANNEL_IDS,
      dryRunId: env.DRY_RUN_CHANNEL_ID,
    },
    opencode: {
      baseUrl: env.OPENCODE_BASE_URL,
      username: env.OPENCODE_SERVER_USERNAME,
      password: env.OPENCODE_SERVER_PASSWORD,
      timeoutMs: env.OPENCODE_TIMEOUT_MS,
      models: {
        default: model,
        mention: env.OPENCODE_MODEL_MENTION ?? model,
        spontaneous: env.OPENCODE_MODEL_SPONTANEOUS ?? model,
        styleSummary: env.OPENCODE_MODEL_STYLE_SUMMARY ?? model,
      },
    },
    runtime: {
      dbPath: env.DB_PATH,
      logLevel: env.LOG_LEVEL,
      nodeEnv: env.NODE_ENV,
      dryRun: env.DRY_RUN,
      retentionDays: env.RETENTION_DAYS,
      styleLearningEnabled: env.STYLE_LEARNING_ENABLED,
      lexiconEnabled: env.LEXICON_ENABLED,
      lexiconPath: env.LEXICON_PATH,
      personaEnabled: env.PERSONA_ENABLED,
      personaPath: env.PERSONA_PATH,
      personaPrompt: env.PERSONA_PROMPT,
      personaAutoEnabled: env.PERSONA_AUTO_ENABLED,
      personaAutoPath: env.PERSONA_AUTO_PATH,
    },
    spontaneous: {
      enabled: env.SPONTANEOUS_ENABLED,
      tickMs: env.SPONTANEOUS_TICK_MS,
      minIntervalSec: env.SPONTANEOUS_MIN_INTERVAL_SEC,
      dailyCap: env.SPONTANEOUS_DAILY_CAP,
      quietHours: parseQuietHours(env.SPONTANEOUS_QUIET_HOURS),
    },
  };
};
