/** One description of the existing website JSON boundary, shared by JS and SQL. */
export type MatchupsShape =
  | Readonly<{ kind: 'string' | 'number' }>
  | Readonly<{ kind: 'literal'; value: string }>
  | Readonly<{ kind: 'nullable' | 'optional'; value: MatchupsShape }>
  | Readonly<{ kind: 'array'; item: MatchupsShape; minimum?: number; maximum?: number }>
  | Readonly<{ kind: 'object'; properties: Readonly<Record<string, MatchupsShape>> }>
  | Readonly<{ kind: 'union'; alternatives: readonly MatchupsShape[] }>
  | Readonly<{ kind: 'refinement'; name: 'date-string' | 'matchup-status' }>;

const string: MatchupsShape = { kind: 'string' };
const number: MatchupsShape = { kind: 'number' };
const nullable = (value: MatchupsShape): MatchupsShape => ({ kind: 'nullable', value });
const object = (properties: Readonly<Record<string, MatchupsShape>>): MatchupsShape => ({ kind: 'object', properties });
const array = (item: MatchupsShape): MatchupsShape => ({ kind: 'array', item });
const literal = (value: string): MatchupsShape => ({ kind: 'literal', value });

const team = object({
  id: number, managerName: string, name: string, avatar: nullable(string),
  wins: number, losses: number, ties: number, pointsFor: number, pointsAgainst: nullable(number),
});
const game = nullable({ kind: 'union', alternatives: [
  object({ kind: literal('bye') }),
  object({
    kind: literal('scheduled'), opponent: string,
    location: { kind: 'union', alternatives: [literal('home'), literal('away')] },
    date: string, kickoffAt: nullable(string),
  }),
] });
const player = object({
  id: string, name: string, position: string, nflTeam: nullable(string),
  injuryStatus: nullable(string), game, slot: string,
  points: nullable(number), projectedPoints: nullable(number),
});
const side = object({ team, points: nullable(number), projectedPoints: nullable(number), starters: array(player) });

export const MATCHUPS_SHAPE: MatchupsShape = object({
  league: object({ season: string, rosterPositions: array(string), week: number, maxWeek: number }),
  teams: array(team), updatedAt: { kind: 'refinement', name: 'date-string' },
  week: number, warning: { kind: 'optional', value: string },
  matchups: array(object({
    id: string, status: { kind: 'refinement', name: 'matchup-status' },
    sides: { kind: 'array', item: side, minimum: 1, maximum: 2 },
  })),
});

export function matchesRefinement(name: 'date-string' | 'matchup-status', value: unknown): boolean {
  if (name === 'date-string') return typeof value === 'string' && !Number.isNaN(Date.parse(value));
  // Keep the established String() coercion; tightening this is outside this feature.
  return ['upcoming', 'live', 'final', 'unknown'].includes(String(value));
}

export function matchesShape(shape: MatchupsShape, value: unknown): boolean {
  switch (shape.kind) {
    case 'string': return typeof value === 'string';
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'literal': return value === shape.value;
    case 'nullable': return value === null || matchesShape(shape.value, value);
    case 'optional': return value === undefined || matchesShape(shape.value, value);
    case 'union': return shape.alternatives.some((alternative) => matchesShape(alternative, value));
    case 'refinement': return matchesRefinement(shape.name, value);
    case 'array': return Array.isArray(value)
      && (shape.minimum === undefined || value.length >= shape.minimum)
      && (shape.maximum === undefined || value.length <= shape.maximum)
      && value.every((item) => matchesShape(shape.item, item));
    case 'object': return value !== null && typeof value === 'object' && !Array.isArray(value)
      && Object.entries(shape.properties).every(([key, child]) => (
        matchesShape(child, (value as Record<string, unknown>)[key])
      ));
  }
}
