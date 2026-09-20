import type { AppConfig } from "../src/config.js";

export const makeConfig = (overrides: Partial<AppConfig> = {}): AppConfig => {
  const base: AppConfig = {
    botName: "openchat",
    commandName: "openchat",
    discord: {
      token: "token",
      appId: "app",
      guildId: "guild",
      selfUserId: "self",
      adminUserIds: ["admin"],
      allowedGuildIds: ["guild"],
      styleGuildIds: ["guild"],
      styleChannelIds: [],
      mentionAllowedUserIds: ["self", "admin"],
      mentionGlobalPerMin: 20,
      mentionReplyInline: true,
      emojiEnabled: true,
      emojiMax: 30,
    },
    channels: {
      collectorIds: ["chan-1"],
      spontaneousIds: ["chan-1"],
      dryRunId: undefined,
    },
    opencode: {
      baseUrl: "http://127.0.0.1:4096",
      username: "opencode",
      password: undefined,
      timeoutMs: 60_000,
      models: {
        default: "opencode-go/deepseek-v4.1-flash",
        mention: "opencode-go/deepseek-v4.1-flash",
        spontaneous: "opencode-go/deepseek-v4.1-flash",
        styleSummary: "opencode-go/deepseek-v4.1-flash",
      },
    },
    runtime: {
      dbPath: ":memory:",
      logLevel: "error",
      nodeEnv: "test",
      dryRun: true,
      retentionDays: 30,
      styleLearningEnabled: true,
      lexiconEnabled: true,
      lexiconPath: "./data/lexicon.json",
      personaEnabled: true,
      personaPath: "./data/persona.md",
      personaPrompt: "",
      personaAutoEnabled: true,
      personaAutoPath: "./data/persona.auto.md",
    },
    spontaneous: {
      enabled: true,
      tickMs: 600_000,
      minIntervalSec: 3_600,
      dailyCap: 5,
      quietHours: { start: "00:00", end: "08:00" },
    },
  };

  return {
    ...base,
    ...overrides,
    discord: { ...base.discord, ...overrides.discord },
    channels: { ...base.channels, ...overrides.channels },
    opencode: { ...base.opencode, ...overrides.opencode },
    runtime: { ...base.runtime, ...overrides.runtime },
    spontaneous: { ...base.spontaneous, ...overrides.spontaneous },
  };
};
