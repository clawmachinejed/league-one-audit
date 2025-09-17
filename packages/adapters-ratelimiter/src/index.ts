import type { RateLimiterPort } from "@l1/ports";
type Entry = { until: number };
export function createInMemoryRateLimiter(): RateLimiterPort {
  const map = new Map<string, Entry>();
  return {
    async take(key: string, ttlSeconds: number) {
      const now = Date.now();
      const entry = map.get(key);
      if (entry && entry.until > now) return false;
      map.set(key, { until: now + ttlSeconds * 1000 });
      return true;
    },
  };
}
