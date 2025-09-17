import { createApp } from "@l1/app";
import { createLuxonClock } from "@l1/adapters-clock";
import { createInMemoryRateLimiter } from "@l1/adapters-ratelimiter";
import { createConsoleLogger } from "@l1/adapters-logger";
import { createOgRenderer } from "@l1/adapters-og";
import { createEnvConfig } from "@l1/adapters-config";
import { createSeedSleeperRepo } from "@l1/adapters-sleeper";

let _app: ReturnType<typeof createApp> | null = null;
export function getApp() {
  if (_app) return _app;
  _app = createApp({
    clock: createLuxonClock(),
    logger: createConsoleLogger(),
    limiter: createInMemoryRateLimiter(),
    og: createOgRenderer(),
    config: createEnvConfig(),
    sleeper: createSeedSleeperRepo(),
  });
  return _app;
}
