import type { MatchupsData } from './types';

export function validationPayload(): MatchupsData {
  const team = {
    id: 1, managerName: 'Private fixture manager', name: 'Private fixture team',
    avatar: null, wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: null,
  };
  return {
    league: { season: '2026', rosterPositions: ['QB'], week: 1, maxWeek: 18 },
    teams: [{ ...team }], week: 1, updatedAt: '2026-09-13T18:00:00.000Z',
    matchups: [{ id: '1', status: 'live', sides: [{
      team: { ...team }, points: 10.5, projectedPoints: 20.125,
      starters: [{
        id: 'private-fixture-player', name: 'Private fixture player', position: 'QB',
        nflTeam: 'IND', injuryStatus: null, slot: 'QB', points: 10.5, projectedPoints: 20.125,
        game: { kind: 'scheduled', opponent: 'HOU', location: 'home', date: '2026-09-13', kickoffAt: null },
      }],
    }] }],
  };
}

type ValidationCase = Readonly<{ name: string; json: string; valid: boolean }>;
type Change = (payload: MatchupsData) => void;

function changed(name: string, valid: boolean, change: Change): ValidationCase {
  const payload = validationPayload();
  change(payload);
  return { name, json: JSON.stringify(payload), valid };
}

export function validationCases(): ValidationCase[] {
  const cases = [
    changed('complete payload', true, () => {}),
    changed('empty published schedule', true, (p) => { p.matchups = []; p.teams = []; }),
    changed('extra properties', true, (p) => { Object.assign(p, { extra: { arbitrary: true } }); }),
    changed('optional warning undefined', true, (p) => { p.warning = undefined; }),
    changed('optional warning null', false, (p) => { Object.assign(p, { warning: null }); }),
    changed('optional warning string', true, (p) => { p.warning = ''; }),
    changed('league missing', false, (p) => { Reflect.deleteProperty(p, 'league'); }),
    changed('league null', false, (p) => { Object.assign(p, { league: null }); }),
    changed('league array', false, (p) => { Object.assign(p, { league: [] }); }),
    changed('season number', false, (p) => { Object.assign(p.league, { season: 2026 }); }),
    changed('season empty string remains structural', true, (p) => { p.league.season = ''; }),
    changed('week string', false, (p) => { Object.assign(p, { week: '1' }); }),
    changed('fractional week remains structural', true, (p) => { p.week = 1.25; }),
    changed('roster positions wrong element', false, (p) => { Object.assign(p.league, { rosterPositions: [1] }); }),
    changed('team collection null', false, (p) => { Object.assign(p, { teams: null }); }),
    changed('team manager missing', false, (p) => { Reflect.deleteProperty(p.teams[0], 'managerName'); }),
    changed('team points missing', false, (p) => { Reflect.deleteProperty(p.teams[0], 'pointsAgainst'); }),
    changed('nested team manager number', false, (p) => { Object.assign(p.matchups[0].sides[0].team, { managerName: 1 }); }),
    changed('matchups object', false, (p) => { Object.assign(p, { matchups: {} }); }),
    changed('matchup null', false, (p) => { Object.assign(p, { matchups: [null] }); }),
    changed('matchup ID number', false, (p) => { Object.assign(p.matchups[0], { id: 1 }); }),
    changed('status absent', false, (p) => { Reflect.deleteProperty(p.matchups[0], 'status'); }),
    changed('status null', false, (p) => { Object.assign(p.matchups[0], { status: null }); }),
    changed('status unknown token', false, (p) => { Object.assign(p.matchups[0], { status: 'running' }); }),
    changed('status singleton array coercion', true, (p) => { Object.assign(p.matchups[0], { status: ['live'] }); }),
    changed('status nested array coercion', true, (p) => { Object.assign(p.matchups[0], { status: [[['upcoming']]] }); }),
    changed('status multiple array elements', false, (p) => { Object.assign(p.matchups[0], { status: ['live', null] }); }),
    changed('status throwing coercion', false, (p) => { Object.assign(p.matchups[0], { status: { toString: null } }); }),
    changed('empty sides', false, (p) => { p.matchups[0].sides = []; }),
    changed('three sides', false, (p) => { p.matchups[0].sides = Array(3).fill(p.matchups[0].sides[0]); }),
    changed('nullable official score', true, (p) => { p.matchups[0].sides[0].points = null; }),
    changed('official score string', false, (p) => { Object.assign(p.matchups[0].sides[0], { points: '10.5' }); }),
    changed('starter list null', false, (p) => { Object.assign(p.matchups[0].sides[0], { starters: null }); }),
    changed('empty starters', true, (p) => { p.matchups[0].sides[0].starters = []; }),
    changed('starter name absent', false, (p) => { Reflect.deleteProperty(p.matchups[0].sides[0].starters[0], 'name'); }),
    changed('starter game absent', false, (p) => { Reflect.deleteProperty(p.matchups[0].sides[0].starters[0], 'game'); }),
    changed('starter game null', true, (p) => { p.matchups[0].sides[0].starters[0].game = null; }),
    changed('bye ignores unrelated properties', true, (p) => {
      Object.assign(p.matchups[0].sides[0].starters[0], { game: { kind: 'bye', opponent: null, location: 42 } });
    }),
    changed('invalid scheduled location', false, (p) => { Object.assign(p.matchups[0].sides[0].starters[0].game!, { location: 'neutral' }); }),
    changed('scheduled kickoff empty', true, (p) => { Object.assign(p.matchups[0].sides[0].starters[0].game!, { kickoffAt: '' }); }),
    changed('scheduled kickoff unparseable remains valid', true, (p) => { Object.assign(p.matchups[0].sides[0].starters[0].game!, { kickoffAt: 'unknown' }); }),
    changed('scheduled kickoff valid', true, (p) => { Object.assign(p.matchups[0].sides[0].starters[0].game!, { kickoffAt: '2026-09-13T17:00:00Z' }); }),
    changed('date invalid', false, (p) => { p.updatedAt = 'not-a-date'; }),
    changed('date null', false, (p) => { Object.assign(p, { updatedAt: null }); }),
    changed('date non-ISO accepted by JS', true, (p) => { p.updatedAt = 'September 13, 2026 18:00 GMT'; }),
  ];
  const cutoff = (1n << 1024n) - (1n << 970n);
  for (const [name, value, valid] of [
    ['below positive overflow', String(cutoff - 1n), true],
    ['at positive overflow', String(cutoff), false],
    ['below negative overflow', String(-(cutoff - 1n)), true],
    ['at negative overflow', String(-cutoff), false],
    ['tiny underflow', '1e-400', true],
  ] as const) {
    const data = validationPayload();
    Object.assign(data.teams[0], { pointsFor: '__NUMBER__' });
    cases.push({ name, valid, json: JSON.stringify(data).replace('"__NUMBER__"', value) });
  }
  return cases;
}
