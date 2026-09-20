import type { OutputFormat } from "@opencode-ai/sdk/v2";

export type SpontaneousDecision = {
  readonly should_send: boolean;
  readonly message?: string;
  readonly reason?: string;
};

export type StyleProfileResult = {
  readonly summary: string;
  readonly persona?: string;
  readonly formality?: string;
  readonly tone?: string;
  readonly avg_length?: string;
  readonly sentence_endings?: readonly string[];
  readonly common_phrases?: readonly string[];
  readonly interjections?: readonly string[];
  readonly punctuation?: string;
  readonly emoji_usage?: string;
  readonly code_switching?: string;
  readonly humor?: string;
  readonly greetings?: readonly string[];
  readonly reactions?: readonly string[];
  readonly topics?: readonly string[];
  readonly avoid?: readonly string[];
};

export const spontaneousFormat: OutputFormat = {
  type: "json_schema",
  schema: {
    type: "object",
    properties: {
      should_send: {
        type: "boolean",
        description:
          "Whether it is natural for the user to send a message in this channel right now.",
      },
      message: {
        type: "string",
        description:
          "The message to send, in the user's own casual Korean voice. Required when should_send is true.",
      },
      reason: {
        type: "string",
        description: "Short internal reason for the decision. Never shown to users.",
      },
    },
    required: ["should_send"],
  },
  retryCount: 2,
};

export const styleProfileFormat: OutputFormat = {
  type: "json_schema",
  schema: {
    type: "object",
    properties: {
      summary: {
        type: "string",
        description:
          "A detailed Korean description (4-8 sentences) of how this person actually chats. Cover tone, personality, rhythm, and how they treat the reader.",
      },
      persona: {
        type: "string",
        description:
          "The person's stable personality, attitudes, and values as 3-6 concise Korean bullet lines (each starting with '- '). Only describe what is observable in the samples; never invent facts.",
      },
      formality: {
        type: "string",
        description:
          "Politeness level in Korean, e.g. 반말 위주 / 존댓말 위주 / 상황에 따라 혼용. Explain when each is used.",
      },
      tone: {
        type: "string",
        description: "e.g. 캐주얼하고 장난스러운, 무뚝뚝한, 다정한, 시니컬한",
      },
      avg_length: {
        type: "string",
        description:
          "Typical message length with a range and a number, e.g. 짧음 (5-20자, 대부분 한 줄).",
      },
      sentence_endings: {
        type: "array",
        items: { type: "string" },
        description:
          "Actual sentence endings and verb forms the person uses repeatedly, e.g. ~하더라, ~인 듯, ~할까, ~거든, ~ㅋ",
      },
      common_phrases: {
        type: "array",
        items: { type: "string" },
        description: "Recurring phrases copied verbatim from the samples.",
      },
      interjections: {
        type: "array",
        items: { type: "string" },
        description: "Interjections and onomatopoeia, e.g. 으흐흐, 하와와, 헐, ㅇㅇ.",
      },
      punctuation: {
        type: "string",
        description:
          "Punctuation and spacing habits, e.g. 마침표 거의 안 씀, 띄어쓰기 느슨함, ㅋㅋ/ㅎㅎ 붙임.",
      },
      emoji_usage: {
        type: "string",
        description:
          "Whether and how emoji or emoticons are used, e.g. 이모지 거의 안 씀, 가끔 😅.",
      },
      code_switching: {
        type: "string",
        description:
          "How Korean and English/technical terms are mixed, e.g. 기술 용어는 영어 그대로, 나머지는 한글.",
      },
      humor: {
        type: "string",
        description: "How the person jokes, teases, or reacts, if at all.",
      },
      greetings: {
        type: "array",
        items: { type: "string" },
        description: "How the person typically opens a conversation, verbatim if possible.",
      },
      reactions: {
        type: "array",
        items: { type: "string" },
        description:
          "How the person agrees, disagrees, or responds to others, verbatim if possible.",
      },
      topics: {
        type: "array",
        items: { type: "string" },
        description: "Topics the person talks about most, ordered by frequency.",
      },
      avoid: {
        type: "array",
        items: { type: "string" },
        description:
          "Things that would break the illusion, e.g. 과하게 정중한 존댓말, 이모지 남발, 긴 목록.",
      },
    },
    required: ["summary"],
  },
  retryCount: 2,
};

export const asSpontaneousDecision = (value: unknown): SpontaneousDecision | undefined => {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.should_send !== "boolean") return undefined;
  return {
    should_send: record.should_send,
    ...(typeof record.message === "string" ? { message: record.message } : {}),
    ...(typeof record.reason === "string" ? { reason: record.reason } : {}),
  };
};

const stringArray = (value: unknown): string[] | undefined =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : undefined;

export const asStyleProfile = (value: unknown): StyleProfileResult | undefined => {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.summary !== "string") return undefined;

  const result: Record<string, unknown> = { summary: record.summary };
  const stringKeys = [
    "persona",
    "formality",
    "tone",
    "avg_length",
    "punctuation",
    "emoji_usage",
    "code_switching",
    "humor",
  ] as const;
  const arrayKeys = [
    "sentence_endings",
    "common_phrases",
    "interjections",
    "greetings",
    "reactions",
    "topics",
    "avoid",
  ] as const;

  for (const key of stringKeys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) result[key] = value;
  }
  for (const key of arrayKeys) {
    const value = stringArray(record[key]);
    if (value && value.length > 0) result[key] = value;
  }

  return result as StyleProfileResult;
};
