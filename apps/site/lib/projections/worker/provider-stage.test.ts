import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import type {
  GameStateSlate,
  LeaguePeriod,
  LeagueWeekState,
  NflWeekSchedule,
  ProjectionSlate,
  ScoringEntity,
} from '../domain/contracts';
import type { GameStateFeedPort } from '../ports/game-state-feed';
import type {
  NflGameId,
  ScoringEntityIdentityInput,
  ScoringEntityId,
} from '../ports/identity-crosswalk';
import type { ProjectionFeedPort } from '../ports/projection-feed';
import type {
  ObservationId,
  ProjectionSlateContentId,
  ProjectionSlateObservationId,
} from '../ports/projection-repository';
import {
  externalGameRef,
  externalLeagueRef,
  externalPlayerRef,
  externalReferenceKey,
  externalTeamDefenseRef,
  providerKey,
} from '../shared/provider-identity';
import type { LoadedLeague, ProviderGroup } from './contracts';
import {
  groupLeagues,
  loadProviderGroup,
  persistProviderGroup,
} from './provider-stage';

const officialProvider = providerKey('official-source');
const projectionProvider = providerKey('projection-source');
const gameProvider = providerKey('game-source');
const period = { season: 2026, seasonType: 'regular' as const, week: 1 };
const kickoffAt = '2026-09-13T20:25:00.000Z';
const schedule: NflWeekSchedule = {
  PHI: { kind: 'scheduled', opponent: 'DAL', location: 'home', date: '2026-09-13', kickoffAt },
  DAL: { kind: 'scheduled', opponent: 'PHI', location: 'away', date: '2026-09-13', kickoffAt },
};

const officialPlayer = externalPlayerRef(officialProvider, 'official-player');
const officialDefense = externalTeamDefenseRef(officialProvider, 'JAC');
const player: ScoringEntity = {
  kind: 'player',
  externalRef: officialPlayer,
  displayName: 'Example Player',
  nflTeam: 'PHI',
  position: 'WR',
  injuryStatus: null,
};
const defense: ScoringEntity = {
  kind: 'team-defense',
  externalRef: officialDefense,
  displayName: 'JAX Defense',
  nflTeam: 'JAX',
  position: 'DEF',
  injuryStatus: null,
};

function sourceFor(key: string, sourcePeriod: LeaguePeriod = period): LeagueWeekState {
  const leagueRef = externalLeagueRef(officialProvider, key);
  return {
    configuration: { key, displayName: key, leagueRef },
    leagueName: key,
    period: sourcePeriod,
    maxWeek: 18,
    rosterPositions: ['WR', 'DEF'],
    participants: [],
    matchups: [],
    rosteredEntities: [player, defense],
    schedule,
    scoringSettings: { provider: officialProvider, rawRules: {} },
    requestStartedAt: '2026-09-01T00:00:00.000Z',
    requestCompletedAt: '2026-09-01T00:00:01.000Z',
    observedAt: '2026-09-01T00:00:01.000Z',
    sourceRevision: `source-${key}`,
  };
}

function leagueFor(key: string, sourcePeriod: LeaguePeriod = period): LoadedLeague {
  const source = sourceFor(key, sourcePeriod);
  return { configuration: source.configuration, source, cadence: 'hourly' };
}

function projectionSlate(sourcePeriod: LeaguePeriod = period): ProjectionSlate {
  return {
    source: projectionProvider,
    period: sourcePeriod,
    quality: 'complete',
    requestStartedAt: '2026-09-01T00:00:00.000Z',
    requestCompletedAt: '2026-09-01T00:00:01.000Z',
    observedAt: '2026-09-01T00:00:01.000Z',
    sourceRevision: 'legacy-compatible-projection-revision',
    projections: [
      {
        identity: {
          primary: externalPlayerRef(projectionProvider, 'provider-player'),
          aliases: [officialPlayer],
        },
        nflTeam: 'PHI',
        position: 'WR',
        stats: { receiving: { recYds: '72.5' } },
        scoringStats: { kind: 'offense', receivingYards: 72.5 },
        missingFields: [],
      },
      {
        identity: {
          primary: externalTeamDefenseRef(projectionProvider, 'JAX'),
          aliases: [],
        },
        nflTeam: 'JAX',
        position: 'DEF',
        stats: { defense: { sacks: '2.1' } },
        scoringStats: { kind: 'defense', sacks: 2.1 },
        missingFields: [],
      },
    ],
    coverage: {
      crosswalkRows: 1,
      crosswalkEntries: 1,
      malformedCrosswalkRows: 0,
      ambiguousCrosswalkRows: 0,
      playerRows: 1,
      matchedPlayers: 1,
      unmatchedPlayers: 0,
      malformedPlayers: 0,
      incompletePlayers: 0,
      defenseRows: 1,
      usableDefenses: 1,
      malformedDefenses: 0,
      incompleteDefenses: 0,
    },
    warnings: [],
  };
}

function gameSlate(sourcePeriod: LeaguePeriod = period): GameStateSlate {
  return {
    source: gameProvider,
    period: sourcePeriod,
    requestStartedAt: '2026-09-01T00:00:00.000Z',
    requestCompletedAt: '2026-09-01T00:00:01.000Z',
    observedAt: '2026-09-01T00:00:01.000Z',
    games: [{
      gameRef: externalGameRef(gameProvider, 'provider-game'),
      period: sourcePeriod,
      homeTeam: 'PHI',
      awayTeam: 'DAL',
      statusCode: 0,
      statusText: 'Scheduled',
      sourcePeriod: null,
      gameClock: null,
      phase: 'pregame',
      clockSeconds: null,
      remainingFraction: 1,
      homeScore: null,
      awayScore: null,
      requestStartedAt: '2026-09-01T00:00:00.000Z',
      requestCompletedAt: '2026-09-01T00:00:01.000Z',
      observedAt: '2026-09-01T00:00:01.000Z',
      sourceRevision: 'legacy-compatible-game-revision',
    }],
  };
}

function providerGroup(leagues: readonly LoadedLeague[] = [leagueFor('league-one')]): ProviderGroup {
  return { period, leagues };
}

function projectionSlateStore() {
  return vi.fn(async (slate: ProjectionSlate) => ({
    kind: 'stored' as const,
    value: {
      observationId: 'projection-slate-observation' as ProjectionSlateObservationId,
      contentId: 'projection-slate-content' as ProjectionSlateContentId,
      semanticHash: 'semantic-hash',
      entriesStored: slate.projections.length,
      entryCount: slate.projections.length,
      pointerOutcome: 'advanced' as const,
    },
  }));
}

describe('canonical provider stage grouping and loading', () => {
  it('groups leagues by the complete period and preserves first-seen group order', () => {
    const otherPeriod = { ...period, seasonType: 'preseason' as const };
    const groups = groupLeagues([
      leagueFor('regular-one'),
      leagueFor('preseason', otherPeriod),
      leagueFor('regular-two'),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0]).toEqual({
      period,
      leagues: [expect.objectContaining({ configuration: expect.objectContaining({ key: 'regular-one' }) }),
        expect.objectContaining({ configuration: expect.objectContaining({ key: 'regular-two' }) })],
    });
    expect(groups[1]).toMatchObject({
      period: otherPeriod,
      leagues: [expect.objectContaining({ configuration: expect.objectContaining({ key: 'preseason' }) })],
    });
  });

  it.each([
    { ...period, season: 26 },
    { ...period, week: 0 },
    { ...period, week: 19 },
    { ...period, seasonType: 'invalid' as LeaguePeriod['seasonType'] },
  ])('rejects an invalid official period before provider loading', (invalidPeriod) => {
    expect(() => groupLeagues([leagueFor('invalid', invalidPeriod)]))
      .toThrow('invalid projection period');
  });

  it('starts both feeds together, loads each once per shared group, and delegates every schedule assessment', async () => {
    let releaseProjection!: (value: ReturnType<typeof projectionSlate>) => void;
    let releaseGames!: (value: ReturnType<typeof gameSlate>) => void;
    const projectionPending = new Promise<ProjectionSlate>((resolve) => { releaseProjection = resolve; });
    const gamesPending = new Promise<GameStateSlate>((resolve) => { releaseGames = resolve; });
    const getProjectionSlate = vi.fn(async () => ({
      status: 'available' as const,
      slate: await projectionPending,
    }));
    const getGameStateSlate = vi.fn(async () => ({
      status: 'available' as const,
      slate: await gamesPending,
    }));
    const assessProjectionSlate = vi.fn((
      slateInput: ProjectionSlate,
      scheduleInput: NflWeekSchedule,
    ) => {
      void slateInput;
      void scheduleInput;
      return { complete: true };
    });
    const dependencies = {
      projectionFeed: { getProjectionSlate, assessProjectionSlate } satisfies ProjectionFeedPort,
      gameStateFeed: { getGameStateSlate } satisfies GameStateFeedPort,
    };
    const group = providerGroup([leagueFor('league-one'), leagueFor('league-two')]);

    const pending = loadProviderGroup(dependencies, group);
    expect(getProjectionSlate).toHaveBeenCalledWith(period);
    expect(getGameStateSlate).toHaveBeenCalledWith(period);
    expect(assessProjectionSlate).not.toHaveBeenCalled();

    const projections = projectionSlate();
    const games = gameSlate();
    releaseProjection(projections);
    releaseGames(games);

    await expect(pending).resolves.toEqual({ projections, games });
    expect(getProjectionSlate).toHaveBeenCalledTimes(1);
    expect(getGameStateSlate).toHaveBeenCalledTimes(1);
    expect(assessProjectionSlate).toHaveBeenCalledTimes(2);
    expect(assessProjectionSlate.mock.calls.map((call) => call[1])).toEqual([schedule, schedule]);
  });

  it('rejects unavailable, period-mismatched, and schedule-incomplete provider results', async () => {
    const projections = projectionSlate();
    const games = gameSlate();
    const dependencies = (
      projectionResult: Awaited<ReturnType<ProjectionFeedPort['getProjectionSlate']>>,
      gameResult: Awaited<ReturnType<GameStateFeedPort['getGameStateSlate']>>,
      complete = true,
    ) => ({
      projectionFeed: {
        getProjectionSlate: vi.fn(async () => projectionResult),
        assessProjectionSlate: vi.fn(() => ({ complete })),
      } satisfies ProjectionFeedPort,
      gameStateFeed: {
        getGameStateSlate: vi.fn(async () => gameResult),
      } satisfies GameStateFeedPort,
    });

    await expect(loadProviderGroup(dependencies(
      { status: 'unavailable', period, reason: 'provider-error', message: 'failed' },
      { status: 'available', slate: games },
    ), providerGroup())).rejects.toThrow('source is unavailable');
    await expect(loadProviderGroup(dependencies(
      { status: 'available', slate: projectionSlate({ ...period, week: 2 }) },
      { status: 'available', slate: games },
    ), providerGroup())).rejects.toThrow('unexpected projection period');
    await expect(loadProviderGroup(dependencies(
      { status: 'available', slate: projections },
      { status: 'available', slate: games },
      false,
    ), providerGroup())).rejects.toThrow('incomplete weekly projection slate');
  });
});

describe('canonical provider persistence stage', () => {
  it('persists one shared group in exact order and retains supplied revisions and defense identity', async () => {
    const order: string[] = [];
    const games = gameSlate();
    const projections = projectionSlate();
    const gameKey = externalReferenceKey(games.games[0].gameRef);
    const gameId = 'canonical-game' as NflGameId;
    const observationId = 'game-observation' as ObservationId;
    const playerId = 'canonical-player' as ScoringEntityId;
    const defenseId = 'canonical-defense' as ScoringEntityId;
    const resolveNflGames = vi.fn(async () => {
      order.push('game-identity');
      return { kind: 'resolved' as const, value: [{ key: gameKey, status: 'known' as const, gameId }] };
    });
    const recordGameStates = vi.fn(async () => {
      order.push('game-state');
      return {
        kind: 'stored' as const,
        value: [{ gameRef: games.games[0].gameRef, sourceRevision: 'legacy-compatible-game-revision', observationId }],
      };
    });
    const recordProjectionSlate = projectionSlateStore();
    const resolveScoringEntities = vi.fn(async (inputs: readonly ScoringEntityIdentityInput[]) => {
      order.push('scoring-identity');
      return {
        kind: 'resolved' as const,
        value: inputs.map((input) => ({
          key: input.key,
          status: 'known' as const,
          entityId: input.entity.kind === 'team-defense' ? defenseId : playerId,
        })),
      };
    });

    const result = await persistProviderGroup({
      identityCrosswalk: { resolveNflGames, resolveScoringEntities },
      repository: { recordGameStates, recordProjectionSlate },
    }, providerGroup(), games, projections);

    expect(order).toEqual(['game-identity', 'game-state', 'scoring-identity']);
    expect(recordProjectionSlate).toHaveBeenCalledWith(projections);
    expect(resolveNflGames).toHaveBeenCalledWith([{
      key: gameKey,
      primaryRef: games.games[0].gameRef,
      aliasRefs: [],
      period,
      homeTeam: 'PHI',
      awayTeam: 'DAL',
      kickoffAt,
    }]);
    expect(recordGameStates).toHaveBeenCalledWith({ source: gameProvider, states: games.games });

    const entityInputs = resolveScoringEntities.mock.calls[0][0];
    expect(entityInputs).toHaveLength(2);
    expect(entityInputs.find((input) => input.entity.kind === 'player')?.providerRefs).toEqual([
      officialPlayer,
      projections.projections[0].identity.primary,
    ]);
    expect(entityInputs.find((input) => input.entity.kind === 'team-defense')?.providerRefs).toEqual([
      officialDefense,
      projections.projections[1].identity.primary,
    ]);
    expect(result).toEqual({
      games,
      projections,
      gameIdsByReferenceKey: new Map([[gameKey, gameId]]),
      gameObservationIdsByReferenceKey: new Map([[gameKey, observationId]]),
      entityIdsByReferenceKey: new Map([
        [externalReferenceKey(officialPlayer), playerId],
        [externalReferenceKey(officialDefense), defenseId],
      ]),
      identityConflictCount: 0,
      projectionSourceRevision: 'legacy-compatible-projection-revision',
      projectionSlateObservationId: 'projection-slate-observation',
      projectionSlateContentId: 'projection-slate-content',
    });
  });

  it('keeps unresolved scoring identities isolated for later per-league failure', async () => {
    const games = gameSlate();
    const gameKey = externalReferenceKey(games.games[0].gameRef);
    const observationId = 'game-observation' as ObservationId;
    const result = await persistProviderGroup({
      identityCrosswalk: {
        resolveNflGames: vi.fn(async () => ({
          kind: 'resolved' as const,
          value: [{ key: gameKey, status: 'known' as const, gameId: 'game' as NflGameId }],
        })),
        resolveScoringEntities: vi.fn(async (inputs: readonly ScoringEntityIdentityInput[]) => ({
          kind: 'resolved' as const,
          value: inputs.map((input) => ({ key: input.key, status: 'ambiguous' as const, entityId: null })),
        })),
      },
      repository: {
        recordProjectionSlate: projectionSlateStore(),
        recordGameStates: vi.fn(async () => ({
          kind: 'stored' as const,
          value: [{ gameRef: games.games[0].gameRef, sourceRevision: 'game-revision', observationId }],
        })),
      },
    }, providerGroup(), games, projectionSlate());

    expect(result.entityIdsByReferenceKey.size).toBe(0);
  });

  it('fails before later persistence stages when game identity or state persistence is incomplete', async () => {
    const games = gameSlate();
    const resolveScoringEntities = vi.fn();
    const recordGameStates = vi.fn();
    await expect(persistProviderGroup({
      identityCrosswalk: {
        resolveNflGames: vi.fn(async () => ({ kind: 'resolved' as const, value: [] })),
        resolveScoringEntities,
      },
      repository: { recordGameStates, recordProjectionSlate: projectionSlateStore() },
    }, providerGroup(), games, projectionSlate())).rejects.toThrow('NFL games could not be persisted completely');
    expect(recordGameStates).not.toHaveBeenCalled();
    expect(resolveScoringEntities).not.toHaveBeenCalled();

    await expect(persistProviderGroup({
      identityCrosswalk: {
        resolveNflGames: vi.fn(async () => ({
          kind: 'resolved' as const,
          value: [{
            key: externalReferenceKey(games.games[0].gameRef),
            status: 'known' as const,
            gameId: 'game' as NflGameId,
          }],
        })),
        resolveScoringEntities,
      },
      repository: {
        recordProjectionSlate: projectionSlateStore(),
        recordGameStates: vi.fn(async () => ({ kind: 'stored' as const, value: [] })),
      },
    }, providerGroup(), games, projectionSlate())).rejects.toThrow('game states could not be persisted completely');
    expect(resolveScoringEntities).not.toHaveBeenCalled();
  });
});
