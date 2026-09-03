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

describe('canonical worker game context and snapshot builder', () => {
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
      ? [slot.entity.externalRef.externalId, slot.projectedPoints, slot.projectionQuality]
      : ['empty', null, null])).toEqual([
      ['live', 20, 'estimated'],
      ['pregame', 12, 'pregame-baseline'],
      ['bye', 5, 'pregame-baseline'],
      ['final', 18, 'official-final'],
      ['JAX', 7, 'defense-baseline-held'],
      ['missing-frozen', 2, 'missing-baseline'],
      ['empty', null, null],
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
              expect.objectContaining({ id: 'final', projectedPoints: 18 }),
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
