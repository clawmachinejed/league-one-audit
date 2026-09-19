import type { Matchup, MatchupsData } from './types';

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

function probabilityCase(name: string, valid: boolean, change: (matchup: Matchup) => void): ValidationCase {
  return changed(`win probability semantic: ${name}`, valid, (payload) => {
    const matchup = payload.matchups[0];
    matchup.sides.push({ ...matchup.sides[0], team: { ...matchup.sides[0].team, id: 2 }, points: 9 });
    matchup.winProbability = {
      modelVersion: 'normal-v1', status: 'estimated',
      teams: [{ teamId: 1, probability: 0.6 }, { teamId: 2, probability: 0.4 }],
    };
    change(matchup);
  });
}
function probabilityTeams(matchup: Matchup) {
  if (!matchup.winProbability || matchup.winProbability.status === 'unavailable') throw new Error('Invalid fixture.');
  return matchup.winProbability.teams;
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
    changed('unknown bench', true, (p) => { p.matchups[0].sides[0].bench = null; }),
    changed('empty bench', true, (p) => { p.matchups[0].sides[0].bench = []; }),
    changed('bench with source zero and unavailable projection', true, (p) => {
      const side = p.matchups[0].sides[0];
      side.bench = [{ ...side.starters[0], id: 'bench-player', slot: 'BN', points: 0, projectedPoints: null }];
    }),
    changed('bench-only kickoff window', true, (p) => {
      const side = p.matchups[0].sides[0];
      side.bench = [{ ...side.starters[0], id: 'bench-player', slot: 'BN', game: {
        kind: 'scheduled', opponent: 'HOU', location: 'home', date: '2026-09-13',
        kickoffAt: '2026-09-13T17:00:00.000Z',
      } }];
      side.starters[0].game = null;
      p.matchups[0].status = 'upcoming';
    }),
    changed('bench-only date without kickoff', true, (p) => {
      const side = p.matchups[0].sides[0];
      side.bench = [{ ...side.starters[0], id: 'bench-player', slot: 'BN' }];
      side.starters[0].game = null;
      p.matchups[0].status = 'upcoming';
    }),
    changed('bench object', false, (p) => { Object.assign(p.matchups[0].sides[0], { bench: {} }); }),
    changed('bench score string', false, (p) => {
      const side = p.matchups[0].sides[0];
      side.bench = [{ ...side.starters[0], slot: 'BN' }];
      Object.assign(side.bench[0], { points: '0' });
    }),
    changed('bench name missing', false, (p) => {
      const side = p.matchups[0].sides[0];
      side.bench = [{ ...side.starters[0], slot: 'BN' }];
      Reflect.deleteProperty(side.bench[0], 'name');
    }),
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
    changed('scheduled game final score', true, (p) => {
      Object.assign(p.matchups[0].sides[0].starters[0].game!, { finalScore: { teamScore: 23, opponentScore: 10 } });
    }),
    changed('scheduled game zero final score', true, (p) => {
      Object.assign(p.matchups[0].sides[0].starters[0].game!, { finalScore: { teamScore: 0, opponentScore: 10 } });
    }),
    changed('scheduled game incomplete final score', false, (p) => {
      Object.assign(p.matchups[0].sides[0].starters[0].game!, { finalScore: { teamScore: 23 } });
    }),
    changed('scheduled game string final score', false, (p) => {
      Object.assign(p.matchups[0].sides[0].starters[0].game!, { finalScore: { teamScore: '23', opponentScore: 10 } });
    }),
    changed('scheduled game null final score', false, (p) => {
      Object.assign(p.matchups[0].sides[0].starters[0].game!, { finalScore: null });
    }),
    changed('scheduled game live quarter score', true, (p) => {
      Object.assign(p.matchups[0].sides[0].starters[0].game!, {
        liveScore: { teamScore: 23, opponentScore: 10, phase: 'q3', clockSeconds: 165 },
      });
    }),
    changed('scheduled game halftime score', true, (p) => {
      Object.assign(p.matchups[0].sides[0].starters[0].game!, {
        liveScore: { teamScore: 10, opponentScore: 24, phase: 'halftime', clockSeconds: null },
      });
    }),
    changed('scheduled game overtime without clock', true, (p) => {
      Object.assign(p.matchups[0].sides[0].starters[0].game!, {
        liveScore: { teamScore: 0, opponentScore: 0, phase: 'overtime', clockSeconds: null },
      });
    }),
    changed('scheduled game incomplete live score', false, (p) => {
      Object.assign(p.matchups[0].sides[0].starters[0].game!, {
        liveScore: { teamScore: 23, phase: 'q3', clockSeconds: 165 },
      });
    }),
    changed('scheduled game string live score', false, (p) => {
      Object.assign(p.matchups[0].sides[0].starters[0].game!, {
        liveScore: { teamScore: '23', opponentScore: 10, phase: 'q3', clockSeconds: 165 },
      });
    }),
    changed('scheduled game string live clock', false, (p) => {
      Object.assign(p.matchups[0].sides[0].starters[0].game!, {
        liveScore: { teamScore: 23, opponentScore: 10, phase: 'q3', clockSeconds: '2:45' },
      });
    }),
    changed('scheduled game missing live clock', false, (p) => {
      Object.assign(p.matchups[0].sides[0].starters[0].game!, {
        liveScore: { teamScore: 23, opponentScore: 10, phase: 'q3' },
      });
    }),
    changed('scheduled game unknown live phase', false, (p) => {
      Object.assign(p.matchups[0].sides[0].starters[0].game!, {
        liveScore: { teamScore: 23, opponentScore: 10, phase: 'unknown', clockSeconds: 165 },
      });
    }),
    changed('scheduled game null live score', false, (p) => {
      Object.assign(p.matchups[0].sides[0].starters[0].game!, { liveScore: null });
    }),
    changed('date invalid', false, (p) => { p.updatedAt = 'not-a-date'; }),
    changed('date null', false, (p) => { Object.assign(p, { updatedAt: null }); }),
    changed('date non-ISO accepted by JS', true, (p) => { p.updatedAt = 'September 13, 2026 18:00 GMT'; }),
    probabilityCase('live estimate', true, () => {}),
    probabilityCase('upcoming estimate', true, (m) => { m.status = 'upcoming'; }),
    probabilityCase('orientation independent', true, (m) => { m.sides.reverse(); }),
    probabilityCase('probability order independent', true, (m) => {
      const teams = probabilityTeams(m);
      Object.assign(m.winProbability!, { teams: [teams[1], teams[0]] });
    }),
    probabilityCase('unavailable isolated lineup', true, (m) => {
      m.sides = [m.sides[0]];
      m.status = 'unknown';
      m.winProbability = { modelVersion: 'normal-v1', status: 'unavailable', reason: 'missing-lineup' };
    }),
    probabilityCase('unavailable final', true, (m) => {
      m.status = 'final';
      m.winProbability = { modelVersion: 'normal-v1', status: 'unavailable', reason: 'missing-official-score' };
    }),
    probabilityCase('one side cannot have estimate', false, (m) => { m.sides.pop(); }),
    probabilityCase('wrong opponent identity', false, (m) => { probabilityTeams(m)[1].teamId = 3; }),
    probabilityCase('duplicate probability team', false, (m) => { probabilityTeams(m)[1].teamId = 1; }),
    probabilityCase('duplicate side identity', false, (m) => { m.sides[1].team.id = 1; }),
    probabilityCase('out of range', false, (m) => {
      probabilityTeams(m)[0].probability = 1.2;
      probabilityTeams(m)[1].probability = -0.2;
    }),
    probabilityCase('estimate cannot assert certainty', false, (m) => {
      probabilityTeams(m)[0].probability = 1;
      probabilityTeams(m)[1].probability = 0;
    }),
    probabilityCase('estimate complement', false, (m) => { probabilityTeams(m)[1].probability = 0.3; }),
    probabilityCase('complement floating point tolerance', true, (m) => {
      probabilityTeams(m)[1].probability = 0.4000000001;
    }),
    probabilityCase('complement beyond tolerance', false, (m) => {
      probabilityTeams(m)[1].probability = 0.40000001;
    }),
    probabilityCase('final cannot carry an estimate', false, (m) => { m.status = 'final'; }),
    probabilityCase('unknown cannot carry an estimate', false, (m) => { m.status = 'unknown'; }),
    probabilityCase('strict state with estimates', false, (m) => { Object.assign(m, { status: ['live'] }); }),
    probabilityCase('official final winner', true, (m) => {
      m.status = 'final';
      Object.assign(m.winProbability!, { status: 'final' });
      probabilityTeams(m)[0].probability = 1;
      probabilityTeams(m)[1].probability = 0;
    }),
    probabilityCase('official final winner with reversed sides', true, (m) => {
      m.status = 'final';
      Object.assign(m.winProbability!, { status: 'final' });
      probabilityTeams(m)[0].probability = 1;
      probabilityTeams(m)[1].probability = 0;
      m.sides.reverse();
    }),
    probabilityCase('contradictory final winner', false, (m) => {
      m.status = 'final';
      Object.assign(m.winProbability!, { status: 'final' });
      probabilityTeams(m)[0].probability = 0;
      probabilityTeams(m)[1].probability = 1;
    }),
    probabilityCase('final result before final', false, (m) => {
      Object.assign(m.winProbability!, { status: 'final' });
      probabilityTeams(m)[0].probability = 1;
      probabilityTeams(m)[1].probability = 0;
    }),
    probabilityCase('final needs official scores', false, (m) => {
      m.status = 'final'; m.sides[0].points = null;
      Object.assign(m.winProbability!, { status: 'final' });
      probabilityTeams(m)[0].probability = 1;
      probabilityTeams(m)[1].probability = 0;
    }),
    probabilityCase('official tied result', true, (m) => {
      m.status = 'final'; m.sides[1].points = m.sides[0].points;
      Object.assign(m.winProbability!, { status: 'tie' });
      probabilityTeams(m)[0].probability = 0;
      probabilityTeams(m)[1].probability = 0;
    }),
    probabilityCase('tie cannot assign a win', false, (m) => {
      m.status = 'final'; m.sides[1].points = m.sides[0].points;
      Object.assign(m.winProbability!, { status: 'tie' });
    }),
    probabilityCase('tie must have equal official scores', false, (m) => {
      m.status = 'final';
      Object.assign(m.winProbability!, { status: 'tie' });
      probabilityTeams(m)[0].probability = 0;
      probabilityTeams(m)[1].probability = 0;
    }),
    probabilityCase('winner cannot override tie', false, (m) => {
      m.status = 'final'; m.sides[1].points = m.sides[0].points;
      Object.assign(m.winProbability!, { status: 'final' });
      probabilityTeams(m)[0].probability = 1;
      probabilityTeams(m)[1].probability = 0;
    }),
    probabilityCase('unknown model', false, (m) => { Object.assign(m.winProbability!, { modelVersion: 'other-v1' }); }),
    probabilityCase('unknown normal model version', false, (m) => { Object.assign(m.winProbability!, { modelVersion: 'normal-v3' }); }),
    probabilityCase('unknown unavailable model version', false, (m) => {
      Object.assign(m, { winProbability: { modelVersion: 'normal-v3', status: 'unavailable', reason: 'missing-lineup' } });
    }),
    probabilityCase('missing unavailable reason', false, (m) => {
      Object.assign(m, { winProbability: { modelVersion: 'normal-v1', status: 'unavailable' } });
    }),
    probabilityCase('null value', false, (m) => { Object.assign(m, { winProbability: null }); }),
    probabilityCase('string probability', false, (m) => { Object.assign(probabilityTeams(m)[0], { probability: '0.6' }); }),
    probabilityCase('missing team estimate', false, (m) => { Object.assign(m.winProbability!, { teams: [probabilityTeams(m)[0]] }); }),
    probabilityCase('third team estimate', false, (m) => {
      Object.assign(m.winProbability!, { teams: [...probabilityTeams(m), { teamId: 3, probability: 0 }] });
    }),
  ];
  // The same immutable-payload corpus is consumed by full readers, compact
  // readers and isolated PostgreSQL parity checks. Preserve v1 cases and replay
  // every applicable semantic guard for v2, including unavailable/final/tie.
  for (const example of [...cases]) {
    if (!example.name.startsWith('win probability semantic:')) continue;
    const data = JSON.parse(example.json) as { matchups: { winProbability?: { modelVersion?: unknown } | null }[] };
    const probability = data.matchups[0].winProbability;
    if (probability?.modelVersion !== 'normal-v1') continue;
    probability.modelVersion = 'normal-v2';
    cases.push({ ...example, name: `${example.name} (normal-v2)`, json: JSON.stringify(data) });
  }
  const roundedIdentity = probabilityCase('JavaScript identity rounding', true, (m) => {
    Object.assign(m.sides[0].team, { id: '__NUMBER__' });
  });
  cases.push({ ...roundedIdentity, json: roundedIdentity.json.replace('"__NUMBER__"', '1.00000000000000001') });
  const underflow = probabilityCase('underflow is zero and not certainty', false, (m) => {
    Object.assign(probabilityTeams(m)[0], { probability: '__NUMBER__' });
    probabilityTeams(m)[1].probability = 1;
  });
  cases.push({ ...underflow, json: underflow.json.replace('"__NUMBER__"', '1e-400') });
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
