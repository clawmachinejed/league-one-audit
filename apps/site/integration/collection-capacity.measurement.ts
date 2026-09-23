import type { DatabaseClient, DatabaseQueryOptions, DatabaseRow, DatabaseStatement } from '../lib/database';
import type { ProjectionStore } from '../lib/projection-store';
import { ownerQuery } from './neon-integration-harness';

export const CAPACITY_TABLES = [
  'all_player_stat_contents', 'all_player_stat_entries', 'all_player_stat_observations',
  'all_player_score_sets', 'all_player_scores', 'all_player_score_verifications',
  'current_all_player_score_sets', 'all_player_league_acceptances', 'current_all_player_league_scores',
  'scoring_entities', 'external_scoring_entity_ids', 'nfl_games', 'external_game_ids',
  'scoring_profiles', 'leagues', 'league_seasons', 'league_source_connections',
  'league_source_connection_history', 'league_administration_enrollments', 'league_administration_enrollment_seasons',
  'league_period_authorities', 'league_week_observations', 'league_week_expected_games', 'official_player_point_observations',
  'official_roster_point_observations', 'projection_jobs', 'projection_slate_contents',
  'projection_slate_entries', 'projection_slate_observations', 'current_projection_slates',
] as const;

export async function capacityPhysicalSnapshot() {
  const physical = await ownerQuery(`SELECT relation.relname,
    pg_relation_size(relation.oid)::text AS heap_bytes, pg_indexes_size(relation.oid)::text AS index_bytes,
    CASE WHEN relation.reltoastrelid=0 THEN '0' ELSE pg_relation_size(relation.reltoastrelid)::text END AS toast_heap_bytes,
    CASE WHEN relation.reltoastrelid=0 THEN '0' ELSE pg_indexes_size(relation.reltoastrelid)::text END AS toast_index_bytes,
    pg_total_relation_size(relation.oid)::text AS total_bytes
    FROM pg_class relation WHERE relation.relnamespace='public'::regnamespace AND relation.relkind='r'
    AND relation.relname=ANY($1::text[]) ORDER BY relation.relname`, [CAPACITY_TABLES]);
  if (physical.length !== CAPACITY_TABLES.length) throw new Error('Capacity physical inventory is incomplete');
  // Identifiers are a committed literal allowlist, never input/environment values.
  const counts = await ownerQuery(CAPACITY_TABLES.map(table => `SELECT '${table}' AS relation, count(*)::text AS rows FROM public.${table}`).join(' UNION ALL '));
  return { physical: physical.map(row => ({ relation: String(row.relname), heapBytes: Number(row.heap_bytes),
    indexBytes: Number(row.index_bytes), toastHeapBytes: Number(row.toast_heap_bytes),
    toastIndexBytes: Number(row.toast_index_bytes), totalBytes: Number(row.total_bytes) })),
  counts: Object.fromEntries(counts.map(row => [String(row.relation), Number(row.rows)])) as Record<string, number> };
}
export function capacityDelta(before: Awaited<ReturnType<typeof capacityPhysicalSnapshot>>, after: Awaited<ReturnType<typeof capacityPhysicalSnapshot>>) {
  const old = new Map(before.physical.map(row => [row.relation, row]));
  return { counts: Object.fromEntries(Object.entries(after.counts).map(([key, value]) => [key, value - before.counts[key]])),
    physical: after.physical.map(row => ({ relation: row.relation,
      heapBytes: row.heapBytes - old.get(row.relation)!.heapBytes, indexBytes: row.indexBytes - old.get(row.relation)!.indexBytes,
      toastHeapBytes: row.toastHeapBytes - old.get(row.relation)!.toastHeapBytes,
      toastIndexBytes: row.toastIndexBytes - old.get(row.relation)!.toastIndexBytes,
      totalBytes: row.totalBytes - old.get(row.relation)!.totalBytes })) };
}

export function capacityInstrumentation(database: DatabaseClient) {
  const transport = { requests: 0, statements: 0, sqlTextBytes: 0, parameterJsonBytes: 0,
    decodedResultJsonBytes: 0, summedRequestWallTimeMs: 0, maxInFlight: 0, failures: 0 };
  const pending = new Set<Promise<unknown>>();
  const stages: Record<string, { calls: number; failures: number; totalWallTimeMs: number; maxWallTimeMs: number;
    errors: Array<{ code: string | null; reason: string }> }> = {};
  const timed = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    const stage = stages[name] ??= { calls: 0, failures: 0, totalWallTimeMs: 0, maxWallTimeMs: 0, errors: [] };
    stage.calls += 1;
    const start = performance.now();
    try { return await fn(); }
    catch (error) {
      stage.failures += 1;
      const code = error !== null && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
        && /^[0-9A-Z]{5}$/u.test(error.code) ? error.code : null;
      // Only fixed reviewed SQL validation messages can enter artifacts; arbitrary
      // transport messages can contain connection details and must not be copied.
      const safeReasons = ['invalid league acceptance period or verification time',
        'shared all-player content is not acceptance eligible', 'league all-player parity is incomplete or mismatched',
        'league pointer conflict at equal observation time', 'all-player lease is no longer owned'];
      const message = error instanceof Error ? error.message : '';
      if (stage.errors.length < 8) stage.errors.push({ code, reason: safeReasons.includes(message) ? message : 'unclassified-error-redacted' });
      throw error;
    }
    finally { const duration = performance.now() - start; stage.totalWallTimeMs += duration; stage.maxWallTimeMs = Math.max(stage.maxWallTimeMs, duration); }
  };
  const measure = async <T>(statements: readonly DatabaseStatement[], fn: () => Promise<T>): Promise<T> => {
    transport.requests += 1; transport.statements += statements.length;
    for (const value of statements) {
      transport.sqlTextBytes += Buffer.byteLength(value.statement);
      transport.parameterJsonBytes += Buffer.byteLength(JSON.stringify(value.parameters));
    }
    const start = performance.now();
    const promise = fn(); pending.add(promise); transport.maxInFlight = Math.max(transport.maxInFlight, pending.size);
    try { const result = await promise; transport.decodedResultJsonBytes += Buffer.byteLength(JSON.stringify(result)); return result; }
    catch (error) { transport.failures += 1; throw error; }
    finally { pending.delete(promise); transport.summedRequestWallTimeMs += performance.now() - start; }
  };
  const measuredDatabase: DatabaseClient = { enabled: true,
    query<Row extends DatabaseRow>(statement: string, parameters: readonly unknown[] = [], options: DatabaseQueryOptions = {}) {
      return measure([{ statement, parameters }], () => database.query<Row>(statement, parameters, options));
    },
    queryAfterLock<Row extends DatabaseRow>(statement: string, parameters: readonly unknown[], lock: DatabaseStatement, options: DatabaseQueryOptions = {}) {
      if (!database.queryAfterLock) throw new Error('Capacity requires the production locked transaction transport');
      return measure([lock, { statement, parameters }], () => database.queryAfterLock!<Row>(statement, parameters, lock, options));
    },
  };
  const measuredStore = (store: ProjectionStore): ProjectionStore => new Proxy(store, {
    get(target, key) {
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? (...args: unknown[]) => timed(`store.${String(key)}`, () => Promise.resolve(Reflect.apply(value, target, args))) : value;
    },
  });
  return { database: measuredDatabase, measuredStore, timed, transport, stages,
    async drain() { await Promise.allSettled([...pending]); if (pending.size) throw new Error('Capacity runtime requests did not drain'); } };
}
