import type { AppConfig } from "../config.js";
import type { Db } from "../db/index.js";
import type { Logger } from "../logger.js";
import type { RuntimeState } from "../state.js";
import type { OpenCodeGateway } from "../opencode/client.js";
import type { DiscordBot } from "../discord/client.js";
import { SPONTANEOUS_SYSTEM, buildSpontaneousPrompt } from "../opencode/prompts.js";
import { extractJson } from "../opencode/json.js";
import { asSpontaneousDecision } from "../opencode/schemas.js";
import { DISABLED_TOOLS } from "../opencode/tools.js";
import { isChatLike, stripMentions, validateOutgoing } from "../safety/filters.js";
import { selectStyleSamples } from "../memory/samples.js";
import { loadFormattedLexicon } from "../memory/lexicon.js";
import { loadPersona } from "../memory/persona.js";
import {
  emojiTokenSet,
  formatEmojiList,
  sanitizeCustomEmojis,
  type EmojiInfo,
} from "../discord/emoji.js";
import {
  getStyleProfile,
  insertApiCall,
  insertGenerated,
  recentGeneratedContents,
  searchMessages,
  spontaneousChannelIds,
  upsertChannelSettings,
} from "../db/queries.js";
import { evaluateConditions } from "./conditions.js";
import { formatDateTime } from "../util/time.js";

const MAX_OUTPUT_LENGTH = 300;
const MIN_CONTEXT_MESSAGES = 2;

const describeGenerationError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  if (/abort/i.test(message)) {
    return "timeout: 모델 응답이 제한 시간을 넘었습니다 (OPENCODE_TIMEOUT_MS)";
  }
  return message;
};

export type SpontaneousOutcome = {
  readonly channelId: string;
  readonly status: "sent" | "dry_run" | "declined" | "filtered" | "skipped" | "error";
  readonly message?: string;
  readonly reason?: string;
};

export type SpontaneousGenerator = {
  run(
    now?: Date,
    force?: boolean,
    channelIds?: readonly string[],
  ): Promise<SpontaneousOutcome[]>;
};

export const createSpontaneousGenerator = (deps: {
  readonly config: AppConfig;
  readonly db: Db;
  readonly logger: Logger;
  readonly state: RuntimeState;
  readonly gateway: OpenCodeGateway;
  readonly discord: DiscordBot;
}): SpontaneousGenerator => {
  const { config, db, logger, state, gateway, discord } = deps;

  const targetChannels = (): string[] => {
    const ids = new Set<string>(config.channels.spontaneousIds);
    for (const id of spontaneousChannelIds(db)) ids.add(id);
    return [...ids];
  };

  return {
    async run(now = new Date(), force = false, channelIds?: readonly string[]) {
      const targets = channelIds ?? targetChannels();
      const explicit = channelIds !== undefined;
      const outcomes: SpontaneousOutcome[] = [];
      for (const channelId of targets) {
        const condition = evaluateConditions({
          config,
          db,
          state,
          channelId,
          now,
          force,
          explicit,
        });
        if (!condition.ok) {
          logger.debug({ channelId, reason: condition.reason }, "spontaneous skipped");
          outcomes.push({ channelId, status: "skipped", reason: condition.reason });
          continue;
        }

        try {
          outcomes.push(await generateForChannel(channelId, now, force));
        } catch (error) {
          const reason = describeGenerationError(error);
          logger.error({ channelId, error: reason }, "spontaneous generation failed");
          outcomes.push({ channelId, status: "error", reason });
        }
      }
      return outcomes;
    },
  };

  async function generateForChannel(
    channelId: string,
    now: Date,
    testMode: boolean,
  ): Promise<SpontaneousOutcome> {
    const context = await discord.fetchContext(channelId, 20);
    if (context.length < MIN_CONTEXT_MESSAGES) {
      logger.debug({ channelId, context: context.length }, "not enough recent context");
      return { channelId, status: "skipped", reason: "not_enough_context" };
    }

    const profile = getStyleProfile(db, "global", "self");
    const lexicon = config.runtime.lexiconEnabled
      ? loadFormattedLexicon(config.runtime.lexiconPath)
      : undefined;
    const persona = loadPersona({
      enabled: config.runtime.personaEnabled,
      prompt: config.runtime.personaPrompt,
      path: config.runtime.personaPath,
      autoEnabled: config.runtime.personaAutoEnabled,
      autoPath: config.runtime.personaAutoPath,
    });
    const guildIds = config.discord.styleGuildIds;
    const channelIds = config.discord.styleChannelIds;
    const lastMessage = context.at(-1)?.content ?? "";
    const relevant = searchMessages(db, {
      text: lastMessage,
      limit: 5,
      selfOnly: true,
      guildIds,
      channelIds,
    });
    const chatRelevant = relevant
      .map((r) => r.content)
      .filter((content) => isChatLike(content))
      .map((content) => stripMentions(content))
      .filter((content) => content.length >= 2);
    const samples =
      chatRelevant.length >= 3
        ? chatRelevant.slice(0, 6)
        : selectStyleSamples(db, 8, { guildIds, channelIds });

    const emojis = await discord.emojiList(channelId).catch((): EmojiInfo[] => []);

    const prompt = buildSpontaneousPrompt({
      now: formatDateTime(now),
      recentContext: context,
      ...(persona ? { persona } : {}),
      ...(profile && config.runtime.styleLearningEnabled
        ? { styleProfile: profile.summary }
        : {}),
      ...(lexicon ? { lexicon } : {}),
      styleSamples: samples,
      availableEmojis: formatEmojiList(emojis),
      ...(state.lastSpontaneousAt
        ? { lastSpontaneousAt: formatDateTime(new Date(state.lastSpontaneousAt)) }
        : {}),
      testMode,
    });

    const result = await gateway.generate({
      model: config.opencode.models.spontaneous,
      system: SPONTANEOUS_SYSTEM,
      tools: DISABLED_TOOLS,
      prompt,
    });

    insertApiCall(db, {
      kind: "spontaneous",
      model: config.opencode.models.spontaneous,
      latencyMs: result.latencyMs,
      ok: result.errorName === undefined,
      error: result.errorName ?? null,
      inputTokens: result.usage?.input ?? null,
      outputTokens: result.usage?.output ?? null,
      cost: result.usage?.cost ?? null,
    });

    const decision = asSpontaneousDecision(extractJson(result.text));
    if (!decision || !decision.should_send || !decision.message) {
      logger.info(
        { channelId, shouldSend: decision?.should_send ?? false, reason: decision?.reason },
        "spontaneous declined",
      );
      insertGenerated(db, {
        channelId,
        kind: "spontaneous",
        content: decision?.message ?? "",
        model: config.opencode.models.spontaneous,
        sentMessageId: null,
        accepted: false,
        reason: decision?.reason ?? "no_send",
      });
      return {
        channelId,
        status: "declined",
        ...(decision?.message ? { message: decision.message } : {}),
        ...(decision?.reason ? { reason: decision.reason } : {}),
      };
    }

    const message = sanitizeCustomEmojis(decision.message, emojiTokenSet(emojis));
    const recent = [
      ...recentGeneratedContents(db, channelId, 10),
      ...context.map((c) => c.content),
    ];
    const validation = validateOutgoing({
      text: message,
      maxLength: MAX_OUTPUT_LENGTH,
      recent,
    });
    if (!validation.ok) {
      logger.info({ channelId, reason: validation.reason }, "spontaneous filtered");
      insertGenerated(db, {
        channelId,
        kind: "spontaneous",
        content: message,
        model: config.opencode.models.spontaneous,
        sentMessageId: null,
        accepted: false,
        reason: validation.reason,
      });
      return { channelId, status: "filtered", message, reason: validation.reason };
    }

    if (state.dryRun) {
      logger.info({ channelId, message, reason: decision.reason }, "spontaneous dry-run");
      const dryRunChannel = config.channels.dryRunId;
      if (dryRunChannel) {
        await discord
          .sendMessage(dryRunChannel, `[dry-run] <#${channelId}>\n${message}`)
          .catch(() => null);
      }
      insertGenerated(db, {
        channelId,
        kind: "spontaneous",
        content: message,
        model: config.opencode.models.spontaneous,
        sentMessageId: null,
        accepted: false,
        reason: `dry_run:${decision.reason ?? ""}`,
      });
      return {
        channelId,
        status: "dry_run",
        message,
        ...(decision.reason ? { reason: decision.reason } : {}),
      };
    }

    const sentId = await discord.sendMessage(channelId, message);
    if (sentId) {
      const timestamp = now.getTime();
      state.lastSpontaneousAt = timestamp;
      upsertChannelSettings(db, channelId, { last_spontaneous_at: timestamp });
    }
    insertGenerated(db, {
      channelId,
      kind: "spontaneous",
      content: message,
      model: config.opencode.models.spontaneous,
      sentMessageId: sentId,
      accepted: sentId !== null,
      reason: decision.reason ?? null,
    });

    return {
      channelId,
      status: sentId !== null ? "sent" : "error",
      message,
      ...(decision.reason ? { reason: decision.reason } : {}),
    };
  }
};
