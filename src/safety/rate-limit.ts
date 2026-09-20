export type RateLimiter = {
  tryConsume(key: string, limit: number, windowMs: number): boolean;
  reset(key?: string): void;
};

type Bucket = {
  count: number;
  resetAt: number;
};

export const createRateLimiter = (now: () => number = Date.now): RateLimiter => {
  const buckets = new Map<string, Bucket>();

  return {
    tryConsume(key, limit, windowMs) {
      const current = now();
      const bucket = buckets.get(key);
      if (!bucket || bucket.resetAt <= current) {
        buckets.set(key, { count: 1, resetAt: current + windowMs });
        return true;
      }
      if (bucket.count >= limit) return false;
      bucket.count += 1;
      return true;
    },

    reset(key) {
      if (key === undefined) {
        buckets.clear();
        return;
      }
      buckets.delete(key);
    },
  };
};
