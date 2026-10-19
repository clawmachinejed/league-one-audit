import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { DatabaseClient } from '../lib/database';

export const READER_SNAPSHOT_LIMITS = Object.freeze({ rowsPerTable: 200_000, pageRows: 512, maximumMs: 60_000, cleanupMs: 10_000, statementMs: 10_000 });
const stages = ['connect', 'begin', 'timeout', 'inventory', 'count', 'declare', 'fetch', 'cursor-close', 'size', 'rollback', 'close'] as const;
export type ReaderSnapshotDiagnostic = { stage: typeof stages[number]; table: string | null; code: string | null };
type SnapshotConnection = { database: Pick<DatabaseClient, 'query'>; close(): Promise<void> };
type SnapshotResult = { digest: string; counts: { table: string; rows: number; totalBytes: number }[]; storage?: StoragePhaseEvidence };
const tableName = /^[a-z][a-z0-9_]+$/u;
const sqlStates = new Set(['53200', '57014', '08000', '08001', '08003', '08006', '08007', '08P01', '57P01', '57P02', '57P03', '42501', '42P01', '42725']);
export function validReaderSnapshotDiagnostic(value: unknown): value is ReaderSnapshotDiagnostic {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return Object.keys(item).sort().join(',') === 'code,stage,table'
    && stages.includes(item.stage as typeof stages[number])
    && (item.table === null || typeof item.table === 'string' && item.table.length <= 63 && tableName.test(item.table))
    && (item.code === null || typeof item.code === 'string' && sqlStates.has(item.code));
}
export class ReaderStateSnapshotError extends Error {
  readonly diagnostic: ReaderSnapshotDiagnostic;
  readonly cleanupFailures: ReaderSnapshotDiagnostic[] = [];
  constructor(stage: ReaderSnapshotDiagnostic['stage'], table: string | null, error?: unknown) {
    super('CP27 stored-state snapshot failed at ' + stage + (table === null ? '' : ' for ' + table) + '.');
    this.name = 'ReaderStateSnapshotError';
    let code: unknown = null;
    try { if (error && typeof error === 'object') code = Object.getOwnPropertyDescriptor(error, 'code')?.value; }
    catch { /* Hostile error objects cannot escape sanitized diagnostics. */ }
    this.diagnostic = { stage, table, code: typeof code === 'string' && sqlStates.has(code) ? code : null };
  }
}
const hash = (algorithm: string, value: string) => createHash(algorithm).update(value).digest('hex');

/** Test-only complete multiset snapshot. One pinned, read-only MVCC transaction
 * retains the old md5(sorted row-md5 concatenation) oracle without a server sort
 * or string_agg. The cap fails closed; it never truncates or deduplicates rows.
 * 200,000 hashes bound retained raw text to 6.4 MB/table plus bounded JS overhead.
 * Caller/server deadlines bound waiting; they do not prove remote cancellation. */
export async function readReaderStateSnapshot(connect: () => Promise<SnapshotConnection>, maximumMs: number = READER_SNAPSHOT_LIMITS.maximumMs, storage?: StorageSnapshotOptions): Promise<SnapshotResult> {
  const started = performance.now(), budget = Math.min(maximumMs, READER_SNAPSHOT_LIMITS.maximumMs);
  if (!Number.isFinite(budget) || budget <= READER_SNAPSHOT_LIMITS.cleanupMs) throw new ReaderStateSnapshotError('timeout', null);
  const deadline = started + budget, workDeadline = deadline - READER_SNAPSHOT_LIMITS.cleanupMs;
  let connection: SnapshotConnection | undefined, transaction = false, currentStage: ReaderSnapshotDiagnostic['stage'] = 'connect';
  let currentTable: string | null = null, failure: ReaderStateSnapshotError | undefined, result: SnapshotResult | undefined;
  async function bounded<T>(operation: () => Promise<T>, stage: ReaderSnapshotDiagnostic['stage'], until = workDeadline): Promise<T> {
    currentStage = stage;
    const remaining = until - performance.now();
    if (remaining <= 0) throw new ReaderStateSnapshotError(stage, currentTable);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([Promise.resolve().then(operation), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new ReaderStateSnapshotError(stage, currentTable)), remaining);
      })]);
    } catch (error) { throw error instanceof ReaderStateSnapshotError ? error : new ReaderStateSnapshotError(stage, currentTable, error); }
    finally { if (timer) clearTimeout(timer); }
  }
  const query = (stage: ReaderSnapshotDiagnostic['stage'], sql: string, parameters: readonly unknown[] = []) =>
    bounded(() => connection!.database.query(sql, parameters), stage);
  try {
    let abandoned = false;
    const pending = Promise.resolve().then(connect).then(async value => {
      if (abandoned) { try { await value.close(); } catch { /* Snapshot is already failed; supervisor still owns cleanup. */ } }
      return value;
    });
    try { connection = await bounded(() => pending, 'connect'); } catch (error) { abandoned = true; throw error; }
    transaction = true;
    await query('begin', 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await query('timeout', `SET LOCAL statement_timeout = '${READER_SNAPSHOT_LIMITS.statementMs}ms'`);
    if (storage) await query('timeout', `SET LOCAL lock_timeout = '2000ms'`);
    const names = await query('inventory', storage ? STORAGE_INVENTORY_SQL : `SELECT tablename FROM pg_tables WHERE schemaname='public'
      AND (tablename LIKE 'league_%' OR tablename LIKE 'public_data_%' OR tablename IN ('leagues','projection_jobs')) ORDER BY tablename`);
    if (!names.length) throw new ReaderStateSnapshotError('inventory', null);
    if (storage) { assert(names.every(row => row.relkind === 'r'), 'CP28 unexpected relation kind.'); }
    if (storage) assert.deepEqual(names.map(row => String(row.schemaname) + '.' + String(row.tablename)).sort(), STORAGE_RELATIONS.map(row => row.schema + '.' + row.table).sort(), 'CP28 physical relation inventory drift.');
    const metadataDigest = storage ? hash('sha256', JSON.stringify(names.map(({ database_bytes: _bytes, ...row }) => { void _bytes; return row; }))) : '';
    if (storage && storageMetadata.has(storage.history)) assert.equal(metadataDigest, storageMetadata.get(storage.history), 'CP28 schema metadata changed.');
    const storageRows: StorageRelationEvidence[] = [], nextHistory = new Map<string, string[]>();
    let totalRows = 0;
    const seen = new Set<string>(), records: { table: string; rows: number; digest: string }[] = [], counts: SnapshotResult['counts'] = [];
    for (const name of names) {
      if (typeof name.tablename !== 'string' || name.tablename.length > 63 || !(storage ? /^[a-zA-Z][a-zA-Z0-9_]*$/u : tableName).test(name.tablename) || seen.has(name.tablename))
        throw new ReaderStateSnapshotError('inventory', null);
      const table = storage ? String(name.schemaname) + '.' + name.tablename : name.tablename; seen.add(table); currentTable = name.tablename;
      const relation = storage ? STORAGE_RELATIONS.find(row => row.schema + '.' + row.table === table)! : undefined;
      const qualified = storage ? '"' + relation!.schema + '"."' + relation!.table + '"' : 'public.' + table;
      const counted = await query('count', `SELECT count(*)::text AS rows FROM ${qualified}`);
      if (counted.length !== 1 || typeof counted[0].rows !== 'string' || !/^(?:0|[1-9][0-9]*)$/u.test(counted[0].rows)) throw new ReaderStateSnapshotError('count', table);
      const rows = Number(counted[0].rows);
      if (!Number.isSafeInteger(rows) || rows > READER_SNAPSHOT_LIMITS.rowsPerTable) throw new ReaderStateSnapshotError('count', table);
      totalRows += rows; if (storage) assert(totalRows <= 1_000_000, 'CP28 total row bound.');
      await query('declare', `DECLARE cp27_state_rows NO SCROLL CURSOR FOR SELECT md5(to_jsonb(row)::text) AS digest${storage ? ', pg_column_size(row)::text AS tuple_bytes, octet_length(to_jsonb(row)::text)::text AS json_bytes' : ''} FROM ${qualified} row`);
      const hashes: string[] = []; let tupleBytes = 0, jsonBytes = 0;
      while (true) {
        const page = await query('fetch', `FETCH FORWARD ${READER_SNAPSHOT_LIMITS.pageRows} FROM cp27_state_rows`);
        if (page.length > READER_SNAPSHOT_LIMITS.pageRows || hashes.length + page.length > rows) throw new ReaderStateSnapshotError('fetch', table);
        for (const item of page) {
          if (typeof item.digest !== 'string' || !/^[0-9a-f]{32}$/u.test(item.digest)) throw new ReaderStateSnapshotError('fetch', table);
          hashes.push(item.digest);
          if (storage) { tupleBytes += storageInteger(item.tuple_bytes); jsonBytes += storageInteger(item.json_bytes); assert(Number.isSafeInteger(tupleBytes) && Number.isSafeInteger(jsonBytes)); }
        }
        if (!page.length) break;
      }
      if (hashes.length !== rows) throw new ReaderStateSnapshotError('fetch', table);
      await query('cursor-close', 'CLOSE cp27_state_rows');
      hashes.sort();
      const digest = createHash('md5'); for (const item of hashes) digest.update(item);
      const sized = await query('size', storage ? STORAGE_SIZE_SQL : 'SELECT pg_total_relation_size($1::regclass)::text AS bytes', [storage ? qualified : 'public.' + table]);
      if (sized.length !== 1 || typeof sized[0].bytes !== 'string' || !/^(?:0|[1-9][0-9]*)$/u.test(sized[0].bytes)) throw new ReaderStateSnapshotError('size', table);
      const totalBytes = Number(sized[0].bytes);
      if (!Number.isSafeInteger(totalBytes)) throw new ReaderStateSnapshotError('size', table);
      const rowDigest = digest.digest('hex');
      records.push({ table, rows, digest: rowDigest }); counts.push({ table, rows, totalBytes });
      if (storage && relation) {
        const before = storage.history.get(table);
        if (before && (relation.immutable || relation.group === 'non-data')) assertStorageHistory(before, hashes, relation.group === 'non-data');
        nextHistory.set(table, hashes);
        const tableBytes = storageInteger(sized[0].table_bytes), indexBytes = storageInteger(sized[0].index_bytes);
        assert.equal(totalBytes, tableBytes + indexBytes, 'CP28 physical allocation does not reconcile.');
        const forks = ['main_bytes','fsm_bytes','vm_bytes','init_bytes'].map(key => storageInteger(sized[0][key]));
        assert(tableBytes >= forks.reduce((sum, bytes) => sum + bytes, 0));
        storageRows.push({ ...relation, oid: storageInteger(name.oid), owner: String(name.owner), dependencies: name.dependencies as string[],
          ...(storage.history.size === 0 ? { metadata: { kind: String(name.relkind), columns: name.columns as string[], constraints: name.constraints as string[], indexes: name.indexes as string[] } } : {}), rows, digest: rowDigest,
          totalBytes, tableBytes, indexBytes, heapMainBytes: forks[0], heapFsmBytes: forks[1], heapVmBytes: forks[2], heapInitBytes: forks[3],
          toastAndAuxBytes: tableBytes - forks.reduce((sum, bytes) => sum + bytes, 0), tupleBytes, jsonBytes });
      }
    }
    result = { digest: hash('sha256', JSON.stringify(records)), counts };
    if (storage) {
      const allocatedBytes = storageRows.reduce((sum, row) => sum + row.totalBytes, 0);
      assert(allocatedBytes < 256 * 1024 * 1024, 'CP28 observed allocation threshold reached.');
      pendingStorageHistory.set(result, nextHistory);
      result.storage = { name: storage.name, digest: result.digest, metadataDigest, relations: storageRows, allocatedBytes,
        databaseBytes: storageInteger(names[0].database_bytes), totalRows, elapsedMs: performance.now() - started };
    }
  } catch (error) { failure = error instanceof ReaderStateSnapshotError ? error : new ReaderStateSnapshotError(currentStage, currentTable, error); }
  finally {
    if (connection) {
      const cleanupDeadline = Math.min(deadline, performance.now() + READER_SNAPSHOT_LIMITS.cleanupMs);
      for (const [stage, operation] of [
        ...(transaction ? [['rollback', () => connection!.database.query('ROLLBACK')] as const] : []),
        ['close', () => connection!.close()] as const,
      ]) {
        try {
          // Always initiate close even if rollback exhausted the cleanup reserve.
          if (stage === 'close' && performance.now() >= cleanupDeadline) {
            void operation().catch(() => undefined); throw new ReaderStateSnapshotError('close', currentTable);
          }
          await bounded<unknown>(operation, stage, cleanupDeadline);
        } catch (error) {
          const cleanup = error instanceof ReaderStateSnapshotError ? error : new ReaderStateSnapshotError(stage, currentTable, error);
          if (failure) failure.cleanupFailures.push(cleanup.diagnostic); else failure = cleanup;
        }
      }
    }
  }
  if (failure) throw failure;
  if (!result) throw new ReaderStateSnapshotError(currentStage, currentTable);
  if (storage && result.storage) {
    // Commit the new immutable-history baseline only after acknowledged connection close.
    for (const [table, hashes] of pendingStorageHistory.get(result) ?? []) storage.history.set(table, hashes);
    storageMetadata.set(storage.history, result.storage.metadataDigest);
  }
  return result;
}

export type StorageRelation = { schema: string; table: string; migration: string; group: 'per-league' | 'shared' | 'controls' | 'non-data'; immutable: boolean };
export type StorageRelationEvidence = StorageRelation & { oid: number; owner: string; dependencies: string[]; metadata?: { kind: string; columns: string[]; constraints: string[]; indexes: string[] }; rows: number; digest: string;
  totalBytes: number; tableBytes: number; indexBytes: number; heapMainBytes: number; heapFsmBytes: number; heapVmBytes: number; heapInitBytes: number;
  toastAndAuxBytes: number; tupleBytes: number; jsonBytes: number };
export type StoragePhaseEvidence = { name: string; digest: string; metadataDigest: string; relations: StorageRelationEvidence[]; allocatedBytes: number; databaseBytes: number; totalRows: number; elapsedMs: number };
export type StorageSnapshotOptions = { name: string; history: Map<string, string[]> };
const storageMetadata = new WeakMap<Map<string, string[]>, string>();
const pendingStorageHistory = new WeakMap<SnapshotResult, Map<string, string[]>>();
const storageInteger = (value: unknown) => { assert(typeof value === 'string' && /^(?:0|[1-9][0-9]*)$/u.test(value)); const number = Number(value); assert(Number.isSafeInteger(number)); return number; };
/** Sorted multiset subset preserves every old immutable row, including multiplicity. */
export function assertStorageHistory(before: readonly string[], after: readonly string[], unchanged = false) {
  if (unchanged) assert.deepEqual(after, before, 'CP28 non-DATA baseline changed.');
  let cursor = 0;
  for (const old of before) { while (cursor < after.length && after[cursor] < old) cursor++; assert.equal(after[cursor++], old, 'CP28 immutable history was removed or mutated.'); }
}
const mutable = new Set(`leagues league_seasons league_source_connections league_administration_enrollments league_administration_heads league_configuration_heads league_roster_resource_heads scoring_entities external_scoring_entity_ids league_player_directory_heads projection_jobs public_data_intakes public_data_league_candidates public_data_collection_reservations public_data_refresh_targets public_data_exact_period_tasks public_data_bracket_tasks public_data_report_tasks public_data_transaction_tasks public_data_draft_tasks public_data_resources public_data_history_service public_data_resource_service`.split(' '));
const inventoryRows: [StorageRelation['group'], string, string][] = [
  ['per-league','001','leagues league_seasons league_source_connections'],
  ['per-league','016','league_administration_enrollments league_administration_enrollment_seasons league_source_connection_history league_configuration_versions league_administration_contents league_administration_observations league_administration_heads league_configuration_activations league_configuration_heads league_season_teams league_administration_team_entries league_administration_manager_entries league_administration_memberships league_administration_transaction_entries'],
  ['per-league','026','league_source_mapping_revisions league_administration_observation_mappings'],
  ['per-league','027','league_roster_resource_scopes league_roster_resource_heads league_roster_resource_attempts league_roster_capture_receipts league_roster_resource_acceptances'],
  ['per-league','028','league_team_manager_entries league_team_manager_memberships'], ['per-league','031','league_native_period_calendar_evidence'],
  ['per-league','042','league_roster_player_link_receipts league_roster_player_links'], ['per-league','043','league_manager_directory_versions league_manager_directory_entries'],
  ['per-league','045','league_exact_matchup_value_contents league_exact_matchup_team_values league_exact_matchup_starter_points league_exact_matchup_player_points'],
  ['per-league','046','league_bracket_contents league_bracket_rounds league_bracket_matches league_bracket_entrants league_bracket_results league_bracket_edges'],
  ['per-league','048','league_official_standings_contents league_official_standings_teams league_official_standings_captures'],
  ['per-league','049','league_weekly_report_contents league_weekly_report_teams'],
  ['per-league','053','league_season_drafts league_draft_metadata_contents league_draft_metadata_entries league_draft_metadata_facts league_draft_metadata_user_slots league_draft_metadata_slot_rosters'],
  ['per-league','054','league_draft_selections league_draft_selection_contents league_draft_selection_catalog_entries league_draft_selection_entries league_draft_selection_link_receipts league_draft_selection_player_links'],
  ['per-league','055','league_traded_pick_assets league_traded_pick_contents league_traded_pick_catalog_entries league_traded_pick_entries'],
  ['shared','001','scoring_profiles scoring_entities external_scoring_entity_ids'], ['shared','016','league_source_manager_accounts'],
  ['shared','041','league_player_directory_heads league_player_directory_attempts league_player_directory_contents league_player_directory_entries league_player_directory_captures league_player_directory_source_slices league_player_directory_versions'],
  ['controls','001','projection_jobs'],
  ['controls','034','public_data_intakes public_data_identity_observations public_data_league_lists public_data_league_candidates public_data_rejections public_data_collection_reservations public_data_dispatches public_data_dispatch_outcomes public_data_directory_captures'],
  ['controls','036','public_data_refresh_targets public_data_refresh_configurations public_data_refresh_cycles public_data_refresh_cycle_outcomes public_data_refresh_selection_failures'],
  ['controls','038','public_data_exact_period_tasks public_data_exact_period_checkpoints'], ['controls','044','public_data_period_inventory_plans public_data_period_inventory_sources'],
  ['controls','047','public_data_bracket_tasks public_data_bracket_checkpoints'], ['controls','050','public_data_report_tasks public_data_report_checkpoints'],
  ['controls','051','public_data_transaction_tasks public_data_transaction_checkpoints'], ['controls','056','public_data_draft_tasks public_data_draft_checkpoints'],
  ['controls','059','public_data_resource_configurations public_data_resources public_data_resource_authorities public_data_resource_occurrences public_data_resource_selections public_data_resource_selection_failures public_data_history_service public_data_resource_service public_data_resource_target_failures'],
  ['non-data','001','nfl_games external_game_ids pregame_projection_runs pregame_projection_candidates pregame_projection_baselines game_state_observations league_week_observations league_week_expected_games official_player_point_observations official_roster_point_observations projection_snapshots current_projection_snapshots'],
  ['non-data','003','league_period_authorities'], ['non-data','004','projection_slate_contents projection_slate_entries projection_slate_observations current_projection_slates current_pregame_projection_candidates'],
  ['non-data','005','projection_period_refresh_states league_week_materialization_states'], ['non-data','007','league_week_lineup_watch_states'],
  ['non-data','010','all_player_stat_contents all_player_stat_entries all_player_stat_observations all_player_score_sets all_player_scores current_all_player_score_sets'], ['non-data','011','all_player_score_verifications'],
  ['non-data','020','app_users app_login_identities app_provider_account_links app_user_leagues app_league_groups app_league_group_memberships app_identity_audit_events'],
  ['non-data','023','all_player_league_acceptances current_all_player_league_scores'], ['non-data','032','league_calculation_source_captures league_calculation_capture_inputs'],
  ['non-data','integration/neon-integration-harness.ts','app_schema_migrations'],
];
export const STORAGE_RELATIONS: readonly StorageRelation[] = Object.freeze([
  ...inventoryRows.flatMap(([group, migration, names]) => names.split(' ').map(table => ({ schema: 'public', table, migration, group, immutable: group !== 'non-data' && !mutable.has(table) }))),
  ...['user','session','account','verification','rateLimit'].map(table => ({ schema: 'website_auth', table, migration: '021', group: 'non-data' as const, immutable: false })),
].sort((a,b) => (a.schema + '.' + a.table).localeCompare(b.schema + '.' + b.table)));
assert.equal(STORAGE_RELATIONS.length,154); assert.equal(new Set(STORAGE_RELATIONS.map(row => row.schema + '.' + row.table)).size,154);
export const STORAGE_INVENTORY_SQL = `SELECT n.nspname AS schemaname,c.relname AS tablename,c.oid::text AS oid,c.relkind,
  pg_get_userbyid(c.relowner) AS owner,(SELECT pg_database_size(current_database())::text) AS database_bytes,
  ARRAY(SELECT nr.nspname||'.'||cr.relname FROM pg_constraint fk JOIN pg_class cr ON cr.oid=fk.confrelid
    JOIN pg_namespace nr ON nr.oid=cr.relnamespace WHERE fk.conrelid=c.oid AND fk.contype='f' ORDER BY nr.nspname,cr.relname) AS dependencies,
  ARRAY(SELECT a.attname||':'||format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull||':'||a.attidentity::text||':'||a.attgenerated::text||':'||COALESCE(pg_get_expr(d.adbin,d.adrelid),'')
    FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum) AS columns,
  ARRAY(SELECT k.conname||':'||pg_get_constraintdef(k.oid,true)||':'||k.convalidated||':'||k.condeferrable||':'||k.condeferred FROM pg_constraint k WHERE k.conrelid=c.oid ORDER BY k.conname) AS constraints,
  ARRAY(SELECT pg_get_indexdef(i.indexrelid)||':'||i.indisvalid||':'||i.indisready FROM pg_index i WHERE i.indrelid=c.oid ORDER BY i.indexrelid) AS indexes
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%'
    AND n.nspname NOT LIKE 'pg_temp_%' AND c.relkind IN ('r','p','S','m','f') ORDER BY n.nspname,c.relname`;
export const STORAGE_SIZE_SQL = `SELECT pg_total_relation_size($1::regclass)::text AS bytes,
  pg_table_size($1::regclass)::text AS table_bytes,pg_indexes_size($1::regclass)::text AS index_bytes,
  pg_relation_size($1::regclass,'main')::text AS main_bytes,pg_relation_size($1::regclass,'fsm')::text AS fsm_bytes,
  pg_relation_size($1::regclass,'vm')::text AS vm_bytes,pg_relation_size($1::regclass,'init')::text AS init_bytes`;
