// packages/app/src/index.ts
import type {
  ClockPort,
  LoggerPort,
  RateLimiterPort,
  OgRendererPort,
  ConfigPort,
  SleeperRepository,
} from "@l1/ports";
import { DateTime } from "luxon";
import { LogEvent, BenchStat, seedBenchStats } from "@l1/contracts";
import { playoffOdds, computeWeeklyAwards, rivalrySpice } from "@l1/domain";

export type AppDeps = {
  clock: ClockPort;
  logger: LoggerPort;
  limiter: RateLimiterPort;
  og: OgRendererPort;
  config: ConfigPort;
  sleeper: SleeperRepository;
};

export function createApp(deps: AppDeps) {
  const { clock, logger, limiter, og, config, sleeper } = deps;
  const tz = () => clock.tz();

  function log(
    name: string,
    status: "success" | "skipped" | "error",
    reason: "ok" | "rate_capped" | "not_enabled" = "ok",
    details: Record<string, any> = {},
  ) {
    const event: LogEvent = {
      ts: clock.nowISO(),
      name,
      status,
      reason,
      details,
    };
    logger.emit(event);
  }

  async function enforceCronAuth(
    name: string,
    secret?: string,
    adminKey?: string,
  ) {
    const vercel = config.get("VERCEL_CRON_SECRET", "");
    const admin = config.get("ADMIN_KEY", "");
    if (vercel) {
      if (secret !== vercel) {
        log(name, "error", "ok", { reason: "forbidden" });
        return {
          ok: false,
          status: 403,
          body: { status: "error", reason: "ok" } as const,
        };
      }
      return { ok: true };
    }
    if (!adminKey || adminKey !== admin) {
      log(name, "error", "ok", { reason: "forbidden" });
      return {
        ok: false,
        status: 403,
        body: { status: "error", reason: "ok" } as const,
      };
    }
    return { ok: true };
  }

  function sunDailyKey(dateISO: string) {
    const d = DateTime.fromISO(dateISO, { zone: tz() }).toFormat("yyyy-LL-dd");
    return `cron:live-hourly:sun:${d}`;
  }

  return {
    async home(season: number, current_week: number) {
      const standings = await sleeper.getStandings(season);
      const schedule = await sleeper.getSchedule(season);
      const odds = playoffOdds({ season, current_week, standings, schedule });
      return { standings, schedule, odds };
    },

    async adminAwards(week: number) {
      const season = DateTime.fromISO(clock.nowISO()).year;
      const schedule = await sleeper.getSchedule(season);
      const awards = computeWeeklyAwards(week, schedule, seedBenchStats);
      return { week, awards };
    },

    async rivalries() {
      const season = DateTime.fromISO(clock.nowISO()).year;
      const schedule = await sleeper.getSchedule(season);
      const teams = await sleeper.getTeams();
      const pairs: Array<[string, string, number]> = [];
      for (let i = 0; i < teams.length; i++) {
        for (let j = i + 1; j < teams.length; j++) {
          const a = teams[i],
            b = teams[j];
          const score = rivalrySpice(a, b, schedule);
          pairs.push([a.name, b.name, score]);
        }
      }
      pairs.sort((a, b) => b[2] - a[2]);
      return pairs;
    },

    async generateOg(title: string, subtitle?: string) {
      const logo =
        config.get("NEXT_PUBLIC_SITE_URL", "http://localhost:3000") +
        "/logo.png";
      return og.render({ title, subtitle, logoUrl: logo });
    },

    async cronLiveHourly(secret?: string, adminKey?: string) {
      const auth = await enforceCronAuth("cron.live_hourly", secret, adminKey);
      if (!auth.ok) return auth as any;

      const now = DateTime.fromISO(clock.nowISO(), { zone: tz() });
      const day = now.weekday; // 1 = Monday, 7 = Sunday

      if (day === 4 || day === 1) {
        const key = `cron:live-hourly:${now.toFormat("yyyy-LL-dd-HH")}`;
        const allowed = await limiter.take(key, 3600);
        if (!allowed) {
          log("cron.live_hourly", "skipped", "rate_capped");
          return {
            ok: false,
            status: 429,
            body: { status: "skipped", reason: "rate_capped" } as const,
          };
        }
      } else if (day === 7) {
        const base = sunDailyKey(now.toISO() ?? new Date().toISOString());
        const first = await limiter.take(base + ":1", 86400);
        const second = first ? true : await limiter.take(base + ":2", 86400);
        const third =
          first || second ? true : await limiter.take(base + ":3", 86400);
        if (!(first || second || third)) {
          log("cron.live_hourly", "skipped", "rate_capped");
          return {
            ok: false,
            status: 429,
            body: { status: "skipped", reason: "rate_capped" } as const,
          };
        }
      } else {
        log("cron.live_hourly", "skipped", "not_enabled");
        return {
          ok: false,
          status: 501,
          body: { status: "skipped", reason: "not_enabled" } as const,
        };
      }

      log("cron.live_hourly", "success", "ok", { ranAt: clock.nowISO() });
      return {
        ok: true,
        status: 200,
        body: { status: "success", reason: "ok" } as const,
      };
    },

    async cronAwardsWeekly(secret?: string, adminKey?: string) {
      const auth = await enforceCronAuth(
        "cron.awards_weekly",
        secret,
        adminKey,
      );
      if (!auth.ok) return auth as any;

      const allowed = await limiter.take("cron:awards-weekly", 3600);
      if (!allowed) {
        log("cron.awards_weekly", "skipped", "rate_capped");
        return {
          ok: false,
          status: 429,
          body: { status: "skipped", reason: "rate_capped" } as const,
        };
      }

      const season = DateTime.fromISO(clock.nowISO()).year;
      const schedule = await sleeper.getSchedule(season);
      const week = 1;
      const awards = computeWeeklyAwards(
        week,
        schedule,
        seedBenchStats as unknown as BenchStat[],
      );
      log("cron.awards_weekly", "success", "ok", { week, awards });
      return {
        ok: true,
        status: 200,
        body: { status: "success", reason: "ok" } as const,
      };
    },

    async sitemap(baseUrl: string) {
      const urls = ["", "/admin", "/standings", "/rivalries", "/history"];
      const today =
        DateTime.fromISO(clock.nowISO()).toISODate() ??
        new Date().toISOString().slice(0, 10);
      return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u) => `  <url>
    <loc>${baseUrl}${u}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>hourly</changefreq>
  </url>`,
  )
  .join("\n")}
</urlset>`;
    },

    async rss(baseUrl: string) {
      const now = clock.nowISO();
      return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>${config.get("NEXT_PUBLIC_SITE_NAME", "League One")} Feed</title>
  <link>${baseUrl}</link>
  <description>League One updates</description>
  <lastBuildDate>${now}</lastBuildDate>
  <item>
    <title>Welcome</title>
    <link>${baseUrl}</link>
    <guid>${baseUrl}/welcome</guid>
    <pubDate>${now}</pubDate>
    <description>Hello from League One.</description>
  </item>
</channel>
</rss>`;
    },
  };
}
