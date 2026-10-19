import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { Socket } from 'node:net';
import { Client, type ClientConfig } from '@neondatabase/serverless';
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
import { STORAGE_RELATIONS, STORAGE_INVENTORY_SQL, STORAGE_SIZE_SQL, STORAGE_STATISTICS_SQL, assertStorageHistory } from './reader-performance-snapshot';
function storageMock(change?: (sql:string,rows:DatabaseRow[])=>DatabaseRow[]|Promise<DatabaseRow[]>){
  let table='',offset=0,stream:DatabaseRow[]=[],streamOrder=(rows:DatabaseRow[])=>rows;
  const contents=new Map(STORAGE_RELATIONS.map(row=>[row.schema+'.'+row.table,[] as string[]]));
  const close=vi.fn(async()=>{}),calls:string[]=[];
  const query=async <Row extends DatabaseRow>(sql:string,parameters:readonly unknown[]=[]):Promise<readonly Row[]>=>{
    calls.push(sql);let rows:DatabaseRow[]=[];
    if(sql===STORAGE_INVENTORY_SQL)rows=STORAGE_RELATIONS.map((row,index)=>({schemaname:row.schema,tablename:row.table,oid:String(index+1),relkind:'r',owner:'test_owner',database_bytes:'2000000',dependencies:[],columns:['id:uuid:true:::'],constraints:['pk:PRIMARY KEY (id):true:false:false'],indexes:[]}));
    else if(sql===STORAGE_STATISTICS_SQL)rows=[...contents].map(([relation_key,hashes])=>({relation_key,rows:String(hashes.length),bytes:'8192',table_bytes:'8192',index_bytes:'0',main_bytes:'8192',fsm_bytes:'0',vm_bytes:'0',init_bytes:'0'}));
    else if(sql.startsWith('DECLARE cp28_state_rows')){
      const keys=[...sql.matchAll(/SELECT '([^']+)' AS relation_key/gu)].map(match=>match[1]);
      stream=streamOrder(keys.flatMap(relation_key=>contents.get(relation_key)!.map(digest=>({relation_key,digest,tuple_bytes:'100',json_bytes:'120'}))));offset=0;
    }
    else if(sql.startsWith('FETCH')&&sql.endsWith('cp28_state_rows')){rows=stream.slice(offset,offset+512);offset+=rows.length;}
    else if(sql.startsWith('SELECT count')){table=sql.split('FROM ')[1].replaceAll('"','');rows=[{rows:String(contents.get(table)!.length)}];}
    else if(sql.startsWith('DECLARE cp27_state_rows '))offset=0;
    else if(sql.startsWith('FETCH')&&sql.endsWith('cp27_state_rows')){rows=contents.get(table)!.slice(offset,offset+512).map(digest=>({digest,tuple_bytes:'100',json_bytes:'120'}));offset+=rows.length;}
    else if(sql===STORAGE_SIZE_SQL){void parameters;rows=[{bytes:'8192',table_bytes:'8192',index_bytes:'0',main_bytes:'8192',fsm_bytes:'0',vm_bytes:'0',init_bytes:'0'}];}
    else if(!['BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',"SET LOCAL statement_timeout = '10000ms'",
      "SET LOCAL lock_timeout = '2000ms'",'CLOSE cp28_state_rows','CLOSE cp27_state_rows','ROLLBACK'].includes(sql))
      throw new Error('Unexpected storage fixture SQL.');
    return(await(change?change(sql,rows):rows))as Row[];
  };return{contents,close,calls,connect:async()=>({database:{query},close}),reorder:(order:(rows:DatabaseRow[])=>DatabaseRow[])=>{streamOrder=order;}};
}

describe('CP28 complete attribution and append history, offline query doubles only',()=>{
  it('inventories all154 relations including website auth and canonical dependencies without double counting',async()=>{
    const mock=storageMock(),history=new Map<string,string[]>();mock.contents.set('public.scoring_entities',[md5('player')]);
    const first=await readReaderStateSnapshot(mock.connect,30_000,{name:'S0-empty',history});expect(first.storage?.relations).toHaveLength(154);expect(first.storage?.allocatedBytes).toBe(154*8192);
    expect(first.storage?.relations.find(row=>row.table==='scoring_entities')).toMatchObject({group:'shared',tupleBytes:100,jsonBytes:120,rows:1});
    expect(first.storage?.relations.find(row=>row.table==='rateLimit')).toMatchObject({schema:'website_auth',group:'non-data',immutable:false});
    expect(first.storage?.relations.every(row=>row.metadata?.kind==='r')).toBe(true);expect(mock.calls).toContain("SET LOCAL lock_timeout = '2000ms'");
    mock.contents.set('public.league_roster_capture_receipts',[md5('new')]);const second=await readReaderStateSnapshot(mock.connect,30_000,{name:'S1-catalog',history});
    expect(second.storage?.metadataDigest).toBe(first.storage?.metadataDigest);expect(second.storage?.relations.every(row=>row.metadata===undefined)).toBe(true);expect(mock.close).toHaveBeenCalledTimes(2);
  });
  it.each(['missing','kind','fk','allocation','non-data','immutable'] as const)('rejects %s drift and closes without accepting a history baseline',async fault=>{
    let changed=false;const mock=storageMock((sql,rows)=>{
      if(!changed)return rows;if(sql===STORAGE_INVENTORY_SQL&&fault==='missing')return rows.slice(1);
      if(sql===STORAGE_INVENTORY_SQL&&fault==='kind')return rows.map((row,index)=>index?row:{...row,relkind:'S'});
      if(sql===STORAGE_INVENTORY_SQL&&fault==='fk')return rows.map((row,index)=>index?row:{...row,constraints:['dropped']});
      if(sql===STORAGE_STATISTICS_SQL&&fault==='allocation')return rows.map((row,index)=>index?row:{...row,bytes:'16384'});return rows;});
    const history=new Map<string,string[]>();mock.contents.set('public.league_roster_capture_receipts',[md5('old')]);await readReaderStateSnapshot(mock.connect,30_000,{name:'S0-empty',history});changed=true;
    if(fault==='non-data')mock.contents.set('website_auth.user',[md5('new')]);if(fault==='immutable')mock.contents.set('public.league_roster_capture_receipts',[md5('changed')]);
    await expect(readReaderStateSnapshot(mock.connect,30_000,{name:'S1-catalog',history})).rejects.toBeInstanceOf(ReaderStateSnapshotError);
    expect(history.get('public.league_roster_capture_receipts')).toEqual([md5('old')]);expect(mock.close).toHaveBeenCalledTimes(2);
  });
  it('retains multiset duplicate history and distinguishes immutable subsets from unchanged baseline',()=>{
    expect(()=>assertStorageHistory(['a','a','b'],['a','a','b','c'])).not.toThrow();expect(()=>assertStorageHistory(['a','a'],['a'])).toThrow();
    expect(()=>assertStorageHistory(['a'],['a','b'],true)).toThrow();
  });
});

// This opt-in uses an already prepared disposable local PostgreSQL instance.
// It neither provisions/reset schemas nor changes the guarded Neon harness.
const localPostgresRequested = process.env.CP28_LOCAL_POSTGRES_SNAPSHOT_TEST !== undefined;
type LocalSnapshotRole = 'cp28_snapshot_owner' | 'league_one_runtime';
function localPostgresConfiguration() {
  if (process.env.CP28_LOCAL_POSTGRES_SNAPSHOT_TEST !== 'I_ACKNOWLEDGE_LOCAL_DISPOSABLE_DATABASE')
    throw new Error('The local snapshot regression requires its explicit local-only marker.');
  const port = process.env.CP28_LOCAL_POSTGRES_PORT ?? '', sentinel = process.env.CP28_LOCAL_POSTGRES_SENTINEL ?? '';
  if (!/^[1-9][0-9]{3,4}$/u.test(port) || Number(port) < 1024 || Number(port) > 65535 || String(Number(port)) !== port)
    throw new Error('The local snapshot regression requires a canonical unprivileged TCP port.');
  if (!/^cp28-local-snapshot-regression-v1:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(sentinel))
    throw new Error('The local snapshot regression requires its disposable database sentinel.');
  const ownerPassword = process.env.CP28_LOCAL_POSTGRES_OWNER_PASSWORD, runtimePassword = process.env.CP28_LOCAL_POSTGRES_RUNTIME_PASSWORD;
  if (!ownerPassword || !runtimePassword || ownerPassword === runtimePassword)
    throw new Error('The local snapshot regression requires distinct ephemeral LOGIN passwords.');
  return { port: Number(port), sentinel, ownerPassword, runtimePassword };
}
async function localSnapshotConnection(role: LocalSnapshotRole) {
  const configuration = localPostgresConfiguration();
  // The installed driver's runtime consumes a stream instance; its declaration
  // still describes a stream factory. No WebSocket or inherited PG URL is used.
  const socket = new Socket(), client = new Client({ host: '127.0.0.1', port: configuration.port, database: 'cp28_snapshot_test',
    user: role, password: role === 'cp28_snapshot_owner' ? configuration.ownerPassword : configuration.runtimePassword,
    ssl: false, stream: socket as unknown as ClientConfig['stream'], connectionTimeoutMillis: 5_000,
    statement_timeout: 10_000, lock_timeout: 2_000, query_timeout: 12_000, idle_in_transaction_session_timeout: 15_000,
    application_name: 'cp28-local-snapshot-regression' });
  const calls: string[] = []; let closed = false;
  async function close() {
    try { await client.end(); closed = true; } finally { socket.destroy(); }
  }
  try {
    await client.connect();
    const identity = await client.query(`SELECT current_database() AS database,current_user AS username,session_user AS session_username,
      host(inet_server_addr()) AS host,inet_server_port() AS port,current_setting('server_version_num') AS version,
      shobj_description(d.oid,'pg_database') AS sentinel,r.rolsuper,r.rolcreatedb,r.rolcreaterole,r.rolreplication,r.rolbypassrls,r.rolcanlogin,
      EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid) AS has_memberships
      FROM pg_database d JOIN pg_roles r ON r.rolname=current_user WHERE d.datname=current_database()`);
    const version = String(identity.rows[0]?.version);
    expect(version).toMatch(/^18[0-9]{4}$/u); expect(Number(version)).toBeGreaterThanOrEqual(180000); expect(Number(version)).toBeLessThan(190000);
    expect(identity.rows).toEqual([{ database: 'cp28_snapshot_test', username: role, session_username: role, host: '127.0.0.1',
      port: configuration.port, version, sentinel: configuration.sentinel, rolsuper: false, rolcreatedb: false,
      rolcreaterole: false, rolreplication: false, rolbypassrls: false, rolcanlogin: true, has_memberships: false }]);
    return { database: { query: async <Row extends DatabaseRow>(sql: string, parameters: readonly unknown[] = []): Promise<readonly Row[]> => {
      calls.push(sql); return (await client.query(sql, [...parameters])).rows as Row[];
    } }, close, calls, serverVersion: Number(version), isClosed: () => closed };
  } catch (error) { await close(); throw error; }
}
describe.skipIf(!localPostgresRequested)('CP28 opt-in local PostgreSQL 18 inventory regression', () => {
  it('reproduces the exact hosted SQL ambiguity and retains sanitized 42725 with acknowledged cleanup', async () => {
    const original = STORAGE_INVENTORY_SQL.replace('a.attidentity::text', 'a.attidentity').replace('a.attgenerated::text', 'a.attgenerated')
      .replace('(SELECT pg_database_size(current_database())::text)', 'pg_database_size(current_database())::text');
    expect(createHash('sha256').update(original).digest('hex')).toBe('e7e6a8fb368258bae695e692ba8d4cb97f8d2bd712d57f4dc0a6380789fdd98b');
    const connection = await localSnapshotConnection('cp28_snapshot_owner');
    try {
      await expect(connection.database.query(original)).rejects.toMatchObject({ code: '42725' });
    } finally { await connection.close(); }
    expect(connection.isClosed()).toBe(true);
    const failed = await localSnapshotConnection('cp28_snapshot_owner');
    const query = failed.database.query;
    const history = new Map<string,string[]>();
    await expect(readReaderStateSnapshot(async () => ({ database: { query: <Row extends DatabaseRow>(sql: string, parameters?: readonly unknown[]) =>
      query<Row>(sql === STORAGE_INVENTORY_SQL ? original : sql, parameters) }, close: failed.close }), 30_000, { name: 'S0-empty', history }))
      .rejects.toMatchObject({ diagnostic: { stage: 'inventory', table: null, code: '42725' }, cleanupFailures: [] });
    expect(failed.calls.at(-1)).toBe('ROLLBACK'); expect(failed.isClosed()).toBe(true); expect(history.size).toBe(0);
  }, 45_000);
  it('executes the complete corrected inventory under the restricted runtime LOGIN without granting application ownership or auth access', async () => {
    const connection = await localSnapshotConnection('league_one_runtime');
    try {
      const inventory = await connection.database.query(STORAGE_INVENTORY_SQL);
      expect(new Set(inventory.map(row => row.database_bytes)).size).toBe(1);
      expect(inventory[0].database_bytes).toMatch(/^[1-9][0-9]*$/u);
      expect(Number.isSafeInteger(Number(inventory[0].database_bytes))).toBe(true);
      expect(inventory.map(row => row.schemaname + '.' + row.tablename).sort()).toEqual(STORAGE_RELATIONS.map(row => row.schema + '.' + row.table).sort());
      expect(inventory.every(row => row.relkind === 'r' && Array.isArray(row.columns) && row.columns.length > 0
        && Array.isArray(row.constraints) && Array.isArray(row.indexes))).toBe(true);
      const privileges = await connection.database.query(`SELECT has_schema_privilege(current_user,'public','CREATE') AS public_create,
        has_schema_privilege(current_user,'website_auth','USAGE') AS auth_usage,
        EXISTS(SELECT 1 FROM pg_class c JOIN pg_roles r ON r.oid=c.relowner WHERE r.rolname=current_user) AS owns_relations`);
      expect(privileges).toEqual([{ public_create: false, auth_usage: false, owns_relations: false }]);
      await expect(connection.database.query('SELECT count(*) FROM website_auth."user"')).rejects.toMatchObject({ code: '42501' });
    } finally { await connection.close(); }
    expect(connection.isClosed()).toBe(true);
  }, 30_000);
  it('completes two pinned owner snapshots across the exact migrated 154-relation schema with stable evidence and acknowledged rollback/close', async () => {
    const setup = await localSnapshotConnection('cp28_snapshot_owner');
    try {
      const directory = new URL('../migrations/', import.meta.url);
      const names = (await readdir(directory)).filter(name => /^\d+_[a-z0-9_]+\.sql$/u.test(name)).sort();
      const expected = await Promise.all(names.map(async name => ({ name, checksum: createHash('sha256')
        .update((await readFile(new URL(name, directory), 'utf8')).replace(/\r\n?/gu, '\n')).digest('hex') })));
      expect(await setup.database.query('SELECT name,checksum FROM app_schema_migrations ORDER BY name')).toEqual(expected);
    } finally { await setup.close(); }
    const history = new Map<string,string[]>(), connections: Awaited<ReturnType<typeof localSnapshotConnection>>[] = [];
    const connect = async () => { const connection = await localSnapshotConnection('cp28_snapshot_owner'); connections.push(connection); return connection; };
    const first = await readReaderStateSnapshot(connect, 30_000, { name: 'S0-empty', history });
    const second = await readReaderStateSnapshot(connect, 30_000, { name: 'S0-repeat', history });
    expect(first.storage?.relations).toHaveLength(154); expect(second.storage?.relations).toHaveLength(154); expect(history.size).toBe(154);
    expect(second.digest).toBe(first.digest); expect(second.storage?.metadataDigest).toBe(first.storage?.metadataDigest);
    expect(first.storage?.relations.every(row => row.owner === 'cp28_snapshot_owner' && row.metadata?.kind === 'r')).toBe(true);
    expect(second.storage?.relations.every(row => row.metadata === undefined)).toBe(true);
    for (const snapshot of [first, second]) {
      expect(snapshot.storage).toBeDefined();
      const phase = snapshot.storage!;
      expect(phase.allocatedBytes).toBe(phase.relations.reduce((sum, row) => sum + row.totalBytes, 0));
      expect(phase.totalRows).toBe(phase.relations.reduce((sum, row) => sum + row.rows, 0));
      for (const row of phase.relations) {
        expect(row.totalBytes).toBe(row.tableBytes + row.indexBytes);
        expect(row.tableBytes).toBe(row.heapMainBytes + row.heapFsmBytes + row.heapVmBytes + row.heapInitBytes + row.toastAndAuxBytes);
        expect(Number.isSafeInteger(row.tupleBytes) && row.tupleBytes >= 0 && Number.isSafeInteger(row.jsonBytes) && row.jsonBytes >= 0).toBe(true);
      }
    }
    console.info('CP28 local snapshot verification', JSON.stringify({ serverVersion: setup.serverVersion, relationCount: first.storage!.relations.length,
      totalRows: first.storage!.totalRows, snapshotDigest: first.digest, metadataDigest: first.storage!.metadataDigest, snapshots: 2 }));
    expect(connections).toHaveLength(2);
    for (const connection of connections) {
      expect(connection.calls[0]).toBe('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      expect(connection.calls).toContain("SET LOCAL statement_timeout = '10000ms'");
      expect(connection.calls).toContain("SET LOCAL lock_timeout = '2000ms'");
      expect(connection.calls.filter(sql => sql === 'ROLLBACK')).toHaveLength(1);
      expect(connection.calls.at(-1)).toBe('ROLLBACK'); expect(connection.isClosed()).toBe(true);
    }
  }, 75_000);
});
describe('CP28 inventory SQLSTATE regression, offline only', () => {
  it('rejects invalid opt-in configuration before creating a database connection', () => {
    const names = ['CP28_LOCAL_POSTGRES_SNAPSHOT_TEST','CP28_LOCAL_POSTGRES_PORT','CP28_LOCAL_POSTGRES_SENTINEL',
      'CP28_LOCAL_POSTGRES_OWNER_PASSWORD','CP28_LOCAL_POSTGRES_RUNTIME_PASSWORD'] as const;
    const previous = names.map(name => [name,process.env[name]] as const);
    try {
      process.env.CP28_LOCAL_POSTGRES_SNAPSHOT_TEST = 'I_ACKNOWLEDGE_LOCAL_DISPOSABLE_DATABASE';
      process.env.CP28_LOCAL_POSTGRES_PORT = '53125';
      process.env.CP28_LOCAL_POSTGRES_SENTINEL = 'cp28-local-snapshot-regression-v1:00000000-0000-0000-0000-000000000000';
      process.env.CP28_LOCAL_POSTGRES_OWNER_PASSWORD = 'offline-owner';
      process.env.CP28_LOCAL_POSTGRES_RUNTIME_PASSWORD = 'offline-runtime';
      expect(localPostgresConfiguration().port).toBe(53125);
      for (const [name,value] of [['CP28_LOCAL_POSTGRES_SNAPSHOT_TEST','false'],['CP28_LOCAL_POSTGRES_PORT','053125'],
        ['CP28_LOCAL_POSTGRES_PORT','65536'],['CP28_LOCAL_POSTGRES_PORT','5432@remote'],['CP28_LOCAL_POSTGRES_SENTINEL','production'],
        ['CP28_LOCAL_POSTGRES_OWNER_PASSWORD',''],['CP28_LOCAL_POSTGRES_RUNTIME_PASSWORD','offline-owner']] as const) {
        const saved=process.env[name]; process.env[name]=value;
        expect(()=>localPostgresConfiguration()).toThrow(); process.env[name]=saved;
      }
    } finally { for(const [name,value] of previous) { if(value===undefined) delete process.env[name]; else process.env[name]=value; } }
  });
  it('retains only the safe ambiguity code and does not expose message, detail, hint or cause', async () => {
    const mock = storageMock(sql => {
      if (sql === STORAGE_INVENTORY_SQL) throw Object.assign(new Error('postgresql://secret:password@private/private'), {
        code: '42725', detail: 'private row', hint: 'private SQL', cause: 'private cause' });
      return [];
    });
    let failure: unknown; try { await readReaderStateSnapshot(mock.connect, 30_000, { name: 'S0-empty', history: new Map() }); } catch (error) { failure = error; }
    expect(failure).toMatchObject({ diagnostic: { stage: 'inventory', table: null, code: '42725' }, cleanupFailures: [] });
    expect(validReaderSnapshotDiagnostic((failure as ReaderStateSnapshotError).diagnostic)).toBe(true);
    expect(String(failure)).not.toMatch(/secret|password|private/u);
    expect(JSON.stringify(failure)).not.toMatch(/secret|password|private|detail|hint|cause/u);
    expect(mock.calls.at(-1)).toBe('ROLLBACK'); expect(mock.close).toHaveBeenCalledTimes(1);
  });
});

describe('CP28 full-inventory controlled-latency regression', () => {
  it.each(['empty', 'S0', 'all-nonempty'] as const)('preserves the complete %s oracle at a deterministic 60ms per call', async fixture => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const mock = storageMock(), history = new Map<string,string[]>(), latencyMs = 60;
    if (fixture === 'S0') {
      mock.contents.set('public.app_schema_migrations', Array.from({length:62},(_,index)=>md5('migration-'+index)));
      mock.contents.set('public.scoring_profiles',[md5('seed')]);
    } else if (fixture === 'all-nonempty') for (const table of mock.contents.keys()) mock.contents.set(table,[md5(table)]);
    const delay=()=>new Promise<void>(resolve=>setTimeout(resolve,latencyMs));
    const connect=async()=>{
      await delay(); const connection=await mock.connect();
      return { database: { query: async <Row extends DatabaseRow>(sql:string,parameters:readonly unknown[]=[])=>{
        const rows=await connection.database.query<Row>(sql,parameters); await delay(); return rows;
      } }, close:async()=>{await delay();await connection.close();} };
    };
    const pending=readReaderStateSnapshot(connect,30_000,{name:'S0-empty',history});
    await vi.advanceTimersByTimeAsync(30_000); const result=await pending;
    expectStorageFixture(result,mock);
    expect(mock.calls.at(-1)).toBe('ROLLBACK');expect(mock.close).toHaveBeenCalledTimes(1);expect(history.size).toBe(154);
    expect(mock.calls).toHaveLength(fixture==='empty'?6:10);
    expect(result.storage!.elapsedMs).toBe(fixture==='empty'?360:600);
    console.info('CP28 controlled latency candidate',JSON.stringify({fixture,latencyMs,queries:mock.calls.length,
      snapshotWorkMs:result.storage!.elapsedMs,relations:result.storage!.relations.length,totalRows:result.storage!.totalRows,cleanupAcknowledged:true}));
  });
});
function expectStorageFixture(result:Awaited<ReturnType<typeof readReaderStateSnapshot>>,mock:ReturnType<typeof storageMock>) {
  const tables=Object.fromEntries(mock.contents);
  expect(result.digest).toBe(original(tables));
  expect(result.counts).toEqual([...mock.contents].map(([table,hashes])=>({table,rows:hashes.length,totalBytes:8192})));
  expect(result.storage?.allocatedBytes).toBe(154*8192);expect(result.storage?.databaseBytes).toBe(2000000);
  expect(result.storage?.totalRows).toBe([...mock.contents.values()].reduce((sum,hashes)=>sum+hashes.length,0));
  expect(result.storage?.relations).toEqual(STORAGE_RELATIONS.map((relation,index)=>{
    const hashes=mock.contents.get(relation.schema+'.'+relation.table)!;
    return {...relation,oid:index+1,owner:'test_owner',dependencies:[],
      metadata:{kind:'r',columns:['id:uuid:true:::'],constraints:['pk:PRIMARY KEY (id):true:false:false'],indexes:[]},
      rows:hashes.length,digest:md5([...hashes].sort().join('')),totalBytes:8192,tableBytes:8192,indexBytes:0,
      heapMainBytes:8192,heapFsmBytes:0,heapVmBytes:0,heapInitBytes:0,toastAndAuxBytes:0,tupleBytes:hashes.length*100,jsonBytes:hashes.length*120};
  }));
}

describe('CP28 tagged cursor completeness and fail-closed boundaries',()=>{
  it('rejects unexpected SQL in the storage query double',async()=>{
    const connection=await storageMock().connect();
    await expect(connection.database.query('SELECT unexpected_fixture_query')).rejects.toThrow('Unexpected storage fixture SQL.');
  });
  it('preserves independent per-relation multisets and bytes across interleaved pages and exact zero counts',async()=>{
    const mock=storageMock(),keys=[...mock.contents.keys()],sizes=[0,1,2,511,512,513,1031];
    for(const [index,size] of sizes.entries())mock.contents.set(keys[index],Array.from({length:size},(_,row)=>md5(String(row%7))));
    mock.reorder(rows=>rows.sort((a,b)=>String(a.digest).localeCompare(String(b.digest))||String(b.relation_key).localeCompare(String(a.relation_key))));
    const result=await readReaderStateSnapshot(mock.connect,30_000,{name:'S0-empty',history:new Map()});expectStorageFixture(result,mock);
    const declarations=mock.calls.filter(sql=>sql.startsWith('DECLARE'));
    expect(declarations).toHaveLength(1);expect(declarations[0]).toContain('DECLARE cp28_state_rows NO SCROLL');
    expect(declarations[0]).not.toContain("'"+keys[0]+"' AS relation_key");
    expect(declarations[0]).not.toMatch(/ORDER BY|DISTINCT|LIMIT|string_agg|json_agg/iu);
    expect(mock.calls.filter(sql=>sql===STORAGE_STATISTICS_SQL)).toHaveLength(1);
    expect(mock.calls.filter(sql=>sql.startsWith('FETCH'))).toHaveLength(Math.ceil(sizes.reduce((a,b)=>a+b,0)/512)+1);
    expect(mock.calls).toContain('CLOSE cp28_state_rows');expect(mock.close).toHaveBeenCalledTimes(1);
  });
  it('retains all154 empty relation digests and physical allocations without creating a cursor',async()=>{
    const mock=storageMock(),result=await readReaderStateSnapshot(mock.connect,30_000,{name:'S0-empty',history:new Map()});
    expectStorageFixture(result,mock);expect(mock.calls.some(sql=>/^(?:DECLARE|FETCH|CLOSE)/u.test(sql))).toBe(false);
    expect(mock.calls).toHaveLength(6);expect(mock.calls.at(-1)).toBe('ROLLBACK');
  });
  it.each(['stats-missing','stats-extra','stats-duplicate','stats-unknown','stats-negative','stats-table-cap','stats-total-cap',
    'tag-unknown','tag-empty','tag-overfull','digest','bytes','page-oversized','extra','missing','allocation'] as const)
  ('rejects %s without committing history or exposing an untrusted tag',async fault=>{
    const keys=STORAGE_RELATIONS.slice(0,3).map(row=>row.schema+'.'+row.table);
    const mock=storageMock((sql,rows)=>{
      if(sql===STORAGE_STATISTICS_SQL){
        if(fault==='stats-missing')return rows.slice(1);
        if(fault==='stats-extra')return [...rows,rows[0]];
        if(fault==='stats-duplicate')return rows.map((row,index)=>index===1?rows[0]:row);
        if(fault==='stats-unknown')return rows.map((row,index)=>index?row:{...row,relation_key:'private-tag'});
        if(fault==='stats-negative')return rows.map((row,index)=>index?row:{...row,rows:'-1'});
        if(fault==='stats-table-cap')return rows.map((row,index)=>index?row:{...row,rows:'200001'});
        if(fault==='stats-total-cap')return rows.map((row,index)=>index<6?{...row,rows:'200000'}:row);
        if(fault==='allocation')return rows.map((row,index)=>index?row:{...row,bytes:'16384'});
      }
      if(sql.startsWith('FETCH')&&sql.endsWith('cp28_state_rows')){
        if(!rows.length)return fault==='extra'?[{relation_key:keys[0],digest:md5('extra'),tuple_bytes:'100',json_bytes:'120'}]:rows;
        if(fault==='tag-unknown')return [{...rows[0],relation_key:'private-tag'},...rows.slice(1)];
        if(fault==='tag-empty')return [{...rows[0],relation_key:keys[2]},...rows.slice(1)];
        if(fault==='tag-overfull')return rows.map(row=>({...row,relation_key:keys[0]}));
        if(fault==='digest')return [{...rows[0],digest:'private-tag'},...rows.slice(1)];
        if(fault==='bytes')return [{...rows[0],tuple_bytes:'-1'},...rows.slice(1)];
        if(fault==='page-oversized')return [...rows,rows[0]];
        if(fault==='missing')return rows.slice(1);
      }return rows;
    });
    mock.contents.set(keys[0],Array(fault==='page-oversized'?600:1).fill(md5('first')) as string[]);
    mock.contents.set(keys[1],[md5('second')]);const history=new Map<string,string[]>();
    let failure:unknown;try{await readReaderStateSnapshot(mock.connect,30_000,{name:'S0-empty',history});}catch(error){failure=error;}
    expect(failure).toBeInstanceOf(ReaderStateSnapshotError);expect(JSON.stringify(failure)).not.toContain('private-tag');
    expect(history.size).toBe(0);expect(mock.calls.at(-1)).toBe('ROLLBACK');expect(mock.close).toHaveBeenCalledTimes(1);
    if(fault.startsWith('stats-'))expect(mock.calls.some(sql=>sql.startsWith('DECLARE'))).toBe(false);
  });
  it.each(['cursor-close','rollback','connection-close'] as const)('does not commit history when %s acknowledgment fails',async fault=>{
    const mock=storageMock((sql,rows)=>{if(sql===(fault==='cursor-close'?'CLOSE cp28_state_rows':fault==='rollback'?'ROLLBACK':''))throw new Error('fixture failure');return rows;});
    mock.contents.set('public.scoring_entities',[md5('one')]);
    if(fault==='connection-close')mock.close.mockRejectedValueOnce(new Error('fixture close failure'));
    const history=new Map<string,string[]>();await expect(readReaderStateSnapshot(mock.connect,30_000,{name:'S0-empty',history})).rejects.toBeInstanceOf(ReaderStateSnapshotError);
    expect(history.size).toBe(0);expect(mock.calls.at(-1)).toBe('ROLLBACK');expect(mock.close).toHaveBeenCalledTimes(1);
  });
  it.each(['statistics','fetch'] as const)('keeps the work deadline and cleanup reserve when %s stalls',async fault=>{
    vi.useFakeTimers({toFake:['setTimeout','clearTimeout','performance']});
    const mock=storageMock((sql,rows)=>((fault==='statistics'&&sql===STORAGE_STATISTICS_SQL)||(fault==='fetch'&&sql.startsWith('FETCH')))
      ?new Promise<DatabaseRow[]>(()=>undefined):rows);
    mock.contents.set('public.scoring_entities',[md5('one')]);const history=new Map<string,string[]>();
    const pending=readReaderStateSnapshot(mock.connect,30_000,{name:'S0-empty',history});
    const checked=expect(pending).rejects.toMatchObject({diagnostic:{stage:fault==='statistics'?'count':'fetch',table:null,code:null},cleanupFailures:[]});
    await vi.advanceTimersByTimeAsync(30_000);await checked;
    expect(history.size).toBe(0);expect(mock.calls.at(-1)).toBe('ROLLBACK');expect(mock.close).toHaveBeenCalledTimes(1);
  });
  it.each(['sort','final-serialization'] as const)('does not accept a snapshot after CPU time expires during %s',async stage=>{
    vi.useFakeTimers({toFake:['setTimeout','clearTimeout','performance']});
    const mock=storageMock(),digest=md5('cpu-tail'),history=new Map<string,string[]>();
    mock.contents.set('public.scoring_entities',[digest]);
    await readReaderStateSnapshot(mock.connect,30_000,{name:'S0-empty',history});
    const prior=[...history].map(([table,hashes])=>[table,[...hashes]]);
    mock.contents.set('public.scoring_entities',[digest,md5('unacknowledged-player')]);
    mock.contents.set('public.league_roster_capture_receipts',[md5('unacknowledged-receipt')]);
    mock.calls.length=0;mock.close.mockClear();
    const originalSort=Array.prototype.sort,originalStringify=JSON.stringify;
    const spy=stage==='sort'?vi.spyOn(Array.prototype,'sort').mockImplementation(function(this:unknown[],compare){
      const sorted=originalSort.call(this,compare);if(this.includes(digest))vi.advanceTimersByTime(20_000);return sorted;
    }):vi.spyOn(JSON,'stringify').mockImplementation(value=>{
      const serialized=originalStringify(value);
      if(Array.isArray(value)&&value.length===154&&value.every(row=>row&&typeof row.table==='string'&&typeof row.digest==='string'))vi.advanceTimersByTime(20_000);
      return serialized;
    });
    try{await expect(readReaderStateSnapshot(mock.connect,30_000,{name:'S0-empty',history})).rejects.toMatchObject({diagnostic:{stage:'timeout',code:null},cleanupFailures:[]});}
    finally{spy.mockRestore();}
    expect([...history]).toEqual(prior);expect(history.size).toBe(154);expect(mock.calls.at(-1)).toBe('ROLLBACK');expect(mock.close).toHaveBeenCalledTimes(1);
  });
});
