import type {
  GameStateObservation,
  GameStateSlate,
  LineupSlot,
  MatchupStatus,
  NflWeekSchedule,
  ScoringEntity,
} from '../domain/contracts';
import type { LoadedLeague } from './contracts';
import { activeStarters } from './roster-context';

export const MAX_SOURCE_SKEW_MS = 90_000;

export function applicableSourceSkewSeconds(
  leagueRequestCompletedAt: string,
  gameStates: readonly GameStateObservation[],
  calculatedAt: string,
): number | null {
  const timestamps = [
    Date.parse(leagueRequestCompletedAt),
    ...gameStates.map((game) => Date.parse(game.requestCompletedAt)),
    Date.parse(calculatedAt),
  ];
  if (timestamps.some((value) => !Number.isFinite(value))) return null;
  return (Math.max(...timestamps) - Math.min(...timestamps)) / 1_000;
}

export function stateForEntity(
  entity: ScoringEntity,
  games: GameStateSlate,
  schedule: NflWeekSchedule,
): GameStateObservation | null {
  const team = entity.nflTeam;
  if (!team) return null;
  const scheduled = schedule[team];
  if (scheduled?.kind !== 'scheduled') return null;
  return games.games.find((candidate) => (
    candidate.homeTeam === team || candidate.awayTeam === team
  )) ?? null;
}

export function assertCompleteGameCoverage(
  league: LoadedLeague,
  games: GameStateSlate,
): void {
  const completionTimes = [
    Date.parse(games.requestCompletedAt),
    Date.parse(league.source.requestCompletedAt),
  ];
  for (const { starter } of activeStarters(league.source)) {
    const team = starter.entity.nflTeam;
    if (!team) throw new Error('An active starter is missing a canonical NFL team.');
    const scheduled = league.source.schedule[team];
    if (scheduled?.kind === 'bye') continue;
    if (scheduled?.kind !== 'scheduled') {
      throw new Error('An active starter is missing its NFL schedule.');
    }
    const game = stateForEntity(starter.entity, games, league.source.schedule);
    if (!game) throw new Error('The game-state provider did not provide every active starter game.');
    const expectedOpponent = game.homeTeam === team ? game.awayTeam : game.homeTeam;
    const expectedLocation = game.homeTeam === team ? 'home' : 'away';
    if (scheduled.opponent !== expectedOpponent || scheduled.location !== expectedLocation) {
      throw new Error('League schedule and game-state identities do not agree.');
    }
    if (game.statusCode === 1 && (game.phase === 'unknown' || game.remainingFraction === null)) {
      throw new Error('The game-state provider returned an incomplete live game clock.');
    }
  }
  if (completionTimes.some((value) => !Number.isFinite(value))
    || Math.max(...completionTimes) - Math.min(...completionTimes) > MAX_SOURCE_SKEW_MS) {
    throw new Error('League and game-state observations were not synchronized closely enough.');
  }
}

export function kickoffForGame(
  game: GameStateObservation,
  leagues: readonly LoadedLeague[],
): string | null {
  const values = new Set<string>();
  for (const league of leagues) {
    for (const team of [game.homeTeam, game.awayTeam]) {
      const scheduled = league.source.schedule[team];
      if (scheduled?.kind !== 'scheduled' || !scheduled.kickoffAt) continue;
      const opponent = team === game.homeTeam ? game.awayTeam : game.homeTeam;
      if (scheduled.opponent === opponent) values.add(scheduled.kickoffAt);
    }
  }
  return values.size === 1 ? [...values][0] : null;
}

export function startedGame(state: GameStateObservation): boolean {
  return state.statusCode === 1 || state.statusCode === 2 || state.statusCode === 4;
}

type MatchupForStatus = Readonly<{
  status: MatchupStatus;
  sides: readonly Readonly<{ starters: readonly LineupSlot[] }>[];
}>;

export function matchupStatus(
  matchup: MatchupForStatus,
  schedule: NflWeekSchedule,
  games: GameStateSlate,
): MatchupStatus {
  const phases = matchup.sides.flatMap((side) => side.starters)
    .filter((slot): slot is Extract<LineupSlot, { kind: 'occupied' }> => {
      return slot.kind === 'occupied' && (slot.entity.nflTeam === null
        || schedule[slot.entity.nflTeam]?.kind !== 'bye');
    })
    .map((slot) => stateForEntity(slot.entity, games, schedule)?.phase ?? 'unknown');
  if (phases.length === 0) return matchup.status;
  if (phases.every((phase) => phase === 'pregame' || phase === 'postponed')) return 'upcoming';
  if (phases.every((phase) => phase === 'final')) return 'final';
  if (phases.some((phase) => phase === 'unknown')) return 'unknown';
  return 'live';
}
