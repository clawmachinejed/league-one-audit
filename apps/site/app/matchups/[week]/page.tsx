// apps/site/app/matchups/[week]/page.tsx
import { getApp } from "../../../lib/app";

export const revalidate = 60;

export default async function WeekPage({
  params,
}: {
  params: { week: string };
}) {
  const week = Number(params.week);
  const app = getApp();
  const season = new Date().getFullYear();
  const { schedule } = await app.home(season, week);
  const games = schedule.filter((g) => g.week === week);
  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Matchups — Week {week}</h1>
      <ul className="space-y-2">
        {games.map((g) => (
          <li key={g.matchup_id} className="border p-3 rounded">
            <div className="flex justify-between">
              <span>{g.home_team.name}</span>
              <span className="tabular-nums">{g.home_score.toFixed(1)}</span>
            </div>
            <div className="flex justify-between">
              <span>{g.away_team.name}</span>
              <span className="tabular-nums">{g.away_score.toFixed(1)}</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
