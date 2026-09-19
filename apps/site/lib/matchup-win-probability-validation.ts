/** Shared by full JSON validation and the compact reader's anonymous scalar atoms. */
export const WIN_PROBABILITY_SUM_TOLERANCE = 1e-9;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function matchesMatchupWinProbability(value: unknown): boolean {
  if (!record(value)) return false;
  const chance = value.winProbability;
  // Old immutable snapshots deliberately remain readable.
  if (chance === undefined) return true;
  if (!record(chance) || chance.modelVersion !== 'normal-v1' && chance.modelVersion !== 'normal-v2') return false;
  if (chance.status === 'unavailable') return typeof chance.reason === 'string';
  if (!Array.isArray(chance.teams) || chance.teams.length !== 2
    || !Array.isArray(value.sides) || value.sides.length !== 2) return false;
  const sides = value.sides;
  if (!sides.every((side) => record(side) && record(side.team) && finite(side.team.id))) return false;
  const teamIds = sides.map((side) => side.team.id as number);
  if (teamIds[0] === teamIds[1]) return false;
  const teams = chance.teams;
  if (!teams.every((team) => record(team) && finite(team.teamId) && finite(team.probability)
    && team.probability >= 0 && team.probability <= 1 && teamIds.includes(team.teamId))
    || teams[0].teamId === teams[1].teamId) return false;

  if (chance.status === 'estimated') {
    return (value.status === 'upcoming' || value.status === 'live')
      && teams.every((team) => team.probability > 0 && team.probability < 1)
      && Math.abs(teams[0].probability + teams[1].probability - 1) <= WIN_PROBABILITY_SUM_TOLERANCE;
  }
  if (value.status !== 'final' || !sides.every((side) => finite(side.points))) return false;
  if (chance.status === 'tie') {
    return sides[0].points === sides[1].points && teams.every((team) => team.probability === 0);
  }
  if (chance.status !== 'final' || sides[0].points === sides[1].points) return false;
  const winnerId = sides[sides[0].points > sides[1].points ? 0 : 1].team.id;
  return teams.every((team) => team.probability === (team.teamId === winnerId ? 1 : 0));
}
