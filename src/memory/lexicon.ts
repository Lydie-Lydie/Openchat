import { readFileSync, statSync } from "node:fs";

export type LexiconEntry = readonly [string, number];

export type LexiconStructure = {
  readonly messages?: number;
  readonly avg_words?: number;
  readonly avg_chars?: number;
  readonly polite_ratio?: number;
  readonly ending_types?: Record<string, number>;
};

export type Lexicon = {
  readonly generated_at?: number;
  readonly analyzer?: string;
  readonly message_count?: number;
  readonly subjects?: readonly LexiconEntry[];
  readonly objects?: readonly LexiconEntry[];
  readonly nouns?: readonly LexiconEntry[];
  readonly verbs?: readonly LexiconEntry[];
  readonly adjectives?: readonly LexiconEntry[];
  readonly adverbs?: readonly LexiconEntry[];
  readonly endings?: readonly LexiconEntry[];
  readonly connectives?: readonly LexiconEntry[];
  readonly interjections?: readonly LexiconEntry[];
  readonly structure?: LexiconStructure;
};

let cache: { path: string; mtimeMs: number; value: Lexicon | undefined } | undefined;

export const loadLexicon = (path: string): Lexicon | undefined => {
  let mtimeMs: number;
  try {
    mtimeMs = statSync(path).mtimeMs;
  } catch {
    cache = { path, mtimeMs: 0, value: undefined };
    return undefined;
  }
  if (cache && cache.path === path && cache.mtimeMs === mtimeMs) return cache.value;

  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as Lexicon;
    cache = { path, mtimeMs, value };
    return value;
  } catch {
    cache = { path, mtimeMs, value: undefined };
    return undefined;
  }
};

const words = (entries: readonly LexiconEntry[] | undefined, limit: number): string =>
  (entries ?? [])
    .slice(0, limit)
    .map(([word]) => word)
    .join(", ");

const endings = (entries: readonly LexiconEntry[] | undefined, limit: number): string =>
  (entries ?? [])
    .slice(0, limit)
    .map(([word]) => `~${word}`)
    .join(", ");

const predicates = (lex: Lexicon): string => {
  const seen = new Set<string>();
  const merged: string[] = [];
  const sorted = [...(lex.verbs ?? []), ...(lex.adjectives ?? [])].sort((a, b) => b[1] - a[1]);
  for (const [word] of sorted) {
    if (seen.has(word)) continue;
    seen.add(word);
    merged.push(word);
    if (merged.length >= 18) break;
  }
  return merged.join(", ");
};

const structureLine = (st: LexiconStructure | undefined): string | undefined => {
  if (!st) return undefined;
  const parts: string[] = [];
  if (st.avg_words !== undefined) parts.push(`평균 ${st.avg_words}어절`);
  if (st.avg_chars !== undefined) parts.push(`평균 ${st.avg_chars}자`);
  if (st.polite_ratio !== undefined) {
    const polite = Math.round(st.polite_ratio * 100);
    parts.push(`해요체 ${polite}% / 반말 ${100 - polite}%`);
  }
  if (st.ending_types) {
    const types = st.ending_types;
    const summary = ["평서", "의문", "청유", "명령"]
      .filter((key) => types[key] !== undefined)
      .map((key) => `${key} ${Math.round((types[key] ?? 0) * 100)}%`)
      .join(", ");
    if (summary) parts.push(summary);
  }
  return parts.length > 0 ? `- 문장 구조: ${parts.join(" · ")}` : undefined;
};

/** Render the lexicon as a compact prompt block (deterministic, no LLM). */
export const formatLexicon = (lex: Lexicon | undefined): string | undefined => {
  if (!lex) return undefined;
  const lines: string[] = [];
  const subjects = words(lex.subjects, 15);
  const objects = words(lex.objects, 15);
  const nouns = words(lex.nouns, 20);
  const verbPhrase = predicates(lex);
  const adverbs = words(lex.adverbs, 15);
  const finalEndings = endings(lex.endings, 15);
  const interjections = words(lex.interjections, 12);
  const structure = structureLine(lex.structure);
  if (subjects) lines.push(`- 자주 쓰는 주어: ${subjects}`);
  if (objects) lines.push(`- 자주 쓰는 목적어: ${objects}`);
  if (nouns) lines.push(`- 자주 쓰는 명사: ${nouns}`);
  if (verbPhrase) lines.push(`- 자주 쓰는 서술어: ${verbPhrase}`);
  if (adverbs) lines.push(`- 자주 쓰는 부사: ${adverbs}`);
  if (finalEndings) lines.push(`- 문장 끝맺음: ${finalEndings}`);
  if (interjections) lines.push(`- 감탄사: ${interjections}`);
  if (structure) lines.push(structure);
  return lines.length > 0 ? lines.join("\n") : undefined;
};

let formattedCache: { path: string; mtimeMs: number; value: string | undefined } | undefined;

/** Cached formatted lexicon block (keyed by file mtime). */
export const loadFormattedLexicon = (path: string): string | undefined => {
  let mtimeMs: number;
  try {
    mtimeMs = statSync(path).mtimeMs;
  } catch {
    formattedCache = { path, mtimeMs: 0, value: undefined };
    return undefined;
  }
  if (formattedCache && formattedCache.path === path && formattedCache.mtimeMs === mtimeMs) {
    return formattedCache.value;
  }
  const value = formatLexicon(loadLexicon(path));
  formattedCache = { path, mtimeMs, value };
  return value;
};
