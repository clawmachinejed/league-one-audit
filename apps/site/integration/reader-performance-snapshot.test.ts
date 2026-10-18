import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseRow } from '../lib/database';
import { readReaderStateSnapshot, ReaderStateSnapshotError, READER_SNAPSHOT_LIMITS, validReaderSnapshotDiagnostic } from './reader-performance-snapshot';
const md5 = (text: string) => createHash('md5').update(text).digest('hex');
function database(tables: Record<string, string[]>, change?: (sql: string, rows: DatabaseRow[]) => DatabaseRow[] | Promise<DatabaseRow[]>) {
  let selected = '', offset = 0;
  const calls: { sql: string; parameters: readonly unknown[] }[] = [];
  const close = vi.fn(async () => undefined);
  const query = async <Row extends DatabaseRow>(sql: string, parameters: readonly unknown[] = []): Promise<readonly Row[]> => {
    calls.push({ sql, parameters }); let rows: DatabaseRow[] = [];
    if (sql.includes('FROM pg_tables')) rows = Object.keys(tables).sort().map(tablename => ({ tablename }));
    else if (sql.startsWith('SELECT count')) { selected = sql.split('public.')[1]; rows = [{ rows: String(tables[selected].length) }]; }
    else if (sql.startsWith('DECLARE')) { selected = sql.split('public.')[1].split(' ')[0]; offset = 0; }
    else if (sql.startsWith('FETCH')) { rows = tables[selected].slice(offset, offset + 512).map(digest => ({ digest })); offset += rows.length; }
    else if (sql.startsWith('SELECT pg_total')) rows = [{ bytes: '8192' }];
    return (change ? await change(sql, rows) : rows) as Row[];
  };
  const connect = vi.fn(async () => ({ database: { query }, close })); return { connect, close, calls };
}
const original = (tables: Record<string, string[]>) => createHash('sha256').update(JSON.stringify(Object.entries(tables).sort(([a], [b]) => a.localeCompare(b)).map(([table, rows]) => ({ table, rows: rows.length, digest: md5([...rows].sort().join('')) })))).digest('hex');
afterEach(() => { vi.useRealTimers(); });
describe('CP27 bounded full-state snapshot, offline query mocks only', () => {
  it('preserves original sorted row-hash digest across pages, duplicates and empty tables', async () => {
    // Strings stand for PostgreSQL JSONB text; this does not emulate SQL canonicalization.
    const hashes = Array.from({ length: 1031 }, (_, i) => md5('{"column": ' + (i % 37) + '}'));
    const tables = { league_alpha: hashes, league_empty: [], public_data_gamma: [md5('{"value": null}')] };
    const mock = database(tables), result = await readReaderStateSnapshot(mock.connect);
    expect(result.digest).toBe(original(tables));
    expect(result.counts).toEqual([{ table: 'league_alpha', rows: 1031, totalBytes: 8192 }, { table: 'league_empty', rows: 0, totalBytes: 8192 }, { table: 'public_data_gamma', rows: 1, totalBytes: 8192 }]);
    expect(mock.connect).toHaveBeenCalledTimes(1); expect(mock.close).toHaveBeenCalledTimes(1);
    expect(mock.calls[0].sql).toBe('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'); expect(mock.calls[1].sql).toBe("SET LOCAL statement_timeout = '10000ms'"); expect(mock.calls.at(-1)?.sql).toBe('ROLLBACK');
    const declarations = mock.calls.filter(row => row.sql.startsWith('DECLARE')); expect(declarations).toHaveLength(3);
    for (const { sql } of declarations) { expect(sql).toContain('NO SCROLL'); expect(sql).toContain('md5(to_jsonb(row)::text)'); expect(sql).not.toMatch(/ORDER BY|string_agg|DISTINCT|LIMIT/iu); }
    expect(mock.calls.filter(row => row.sql.startsWith('FETCH'))).toHaveLength(7);
    expect((await readReaderStateSnapshot(database({ ...tables, league_alpha: [...hashes].reverse() }).connect)).digest).toBe(result.digest);
  });
  it('retains multiplicity, every column hash, null/empty and table identity', async () => {
    const row = md5('{"a": null, "b": ""}'), baseline = (await readReaderStateSnapshot(database({ league_rows: [row, row] }).connect)).digest;
    for (const tables of ([{ league_rows: [row] }, { league_rows: [row, row, row] }, { league_rows: [row, md5('{"a": null, "b": "changed"}')] }, { league_rows: [row, md5('{"a": "", "b": ""}')] }, { league_other: [row, row] }] as Record<string, string[]>[])) expect((await readReaderStateSnapshot(database(tables).connect)).digest).not.toBe(baseline);
  });
  it('accepts all200000 rows including identical pages without deduplication', async () => {
    const tables = { league_rows: Array(READER_SNAPSHOT_LIMITS.rowsPerTable).fill(md5('identical')) as string[] }, mock = database(tables);
    const result = await readReaderStateSnapshot(mock.connect); expect(result.digest).toBe(original(tables)); expect(result.counts[0].rows).toBe(200_000);
    expect(mock.calls.filter(row => row.sql.startsWith('FETCH'))).toHaveLength(Math.ceil(200_000 / 512) + 1);
  });
  it('rejects overflow before declaring a cursor and closes the session', async () => {
    const mock = database({ league_rows: [] }, (sql, rows) => sql.startsWith('SELECT count') ? [{ rows: '200001' }] : rows);
    await expect(readReaderStateSnapshot(mock.connect)).rejects.toMatchObject({ diagnostic: { stage: 'count', table: 'league_rows', code: null } });
    expect(mock.calls.some(row => row.sql.startsWith('DECLARE'))).toBe(false); expect(mock.calls.at(-1)?.sql).toBe('ROLLBACK'); expect(mock.close).toHaveBeenCalledTimes(1);
  });
  it.each(['missing', 'extra', 'oversized', 'malformed'] as const)('rejects %s cursor evidence', async fault => {
    const mock = database({ league_rows: [md5('row')] }, (sql, rows) => !sql.startsWith('FETCH') ? rows : fault === 'missing' ? [] : fault === 'extra' ? [...rows, { digest: md5('extra') }] : fault === 'oversized' ? Array.from({ length: 513 }, () => ({ digest: md5('row') })) : rows.length ? [{ digest: 'raw source data is forbidden' }] : []);
    await expect(readReaderStateSnapshot(mock.connect)).rejects.toMatchObject({ diagnostic: { stage: 'fetch', table: 'league_rows', code: null } });
    expect(mock.calls.at(-1)?.sql).toBe('ROLLBACK'); expect(mock.close).toHaveBeenCalledTimes(1);
  });
  it.each(['empty', 'duplicate', 'unsafe'] as const)('rejects %s inventory', async fault => {
    const mock = database({ league_rows: [] }, (sql, rows) => !sql.includes('FROM pg_tables') ? rows : fault === 'empty' ? [] : fault === 'duplicate' ? [{ tablename: 'league_rows' }, { tablename: 'league_rows' }] : [{ tablename: 'league_rows;DROP TABLE x' }]);
    await expect(readReaderStateSnapshot(mock.connect)).rejects.toBeInstanceOf(ReaderStateSnapshotError); expect(mock.close).toHaveBeenCalledTimes(1);
  });
  it('retains safe SQLSTATE/table/stage and cleanup failures without raw message or cause', async () => {
    const mock = database({ league_rows: [md5('row')] }, (sql, rows) => { if (sql.startsWith('FETCH')) throw Object.assign(new Error('postgresql://secret:password@example/raw-row'), { code: '53200', detail: 'secret row' }); if (sql === 'ROLLBACK') throw new Error('secret rollback'); return rows; });
    mock.close.mockRejectedValueOnce(new Error('secret close'));
    let failure: unknown; try { await readReaderStateSnapshot(mock.connect); } catch (error) { failure = error; }
    expect(failure).toMatchObject({ diagnostic: { stage: 'fetch', table: 'league_rows', code: '53200' }, cleanupFailures: [{ stage: 'rollback', table: 'league_rows', code: null }, { stage: 'close', table: 'league_rows', code: null }] });
    expect(String(failure)).not.toContain('secret'); expect(JSON.stringify(failure)).not.toMatch(/secret|password|raw-row/u); expect(mock.close).toHaveBeenCalledTimes(1);
  });
  it.each(['ROLLBACK', 'CLOSE cp27_state_rows'] as const)('fails closed when %s rejects', async rejected => {
    const mock = database({ league_rows: [] }, (sql, rows) => { if (sql === rejected) throw new Error('fixture cleanup failure'); return rows; });
    await expect(readReaderStateSnapshot(mock.connect)).rejects.toBeInstanceOf(ReaderStateSnapshotError); expect(mock.close).toHaveBeenCalledTimes(1);
  });
  it('fails closed when close rejects after complete traversal', async () => {
    const mock = database({ league_rows: [] }); mock.close.mockRejectedValueOnce(new Error('fixture close failure'));
    await expect(readReaderStateSnapshot(mock.connect)).rejects.toMatchObject({ diagnostic: { stage: 'close' } });
  });
  it('bounds a stuck query, attempts cleanup and issues no further snapshot reads', async () => {
    vi.useFakeTimers(); const mock = database({ league_rows: [] }, (sql, rows) => sql.startsWith('FETCH') ? new Promise<DatabaseRow[]>(() => undefined) : rows);
    const pending = readReaderStateSnapshot(mock.connect), checked = expect(pending).rejects.toMatchObject({ diagnostic: { stage: 'fetch' } });
    await vi.advanceTimersByTimeAsync(60_000); await checked; expect(mock.calls.at(-1)?.sql).toBe('ROLLBACK'); expect(mock.close).toHaveBeenCalledTimes(1); expect(mock.calls.filter(row => row.sql.startsWith('FETCH'))).toHaveLength(1);
  });
  it('closes a late connection after deadline and never queries it', async () => {
    vi.useFakeTimers(); const mock = database({ league_rows: [] }), connect = async () => { await new Promise(resolve => setTimeout(resolve, 60_000)); return mock.connect(); };
    const pending = readReaderStateSnapshot(connect), checked = expect(pending).rejects.toMatchObject({ diagnostic: { stage: 'connect' } });
    await vi.advanceTimersByTimeAsync(60_000); await checked; expect(mock.calls).toHaveLength(0); expect(mock.close).toHaveBeenCalledTimes(1);
  });
  it('refuses a remaining case budget without cleanup reserve', async () => {
    const mock = database({ league_rows: [] }); await expect(readReaderStateSnapshot(mock.connect, 10_000)).rejects.toMatchObject({ diagnostic: { stage: 'timeout' } }); expect(mock.connect).not.toHaveBeenCalled();
  });
  it('does not invoke a driver code getter or retain unknown codes', () => {
    const getter = vi.fn(() => { throw new Error('secret getter'); });
    const hostile = Object.defineProperty(new Error('secret'), 'code', { get: getter });
    expect(new ReaderStateSnapshotError('fetch', 'league_rows', hostile).diagnostic.code).toBeNull();
    expect(new ReaderStateSnapshotError('fetch', 'league_rows', { code: 'private-value' }).diagnostic.code).toBeNull();
    expect(getter).not.toHaveBeenCalled();
  });
  it('still initiates session close when rollback consumes the cleanup reserve', async () => {
    vi.useFakeTimers();
    const mock = database({ league_rows: [] }, (sql, rows) => sql === 'ROLLBACK' ? new Promise<DatabaseRow[]>(() => undefined) : rows);
    const pending = readReaderStateSnapshot(mock.connect), checked = expect(pending).rejects.toMatchObject({ diagnostic: { stage: 'rollback' }, cleanupFailures: [{ stage: 'close' }] });
    await vi.advanceTimersByTimeAsync(10_000); await checked; expect(mock.close).toHaveBeenCalledTimes(1);
  });
  it('bounds session close acknowledgment without claiming a successful snapshot', async () => {
    vi.useFakeTimers(); const mock = database({ league_rows: [] });
    mock.close.mockImplementationOnce(() => new Promise<undefined>(() => undefined));
    const pending = readReaderStateSnapshot(mock.connect), checked = expect(pending).rejects.toMatchObject({ diagnostic: { stage: 'close' } });
    await vi.advanceTimersByTimeAsync(10_000); await checked; expect(mock.close).toHaveBeenCalledTimes(1);
  });
  it('honors the smaller remaining case budget without resuming traversal', async () => {
    vi.useFakeTimers(); const mock = database({ league_rows: [] }, (sql, rows) => sql.startsWith('FETCH') ? new Promise<DatabaseRow[]>(() => undefined) : rows);
    let settled = false;
    const pending = readReaderStateSnapshot(mock.connect, 20_000).catch(error => { settled = true; throw error; });
    const checked = expect(pending).rejects.toMatchObject({ diagnostic: { stage: 'fetch' } });
    await vi.advanceTimersByTimeAsync(9_999); expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1); await checked; expect(mock.close).toHaveBeenCalledTimes(1);
  });
  it('accepts only closed sanitized diagnostic fields', () => {
    expect(validReaderSnapshotDiagnostic({ stage: 'fetch', table: 'league_rows', code: '53200' })).toBe(true);
    for (const value of [{ stage: 'secret', table: null, code: null }, { stage: 'fetch', table: 'sql;secret', code: null }, { stage: 'fetch', table: null, code: 'secret' }, { stage: 'fetch', table: null, code: null, message: 'secret' }]) expect(validReaderSnapshotDiagnostic(value)).toBe(false);
  });
});
