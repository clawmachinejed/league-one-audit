import { describe, expect, it } from 'vitest';
import type {
  GameStateObservation,
  GameStateSlate,
  LeagueWeekState,
  ScoringEntity,
} from '../domain/contracts';
import type { NflGameId, ScoringEntityId } from '../ports/identity-crosswalk';
import type {
  ProjectionBaselineRecord,
  ProjectionRunId,
} from '../ports/projection-repository';
import {
  externalGameRef,
  externalLeagueRef,
  externalPlayerRef,
  externalMatchupRef,
  externalRosterRef,
  externalTeamDefenseRef,
  providerKey,
} from '../shared/provider-identity';
import {
  assertCompleteGameCoverage,
  kickoffForGame,
  startedGame,
} from './game-context';
import type { LoadedLeague, PregameProjectionSet } from './contracts';
import {
  buildProjectedMatchupSnapshot,
  buildSnapshot,
  toMatchupsData,
} from './snapshot-builder';

const official = providerKey('official-source');
const gameProvider = providerKey('game-state-source');
const leagueRef = externalLeagueRef(official, 'league-1');
const rosterOne = externalRosterRef(leagueRef, '1');
const rosterTwo = externalRosterRef(leagueRef, '2');
const period = { season: 2026, seasonType: 'regular' as const, week: 1 };
const requestStartedAt = '2026-09-13T18:00:00.000Z';
const requestCompletedAt = '2026-09-13T18:00:01.000Z';
const calculatedAt = requestCompletedAt;

function player(id: string, team: ScoringEntity['nflTeam'], position = 'RB'): ScoringEntity {
  return {
    kind: 'player',
    externalRef: externalPlayerRef(official, id),
    displayName: `Player ${id}`,
    nflTeam: team,
    position,
    injuryStatus: id === 'live' ? 'Q' : null,
  };
}

const live = player('live', 'KC');
const pregame = player('pregame', 'BUF');
const bye = player('bye', 'SF');
const final = player('final', 'PHI');
const missingFrozen = player('missing-frozen', 'KC');
const defense: ScoringEntity = {
  kind: 'team-defense',
  externalRef: externalTeamDefenseRef(official, 'JAX'),
  displayName: 'JAX Defense',
  nflTeam: 'JAX',
  position: 'DEF',
  injuryStatus: null,
};

function source(): LeagueWeekState {
  return {
    configuration: {
      key: 'league',
      displayName: 'League',
      leagueRef,
      matchupWeekRange: { firstWeek: 1, lastWeek: 18 },
    },
    leagueName: 'League API Name',
    lineupShape: { expectedRosterCount: 2, expectedStarterSlotCount: 7, expectedRosterRefs: [rosterOne, rosterTwo] },
    period,
    maxWeek: 18,
    rosterPositions: ['RB', 'RB', 'FLEX', 'FLEX', 'DEF', 'FLEX', 'FLEX'],
    participants: [
      {
        rosterRef: rosterOne,
        managerName: 'Manager One',
        teamName: 'One Team',
        avatarUrl: 'https://example.com/one.png',
        wins: 1,
        losses: 0,
        ties: 0,
        pointsFor: 100.5,
        pointsAgainst: 80.25,
      },
      {
        rosterRef: rosterTwo,
        managerName: 'Manager Two',
        teamName: 'Two Team',
        avatarUrl: null,
        wins: 0,
        losses: 1,
        ties: 0,
        pointsFor: 80.25,
        pointsAgainst: 100.5,
      },
    ],
    matchups: [{
      matchupRef: externalMatchupRef(leagueRef, period, '4'),
      status: 'unknown',
      sides: [
        {
          rosterRef: rosterOne,
          officialPoints: 43,
          starters: [
            { kind: 'occupied', slot: 'RB', entity: live, officialPoints: 10 },
            { kind: 'occupied', slot: 'RB', entity: pregame, officialPoints: 0 },
            { kind: 'occupied', slot: 'FLEX', entity: bye, officialPoints: 0 },
            { kind: 'occupied', slot: 'FLEX', entity: final, officialPoints: 18 },
            { kind: 'occupied', slot: 'DEF', entity: defense, officialPoints: 3 },
            { kind: 'occupied', slot: 'FLEX', entity: missingFrozen, officialPoints: 2 },
            { kind: 'empty', slot: 'FLEX' },
          ],
        },
        {
          rosterRef: rosterTwo,
          officialPoints: 0,
          starters: [{ kind: 'empty', slot: 'RB' }],
        },
      ],
    }],
    rosteredEntities: [live, pregame, bye, final, defense, missingFrozen],
    schedule: {
      KC: {
        kind: 'scheduled', opponent: 'LAC', location: 'home', date: '2026-09-13',
        kickoffAt: '2026-09-13T17:00:00.000Z',
      },
      BUF: {
        kind: 'scheduled', opponent: 'MIA', location: 'home', date: '2026-09-13',
        kickoffAt: '2026-09-13T20:00:00.000Z',
      },
      SF: { kind: 'bye' },
      PHI: {
        kind: 'scheduled', opponent: 'DAL', location: 'away', date: '2026-09-13',
        kickoffAt: '2026-09-13T13:00:00.000Z',
      },
      JAX: {
        kind: 'scheduled', opponent: 'HOU', location: 'home', date: '2026-09-13',
        kickoffAt: '2026-09-13T17:00:00.000Z',
      },
    },
    scoringSettings: { provider: official, rawRules: { rush_yd: 0.1 } },
    requestStartedAt,
    requestCompletedAt,
    observedAt: requestCompletedAt,
    lineup: { revisionVersion: 'lineup-v1', lineupRevision: '1'.repeat(64) },
    sourceRevision: 'source-revision',
    warning: undefined,
  };
}

function game(
  id: string,
  homeTeam: GameStateObservation['homeTeam'],
  awayTeam: GameStateObservation['awayTeam'],
  overrides: Partial<GameStateObservation>,
): GameStateObservation {
  return {
    gameRef: externalGameRef(gameProvider, id),
    period,
    homeTeam,
    awayTeam,
    statusCode: 0,
    statusText: null,
    sourcePeriod: null,
    gameClock: null,
    phase: 'pregame',
    clockSeconds: null,
    remainingFraction: 1,
    homeScore: null,
    awayScore: null,
    requestStartedAt,
    requestCompletedAt,
    observedAt: requestCompletedAt,
    sourceRevision: `${id}-revision`,
    ...overrides,
  };
}

function games(overrides: Partial<GameStateSlate> = {}): GameStateSlate {
  return {
    source: gameProvider,
    period,
    requestStartedAt,
    requestCompletedAt,
    observedAt: requestCompletedAt,
    games: [
      game('kc-lac', 'KC', 'LAC', {
        statusCode: 1, phase: 'q2', gameClock: '8:00', clockSeconds: 480, remainingFraction: 0.5,
      }),
      game('buf-mia', 'BUF', 'MIA', { statusCode: 0, phase: 'pregame', remainingFraction: 1 }),
      game('phi-dal', 'DAL', 'PHI', { statusCode: 2, phase: 'final', remainingFraction: 0 }),
      game('jax-hou', 'JAX', 'HOU', {
        statusCode: 1, phase: 'q2', gameClock: '8:00', clockSeconds: 480, remainingFraction: 0.5,
      }),
    ],
    ...overrides,
  };
}

function baseline(
  entity: ScoringEntity,
  projectionPoints: number,
  id: string,
): ProjectionBaselineRecord {
  return {
    officialEntityRef: entity.externalRef,
    entityId: `entity-${id}` as ScoringEntityId,
    entityKind: entity.kind,
    displayName: entity.displayName,
    nflTeam: entity.nflTeam,
    gameId: `game-${id}` as NflGameId,
    projectionGameRef: externalGameRef(gameProvider, `game-${id}`),
    projectionPoints,
    projectedStats: { projectionPoints },
    quality: 'complete',
    sourceProjectionRunId: `run-${id}` as ProjectionRunId,
    projectionSource: providerKey('projection-source'),
    modelVersion: 'clock-v1',
    observedAt: requestCompletedAt,
    frozenAt: null,
  };
}

const scored: PregameProjectionSet = { status: 'available', projections: [] };

describe('optional exact-week bench projections', () => {
  it.each([
    { name: 'pregame', team: 'BUF' as const, officialPoints: 0, expected: 20 },
    { name: 'live', team: 'KC' as const, officialPoints: 4, expected: 14 },
    { name: 'final', team: 'PHI' as const, officialPoints: 13, expected: 20 },
    { name: 'missing live points', team: 'KC' as const, officialPoints: null, expected: null },
    { name: 'missing final points', team: 'PHI' as const, officialPoints: null, expected: null },
    { name: 'missing baseline', team: 'BUF' as const, officialPoints: 0, expected: null, noBaseline: true },
    { name: 'missing team context', team: null, officialPoints: -2, expected: null },
  ])('uses clock-v1 for $name without changing starter totals', ({ name, team, officialPoints, expected, noBaseline }) => {
    const input = snapshotInput();
    const before = buildSnapshot(input);
    const entity = player(`bench-${name}`, team);
    const side = input.source.matchups[0].sides[0];
    const withBench: LeagueWeekState = { ...input.source, matchups: [{ ...input.source.matchups[0],
      sides: [{ ...side, bench: [{ kind: 'occupied', entity, slot: 'BN', officialPoints }] }, input.source.matchups[0].sides[1]],
    }] };
    const record = baseline(entity, 20, 'bench');
    const result = buildSnapshot({ ...input, source: withBench,
      latest: noBaseline ? input.latest : [...input.latest, record],
      frozen: noBaseline ? input.frozen : [...input.frozen, record],
    });
    const published = result.matchups[0].sides[0];
    expect(published.bench?.[0]).toMatchObject({ id: `bench-${name}`, slot: 'BN', points: officialPoints, projectedPoints: expected });
    expect(published.starters).toEqual(before.matchups[0].sides[0].starters);
    expect(published.projectedPoints).toBe(before.matchups[0].sides[0].projectedPoints);
    expect(published.points).toBe(before.matchups[0].sides[0].points);
  });

  it('keeps a known bye projection at zero without inventing its official score', () => {
    const input = snapshotInput();
    const entity = player('bench-bye', 'SF');
    const source: LeagueWeekState = { ...input.source, matchups: [{ ...input.source.matchups[0], sides: [
      { ...input.source.matchups[0].sides[0], bench: [{ kind: 'occupied', entity, slot: 'BN', officialPoints: null }] },
      input.source.matchups[0].sides[1],
    ] }] };
    expect(buildSnapshot({ ...input, source }).matchups[0].sides[0].bench?.[0]).toMatchObject({
      points: null, projectedPoints: 0, game: { kind: 'bye' },
    });
  });

  it.each(['unknown starters', 'duplicate membership', 'starter overlap'])('does not invent bench assignments for %s', (condition) => {
    const input = snapshotInput();
    const entity = condition === 'starter overlap' ? live : player('bench', 'BUF');
    const entry = { kind: 'occupied' as const, entity, slot: 'BN', officialPoints: 0 };
    const source: LeagueWeekState = { ...input.source, matchups: [{ ...input.source.matchups[0], sides: [
      { ...input.source.matchups[0].sides[0], ...(condition === 'unknown starters' ? { starters: [] } : {}),
        bench: condition === 'duplicate membership' ? [entry, entry] : [entry] },
      input.source.matchups[0].sides[1],
    ] }] };
    expect(buildSnapshot({ ...input, source }).matchups[0].sides[0].bench).toBeNull();
  });
});

function snapshotInput() {
  return {
    source: source(),
    games: games(),
    scored,
    latest: [
      baseline(pregame, 12, 'pregame'),
      baseline(bye, 5, 'bye'),
      baseline(missingFrozen, 9, 'missing-frozen'),
    ],
    frozen: [
      baseline(live, 20, 'live'),
      baseline(final, 15, 'final'),
      baseline(defense, 7, 'defense'),
    ],
    prior: null,
    calculatedAt,
  };
}

describe('win chance through the canonical snapshot boundary', () => {
  function probabilityInput() {
    const input = snapshotInput();
    const match = input.source.matchups[0];
    return { ...input, source: { ...input.source, matchups: [{ ...match, sides: [
      { ...match.sides[0], officialPoints: 10, starters: [match.sides[0].starters[0]] },
      { ...match.sides[1], officialPoints: 0, starters: [match.sides[0].starters[1]] },
    ] }] } };
  }

  it('publishes deterministic paired estimates using only starting players', () => {
    const input = probabilityInput();
    const payload = buildSnapshot(input);
    const odds = payload.matchups[0].winProbability;
    expect(odds).toMatchObject({ modelVersion: 'normal-v3', status: 'estimated', teams: [
      { teamId: 1, probability: expect.any(Number) }, { teamId: 2, probability: expect.any(Number) },
    ] });
    if (!odds || odds.status !== 'estimated') throw new Error('Expected estimate');
    expect(odds.teams[0].probability).toBeGreaterThan(0.5);
    expect(odds.teams[0].probability + odds.teams[1].probability).toBe(1);
    expect(buildSnapshot({ ...input, calculatedAt: '2026-09-13T18:00:02.000Z' })
      .matchups[0].winProbability).toEqual(odds);
    const bench = { kind: 'occupied' as const, slot: 'BN', entity: final, officialPoints: 500 };
    const withBench = { ...input.source, matchups: input.source.matchups.map((matchup) => ({ ...matchup,
      sides: matchup.sides.map((side) => ({ ...side, bench: [bench] })),
    })) };
    expect(buildSnapshot({ ...input, source: withBench }).matchups[0].winProbability).toEqual(odds);
  });

  it('uses actual finished contributions rather than the displayed pregame player value', () => {
    const input = probabilityInput();
    const changed = { ...input, source: { ...input.source, matchups: input.source.matchups.map((matchup) => ({
      ...matchup, sides: [
        { ...matchup.sides[0], officialPoints: 18, starters: [input.source.matchups[0].sides[0].starters[0]] },
        matchup.sides[1],
      ],
    })) }, games: { ...input.games, games: input.games.games.map((game) => game.homeTeam === 'KC'
      ? { ...game, phase: 'final' as const, statusCode: 2 as const, remainingFraction: 0 } : game) } };
    const before = buildSnapshot(changed);
    const after = buildSnapshot({ ...changed, frozen: changed.frozen.map((record) => ({ ...record, projectionPoints: 900 })) });
    expect(after.matchups[0].sides[0].starters[0].projectedPoints).toBe(900);
    expect(after.matchups[0].winProbability).toEqual(before.matchups[0].winProbability);
  });

  it('honors official team adjustments in estimates without changing scores or clock-v1 totals', () => {
    const input = probabilityInput();
    const before = buildSnapshot(input);
    const changed = { ...input.source, matchups: input.source.matchups.map((matchup) => ({ ...matchup,
      sides: matchup.sides.map((side, index) => index === 0 ? { ...side, officialPoints: 40 } : side),
    })) };
    const after = buildSnapshot({ ...input, source: changed });
    const beforeOdds = before.matchups[0].winProbability;
    const afterOdds = after.matchups[0].winProbability;
    if (!beforeOdds || beforeOdds.status !== 'estimated' || !afterOdds || afterOdds.status !== 'estimated') {
      throw new Error('Expected estimates');
    }
    expect(afterOdds.teams[0].probability).toBeGreaterThan(beforeOdds.teams[0].probability);
    expect(after.matchups[0].sides[0].projectedPoints).toBe(before.matchups[0].sides[0].projectedPoints);
    expect(after.matchups[0].sides[0].points).toBe(40);
  });

  it('isolates a missing lineup while keeping another matchup estimated', () => {
    const input = probabilityInput();
    const healthy = input.source.matchups[0];
    const missing = { ...healthy, matchupRef: externalMatchupRef(leagueRef, period, '5'),
      sides: healthy.sides.map((side, index) => index === 0 ? { ...side, starters: [] } : side) };
    const result = buildSnapshot({ ...input, source: { ...input.source, matchups: [healthy, missing] } });
    expect(result.matchups[0].winProbability?.status).toBe('estimated');
    expect(result.matchups[1].winProbability).toEqual({ modelVersion: 'normal-v3', status: 'unavailable', reason: 'missing-lineup' });
    expect(result.matchups[0].sides[0].projectedPoints).toBe(20);
  });

  it('never converts the existing missing-baseline zero policy into confident odds', () => {
    const input = probabilityInput();
    const result = buildSnapshot({ ...input, frozen: [] });
    expect(result.matchups[0].sides[0].projectedPoints).toBe(10);
    expect(result.matchups[0].winProbability).toEqual({ modelVersion: 'normal-v3', status: 'unavailable', reason: 'missing-projection' });
  });

  it('uses official final team totals even without frozen baselines', () => {
    const input = probabilityInput();
    const result = buildSnapshot({ ...input, frozen: [], games: { ...input.games,
      games: input.games.games.map((game) => ({ ...game, phase: 'final', statusCode: 2, remainingFraction: 0 })),
    } });
    expect(result.matchups[0].winProbability).toEqual({ modelVersion: 'normal-v3', status: 'final', teams: [
      { teamId: 1, probability: 1 }, { teamId: 2, probability: 0 },
    ] });
  });

  it('uses exact requested-period game context for estimates', () => {
    const input = probabilityInput();
    const result = buildSnapshot({ ...input, games: { ...input.games, period: { ...period, week: 2 } } });
    expect(result.matchups[0].winProbability).toEqual({ modelVersion: 'normal-v3', status: 'unavailable', reason: 'unknown-game-state' });
  });

  function outInput(injuryStatus = 'Out') {
    const input = probabilityInput();
    return { ...input, source: { ...input.source, currentPlayerStatusPeriod: period,
      matchups: input.source.matchups.map((matchup) => ({ ...matchup,
        sides: matchup.sides.map((side) => ({ ...side, starters: side.starters.map((slot) => slot.kind === 'occupied'
          ? { ...slot, entity: { ...slot.entity, injuryStatus } } : slot) })),
      })),
    } };
  }

  it.each(['Out', 'IR'])('zeros active %s forecasts while retaining accumulated actuals and immutable baselines', (status) => {
    const input = outInput(status);
    const before = structuredClone(input);
    const result = buildSnapshot(input);
    expect(result.matchups[0].sides.map((side) => side.projectedPoints)).toEqual([10, 0]);
    expect(result.matchups[0].sides.map((side) => side.points)).toEqual([10, 0]);
    expect(result.matchups[0].sides[0].starters[0]).toMatchObject({ points: 10, projectedPoints: 10 });
    // Every remaining starter here has no expected participation, so no nonfinal certainty is invented.
    expect(result.matchups[0].winProbability).toMatchObject({ status: 'unavailable', reason: 'unknown-game-state' });
    expect(input).toEqual(before);
  });

  it.each(['Out', 'IR'].flatMap((status) =>
    [undefined, null, { ...period, week: 2 }, { ...period, season: 2025 }].map((scope) => ({ status, scope }))))(
    'does not apply current $status metadata without matching active-period authority: $scope', ({ status, scope }) => {
      const input = outInput(status);
      const result = buildSnapshot({ ...input, source: { ...input.source, currentPlayerStatusPeriod: scope } });
      expect(result.matchups[0].sides.map((side) => side.projectedPoints)).toEqual([20, 12]);
      expect(result.matchups[0].winProbability?.status).toBe('estimated');
    },
  );

  it.each(['Questionable', 'Doubtful', 'Suspended', null])('does not manufacture a nonparticipation zero for %s', (injuryStatus) => {
    const input = outInput();
    const changed = { ...input.source, matchups: input.source.matchups.map((matchup) => ({ ...matchup,
      sides: matchup.sides.map((side) => ({ ...side, starters: side.starters.map((slot) => slot.kind === 'occupied'
        ? { ...slot, entity: { ...slot.entity, injuryStatus } } : slot) })),
    })) };
    const result = buildSnapshot({ ...input, source: changed, frozen: [] });
    expect(result.matchups[0].winProbability).toMatchObject({ status: 'unavailable', reason: 'missing-projection' });
  });

  it.each(['Out', 'IR'])('preserves final actuals and frozen display values for a currently %s player', (status) => {
    const input = outInput(status);
    const result = buildSnapshot({ ...input, games: { ...input.games,
      games: input.games.games.map((game) => ({ ...game, phase: 'final', statusCode: 2, remainingFraction: 0 })),
    } });
    expect(result.matchups[0].sides[0].starters[0]).toMatchObject({ points: 10, projectedPoints: 20 });
    expect(result.matchups[0].sides[0].projectedPoints).toBe(10);
    expect(result.matchups[0].winProbability).toMatchObject({ status: 'final' });
  });

  it.each(['Out', 'IR'])('does not treat unknown or ambiguous game evidence as a usable %s zero', (status) => {
    const input = outInput(status);
    const mismatched = buildSnapshot({ ...input, games: { ...input.games, period: { ...period, week: 2 } } });
    expect(mismatched.matchups[0].sides[1].projectedPoints).toBe(12);
    expect(mismatched.matchups[0].winProbability).toMatchObject({ status: 'unavailable', reason: 'unknown-game-state' });
    const duplicate = buildSnapshot({ ...input, games: { ...input.games, games: [...input.games.games, input.games.games[1]] } });
    expect(duplicate.matchups[0].sides[1].projectedPoints).toBe(12);
    expect(duplicate.matchups[0].winProbability).toMatchObject({ status: 'unavailable', reason: 'unknown-game-state' });
  });

  it.each(['Out', 'IR'].flatMap((status) =>
    (['suspended', 'postponed'] as const).map((phase) => ({ status, phase }))))(
    'retains existing forecast behavior for a $status player in a $phase game', ({ status, phase }) => {
    const input = outInput(status);
    const pausedGames = { ...input.games, games: input.games.games.map((game) => game.homeTeam === 'KC'
      ? { ...game, phase, statusCode: phase === 'postponed' ? 3 as const : 4 as const,
          remainingFraction: phase === 'postponed' ? 1 : null } : game) };
    const before = buildSnapshot({ ...input, games: pausedGames, source: { ...input.source, currentPlayerStatusPeriod: null } });
    const after = buildSnapshot({ ...input, games: pausedGames });
    expect(after.matchups[0].sides[0]).toEqual(before.matchups[0].sides[0]);
    expect(after.matchups[0].winProbability).toMatchObject({ status: 'unavailable', reason: 'unknown-game-state' });
  });

  function missingIrBaselineInput() {
    const input = probabilityInput();
    return { ...input, latest: [], source: { ...input.source, currentPlayerStatusPeriod: period,
      matchups: input.source.matchups.map((matchup) => ({ ...matchup,
        sides: matchup.sides.map((side, index) => index === 0 ? side : { ...side,
          starters: side.starters.map((slot) => slot.kind === 'occupied'
            ? { ...slot, entity: { ...slot.entity, injuryStatus: 'IR' } } : slot),
        }),
      })),
    } };
  }

  it('estimates a mixed lineup with an active IR starter but still rejects unrelated missing projections', () => {
    const input = missingIrBaselineInput();
    const before = structuredClone(input);
    const result = buildSnapshot(input);
    expect(result.matchups[0].winProbability).toMatchObject({ modelVersion: 'normal-v3', status: 'estimated' });
    expect(result.matchups[0].sides[1].starters[0]).toMatchObject({ injuryStatus: 'IR', points: 0, projectedPoints: 0 });
    // The IR starter contributes no remaining mean or variance, even if a stale baseline exists.
    expect(buildSnapshot({ ...input, latest: [baseline(pregame, 900, 'stale-ir')] }).matchups[0].winProbability)
      .toEqual(result.matchups[0].winProbability);
    expect(buildSnapshot({ ...input, frozen: [] }).matchups[0].winProbability)
      .toMatchObject({ status: 'unavailable', reason: 'missing-projection' });
    expect(input).toEqual(before);
  });

  it('restores the normal baseline requirements after IR is removed', () => {
    const input = missingIrBaselineInput();
    const source = { ...input.source, matchups: input.source.matchups.map((matchup) => ({ ...matchup,
      sides: matchup.sides.map((side) => ({ ...side, starters: side.starters.map((slot) => slot.kind === 'occupied'
        ? { ...slot, entity: { ...slot.entity, injuryStatus: null } } : slot) })),
    })) };
    expect(buildSnapshot({ ...input, source }).matchups[0].winProbability)
      .toMatchObject({ status: 'unavailable', reason: 'missing-projection' });
    const restored = buildSnapshot({ ...input, source, latest: [baseline(pregame, 12, 'reinstated')] });
    expect(restored.matchups[0].winProbability?.status).toBe('estimated');
    expect(restored.matchups[0].sides[1].projectedPoints).toBe(12);
  });

  it('does not override a pregame IR starter with nonzero official actuals', () => {
    const input = missingIrBaselineInput();
    const source = { ...input.source, matchups: input.source.matchups.map((matchup) => ({ ...matchup,
      sides: matchup.sides.map((side, index) => index === 0 ? side : { ...side, officialPoints: 5,
        starters: side.starters.map((slot) => ({ ...slot, officialPoints: 5 })),
      }),
    })) };
    const result = buildSnapshot({ ...input, source });
    expect(result.matchups[0].sides[1].points).toBe(5);
    expect(result.matchups[0].winProbability).toMatchObject({ status: 'unavailable', reason: 'missing-projection' });
  });
});

describe('canonical worker game context and snapshot builder', () => {
  it('retains healthy projections and exact official totals while an unknown lineup stays empty and unprojected', () => {
    const input = snapshotInput();
    const before = buildSnapshot(input);
    const source = { ...input.source, matchups: input.source.matchups.map((matchup) => ({
      ...matchup, sides: matchup.sides.map((side, index) => index === 1
        ? { ...side, starters: [], officialPoints: 17.5 } : side),
    })) };
    const result = buildSnapshot({ ...input, source, prior: before });
    expect(result.matchups[0].sides[0]).toEqual(before.matchups[0].sides[0]);
    expect(result.matchups[0].sides[1]).toMatchObject({ points: 17.5, projectedPoints: null, starters: [] });
  });

  it('does not infer finality for an unknown lineup when only the known opponent finished', () => {
    const input = snapshotInput();
    const source = { ...input.source, matchups: input.source.matchups.map((matchup) => ({
      ...matchup, status: 'unknown' as const, sides: matchup.sides.map((side, index) => index === 1
        ? { ...side, starters: [] } : side),
    })) };
    const result = buildSnapshot({ ...input, source, games: { ...input.games, games: input.games.games.map((game) => ({
      ...game, phase: 'final' as const, statusCode: 2, remainingFraction: 0,
    })) } });
    expect(result.matchups[0].status).toBe('unknown');
  });

  it.each(['pregame', 'postponed'] as const)(
    'keeps an unavailable-lineup matchup live after an early final while a known game is %s', (phase) => {
      const input = snapshotInput();
      const gameStates = { ...input.games, games: input.games.games.map((game): GameStateObservation => (
        game.homeTeam === 'BUF'
          ? { ...game, phase, statusCode: phase === 'pregame' ? 0 : 3, remainingFraction: phase === 'pregame' ? 1 : null }
          : { ...game, phase: 'final', statusCode: 2, remainingFraction: 0 }
      )) };
      const before = buildSnapshot({ ...input, games: gameStates });
      const source = { ...input.source, matchups: input.source.matchups.map((matchup) => ({
        ...matchup, sides: matchup.sides.map((side, index) => index === 1
          ? { ...side, starters: [], officialPoints: null } : side),
      })) };
      const result = buildSnapshot({ ...input, source, games: gameStates, prior: before });
      expect(before.matchups[0].status).toBe('live');
      expect(result.matchups[0].status).toBe('live');
      expect(result.matchups[0].sides[0]).toEqual(before.matchups[0].sides[0]);
      expect(result.matchups[0].sides[1]).toMatchObject({ points: null, projectedPoints: null, starters: [] });
    },
  );

  it('accepts synchronized game coverage, explicit byes, and the inclusive skew limit', () => {
    const loaded: LoadedLeague = {
      configuration: source().configuration,
      source: source(),
      cadence: 'live-window',
    };
    expect(() => assertCompleteGameCoverage(loaded, games())).not.toThrow();
    expect(() => assertCompleteGameCoverage(loaded, games({
      requestCompletedAt: '2026-09-13T18:01:31.000Z',
    }))).not.toThrow();
    expect(() => assertCompleteGameCoverage(loaded, games({
      requestCompletedAt: '2026-09-13T18:01:32.000Z',
    }))).toThrow('not synchronized closely enough');
  });

  it('rejects missing schedules, identity disagreement, and incomplete live clocks', () => {
    const original = source();
    const loaded = (changed: LeagueWeekState): LoadedLeague => ({
      configuration: changed.configuration,
      source: changed,
      cadence: 'live-window',
    });
    expect(() => assertCompleteGameCoverage(loaded({ ...original, schedule: {} }), games()))
      .toThrow('missing its NFL schedule');
    expect(() => assertCompleteGameCoverage(loaded({
      ...original,
      schedule: {
        ...original.schedule,
        KC: {
          kind: 'scheduled',
          opponent: 'DEN',
          location: 'home',
          date: '2026-09-13',
          kickoffAt: '2026-09-13T17:00:00.000Z',
        },
      },
    }), games())).toThrow('identities do not agree');
    const incomplete = games({
      games: games().games.map((value) => value.homeTeam === 'KC'
        ? { ...value, phase: 'unknown' as const, remainingFraction: null }
        : value),
    });
    expect(() => assertCompleteGameCoverage(loaded(original), incomplete))
      .toThrow('incomplete live game clock');
  });

  it('preserves kickoff agreement and started status-code semantics', () => {
    const loaded: LoadedLeague = {
      configuration: source().configuration,
      source: source(),
      cadence: 'live-window',
    };
    const kcGame = games().games[0];
    expect(kickoffForGame(kcGame, [loaded])).toBe('2026-09-13T17:00:00.000Z');
    expect(startedGame(kcGame)).toBe(true);
    expect(startedGame({ ...kcGame, statusCode: 2 })).toBe(true);
    expect(startedGame({ ...kcGame, statusCode: 4 })).toBe(true);
    expect(startedGame({ ...kcGame, statusCode: 3 })).toBe(false);
    expect(kickoffForGame(kcGame, [loaded, {
      ...loaded,
      source: {
        ...loaded.source,
        schedule: {
          ...loaded.source.schedule,
          KC: {
            kind: 'scheduled',
            opponent: 'LAC',
            location: 'home',
            date: '2026-09-13',
            kickoffAt: '2026-09-13T17:01:00.000Z',
          },
        },
      },
    }])).toBeNull();
  });

  it('rejects cross-league, cross-period, and inconsistent-provider matchup references at both boundaries', () => {
    const input = snapshotInput();
    for (const matchupRef of [
      externalMatchupRef(externalLeagueRef(official, 'other-league'), period, '4'),
      externalMatchupRef(leagueRef, { ...period, week: 2 }, '4'),
      { ...externalMatchupRef(leagueRef, period, '4'), provider: gameProvider },
    ]) {
      const changed = { ...input.source, matchups: input.source.matchups.map((matchup) => ({ ...matchup, matchupRef })) };
      expect(() => buildSnapshot({ ...input, source: changed })).toThrow('matchup identity');
      const canonical = buildProjectedMatchupSnapshot(input);
      expect(() => toMatchupsData({ ...canonical,
        matchups: canonical.matchups.map((matchup) => ({ ...matchup, matchupRef })) }, input.source.schedule)).toThrow('matchup identity');
    }
  });

  it('builds canonical projections and converts once to the existing complete public payload', () => {
    const input = snapshotInput();
    const canonical = buildProjectedMatchupSnapshot(input);
    expect(canonical.matchups[0].matchupRef).toEqual(externalMatchupRef(leagueRef, period, '4'));
    const firstSide = canonical.matchups[0].sides[0];
    expect(canonical.matchups[0].status).toBe('live');
    expect(firstSide.projectedPoints).toBe(64);
    expect(firstSide.starters.map((slot) => slot.kind === 'occupied'
      ? [
          slot.entity.externalRef.externalId,
          slot.projectedPoints,
          slot.presentationProjectedPoints,
          slot.projectionQuality,
        ]
      : ['empty', null, null, null])).toEqual([
      ['live', 20, 20, 'estimated'],
      ['pregame', 12, 12, 'pregame-baseline'],
      ['bye', 5, 5, 'pregame-baseline'],
      ['final', 18, 15, 'official-final'],
      ['JAX', 7, 7, 'defense-baseline-held'],
      ['missing-frozen', 2, 2, 'missing-baseline'],
      ['empty', null, null, null],
    ]);
    expect(canonical.matchups[0].sides[1].projectedPoints).toBeNull();

    const payload = toMatchupsData(canonical, input.source.schedule);
    expect(payload.matchups[0].id).toBe('4');
    expect(buildSnapshot(input)).toEqual(payload);
    expect(payload).toEqual({
      league: {
        season: '2026',
        rosterPositions: ['RB', 'RB', 'FLEX', 'FLEX', 'DEF', 'FLEX', 'FLEX'],
        week: 1,
        maxWeek: 18,
      },
      teams: [
        {
          id: 1,
          managerName: 'Manager One',
          name: 'One Team',
          avatar: 'https://example.com/one.png',
          wins: 1,
          losses: 0,
          ties: 0,
          pointsFor: 100.5,
          pointsAgainst: 80.25,
        },
        {
          id: 2,
          managerName: 'Manager Two',
          name: 'Two Team',
          avatar: null,
          wins: 0,
          losses: 1,
          ties: 0,
          pointsFor: 80.25,
          pointsAgainst: 100.5,
        },
      ],
      updatedAt: calculatedAt,
      warning: undefined,
      week: 1,
      matchups: [{
        id: '4',
        status: 'live',
        winProbability: { modelVersion: 'normal-v3', status: 'unavailable', reason: 'missing-projection' },
        sides: [
          {
            team: expect.objectContaining({ id: 1, name: 'One Team' }),
            points: 43,
            projectedPoints: 64,
            starters: [
              expect.objectContaining({
                id: 'live', points: 10, projectedPoints: 20, injuryStatus: 'Q',
                game: expect.objectContaining({ kind: 'scheduled', opponent: 'LAC' }),
              }),
              expect.objectContaining({ id: 'pregame', projectedPoints: 12 }),
              expect.objectContaining({ id: 'bye', projectedPoints: 5, game: { kind: 'bye' } }),
              expect.objectContaining({ id: 'final', points: 18, projectedPoints: 15 }),
              expect.objectContaining({ id: 'JAX', projectedPoints: 7, position: 'DEF' }),
              expect.objectContaining({ id: 'missing-frozen', projectedPoints: 2 }),
              {
                id: 'empty-FLEX-6',
                name: 'Empty slot',
                position: '—',
                nflTeam: null,
                injuryStatus: null,
                game: null,
                slot: 'FLEX',
                points: null,
                projectedPoints: null,
              },
            ],
          },
          {
            team: expect.objectContaining({ id: 2, name: 'Two Team' }),
            points: 0,
            projectedPoints: null,
            starters: [expect.objectContaining({ id: 'empty-RB-0' })],
          },
        ],
      }],
    });
    expect(Object.prototype.hasOwnProperty.call(payload, 'warning')).toBe(true);
  });

  it('keeps a final player frozen projection visible while using the official score in the team total', () => {
    const input = snapshotInput();
    const sourceWithFinalScore: LeagueWeekState = {
      ...input.source,
      matchups: input.source.matchups.map((matchup) => ({
        ...matchup,
        sides: matchup.sides.map((side) => ({
          ...side,
          starters: side.starters.map((slot) => slot.kind === 'occupied'
            && slot.entity.externalRef.externalId === final.externalRef.externalId
            ? { ...slot, officialPoints: 23.2 }
            : slot),
        })),
      })),
    };
    const payload = buildSnapshot({
      ...input,
      source: sourceWithFinalScore,
      frozen: input.frozen.map((record) => record.officialEntityRef.externalId === final.externalRef.externalId
        ? { ...record, projectionPoints: 16.22 }
        : record),
    });
    const finalPlayer = payload.matchups[0].sides[0].starters
      .find((starter) => starter.id === final.externalRef.externalId);

    expect(finalPlayer).toMatchObject({ points: 23.2, projectedPoints: 16.22 });
    expect(payload.matchups[0].sides[0].projectedPoints).toBeCloseTo(69.2, 12);
  });

  it('carries final NFL scores from each player or defense perspective without changing fantasy calculations', () => {
    const input = snapshotInput();
    const finalGames = games({
      games: input.games.games.map((state) => state.homeTeam === 'DAL'
        ? { ...state, homeScore: 24, awayScore: 10 }
        : state.homeTeam === 'JAX'
          ? { ...state, statusCode: 2 as const, phase: 'final' as const, remainingFraction: 0,
              homeScore: 23, awayScore: 10 }
          : state),
    });
    const payload = buildSnapshot({ ...input, games: finalGames });
    const prior = buildSnapshot({ ...input, games: {
      ...finalGames,
      games: finalGames.games.map((state) => ({ ...state, homeScore: null, awayScore: null })),
    } });
    const starters = payload.matchups[0].sides[0].starters;
    expect(starters.find((starter) => starter.id === 'final')?.game).toEqual({
      ...input.source.schedule.PHI,
      finalScore: { teamScore: 10, opponentScore: 24 },
    });
    expect(starters.find((starter) => starter.id === 'JAX')?.game).toEqual({
      ...input.source.schedule.JAX,
      finalScore: { teamScore: 23, opponentScore: 10 },
    });
    expect(payload.matchups.map((matchup) => matchup.sides.map((side) => ({
      points: side.points,
      projectedPoints: side.projectedPoints,
      players: side.starters.map(({ points, projectedPoints }) => ({ points, projectedPoints })),
    })))).toEqual(prior.matchups.map((matchup) => matchup.sides.map((side) => ({
      points: side.points,
      projectedPoints: side.projectedPoints,
      players: side.starters.map(({ points, projectedPoints }) => ({ points, projectedPoints })),
    }))));
    expect(starters.find((starter) => starter.id === 'live')?.game).toEqual(input.source.schedule.KC);
    expect(starters.find((starter) => starter.id === 'bye')?.game).toEqual({ kind: 'bye' });
  });

  it('preserves shutout and tied final scores', () => {
    const input = snapshotInput();
    for (const [homeScore, awayScore] of [[0, 23], [17, 17], [0, 0]]) {
      const payload = buildSnapshot({ ...input, games: {
        ...input.games,
        games: input.games.games.map((state) => state.homeTeam === 'DAL'
          ? { ...state, homeScore, awayScore } : state),
      } });
      expect(payload.matchups[0].sides[0].starters.find((starter) => starter.id === 'final')?.game)
        .toMatchObject({ finalScore: { teamScore: awayScore, opponentScore: homeScore } });
    }
  });

  it('carries live clocks and halftime scores for home players, away players, and defenses without altering fantasy calculations', () => {
    const input = snapshotInput();
    const liveGames = {
      ...input.games,
      games: input.games.games.map((state) => state.homeTeam === 'KC'
        ? { ...state, phase: 'q3' as const, gameClock: '2:45', clockSeconds: 165,
            remainingFraction: 1065 / 3600, homeScore: 23, awayScore: 10 }
        : state.homeTeam === 'DAL'
          ? { ...state, statusCode: 1 as const, phase: 'q3' as const, gameClock: '2:45', clockSeconds: 165,
              remainingFraction: 1065 / 3600, homeScore: 10, awayScore: 23 }
          : state.homeTeam === 'JAX'
            ? { ...state, phase: 'halftime' as const, gameClock: null, clockSeconds: null,
                remainingFraction: 0.5, homeScore: 10, awayScore: 24 }
            : state),
    };
    const payload = buildSnapshot({ ...input, games: liveGames });
    const scoreless = buildSnapshot({ ...input, games: {
      ...liveGames,
      games: liveGames.games.map((state) => ({ ...state, homeScore: null, awayScore: null })),
    } });
    const starters = payload.matchups[0].sides[0].starters;
    expect(starters.find((starter) => starter.id === 'live')?.game).toEqual({
      ...input.source.schedule.KC,
      liveScore: { teamScore: 23, opponentScore: 10, phase: 'q3', clockSeconds: 165 },
    });
    expect(starters.find((starter) => starter.id === 'final')?.game).toEqual({
      ...input.source.schedule.PHI,
      liveScore: { teamScore: 23, opponentScore: 10, phase: 'q3', clockSeconds: 165 },
    });
    expect(starters.find((starter) => starter.id === 'JAX')?.game).toEqual({
      ...input.source.schedule.JAX,
      liveScore: { teamScore: 10, opponentScore: 24, phase: 'halftime', clockSeconds: null },
    });
    const fantasyValues = (value: typeof payload) => value.matchups.map((matchup) => matchup.sides.map((side) => ({
      points: side.points, projectedPoints: side.projectedPoints,
      players: side.starters.map(({ points, projectedPoints }) => ({ points, projectedPoints })),
    })));
    expect(fantasyValues(payload)).toEqual(fantasyValues(scoreless));
    expect(starters.find((starter) => starter.id === 'pregame')?.game).toEqual(input.source.schedule.BUF);
    expect(starters.find((starter) => starter.id === 'bye')?.game).toEqual({ kind: 'bye' });
    expect(starters.find((starter) => starter.id.startsWith('empty-'))?.game).toBeNull();
  });

  it.each([
    ['q1', 900], ['q2', 0], ['q3', 165], ['q4', 1],
    ['halftime', null], ['overtime', 900], ['overtime', 165], ['overtime', 0], ['overtime', null],
  ] as const)('preserves observed %s state with clock %s, zero scores, and ties', (phase, clockSeconds) => {
    const input = snapshotInput();
    const canonical = buildProjectedMatchupSnapshot(input);
    const state = input.games.games.find((candidate) => candidate.homeTeam === 'DAL')!;
    const payload = toMatchupsData(canonical, input.source.schedule, {
      ...input.games,
      games: [{ ...state, statusCode: 1, phase, clockSeconds, homeScore: 0, awayScore: 0 }],
    });
    expect(payload.matchups[0].sides[0].starters.find((starter) => starter.id === 'final')?.game)
      .toEqual({ ...input.source.schedule.PHI,
        liveScore: { teamScore: 0, opponentScore: 0, phase, clockSeconds } });
  });

  it('uses no live score for missing, malformed, non-live, or mismatched state evidence', () => {
    const input = snapshotInput();
    const canonical = buildProjectedMatchupSnapshot(input);
    const original = input.games.games.find((state) => state.homeTeam === 'DAL')!;
    const liveState: GameStateObservation = { ...original, statusCode: 1, phase: 'q3',
      gameClock: '2:45', clockSeconds: 165, remainingFraction: 1065 / 3600, homeScore: 10, awayScore: 23 };
    const unchanged = toMatchupsData(canonical, input.source.schedule);
    const invalidStates: GameStateObservation[] = [
      ...[null, -1, 901, 1.5, Number.NaN, Number.POSITIVE_INFINITY].map((clockSeconds) => ({ ...liveState, clockSeconds })),
      { ...liveState, phase: 'overtime', clockSeconds: 901 },
      { ...liveState, statusCode: 0, phase: 'pregame' },
      { ...liveState, statusCode: 3, phase: 'postponed' },
      { ...liveState, statusCode: 4, phase: 'suspended' },
      { ...liveState, statusCode: 2 },
      { ...liveState, phase: 'unknown' },
      { ...liveState, homeScore: null },
      { ...liveState, awayScore: null },
      { ...liveState, homeScore: -1 },
      { ...liveState, awayScore: 2.5 },
      { ...liveState, homeScore: Number.NaN },
      { ...liveState, awayScore: Number.POSITIVE_INFINITY },
      { ...liveState, period: { ...period, season: 2025 } },
      { ...liveState, period: { ...period, week: 2 } },
      { ...liveState, period: { ...period, seasonType: 'postseason' } },
      { ...liveState, homeTeam: 'NYG' },
      { ...liveState, homeTeam: 'PHI', awayTeam: 'DAL' },
    ];
    for (const state of invalidStates) {
      expect(toMatchupsData(canonical, input.source.schedule, { ...input.games, games: [state] }))
        .toEqual(unchanged);
    }
    for (const slate of [
      { ...input.games, period: { ...period, week: 2 }, games: [liveState] },
      { ...input.games, games: [liveState, liveState] },
    ]) expect(toMatchupsData(canonical, input.source.schedule, slate)).toEqual(unchanged);
  });

  it('replaces live state with an exclusive final score while preserving the earlier snapshot', () => {
    const input = snapshotInput();
    const original = input.games.games.find((state) => state.homeTeam === 'DAL')!;
    const liveGames = { ...input.games, games: input.games.games.map((state) => state === original
      ? { ...state, statusCode: 1 as const, phase: 'q4' as const, gameClock: '0:00', clockSeconds: 0,
          remainingFraction: 0, homeScore: 10, awayScore: 23 } : state) };
    const before = buildSnapshot({ ...input, games: liveGames });
    const beforeJson = JSON.stringify(before);
    const after = buildSnapshot({ ...input, prior: before, games: {
      ...input.games,
      games: input.games.games.map((state) => state === original ? { ...state, homeScore: 10, awayScore: 23 } : state),
    } });
    expect(before.matchups[0].sides[0].starters.find((starter) => starter.id === 'final')?.game)
      .toEqual({ ...input.source.schedule.PHI,
        liveScore: { teamScore: 23, opponentScore: 10, phase: 'q4', clockSeconds: 0 } });
    expect(after.matchups[0].sides[0].starters.find((starter) => starter.id === 'final')?.game)
      .toEqual({ ...input.source.schedule.PHI, finalScore: { teamScore: 23, opponentScore: 10 } });
    expect(JSON.stringify(before)).toBe(beforeJson);
  });

  it('omits optional NFL final scores unless finality, both scores, period, and schedule identity all agree', () => {
    const input = snapshotInput();
    const canonical = buildProjectedMatchupSnapshot(input);
    const original = input.games.games.find((state) => state.homeTeam === 'DAL')!;
    const completed = { ...original, homeScore: 24, awayScore: 10 };
    const unchanged = toMatchupsData(canonical, input.source.schedule);
    const alteredStates: GameStateObservation[] = [
      { ...completed, statusCode: 1, phase: 'q4' },
      { ...completed, statusCode: 2, phase: 'unknown' },
      { ...completed, statusCode: 4, phase: 'suspended' },
      { ...completed, homeScore: null },
      { ...completed, awayScore: null },
      { ...completed, homeScore: -1 },
      { ...completed, awayScore: 10.5 },
      { ...completed, homeScore: Number.NaN },
      { ...completed, awayScore: Number.POSITIVE_INFINITY },
      { ...completed, homeScore: Number.MAX_SAFE_INTEGER + 1 },
      { ...completed, period: { ...period, week: 2 } },
      { ...completed, period: { ...period, season: 2025 } },
      { ...completed, period: { ...period, seasonType: 'postseason' } },
      { ...completed, homeTeam: 'NYG' },
      { ...completed, homeTeam: 'PHI', awayTeam: 'DAL' },
    ];
    for (const altered of alteredStates) {
      expect(toMatchupsData(canonical, input.source.schedule, {
        ...input.games,
        games: input.games.games.map((state) => state === original ? altered : state),
      })).toEqual(unchanged);
    }
    for (const slate of [
      { ...input.games, period: { ...period, week: 2 }, games: [completed] },
      { ...input.games, games: [completed, completed] },
    ]) {
      expect(toMatchupsData(canonical, input.source.schedule, slate)).toEqual(unchanged);
    }
  });

  it('shows no final player projection when frozen evidence is absent or invalid and never retains the last live value', () => {
    const input = snapshotInput();
    const priorGames = games({
      games: games().games.map((value) => value.homeTeam === 'DAL'
        ? {
            ...value,
            statusCode: 1 as const,
            phase: 'q4' as const,
            remainingFraction: 0.1,
          }
        : value),
    });
    const prior = buildSnapshot({ ...input, games: priorGames });
    expect(prior.matchups[0].sides[0].starters.find((starter) => starter.id === 'final'))
      .toMatchObject({ projectedPoints: 19.5 });

    const finalRecord = input.frozen.find((record) => record.officialEntityRef.externalId === 'final')!;
    for (const frozen of [
      input.frozen.filter((record) => record !== finalRecord),
      input.frozen.map((record) => record === finalRecord ? { ...record, quality: 'missing' as const } : record),
      input.frozen.map((record) => record === finalRecord ? { ...record, quality: 'invalid' as const } : record),
    ]) {
      const payload = buildSnapshot({ ...input, frozen, prior });
      const finalPlayer = payload.matchups[0].sides[0].starters
        .find((starter) => starter.id === 'final');

      expect(finalPlayer).toMatchObject({ points: 18, projectedPoints: null });
      expect(payload.matchups[0].sides[0].projectedPoints).toBe(64);
    }
  });

  it('preserves a valid frozen zero for final player presentation', () => {
    const input = snapshotInput();
    const payload = buildSnapshot({
      ...input,
      frozen: input.frozen.map((record) => record.officialEntityRef.externalId === 'final'
        ? { ...record, projectionPoints: 0 }
        : record),
    });

    expect(payload.matchups[0].sides[0].starters.find((starter) => starter.id === 'final'))
      .toMatchObject({ points: 18, projectedPoints: 0 });
    expect(payload.matchups[0].sides[0].projectedPoints).toBe(64);
  });

  it('applies the final display rule to a frozen defensive-team baseline', () => {
    const input = snapshotInput();
    const finalGames = games({
      games: games().games.map((value) => value.homeTeam === 'JAX'
        ? { ...value, statusCode: 2 as const, phase: 'final' as const, remainingFraction: 0 }
        : value),
    });
    const payload = buildSnapshot({ ...input, games: finalGames });

    expect(payload.matchups[0].sides[0].starters.find((starter) => starter.id === 'JAX'))
      .toMatchObject({ position: 'DEF', points: 3, projectedPoints: 7 });
    expect(payload.matchups[0].sides[0].projectedPoints).toBe(60);
  });

  it('keeps distinct frozen baselines for multiple players in the same completed NFL game', () => {
    const input = snapshotInput();
    const finalTeammate = player('final-teammate', 'PHI', 'WR');
    const firstMatchup = input.source.matchups[0];
    const firstSide = firstMatchup.sides[0];
    const sourceWithTeammate: LeagueWeekState = {
      ...input.source,
      matchups: [{
        ...firstMatchup,
        sides: [{
          ...firstSide,
          starters: firstSide.starters.map((slot) => slot.kind === 'occupied'
            && slot.entity.externalRef.externalId === 'missing-frozen'
            ? { kind: 'occupied' as const, slot: slot.slot, entity: finalTeammate, officialPoints: 4 }
            : slot),
        }, firstMatchup.sides[1]],
      }],
      rosteredEntities: input.source.rosteredEntities
        .map((entity) => entity.externalRef.externalId === 'missing-frozen' ? finalTeammate : entity),
    };
    const payload = buildSnapshot({
      ...input,
      source: sourceWithTeammate,
      frozen: [...input.frozen, baseline(finalTeammate, 8.05, 'final-teammate')],
    });
    const starters = payload.matchups[0].sides[0].starters;

    expect(starters.find((starter) => starter.id === 'final'))
      .toMatchObject({ points: 18, projectedPoints: 15 });
    expect(starters.find((starter) => starter.id === 'final-teammate'))
      .toMatchObject({ points: 4, projectedPoints: 8.05 });
    expect(payload.matchups[0].sides[0].projectedPoints).toBe(66);
  });

  it('keeps the immutable frozen final display across later projection changes and repeated snapshots', () => {
    const input = snapshotInput();
    const frozen = input.frozen.map((record) => record.officialEntityRef.externalId === 'final'
      ? { ...record, projectionPoints: 16.22 }
      : record);
    const first = buildSnapshot({ ...input, frozen });
    const later = buildSnapshot({
      ...input,
      frozen,
      latest: [...input.latest, baseline(final, 99, 'later-final')],
      scored: {
        status: 'available',
        projections: [{ entityRef: final.externalRef, points: 99, quality: 'complete' }],
      },
      prior: first,
    });

    expect(first.matchups[0].sides[0].starters.find((starter) => starter.id === 'final')?.projectedPoints)
      .toBe(16.22);
    expect(later.matchups[0].sides[0].starters.find((starter) => starter.id === 'final')?.projectedPoints)
      .toBe(16.22);
    expect(later.matchups[0].sides[0].projectedPoints).toBe(64);
  });

  it('sums full-precision starter values, preserves zero, and excludes empty slots', () => {
    const base = snapshotInput();
    const firstMatchup = base.source.matchups[0];
    const firstSide = firstMatchup.sides[0];
    const secondSide = firstMatchup.sides[1];
    const [liveSlot, pregameSlot, byeSlot, , , , emptySlot] = firstSide.starters;
    void liveSlot;
    const sourceWith = (starters: typeof firstSide.starters): LeagueWeekState => ({
      ...base.source,
      matchups: [{
        ...firstMatchup,
        sides: [{ ...firstSide, starters }, secondSide],
      }],
    });

    const precise = buildProjectedMatchupSnapshot({
      ...base,
      source: sourceWith([pregameSlot, byeSlot, emptySlot]),
      latest: [
        baseline(pregame, 10.125, 'pregame-precise'),
        baseline(bye, -0.025, 'bye-precise'),
      ],
      frozen: [],
    });
    expect(precise.matchups[0].sides[0].starters.map((slot) => (
      slot.kind === 'occupied' ? slot.projectedPoints : null
    ))).toEqual([10.125, -0.025, null]);
    expect(precise.matchups[0].sides[0].projectedPoints).toBeCloseTo(10.1, 12);

    const zero = buildProjectedMatchupSnapshot({
      ...base,
      source: sourceWith([pregameSlot, emptySlot]),
      latest: [baseline(pregame, 0, 'pregame-zero')],
      frozen: [],
    });
    expect(zero.matchups[0].sides[0].starters[0]).toMatchObject({ projectedPoints: 0 });
    expect(zero.matchups[0].sides[0].projectedPoints).toBe(0);
  });

  it('ignores contradictory provider game data for a team Sleeper marks on bye', () => {
    const input = snapshotInput();
    const contradictoryByeGame = game('sf-sea', 'SF', 'SEA', {
      statusCode: 2,
      phase: 'final',
      remainingFraction: 0,
    });
    const canonical = buildProjectedMatchupSnapshot({
      ...input,
      games: { ...input.games, games: [...input.games.games, contradictoryByeGame] },
    });
    const byeSlot = canonical.matchups[0].sides[0].starters[2];

    expect(byeSlot).toMatchObject({
      kind: 'occupied',
      projectedPoints: 5,
      projectionQuality: 'pregame-baseline',
    });
  });

  it('rejects a final starter without an official score', () => {
    const input = snapshotInput();
    const changedSource: LeagueWeekState = {
      ...input.source,
      matchups: input.source.matchups.map((matchup) => ({
        ...matchup,
        sides: matchup.sides.map((side) => ({
          ...side,
          starters: side.starters.map((slot) => slot.kind === 'occupied'
            && slot.entity.externalRef.externalId === final.externalRef.externalId
            ? { ...slot, officialPoints: null }
            : slot),
        })),
      })),
    };
    expect(() => buildSnapshot({ ...input, source: changedSource }))
      .toThrow('final official score');
  });
});
