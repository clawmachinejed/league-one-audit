import type { Matchup, NflGame } from './types';

export type WeekSchedule = Record<string, NflGame>;

export type WeekScheduleResolution = {
  schedule: WeekSchedule;
  canIdentifyByes: boolean;
  complete: boolean;
};

const teamAliases: Readonly<Record<string, string>> = {
  JAC: 'JAX',
  LA: 'LAR',
  WSH: 'WAS',
};

const nflTeams = new Set([
  'ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE',
  'DAL', 'DEN', 'DET', 'GB', 'HOU', 'IND', 'JAX', 'KC',
  'LAC', 'LAR', 'LV', 'MIA', 'MIN', 'NE', 'NO', 'NYG',
  'NYJ', 'PHI', 'PIT', 'SEA', 'SF', 'TB', 'TEN', 'WAS',
]);

const regularSeasonGames = 272;
const regularSeasonWeeks = 18;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function team(value: unknown): string | null {
  const normalized = text(value)?.toUpperCase();
  return normalized ? teamAliases[normalized] ?? normalized : null;
}

function date(value: unknown): string | null {
  const normalized = text(value);
  return normalized && /^\d{4}-\d{2}-\d{2}$/u.test(normalized) ? normalized : null;
}

function kickoff(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function gameFor(teamName: string, home: string, away: string, gameDate: string, kickoffAt: string | null): NflGame {
  return {
    kind: 'scheduled',
    opponent: teamName === home ? away : home,
    location: teamName === home ? 'home' : 'away',
    date: gameDate,
    kickoffAt,
  };
}

export function normalizeSleeperScores(value: unknown, season: string, week: number): WeekSchedule {
  if (!Array.isArray(value)) return {};
  const result: WeekSchedule = {};
  for (const row of value) {
    if (!isRecord(row) || row.week !== week || String(row.season) !== season || row.season_type !== 'regular'
      || row.status === 'canceled' || !isRecord(row.metadata) || row.metadata.canceled === true) continue;
    const home = team(row.metadata.home_team);
    const away = team(row.metadata.away_team);
    const gameDate = date(row.date) ?? date(row.metadata.day);
    if (!home || !away || home === away || !gameDate || !nflTeams.has(home) || !nflTeams.has(away)) continue;
    if (result[home] || result[away]) return {};
    const kickoffAt = kickoff(row.start_time);
    result[home] = gameFor(home, home, away, gameDate, kickoffAt);
    result[away] = gameFor(away, home, away, gameDate, kickoffAt);
  }
  return result;
}

export function normalizeSleeperSeasonSchedule(value: unknown, week: number): WeekSchedule {
  if (!Array.isArray(value) || !Number.isInteger(week) || week < 1 || week > regularSeasonWeeks) return {};
  const games: Array<{ week: number; home: string; away: string; date: string }> = [];
  const gameIds = new Set<string>();
  const teamAppearances = new Map<string, number>();
  const teamsByWeek = Array.from({ length: regularSeasonWeeks + 1 }, () => new Set<string>());

  for (const row of value) {
    if (!isRecord(row)) return {};
    if (row.status === 'canceled') continue;
    const gameWeek = typeof row.week === 'number' && Number.isInteger(row.week) ? row.week : null;
    const home = team(row.home);
    const away = team(row.away);
    const gameDate = date(row.date);
    const gameId = text(row.game_id);
    if (!gameWeek || gameWeek < 1 || gameWeek > regularSeasonWeeks || !home || !away || home === away
      || !gameDate || !gameId || !nflTeams.has(home) || !nflTeams.has(away) || gameIds.has(gameId)
      || teamsByWeek[gameWeek].has(home) || teamsByWeek[gameWeek].has(away)) return {};
    gameIds.add(gameId);
    teamsByWeek[gameWeek].add(home);
    teamsByWeek[gameWeek].add(away);
    teamAppearances.set(home, (teamAppearances.get(home) ?? 0) + 1);
    teamAppearances.set(away, (teamAppearances.get(away) ?? 0) + 1);
    games.push({ week: gameWeek, home, away, date: gameDate });
  }

  if (games.length !== regularSeasonGames || teamAppearances.size !== nflTeams.size
    || [...teamAppearances.values()].some((appearances) => appearances !== 17)
    || teamsByWeek.slice(1).some((teams) => teams.size < 26 || teams.size > 32 || teams.size % 2 !== 0)) return {};

  const result: WeekSchedule = {};
  for (const game of games) {
    if (game.week !== week) continue;
    result[game.home] = gameFor(game.home, game.home, game.away, game.date, null);
    result[game.away] = gameFor(game.away, game.home, game.away, game.date, null);
  }
  return result;
}

export function resolveSleeperSchedule(
  seasonScheduleValue: unknown,
  scoresValue: unknown,
  season: string,
  week: number,
): WeekScheduleResolution {
  const expected = normalizeSleeperSeasonSchedule(seasonScheduleValue, week);
  const scores = normalizeSleeperScores(scoresValue, season, week);
  if (!Object.keys(expected).length) {
    return { schedule: scores, canIdentifyByes: false, complete: false };
  }

  const schedule: WeekSchedule = { ...expected };
  let complete = Object.keys(scores).length === Object.keys(expected).length;
  for (const [teamName, expectedGame] of Object.entries(expected)) {
    const scoredGame = scores[teamName];
    if (expectedGame.kind !== 'scheduled' || scoredGame?.kind !== 'scheduled'
      || scoredGame.opponent !== expectedGame.opponent || scoredGame.location !== expectedGame.location) {
      complete = false;
      continue;
    }
    schedule[teamName] = scoredGame;
    if (!scoredGame.kickoffAt) complete = false;
  }
  return { schedule, canIdentifyByes: true, complete };
}

export function addScheduleToMatchups(
  matchups: Matchup[],
  schedule: WeekSchedule,
  canIdentifyByes = false,
): Matchup[] {
  if (!Object.keys(schedule).length) return matchups;
  return matchups.map((matchup) => ({
    ...matchup,
    sides: matchup.sides.map((side) => ({
      ...side,
      starters: side.starters.map((player) => {
        const playerTeam = team(player.nflTeam);
        return {
          ...player,
          game: playerTeam && nflTeams.has(playerTeam)
            ? schedule[playerTeam] ?? (canIdentifyByes ? ({ kind: 'bye' } as const) : null)
            : null,
        };
      }),
    })),
  }));
}

const dayFormatter = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'America/New_York' });
const timeFormatter = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'America/New_York',
});

export function formatNflGame(game: NflGame): string {
  if (game.kind === 'bye') return 'BYE';
  const kickoffDate = game.kickoffAt ? new Date(game.kickoffAt) : null;
  const daySource = kickoffDate && Number.isFinite(kickoffDate.getTime())
    ? kickoffDate : new Date(`${game.date}T12:00:00Z`);
  const day = Number.isFinite(daySource.getTime()) ? dayFormatter.format(daySource) : 'Game';
  const time = kickoffDate && Number.isFinite(kickoffDate.getTime()) ? timeFormatter.format(kickoffDate) : 'TBD';
  return `${day} ${time} ${game.location === 'home' ? 'vs' : '@'} ${game.opponent}`;
}
