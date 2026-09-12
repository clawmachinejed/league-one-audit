import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { createProjectionStore, type ProjectionStore } from '../lib/projection-store';
import type { AllPlayerJobFence } from '../lib/projections/adapters/neon/contracts';
import type { AllPlayerStatObservation } from '../lib/projections/domain/all-player-statistics';
import { allPlayerStatSemanticHash } from '../lib/projections/adapters/neon/all-player-statistics';
import { loadFantasyPlayerCatalog } from '../lib/sleeper-player-catalog';
import { buildSleeperAllPlayerInventory, createSleeperAllPlayerStatSource }
  from '../lib/projections/adapters/sleeper/all-player-stats';
import { foundationFixture, loadFoundationFixtureCatalogPosition }
  from '../test-support/all-player-foundation-fixture';
import { ownerQuery, type IndependentDatabase } from './neon-integration-harness';

const TABLES = [
  'all_player_stat_contents', 'all_player_stat_entries', 'all_player_stat_observations',
  'all_player_score_sets', 'all_player_scores', 'all_player_score_verifications',
  'current_all_player_score_sets', 'scoring_entities', 'external_scoring_entity_ids',
  'nfl_games', 'external_game_ids', 'scoring_profiles', 'leagues', 'league_seasons',
  'league_source_connections', 'league_period_authorities',
  'league_week_observations', 'official_player_point_observations',
  'official_roster_point_observations', 'projection_jobs',
] as const;

/** Owner reads are deliberately outside the measured runtime request stream.
 * This helper runs only from the existing guarded, serial integration harness. */
export async function readAllPlayerPhysicalMeasurement() {
  return ownerQuery(`SELECT relation.relname,
    pg_relation_size(relation.oid)::text AS heap_bytes,
    pg_indexes_size(relation.oid)::text AS index_bytes,
    CASE WHEN relation.reltoastrelid = 0 THEN '0' ELSE
      pg_relation_size(relation.reltoastrelid)::text END AS toast_heap_bytes,
    CASE WHEN relation.reltoastrelid = 0 THEN '0' ELSE
      pg_indexes_size(relation.reltoastrelid)::text END AS toast_index_bytes,
    pg_total_relation_size(relation.oid)::text AS total_bytes
    FROM pg_class relation WHERE relation.relnamespace = 'public'::regnamespace
      AND relation.relkind = 'r' AND relation.relname = ANY($1::text[])
    ORDER BY relation.relname`, [TABLES]);
}

export function measuredAllPlayerStore(database: IndependentDatabase['database']) {
  const bytes = { statements: 0, sqlTextBytes: 0, parameterJsonBytes: 0,
    decodedResultJsonBytes: 0, statementWallTimeMs: 0 };
  const store = createProjectionStore({
    enabled: true,
    async query<Row extends Readonly<Record<string, unknown>>>(
      statement: string, parameters: readonly unknown[] = [],
    ): Promise<readonly Row[]> {
      bytes.statements += 1;
      bytes.sqlTextBytes += Buffer.byteLength(statement, 'utf8');
      bytes.parameterJsonBytes += Buffer.byteLength(JSON.stringify(parameters), 'utf8');
      const started = performance.now();
      const result = await database.query<Row>(statement, parameters);
      bytes.statementWallTimeMs += performance.now() - started;
      bytes.decodedResultJsonBytes += Buffer.byteLength(JSON.stringify(result), 'utf8');
      return result;
    },
  });
  return { store, snapshot: () => ({ ...bytes }) };
}

/** Captured incomplete evidence remains partial in every run. The synthetic stat
 * correction changes one numeric value only to measure immutable correction cost. */
export async function measureRetainedPartialHistory(input: Readonly<{
  store: ProjectionStore;
  fence: AllPlayerJobFence;
  transportSnapshot: () => Readonly<Record<string, number>>;
}>) {
  const catalog = await loadFantasyPlayerCatalog(loadFoundationFixtureCatalogPosition);
  const responseText = JSON.stringify(foundationFixture.weekly);
  const providerInboundBytesPerReplay = Buffer.byteLength(responseText, 'utf8');
  let providerReplayCount = 0;
  const initialPhysical = await readAllPlayerPhysicalMeasurement();
  const initialTransport = input.transportSnapshot();
  const registered = await input.store.upsertNflGames(foundationFixture.games.map((game) => ({
    key: game.nflGameId, provider: 'tank01', externalGameId: `retained-capacity:${game.nflGameId}`,
    ...foundationFixture.period, homeTeam: game.homeTeam, awayTeam: game.awayTeam,
    kickoffAt: game.kickoffAt,
  })));
  if (registered.kind !== 'stored') throw new Error('The guarded integration store is disabled.');
  const gameIds = new Map(registered.value.map((game) => [game.key, game.gameId]));
  const gamesByTeam = Object.fromEntries(foundationFixture.games.flatMap((game) => {
    const nflGameId = gameIds.get(game.nflGameId);
    if (!nflGameId) throw new Error('The isolated game identity was not registered.');
    return [[game.homeTeam, { nflGameId, phase: game.phase }],
      [game.awayTeam, { nflGameId, phase: game.phase }]];
  }));
  const observe = async (observedAt: string): Promise<AllPlayerStatObservation> => {
    const inventory = buildSleeperAllPlayerInventory({
      catalog: catalog.catalog, catalogComplete: catalog.complete,
      catalogRevision: catalog.sourceRevision!, gamesByTeam, byeTeamIds: [],
      rosteredPlayerIds: foundationFixture.leagues.flatMap((league) => league.rosters.flatMap((roster) => [
        ...roster.players, ...roster.starters, ...(roster.reserve ?? []), ...(roster.taxi ?? []),
      ])).filter((id) => id !== '0'),
      projectionPlayerIds: ['8063'], scheduleRevision: 'retained-canonical-week1',
      period: foundationFixture.period, observedAt,
      periodEligibilityEvidenceByPlayerId: foundationFixture.reviewedParticipation,
    });
    if (inventory.status !== 'available') throw new Error(`Retained inventory failed: ${inventory.reason}`);
    const result = await createSleeperAllPlayerStatSource({
      fetch: async () => { providerReplayCount += 1; return new Response(responseText); },
      now: () => new Date(observedAt),
    }).load({ season: 2026, week: 1, inventory: inventory.inventory,
      gamesByTeam, requireFinalCoverage: true });
    if (result.status !== 'available') throw new Error(`Retained response failed: ${result.reason}`);
    if (result.observation.quality !== 'partial' || result.observation.entries.length !== 4385) {
      throw new Error('The retained partial benchmark unexpectedly changed scope or completeness.');
    }
    return result.observation;
  };
  const counts = () => ownerQuery(`SELECT
    (SELECT count(*) FROM all_player_stat_contents)::integer AS contents,
    (SELECT count(*) FROM all_player_stat_entries)::integer AS entries,
    (SELECT count(*) FROM all_player_stat_observations)::integer AS observations,
    (SELECT count(*) FROM all_player_score_sets)::integer AS score_sets,
    (SELECT count(*) FROM all_player_scores)::integer AS scores,
    (SELECT count(*) FROM all_player_score_verifications)::integer AS verifications,
    (SELECT jsonb_agg(to_jsonb(pointer) ORDER BY pointer.scoring_profile_id)
      FROM current_all_player_score_sets pointer) AS pointers`);
  const scenarios: Record<string, unknown>[] = [];
  const write = async (scenario: string, observation: AllPlayerStatObservation) => {
    const before = { physical: await readAllPlayerPhysicalMeasurement(), counts: (await counts())[0],
      transport: input.transportSnapshot() };
    const result = await input.store.recordAllPlayerBatch({ observation, scoreSets: [],
      verifiedAt: observation.observedAt, fence: input.fence });
    if (result.kind !== 'stored') throw new Error('The guarded partial write was disabled.');
    const after = { physical: await readAllPlayerPhysicalMeasurement(), counts: (await counts())[0],
      transport: input.transportSnapshot() };
    if (JSON.stringify(before.counts.pointers) !== JSON.stringify(after.counts.pointers)
      || before.counts.scores !== after.counts.scores || before.counts.score_sets !== after.counts.score_sets) {
      throw new Error('Partial capacity evidence changed scores or current pointers.');
    }
    scenarios.push({ scenario, materialHash: allPlayerStatSemanticHash(observation),
      before, after, result: result.value });
    return result.value;
  };
  const first = await observe(foundationFixture.replayObservedAt);
  await write('actual-retained-partial-first', first);
  const replay = await write('exact-replay', first);
  if (replay.entriesStored !== 0) throw new Error('Exact replay copied raw entries.');
  const later = await observe('2026-09-13T02:54:37.000Z');
  if (allPlayerStatSemanticHash(first) !== allPlayerStatSemanticHash(later)) {
    throw new Error('Actual adapter rebuild manufactured changed raw material.');
  }
  const unchanged = await write('actual-adapter-later-unchanged', later);
  if (unchanged.entriesStored !== 0) throw new Error('Unchanged retrieval copied raw entries.');
  await write('synthetic-numeric-correction-of-retained-partial', { ...later,
    sourceRevision: `synthetic-correction:${createHash('sha256').update(responseText).digest('hex')}`,
    observedAt: '2026-09-13T02:55:37.000Z', requestStartedAt: '2026-09-13T02:55:37.000Z',
    requestCompletedAt: '2026-09-13T02:55:37.000Z',
    entries: later.entries.map((entry) => entry.providerExternalId === '5859'
      ? { ...entry, stats: { ...entry.stats, rec_yd: entry.stats.rec_yd + 1 } } : entry),
  });
  const result = { kind: 'retained-partial-capacity-measurement', measuredAt: new Date().toISOString(),
    sourcePeriod: foundationFixture.period,
    classification: 'actual retained incomplete observation; separately labelled synthetic numeric correction',
    initialPhysical, initialTransport, providerReplayCount, liveProviderRequests: 0,
    providerInboundBytesPerReplay, scenarios,
    transferScope: 'Locally replayed provider-body bytes, SQL UTF-8, parameter JSON and decoded result JSON; excludes original HTTP compression/headers and PostgreSQL/WebSocket/TLS framing/startup. These are not Neon-billed outbound measurements. Statement wall time includes network waits and is not compute usage.',
    remainingEvidence: ['legitimately complete period', 'complete shared/divergent profiles',
      'eligibility correction', 'identity additions', 'actual Neon outbound allowance accounting',
      'ordinary workload reserve', 'season horizon fit'],
  };
  await writeFile(new URL('../release/011-capacity.partial.integration.json', import.meta.url),
    `${JSON.stringify(result,null,2)}\n`);
  return result;
}
