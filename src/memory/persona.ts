import { readFileSync, statSync } from "node:fs";

type CacheEntry = { readonly mtimeMs: number; readonly value: string | undefined };
const cache = new Map<string, CacheEntry>();

const readFileCached = (path: string): string | undefined => {
  let mtimeMs: number;
  try {
    mtimeMs = statSync(path).mtimeMs;
  } catch {
    cache.set(path, { mtimeMs: 0, value: undefined });
    return undefined;
  }
  const cached = cache.get(path);
  if (cached && cached.mtimeMs === mtimeMs) return cached.value;

  try {
    const text = readFileSync(path, "utf8").trim();
    const value = text.length > 0 ? text : undefined;
    cache.set(path, { mtimeMs, value });
    return value;
  } catch {
    cache.set(path, { mtimeMs: 0, value: undefined });
    return undefined;
  }
};

/**
 * Fixed persona/instructions.
 * Manual source: inline PERSONA_PROMPT wins, else PERSONA_PATH file.
 * Auto source: PERSONA_AUTO_PATH file (periodically generated), appended after the manual block.
 */
export const loadPersona = (options: {
  readonly enabled: boolean;
  readonly prompt: string;
  readonly path: string;
  readonly autoEnabled?: boolean;
  readonly autoPath?: string;
}): string | undefined => {
  if (!options.enabled) return undefined;

  const inline = options.prompt.trim();
  const manual = inline.length > 0 ? inline.replace(/\\n/gu, "\n") : readFileCached(options.path);
  const auto =
    options.autoEnabled && options.autoPath ? readFileCached(options.autoPath) : undefined;

  const parts: string[] = [];
  if (manual && manual.trim().length > 0) parts.push(manual.trim());
  if (auto && auto.trim().length > 0) parts.push(`## 자동 추출 (최근 대본)\n${auto.trim()}`);
  return parts.length > 0 ? parts.join("\n\n") : undefined;
};
