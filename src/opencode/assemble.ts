import type { AppConfig } from "../config.js";
import type { Db } from "../db/index.js";
import { getStyleProfile, searchMessages } from "../db/queries.js";
import { selectStyleSamples } from "../memory/samples.js";
import { loadFormattedLexicon } from "../memory/lexicon.js";
import { loadPersona } from "../memory/persona.js";
import { isChatLike, stripMentions } from "../safety/filters.js";
import { buildMentionPrompt, type ContextMessage } from "./prompts.js";

export type MentionAssembly = {
  readonly prompt: string;
  readonly samples: readonly string[];
  readonly profileVersion: number | undefined;
  readonly hasLexicon: boolean;
  readonly hasPersona: boolean;
};

/** Single source of truth for assembling a mention prompt (runtime + diagnostics). */
export const assembleMentionPrompt = (deps: {
  readonly config: AppConfig;
  readonly db: Db;
  readonly request: string;
  readonly requester: string;
  readonly context: readonly ContextMessage[];
  readonly replyContext?: readonly ContextMessage[];
  readonly recentReplies?: readonly string[];
  readonly availableEmojis?: string;
}): MentionAssembly => {
  const { config, db, request, requester, context } = deps;

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
  const relevant = searchMessages(db, {
    text: request,
    limit: 10,
    selfOnly: true,
    guildIds,
    channelIds,
  })
    .map((row) => row.content)
    .filter((content) => isChatLike(content))
    .map((content) => stripMentions(content))
    .filter((content) => content.length >= 2);
  const samples =
    relevant.length >= 3
      ? relevant.slice(0, 6)
      : selectStyleSamples(db, 8, { guildIds, channelIds });

  const prompt = buildMentionPrompt({
    requester,
    request,
    context,
    ...(deps.replyContext && deps.replyContext.length > 0
      ? { replyContext: deps.replyContext }
      : {}),
    ...(deps.recentReplies && deps.recentReplies.length > 0
      ? { recentReplies: deps.recentReplies }
      : {}),
    ...(persona ? { persona } : {}),
    ...(profile && config.runtime.styleLearningEnabled ? { styleProfile: profile.summary } : {}),
    ...(lexicon ? { lexicon } : {}),
    styleSamples: samples,
    ...(deps.availableEmojis ? { availableEmojis: deps.availableEmojis } : {}),
  });

  return {
    prompt,
    samples,
    profileVersion: profile?.version,
    hasLexicon: Boolean(lexicon),
    hasPersona: Boolean(persona),
  };
};
