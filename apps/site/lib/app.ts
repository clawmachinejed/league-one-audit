// apps/site/lib/app.ts
import { createApp } from "@l1/app";
import { createLuxonClock } from "@l1/adapters-clock";
import { createInMemoryRateLimiter } from "@l1/adapters-ratelimiter";
import { createConsoleLogger } from "@l1/adapters-logger";
import { createOgRenderer } from "@l1/adapters-og";
import { createEnvConfig } from "@l1/adapters-config";
import { createSleeperRepo, createSeedSleeperRepo } from "@l1/adapters-sleeper";

let _app: ReturnType<typeof createApp> | null = null;

export function getApp() {
  if (_app) return _app;

  const config = createEnvConfig();

  // Try live Sleeper; if env is missing (CI/local), fall back to seed so build won't crash.
  let sleeper;
  try {
    sleeper = createSleeperRepo(config);
  } catch (_err) {
    // Missing SLEEPER_LEAGUE_ID (e.g., CI) → use seed data
    sleeper = createSeedSleeperRepo();
  }

  _app = createApp({
    clock: createLuxonClock(),
    logger: createConsoleLogger(),
    limiter: createInMemoryRateLimiter(),
    og: createOgRenderer(),
    config,
    sleeper,
  });

  return _app;
}
