import type { ConfigPort } from "@l1/ports";
import { z } from "zod";

const schema = z.object({
  SLEEPER_LEAGUE_ID: z.string().min(1).optional(),
  NEXT_PUBLIC_SITE_NAME: z.string().default("League One"),
  ADMIN_KEY: z.string().default("please-change-me"),
  DISCORD_ENABLED: z.string().default("0"),
  VERCEL_CRON_SECRET: z.string().optional(),
});

export function createEnvConfig(
  env: Record<string, string | undefined> = process.env,
): ConfigPort {
  const parsed = schema.safeParse(env);
  const data = parsed.success ? parsed.data : schema.parse({});
  return {
    get: (key, fallback: any = undefined) => {
      const val = env[key] ?? (data as any)[key];
      return val === undefined ? fallback : (val as any);
    },
    enabled: (key) => {
      const v = (env[key] ?? "").toString().trim();
      return v === "1" || v.toLowerCase() === "true";
    },
  };
}
