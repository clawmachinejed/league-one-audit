export const runtime = "nodejs";
import { getApp } from "../../../../lib/app";

export async function GET(req: Request) {
  const app = getApp();
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
  const season = new Date().getFullYear();
  const { standings } = await app.home(season, 1);
  const leader = standings.sort((a, b) => b.wins - a.wins)[0];
  return new Response(
    JSON.stringify({
      status: "success",
      reason: "ok",
      digest: {
        leader: {
          team: leader.team.name,
          record: `${leader.wins}-${leader.losses}`,
        },
        teams: standings.length,
      },
    }),
    { headers: { "content-type": "application/json" } },
  );
}
