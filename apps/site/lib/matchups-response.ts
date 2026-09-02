import type { MatchupsData, NflGame, Player, Team } from './types';

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function nullableFiniteNumber(value: unknown): value is number | null {
  return value === null || finiteNumber(value);
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isTeam(value: unknown): value is Team {
  return record(value)
    && finiteNumber(value.id)
    && typeof value.managerName === 'string'
    && typeof value.name === 'string'
    && nullableString(value.avatar)
    && finiteNumber(value.wins)
    && finiteNumber(value.losses)
    && finiteNumber(value.ties)
    && finiteNumber(value.pointsFor)
    && nullableFiniteNumber(value.pointsAgainst);
}

function isGame(value: unknown): value is NflGame | null {
  if (value === null) return true;
  if (!record(value)) return false;
  if (value.kind === 'bye') return true;
  return value.kind === 'scheduled'
    && typeof value.opponent === 'string'
    && (value.location === 'home' || value.location === 'away')
    && typeof value.date === 'string'
    && nullableString(value.kickoffAt);
}

function isPlayer(value: unknown): value is Player {
  return record(value)
    && typeof value.id === 'string'
    && typeof value.name === 'string'
    && typeof value.position === 'string'
    && nullableString(value.nflTeam)
    && nullableString(value.injuryStatus)
    && isGame(value.game)
    && typeof value.slot === 'string'
    && nullableFiniteNumber(value.points)
    && nullableFiniteNumber(value.projectedPoints);
}

/** Strict client boundary for replacing a complete, currently rendered matchup snapshot. */
export function isMatchupsData(value: unknown): value is MatchupsData {
  if (!record(value) || !record(value.league)) return false;
  const league = value.league;
  if (typeof league.season !== 'string'
    || !Array.isArray(league.rosterPositions)
    || !league.rosterPositions.every((position) => typeof position === 'string')
    || !finiteNumber(league.week)
    || !finiteNumber(league.maxWeek)
    || !finiteNumber(value.week)
    || !Array.isArray(value.teams)
    || !value.teams.every(isTeam)
    || typeof value.updatedAt !== 'string'
    || Number.isNaN(Date.parse(value.updatedAt))
    || (value.warning !== undefined && typeof value.warning !== 'string')
    || !Array.isArray(value.matchups)) return false;

  return value.matchups.every((matchup) => {
    if (!record(matchup)
      || typeof matchup.id !== 'string'
      || !['upcoming', 'live', 'final', 'unknown'].includes(String(matchup.status))
      || !Array.isArray(matchup.sides)
      || matchup.sides.length < 1
      || matchup.sides.length > 2) return false;

    return matchup.sides.every((side) => record(side)
      && isTeam(side.team)
      && nullableFiniteNumber(side.points)
      && nullableFiniteNumber(side.projectedPoints)
      && Array.isArray(side.starters)
      && side.starters.every(isPlayer));
  });
}
