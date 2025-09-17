export const metadata = { title: "History • League One" };
export default async function HistoryPage() {
  const champions = (await import("../data/champions.json")).default as Array<{
    year: number;
    team: string;
  }>;
  const timeline = (await import("../data/timeline.json")).default as Array<{
    date: string;
    event: string;
  }>;
  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-2xl font-bold mb-4">Champions</h1>
        <ul className="space-y-1">
          {champions.map((c) => (
            <li
              key={c.year}
              className="flex justify-between border p-2 rounded"
            >
              <span>{c.year}</span>
              <span>{c.team}</span>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2 className="text-xl font-semibold mb-2">Timeline</h2>
        <ul className="space-y-1">
          {timeline.map((e, i) => (
            <li key={i} className="border p-2 rounded">
              <div className="font-mono text-sm text-gray-600">{e.date}</div>
              <div>{e.event}</div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
