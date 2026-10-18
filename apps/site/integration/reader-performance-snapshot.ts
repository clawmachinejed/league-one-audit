import { createHash } from 'node:crypto';
import type { DatabaseClient } from '../lib/database';

export const READER_SNAPSHOT_LIMITS = Object.freeze({ rowsPerTable: 200_000, pageRows: 512, maximumMs: 60_000, cleanupMs: 10_000, statementMs: 10_000 });
const stages = ['connect', 'begin', 'timeout', 'inventory', 'count', 'declare', 'fetch', 'cursor-close', 'size', 'rollback', 'close'] as const;
export type ReaderSnapshotDiagnostic = { stage: typeof stages[number]; table: string | null; code: string | null };
type SnapshotConnection = { database: Pick<DatabaseClient, 'query'>; close(): Promise<void> };
type SnapshotResult = { digest: string; counts: { table: string; rows: number; totalBytes: number }[] };
const tableName = /^[a-z][a-z0-9_]+$/u;
const sqlStates = new Set(['53200', '57014', '08000', '08001', '08003', '08006', '08007', '08P01', '57P01', '57P02', '57P03', '42501', '42P01']);
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
export async function readReaderStateSnapshot(connect: () => Promise<SnapshotConnection>, maximumMs: number = READER_SNAPSHOT_LIMITS.maximumMs): Promise<SnapshotResult> {
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
    const names = await query('inventory', `SELECT tablename FROM pg_tables WHERE schemaname='public'
      AND (tablename LIKE 'league_%' OR tablename LIKE 'public_data_%' OR tablename IN ('leagues','projection_jobs')) ORDER BY tablename`);
    if (!names.length) throw new ReaderStateSnapshotError('inventory', null);
    const seen = new Set<string>(), records: { table: string; rows: number; digest: string }[] = [], counts: SnapshotResult['counts'] = [];
    for (const name of names) {
      if (typeof name.tablename !== 'string' || name.tablename.length > 63 || !tableName.test(name.tablename) || seen.has(name.tablename))
        throw new ReaderStateSnapshotError('inventory', null);
      const table = name.tablename; seen.add(table); currentTable = table;
      const counted = await query('count', `SELECT count(*)::text AS rows FROM public.${table}`);
      if (counted.length !== 1 || typeof counted[0].rows !== 'string' || !/^(?:0|[1-9][0-9]*)$/u.test(counted[0].rows)) throw new ReaderStateSnapshotError('count', table);
      const rows = Number(counted[0].rows);
      if (!Number.isSafeInteger(rows) || rows > READER_SNAPSHOT_LIMITS.rowsPerTable) throw new ReaderStateSnapshotError('count', table);
      await query('declare', `DECLARE cp27_state_rows NO SCROLL CURSOR FOR SELECT md5(to_jsonb(row)::text) AS digest FROM public.${table} row`);
      const hashes: string[] = [];
      while (true) {
        const page = await query('fetch', `FETCH FORWARD ${READER_SNAPSHOT_LIMITS.pageRows} FROM cp27_state_rows`);
        if (page.length > READER_SNAPSHOT_LIMITS.pageRows || hashes.length + page.length > rows) throw new ReaderStateSnapshotError('fetch', table);
        for (const item of page) {
          if (typeof item.digest !== 'string' || !/^[0-9a-f]{32}$/u.test(item.digest)) throw new ReaderStateSnapshotError('fetch', table);
          hashes.push(item.digest);
        }
        if (!page.length) break;
      }
      if (hashes.length !== rows) throw new ReaderStateSnapshotError('fetch', table);
      await query('cursor-close', 'CLOSE cp27_state_rows');
      hashes.sort();
      const digest = createHash('md5'); for (const item of hashes) digest.update(item);
      const sized = await query('size', 'SELECT pg_total_relation_size($1::regclass)::text AS bytes', ['public.' + table]);
      if (sized.length !== 1 || typeof sized[0].bytes !== 'string' || !/^(?:0|[1-9][0-9]*)$/u.test(sized[0].bytes)) throw new ReaderStateSnapshotError('size', table);
      const totalBytes = Number(sized[0].bytes);
      if (!Number.isSafeInteger(totalBytes)) throw new ReaderStateSnapshotError('size', table);
      records.push({ table, rows, digest: digest.digest('hex') }); counts.push({ table, rows, totalBytes });
    }
    result = { digest: hash('sha256', JSON.stringify(records)), counts };
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
  return result;
}
