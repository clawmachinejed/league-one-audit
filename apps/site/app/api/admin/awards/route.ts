export const runtime = "nodejs";
import { getApp } from "../../../../lib/app";
import { seedBenchStats } from "@l1/contracts";
import { computeWeeklyAwards } from "@l1/domain";

export async function GET(req: Request) {
  getApp();
  const adminKey = process.env.ADMIN_KEY || "";
  const headerKey =
    new URL(req.url).searchParams.get("key") ??
    req.headers.get("x-admin-key") ??
    "";
  if (!adminKey || headerKey !== adminKey) {
    return new Response(JSON.stringify({ status: "error", reason: "ok" }), {
      status: 403,
    });
  }
  const week = Number(new URL(req.url).searchParams.get("week") ?? "1");
  const season = new Date().getFullYear();
  const { schedule } = await getApp().home(season, week);
  const awards = computeWeeklyAwards(week, schedule, seedBenchStats);
  return new Response(
    JSON.stringify({ status: "success", reason: "ok", week, awards }),
    {
      headers: { "content-type": "application/json" },
    },
  );
}
