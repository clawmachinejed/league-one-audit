import { getApp } from "../../lib/app";
export const metadata = { title: "Standings • League One" };
export const revalidate = 60;
export default async function StandingsPage() {
  const season = new Date().getFullYear();
  const { standings } = await getApp().home(season, 1);
  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Standings</h1>
      <ul className="space-y-1">
        {standings.map((row) => (
          <li
            key={row.team.id}
            className="flex justify-between border p-2 rounded"
          >
            <span>{row.team.name}</span>
            <span className="tabular-nums">
              {row.wins}-{row.losses}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
