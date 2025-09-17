export interface RateLimiterPort {
  take(key: string, ttlSeconds: number): Promise<boolean>;
}
