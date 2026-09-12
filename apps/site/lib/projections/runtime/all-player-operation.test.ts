import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { NFL_TEAM_CODES, type LeagueWeekState, type ProjectionSlate } from '../domain/contracts';
import type { AllPlayerStatObservation } from '../domain/all-player-statistics';
import { createSleeperAllPlayerStatSource, type SleeperAllPlayerStatRequest, type SleeperAllPlayerStatResult } from '../adapters/sleeper/all-player-stats';
import { normalizeSleeperScoringProfile } from '../adapters/sleeper/scoring-profile';
import { deterministicUuid } from '../adapters/neon/database-values';
import type { AllPlayerBatchInput, AllPlayerIdentityLookup, AllPlayerJobFence } from '../adapters/neon/contracts';
import { externalPlayerRef } from '../shared/provider-identity';
import { PERIOD, PROJECTION_PROVIDER, OFFICIAL_PROVIDER, configuration, schedule, source } from '../../live-projection-worker.fixtures';
import { runAllPlayerIngestion, type AllPlayerIngestionDependencies } from './all-player-operation';

const PROFILE_ONE = '11111111-1111-4111-8111-111111111111';
const PROFILE_TWO = '22222222-2222-4222-8222-222222222222';
const OBS_ONE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OBS_TWO = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SEASON_ONE = deterministicUuid('season', 'one');
const SEASON_TWO = deterministicUuid('season', 'two');
const FENCE: AllPlayerJobFence = {
  jobKey: 'all-player-ingestion:sleeper', workerId: 'fixture-worker', generation: 1,
  leaseUntil: '2026-09-15T01:00:55.000Z', deadlineAt: '2026-09-15T01:00:50.000Z',
};

const catalog = {
  p1: { full_name: 'Quarter Back', position: 'QB', team: 'LAC', active: true },
  p2: { full_name: 'Running Back', position: 'RB', team: 'LAC', active: true },
  p3: { full_name: 'Other Quarterback', position: 'QB', team: 'KC', active: true },
  pzero: { full_name: 'Active Zero', position: 'RB', team: 'BUF', active: true },
  free: { full_name: 'Free Agent', position: 'WR', team: 'MIA', active: true },
} as const;

function gameContext() {
  const seen = new Set<string>();
  return Object.entries(schedule).flatMap(([team, game]) => {
    if (game?.kind !== 'scheduled') return [];
    const key = [team, game.opponent].sort().join(':');
    if (seen.has(key)) return [];
    seen.add(key);
    const homeTeam = game.location === 'home' ? team : game.opponent;
    const awayTeam = game.location === 'away' ? team : game.opponent;
    return [{
      nflGameId: deterministicUuid('test-game', key), homeTeam, awayTeam,
      kickoffAt: game.kickoffAt, phase: 'final' as const,
    }];
  });
}

function entry(
  providerExternalId: string,
  position: 'QB' | 'RB' | 'WR' | 'TE' | 'K' | 'DEF',
  nflTeam: string,
  stats: Readonly<Record<string, number>> = {},
) {
  const game = gameContext().find((value) => (
    value.homeTeam === nflTeam || value.awayTeam === nflTeam
  ));
  const activeZero = providerExternalId === 'pzero';
  return {
    entityKind: position === 'DEF' ? 'team_defense' as const : 'player' as const,
    providerExternalId, nflGameId: game?.nflGameId ?? null, nflTeam, position, stats,
    eligibilityEvidence: {
      kind: 'weekly-stat' as const, source: 'weekly-stat-provider' as const,
      gmsActive: 1 as const, appearances: activeZero ? 0 as const : 1 as const,
    },
    eligibleGameCount: 1 as const,
    appearanceGameCount: activeZero ? 0 as const : 1 as const,
    gamePhase: 'final' as const,
  };
}

function observation(sourceRevision = 'etag:"week-1"'): AllPlayerStatObservation {
  const playerEntries = Object.entries(catalog).map(([id, player]) => entry(
    id,
    player.position,
    player.team,
    id === 'p1' ? { gms_active: 1, gp: 1, pass_td: 1 }
      : id === 'pzero' ? { gms_active: 1, gp: 0 } : { gms_active: 1, gp: 1 },
  ));
  return {
    provider: 'sleeper', season: 2026, seasonType: 'reg', week: 1,
    normalizerVersion: 'sleeper-weekly-stats-v1', sourceRevision,
    requestStartedAt: '2026-09-15T00:00:00.000Z',
    requestCompletedAt: '2026-09-15T00:00:01.000Z',
    observedAt: '2026-09-15T00:00:01.000Z', quality: 'complete',
    coverage: { complete: true }, warnings: [],
    entries: [
      ...playerEntries,
      ...NFL_TEAM_CODES.map((team) => entry(team, 'DEF', team, { gms_active: 1, gp: 1 })),
    ],
  };
}

function projectionSlate(unresolved = false): ProjectionSlate {
  const projection = (id: string, position: 'QB' | 'RB' | 'WR') => ({
    identity: {
      primary: externalPlayerRef(PROJECTION_PROVIDER, `tank-${id}`),
      aliases: [externalPlayerRef(OFFICIAL_PROVIDER, id)],
    },
    nflTeam: catalog[id as keyof typeof catalog].team,
    position,
    stats: {},
    scoringStats: { kind: 'offense' as const },
    missingFields: [],
  });
  const projections = [projection('p1', 'QB'), projection('free', 'WR'), projection('pzero', 'RB')];
  if (unresolved) projections.push({
    ...projection('free', 'RB'),
    identity: { primary: externalPlayerRef(PROJECTION_PROVIDER, 'unresolved-free-agent'), aliases: [] },
  });
  return {
    source: PROJECTION_PROVIDER, period: PERIOD, quality: 'complete',
    requestStartedAt: '2026-09-14T00:00:00.000Z',
    requestCompletedAt: '2026-09-14T00:00:01.000Z', observedAt: '2026-09-14T00:00:01.000Z',
    sourceRevision: 'projection-revision', projections,
    coverage: {
      crosswalkRows: projections.length, crosswalkEntries: projections.length,
      malformedCrosswalkRows: 0, ambiguousCrosswalkRows: 0,
      playerRows: projections.length, matchedPlayers: projections.length,
      unmatchedPlayers: 0, malformedPlayers: 0, incompletePlayers: 0,
      defenseRows: 0, usableDefenses: 0, malformedDefenses: 0, incompleteDefenses: 0,
    },
    warnings: [],
  };
}

function leagueState(leagueId: 'l1' | 'l2', passTouchdown: number): LeagueWeekState {
  return {
    ...source(leagueId),
    scoringSettings: { provider: OFFICIAL_PROVIDER, rawRules: { pass_td: passTouchdown } },
  };
}

function harness(options: Readonly<{
  divergent?: boolean;
  unresolvedProjection?: boolean;
  observation?: AllPlayerStatObservation;
}> = {}) {
  let now = new Date('2026-09-15T01:00:00.000Z');
  const leaguePoints = options.divergent ? [4, 6] : [4, 4];
  const states = [leagueState('l1', leaguePoints[0]), leagueState('l2', leaguePoints[1])];
  const profiles = options.divergent ? [PROFILE_ONE, PROFILE_TWO] : [PROFILE_ONE, PROFILE_ONE];
  const batches: unknown[] = [];
  const pointers: string[] = [];
  const replay = createSleeperAllPlayerStatSource({
    now: () => now,
    fetch: async () => new Response(JSON.stringify(Object.fromEntries(
      (options.observation ?? observation()).entries
        .filter((entry) => entry.eligibilityEvidence.kind !== 'missing-provider-row')
        .map((entry) => [entry.providerExternalId, entry.stats]),
    )), { headers: { etag: '"week-1"' } }),
  });
  const allPlayerSource = { access: 'replay' as const,
    load: vi.fn(async (request: SleeperAllPlayerStatRequest): Promise<SleeperAllPlayerStatResult> => replay.load(request)),
  };
  const acquireJob = vi.fn<AllPlayerIngestionDependencies['store']['acquireAllPlayerJob']>(async () => ({
    kind: 'acquired' as const, fence: FENCE,
  }));
  const upsertScoringEntities = vi.fn(async (inputs: readonly Readonly<{
    key: string; kind: 'player' | 'team_defense';
  }>[]) => ({ kind: 'stored' as const, value: inputs.map((input) => ({
    key: input.key,
    entityId: deterministicUuid(`scoring-entity:${input.kind}`, input.key),
    conflict: false,
  })) }));
  const recordLeagueWeekObservation = vi.fn(async (input: Readonly<{
    leagueSeasonId: string; playerPoints: readonly unknown[]; rosterPoints: readonly unknown[];
  }>) => ({ kind: 'stored' as const, value: {
    observationId: input.leagueSeasonId === SEASON_ONE ? OBS_ONE : OBS_TWO,
    playerPointsStored: input.playerPoints.length, rosterPointsStored: input.rosterPoints.length,
    unmappedSleeperPlayerIds: [], expectedGamesStored: 0, unmappedTank01GameIds: [],
  } }));
  const recordAllPlayerBatch = vi.fn(async (input: AllPlayerBatchInput) => {
    batches.push(input);
    const scoreSets = input.scoreSets.map((scoreSet, index) => ({
      scoringProfileId: scoreSet.scoringProfileId,
      scoreSetId: deterministicUuid('score-set', `${input.observation.sourceRevision}:${index}`),
      pointerOutcome: 'advanced' as const,
    }));
    pointers.push(...scoreSets.map((value) => value.scoreSetId));
    return { kind: 'stored' as const, value: {
      statContentId: deterministicUuid('content', input.observation.sourceRevision),
      statObservationId: deterministicUuid('observation', input.observation.sourceRevision),
      semanticHash: 'a'.repeat(64), entriesStored: input.observation.entries.length,
      entryCount: input.observation.entries.length, scoreSets,
    } };
  });
  const dependencies = {
    store: {
      enabled: true,
      readAllPlayerLeagueProfiles: vi.fn(async (input: Readonly<{
        leagues: readonly Readonly<{ leagueKey: string; rulesHash: string }>[];
      }>) => input.leagues.map((league, index) => ({
        leagueKey: league.leagueKey,
        leagueSeasonId: index === 0 ? SEASON_ONE : SEASON_TWO,
        scoringProfileId: profiles[index], rulesHash: league.rulesHash,
        rules: { pass_td: leaguePoints[index] },
      }))),
      readAllPlayerIdentityMappings: vi.fn(async (inputs: readonly AllPlayerIdentityLookup[]) => inputs.map((input) => ({
        ...input,
        scoringEntityId: input.provider === 'tank01' && input.externalId.startsWith('tank-')
          ? deterministicUuid('scoring-entity:player', `player:${input.externalId.slice(5)}`) : null,
        mappedEntityKind: input.provider === 'tank01' && input.externalId.startsWith('tank-') ? 'player' : null,
        mappingStatus: input.provider === 'tank01' && input.externalId.startsWith('tank-') ? 'verified' : null,
        validFrom: null, validTo: null,
      }))),
      readAllPlayerGameContext: vi.fn(async () => gameContext()),
      upsertScoringEntities,
      recordLeagueWeekObservation,
      recordAllPlayerBatch,
      acquireAllPlayerJob: acquireJob,
      markAllPlayerRequest: vi.fn(async () => true),
      finishAllPlayerJob: vi.fn(async () => true),
      recordAllPlayerPreclaimOutcome: vi.fn<AllPlayerIngestionDependencies['store']['recordAllPlayerPreclaimOutcome']>(async () => 'recorded'),
      validateAllPlayerJobFence: vi.fn(async () => true),
      readAllPlayerJobState: vi.fn(async () => ({
        state: 'running', workerId: FENCE.workerId, generation: FENCE.generation,
        leaseUntil: FENCE.leaseUntil, nextRequestAt: null,
        payload: { mode: 'shadow', period: { ...PERIOD, seasonType: 'reg' }, requestGeneration: 1 },
      })),
    },
    projectionRepository: { readCurrentProjectionSlate: vi.fn(async () => ({
      observationId: 'projection-observation', contentId: 'projection-content',
      semanticHash: 'b'.repeat(64), slate: projectionSlate(options.unresolvedProjection),
      verifiedAt: now.toISOString(), materialChangedAt: now.toISOString(),
    })) },
    leagueRegistry: { listActiveLeagues: () => [configuration('l1'), configuration('l2')], getLeague: () => null },
    loadLeagueWeek: vi.fn(async (configurationValue) => {
      const index = configurationValue.key === 'league1' ? 0 : 1;
      return {
        state: states[index],
        rawMatchups: [{
          roster_id: 1, matchup_id: 1, players: ['p1'], starters: ['p1'],
          players_points: { p1: leaguePoints[index] }, points: leaguePoints[index],
        }],
        expectedRosterIds: [1], starterSlots: ['QB'],
      };
    }),
    loadCatalog: vi.fn(async () => ({ catalog, complete: true, sourceRevision: 'catalog-revision' })),
    loadReviewedPeriodEvidence: async () => ({ inventory: {
      source: 'manual-review', sourceRevision: 'synthetic-complete-inventory',
      observedAt: '2026-09-15T00:00:00.000Z', effectivePeriod: { season: 2026, seasonType: 'reg', week: 1 },
      excludedPlayerReasons: {}, teamsByPlayerId: Object.fromEntries(Object.entries(catalog).map(([id, player]) => [id, player.team])),
    } }),
    allPlayerSource,
    normalizeScoringProfile: normalizeSleeperScoringProfile,
    officialProvider: OFFICIAL_PROVIDER,
    projectionProvider: PROJECTION_PROVIDER,
    gameStateProvider: PROJECTION_PROVIDER,
    clock: { now: () => now, monotonicNow: () => now.getTime(), set: (value: Date) => { now = value; } },
    idGenerator: { generate: () => deterministicUuid('run', now.toISOString()) },
    logger: { write: vi.fn() },
  } as unknown as AllPlayerIngestionDependencies;
  return {
    dependencies, allPlayerSource, acquireJob, upsertScoringEntities,
    readAllPlayerIdentityMappings: dependencies.store.readAllPlayerIdentityMappings,
    recordLeagueWeekObservation, recordAllPlayerBatch, batches, pointers,
  };
}

describe('canonical all-player ingestion orchestration', () => {
  it.each(['catalog', 'schedule', 'manifest', 'participation'] as const)(
    'rejects substituted %s provenance with unchanged inventory and scores', async (variant) => {
      const test = harness();
      const load = test.allPlayerSource.load.getMockImplementation()!;
      test.allPlayerSource.load.mockImplementationOnce(async (request) => {
        const loaded = await load(request);
        if (loaded.status !== 'available') return loaded;
        const actual = loaded.observation;
        const manifest = actual.coverage.periodInventoryEvidence as Readonly<Record<string, unknown>>;
        return { ...loaded, observation: { ...actual,
          ...(variant === 'participation' ? { entries: actual.entries.map((entry) => (
            entry.providerExternalId !== 'p1' ? entry : { ...entry, eligibilityEvidence: {
              kind: 'period-participation' as const, decision: 'appearance' as const, source: 'manual-review' as const,
              sourceRevision: 'unloaded-review', observedAt: '2026-09-15T00:00:00.000Z',
              effectivePeriod: { season: 2026, seasonType: 'reg' as const, week: 1 },
              reason: 'Deliberately forged source claim for preflight regression',
            } }
          )) } : { coverage: { ...actual.coverage,
            ...(variant === 'catalog' ? { catalogRevision: 'different-catalog' }
              : variant === 'schedule' ? { scheduleRevision: 'different-schedule' }
                : { periodInventoryEvidence: { ...manifest, sourceRevision: 'different-manifest' } }),
          } }),
        } };
      });
      await expect(runAllPlayerIngestion(test.dependencies, { mode: 'backfill', period: PERIOD }))
        .resolves.toMatchObject({ status: 'unavailable', reason: 'observation-provenance-mismatch' });
      expect(test.upsertScoringEntities).not.toHaveBeenCalled();
      expect(test.recordLeagueWeekObservation).not.toHaveBeenCalled();
      expect(test.recordAllPlayerBatch).not.toHaveBeenCalled();
    },
  );

  it.each(['period', 'missing-defense', 'forged-coverage'] as const)(
    'rejects invalid loaded %s evidence before ancillary writes in shadow and backfill', async (variant) => {
      for (const mode of ['shadow', 'backfill'] as const) {
        const test = harness();
        const load = test.allPlayerSource.load.getMockImplementation()!;
        test.allPlayerSource.load.mockImplementationOnce(async (request) => {
          const loaded = await load(request);
          if (loaded.status !== 'available') return loaded;
          return { ...loaded, observation: {
            ...loaded.observation,
            ...(variant === 'period' ? { week: 2 } : variant === 'missing-defense' ? {
              entries: loaded.observation.entries.filter((entry) => entry.providerExternalId !== 'ARI'),
            } : { coverage: { ...loaded.observation.coverage, providerPresentEntityCount: 1 } }),
          } };
        });
        const result = await runAllPlayerIngestion(test.dependencies, { mode, period: PERIOD });
        expect(result).toMatchObject({ status: 'unavailable',
          reason: variant === 'period' ? 'observation-period-mismatch'
            : variant === 'missing-defense' ? 'observation-inventory-mismatch' : 'observation-coverage-invalid',
        });
        expect(test.upsertScoringEntities).not.toHaveBeenCalled();
        expect(test.recordLeagueWeekObservation).not.toHaveBeenCalled();
        expect(test.recordAllPlayerBatch).not.toHaveBeenCalled();
      }
    },
  );

  it.each(['all-superseded', 'mixed-group'] as const)(
    'records %s as a validation rejection rather than successful publication', async (variant) => {
      const test = harness({ divergent: true });
      vi.mocked(test.dependencies.store.recordAllPlayerBatch).mockImplementationOnce(async (input) => ({
        kind: 'stored', value: {
          statContentId: deterministicUuid('content', 'superseded'),
          statObservationId: deterministicUuid('observation', 'superseded'), semanticHash: 'a'.repeat(64),
          entriesStored: input.observation.entries.length, entryCount: input.observation.entries.length,
          scoreSets: input.scoreSets.map((set, index) => ({
            scoringProfileId: set.scoringProfileId, scoreSetId: deterministicUuid('set', String(index)),
            pointerOutcome: variant === 'mixed-group' && index === 1 ? 'advanced' : 'superseded',
          })),
        },
      }));
      const result = await runAllPlayerIngestion(test.dependencies, { mode: 'backfill', period: PERIOD });
      expect(result).toMatchObject({ status: 'unavailable', persistedObservation: true,
        reason: variant === 'all-superseded' ? 'old-observation-rejected' : 'profile-publication-inconsistent',
      });
      expect(test.dependencies.store.finishAllPlayerJob).toHaveBeenCalledWith(expect.objectContaining({
        outcome: 'validation-failed',
      }));
      if (variant === 'mixed-group') expect(result).toMatchObject({
        confirmedPublication: { pointerOutcomes: ['superseded', 'advanced'] },
      });
      else expect(result).not.toHaveProperty('confirmedPublication');
    },
  );

  it('runs shadow with one shared response and zero database writes', async () => {
    const test = harness();
    const result = await runAllPlayerIngestion(test.dependencies, { mode: 'shadow', period: PERIOD });
    expect(result).toMatchObject({ status: 'completed', persisted: false, scoringProfileCount: 1 });
    expect(test.allPlayerSource.load).toHaveBeenCalledOnce();
    expect(test.acquireJob).not.toHaveBeenCalled();
    expect(test.upsertScoringEntities).not.toHaveBeenCalled();
    expect(test.recordLeagueWeekObservation).not.toHaveBeenCalled();
    expect(test.recordAllPlayerBatch).not.toHaveBeenCalled();
  });

  it('backfills exactly one complete divergent cross-profile batch and preserves active zero', async () => {
    const test = harness({ divergent: true });
    const result = await runAllPlayerIngestion(test.dependencies, { mode: 'backfill', period: PERIOD });
    expect(result).toMatchObject({
      status: 'completed', persisted: true, scoringProfileCount: 2,
      parityComparisonCount: 2, activeZeroCount: 1,
    });
    expect(test.allPlayerSource.load).toHaveBeenCalledOnce();
    expect(test.recordAllPlayerBatch).toHaveBeenCalledOnce();
    const batch = test.recordAllPlayerBatch.mock.calls[0][0];
    expect(batch.scoreSets).toHaveLength(2);
    expect(batch.scoreSets.every((set) => set.coverage.complete === true)).toBe(true);
    expect(batch.scoreSets.flatMap((set) => set.scores).filter((score) => (
      score.providerExternalId === 'free'
    ))).toHaveLength(2);
    expect(batch.scoreSets.flatMap((set) => set.scores)
      .filter((score) => score.providerExternalId === 'pzero'))
      .toEqual([
        expect.objectContaining({ fantasyPoints: 0, eligibleGameCount: 1, appearanceGameCount: 0 }),
        expect.objectContaining({ fantasyPoints: 0, eligibleGameCount: 1, appearanceGameCount: 0 }),
      ]);
  });

  it('records unresolved free-agent projection coverage without inventing an identity', async () => {
    const test = harness({ unresolvedProjection: true });
    const result = await runAllPlayerIngestion(test.dependencies, { mode: 'shadow', period: PERIOD });
    expect(result).toMatchObject({
      status: 'completed',
      projectionCoverage: {
        identityComplete: false, skippedIdentityCount: 1, rankUnavailablePositions: ['RB'],
      },
      warnings: expect.arrayContaining(['all-player-position-ranking-unavailable:RB']),
    });
    const mappingInputs = test.readAllPlayerIdentityMappings;
    expect(mappingInputs).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ provider: 'tank01', externalId: 'unresolved-free-agent' }),
    ]));
  });

  it('uses the same operation for recurring mode and permits only one concurrent retrieval', async () => {
    const test = harness();
    test.acquireJob.mockResolvedValueOnce({
      kind: 'acquired', fence: FENCE,
    }).mockResolvedValueOnce({ kind: 'busy', nextRequestAt: null });
    const [first, second] = await Promise.all([
      runAllPlayerIngestion(test.dependencies, { mode: 'recurring', period: PERIOD }),
      runAllPlayerIngestion(test.dependencies, { mode: 'recurring', period: PERIOD }),
    ]);
    expect([first.status, second.status].sort()).toEqual(['completed', 'skipped']);
    expect(test.allPlayerSource.load).toHaveBeenCalledOnce();
    expect(test.recordAllPlayerBatch).toHaveBeenCalledOnce();
    expect(test.acquireJob.mock.calls[0][0]).toMatchObject({
      mode: 'recurring', period: { ...PERIOD, seasonType: 'reg' }, leaseSeconds: 55,
      deadlineAt: FENCE.deadlineAt,
    });
  });

  it('makes replays idempotent before provider retrieval', async () => {
    const test = harness();
    test.acquireJob.mockResolvedValueOnce({ kind: 'not-due', nextRequestAt: null });
    await expect(runAllPlayerIngestion(test.dependencies, { mode: 'backfill', period: PERIOD }))
      .resolves.toMatchObject({ status: 'skipped', reason: 'not-due' });
    expect(test.allPlayerSource.load).not.toHaveBeenCalled();
    expect(test.recordAllPlayerBatch).not.toHaveBeenCalled();
  });

  it('persists partial unknown-eligibility evidence without scoring or moving a pointer', async () => {
    const partial = {
      ...observation(),
      quality: 'partial' as const,
      coverage: { complete: false, unknownEligibilityCount: 1 },
      entries: observation().entries.map((value, index) => index === 0 ? {
        ...value,
        eligibleGameCount: null,
        appearanceGameCount: null,
        eligibilityEvidence: {
          kind: 'missing-provider-row' as const,
          inventoryFingerprint: `sha256:${'a'.repeat(64)}`,
        },
      } : value),
    };
    const test = harness({ observation: partial });
    await expect(runAllPlayerIngestion(test.dependencies, {
      mode: 'backfill', period: PERIOD,
    })).resolves.toMatchObject({
      status: 'unavailable',
      reason: 'provider-coverage-incomplete',
      persistedObservation: true,
    });
    expect(test.recordLeagueWeekObservation).not.toHaveBeenCalled();
    expect(test.recordAllPlayerBatch).toHaveBeenCalledOnce();
    expect(test.recordAllPlayerBatch.mock.calls[0][0]).toMatchObject({
      observation: { quality: 'partial', coverage: { complete: false } },
      scoreSets: [],
    });
    expect(test.pointers).toEqual([]);
  });

  it('does not write the same partial evidence in shadow mode', async () => {
    const partial = {
      ...observation(), quality: 'partial' as const,
      coverage: { complete: false, unknownEligibilityCount: 1 },
      entries: observation().entries.map((value, index) => index === 0 ? {
        ...value, stats: {}, eligibleGameCount: null, appearanceGameCount: null,
        eligibilityEvidence: { kind: 'missing-provider-row' as const, inventoryFingerprint: `sha256:${'a'.repeat(64)}` },
      } : value),
    };
    const test = harness({ observation: partial });
    await expect(runAllPlayerIngestion(test.dependencies, {
      mode: 'shadow', period: PERIOD,
    })).resolves.toMatchObject({
      status: 'unavailable', reason: 'provider-coverage-incomplete',
    });
    expect(test.recordAllPlayerBatch).not.toHaveBeenCalled();
  });

  it('reuses score content while retaining fresh parity observation lineage for unchanged stats', async () => {
    const test = harness();
    await expect(runAllPlayerIngestion(test.dependencies, {
      mode: 'backfill', period: PERIOD,
    })).resolves.toMatchObject({ status: 'completed' });
    test.recordLeagueWeekObservation
      .mockResolvedValueOnce({ kind: 'stored', value: {
        observationId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        playerPointsStored: 1, rosterPointsStored: 1,
        unmappedSleeperPlayerIds: [], expectedGamesStored: 0, unmappedTank01GameIds: [],
      } })
      .mockResolvedValueOnce({ kind: 'stored', value: {
        observationId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        playerPointsStored: 1, rosterPointsStored: 1,
        unmappedSleeperPlayerIds: [], expectedGamesStored: 0, unmappedTank01GameIds: [],
      } });
    await expect(runAllPlayerIngestion(test.dependencies, {
      mode: 'backfill', period: PERIOD,
    })).resolves.toMatchObject({ status: 'completed' });
    expect(test.batches).toHaveLength(2);
    const [first, second] = test.batches as AllPlayerBatchInput[];
    expect(first.observation.sourceRevision).toBe(second.observation.sourceRevision);
    expect(first.scoreSets[0].semanticHash).toBe(second.scoreSets[0].semanticHash);
    expect(first.scoreSets[0].coverage.parity_observation_ids)
      .not.toEqual(second.scoreSets[0].coverage.parity_observation_ids);
  });

  it.each([
    ['provider validation', () => ({ status: 'unavailable' as const, reason: 'malformed' as const })],
    ['inconsistent complete eligibility', () => ({ status: 'available' as const, observation: {
      ...observation(), entries: observation().entries.map((value, index) => index === 0 ? {
        ...value, eligibleGameCount: null, appearanceGameCount: null,
        eligibilityEvidence: { kind: 'missing-provider-row' as const, inventoryFingerprint: `sha256:${'a'.repeat(64)}` },
      } : value),
    } })],
    ['parity mismatch', () => ({ status: 'available' as const, observation: {
      ...observation(), entries: observation().entries.map((value) => value.providerExternalId === 'p1'
        ? { ...value, stats: { gms_active: 1, gp: 1, pass_td: 2 } } : value),
    } })],
    ['scoring failure', () => ({ status: 'available' as const, observation: {
      ...observation(), entries: observation().entries.map((value) => value.providerExternalId === 'pzero'
        ? { ...value, stats: { gms_active: 1, pass_td: 1 } } : value),
    } })],
  ] as const)('leaves pointers unchanged after %s failure', async (_name, loadResult) => {
    const test = harness();
    test.allPlayerSource.load.mockResolvedValueOnce(loadResult());
    await expect(runAllPlayerIngestion(test.dependencies, { mode: 'backfill', period: PERIOD }))
      .resolves.toMatchObject({ status: 'unavailable' });
    expect(test.recordAllPlayerBatch).not.toHaveBeenCalled();
    expect(test.pointers).toEqual([]);
    expect(test.upsertScoringEntities).not.toHaveBeenCalled();
    expect(test.recordLeagueWeekObservation).not.toHaveBeenCalled();
  });

  it('leaves pointers unchanged after identity or persistence failure', async () => {
    const identity = harness();
    vi.mocked(identity.dependencies.store.readAllPlayerIdentityMappings).mockImplementationOnce(
      async (inputs) => inputs.map((input) => ({
        ...input, scoringEntityId: null,
        mappedEntityKind: input.provider === 'sleeper' && input.externalId === 'p1'
          ? 'team_defense' : null,
        mappingStatus: null, validTo: null,
      })),
    );
    await expect(runAllPlayerIngestion(identity.dependencies, { mode: 'backfill', period: PERIOD }))
      .resolves.toMatchObject({ status: 'unavailable' });
    expect(identity.pointers).toEqual([]);

    const persistence = harness();
    persistence.recordAllPlayerBatch.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(runAllPlayerIngestion(persistence.dependencies, { mode: 'backfill', period: PERIOD }))
      .resolves.toMatchObject({ status: 'unavailable', reason: 'stage-failed', stage: 'publication' });
    expect(persistence.pointers).toEqual([]);
  });

  it.each(['shadow', 'backfill'] as const)(
    'fails %s consistently for an existing unverified official identity',
    async (mode) => {
      const test = harness();
      vi.mocked(test.dependencies.store.readAllPlayerIdentityMappings).mockImplementationOnce(
        async (inputs) => inputs.map((input) => input.provider === 'sleeper'
          && input.externalId === 'p1' ? {
            ...input,
            scoringEntityId: deterministicUuid('unverified', 'p1'),
            mappedEntityKind: 'player',
            mappingStatus: 'unverified',
            validTo: null,
          } : {
            ...input, scoringEntityId: null, mappedEntityKind: null,
            mappingStatus: null, validTo: null,
          }),
      );
      await expect(runAllPlayerIngestion(test.dependencies, {
        mode, period: PERIOD,
      })).resolves.toMatchObject({
        status: 'unavailable', reason: 'identity-mapping-unusable',
      });
      expect(test.allPlayerSource.load).not.toHaveBeenCalled();
      expect(test.upsertScoringEntities).not.toHaveBeenCalled();
      expect(test.recordAllPlayerBatch).not.toHaveBeenCalled();
    },
  );

  it('stores final corrections as new immutable batches and advances only guarded batch pointers', async () => {
    const test = harness();
    const first = await runAllPlayerIngestion(test.dependencies, { mode: 'backfill', period: PERIOD });
    test.acquireJob.mockResolvedValueOnce({
      kind: 'acquired', fence: { ...FENCE, generation: 2 },
    });
    const load = test.allPlayerSource.load.getMockImplementation()!;
    test.allPlayerSource.load.mockImplementationOnce(async (request) => {
      const loaded = await load(request);
      return loaded.status === 'available' ? { ...loaded, observation: { ...loaded.observation,
        sourceRevision: 'etag:"week-1-corrected"',
      } } : loaded;
    });
    const second = await runAllPlayerIngestion(test.dependencies, { mode: 'backfill', period: PERIOD });
    expect([first.status, second.status]).toEqual(['completed', 'completed']);
    expect(test.batches).toHaveLength(2);
    expect(test.batches.map((value) => (value as { observation: AllPlayerStatObservation }).observation.sourceRevision))
      .toEqual(['etag:"week-1"', 'etag:"week-1-corrected"']);
    expect(new Set(test.pointers).size).toBe(2);
  });

  it('rejects unsupported active rules before a weekly request or ancillary writes', async () => {
    const test = harness();
    const original = test.dependencies.loadLeagueWeek;
    test.dependencies = { ...test.dependencies, loadLeagueWeek: async (...args) => {
      const loaded = await original(...args);
      return { ...loaded, state: { ...loaded.state, scoringSettings: {
        ...loaded.state.scoringSettings, rawRules: { pass_td: 4, unreviewed_rule: 1 },
      } } };
    } };
    await expect(runAllPlayerIngestion(test.dependencies, { mode: 'backfill', period: PERIOD }))
      .resolves.toMatchObject({ status: 'unavailable', reason: 'unsupported-active-scoring-rule' });
    expect(test.allPlayerSource.load).not.toHaveBeenCalled();
    expect(test.upsertScoringEntities).not.toHaveBeenCalled();
    expect(test.dependencies.store.finishAllPlayerJob).toHaveBeenCalledWith(expect.objectContaining({
      outcome: 'validation-failed',
    }));
  });

  it.each(['shadow', 'backfill'] as const)('rejects duplicate canonical targets before any %s writes', async (mode) => {
    const test = harness();
    vi.mocked(test.dependencies.store.readAllPlayerIdentityMappings).mockImplementationOnce(async (inputs) => (
      inputs.map((value) => ({ ...value,
        scoringEntityId: value.provider === 'sleeper' && ['p1', 'p2'].includes(value.externalId)
          ? deterministicUuid('collision', 'two-official-players') : null,
        mappedEntityKind: value.provider === 'sleeper' && ['p1', 'p2'].includes(value.externalId) ? 'player' : null,
        mappingStatus: value.provider === 'sleeper' && ['p1', 'p2'].includes(value.externalId) ? 'verified' : null,
        validTo: null,
      }))
    ));
    await expect(runAllPlayerIngestion(test.dependencies, { mode, period: PERIOD }))
      .resolves.toMatchObject({ status: 'unavailable' });
    expect(test.upsertScoringEntities).not.toHaveBeenCalled();
    expect(test.recordLeagueWeekObservation).not.toHaveBeenCalled();
    expect(test.recordAllPlayerBatch).not.toHaveBeenCalled();
  });

  it('rejects lost ownership before ancillary writes', async () => {
    const test = harness();
    vi.mocked(test.dependencies.store.validateAllPlayerJobFence).mockResolvedValue(false);
    await expect(runAllPlayerIngestion(test.dependencies, { mode: 'backfill', period: PERIOD }))
      .resolves.toMatchObject({ status: 'unavailable', reason: 'lease-lost', stage: 'identity-persistence' });
    expect(test.upsertScoringEntities).not.toHaveBeenCalled();
    expect(test.recordLeagueWeekObservation).not.toHaveBeenCalled();
    expect(test.recordAllPlayerBatch).not.toHaveBeenCalled();
  });

  it('rejects an exhausted shared invocation deadline before claim or requests', async () => {
    const test = harness();
    await expect(runAllPlayerIngestion({ ...test.dependencies, deadlineAt: '2026-09-15T00:59:59Z' }, {
      mode: 'recurring', period: PERIOD,
    })).resolves.toMatchObject({ status: 'unavailable', reason: 'timeout', stage: 'job-claim' });
    expect(test.acquireJob).not.toHaveBeenCalled();
    expect(test.allPlayerSource.load).not.toHaveBeenCalled();
  });

  it.each(['missing', 'unverified', 'retired', 'expired', 'wrong-kind', 'conflicting'] as const)(
    'retains %s optional projection mapping diagnostics without vetoing official statistics', async (variant) => {
      const test = harness();
      const read = test.dependencies.store.readAllPlayerIdentityMappings;
      const rows = await read([
        { provider: 'tank01', entityKind: 'player', externalId: 'tank-p1' },
      ]);
      vi.mocked(read).mockImplementationOnce(async (inputs) => inputs.map((value) => {
        if (value.provider !== 'tank01' || value.externalId !== 'tank-p1') return {
          ...value, scoringEntityId: null, mappedEntityKind: null, mappingStatus: null, validTo: null,
        };
        return { ...rows[0], ...value,
          scoringEntityId: variant === 'missing' ? null : variant === 'conflicting'
            ? deterministicUuid('conflicting-optional', 'p1') : rows[0].scoringEntityId,
          mappedEntityKind: variant === 'missing' ? null : variant === 'wrong-kind' ? 'team_defense' : 'player',
          mappingStatus: variant === 'missing' ? null : variant === 'unverified' ? 'unverified'
            : variant === 'retired' ? 'retired' : 'verified',
          validTo: variant === 'expired' ? '2026-09-15T00:59:59Z' : null,
        };
      }));
      const result = await runAllPlayerIngestion(test.dependencies, { mode: 'backfill', period: PERIOD });
      expect(result).toMatchObject({ status: 'completed', projectionCoverage: { identityComplete: false } });
      expect(test.recordAllPlayerBatch).toHaveBeenCalledOnce();
      expect(test.upsertScoringEntities.mock.calls[0][0]).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ providerIds: expect.arrayContaining([expect.objectContaining({ provider: 'tank01' })]) }),
      ]));
    },
  );

  it('accepts a verified required mapping until its future expiry and rejects it at expiry', async () => {
    for (const validTo of ['2026-09-16T01:00:00Z', '2026-09-15T01:00:00Z']) {
      const test = harness();
      vi.mocked(test.dependencies.store.readAllPlayerIdentityMappings).mockImplementationOnce(async (inputs) => (
        inputs.map((value) => value.provider === 'sleeper' && value.externalId === 'p1' ? {
          ...value, scoringEntityId: deterministicUuid('scoring-entity:player', 'player:p1'),
          mappedEntityKind: 'player', mappingStatus: 'verified', validFrom: '2026-09-01T00:00:00Z', validTo,
        } : { ...value, scoringEntityId: null, mappedEntityKind: null, mappingStatus: null, validTo: null })
      ));
      const result = await runAllPlayerIngestion(test.dependencies, { mode: 'shadow', period: PERIOD });
      expect(result.status).toBe(validTo.startsWith('2026-09-16') ? 'completed' : 'unavailable');
      if (result.status === 'unavailable') {
        expect(result).toMatchObject({ reason: 'identity-mapping-unusable',
          diagnostics: expect.arrayContaining(['sleeper/p1:required-official:mapping-unusable']) });
        expect(test.allPlayerSource.load).not.toHaveBeenCalled();
      }
    }
  });

  it.each(['missing-catalog', 'expired-mapping'] as const)(
    'keeps official roster/starter identities required without weekly matchup player rows: %s', async (variant) => {
      const test = harness();
      if (variant === 'missing-catalog') {
        const { p2: _removed, ...incompleteCatalog } = catalog;
        void _removed;
        test.dependencies = { ...test.dependencies, loadCatalog: async () => ({
          catalog: incompleteCatalog, complete: true, sourceRevision: 'missing-required-player',
        }) };
      } else {
        vi.mocked(test.dependencies.store.readAllPlayerIdentityMappings).mockImplementationOnce(async (inputs) => (
          inputs.map((value) => value.provider === 'sleeper' && value.externalId === 'p2' ? {
            ...value, scoringEntityId: deterministicUuid('scoring-entity:player', 'player:p2'),
            mappedEntityKind: 'player', mappingStatus: 'verified', validTo: '2026-09-15T00:00:00Z',
          } : { ...value, scoringEntityId: null, mappedEntityKind: null, mappingStatus: null, validTo: null })
        ));
      }
      await expect(runAllPlayerIngestion(test.dependencies, { mode: 'backfill', period: PERIOD }))
        .resolves.toMatchObject({ status: 'unavailable', reason: variant === 'missing-catalog'
          ? 'inventory-identity' : 'identity-mapping-unusable' });
      expect(test.allPlayerSource.load).not.toHaveBeenCalled();
      expect(test.upsertScoringEntities).not.toHaveBeenCalled();
    },
  );

  it('refuses an unbudgeted live shadow before any source or ownership work', async () => {
    const test = harness();
    const result = await runAllPlayerIngestion({ ...test.dependencies,
      allPlayerSource: { ...test.allPlayerSource, access: 'live' },
    }, { mode: 'shadow', period: PERIOD });
    expect(result).toMatchObject({ status: 'unavailable', reason: 'shadow-source-policy-required' });
    expect(test.dependencies.loadCatalog).not.toHaveBeenCalled();
    expect(test.acquireJob).not.toHaveBeenCalled();
    expect(test.allPlayerSource.load).not.toHaveBeenCalled();
    expect(test.dependencies.store.markAllPlayerRequest).not.toHaveBeenCalled();
  });

  it.each(['bad-time', 'bad-lineup'] as const)('prepares official parent input before identities: %s', async (variant) => {
    const test = harness();
    const load = test.dependencies.loadLeagueWeek;
    test.dependencies = { ...test.dependencies, loadLeagueWeek: async (...args) => {
      const league = await load(...args);
      return { ...league, state: variant === 'bad-time' ? { ...league.state, observedAt: 'invalid' }
        : { ...league.state, lineup: { ...league.state.lineup, lineupRevision: 'invalid' } } } as typeof league;
    } };
    await expect(runAllPlayerIngestion(test.dependencies, { mode: 'backfill', period: PERIOD }))
      .resolves.toMatchObject({ status: 'unavailable' });
    expect(test.upsertScoringEntities).not.toHaveBeenCalled();
    expect(test.recordLeagueWeekObservation).not.toHaveBeenCalled();
    expect(test.recordAllPlayerBatch).not.toHaveBeenCalled();
  });

  it.each(['lost', 'failed'] as const)('preserves confirmed publication evidence when outcome recording is %s', async (variant) => {
    const test = harness();
    if (variant === 'lost') vi.mocked(test.dependencies.store.finishAllPlayerJob).mockResolvedValueOnce(false);
    else vi.mocked(test.dependencies.store.finishAllPlayerJob).mockRejectedValueOnce(new Error('database unavailable'));
    const result = await runAllPlayerIngestion(test.dependencies, { mode: 'backfill', period: PERIOD });
    expect(result).toMatchObject({ status: 'unavailable', stage: 'durable-outcome',
      confirmedPublication: { statObservationId: expect.any(String),
        pointerOutcomes: ['advanced'], entryCount: 37, scoringProfileCount: 1 } });
    expect(test.pointers).toHaveLength(1);
  });

  it.each(['backfill', 'recurring'] as const)('durably records no-fence claim races for %s', async (mode) => {
    for (const reason of ['busy', 'not-due'] as const) {
      const test = harness();
      test.acquireJob.mockResolvedValueOnce({ kind: reason, nextRequestAt: '2026-09-15T13:00:00Z' });
      await expect(runAllPlayerIngestion(test.dependencies, { mode, period: PERIOD }))
        .resolves.toEqual({ status: 'skipped', mode, period: PERIOD, reason });
      expect(test.dependencies.store.recordAllPlayerPreclaimOutcome).toHaveBeenCalledExactlyOnceWith({
        outcome: reason, stage: 'job-claim', reason, period: { ...PERIOD, seasonType: 'reg' },
        retryDisposition: 'after-cooldown', retryAt: '2026-09-15T13:00:00.000Z',
      });
      expect(test.dependencies.store.finishAllPlayerJob).not.toHaveBeenCalled();
      expect(test.allPlayerSource.load).not.toHaveBeenCalled();
      expect(test.dependencies.logger.write).toHaveBeenLastCalledWith('warn', expect.objectContaining({
        allPlayerReason: reason, allPlayerFailureStage: 'job-claim',
        allPlayerDiagnostics: ['preclaim-durability:recorded'],
      }));
    }
  });

  it('records sanitized claim failure through the reserved cleanup store', async () => {
    const test = harness();
    const record = vi.fn<AllPlayerIngestionDependencies['store']['recordAllPlayerPreclaimOutcome']>(async () => 'recorded');
    test.acquireJob.mockRejectedValueOnce(new Error('postgresql://credential.invalid/private'));
    const result = await runAllPlayerIngestion({ ...test.dependencies, cleanupStore: {
      finishAllPlayerJob: vi.fn(async () => true), recordAllPlayerPreclaimOutcome: record,
    } }, { mode: 'backfill', period: PERIOD });
    expect(result).toMatchObject({ status: 'unavailable', reason: 'stage-failed', stage: 'job-claim' });
    expect(record).toHaveBeenCalledExactlyOnceWith({
      outcome: 'validation-failed', stage: 'job-claim', reason: 'stage-failed',
      period: { ...PERIOD, seasonType: 'reg' }, retryDisposition: 'next-poll',
    });
    expect(test.dependencies.store.recordAllPlayerPreclaimOutcome).not.toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(test.dependencies.logger.write).mock.calls)).not.toContain('credential.invalid');
    expect(test.allPlayerSource.load).not.toHaveBeenCalled();
  });

  it.each(['unchanged', 'throttled', 'disabled'] as const)('reports preclaim diagnostic disposition %s without claiming a new write', async (disposition) => {
    const test = harness();
    test.acquireJob.mockResolvedValueOnce({ kind: 'busy', nextRequestAt: null });
    vi.mocked(test.dependencies.store.recordAllPlayerPreclaimOutcome).mockResolvedValueOnce(disposition);
    await expect(runAllPlayerIngestion(test.dependencies, { mode: 'recurring', period: PERIOD }))
      .resolves.toMatchObject({ status: 'skipped', reason: 'busy' });
    expect(test.dependencies.logger.write).toHaveBeenLastCalledWith('warn', expect.objectContaining({
      allPlayerDiagnostics: [`preclaim-durability:${disposition}`],
      allPlayerPersistedObservation: false, allPlayerConfirmedPublication: false,
    }));
  });

  it('preserves the original claim failure when diagnostic persistence fails', async () => {
    const test = harness();
    test.acquireJob.mockRejectedValueOnce(new Error('claim-unavailable'));
    vi.mocked(test.dependencies.store.recordAllPlayerPreclaimOutcome)
      .mockRejectedValueOnce(new Error('postgresql://credential.invalid/private'));
    await expect(runAllPlayerIngestion(test.dependencies, { mode: 'backfill', period: PERIOD }))
      .resolves.toMatchObject({ status: 'unavailable', reason: 'claim-unavailable', stage: 'job-claim' });
    expect(test.dependencies.logger.write).toHaveBeenLastCalledWith('warn', expect.objectContaining({
      allPlayerReason: 'claim-unavailable', allPlayerDiagnostics: ['preclaim-durability:persistence-failed'],
    }));
    expect(JSON.stringify(vi.mocked(test.dependencies.logger.write).mock.calls)).not.toContain('credential.invalid');
  });

  it('records a stalled claim timeout and prevents a late claim from starting ingestion', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-09-15T01:00:00.000Z'));
      const test = harness();
      let resolveClaim!: (value: Awaited<ReturnType<typeof test.acquireJob>>) => void;
      test.acquireJob.mockImplementationOnce(() => new Promise((resolve) => { resolveClaim = resolve; }));
      const pending = runAllPlayerIngestion({ ...test.dependencies,
        clock: { now: () => new Date(), monotonicNow: () => Date.now() },
      }, { mode: 'recurring', period: PERIOD });
      await vi.advanceTimersByTimeAsync(50_000);
      await expect(pending).resolves.toMatchObject({ status: 'unavailable', reason: 'timeout', stage: 'job-claim' });
      expect(test.dependencies.store.recordAllPlayerPreclaimOutcome).toHaveBeenCalledExactlyOnceWith({
        outcome: 'timeout', stage: 'job-claim', reason: 'timeout',
        period: { ...PERIOD, seasonType: 'reg' }, retryDisposition: 'next-poll',
      });
      resolveClaim({ kind: 'acquired', fence: FENCE });
      await vi.advanceTimersByTimeAsync(0);
      expect(test.dependencies.loadCatalog).not.toHaveBeenCalled();
      expect(test.allPlayerSource.load).not.toHaveBeenCalled();
      expect(test.dependencies.store.finishAllPlayerJob).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it('bounds no-fence diagnostic persistence without changing the skip result', async () => {
    vi.useFakeTimers();
    try {
      const test = harness();
      test.acquireJob.mockResolvedValueOnce({ kind: 'not-due', nextRequestAt: null });
      vi.mocked(test.dependencies.store.recordAllPlayerPreclaimOutcome).mockImplementationOnce(() => new Promise(() => {}));
      const pending = runAllPlayerIngestion(test.dependencies, { mode: 'recurring', period: PERIOD });
      await vi.advanceTimersByTimeAsync(4_000);
      await expect(pending).resolves.toEqual({ status: 'skipped', mode: 'recurring', period: PERIOD, reason: 'not-due' });
      expect(test.dependencies.logger.write).toHaveBeenLastCalledWith('warn', expect.objectContaining({
        allPlayerDiagnostics: ['preclaim-durability:persistence-failed'],
      }));
      expect(test.allPlayerSource.load).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it('skips no-fence diagnostic writes after cleanup time is exhausted', async () => {
    const test = harness();
    await expect(runAllPlayerIngestion({ ...test.dependencies, deadlineAt: '2026-09-15T00:59:55.000Z' }, {
      mode: 'recurring', period: PERIOD,
    })).resolves.toMatchObject({ status: 'unavailable', reason: 'timeout', stage: 'job-claim' });
    expect(test.dependencies.store.recordAllPlayerPreclaimOutcome).not.toHaveBeenCalled();
    expect(test.dependencies.logger.write).toHaveBeenLastCalledWith('warn', expect.objectContaining({
      allPlayerDiagnostics: ['preclaim-durability:deadline-unavailable'],
    }));
  });

  it('keeps both successful and rejected shadow executions free of preclaim writes', async () => {
    for (const access of ['live', 'replay'] as const) {
      const test = harness();
      await runAllPlayerIngestion({ ...test.dependencies,
        allPlayerSource: { ...test.allPlayerSource, access },
      }, { mode: 'shadow', period: PERIOD });
      expect(test.dependencies.store.recordAllPlayerPreclaimOutcome).not.toHaveBeenCalled();
      expect(test.dependencies.store.finishAllPlayerJob).not.toHaveBeenCalled();
    }
  });
});
