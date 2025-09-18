/**
 * High Score: highest combined → higher single-team score → lower matchup_id
 * Narrowest Win: smallest margin → higher combined → lower matchup_id
 * Bench of Week: highest bench player pts → higher tiebreak team pts → alphabetically lower player_id → lower matchup_id
 */
export function computeWeeklyAwards(week, games, benchStats = []) {
  const w = games.filter((g) => g.week === week);
  if (w.length === 0)
    return { high_score: 0, narrowest_win: 0, bench_of_week: 0 };
  const byCombined = [...w].sort((a, b) => {
    const ca = a.home_score + a.away_score;
    const cb = b.home_score + b.away_score;
    if (cb !== ca) return cb - ca;
    const msbA = Math.max(a.home_score, a.away_score);
    const msbB = Math.max(b.home_score, b.away_score);
    if (msbB !== msbA) return msbB - msbA;
    return a.matchup_id - b.matchup_id;
  });
  const high = byCombined[0].matchup_id;
  const byMargin = [...w].sort((a, b) => {
    const ma = Math.abs(a.home_score - a.away_score);
    const mb = Math.abs(b.home_score - b.away_score);
    if (ma !== mb) return ma - mb;
    const ca = a.home_score + a.away_score;
    const cb = b.home_score + b.away_score;
    if (cb !== ca) return cb - ca;
    return a.matchup_id - b.matchup_id;
  });
  const narrow = byMargin[0].matchup_id;
  const benchByMatchup = {};
  for (const b of benchStats) benchByMatchup[b.matchup_id] = b;
  const benchSorted = w
    .map((m) => ({
      m,
      b: benchByMatchup[m.matchup_id] ?? {
        matchup_id: m.matchup_id,
        highest_bench_points: 0,
        tiebreak_team_points: 0,
        tiebreak_player_id: "",
      },
    }))
    .sort((x, y) => {
      if (y.b.highest_bench_points !== x.b.highest_bench_points)
        return y.b.highest_bench_points - x.b.highest_bench_points;
      if (y.b.tiebreak_team_points !== x.b.tiebreak_team_points)
        return y.b.tiebreak_team_points - x.b.tiebreak_team_points;
      if (x.b.tiebreak_player_id !== y.b.tiebreak_player_id)
        return x.b.tiebreak_player_id.localeCompare(y.b.tiebreak_player_id);
      return x.m.matchup_id - y.m.matchup_id;
    });
  const bench = benchSorted[0]?.m.matchup_id ?? 0;
  return { high_score: high, narrowest_win: narrow, bench_of_week: bench };
}
