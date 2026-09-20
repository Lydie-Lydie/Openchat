const URL_PATTERN = /(https?:\/\/|www\.|discord\.gg\/|notion\.so|youtu\.be\/)/iu;
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/u;
const CODE_FENCE_PATTERN = /```/u;
const CREDENTIAL_PATTERN =
  /(password|passwd|pwd|account|token|secret|api[_-]?key|비밀번호|계정|주민등록|아이디|(?:^|\s)id\s*[:：])/iu;

const SECRET_PATTERNS: readonly RegExp[] = [
  /\b\d{6}-?\d{7}\b/u,
  /\b\d{3}-\d{2}-\d{4}\b/u,
  /\b(?:\d[ -]?){13,16}\b/u,
  /\b01[016789][ -]?\d{3,4}[ -]?\d{4}\b/u,
  EMAIL_PATTERN,
  CREDENTIAL_PATTERN,
];

const FORMAT_PATTERNS: readonly RegExp[] = [URL_PATTERN, CODE_FENCE_PATTERN];

export const containsSecretData = (text: string): boolean =>
  SECRET_PATTERNS.some((pattern) => pattern.test(text));

export const containsSensitiveData = (text: string): boolean =>
  containsSecretData(text) || FORMAT_PATTERNS.some((pattern) => pattern.test(text));

const HANGUL_PATTERN = /[\u3131-\u318E\uAC00-\uD7A3]/gu;
const JAMO_PATTERN = /[\u3131-\u318E]/gu;
const MENTION_PATTERN = /<@[!&]?\d+>|<#\d+>|<a?:\w+:\d+>/gu;

export const stripMentions = (text: string): string =>
  text.replace(MENTION_PATTERN, " ").replace(/\s+/gu, " ").trim();
const DIGIT_PATTERN = /[0-9]/gu;
const SYMBOL_PATTERN = /[^\u3131-\u318E\uAC00-\uD7A3A-Za-z0-9\s]/gu;

const REPEAT_PATTERN = /([\uAC00-\uD7A3])\1/u;
const CHAT_ENDING_PATTERN =
  /(요|다|어|아|지|네|야|자|까|죠|함|임|음|나|냐|줘|봐|래|걸|거든|더라|는데|지만|네요|나요|까요|할래|했어|있어|없어|같아|싶어|맞아|그래|됐어|인듯|중|녕|해|응|웅|잉|헐|셈|냥|당|랑|죵|용)$/u;
const CHAT_MARKER_PATTERN = /(ㅋㅋ|ㅎㅎ|ㅇㅇ|ㅠㅠ|ㅜㅜ|ㅗㅗ|ㅁㅊ|ㄷㄷ|ㅇㅋ)/u;
const PUNCT_PATTERN = /[?？!！~]/u;

export const isChatLike = (text: string): boolean => {
  const raw = text.trim();
  if (raw.length < 2 || raw.length > 60) return false;
  if (raw.includes("\n")) return false;
  if (containsSensitiveData(raw)) return false;

  const cleaned = raw.replace(MENTION_PATTERN, " ").trim();
  const visible = cleaned.replace(/\s+/gu, "");
  if (visible.length < 2) return false;

  const hangul = (cleaned.match(HANGUL_PATTERN) ?? []).length;
  if (hangul / visible.length < 0.5) return false;

  const digits = (cleaned.match(DIGIT_PATTERN) ?? []).length;
  if (digits / visible.length > 0.15) return false;

  const symbols = (cleaned.match(SYMBOL_PATTERN) ?? []).length;
  if (symbols / visible.length > 0.35) return false;

  const tokens = cleaned.split(/\s+/u).filter(Boolean);
  const longest = tokens.reduce((max, token) => Math.max(max, token.length), 0);
  if (longest > 20) return false;

  if (visible.length >= 40 && tokens.length < 4) return false;

  if (visible.length <= 10 && REPEAT_PATTERN.test(cleaned)) return true;
  if (CHAT_ENDING_PATTERN.test(cleaned)) return true;
  if (CHAT_MARKER_PATTERN.test(cleaned)) return true;
  if ((cleaned.match(JAMO_PATTERN) ?? []).length >= 2) return true;
  if (PUNCT_PATTERN.test(cleaned) && visible.length <= 12) return true;

  return false;
};

const normalize = (text: string): string =>
  text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/gu, " ").trim();

const shingles = (text: string, size = 3): Set<string> => {
  const tokens = normalize(text).split(" ").filter(Boolean);
  const result = new Set<string>();
  for (let i = 0; i < tokens.length; i += 1) {
    result.add(tokens.slice(i, i + size).join(" "));
  }
  if (result.size === 0 && text.trim().length > 0) result.add(normalize(text));
  return result;
};

export const similarity = (a: string, b: string): number => {
  const left = shingles(a);
  const right = shingles(b);
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const item of left) {
    if (right.has(item)) intersection += 1;
  }
  const union = left.size + right.size - intersection;
  return union === 0 ? 0 : intersection / union;
};

export const isTooSimilar = (
  candidate: string,
  others: readonly string[],
  threshold = 0.6,
): boolean => others.some((other) => similarity(candidate, other) >= threshold);

export type FilterResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

export const validateOutgoing = (input: {
  readonly text: string;
  readonly maxLength: number;
  readonly recent: readonly string[];
}): FilterResult => {
  const text = input.text.trim();
  if (text.length === 0) return { ok: false, reason: "empty" };
  if (text.length > input.maxLength) return { ok: false, reason: "too_long" };
  if (containsSensitiveData(text)) return { ok: false, reason: "sensitive" };
  if (isTooSimilar(text, input.recent)) return { ok: false, reason: "duplicate" };
  return { ok: true };
};
