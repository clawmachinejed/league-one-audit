import { it, expect } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { cpus, platform, release, totalmem } from 'node:os';
import { neonConfig } from '@neondatabase/serverless';
import { createDatabase, withDatabaseAbortSignal } from '../lib/database';
import { createProjectionStore } from '../lib/projection-store';
import { createLeagueAdministrationStore } from '../lib/league-administration/store';
import { loadIsolatedAdministrationRegistry } from '../lib/league-administration/registry';
import { createNeonProjectionRepository } from '../lib/projections/adapters/neon/repository';
import { createSleeperAllPlayerStatSource } from '../lib/projections/adapters/sleeper/all-player-stats';
import { normalizeSleeperScoringProfile } from '../lib/projections/adapters/sleeper/scoring-profile';
import { runAllPlayerIngestion, type AllPlayerIngestionResult } from '../lib/projections/runtime/all-player-operation';
import { NFL_TEAM_CODES } from '../lib/projections/domain/contracts';
import { providerKey } from '../lib/projections/shared/provider-identity';
import { enrollIntegrationSeason } from './administration-enrollment-fixture';
import { integrationEnvironment, ownerQuery } from './neon-integration-harness';
import { capacityCatalog, capacityStats, capacityRules, capacitySchedule, capacityProjectionSlate,
  capacityLeagueFixture, CAPACITY_INVENTORY_SIZE } from './collection-capacity.fixtures';
import { capacityInstrumentation, capacityPhysicalSnapshot, capacityDelta } from './collection-capacity.measurement';

const provider = { officialProvider: providerKey('sleeper'), projectionProvider: providerKey('tank01'),
  gameStateProvider: providerKey('tank01'), normalizerVersion: 'synthetic-capacity-v1' };
const ladder = [3, 8, 16, 32] as const;
const sampleKinds = ['first-at-level', 'unchanged', 'changed'] as const;
const nowIso = () => new Date().toISOString();
const unwrap = <T>(value: { kind: 'stored'; value: T } | { kind: 'disabled' }): T => {
  if (value.kind !== 'stored') throw new Error('Capacity requires enabled persistence');
  return value.value;
};

it('measures bounded canonical collection against an isolated Neon database', async () => {
  const environment = integrationEnvironment();
  const output = process.env.COLLECTION_CAPACITY_OUTPUT;
  if (!output) throw new Error('Capacity output path missing');
  const scope = process.env.COLLECTION_CAPACITY_SCOPE ?? 'ladder';
  if (!['ladder', 'probe', 'distinct'].includes(scope)) throw new Error('Invalid collection capacity scope');
  const database = createDatabase(environment.runtimeDatabaseUrl);
  if (!database.enabled) throw new Error('Capacity runtime database disabled');
  const identity = await database.query<{ database: string; role: string }>('SELECT current_database() AS database,current_user AS role');
  expect(identity).toEqual([{ database: environment.expectedDatabase, role: 'league_one_runtime' }]);
  const originalFetch = globalThis.fetch;
  const runtimeUrl = new URL(environment.runtimeDatabaseUrl);
  const permittedEndpoint = new URL(typeof neonConfig.fetchEndpoint === 'function'
    ? neonConfig.fetchEndpoint(runtimeUrl.hostname, runtimeUrl.port || 5432, { jwtAuth: false }) : neonConfig.fetchEndpoint);
  let deniedNetworkRequests = 0;
  globalThis.fetch = ((input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    if (url.protocol !== 'https:' || url.href !== permittedEndpoint.href
      || headers.get('Neon-Connection-String') !== environment.runtimeDatabaseUrl) {
      deniedNetworkRequests += 1;
      return Promise.reject(new Error('capacity-non-neon-network-denied'));
    }
    return originalFetch(input, init);
  }) as typeof fetch;
  const store = createProjectionStore(database);
  const repository = createNeonProjectionRepository(store, provider);
  const started = performance.now();
  const sourceFiles = ['lib/projections/runtime/all-player-operation.ts', 'lib/projections/adapters/neon/all-player-statistics.ts',
    'integration/collection-capacity.capacity-case.ts', 'integration/collection-capacity.fixtures.ts',
    'integration/collection-capacity.measurement.ts', 'test-support/fixtures/sleeper-capability-settings.json'];
  const git = (args: string[]) => execFileSync('git', args, { encoding: 'utf8', windowsHide: true }).trim();
  const source = { gitSha: git(['rev-parse', 'HEAD']), dirtyStatus: git(['status', '--porcelain']),
    sha256: Object.fromEntries(await Promise.all(sourceFiles.map(async path => [path,
      createHash('sha256').update(await readFile(path)).digest('hex')]))), nodeVersion: process.version,
    lab: { platform: platform(), release: release(), architecture: process.arch, cpuModel: cpus()[0]?.model,
      logicalCpuCount: cpus().length, physicalMemoryBytes: totalmem() } };
  const setup: Record<string, unknown>[] = [];
  const samples: Record<string, unknown>[] = [];
  const stops: Record<string, unknown>[] = [];
  const report = { kind: 'collection-capacity-current-path-v1', classification: 'synthetic provider replay with real isolated Neon HTTP runtime writes',
    generatedAt: nowIso(), scope, source, inventoryEntities: CAPACITY_INVENTORY_SIZE, ladder,
    runtime: { executionMs: 50_000, leaseSeconds: 55, leagueConcurrency: 8, leagueSourceTimeoutMs: 8_000 },
    fixture: { rosterShapes: ['12 teams x14 players (9 starters,5 bench)', '10 teams x20 players (9 starters,11 bench)'],
      allocation: 'Alternating standard and dynasty roster populations; all rostered entities have official player and starter-total parity.',
      profileLanes: ['one shared scoring profile', 'one unique scoring profile per league'],
      provenance: 'Wholly synthetic final games, inventory, statistics and official points. 4,353 synthetic fantasy players plus32 defenses; cardinality/payload stress, not an actual NFL participation distribution.' },
    cadence: 'Owner removes only the isolated synthetic job between independent samples. Request schedule clock is the existing in-window integration fixture; real database lease and deadline clocks are unchanged. This measures individual capacity, not real polling cadence or request-budget throughput.',
    historyWarmup: 'First capture establishes earliest retained team context. A separately measured second capture at the first level of each lane includes that new history context. Unchanged-content reuse is required on the third capture after the retained context stabilizes.',
    transportScope: 'SQL UTF-8, parameter JSON and decoded result JSON. Excludes wire framing, TLS/HTTP headers/compression, setup and owner measurement queries. These bytes are not Neon billing. Summed concurrent query/stage times are not additive operation wall time or compute usage.',
    limitations: ['Local Node client to isolated Neon; not Vercel CPU/network or production compute configuration.',
      'Replay provider latency is zero except explicitly injected slow league; live provider rate limits and latency are unmeasured.',
      'Three captures per tested level are descriptive samples, not percentile/SLO evidence.',
      'Official fixture points are generated by the canonical scorer; this measures parity workload, not independent arithmetic correctness.',
      'Cold means first capture at a level; earlier ladder levels warm shared identities/database pages.',
      'No production traffic load, season-horizon storage fit, durable retry fairness or broader onboarding claim.'],
    setup, samples, stops, completion: 'in-progress', deniedNetworkRequests: 0, totalWallTimeMs: 0 };
  const save = async () => {
    report.deniedNetworkRequests = deniedNetworkRequests; report.totalWallTimeMs = performance.now() - started;
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  };
  let sequence = 0;
  let correction = 0;
  const periods = { shared: { season: 2188, seasonType: 'regular' as const, week: 1 },
    distinct: { season: 2189, seasonType: 'regular' as const, week: 1 },
    mixed: { season: 2190, seasonType: 'regular' as const, week: 1 } };
  const seeded = new Map<string, number>();
  const kickoffAt = new Date(Date.now() - 86_400_000).toISOString();
  const schedule = capacitySchedule(kickoffAt);
  const leagueKey = (lane: string, index: number) => `capacity-${lane}-${String(index).padStart(3, '0')}`;
  const setupPeriod = async (lane: keyof typeof periods) => {
    const begin = performance.now();
    const period = periods[lane];
    const identities = unwrap(await store.upsertScoringEntities([
      ...Object.entries(capacityCatalog).map(([id, player]) => ({ key: id, kind: 'player' as const,
        displayName: player.full_name!, nflTeam: player.team!,
        providerIds: [{ provider: 'sleeper', externalId: id }, { provider: 'tank01', externalId: `tank-${id}` }] })),
      ...NFL_TEAM_CODES.map(team => ({ key: team, kind: 'team_defense' as const, displayName: team, nflTeam: team,
        providerIds: [{ provider: 'sleeper', externalId: team }] })),
    ]));
    if (identities.length !== CAPACITY_INVENTORY_SIZE || identities.some(row => row.conflict || !row.entityId)) {
      throw new Error('Synthetic shared identity preparation failed');
    }
    const games = Array.from({ length: 16 }, (_, index) => ({ key: `capacity-${period.season}-${index}`, provider: 'tank01',
      externalGameId: `capacity-${period.season}-${index}`, season: period.season, seasonType: 'reg' as const, week: 1,
      homeTeam: NFL_TEAM_CODES[index * 2], awayTeam: NFL_TEAM_CODES[index * 2 + 1], kickoffAt }));
    unwrap(await store.upsertNflGames(games));
    const observedAt = nowIso();
    unwrap(await store.recordGameStates({ provider: 'tank01', states: games.map(game => ({ externalGameId: game.externalGameId,
      sourceRevision: game.externalGameId, requestStartedAt: observedAt, requestCompletedAt: observedAt, observedAt,
      statusCode: 2, period: 'Final', gameClock: '0:00', homeScore: 21, awayScore: 14, sourceData: { synthetic: true } })) }));
    unwrap(await repository.recordProjectionSlate(capacityProjectionSlate(period, observedAt)));
    setup.push({ lane, stage: 'shared-game-and-projection-fixture', wallTimeMs: performance.now() - begin });
  };
  const registerThrough = async (lane: keyof typeof periods, count: number) => {
    const begin = performance.now();
    const period = periods[lane];
    const first = seeded.get(lane) ?? 0;
    for (let chunk = first; chunk < count; chunk += 8) await Promise.all(Array.from({ length: Math.min(8, count - chunk) }, async (_, offset) => {
      const index = chunk + offset; const key = leagueKey(lane, index);
      unwrap(await store.registerLeagueSeason({ leagueKey: key, leagueName: key, season: period.season,
        sleeperLeagueId: key, scoringRules: capacityRules(index, lane === 'distinct') }));
    }));
    await enrollIntegrationSeason(ownerQuery, Array.from({ length: count }, (_, index) => leagueKey(lane, index)), period.season);
    // Current acceptance verifies the stored expected official roster population.
    await ownerQuery(`INSERT INTO league_period_authorities (
      league_key,default_season,default_season_type,default_week,active_season,active_season_type,active_week,
      league_lifecycle,nfl_phase,source_provider,source_revision,source_observed_at,verified_at,
      source_external_league_id,expected_roster_count,expected_starter_slot_count,expected_roster_ids)
      SELECT value->>'key',$1::smallint,'reg',1,$1::smallint,'reg',1,'active','regular','sleeper','synthetic-capacity',now(),now(),
        value->>'key',(value->>'teams')::integer,9,ARRAY(SELECT jsonb_array_elements_text(value->'rosters'))
      FROM jsonb_array_elements($2::jsonb) ON CONFLICT(league_key) DO NOTHING`, [period.season,
      JSON.stringify(Array.from({ length: count }, (_, index) => ({ key: leagueKey(lane, index), teams: index % 2 ? 10 : 12,
        rosters: Array.from({ length: index % 2 ? 10 : 12 }, (_, roster) => String(roster + 1)) })))]);
    seeded.set(lane, count);
    setup.push({ lane, stage: 'league-registration-fixture', addedLeagues: count - first, wallTimeMs: performance.now() - begin });
  };
  const sample = async (lane: keyof typeof periods, count: number, kind: string, mixed = false) => {
    sequence += 1;
    if (kind === 'changed' || mixed) correction += 1;
    const prepareStarted = performance.now();
    // Existing guards establish an empty isolated DB and the supervisor excludes concurrent tests.
    // Never alter a still-running sample's fence or extend its deadline.
    const previous = await ownerQuery<{ active: boolean; worker: string | null }>(`SELECT state='running' AND lease_until>clock_timestamp() AS active,
      lease_owner AS worker FROM projection_jobs WHERE job_key='all-player-ingestion:sleeper'`);
    if (previous.some(row => row.active)) throw new Error('Capacity refuses to reset a still-running lease');
    await ownerQuery("DELETE FROM projection_jobs WHERE job_key='all-player-ingestion:sleeper'");
    const stats = capacityStats(correction);
    const body = JSON.stringify(stats);
    const bodyHash = createHash('sha256').update(body).digest('hex');
    const before = await capacityPhysicalSnapshot();
    const readPointers = () => ownerQuery<{ league_key: string; acceptance_id: string }>(`SELECT league.league_key,pointer.acceptance_id::text
      FROM current_all_player_league_scores pointer JOIN league_seasons season ON season.id=pointer.league_season_id
      JOIN leagues league ON league.id=season.league_id WHERE pointer.season=$1 ORDER BY league.league_key`, [periods[lane].season]);
    const pointersBefore = await readPointers();
    const measurement = capacityInstrumentation(database);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 50_000);
    const runtimeStore = measurement.measuredStore(createProjectionStore(withDatabaseAbortSignal(measurement.database, controller.signal)));
    const cleanupStore = measurement.measuredStore(createProjectionStore(withDatabaseAbortSignal(measurement.database, AbortSignal.timeout(54_000))));
    const runtimeRepository = createNeonProjectionRepository(runtimeStore, provider);
    let providerReplayCalls = 0;
    let leagueReplayCalls = 0;
    let activeLeagueLoads = 0;
    let maxActiveLeagueLoads = 0;
    const replay = createSleeperAllPlayerStatSource({ now: () => new Date(), fetch: async () => {
      providerReplayCalls += 1;
      return new Response(body, { status: 200, headers: { etag: `"synthetic-capacity-${bodyHash}"` } });
    } });
    const period = periods[lane];
    const observedAt = nowIso();
    const memoryBefore = process.memoryUsage();
    let peakRssBytes = memoryBefore.rss;
    const memoryTimer = setInterval(() => { peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss); }, 250);
    memoryTimer.unref();
    const startedOperation = performance.now();
    let result: AllPlayerIngestionResult;
    try {
      const deadlineAt = new Date(Date.now() + 50_000).toISOString();
      const registry = await measurement.timed('registry', () => loadIsolatedAdministrationRegistry(
        createLeagueAdministrationStore(withDatabaseAbortSignal(measurement.database, controller.signal)), period.season));
      expect(registry.listActiveLeagues()).toHaveLength(count);
      result = await runAllPlayerIngestion({
        ...provider, store: runtimeStore, cleanupStore, deadlineAt, signal: controller.signal,
        leagueRegistry: registry, projectionRepository: runtimeRepository,
        clock: { now: () => new Date(), monotonicNow: () => performance.now() },
        idGenerator: { generate: () => `capacity-${randomUUID()}` }, logger: { write: () => undefined },
        normalizeScoringProfile: normalizeSleeperScoringProfile,
        loadSchedule: () => measurement.timed('replay.schedule', async () => schedule),
        loadCatalog: () => measurement.timed('replay.catalog', async () => ({ catalog: capacityCatalog, complete: true,
          sourceRevision: 'synthetic-capacity-catalog-v1', observedAt })),
        loadReviewedPeriodEvidence: async () => ({ inventory: { source: 'manual-review',
          sourceRevision: `synthetic-capacity-period-${period.season}`, observedAt: kickoffAt,
          effectivePeriod: { ...period, seasonType: 'reg' }, excludedPlayerReasons: {},
          teamsByPlayerId: Object.fromEntries(Object.entries(capacityCatalog).map(([id, player]) => [id, player.team!])) } }),
        allPlayerSource: { access: 'replay', load: request => measurement.timed('replay.weekly-stat-normalizer', () => replay.load(request)) },
        loadLeagueWeek: configuration => measurement.timed('replay.league', async () => {
          leagueReplayCalls += 1; activeLeagueLoads += 1; maxActiveLeagueLoads = Math.max(maxActiveLeagueLoads, activeLeagueLoads);
          const index = Number(configuration.key.split('-').at(-1));
          try {
            if (mixed && index === 0) await new Promise<void>(resolve => setTimeout(resolve, 8_100));
            return capacityLeagueFixture({ configuration, period, schedule, rules: capacityRules(index, lane === 'distinct'),
              stats, observedAt: nowIso(), dynasty: index % 2 === 1, parityFailure: mixed && index === 1 });
          } finally { activeLeagueLoads -= 1; }
        }),
      }, { mode: 'backfill', period, requireFinalCoverage: true });
    } finally { clearTimeout(timeout); controller.abort(); await measurement.drain(); clearInterval(memoryTimer); }
    const operationWallTimeMs = performance.now() - startedOperation;
    const memoryAfter = process.memoryUsage();
    peakRssBytes = Math.max(peakRssBytes, memoryAfter.rss);
    // A timed-out replay wait cannot make DB writes. Drain its short local timer for stable counters.
    if (activeLeagueLoads) await new Promise(resolve => setTimeout(resolve, 150));
    const after = await capacityPhysicalSnapshot();
    const pointersAfter = await readPointers();
    const delta = capacityDelta(before, after);
    const observationId = 'statObservationId' in result ? result.statObservationId : null;
    const materialEvidence = observationId ? await ownerQuery(`SELECT content.semantic_hash,
      content.coverage->>'expectedInventoryFingerprint' AS inventory_fingerprint,
      content.coverage->>'historicalTeamContextFingerprint' AS history_fingerprint,
      observation.source_revision,observation.observed_at::text
      FROM all_player_stat_observations observation JOIN all_player_stat_contents content
      ON content.id=observation.all_player_stat_content_id WHERE observation.id=$1::uuid`, [observationId]) : [];
    const acceptanceDiagnostics = result.status === 'completed' && result.acceptedLeagues === 0
      ? await ownerQuery(`SELECT league.league_key, observation.source_data->'officialPlayersPointsEvidence'->>'fingerprint' AS expected_fingerprint,
          ('sha256:' || encode(digest(convert_to(string_agg(mapping.external_id || chr(31) || point.points::text,
            chr(10) ORDER BY mapping.external_id),'UTF8'),'sha256'),'hex')) AS physical_fingerprint,
          count(*)::integer AS player_count,
          count(*) FILTER (WHERE score.scoring_entity_id IS NULL OR abs(score.fantasy_points-point.points)>0.0001)::integer AS mismatch_count
        FROM league_week_observations observation JOIN league_seasons season ON season.id=observation.league_season_id
        JOIN leagues league ON league.id=season.league_id
        JOIN official_player_point_observations point ON point.league_week_observation_id=observation.id
        JOIN external_scoring_entity_ids mapping ON mapping.scoring_entity_id=point.scoring_entity_id AND mapping.provider='sleeper'
        LEFT JOIN all_player_score_sets score_set ON score_set.scoring_profile_id=season.scoring_profile_id AND score_set.season=season.season
        LEFT JOIN all_player_scores score ON score.all_player_score_set_id=score_set.id AND score.scoring_entity_id=point.scoring_entity_id
        WHERE season.season=$1 GROUP BY league.league_key,observation.id ORDER BY league.league_key`, [period.season]) : [];
    const expectedAccepted = count - (mixed ? 2 : 0);
    const expectedParityRows = Array.from({ length: count }, (_, index) => mixed && index < 2 ? 0 : index % 2 ? 200 : 168)
      .reduce<number>((sum, value) => sum + value, 0);
    const invariants = {
      sharedProviderReadOnce: providerReplayCalls === 1,
      completeInventory: result.status === 'completed' && result.entryCount === CAPACITY_INVENTORY_SIZE,
      expectedAcceptedLeagues: result.status === 'completed' && result.acceptedLeagues === expectedAccepted,
      expectedFailedLeagues: result.status === 'completed' && result.failedLeagues === (mixed ? 3 : 0),
      fullRosterParity: result.status === 'completed' && result.parityComparisonCount === expectedParityRows,
      profileDeduplication: result.status === 'completed' && result.scoringProfileCount === (lane === 'distinct' ? expectedAccepted : 1),
      profileWritesOnce: measurement.stages['store.recordAllPlayerScoreContent']?.calls === (lane === 'distinct' ? expectedAccepted : 1),
      independentAcceptCalls: measurement.stages['store.acceptAllPlayerLeagueScore']?.calls === expectedAccepted,
      boundedLeagueConcurrency: maxActiveLeagueLoads <= 8 && activeLeagueLoads === 0,
      unchangedContentReuse: kind !== 'unchanged' || ['all_player_stat_contents', 'all_player_stat_entries', 'all_player_score_sets', 'all_player_scores'].every(table => delta.counts[table] === 0),
      failedPeersKeepLastGood: !mixed || [0, 1].every(index => {
        const key = leagueKey(lane, index);
        const before = pointersBefore.find(row => row.league_key === key);
        return Boolean(before && pointersAfter.find(row => row.league_key === key)?.acceptance_id === before.acceptance_id);
      }),
      missingRegistrationNeverPublished: !mixed || !pointersAfter.some(row => row.league_key === 'capacity-mixed-missing'),
      healthyPeersAdvance: !mixed || pointersAfter.filter(row => ![leagueKey(lane, 0), leagueKey(lane, 1)].includes(row.league_key))
        .every(row => pointersBefore.find(before => before.league_key === row.league_key)?.acceptance_id !== row.acceptance_id),
      noUnexpectedNetwork: deniedNetworkRequests === 0,
    };
    const sampleReport = { sequence, lane, kind, leagueCount: count, intendedLeagueCount: count + (mixed ? 1 : 0),
      expectedProfileCount: lane === 'distinct' ? count : 1, preparationWallTimeMs: startedOperation - prepareStarted,
      operationWallTimeMs, budgetHeadroomMs: 50_000 - operationWallTimeMs,
      memory: { before: memoryBefore, after: memoryAfter, sampledPeakRssBytes: peakRssBytes,
        samplingMs: 250, scope: 'This local Node/Vitest process only, including its loaded fixture; not Vercel memory capacity.' },
      providerReplayCalls, leagueReplayCalls, maxActiveLeagueLoads,
      replayProviderBodyBytes: Buffer.byteLength(body) * providerReplayCalls,
      transport: { ...measurement.transport }, stages: structuredClone(measurement.stages),
      result, invariants, materialEvidence, providerBodySha256: bodyHash,
      acceptanceDiagnostics, pointersBefore, pointersAfter, before, after, delta };
    samples.push(sampleReport); await save();
    process.stdout.write(`${JSON.stringify({ kind: 'collection-capacity-sample', lane, sample: kind, leagues: count,
      operationWallTimeMs, status: result.status, accepted: result.status === 'completed' ? result.acceptedLeagues : null,
      allInvariants: Object.values(invariants).every(Boolean) })}\n`);
    return { result, invariants, operationWallTimeMs };
  };
  try {
    await save();
    if (scope === 'probe') {
      await setupPeriod('shared'); await registerThrough('shared', 3);
      const probe = await sample('shared', 3, 'first-at-level');
      report.completion = 'probe-measured'; await save();
      expect(Object.values(probe.invariants).every(Boolean)).toBe(true);
      return;
    }
    const qualified = new Map<string, number>();
    const lanes = scope === 'distinct' ? ['distinct'] as const : ['shared', 'distinct'] as const;
    for (const lane of lanes) {
      await setupPeriod(lane);
      for (const count of ladder) {
        // Reserve time for the separate baseline +8-second failure qualification.
        if (performance.now() - started > 360_000) { stops.push({ lane, count, reason: 'bounded-measurement-time-budget' }); break; }
        await registerThrough(lane, count);
        let successfulLevel = true;
        const kinds = count === ladder[0] ? ['first-at-level', 'history-context-warmup', 'unchanged', 'changed'] : sampleKinds;
        for (const kind of kinds) {
          const current = await sample(lane, count, kind);
          const invariantFailure = !Object.values(current.invariants).every(Boolean);
          if (invariantFailure && current.operationWallTimeMs <= 40_000) {
            throw new Error(`Capacity fixture/runtime invariant failed in ${lane}/${count}/${kind}; inspect saved report`);
          }
          if (invariantFailure || current.operationWallTimeMs > 40_000) {
            stops.push({ lane, count, kind, reason: current.operationWallTimeMs > 40_000 ? 'under-ten-seconds-headroom' : 'operation-or-invariant-failed' });
            successfulLevel = false; break;
          }
        }
        if (!successfulLevel) break;
        qualified.set(lane, count);
      }
    }
    if (scope !== 'distinct') expect(qualified.get('shared') ?? 0).toBeGreaterThanOrEqual(3);
    expect(qualified.get('distinct') ?? 0).toBeGreaterThanOrEqual(3);
    // Separate three-league cohort prevents an overloaded ladder boundary from obscuring isolation.
    if (scope === 'distinct') {
      stops.push({ lane: 'mixed-failure', reason: 'not-repeated-in-distinct-lane-extension; use separately qualified main-run evidence' });
    } else if (performance.now() - started < 480_000) {
      await setupPeriod('mixed'); await registerThrough('mixed', 3);
      const baseline = await sample('mixed', 3, 'baseline');
      expect(Object.values(baseline.invariants).every(Boolean)).toBe(true);
      await ownerQuery("INSERT INTO leagues(league_key,name) VALUES('capacity-mixed-missing','Synthetic missing registration')");
      await enrollIntegrationSeason(ownerQuery, ['capacity-mixed-missing'], periods.mixed.season);
      const failure = await sample('mixed', 3, 'slow-parity-and-registration-peers', true);
      expect(Object.values(failure.invariants).every(Boolean)).toBe(true);
    } else throw new Error('Capacity bounded time budget left mixed failure qualification unmeasured');
    report.completion = 'measured';
    await save();
    expect(deniedNetworkRequests).toBe(0);
    expect(samples.length).toBeGreaterThan(0);
  } catch (error) {
    report.completion = 'harness-failed'; await save(); throw error;
  } finally { globalThis.fetch = originalFetch; }
});
