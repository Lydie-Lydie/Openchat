import { writeFileSync } from "node:fs";
import type { AppConfig } from "../config.js";
import type { Db } from "../db/index.js";
import type { Logger } from "../logger.js";
import type { OpenCodeGateway } from "../opencode/client.js";
import { STYLE_SYSTEM, buildStyleProfilePrompt } from "../opencode/prompts.js";
import { extractJson } from "../opencode/json.js";
import { asStyleProfile, type StyleProfileResult } from "../opencode/schemas.js";
import { DISABLED_TOOLS } from "../opencode/tools.js";
import {
  getMemoryState,
  getStyleProfile,
  insertApiCall,
  saveMemoryState,
  selfMessageFirstLines,
  selfMessageSignature,
  upsertStyleProfile,
} from "../db/queries.js";
import { containsSensitiveData } from "../safety/filters.js";
import { selectStyleSamples } from "./samples.js";

const MIN_SAMPLES = 6;
const MAX_SAMPLES = 80;
const TOPIC_HINT_POOL = 200;
const MAX_TOPIC_HINTS = 40;

const normalizeForMatch = (text: string): string =>
  text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

const verifyVerbatim = (
  items: readonly string[] | undefined,
  haystack: string,
): string[] | undefined => {
  if (!items || items.length === 0) return undefined;
  const kept = items.filter((item) => {
    const key = normalizeForMatch(item.replace(/^[~～]+\s*/u, ""));
    if (key.length < 2) return true;
    return haystack.includes(key);
  });
  return kept.length > 0 ? kept : undefined;
};

const composeSummary = (profile: StyleProfileResult): string => {
  const lines: string[] = [profile.summary.trim()];

  const labelled: [string, string | undefined][] = [
    ["존댓말/반말", profile.formality],
    ["말투", profile.tone],
    ["길이", profile.avg_length],
    ["문장 끝맺음", profile.sentence_endings?.join(", ")],
    ["자주 쓰는 표현", profile.common_phrases?.join(", ")],
    ["감탄사", profile.interjections?.join(", ")],
    ["문장부호/띄어쓰기", profile.punctuation],
    ["이모지", profile.emoji_usage],
    ["한영 혼용", profile.code_switching],
    ["유머", profile.humor],
    ["인사", profile.greetings?.join(" / ")],
    ["반응", profile.reactions?.join(" / ")],
    ["주요 주제", profile.topics?.join(", ")],
    ["피해야 할 것", profile.avoid?.join(", ")],
  ];

  for (const [label, value] of labelled) {
    if (value && value.trim().length > 0) lines.push(`${label}: ${value.trim()}`);
  }

  return lines.join("\n");
};

export const rebuildStyleProfile = async (deps: {
  readonly config: AppConfig;
  readonly db: Db;
  readonly logger: Logger;
  readonly gateway: OpenCodeGateway;
  readonly force?: boolean;
}): Promise<boolean> => {
  const { config, db, logger, gateway, force = false } = deps;
  if (!config.runtime.styleLearningEnabled) {
    logger.info(
      "style learning disabled (STYLE_LEARNING_ENABLED=false); skipping profile rebuild",
    );
    return false;
  }
  const guildIds = config.discord.styleGuildIds;
  const channelIds = config.discord.styleChannelIds;

  if (!force) {
    const signature = selfMessageSignature(db, { guildIds, channelIds });
    const state = getMemoryState(db);
    const hasProfile = getStyleProfile(db, "global", "self") !== undefined;
    if (
      state &&
      hasProfile &&
      state.source_count === signature.count &&
      state.source_max_created_at === signature.maxCreatedAt
    ) {
      logger.info(
        { count: signature.count, maxCreatedAt: signature.maxCreatedAt },
        "memory unchanged; skipping style/persona rebuild",
      );
      return false;
    }
  }

  const samples = selectStyleSamples(db, MAX_SAMPLES, { guildIds, channelIds });

  if (samples.length < MIN_SAMPLES) {
    logger.warn(
      {
        samples: samples.length,
        required: MIN_SAMPLES,
        guilds: guildIds.length,
        channels: channelIds.length,
      },
      "not enough chat-like self messages to build style profile",
    );
    return false;
  }

  const topicHints = selfMessageFirstLines(db, TOPIC_HINT_POOL, { guildIds, channelIds })
    .filter((line) => line.length > 0 && !containsSensitiveData(line))
    .slice(0, MAX_TOPIC_HINTS);

  const result = await gateway.generate({
    model: config.opencode.models.styleSummary,
    system: STYLE_SYSTEM,
    tools: DISABLED_TOOLS,
    prompt: buildStyleProfilePrompt(samples, topicHints),
  });

  insertApiCall(db, {
    kind: "style_summary",
    model: config.opencode.models.styleSummary,
    latencyMs: result.latencyMs,
    ok: result.errorName === undefined,
    error: result.errorName ?? null,
    inputTokens: result.usage?.input ?? null,
    outputTokens: result.usage?.output ?? null,
    cost: result.usage?.cost ?? null,
  });

  const raw = asStyleProfile(extractJson(result.text));
  if (!raw) {
    logger.warn({ text: result.text.slice(0, 200) }, "failed to parse style profile");
    return false;
  }

  const haystack = normalizeForMatch(samples.join(" "));
  const dropped: string[] = [];
  const verified = (
    label: string,
    items: readonly string[] | undefined,
  ): string[] | undefined => {
    const kept = verifyVerbatim(items, haystack);
    if (items && items.length > 0) {
      for (const item of items) {
        if (!kept?.includes(item)) dropped.push(`${label}:${item}`);
      }
    }
    return kept;
  };

  const commonPhrases = verified("common_phrases", raw.common_phrases);
  const interjections = verified("interjections", raw.interjections);
  const greetings = verified("greetings", raw.greetings);
  const reactions = verified("reactions", raw.reactions);

  const {
    common_phrases: _cp,
    interjections: _it,
    greetings: _gr,
    reactions: _re,
    ...rest
  } = raw;

  const parsed: StyleProfileResult = {
    ...rest,
    ...(commonPhrases ? { common_phrases: commonPhrases } : {}),
    ...(interjections ? { interjections } : {}),
    ...(greetings ? { greetings } : {}),
    ...(reactions ? { reactions } : {}),
  };

  if (dropped.length > 0) {
    logger.info({ dropped: dropped.slice(0, 10) }, "dropped unverified style phrases");
  }

  upsertStyleProfile(db, {
    scope: "global",
    scopeId: "self",
    summary: composeSummary(parsed),
    samplesCount: samples.length,
    model: config.opencode.models.styleSummary,
  });

  if (config.runtime.personaEnabled && config.runtime.personaAutoEnabled) {
    const personaText = parsed.persona?.trim();
    if (personaText && personaText.length > 0) {
      writeFileSync(config.runtime.personaAutoPath, personaText + "\n", "utf8");
      logger.info({ path: config.runtime.personaAutoPath }, "auto persona updated");
    }
  }

  const signature = selfMessageSignature(db, { guildIds, channelIds });
  saveMemoryState(db, signature.count, signature.maxCreatedAt);

  logger.info(
    {
      samples: samples.length,
      topicHints: topicHints.length,
      guilds: guildIds.length,
      channels: channelIds.length,
    },
    "style profile updated",
  );
  return true;
};
