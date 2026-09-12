import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { NFL_TEAM_CODES, type LeagueWeekState, type ProjectionSlate } from '../domain/contracts';
import type { AllPlayerStatObservation } from '../domain/all-player-statistics';
import type { SleeperAllPlayerStatResult } from '../adapters/sleeper/all-player-stats';
import { normalizeSleeperScoringProfile } from '../adapters/sleeper/scoring-profile';
import { deterministicUuid } from '../adapters/neon/database-values';
import type { AllPlayerBatchInput, AllPlayerIdentityLookup, JobClaim } from '../adapters/neon/contracts';
import { externalPlayerRef } from '../shared/provider-identity';
import { PERIOD, PROJECTION_PROVIDER, OFFICIAL_PROVIDER, configuration, schedule, source } from '../../live-projection-worker.fixtures';
import { runAllPlayerIngestion, type AllPlayerIngestionDependencies } from './all-player-operation';

const PROFILE_ONE = '11111111-1111-4111-8111-111111111111';
const PROFILE_TWO = '22222222-2222-4222-8222-222222222222';
const OBS_ONE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OBS_TWO = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

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
      gmsActive: 1 as const, ...(activeZero ? {} : { appearances: 1 as const }),
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
      : id === 'pzero' ? { gms_active: 1 } : { gms_active: 1, gp: 1 },
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
  const allPlayerSource = { load: vi.fn(async (): Promise<SleeperAllPlayerStatResult> => ({
    status: 'available' as const, observation: options.observation ?? observation(),
  })) };
  const acquireJob = vi.fn<AllPlayerIngestionDependencies['store']['acquireJob']>(async (): Promise<JobClaim> => ({
    kind: 'acquired' as const, attempt: 1, leaseUntil: '2026-09-15T13:05:00.000Z',
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
    observationId: input.leagueSeasonId === 'season-one' ? OBS_ONE : OBS_TWO,
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
        leagueSeasonId: index === 0 ? 'season-one' : 'season-two',
        scoringProfileId: profiles[index], rulesHash: league.rulesHash,
        rules: { pass_td: leaguePoints[index] },
      }))),
      readAllPlayerIdentityMappings: vi.fn(async (inputs: readonly AllPlayerIdentityLookup[]) => inputs.map((input) => ({
        ...input, scoringEntityId: null, mappedEntityKind: null,
      }))),
      readAllPlayerGameContext: vi.fn(async () => gameContext()),
      upsertScoringEntities,
      recordLeagueWeekObservation,
      recordAllPlayerBatch,
      acquireJob,
      completeJob: vi.fn(async () => true),
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
      kind: 'acquired', attempt: 1, leaseUntil: '2026-09-15T13:05:00.000Z',
    }).mockResolvedValueOnce({ kind: 'busy' });
    const [first, second] = await Promise.all([
      runAllPlayerIngestion(test.dependencies, { mode: 'recurring', period: PERIOD }),
      runAllPlayerIngestion(test.dependencies, { mode: 'recurring', period: PERIOD }),
    ]);
    expect([first.status, second.status].sort()).toEqual(['completed', 'skipped']);
    expect(test.allPlayerSource.load).toHaveBeenCalledOnce();
    expect(test.recordAllPlayerBatch).toHaveBeenCalledOnce();
    expect(test.acquireJob.mock.calls[0][0]).toMatchObject({
      jobKey: 'all-player-ingestion:sleeper:2026:reg:1',
      scheduledFor: '2026-09-15T00:00:00.000Z', leaseSeconds: 43_500,
      minimumIntervalSeconds: 43_200,
    });
  });

  it('makes replays idempotent before provider retrieval', async () => {
    const test = harness();
    test.acquireJob.mockResolvedValueOnce({ kind: 'completed' });
    await expect(runAllPlayerIngestion(test.dependencies, { mode: 'backfill', period: PERIOD }))
      .resolves.toMatchObject({ status: 'skipped', reason: 'completed' });
    expect(test.allPlayerSource.load).not.toHaveBeenCalled();
    expect(test.recordAllPlayerBatch).not.toHaveBeenCalled();
  });

  it.each([
    ['provider validation', () => ({ status: 'unavailable' as const, reason: 'malformed' as const })],
    ['unknown eligibility', () => ({ status: 'available' as const, observation: {
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
  });

  it('leaves pointers unchanged after identity or persistence failure', async () => {
    const identity = harness();
    vi.mocked(identity.dependencies.store.readAllPlayerIdentityMappings).mockImplementationOnce(
      async (inputs) => inputs.map((input, index) => ({
        ...input, scoringEntityId: null,
        mappedEntityKind: index === 0 ? 'team_defense' : null,
      })),
    );
    await expect(runAllPlayerIngestion(identity.dependencies, { mode: 'backfill', period: PERIOD }))
      .resolves.toMatchObject({ status: 'unavailable' });
    expect(identity.pointers).toEqual([]);

    const persistence = harness();
    persistence.recordAllPlayerBatch.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(runAllPlayerIngestion(persistence.dependencies, { mode: 'backfill', period: PERIOD }))
      .resolves.toMatchObject({ status: 'unavailable', reason: 'unexpected' });
    expect(persistence.pointers).toEqual([]);
  });

  it('stores final corrections as new immutable batches and advances only guarded batch pointers', async () => {
    const test = harness();
    const first = await runAllPlayerIngestion(test.dependencies, { mode: 'backfill', period: PERIOD });
    test.acquireJob.mockResolvedValueOnce({
      kind: 'acquired', attempt: 2, leaseUntil: '2026-09-16T01:05:00.000Z',
    });
    test.allPlayerSource.load.mockResolvedValueOnce({ status: 'available', observation: observation('etag:"week-1-corrected"') });
    const second = await runAllPlayerIngestion(test.dependencies, { mode: 'backfill', period: PERIOD });
    expect([first.status, second.status]).toEqual(['completed', 'completed']);
    expect(test.batches).toHaveLength(2);
    expect(test.batches.map((value) => (value as { observation: AllPlayerStatObservation }).observation.sourceRevision))
      .toEqual(['etag:"week-1"', 'etag:"week-1-corrected"']);
    expect(new Set(test.pointers).size).toBe(2);
  });
});
