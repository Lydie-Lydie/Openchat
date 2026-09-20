import type { Db } from "../db/index.js";
import { selfMessageSample } from "../db/queries.js";
import { isChatLike, stripMentions } from "../safety/filters.js";

export type SampleOptions = {
  readonly pool?: number;
  readonly guildIds?: readonly string[];
  readonly channelIds?: readonly string[];
};

export const selectStyleSamples = (
  db: Db,
  limit: number,
  options: SampleOptions = {},
): string[] => {
  const scope = {
    ...(options.guildIds ? { guildIds: options.guildIds } : {}),
    ...(options.channelIds ? { channelIds: options.channelIds } : {}),
  };
  const candidates = selfMessageSample(db, options.pool ?? 5000, undefined, scope);
  const result: string[] = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    if (!isChatLike(candidate)) continue;
    const value = stripMentions(candidate);
    if (value.length < 2) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
    if (result.length >= limit) break;
  }

  return result;
};
