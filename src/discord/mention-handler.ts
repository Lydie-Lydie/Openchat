import { DiscordAPIError, type Channel, type Message } from "discord.js";
import { isMentionUserAllowed, type AppConfig } from "../config.js";
import type { Db } from "../db/index.js";
import type { Logger } from "../logger.js";
import type { OpenCodeGateway } from "../opencode/client.js";
import { MENTION_SYSTEM, type ContextMessage } from "../opencode/prompts.js";
import { assembleMentionPrompt } from "../opencode/assemble.js";
import { DISABLED_TOOLS } from "../opencode/tools.js";
import {
  getChannelSettings,
  getUserAlias,
  insertApiCall,
  insertGenerated,
  recentGeneratedContents,
} from "../db/queries.js";
import { validateOutgoing } from "../safety/filters.js";
import {
  emojiTokenSet,
  formatEmojiList,
  sanitizeCustomEmojis,
  type EmojiInfo,
} from "./emoji.js";
import { chunkMessage } from "./chunk.js";
import { fetchRecentContext, toContextMessage } from "./context.js";
import type { RateLimiter } from "../safety/rate-limit.js";
import type { RuntimeState } from "../state.js";

export type MentionHandler = {
  handle(message: Message): Promise<void>;
};

export const createMentionHandler = (deps: {
  readonly config: AppConfig;
  readonly db: Db;
  readonly logger: Logger;
  readonly gateway: OpenCodeGateway;
  readonly rateLimiter: RateLimiter;
  readonly state: RuntimeState;
  readonly emojiProvider: (guild: Message["guild"]) => Promise<EmojiInfo[]>;
  readonly sendToChannel: (channelId: string, content: string) => Promise<string | null>;
}): MentionHandler => {
  const { config, db, logger, gateway, rateLimiter, emojiProvider, state, sendToChannel } =
    deps;

  const postDryRun = async (targetChannelId: string, text: string): Promise<void> => {
    const dryChannelId = config.channels.dryRunId;
    if (!dryChannelId) {
      logger.info({ channelId: targetChannelId, text }, "mention dry-run (no dry-run channel)");
      return;
    }
    for (const chunk of chunkMessage(`[dry-run] <#${targetChannelId}>\n${text}`)) {
      await sendToChannel(dryChannelId, chunk).catch(() => null);
    }
  };

  const isMentioned = (message: Message): boolean => {
    const botId = config.discord.appId;
    if (message.mentions.users.has(botId)) return true;
    if (message.mentions.repliedUser?.id === botId) return true;
    return message.content.includes(`<@${botId}>`) || message.content.includes(`<@!${botId}>`);
  };

  const nameOf = (message: Message): string =>
    getUserAlias(db, message.author.id) ?? message.author.username;

  const collectReplyChain = async (
    message: Message,
    depth: number,
  ): Promise<ContextMessage[]> => {
    const chain: ContextMessage[] = [];
    let current: Message | null = message;
    for (let i = 0; i < depth; i += 1) {
      if (!current) break;
      const reference = current.reference;
      if (!reference?.messageId) break;
      const target: Message | null = await current.fetchReference().catch(() => null);
      if (!target) break;
      chain.unshift(toContextMessage(target, nameOf));
      current = target;
    }
    return chain;
  };

  return {
    async handle(message) {
      if (message.author.bot || message.system) return;
      if (!isMentioned(message)) return;

      if (!isMentionUserAllowed(config, message.author.id)) {
        logger.debug(
          { authorId: message.author.id, guildId: message.guildId },
          "mention from non-allowed user ignored",
        );
        return;
      }

      const settings = getChannelSettings(db, message.channelId);
      if (settings && settings.mention_enabled === 0) return;

      const replyOut = async (text: string): Promise<void> => {
        if (state.dryRun) {
          await postDryRun(message.channelId, text);
          return;
        }
        await message.reply(text).catch(() => undefined);
      };

      const botId = config.discord.appId;
      const request = message.content
        .replace(new RegExp(`<@!?${botId}>`, "g"), "")
        .replace(/\s+/gu, " ")
        .trim();

      if (request.length === 0) {
        await replyOut("무엇을 도와줄까? 질문을 적어줘.");
        return;
      }

      if (!rateLimiter.tryConsume(`mention:${message.author.id}`, 5, 60_000)) {
        await replyOut("요청이 너무 많아. 잠시 후에 다시 시도해줘.");
        return;
      }

      if (
        !rateLimiter.tryConsume(
          "mention:global",
          config.discord.mentionGlobalPerMin,
          60_000,
        )
      ) {
        logger.warn("global mention rate limit reached");
        return;
      }

      const context = await fetchRecentContext(
        message.channel as unknown as Channel,
        15,
        nameOf,
        config.discord.appId,
      ).catch(() => []);
      const replyContext = message.reference?.messageId
        ? await collectReplyChain(message, 3)
        : [];
      const recentReplies = recentGeneratedContents(db, message.channelId, 8);
      const emojis = await emojiProvider(message.guild);

      const prompt = assembleMentionPrompt({
        config,
        db,
        request,
        requester: nameOf(message),
        context,
        ...(replyContext.length > 0 ? { replyContext } : {}),
        ...(recentReplies.length > 0 ? { recentReplies } : {}),
        availableEmojis: formatEmojiList(emojis),
      }).prompt;

      logger.info(
        { channelId: message.channelId, authorId: message.author.id, contextCount: context.length },
        "handling mention",
      );

      if (!state.dryRun && "sendTyping" in message.channel) {
        await message.channel.sendTyping().catch(() => undefined);
      }

      const generate = (extra?: string) =>
        gateway.generate({
          model: config.opencode.models.mention,
          system: MENTION_SYSTEM,
          tools: DISABLED_TOOLS,
          prompt: extra ? `${prompt}\n\n${extra}` : prompt,
        });

      const recordApiCall = (r: NonNullable<Awaited<ReturnType<typeof generate>>>): void => {
        insertApiCall(db, {
          kind: "mention_reply",
          model: config.opencode.models.mention,
          latencyMs: r.latencyMs,
          ok: r.errorName === undefined,
          error: r.errorName ?? null,
          inputTokens: r.usage?.input ?? null,
          outputTokens: r.usage?.output ?? null,
          cost: r.usage?.cost ?? null,
        });
      };

      let replyText: string;
      let result = await generate().catch((error: unknown) => {
        logger.error({ error: String(error) }, "opencode mention call failed");
        return undefined;
      });

      if (!result) {
        insertApiCall(db, {
          kind: "mention_reply",
          model: config.opencode.models.mention,
          latencyMs: 0,
          ok: false,
          error: "request_failed",
          inputTokens: null,
          outputTokens: null,
          cost: null,
        });
        await replyOut("지금 답변을 만들지 못했어. 잠시 후 다시 시도해줘.");
        return;
      }

      recordApiCall(result);

      replyText = sanitizeCustomEmojis(result.text.trim(), emojiTokenSet(emojis));
      if (replyText.length === 0) {
        replyText = "답변을 만들지 못했어. 다시 물어봐줘.";
      }

      // Anti-repetition: if the reply is too similar to recent replies, regenerate once.
      const recentForCheck = [...recentReplies, ...context.map((c) => c.content)];
      const validation = validateOutgoing({
        text: replyText,
        maxLength: 2000,
        recent: recentForCheck,
      });
      if (!validation.ok && validation.reason === "duplicate") {
        const retry = await generate(
          "방금 네가 쓴 문장과 너무 비슷하다. 같은 표현을 반복하지 말고 완전히 다른 문장으로 다시 써라.",
        ).catch(() => undefined);
        if (retry) {
          recordApiCall(retry);
          const retryText = sanitizeCustomEmojis(retry.text.trim(), emojiTokenSet(emojis));
          if (retryText.length > 0) {
            replyText = retryText;
            result = retry;
          }
        }
      }

      if (state.dryRun) {
        logger.info(
          { channelId: message.channelId, authorId: message.author.id, replyText },
          "mention dry-run (not sent)",
        );
        await postDryRun(message.channelId, replyText);
        insertGenerated(db, {
          channelId: message.channelId,
          kind: "mention_reply",
          content: replyText,
          model: config.opencode.models.mention,
          sentMessageId: null,
          accepted: false,
          reason: "dry_run",
        });
        return;
      }

      const chunks = chunkMessage(replyText);
      const sendFn = await resolveSendFn(message, logger, config.discord.mentionReplyInline);

      let firstSentId: string | null = null;
      for (const chunk of chunks) {
        try {
          const sent = await sendFn(chunk);
          firstSentId = firstSentId ?? sent.id;
        } catch (error) {
          if (error instanceof DiscordAPIError) {
            logger.error({ error: error.message }, "failed to send reply chunk");
            break;
          }
          throw error;
        }
      }

      insertGenerated(db, {
        channelId: message.channelId,
        kind: "mention_reply",
        content: replyText,
        model: config.opencode.models.mention,
        sentMessageId: firstSentId,
        accepted: firstSentId !== null,
        reason: result.errorName ?? null,
      });
    },
  };
};

type SendFn = (content: string) => Promise<{ id: string }>;

const resolveSendFn = async (
  message: Message,
  logger: Logger,
  inline: boolean,
): Promise<SendFn> => {
  const channel = message.channel;

  // Inline reply (default): answer directly in the channel/thread/DM.
  if (inline) {
    return (content) => message.reply(content);
  }

  if (channel.isThread()) {
    const sendable = channel as unknown as {
      send(content: string): Promise<{ id: string }>;
    };
    return (content) => sendable.send(content);
  }

  if (typeof message.startThread === "function") {
    try {
      const thread = await message.startThread({
        name: `${config.botName} · ${message.author.username}`.slice(0, 90),
        autoArchiveDuration: 1440,
      });
      logger.debug({ threadId: thread.id }, "created thread for mention reply");
      return (content) => thread.send(content);
    } catch (error) {
      logger.warn({ error: String(error) }, "failed to open thread, replying inline");
    }
  }

  return (content) => message.reply(content);
};
