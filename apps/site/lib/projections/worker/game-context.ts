import 'server-only';

import { canonicalNflTeam } from '../../nfl-teams';
import type { Tank01GameState, Tank01GameStatesAvailable } from '../../tank01-game-state';
import type { Matchup, Player } from '../../types';
import type { LoadedLeague } from './contracts';
import { activeStarters, isEmptySlot } from './roster-context';

export const MAX_SOURCE_SKEW_MS = 90_000;

export function stateForPlayer(player: Player, games: Tank01GameStatesAvailable): Tank01GameState | null {
  if (player.game?.kind === 'bye') return null;
  const team = canonicalNflTeam(player.nflTeam);
  return team ? games.byTeam[team] ?? null : null;
}

export function assertCompleteGameCoverage(league: LoadedLeague, games: Tank01GameStatesAvailable): void {
  const completionTimes = [Date.parse(games.requestCompletedAt)];
  completionTimes.push(Date.parse(league.source.requestCompletedAt));
  for (const { player } of activeStarters(league.source.data)) {
    const team = canonicalNflTeam(player.nflTeam);
    if (!team) throw new Error('An active starter is missing a canonical NFL team.');
    if (player.game?.kind === 'bye') continue;
    if (player.game?.kind !== 'scheduled') {
      throw new Error('An active starter is missing its NFL schedule.');
    }
    const game = games.byTeam[team];
    const opponent = canonicalNflTeam(player.game.opponent);
    if (!game || !opponent) throw new Error('Tank01 did not provide every active starter game.');
    const expectedOpponent = game.homeTeam === team ? game.awayTeam : game.homeTeam;
    const expectedLocation = game.homeTeam === team ? 'home' : 'away';
    if (opponent !== expectedOpponent || player.game.location !== expectedLocation) {
      throw new Error('Sleeper schedule and Tank01 game identity do not agree.');
    }
    if (game.statusCode === 1 && (game.phase === 'unknown' || game.remainingFraction === null)) {
      throw new Error('Tank01 returned an incomplete live game clock.');
    }
  }
  if (completionTimes.some((value) => !Number.isFinite(value))
    || Math.max(...completionTimes) - Math.min(...completionTimes) > MAX_SOURCE_SKEW_MS) {
    throw new Error('Sleeper and Tank01 observations were not synchronized closely enough.');
  }
}

export function kickoffForGame(game: Tank01GameState, leagues: readonly LoadedLeague[]): string | null {
  const values = new Set<string>();
  for (const league of leagues) {
    for (const team of [game.homeTeam, game.awayTeam]) {
      const scheduled = league.source.schedule[team];
      if (scheduled?.kind !== 'scheduled' || !scheduled.kickoffAt) continue;
      const opponent = team === game.homeTeam ? game.awayTeam : game.homeTeam;
      if (canonicalNflTeam(scheduled.opponent) === opponent) values.add(scheduled.kickoffAt);
    }
  }
  return values.size === 1 ? [...values][0] : null;
}

export function startedGame(state: Tank01GameState): boolean {
  return state.statusCode === 1 || state.statusCode === 2 || state.statusCode === 4;
}

export function matchupStatus(matchup: Matchup, games: Tank01GameStatesAvailable): Matchup['status'] {
  const phases = matchup.sides.flatMap((side) => side.starters)
    .filter((player) => !isEmptySlot(player) && player.game?.kind !== 'bye')
    .map((player) => stateForPlayer(player, games)?.phase ?? 'unknown');
  if (phases.length === 0) return matchup.status;
  if (phases.every((phase) => phase === 'pregame' || phase === 'postponed')) return 'upcoming';
  if (phases.every((phase) => phase === 'final')) return 'final';
  if (phases.some((phase) => phase === 'unknown')) return 'unknown';
  return 'live';
}
