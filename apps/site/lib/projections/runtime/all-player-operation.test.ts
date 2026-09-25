import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { NFL_TEAM_CODES, type LeagueWeekState, type ProjectionSlate } from '../domain/contracts';
import type { AllPlayerStatObservation } from '../domain/all-player-statistics';
import * as allPlayerScoring from '../domain/all-player-statistics';
import { createSleeperAllPlayerStatSource, type SleeperAllPlayerStatRequest, type SleeperAllPlayerStatResult } from '../adapters/sleeper/all-player-stats';
import { normalizeSleeperScoringProfile } from '../adapters/sleeper/scoring-profile';
import { deterministicUuid } from '../adapters/neon/database-values';
import type { AllPlayerBatchInput, AllPlayerIdentityLookup, AllPlayerJobFence } from '../adapters/neon/contracts';
import { allPlayerStatSemanticHash } from '../adapters/neon/all-player-statistics';
import { externalPlayerRef } from '../shared/provider-identity';
import { PERIOD, PROJECTION_PROVIDER, OFFICIAL_PROVIDER, configuration, schedule, source, fullWeekSchedule } from '../../live-projection-worker.fixtures';
import { runAllPlayerIngestion, type AllPlayerIngestionDependencies } from './all-player-operation';

const PROFILE_ONE = '11111111-1111-4111-8111-111111111111';
const PROFILE_TWO = '22222222-2222-4222-8222-222222222222';
const OBS_ONE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OBS_TWO = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OBS_DYNASTY = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SEASON_ONE = deterministicUuid('season', 'one');
const SEASON_TWO = deterministicUuid('season', 'two');
const SEASON_DYNASTY = deterministicUuid('season', 'dynasty');
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
  dynasty?: boolean;
  unresolvedProjection?: boolean;
  observation?: AllPlayerStatObservation;
}> = {}) {
  let now = new Date('2026-09-15T01:00:00.000Z');
  const leaguePoints = options.divergent ? [4, 6] : [4, 4];
  const states = [leagueState('l1', leaguePoints[0]), leagueState('l2', leaguePoints[1])];
  const profiles = options.divergent ? [PROFILE_ONE, PROFILE_TWO] : [PROFILE_ONE, PROFILE_ONE];
  const configurations = [configuration('l1'), configuration('l2')];
  const seasons = [SEASON_ONE, SEASON_TWO];
  if (options.dynasty) {
    const dynasty = { ...configuration('1312138224994385920'), key: 'dynasty', displayName: 'Dynasty League' };
    configurations.push(dynasty);
    states.push({ ...source('1312138224994385920'), configuration: dynasty,
      scoringSettings: { provider: OFFICIAL_PROVIDER, rawRules: { pass_td: 6 } } });
    leaguePoints.push(6);
    profiles.push(PROFILE_TWO);
    seasons.push(SEASON_DYNASTY);
  }
  const batches: unknown[] = [];
  const pointers: string[] = [];
  const leaguePointers = new Map<string, string>();
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
    observationId: input.leagueSeasonId === SEASON_ONE ? OBS_ONE
      : input.leagueSeasonId === SEASON_TWO ? OBS_TWO : OBS_DYNASTY,
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
      statContentId: deterministicUuid('content', allPlayerStatSemanticHash(input.observation)),
      statObservationId: deterministicUuid('observation', input.observation.sourceRevision),
      semanticHash: 'a'.repeat(64), entriesStored: input.observation.entries.length,
      entryCount: input.observation.entries.length, scoreSets,
    } };
  });
  const recordAllPlayerScoreContent = vi.fn<AllPlayerIngestionDependencies['store']['recordAllPlayerScoreContent']>(async (input) => ({
    kind: 'stored', value: {
      statContentId: deterministicUuid('content', allPlayerStatSemanticHash(input.observation)),
      statObservationId: deterministicUuid('observation', input.observation.sourceRevision),
      scoreSetId: deterministicUuid('score-content', `${allPlayerStatSemanticHash(input.observation)}:${input.scoreSet.semanticHash}`),
      scoringProfileId: input.scoreSet.scoringProfileId,
    },
  }));
  const acceptAllPlayerLeagueScore = vi.fn<AllPlayerIngestionDependencies['store']['acceptAllPlayerLeagueScore']>(async (input) => {
    const pointerOutcome = leaguePointers.get(input.leagueSeasonId) === input.scoreSetId ? 'verified' as const : 'advanced' as const;
    leaguePointers.set(input.leagueSeasonId, input.scoreSetId);
    pointers.push(input.scoreSetId);
    return { kind: 'stored', value: { pointerOutcome,
      acceptanceId: deterministicUuid('acceptance', `${input.leagueSeasonId}:${input.statObservationId}:${input.officialObservationId}`) } };
  });
  const dependencies = {
    store: {
      enabled: true,
      readAllPlayerLeagueProfiles: vi.fn(async (input: Readonly<{
        leagues: readonly Readonly<{ leagueKey: string; rulesHash: string }>[];
      }>) => input.leagues.map((league) => {
        const index = configurations.findIndex(({ key }) => key === league.leagueKey);
        return {
        leagueKey: league.leagueKey,
        leagueSeasonId: seasons[index],
        scoringProfileId: profiles[index], rulesHash: league.rulesHash,
        rules: { pass_td: leaguePoints[index] },
        };
      })),
      readAllPlayerIdentityMappings: vi.fn(async (inputs: readonly AllPlayerIdentityLookup[]) => inputs.map((input) => ({
        ...input,
        scoringEntityId: input.provider === 'tank01' && input.externalId.startsWith('tank-')
          ? deterministicUuid('scoring-entity:player', `player:${input.externalId.slice(5)}`) : null,
        mappedEntityKind: input.provider === 'tank01' && input.externalId.startsWith('tank-') ? 'player' : null,
        mappingStatus: input.provider === 'tank01' && input.externalId.startsWith('tank-') ? 'verified' : null,
        validFrom: null, validTo: null,
      }))),
      readAllPlayerGameContext: vi.fn(async () => gameContext()),
      readAllPlayerHistoricalTeamContexts: vi.fn(async () => []),
      upsertScoringEntities,
      recordLeagueWeekObservation,
      recordAllPlayerBatch,
      recordAllPlayerScoreContent,
      acceptAllPlayerLeagueScore,
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
    leagueRegistry: { listActiveLeagues: () => configurations, getLeague: () => null },
    loadSchedule: vi.fn(async () => schedule),
    loadLeagueWeek: vi.fn(async (configurationValue) => {
      const index = configurations.findIndex(({ key }) => key === configurationValue.key);
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
    recordLeagueWeekObservation, recordAllPlayerBatch, recordAllPlayerScoreContent,
    acceptAllPlayerLeagueScore, batches, pointers, leaguePointers,
  };
}

describe('canonical all-player ingestion orchestration', () => {
  it('stores shared evidence before any league load and calculates a shared profile once', async () => {
    const test = harness();
    const calculate = vi.spyOn(allPlayerScoring, 'buildAllPlayerScoreContent');
    const load = vi.mocked(test.dependencies.loadLeagueWeek).getMockImplementation()!;
    vi.mocked(test.dependencies.loadLeagueWeek).mockImplementation(async (...args) => {
      expect(test.recordAllPlayerBatch).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ scoreSets: [] }));
      return load(...args);
    });
    try {
      expect(await runAllPlayerIngestion(test.dependencies, { mode: 'backfill', period: PERIOD }))
        .toMatchObject({ status: 'completed', acceptedLeagues: 2, failedLeagues: 0, scoringProfileCount: 1 });
      expect(calculate).toHaveBeenCalledOnce();
    } finally { calculate.mockRestore(); }
    expect(test.allPlayerSource.load).toHaveBeenCalledOnce();
    expect(test.dependencies.loadCatalog).toHaveBeenCalledOnce();
    expect(test.dependencies.loadSchedule).toHaveBeenCalledOnce();
    expect(test.recordAllPlayerScoreContent).toHaveBeenCalledOnce();
    expect(test.acceptAllPlayerLeagueScore).toHaveBeenCalledTimes(2);
    expect(new Set(test.acceptAllPlayerLeagueScore.mock.calls.map(([input]) => input.scoreSetId)).size).toBe(1);
  });

  it('rejects unserializable score content in shadow before claiming successful league validation', async () => {
    const test = harness();
    const build = allPlayerScoring.buildAllPlayerScoreContent;
    const calculate = vi.spyOn(allPlayerScoring, 'buildAllPlayerScoreContent').mockImplementation(async (input) => {
      const built = await build(input);
      return built.status === 'available' ? { ...built, scoreSet: { ...built.scoreSet, semanticHash: 'invalid' } } : built;
    });
    try {
      expect(await runAllPlayerIngestion(test.dependencies, { mode: 'shadow', period: PERIOD }))
        .toMatchObject({ status: 'completed', acceptedLeagues: 0, failedLeagues: 2, scoringProfileCount: 0 });
      expect(calculate).toHaveBeenCalledOnce();
      expect(test.recordAllPlayerBatch).not.toHaveBeenCalled();
      expect(test.recordAllPlayerScoreContent).not.toHaveBeenCalled();
      expect(test.acceptAllPlayerLeagueScore).not.toHaveBeenCalled();
    } finally { calculate.mockRestore(); }
  });

  it.each(['unregistered-season', 'missing-source-connection', 'missing-scoring-profile'] as const)
  ('retains intended %s failures while collecting healthy registrations', async (reason) => {
    const test = harness();
    const dependencies = { ...test.dependencies, leagueRegistry: { ...test.dependencies.leagueRegistry,
      registration: { intendedLeagueKeys: ['league1', 'league2', 'dynasty'], failures: [{ leagueKey: 'dynasty', reason }] },
    } };
    expect(await runAllPlayerIngestion(dependencies, { mode: 'backfill', period: PERIOD }))
      .toMatchObject({ status: 'completed', acceptedLeagues: 2, failedLeagues: 1,
        leagueOutcomes: expect.arrayContaining([{ leagueKey: 'dynasty', status: 'failed', reason: `registration-${reason}` }]) });
    expect(test.allPlayerSource.load).toHaveBeenCalledOnce();
    expect(test.acceptAllPlayerLeagueScore).toHaveBeenCalledTimes(2);
  });

  it('keeps a failing same-profile league on its prior acceptance while its peer advances', async () => {
    const test = harness();
    test.leaguePointers.set(SEASON_TWO, 'prior-accepted-score-set');
    const load = vi.mocked(test.dependencies.loadLeagueWeek).getMockImplementation()!;
    vi.mocked(test.dependencies.loadLeagueWeek).mockImplementation(async (...args) => {
      const league = await load(...args);
      return args[0].key === 'league2' ? { ...league,
        rawMatchups: league.rawMatchups.map((row) => ({ ...row, players_points: { p1: 9 }, points: 9 })),
      } : league;
    });
    expect(await runAllPlayerIngestion(test.dependencies, { mode: 'backfill', period: PERIOD }))
      .toMatchObject({ status: 'completed', acceptedLeagues: 1, failedLeagues: 1,
        leagueOutcomes: expect.arrayContaining([{ leagueKey: 'league2', status: 'failed', reason: 'score-scoring-mismatch' }]) });
    expect(test.leaguePointers.get(SEASON_TWO)).toBe('prior-accepted-score-set');
    expect(test.leaguePointers.get(SEASON_ONE)).toBeTruthy();
    expect(test.acceptAllPlayerLeagueScore.mock.calls.map(([input]) => input.leagueSeasonId)).toEqual([SEASON_ONE]);
    expect(test.recordAllPlayerScoreContent).toHaveBeenCalledOnce();
    expect(test.allPlayerSource.load).toHaveBeenCalledOnce();
  });

  it('bounds a slow league read while publishing its healthy peer and rejects late league publication', async () => {
    vi.useFakeTimers();
    try {
      const test = harness();
      const load = vi.mocked(test.dependencies.loadLeagueWeek).getMockImplementation()!;
      let release!: () => void;
      const blocked = new Promise<void>((resolve) => { release = resolve; });
      vi.mocked(test.dependencies.loadLeagueWeek).mockImplementation(async (...args) => {
        if (args[0].key === 'league1') await blocked;
        return load(...args);
      });
      const pending = runAllPlayerIngestion(test.dependencies, { mode: 'backfill', period: PERIOD });
      await vi.waitFor(() => expect([...test.leaguePointers.keys()]).toEqual([SEASON_TWO]), { timeout: 1_000 });
      await vi.advanceTimersByTimeAsync(8_001);
      expect(await pending).toMatchObject({ status: 'completed', acceptedLeagues: 1, failedLeagues: 1,
        leagueOutcomes: expect.arrayContaining([{ leagueKey: 'league1', status: 'failed', reason: 'league-source-timeout' }]) });
      release();
      await vi.advanceTimersByTimeAsync(0);
      expect([...test.leaguePointers.keys()]).toEqual([SEASON_TWO]);
      expect(test.acceptAllPlayerLeagueScore).toHaveBeenCalledOnce();
      expect(test.allPlayerSource.load).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });

  it.each(['lost', 'failed'] as const)('reports retained raw evidence without claiming publication after zero acceptances and %s completion', async (variant) => {
    const test = harness();
    vi.mocked(test.dependencies.loadLeagueWeek).mockRejectedValue(new Error('league-source-failed'));
    if (variant === 'lost') vi.mocked(test.dependencies.store.finishAllPlayerJob).mockResolvedValueOnce(false);
    else vi.mocked(test.dependencies.store.finishAllPlayerJob).mockRejectedValueOnce(new Error('private-database-error'));
    const result = await runAllPlayerIngestion(test.dependencies, { mode: 'backfill', period: PERIOD });
    expect(result).toMatchObject({ status: 'unavailable', stage: 'durable-outcome', persistedObservation: true,
      statObservationId: expect.any(String), reason: variant === 'lost' ? 'lease-lost' : 'outcome-persistence-failed' });
    expect(result).not.toHaveProperty('confirmedPublication');
    expect(test.acceptAllPlayerLeagueScore).not.toHaveBeenCalled();
    expect(test.recordAllPlayerBatch).toHaveBeenCalledOnce();
    expect(test.dependencies.logger.write).toHaveBeenLastCalledWith('warn', expect.objectContaining({
      allPlayerPersistedObservation: true, allPlayerConfirmedPublication: false, allPlayerRetryDisposition: 'global-budget',
    }));
  });

  it('retains a committed healthy acceptance when the next league publication fails', async () => {
    const test = harness({ divergent: true });
    const accept = test.acceptAllPlayerLeagueScore.getMockImplementation()!;
    test.acceptAllPlayerLeagueScore.mockImplementation(async (input) => {
      if (input.leagueSeasonId === SEASON_TWO) {
        expect(test.leaguePointers.has(SEASON_ONE)).toBe(true);
        throw new Error('private database error');
      }
      return accept(input);
    });
    const result = await runAllPlayerIngestion(test.dependencies, { mode: 'backfill', period: PERIOD });
    expect(result).toMatchObject({ status: 'completed', acceptedLeagues: 1, failedLeagues: 1,
      pointerOutcomes: ['advanced'], leagueOutcomes: expect.arrayContaining([
        { leagueKey: 'league2', status: 'failed', reason: 'league-processing-failed' },
      ]) });
    expect([...test.leaguePointers.keys()]).toEqual([SEASON_ONE]);
    expect(JSON.stringify(result)).not.toContain('private');
  });

  it('presents a shared live capture receipt to the existing recurring ownership claim', async () => {
    const test = harness();
    const receipt = { period: { season: 2026, seasonType: 'reg' as const, week: 1 },
      sourceRevision: 'captured-live', bodyHash: `sha256:${'a'.repeat(64)}`,
      requestStartedAt: '2026-09-15T00:59:50.000Z', requestCompletedAt: '2026-09-15T00:59:51.000Z', requestGeneration: 1 };
    await runAllPlayerIngestion({ ...test.dependencies, sharedCaptureReceipt: () => receipt }, {
      mode: 'recurring', period: PERIOD, requireFinalCoverage: false,
    });
    expect(test.acquireJob).toHaveBeenCalledWith(expect.objectContaining({ mode: 'recurring', captureReceipt: receipt }));
    expect(test.dependencies.store.markAllPlayerRequest).toHaveBeenCalledOnce();
  });

  it('does not let an explicit backfill borrow a recurring live capture receipt', async () => {
    const test = harness();
    const getReceipt = vi.fn(() => undefined);
    await runAllPlayerIngestion({ ...test.dependencies, sharedCaptureReceipt: getReceipt }, {
      mode: 'backfill', period: PERIOD, requireFinalCoverage: true,
    });
    expect(getReceipt).not.toHaveBeenCalled();
    expect(test.acquireJob.mock.calls[0][0]).not.toHaveProperty('captureReceipt');
  });

  function pregameHarness() {
    const test = harness();
    const kickoffAt = '2026-09-15T01:05:00.000Z';
    const futureSchedule = fullWeekSchedule(kickoffAt);
    const loadLeague = vi.mocked(test.dependencies.loadLeagueWeek).getMockImplementation()!;
    vi.mocked(test.dependencies.loadLeagueWeek).mockImplementation(async (...args) => {
      const value = await loadLeague(...args);
      return { ...value, state: { ...value.state, schedule: futureSchedule },
        rawMatchups: value.rawMatchups.map((row) => ({ ...row, points: 0,
          players_points: Object.fromEntries(Object.keys(row.players_points ?? {}).map((id) => [id, 0])),
        })) };
    });
    const games = gameContext().map((game) => ({ ...game, kickoffAt, phase: 'unknown' as const }));
    const readGames = vi.fn<AllPlayerIngestionDependencies['store']['readAllPlayerGameContext']>(async () => games);
    const authorities: Awaited<ReturnType<AllPlayerIngestionDependencies['store']['readLeagueLineupAuthorities']>> =
      test.dependencies.leagueRegistry.listActiveLeagues().map(({ key }) => ({ kind: 'available', leagueKey: key,
        authority: { leagueKey: key, defaultSeason: 2026, defaultSeasonType: 'reg', defaultWeek: 1,
          leagueLifecycle: 'active', activeSeason: 2026, activeSeasonType: 'reg', activeWeek: 1,
          nflPhase: 'regular', sourceProvider: 'sleeper', verifiedAt: test.dependencies.clock.now().toISOString(),
          sourceRevision: 'fixture', sourceObservedAt: test.dependencies.clock.now().toISOString(), authorityGeneration: 1,
          lineupShape: { sourceExternalLeagueId: key, expectedRosterCount: 1, expectedStarterSlotCount: 1,
            expectedRosterIds: ['1'] }, defaultPeriodCadence: { isCurrentRegularPeriod: true, games: [] },
        },
      }));
    const readAuthorities = vi.fn<AllPlayerIngestionDependencies['store']['readLeagueLineupAuthorities']>(async () => authorities);
    test.dependencies = { ...test.dependencies, loadSchedule: vi.fn(async () => futureSchedule), store: { ...test.dependencies.store,
      readAllPlayerGameContext: readGames, readLeagueLineupAuthorities: readAuthorities } };
    const weeklyFetch = vi.fn<typeof fetch>(async () => new Response('{}'));
    const emptySource = createSleeperAllPlayerStatSource({ fetch: weeklyFetch, now: () => test.dependencies.clock.now() });
    test.allPlayerSource.load.mockImplementation(emptySource.load);
    return { test, kickoffAt, futureSchedule, games, readGames, authorities, readAuthorities, weeklyFetch };
  }

  function expectNoStatWrites(test: ReturnType<typeof harness>) {
    expect(test.upsertScoringEntities).not.toHaveBeenCalled();
    expect(test.recordLeagueWeekObservation).not.toHaveBeenCalled();
    expect(test.recordAllPlayerBatch).not.toHaveBeenCalled();
    expect(test.recordAllPlayerScoreContent).not.toHaveBeenCalled();
    expect(test.acceptAllPlayerLeagueScore).not.toHaveBeenCalled();
    expect(test.pointers).toEqual([]);
  }

  it('records a budgeted no-statistics-yet skip only after proving the exact current period remains pregame', async () => {
    const { test, weeklyFetch, readGames, readAuthorities, kickoffAt } = pregameHarness();
    const result = await runAllPlayerIngestion(test.dependencies, { mode: 'recurring', period: PERIOD });
    expect(result).toMatchObject({ status: 'skipped', mode: 'recurring', reason: 'no-statistics-yet', period: PERIOD,
      responseEvidence: { httpStatus: 200, bodyShape: 'object', topLevelCount: 0,
        bodyHash: 'sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a' },
      pregameEvidence: { policy: 'exact-period-shared-pregame-v1', scheduledGameCount: 16, firstKickoffAt: kickoffAt },
    });
    expect(weeklyFetch).toHaveBeenCalledOnce();
    expect(test.dependencies.store.markAllPlayerRequest).toHaveBeenCalledExactlyOnceWith({
      fence: FENCE, period: { ...PERIOD, seasonType: 'reg' },
    });
    expect(readGames).toHaveBeenCalledTimes(2);
    expect(readAuthorities).not.toHaveBeenCalled();
    expect(test.dependencies.loadLeagueWeek).not.toHaveBeenCalled();
    expect(test.dependencies.store.finishAllPlayerJob).toHaveBeenCalledExactlyOnceWith({
      fence: FENCE, outcome: 'no-statistics-yet', sharedPregame: true, diagnostic: expect.objectContaining({
        stage: 'no-statistics-yet', reason: 'no-statistics-yet', finalCoverage: false,
        retryDisposition: 'global-budget', entryCount: 0, scoringProfileCount: 0,
        responseEvidence: expect.objectContaining({ topLevelCount: 0, bodyShape: 'object' }),
        pregameEvidence: expect.objectContaining({ firstKickoffAt: kickoffAt }),
      }),
    });
    expectNoStatWrites(test);
    expect(test.dependencies.logger.write).toHaveBeenLastCalledWith('info', expect.objectContaining({
      outcome: 'skipped', allPlayerReason: 'no-statistics-yet', allPlayerPersistedObservation: false,
      allPlayerConfirmedPublication: false,
    }));
  });

  it.each(['backfill', 'shadow', 'correction'] as const)('does not accept an empty response as %s completion', async (mode) => {
    const { test } = pregameHarness();
    const result = await runAllPlayerIngestion(test.dependencies, {
      mode: mode === 'correction' ? 'recurring' : mode, period: PERIOD, requireFinalCoverage: true,
    });
    expect(result).toMatchObject({ status: 'unavailable', reason: 'provider-empty-object',
      responseEvidence: { bodyShape: 'object', topLevelCount: 0 } });
    expectNoStatWrites(test);
  });

  it.each(['live', 'final', 'missing-game', 'duplicate-game', 'missing-kickoff', 'changed-kickoff',
    ] as const)('keeps empty %s evidence unavailable without manufacturing statistics', async (variant) => {
    const { test, games, readGames } = pregameHarness();
    if (variant === 'live' || variant === 'final') readGames.mockResolvedValueOnce(games)
      .mockResolvedValueOnce([{ ...games[0], phase: variant }, ...games.slice(1)]);
    if (variant === 'missing-game') readGames.mockResolvedValueOnce(games).mockResolvedValueOnce(games.slice(1));
    if (variant === 'duplicate-game') readGames.mockResolvedValueOnce(games).mockResolvedValueOnce([games[1], ...games.slice(1)]);
    if (variant === 'missing-kickoff' || variant === 'changed-kickoff') readGames.mockResolvedValueOnce(games)
      .mockResolvedValueOnce([{ ...games[0], kickoffAt: variant === 'missing-kickoff' ? null : '2026-09-15T01:06:00.000Z' }, ...games.slice(1)]);
    expect(await runAllPlayerIngestion(test.dependencies, { mode: 'recurring', period: PERIOD }))
      .toMatchObject({ status: 'unavailable', reason: 'provider-empty-object' });
    expectNoStatWrites(test);
    expect(test.dependencies.store.finishAllPlayerJob).not.toHaveBeenCalledWith(expect.objectContaining({ outcome: 'no-statistics-yet' }));
  });

  it.each(['missing-authority', 'failed-league-source', 'different-league-period'] as const)
  ('accepts an independently proven shared pregame response despite %s', async (variant) => {
    const { test, readAuthorities } = pregameHarness();
    readAuthorities.mockResolvedValue([]);
    if (variant === 'failed-league-source') vi.mocked(test.dependencies.loadLeagueWeek)
      .mockRejectedValue(new Error('private league source failure'));
    if (variant === 'different-league-period') {
      const load = vi.mocked(test.dependencies.loadLeagueWeek).getMockImplementation()!;
      vi.mocked(test.dependencies.loadLeagueWeek).mockImplementation(async (...args) => {
        const value = await load(...args);
        return { ...value, state: { ...value.state, period: { ...PERIOD, week: 2 } } };
      });
    }
    expect(await runAllPlayerIngestion(test.dependencies, { mode: 'recurring', period: PERIOD }))
      .toMatchObject({ status: 'skipped', reason: 'no-statistics-yet', pregameEvidence: {
        policy: 'exact-period-shared-pregame-v1', scheduledGameCount: 16,
      } });
    expect(readAuthorities).not.toHaveBeenCalled();
    expect(test.dependencies.loadLeagueWeek).not.toHaveBeenCalled();
    expect(test.allPlayerSource.load).toHaveBeenCalledOnce();
    expectNoStatWrites(test);
  });

  it('derives the pregame game count from the complete schedule with byes rather than requiring sixteen games', async () => {
    const { test, futureSchedule, games, readGames } = pregameHarness();
    const kept = games[0];
    for (const team of NFL_TEAM_CODES) {
      if (team !== kept.homeTeam && team !== kept.awayTeam) Object.assign(futureSchedule, { [team]: { kind: 'bye' } });
    }
    readGames.mockResolvedValue([kept]);
    expect(await runAllPlayerIngestion(test.dependencies, { mode: 'recurring', period: PERIOD }))
      .toMatchObject({ status: 'skipped', reason: 'no-statistics-yet', pregameEvidence: { scheduledGameCount: 1 } });
    expectNoStatWrites(test);
  });

  it.each(['missing-team', 'missing-kickoff', 'reciprocity', 'all-byes'] as const)(
    'rejects %s schedule evidence instead of treating absence of game rows as pregame proof', async (variant) => {
      const { test, futureSchedule, readGames, games } = pregameHarness();
      const first = Object.keys(futureSchedule)[0] as keyof typeof futureSchedule;
      const entry = futureSchedule[first]!;
      if (variant === 'missing-team') Reflect.deleteProperty(futureSchedule, first);
      if (variant === 'missing-kickoff') Object.assign(entry, { kickoffAt: null });
      if (variant === 'reciprocity' && entry.kind === 'scheduled') Object.assign(futureSchedule[entry.opponent]!, { location: entry.location });
      if (variant === 'all-byes') {
        for (const team of NFL_TEAM_CODES) Object.assign(futureSchedule, { [team]: { kind: 'bye' } });
        readGames.mockResolvedValue([]);
      } else readGames.mockResolvedValue(games);
      const result = await runAllPlayerIngestion(test.dependencies, { mode: 'recurring', period: PERIOD });
      expect(result).toMatchObject({ status: 'unavailable' });
      expectNoStatWrites(test);
      expect(test.dependencies.store.finishAllPlayerJob).not.toHaveBeenCalledWith(expect.objectContaining({ outcome: 'no-statistics-yet' }));
    },
  );

  it.each(['request', 'ownership-check'] as const)('rejects an empty response when kickoff crosses during the %s', async (stage) => {
    const { test, futureSchedule, games, weeklyFetch } = pregameHarness();
    for (const team of NFL_TEAM_CODES) Object.assign(futureSchedule[team]!, { kickoffAt: '2026-09-15T01:00:01.000Z' });
    for (const game of games) game.kickoffAt = '2026-09-15T01:00:01.000Z';
    const crossKickoff = () => vi.spyOn(test.dependencies.clock, 'now').mockReturnValue(new Date('2026-09-15T01:00:02.000Z'));
    if (stage === 'request') weeklyFetch.mockImplementationOnce(async () => { crossKickoff(); return new Response('{}'); });
    else vi.mocked(test.dependencies.store.validateAllPlayerJobFence).mockImplementationOnce(async () => { crossKickoff(); return true; });
    expect(await runAllPlayerIngestion(test.dependencies, { mode: 'recurring', period: PERIOD }))
      .toMatchObject({ status: 'unavailable', reason: 'provider-empty-object' });
    expectNoStatWrites(test);
  });

  it.each(['takeover', 'expired', 'deadline', 'completion-lost'] as const)(
    'does not claim a successful no-statistics-yet outcome after %s', async (variant) => {
      const { test, weeklyFetch } = pregameHarness();
      if (variant === 'takeover') vi.mocked(test.dependencies.store.validateAllPlayerJobFence).mockResolvedValueOnce(false);
      if (variant === 'completion-lost') vi.mocked(test.dependencies.store.finishAllPlayerJob).mockResolvedValueOnce(false);
      if (variant === 'expired') {
        test.acquireJob.mockResolvedValueOnce({ kind: 'acquired', fence: { ...FENCE, leaseUntil: '2026-09-15T01:00:01.000Z' } });
      }
      if (variant === 'expired' || variant === 'deadline') weeklyFetch.mockImplementationOnce(async () => {
        vi.spyOn(test.dependencies.clock, 'now').mockReturnValue(new Date(variant === 'expired'
          ? '2026-09-15T01:00:02.000Z' : '2026-09-15T01:00:51.000Z'));
        return new Response('{}');
      });
      expect(await runAllPlayerIngestion(test.dependencies, { mode: 'recurring', period: PERIOD }))
        .toMatchObject({ status: 'unavailable', reason: variant === 'deadline' ? 'timeout' : 'lease-lost' });
      expectNoStatWrites(test);
    },
  );

  it('forwards only sanitized malformed-response evidence to durable outcomes and logs', async () => {
    const { test, weeklyFetch } = pregameHarness();
    weeklyFetch.mockResolvedValueOnce(new Response('{"secret-player":{"pass_td":"secret-value"}}'));
    const result = await runAllPlayerIngestion(test.dependencies, { mode: 'recurring', period: PERIOD });
    expect(result).toMatchObject({ status: 'unavailable', reason: 'provider-malformed',
      responseEvidence: { httpStatus: 200, bodyShape: 'object', topLevelCount: 1 } });
    expect(test.dependencies.store.finishAllPlayerJob).toHaveBeenCalledWith(expect.objectContaining({
      outcome: 'provider-failed', diagnostic: expect.objectContaining({
        responseEvidence: expect.objectContaining({ bodyShape: 'object', topLevelCount: 1 }),
      }),
    }));
    const serialized = JSON.stringify([result, vi.mocked(test.dependencies.store.finishAllPlayerJob).mock.calls,
      vi.mocked(test.dependencies.logger.write).mock.calls]);
    expect(serialized).not.toContain('secret-');
    expectNoStatWrites(test);
  });

  it.each([
    ['23503', 'persistence-reference-rejected'], ['23514', 'persistence-constraint-rejected'],
    ['23505', 'persistence-conflict'], ['40001', 'persistence-transaction-conflict'],
    ['40P01', 'persistence-transaction-conflict'], ['57014', 'persistence-cancelled'],
    ['P0001', 'persistence-validation-rejected'],
  ])('retains allowlisted SQLSTATE %s without retaining SQL or exception text', async (code, reason) => {
    const test = harness();
    test.recordAllPlayerBatch.mockRejectedValueOnce(Object.assign(new Error('secret SQL error payload'), {
      code, detail: 'secret player details', query: 'secret query', connection: 'secret connection',
    }));
    const result = await runAllPlayerIngestion(test.dependencies, { mode: 'backfill', period: PERIOD });
    expect(result).toMatchObject({ status: 'unavailable', reason, stage: 'shared-capture-persistence',
      diagnostics: [`database-sqlstate:${code}`] });
    expect(test.dependencies.store.finishAllPlayerJob).toHaveBeenCalledWith(expect.objectContaining({
      outcome: 'validation-failed', diagnostic: expect.objectContaining({ reason,
        diagnostics: [`database-sqlstate:${code}`],
      }),
    }));
    expect(JSON.stringify([result, vi.mocked(test.dependencies.store.finishAllPlayerJob).mock.calls,
      vi.mocked(test.dependencies.logger.write).mock.calls])).not.toContain('secret');
  });

  it('does not forward an unrecognized error code or arbitrary error fields', async () => {
    const test = harness();
    test.recordAllPlayerBatch.mockRejectedValueOnce(Object.assign(new Error('secret-sql-error'), { code: 'secret code' }));
    const result = await runAllPlayerIngestion(test.dependencies, { mode: 'backfill', period: PERIOD });
    expect(result).toMatchObject({ status: 'unavailable', reason: 'stage-failed', stage: 'shared-capture-persistence' });
    expect(JSON.stringify([result, vi.mocked(test.dependencies.store.finishAllPlayerJob).mock.calls,
      vi.mocked(test.dependencies.logger.write).mock.calls])).not.toContain('secret');
  });

  it.each(['empty', 'duplicate-key', 'duplicate-source', 'wrong-provider', 'blank-key'] as const)
  ('rejects %s configured league inventory before catalog, weekly-stat or persistence work', async (variant) => {
    const test = harness({ dynasty: true });
    const leagues = [...test.dependencies.leagueRegistry.listActiveLeagues()];
    if (variant === 'empty') leagues.length = 0;
    if (variant === 'duplicate-key') leagues[2] = { ...leagues[2], key: leagues[1].key };
    if (variant === 'duplicate-source') leagues[2] = { ...leagues[2], leagueRef: leagues[1].leagueRef };
    if (variant === 'wrong-provider') leagues[2] = { ...leagues[2], leagueRef: {
      ...leagues[2].leagueRef, provider: PROJECTION_PROVIDER,
    } };
    if (variant === 'blank-key') leagues[2] = { ...leagues[2], key: ' ' };
    const dependencies = { ...test.dependencies, leagueRegistry: { listActiveLeagues: () => leagues } };
    await expect(runAllPlayerIngestion(dependencies, { mode: 'shadow', period: PERIOD }))
      .resolves.toMatchObject({ status: 'unavailable', reason: 'league-inventory' });
    expect(test.dependencies.loadLeagueWeek).not.toHaveBeenCalled();
    expect(test.dependencies.loadCatalog).not.toHaveBeenCalled();
    expect(test.allPlayerSource.load).not.toHaveBeenCalled();
    expect(test.recordAllPlayerBatch).not.toHaveBeenCalled();
  });

  it('isolates a league load carrying another configured league identity', async () => {
    const test = harness({ dynasty: true });
    const load = test.dependencies.loadLeagueWeek;
    const dependencies = { ...test.dependencies, loadLeagueWeek: async (...args: Parameters<typeof load>) => {
      const value = await load(...args);
      return args[0].key !== 'dynasty' ? value : { ...value, state: { ...value.state,
        configuration: configuration('l1'),
      } };
    } };
    await expect(runAllPlayerIngestion(dependencies, { mode: 'shadow', period: PERIOD }))
      .resolves.toMatchObject({ status: 'completed', acceptedLeagues: 2, failedLeagues: 1,
        leagueOutcomes: expect.arrayContaining([{ leagueKey: 'dynasty', status: 'failed', reason: 'league-identity-mismatch' }]) });
    expect(test.allPlayerSource.load).toHaveBeenCalledOnce();
    expect(test.recordAllPlayerBatch).not.toHaveBeenCalled();
  });

  it.each([
    { mode: 'shadow', reverse: false }, { mode: 'shadow', reverse: true },
    { mode: 'backfill', reverse: false }, { mode: 'backfill', reverse: true },
  ] as const)('uses one response for three leagues and two complete profiles in $mode (reverse=$reverse)', async ({ mode, reverse }) => {
    const test = harness({ dynasty: true });
    const dependencies = reverse ? { ...test.dependencies, leagueRegistry: {
      ...test.dependencies.leagueRegistry,
      listActiveLeagues: () => [...test.dependencies.leagueRegistry.listActiveLeagues()].reverse(),
    } } : test.dependencies;
    const result = await runAllPlayerIngestion(dependencies, { mode, period: PERIOD });
    expect(result).toMatchObject({ status: 'completed', scoringProfileCount: 2,
      parityComparisonCount: 3, parityMismatchCount: 0, persisted: mode === 'backfill' });
    expect(test.dependencies.loadLeagueWeek).toHaveBeenCalledTimes(3);
    expect(test.dependencies.loadCatalog).toHaveBeenCalledOnce();
    expect(test.allPlayerSource.load).toHaveBeenCalledOnce();
    if (mode === 'shadow') {
      expect(test.upsertScoringEntities).not.toHaveBeenCalled();
      expect(test.recordLeagueWeekObservation).not.toHaveBeenCalled();
      expect(test.recordAllPlayerBatch).not.toHaveBeenCalled();
    } else {
      expect(test.recordLeagueWeekObservation.mock.calls.map(([input]) => input.leagueSeasonId).sort())
        .toEqual([SEASON_ONE, SEASON_TWO, SEASON_DYNASTY].sort());
      expect(test.recordAllPlayerBatch).toHaveBeenCalledOnce();
      expect(test.recordAllPlayerBatch.mock.calls[0][0].scoreSets).toEqual([]);
      const scoreSets = test.recordAllPlayerScoreContent.mock.calls.map(([input]) => input.scoreSet);
      expect(scoreSets).toHaveLength(2);
      expect(test.acceptAllPlayerLeagueScore.mock.calls.map(([input]) => input.officialObservationId).sort())
        .toEqual([OBS_ONE, OBS_TWO, OBS_DYNASTY]);
      expect(scoreSets.map((set) => ({
        profileId: set.scoringProfileId,
        points: set.scores.find((score) => score.providerExternalId === 'p1')?.fantasyPoints,
      })).sort((left, right) => left.profileId.localeCompare(right.profileId))).toEqual([
        { profileId: PROFILE_ONE, points: 4 }, { profileId: PROFILE_TWO, points: 6 },
      ]);
      expect(scoreSets.every((set) => set.coverage.complete === true)).toBe(true);
    }
  });

  it('retains shared capture and accepts healthy peers when the third league profile is missing', async () => {
    const test = harness({ dynasty: true });
    const read = test.dependencies.store.readAllPlayerLeagueProfiles;
    const dependencies = { ...test.dependencies, store: { ...test.dependencies.store,
      readAllPlayerLeagueProfiles: async (...args: Parameters<typeof read>) => (await read(...args)).filter((row) => row.leagueKey !== 'dynasty'),
    } };
    await expect(runAllPlayerIngestion(dependencies, { mode: 'backfill', period: PERIOD }))
      .resolves.toMatchObject({ status: 'completed', acceptedLeagues: 2, failedLeagues: 1,
        leagueOutcomes: expect.arrayContaining([{ leagueKey: 'dynasty', status: 'failed', reason: 'scoring-profile-inventory' }]) });
    expect(test.allPlayerSource.load).toHaveBeenCalledOnce();
    expect(test.recordAllPlayerBatch).toHaveBeenCalledOnce();
    expect([...test.leaguePointers.keys()].sort()).toEqual([SEASON_ONE, SEASON_TWO].sort());
  });

  it('accepts healthy leagues when Dynasty official points disagree with its rules', async () => {
    const test = harness({ dynasty: true });
    const load = test.dependencies.loadLeagueWeek;
    const dependencies = { ...test.dependencies, loadLeagueWeek: async (...args: Parameters<typeof load>) => {
      const value = await load(...args);
      return args[0].key !== 'dynasty' ? value : { ...value,
        rawMatchups: value.rawMatchups.map((row) => ({ ...row, players_points: { p1: 7 }, points: 7 })),
      };
    } };
    await expect(runAllPlayerIngestion(dependencies, { mode: 'backfill', period: PERIOD }))
      .resolves.toMatchObject({ status: 'completed', acceptedLeagues: 2, failedLeagues: 1,
        leagueOutcomes: expect.arrayContaining([{ leagueKey: 'dynasty', status: 'failed', reason: 'score-scoring-mismatch' }]) });
    expect(test.allPlayerSource.load).toHaveBeenCalledOnce();
    expect(test.recordAllPlayerBatch).toHaveBeenCalledOnce();
    expect(test.recordAllPlayerScoreContent).toHaveBeenCalledOnce();
    expect([...test.leaguePointers.keys()].sort()).toEqual([SEASON_ONE, SEASON_TWO].sort());
  });
  it.each([null, []])('rejects unknown official starter assignments before league acceptance (%j)', async (starters) => {
    const test = harness();
    const load = test.dependencies.loadLeagueWeek;
    test.dependencies = { ...test.dependencies, loadLeagueWeek: async (...args) => {
      const league = await load(...args);
      return { ...league, rawMatchups: league.rawMatchups.map((row) => ({ ...row, starters })) };
    } };
    const result = await runAllPlayerIngestion(test.dependencies, { mode: 'shadow', period: PERIOD });
    expect(result).toMatchObject({ status: 'completed', acceptedLeagues: 0, failedLeagues: 2,
      leagueOutcomes: expect.arrayContaining([expect.objectContaining({ reason: 'official-starters-unavailable' })]) });
    expect(test.allPlayerSource.load).toHaveBeenCalledOnce();
    expect(test.recordLeagueWeekObservation).not.toHaveBeenCalled();
    expect(test.recordAllPlayerBatch).not.toHaveBeenCalled();
    expect(test.acceptAllPlayerLeagueScore).not.toHaveBeenCalled();
  });

  it('rejects a missing-row assumption detached from the loaded inventory before any writes', async () => {
    const test = harness();
    const load = test.allPlayerSource.load.getMockImplementation()!;
    test.allPlayerSource.load.mockImplementationOnce(async (request) => {
      const loaded = await load(request);
      if (loaded.status !== 'available') return loaded;
      return { ...loaded, observation: { ...loaded.observation, quality: 'partial' as const,
        coverage: { ...loaded.observation.coverage, complete: false },
        entries: loaded.observation.entries.map((entry) => entry.providerExternalId !== 'p1' ? entry : {
          ...entry, stats: {}, eligibleGameCount: null, appearanceGameCount: 0 as const,
          eligibilityEvidence: { kind: 'assumed-nonparticipation' as const,
            policy: 'missing-participation-as-zero-v1' as const, source: 'product-policy' as const,
            effectivePeriod: { season: 2026, seasonType: 'reg' as const, week: 1 },
            basis: { kind: 'missing-provider-row' as const, inventoryFingerprint: `sha256:${'f'.repeat(64)}` },
          },
        }),
      } };
    });
    await expect(runAllPlayerIngestion(test.dependencies, { mode: 'backfill', period: PERIOD }))
      .resolves.toMatchObject({ status: 'unavailable', reason: 'observation-provenance-mismatch',
        diagnostics: expect.arrayContaining(['sleeper/p1:eligibility-provenance-conflict']) });
    expect(test.upsertScoringEntities).not.toHaveBeenCalled();
    expect(test.recordLeagueWeekObservation).not.toHaveBeenCalled();
    expect(test.recordAllPlayerBatch).not.toHaveBeenCalled();
  });

  it('retains actual catalog observation time on live retrieval without changing participation', async () => {
    const test = harness();
    const dependencies: AllPlayerIngestionDependencies = { ...test.dependencies,
      allPlayerSource: { ...test.allPlayerSource, access: 'live' },
      loadCatalog: async () => ({ catalog: { ...catalog,
        p1: { ...catalog.p1, status: 'Inactive', active: false },
      }, complete: true, sourceRevision: `sha256:${'a'.repeat(64)}`,
      identityRevision: 'catalog-identity-revision', observedAt: '2026-09-15T00:59:00.000Z' }),
    };
    await runAllPlayerIngestion(dependencies, { mode: 'backfill', period: PERIOD });
    expect(test.recordAllPlayerBatch).toHaveBeenCalledOnce();
    const saved = test.recordAllPlayerBatch.mock.calls[0][0].observation;
    expect(saved.providerContext).toMatchObject({ observedAt: '2026-09-15T00:59:00.000Z',
      role: 'context-only', effectivePeriod: null, sourceRevision: `sha256:${'a'.repeat(64)}` });
    expect(saved.providerContext?.players.find((player) => player.providerExternalId === 'p1'))
      .toMatchObject({ status: 'Inactive', active: false });
    expect(saved.entries.find((entry) => entry.providerExternalId === 'p1'))
      .toMatchObject({ eligibleGameCount: 1, appearanceGameCount: 1 });
    expect(saved.coverage.catalogRevision).toBe('catalog-identity-revision');
  });

  it('rejects catalog time after weekly observation before canonical or official writes', async () => {
    const test = harness();
    const dependencies: AllPlayerIngestionDependencies = { ...test.dependencies,
      allPlayerSource: { ...test.allPlayerSource, access: 'live' },
      loadCatalog: async () => ({ catalog, complete: true,
        sourceRevision: `sha256:${'a'.repeat(64)}`, observedAt: '2026-09-16T00:00:00.000Z' }),
    };
    await expect(runAllPlayerIngestion(dependencies, { mode: 'backfill', period: PERIOD }))
      .resolves.toMatchObject({ status: 'unavailable' });
    expect(test.upsertScoringEntities).not.toHaveBeenCalled();
    expect(test.recordLeagueWeekObservation).not.toHaveBeenCalled();
    expect(test.recordAllPlayerBatch).not.toHaveBeenCalled();
  });

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
    'retains shared capture and reports independent %s acceptance outcomes', async (variant) => {
      const test = harness({ divergent: true });
      const accept = test.acceptAllPlayerLeagueScore.getMockImplementation()!;
      test.acceptAllPlayerLeagueScore.mockImplementation(async (input) => (
        variant === 'mixed-group' && input.leagueSeasonId === SEASON_TWO ? accept(input)
          : { kind: 'stored', value: { acceptanceId: deterministicUuid('superseded', input.leagueSeasonId), pointerOutcome: 'superseded' } }
      ));
      const result = await runAllPlayerIngestion(test.dependencies, { mode: 'backfill', period: PERIOD });
      expect(result).toMatchObject({ status: 'completed', persisted: true,
        acceptedLeagues: variant === 'mixed-group' ? 1 : 0, failedLeagues: variant === 'mixed-group' ? 1 : 2,
        leagueOutcomes: expect.arrayContaining([expect.objectContaining({ reason: 'old-observation-rejected' })]),
        pointerOutcomes: variant === 'mixed-group' ? ['advanced'] : [],
      });
      expect(test.recordAllPlayerBatch).toHaveBeenCalledOnce();
      expect([...test.leaguePointers.keys()]).toEqual(variant === 'mixed-group' ? [SEASON_TWO] : []);
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
    expect(test.recordAllPlayerScoreContent).not.toHaveBeenCalled();
    expect(test.acceptAllPlayerLeagueScore).not.toHaveBeenCalled();
  });

  it('captures once, calculates each divergent profile once, and preserves active zero', async () => {
    const test = harness({ divergent: true });
    const result = await runAllPlayerIngestion(test.dependencies, { mode: 'backfill', period: PERIOD });
    expect(result).toMatchObject({
      status: 'completed', persisted: true, scoringProfileCount: 2,
      parityComparisonCount: 2, activeZeroCount: 1,
    });
    expect(test.allPlayerSource.load).toHaveBeenCalledOnce();
    expect(test.recordAllPlayerBatch).toHaveBeenCalledOnce();
    expect(test.recordAllPlayerBatch.mock.calls[0][0].scoreSets).toEqual([]);
    const sets = test.recordAllPlayerScoreContent.mock.calls.map(([input]) => input.scoreSet);
    expect(sets).toHaveLength(2);
    expect(sets.every((set) => set.coverage.complete === true)).toBe(true);
    expect(sets.flatMap((set) => set.scores).filter((score) => (
      score.providerExternalId === 'free'
    ))).toHaveLength(2);
    expect(sets.flatMap((set) => set.scores)
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

  it('does not start a weekly provider request after a slow reservation exhausts the deadline', async () => {
    const test = harness();
    let clockNow = new Date('2026-09-15T01:00:00Z');
    vi.mocked(test.dependencies.store.markAllPlayerRequest).mockImplementationOnce(async () => {
      clockNow = new Date('2026-09-15T01:00:51Z');
      return true;
    });
    const result = await runAllPlayerIngestion({ ...test.dependencies,
      clock: { now: () => clockNow, monotonicNow: () => clockNow.getTime() },
    }, { mode: 'recurring', period: PERIOD });
    expect(result).toMatchObject({ status: 'unavailable', reason: 'timeout', stage: 'weekly-stat-request' });
    expect(test.allPlayerSource.load).not.toHaveBeenCalled();
    expect(test.recordAllPlayerBatch).not.toHaveBeenCalled();
    expect(test.dependencies.store.finishAllPlayerJob).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      outcome: 'timeout',
    }));
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

  it('reports accepted recurring partial capture as successful retention with durable diagnostics and no score pointers', async () => {
    const partial = { ...observation(), quality: 'partial' as const,
      coverage: { complete: false, unknownEligibilityCount: 1 },
      entries: observation().entries.map((value, index) => index === 0 ? {
        ...value, stats: {}, eligibleGameCount: null, appearanceGameCount: null,
        eligibilityEvidence: { kind: 'missing-provider-row' as const, inventoryFingerprint: `sha256:${'a'.repeat(64)}` },
      } : value),
    };
    const test = harness({ observation: partial });
    const cadenceDiagnostics = ['final-capture-overdue:2026:regular:1'];
    const result = await runAllPlayerIngestion(test.dependencies, {
      mode: 'recurring', period: PERIOD, requireFinalCoverage: false, cadenceDiagnostics,
    });
    expect(result).toMatchObject({ status: 'partial', mode: 'recurring',
      persistedObservation: true, scoringProfileCount: 0, statObservationId: expect.any(String),
      entryCount: 37, diagnostics: expect.arrayContaining(cadenceDiagnostics),
      warnings: expect.arrayContaining(cadenceDiagnostics),
    });
    expect(test.dependencies.store.finishAllPlayerJob).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      outcome: 'partial', diagnostic: expect.objectContaining({ stage: 'partial-persistence',
        finalCoverage: false, scoringProfileCount: 0, entryCount: 37,
        diagnostics: expect.arrayContaining(cadenceDiagnostics),
      }),
    }));
    expect(test.dependencies.logger.write).toHaveBeenLastCalledWith('info', expect.objectContaining({
      outcome: 'completed', allPlayerReason: 'partial-observation-retained',
      allPlayerPersistedObservation: true, allPlayerConfirmedPublication: false,
      allPlayerDiagnostics: expect.arrayContaining(cadenceDiagnostics),
    }));
    expect(test.recordAllPlayerBatch).toHaveBeenCalledOnce();
    expect(test.recordAllPlayerBatch.mock.calls[0][0].scoreSets).toEqual([]);
    expect(test.recordAllPlayerBatch.mock.calls[0][0].observation.warnings).toEqual(expect.arrayContaining(cadenceDiagnostics));
    expect(test.upsertScoringEntities).not.toHaveBeenCalled();
    expect(test.recordLeagueWeekObservation).not.toHaveBeenCalled();
    expect(test.pointers).toEqual([]);
  });

  it.each(['lost', 'failed'] as const)('retains raw capture evidence when partial completion ownership is %s', async (variant) => {
    const partial = { ...observation(), quality: 'partial' as const,
      coverage: { complete: false, unknownEligibilityCount: 1 },
      entries: observation().entries.map((value, index) => index === 0 ? {
        ...value, stats: {}, eligibleGameCount: null, appearanceGameCount: null,
        eligibilityEvidence: { kind: 'missing-provider-row' as const, inventoryFingerprint: `sha256:${'a'.repeat(64)}` },
      } : value),
    };
    const test = harness({ observation: partial });
    if (variant === 'lost') vi.mocked(test.dependencies.store.finishAllPlayerJob).mockResolvedValueOnce(false);
    else vi.mocked(test.dependencies.store.finishAllPlayerJob).mockRejectedValueOnce(new Error('private-database-error'));
    const result = await runAllPlayerIngestion(test.dependencies, {
      mode: 'recurring', period: PERIOD, requireFinalCoverage: false,
    });
    expect(result).toMatchObject({ status: 'unavailable', stage: 'durable-outcome',
      reason: variant === 'lost' ? 'lease-lost' : 'outcome-persistence-failed',
      persistedObservation: true, statObservationId: expect.any(String),
    });
    expect(test.pointers).toEqual([]);
    expect(test.dependencies.logger.write).toHaveBeenLastCalledWith('warn', expect.objectContaining({
      outcome: 'failed', allPlayerPersistedObservation: true, allPlayerConfirmedPublication: false,
    }));
  });

  it.each(['shadow', 'backfill'] as const)('rejects league participation conflicts without rewriting shared raw evidence in %s', async (mode) => {
    const input = observation();
    const test = harness({ observation: { ...input, entries: input.entries.map((value) => (
      value.providerExternalId === 'p1' ? { ...value, stats: { gms_active: 1, pass_td: 1 } } : value
    )) } });
    const result = await runAllPlayerIngestion(test.dependencies, { mode, period: PERIOD });
    expect(result).toMatchObject({ status: 'completed', acceptedLeagues: 0, failedLeagues: 2,
      leagueOutcomes: expect.arrayContaining([expect.objectContaining({ reason: 'league-participation-conflict' })]) });
    expect(test.recordLeagueWeekObservation).not.toHaveBeenCalled();
    expect(test.acceptAllPlayerLeagueScore).not.toHaveBeenCalled();
    expect(test.pointers).toEqual([]);
    if (mode === 'shadow') expect(test.recordAllPlayerBatch).not.toHaveBeenCalled();
    else {
      expect(test.recordAllPlayerBatch).toHaveBeenCalledOnce();
      expect(test.recordAllPlayerBatch.mock.calls[0][0].observation.entries
        .find((value) => value.providerExternalId === 'p1')).toMatchObject({
        stats: { gms_active: 1, pass_td: 1 }, appearanceGameCount: 0,
        eligibilityEvidence: { kind: 'assumed-nonparticipation' },
      });
    }
  });

  it('preserves parity tolerance for an actually appearing player', async () => {
    const input = observation();
    const test = harness({ divergent: true, observation: { ...input, entries: input.entries.map((value) => (
      value.providerExternalId === 'p1'
        ? { ...value, stats: { gms_active: 1, gp: 1, pass_td: 1.000_000_2 } } : value
    )) } });
    const result = await runAllPlayerIngestion(test.dependencies, { mode: 'backfill', period: PERIOD });
    expect(result).toMatchObject({ status: 'completed', acceptedLeagues: 1, failedLeagues: 1,
      leagueOutcomes: expect.arrayContaining([
        expect.objectContaining({ leagueKey: 'league1', status: 'accepted' }),
        expect.objectContaining({ leagueKey: 'league2', status: 'failed', reason: 'score-scoring-mismatch' }),
      ]) });
    expect(test.acceptAllPlayerLeagueScore).toHaveBeenCalledOnce();
    expect([...test.leaguePointers.keys()]).toEqual([SEASON_ONE]);
  });

  it.each(['shadow', 'backfill'] as const)('rejects nonzero nonparticipating content even below participation tolerance in %s', async (mode) => {
    const input = observation();
    const test = harness({ divergent: true, observation: { ...input, entries: input.entries.map((value) => (
      value.providerExternalId === 'free'
        // Synthetic threshold case: 4 * this value is below tolerance, 6 * it exceeds tolerance.
        ? { ...value, stats: { gms_active: 1, pass_td: 0.000_000_2 } } : value
    )) } });
    const result = await runAllPlayerIngestion(test.dependencies, { mode, period: PERIOD });
    // Shadow must apply the same strict score serialization as the real writer:
    // appearance zero cannot carry nonzero points, even below reconciliation tolerance.
    expect(result).toMatchObject({ status: 'completed', acceptedLeagues: 0, failedLeagues: 2,
      leagueOutcomes: expect.arrayContaining([
        { leagueKey: 'league1', status: 'failed', reason: 'league-processing-failed' },
        { leagueKey: 'league2', status: 'failed', reason: 'league-participation-conflict' },
      ]) });
    if (mode === 'backfill') {
      expect(test.recordAllPlayerBatch).toHaveBeenCalledOnce();
      expect(test.recordAllPlayerBatch.mock.calls[0][0].observation.entries
        .find((value) => value.providerExternalId === 'free')).toMatchObject({
        eligibleGameCount: 1, appearanceGameCount: 0, stats: { gms_active: 1, pass_td: 0.000_000_2 },
      });
    } else expect(test.recordAllPlayerBatch).not.toHaveBeenCalled();
    expect(test.recordAllPlayerScoreContent).not.toHaveBeenCalled();
    expect(test.acceptAllPlayerLeagueScore).not.toHaveBeenCalled();
    expect([...test.leaguePointers.keys()]).toEqual([]);
  });

  it.each([
    { mode: 'shadow', missing: true }, { mode: 'backfill', missing: true },
    { mode: 'shadow', missing: false }, { mode: 'backfill', missing: false },
  ] as const)('never accepts official nonzero points against provider nonparticipation ($mode, missing=$missing)', async ({ mode, missing }) => {
    const input = observation();
    const test = harness({ observation: { ...input, entries: input.entries.map((value) => (
      value.providerExternalId === 'p1' ? { ...value,
        stats: missing ? {} : { gms_active: 1, pass_td: 0 },
        ...(missing ? { eligibilityEvidence: {
          kind: 'missing-provider-row' as const, inventoryFingerprint: `sha256:${'a'.repeat(64)}`,
        } } : {}),
      } : value
    )) } });
    const result = await runAllPlayerIngestion(test.dependencies, { mode, period: PERIOD });
    expect(result).toMatchObject(missing ? { status: 'unavailable', reason: 'provider-coverage-incomplete' }
      : { status: 'completed', acceptedLeagues: 0, failedLeagues: 2,
        leagueOutcomes: expect.arrayContaining([expect.objectContaining({ reason: 'league-participation-conflict' })]) });
    expect(test.recordLeagueWeekObservation).not.toHaveBeenCalled();
    expect(test.acceptAllPlayerLeagueScore).not.toHaveBeenCalled();
    expect(test.pointers).toEqual([]);
    if (mode === 'shadow') expect(test.recordAllPlayerBatch).not.toHaveBeenCalled();
    else {
      const batch = test.recordAllPlayerBatch.mock.calls[0][0];
      expect(batch.scoreSets).toEqual([]);
      expect(batch.observation.entries.find((value) => value.providerExternalId === 'p1')).toMatchObject({
        appearanceGameCount: 0, stats: missing ? {} : { gms_active: 1, pass_td: 0 },
        eligibilityEvidence: { kind: 'assumed-nonparticipation' },
      });
    }
  });

  it('retains zero weekly assumptions and missing-row assumptions when another weekly row conflicts', async () => {
    const input = observation();
    const test = harness({ observation: { ...input, entries: input.entries.map((value) => (
      value.providerExternalId === 'p1' ? { ...value, stats: { pass_td: -1 } }
        : value.providerExternalId === 'pzero' ? { ...value, stats: { gms_active: 1 } }
          : value.providerExternalId === 'free' ? { ...value, stats: {}, eligibilityEvidence: {
            kind: 'missing-provider-row' as const, inventoryFingerprint: `sha256:${'a'.repeat(64)}`,
          } } : value
    )) } });
    await expect(runAllPlayerIngestion(test.dependencies, { mode: 'backfill', period: PERIOD }))
      .resolves.toMatchObject({ status: 'unavailable', reason: 'provider-coverage-incomplete', persistedObservation: true });
    expect(test.acceptAllPlayerLeagueScore).not.toHaveBeenCalled();
    const saved = test.recordAllPlayerBatch.mock.calls[0][0].observation;
    expect(saved.entries.find((value) => value.providerExternalId === 'p1')).toMatchObject({
      appearanceGameCount: 0, stats: { pass_td: -1 }, eligibilityEvidence: { kind: 'assumed-nonparticipation' },
    });
    expect(saved.entries.find((value) => value.providerExternalId === 'pzero')).toMatchObject({
      eligibleGameCount: 1, appearanceGameCount: 0,
      eligibilityEvidence: { kind: 'assumed-nonparticipation', basis: { kind: 'weekly-stat', gmsActive: 1 } },
    });
    expect(saved.entries.find((value) => value.providerExternalId === 'free')).toMatchObject({
      eligibleGameCount: null, appearanceGameCount: 0, stats: {},
      eligibilityEvidence: { kind: 'assumed-nonparticipation', basis: { kind: 'missing-provider-row' } },
    });
  });

  it('rejects malformed assumption bases with diagnostics before any raw or ancillary writes', async () => {
    const input = observation();
    const test = harness({ observation: { ...input, entries: input.entries.map((value) => (
      value.providerExternalId === 'p1' ? { ...value, stats: { gms_active: 1 } } : value
    )) } });
    const load = test.allPlayerSource.load.getMockImplementation()!;
    test.allPlayerSource.load.mockImplementation(async (request) => {
      const result = await load(request);
      if (result.status !== 'available') return result;
      return { ...result, observation: { ...result.observation,
        entries: result.observation.entries.map((value) => value.providerExternalId === 'p1' ? {
          ...value, eligibilityEvidence: { ...value.eligibilityEvidence, basis: null },
        } : value),
      } } as unknown as SleeperAllPlayerStatResult;
    });
    await expect(runAllPlayerIngestion(test.dependencies, { mode: 'backfill', period: PERIOD }))
      .resolves.toMatchObject({ status: 'unavailable', reason: 'observation-coverage-invalid',
        diagnostics: expect.arrayContaining(['invalid-publication-coverage:providerPresentEntityCount']) });
    expect(test.recordAllPlayerBatch).not.toHaveBeenCalled();
    expect(test.upsertScoringEntities).not.toHaveBeenCalled();
    expect(test.recordLeagueWeekObservation).not.toHaveBeenCalled();
  });

  it('rejects invalid observed scoring material before partial raw writes', async () => {
    const input = observation();
    const test = harness({ observation: { ...input, entries: input.entries.map((value) => (
      value.providerExternalId === 'p1' ? { ...value, stats: { gms_active: 1 } } : value
    )) } });
    const load = test.allPlayerSource.load.getMockImplementation()!;
    test.allPlayerSource.load.mockImplementation(async (request) => {
      const result = await load(request);
      if (result.status !== 'available') return result;
      return { ...result, observation: { ...result.observation,
        entries: result.observation.entries.map((value) => value.providerExternalId === 'p1'
          ? { ...value, stats: { ...value.stats, pass_td: Number.NaN } } : value),
      } };
    });
    await expect(runAllPlayerIngestion(test.dependencies, { mode: 'backfill', period: PERIOD }))
      .resolves.toMatchObject({ status: 'unavailable', reason: 'score-unsupported-scoring',
        diagnostics: ['invalid-stat:p1:pass_td'] });
    expect(test.recordAllPlayerBatch).not.toHaveBeenCalled();
    expect(test.upsertScoringEntities).not.toHaveBeenCalled();
    expect(test.recordLeagueWeekObservation).not.toHaveBeenCalled();
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
    const contents = test.recordAllPlayerScoreContent.mock.calls.map(([input]) => input.scoreSet);
    expect(contents).toHaveLength(2);
    expect(contents[0].semanticHash).toBe(contents[1].semanticHash);
    expect(test.acceptAllPlayerLeagueScore.mock.calls.map(([input]) => input.officialObservationId).sort())
      .toEqual([OBS_ONE, OBS_TWO, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd']);
    expect(new Set(test.pointers).size).toBe(1);
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
      .resolves.toMatchObject({ status: 'unavailable', reason: 'stage-failed', stage: 'shared-capture-persistence' });
    expect(persistence.pointers).toEqual([]);
  });

  it.each(['shadow', 'backfill'] as const)(
    'never accepts scores in %s for an existing unverified official identity',
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
      const result = await runAllPlayerIngestion(test.dependencies, { mode, period: PERIOD });
      expect(result).toMatchObject(mode === 'shadow'
        ? { status: 'completed', acceptedLeagues: 0, failedLeagues: 2 }
        : { status: 'unavailable', reason: 'identity-plan-conflict', persistedObservation: true });
      expect(test.acceptAllPlayerLeagueScore).not.toHaveBeenCalled();
      expect(test.pointers).toEqual([]);
      expect(test.allPlayerSource.load).toHaveBeenCalledOnce();
      if (mode === 'shadow') {
        expect(test.upsertScoringEntities).not.toHaveBeenCalled();
        expect(test.recordAllPlayerBatch).not.toHaveBeenCalled();
      } else expect(test.recordAllPlayerBatch).toHaveBeenCalledOnce();
    },
  );

  it('records fresh retrieval and acceptance lineage without copying unchanged score content', async () => {
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
    expect(new Set(test.pointers).size).toBe(1);
    expect(test.acceptAllPlayerLeagueScore.mock.calls.slice(2).map(([input]) => input.statObservationId))
      .toEqual([deterministicUuid('observation', 'etag:"week-1-corrected"'), deterministicUuid('observation', 'etag:"week-1-corrected"')]);
  });

  it('retains the shared capture while rejecting every league with unsupported active rules', async () => {
    const test = harness();
    const original = test.dependencies.loadLeagueWeek;
    test.dependencies = { ...test.dependencies, loadLeagueWeek: async (...args) => {
      const loaded = await original(...args);
      return { ...loaded, state: { ...loaded.state, scoringSettings: {
        ...loaded.state.scoringSettings, rawRules: { pass_td: 4, unreviewed_rule: 1 },
      } } };
    } };
    await expect(runAllPlayerIngestion(test.dependencies, { mode: 'backfill', period: PERIOD }))
      .resolves.toMatchObject({ status: 'completed', acceptedLeagues: 0, failedLeagues: 2,
        leagueOutcomes: expect.arrayContaining([expect.objectContaining({ reason: 'unsupported-active-scoring-rule' })]) });
    expect(test.allPlayerSource.load).toHaveBeenCalledOnce();
    expect(test.recordAllPlayerBatch).toHaveBeenCalledOnce();
    expect(test.acceptAllPlayerLeagueScore).not.toHaveBeenCalled();
    expect(test.dependencies.store.finishAllPlayerJob).toHaveBeenCalledWith(expect.objectContaining({
      scopedCapture: { statObservationId: expect.any(String) },
      diagnostic: expect.objectContaining({ acceptedLeagueCount: 0, failedLeagueCount: 2 }),
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
      .resolves.toMatchObject({ status: 'unavailable', reason: 'lease-lost', stage: 'shared-capture-persistence' });
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
      expect(result).toMatchObject({ status: 'completed',
        acceptedLeagues: validTo.startsWith('2026-09-16') ? 2 : 0,
        failedLeagues: validTo.startsWith('2026-09-16') ? 0 : 2 });
      expect(test.acceptAllPlayerLeagueScore).not.toHaveBeenCalled();
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
        .resolves.toMatchObject({ status: 'unavailable' });
      expect(test.acceptAllPlayerLeagueScore).not.toHaveBeenCalled();
      expect(test.recordLeagueWeekObservation).not.toHaveBeenCalled();
      expect(test.pointers).toEqual([]);
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

  it.each(['bad-time', 'bad-lineup'] as const)('rejects malformed official parent before league publication: %s', async (variant) => {
    const test = harness();
    const load = test.dependencies.loadLeagueWeek;
    test.dependencies = { ...test.dependencies, loadLeagueWeek: async (...args) => {
      const league = await load(...args);
      return { ...league, state: variant === 'bad-time' ? { ...league.state, observedAt: 'invalid' }
        : { ...league.state, lineup: { ...league.state.lineup, lineupRevision: 'invalid' } } } as typeof league;
    } };
    await expect(runAllPlayerIngestion(test.dependencies, { mode: 'backfill', period: PERIOD }))
      .resolves.toMatchObject({ status: 'completed', acceptedLeagues: 0, failedLeagues: 2 });
    expect(test.recordLeagueWeekObservation).not.toHaveBeenCalled();
    expect(test.recordAllPlayerBatch).toHaveBeenCalledOnce();
    expect(test.acceptAllPlayerLeagueScore).not.toHaveBeenCalled();
  });

  it.each(['lost', 'failed'] as const)('preserves confirmed publication evidence when outcome recording is %s', async (variant) => {
    const test = harness();
    if (variant === 'lost') vi.mocked(test.dependencies.store.finishAllPlayerJob).mockResolvedValueOnce(false);
    else vi.mocked(test.dependencies.store.finishAllPlayerJob).mockRejectedValueOnce(new Error('database unavailable'));
    const result = await runAllPlayerIngestion(test.dependencies, { mode: 'backfill', period: PERIOD });
    expect(result).toMatchObject({ status: 'unavailable', stage: 'durable-outcome',
      confirmedPublication: { statObservationId: expect.any(String),
        pointerOutcomes: ['advanced', 'advanced'], entryCount: 37, scoringProfileCount: 1 } });
    expect(test.pointers).toHaveLength(2);
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
