import type { AppConfig } from "../config.js";
import type { Db } from "../db/index.js";
import type { RuntimeState } from "../state.js";
import {
  countSpontaneousToday,
  getChannelSettings,
} from "../db/queries.js";
import { isWithinQuietHours } from "../util/time.js";

export type ConditionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

export const evaluateConditions = (deps: {
  readonly config: AppConfig;
  readonly db: Db;
  readonly state: RuntimeState;
  readonly channelId: string;
  readonly now: Date;
  readonly force?: boolean;
  readonly explicit?: boolean;
}): ConditionResult => {
  const { config, db, state, channelId, now, force = false, explicit = false } = deps;

  const settings = getChannelSettings(db, channelId);
  if (!explicit) {
    const allowlisted = config.channels.spontaneousIds.includes(channelId);
    if (settings?.spontaneous_enabled === 0 && allowlisted) {
      return { ok: false, reason: "channel_disabled" };
    }
    if (settings?.spontaneous_enabled !== 1 && !allowlisted) {
      return { ok: false, reason: "channel_not_allowed" };
    }
  }

  if (force) return { ok: true };

  if (!config.spontaneous.enabled) return { ok: false, reason: "feature_disabled" };
  if (state.spontaneousPaused) return { ok: false, reason: "paused" };

  const quietHours = settings?.quiet_hours
    ? parseQuietHours(settings.quiet_hours)
    : config.spontaneous.quietHours;
  if (isWithinQuietHours(now, quietHours)) return { ok: false, reason: "quiet_hours" };

  const minIntervalSec = settings?.min_interval_sec ?? config.spontaneous.minIntervalSec;
  const lastAt = settings?.last_spontaneous_at ?? state.lastSpontaneousAt;
  if (lastAt !== null && now.getTime() - lastAt < minIntervalSec * 1000) {
    return { ok: false, reason: "min_interval" };
  }

  const dailyCap = settings?.daily_cap ?? config.spontaneous.dailyCap;
  if (countSpontaneousToday(db, channelId) >= dailyCap) {
    return { ok: false, reason: "daily_cap" };
  }

  return { ok: true };
};

const parseQuietHours = (raw: string): { start: string; end: string } | null => {
  const [start, end] = raw.split("-");
  if (!start || !end) return null;
  return { start, end };
};
