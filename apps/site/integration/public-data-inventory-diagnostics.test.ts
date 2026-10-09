import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { types } from '@neondatabase/serverless';
import ts from 'typescript';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { createPublicInventoryDiagnostics, type InventoryDiagnosticKind } from './public-data-inventory-diagnostics';
import { CLOSED_PROFILES, CONCURRENCY_PROFILE, GUARDS_PROFILE, INGESTION_PROFILE, JOURNEY_PROFILE, LATE_WRITE_PROFILE,
  LIVE_PROFILE, OFFICIAL_PROFILE, QUALIFICATION_CONTEXT_ENV, SELECTED_PROFILE, createQualificationContext,
  qualificationDigest, type QualificationContext, type QualificationProfile } from './qualification-profile';

const site = fileURLToPath(new URL('..', import.meta.url));
const kinds = ['inventory','capacity-same-season','capacity-cumulative','capacity-all-candidates','upgrade'] as const;
const allowed: Record<InventoryDiagnosticKind, QualificationProfile> = {
  inventory: 'data-period-inventory-v1', 'capacity-same-season': 'data-period-capacity-v1',
  'capacity-cumulative': 'data-period-capacity-v1', 'capacity-all-candidates': 'data-period-capacity-v1', upgrade: 'data-period-upgrade-v1',
};
const profiles: QualificationProfile[] = ['full',SELECTED_PROFILE,INGESTION_PROFILE,LIVE_PROFILE,JOURNEY_PROFILE,
  OFFICIAL_PROFILE,GUARDS_PROFILE,CONCURRENCY_PROFILE,LATE_WRITE_PROFILE,...CLOSED_PROFILES.map(entry => entry.profile)];
const secret = 'FICTIONAL_PRIVATE_SQL_HOST_PASSWORD_AND_PAYLOAD';
const sqlError = () => Object.assign(new Error(secret), { code: '42501', query: secret, parameters: [secret], cause: new Error(secret) });
const outbound = vi.fn(() => { throw new Error('OFFLINE_NETWORK_DENIED'); });
let directory: string, context: QualificationContext;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'public-inventory-diagnostic-'));
  context = await createQualificationContext(site, 'a'.repeat(40), randomUUID());
  vi.stubEnv(QUALIFICATION_CONTEXT_ENV, JSON.stringify(context));
  vi.stubEnv('PROJECTION_INTEGRATION_ARTIFACT_DIRECTORY', directory);
  vi.stubGlobal('fetch', outbound);
  vi.spyOn(http, 'request').mockImplementation(outbound);
  vi.spyOn(https, 'request').mockImplementation(outbound);
  vi.spyOn(net.Socket.prototype, 'connect').mockImplementation(outbound);
});
afterEach(async () => {
  expect(outbound).not.toHaveBeenCalled();
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); outbound.mockClear();
  await rm(directory, { recursive: true, force: true });
});
const filename = (kind: InventoryDiagnosticKind) => `public-period-${kind}-diagnostics.json`;
const read = async (kind: InventoryDiagnosticKind, path = directory) => JSON.parse(await readFile(join(path, filename(kind)), 'utf8'));
const version = { role: 'league_one_runtime', effective_role: 'league_one_runtime', server_version: '17.6 (abcdef1234)', server_version_num: '170006' };

it.each(kinds)('actually saves %s only in its closed profile or full, rejecting every other supported profile', async kind => {
  for (const profile of profiles) {
    const artifactDirectory = join(directory, profile); await mkdir(artifactDirectory);
    const selected = await createQualificationContext(site, 'b'.repeat(40), randomUUID(), profile);
    vi.stubEnv(QUALIFICATION_CONTEXT_ENV, JSON.stringify(selected));
    vi.stubEnv('PROJECTION_INTEGRATION_ARTIFACT_DIRECTORY', artifactDirectory);
    const diagnostics = createPublicInventoryDiagnostics(kind); diagnostics.database(version); diagnostics.acquired(); diagnostics.stage('complete');
    if (profile === 'full' || profile === allowed[kind]) {
      await diagnostics.finish([]);
      expect(await read(kind, artifactDirectory)).toEqual({ kind: 'public-period-inventory-diagnostics-v1', caseKind: kind,
        contextDigest: qualificationDigest(selected), runId: selected.runId, gitSha: selected.gitSha, profile,
        stage: 'complete', acquisitions: 1, elapsedMs: expect.any(Number),
        databaseVersion: { serverVersion: '17.6 (abcdef1234)', serverVersionNum: 170006 }, firstFailure: null });
    } else {
      await expect(diagnostics.finish([])).rejects.toThrow('Public inventory proof failed at complete (unexpected).');
      expect(await readdir(artifactDirectory)).toEqual([]);
    }
  }
});

it('uses distinct fixed artifacts for every inventory case in one full run without replacing the old writer', async () => {
  for (const kind of kinds) await createPublicInventoryDiagnostics(kind).finish([]);
  expect((await readdir(directory)).sort()).toEqual(kinds.map(filename).sort());
  for (const kind of kinds) expect(await read(kind)).toMatchObject({ contextDigest: qualificationDigest(context), profile: 'full' });
  const existing = await readFile(join(directory, filename('inventory')), 'utf8');
  await expect(createPublicInventoryDiagnostics('inventory').finish([])).rejects.toThrow('Public inventory proof failed at setup (unexpected).');
  expect(await readFile(join(directory, filename('inventory')), 'utf8')).toBe(existing);
});

it('keeps the first sanitized proof failure while attempting failed rollback, both closes and a real evidence save', async () => {
  const diagnostics = createPublicInventoryDiagnostics('upgrade'); diagnostics.stage('history');
  const first = diagnostics.fail(sqlError()), trace: string[] = [];
  const failCleanup = async (step: string) => { trace.push(step); throw Object.assign(new Error(secret), { code: '57014' }); };
  const result = await diagnostics.finish([
    () => { trace.push('restore'); }, () => failCleanup('rollback'), () => failCleanup('owner-close'), () => failCleanup('runtime-close'),
  ]).catch(error => error);
  expect(result).toBe(first); expect(first.message).toBe('Public inventory proof failed at history (sql).');
  expect(first.cause).toBeUndefined(); expect(JSON.stringify(first)).not.toContain(secret); expect(first.stack).not.toContain(secret);
  expect(trace).toEqual(['restore','rollback','owner-close','runtime-close']);
  const artifact = await readFile(join(directory, filename('upgrade')), 'utf8'); expect(artifact).not.toContain(secret);
  expect(JSON.parse(artifact)).toMatchObject({ stage: 'cleanup', firstFailure: { stage: 'history', category: 'sql', sqlState: '42501' } });
});

it('fails on cleanup alone, still closes every remaining resource and stores only its bounded category', async () => {
  const diagnostics = createPublicInventoryDiagnostics('inventory'); diagnostics.stage('complete');
  const close = vi.fn(async () => {});
  await expect(diagnostics.finish([async () => { throw sqlError(); }, close])).rejects.toThrow('Public inventory proof failed at cleanup (sql).');
  expect(close).toHaveBeenCalledOnce();
  expect(await read('inventory')).toMatchObject({ firstFailure: { stage: 'cleanup', category: 'sql', sqlState: '42501' } });
});

it('preserves the primary failure when the actual artifact writer also fails and emits only a fixed marker', async () => {
  await createPublicInventoryDiagnostics('upgrade').finish([]);
  const before = await readFile(join(directory, filename('upgrade')), 'utf8');
  const diagnostics = createPublicInventoryDiagnostics('upgrade'); diagnostics.stage('migration');
  const first = diagnostics.fail(sqlError()), stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  await expect(diagnostics.finish([async () => { throw new Error(secret); }])).rejects.toBe(first);
  expect(stderr).toHaveBeenCalledExactlyOnceWith('PUBLIC_PERIOD_DIAGNOSTIC_ARTIFACT_WRITE_FAILED\n');
  expect(await readFile(join(directory, filename('upgrade')), 'utf8')).toBe(before);
});

it('does not invoke untrusted error accessors or serialize unrecognized state, message, query or cause', async () => {
  const access = vi.fn(() => { throw new Error(secret); });
  const diagnostics = createPublicInventoryDiagnostics('inventory'); diagnostics.stage('readback');
  const error = Object.defineProperties({}, { code: { get: access }, name: { get: access }, message: { get: access }, cause: { get: access } });
  const first = diagnostics.fail(error); diagnostics.fail(sqlError());
  await expect(diagnostics.finish([])).rejects.toBe(first); expect(access).not.toHaveBeenCalled();
  expect(await read('inventory')).toMatchObject({ firstFailure: { stage: 'readback', category: 'unexpected', sqlState: null } });
  expect(await readFile(join(directory, filename('inventory')), 'utf8')).not.toContain(secret);
});

it.each([
  { ...version, role: 'owner' }, { ...version, effective_role: 'owner' }, { ...version, server_version: secret },
  { ...version, server_version_num: '170007' }, { ...version, server_version_num: 170006 },
])('refuses unsafe or inconsistent version evidence %# without exposing its input', async row => {
  const diagnostics = createPublicInventoryDiagnostics('inventory');
  expect(() => diagnostics.database(row)).toThrow('Public inventory proof failed at setup (unexpected).');
  await expect(diagnostics.finish([])).rejects.toThrow('Public inventory proof failed at setup (unexpected).');
  const artifact = await readFile(join(directory, filename('inventory')), 'utf8'); expect(artifact).not.toContain(secret);
  expect(JSON.parse(artifact).databaseVersion).toBeNull();
});

it.each(['missing','malformed','wrong-context-digest'] as const)('refuses %s binding before creating an artifact', async mode => {
  if (mode === 'missing') delete process.env[QUALIFICATION_CONTEXT_ENV];
  else vi.stubEnv(QUALIFICATION_CONTEXT_ENV, mode === 'malformed' ? secret : JSON.stringify({ ...context, profileDigest: '0'.repeat(64) }));
  await expect(createPublicInventoryDiagnostics('inventory').finish([])).rejects.toThrow('Public inventory proof failed at setup (unexpected).');
  expect(await readdir(directory)).toEqual([]);
});


it('executes the maintained constraint oracle with installed driver array decoding and a real assertion failure', async () => {
  const source = await readFile(new URL('./public-data-intake.integration-case.ts', import.meta.url), 'utf8');
  const tree = ts.createSourceFile('inventory.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const blocks: ts.Block[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isBlock(node) && node.statements.some(statement => ts.isVariableStatement(statement)
      && statement.declarationList.declarations.some(declaration => declaration.name.getText(tree) === 'uniqueColumns'))) blocks.push(node);
    ts.forEachChild(node, visit);
  };
  visit(tree); expect(blocks).toHaveLength(1);
  const block = blocks[0], index = block.statements.findIndex(statement => ts.isVariableStatement(statement)
    && statement.declarationList.declarations.some(declaration => declaration.name.getText(tree) === 'uniqueColumns'));
  // Only the maintained stage, catalog query and assertion are evaluated. This
  // test exercises the installed decoder boundary; it never executes SQL.
  const body = block.statements.slice(index - 1, index + 2).map(statement => statement.getText(tree)).join('\n');
  const oracle = new Function('f','diagnostics','expect', ts.transpile(
    'return (async () => {' + body + '})();', { target: ts.ScriptTarget.ES2022 },
  )) as (fixture: unknown, diagnostics: ReturnType<typeof createPublicInventoryDiagnostics>, assertion: typeof expect) => Promise<void>;
  const wire = '{intake_id,season,external_league_id,native_week}';
  const textArray = types.getTypeParser(1009, 'text')(wire), nameArray = types.getTypeParser(1003, 'text')(wire);
  expect(textArray).toEqual(['intake_id','season','external_league_id','native_week']);
  expect(typeof nameArray).toBe('string');
  const fixture = (columns: unknown) => ({ database: { query: vi.fn(async (sql: string) => {
    expect(sql).toContain('array_agg(attribute.attname::text ORDER BY key.ordinality)');
    return [{ columns }];
  }) } });
  const diagnostics = createPublicInventoryDiagnostics('upgrade'), repaired = fixture(textArray);
  await oracle(repaired, diagnostics, expect); expect(repaired.database.query).toHaveBeenCalledOnce();
  let failure: unknown;
  try { await oracle(fixture(nameArray), diagnostics, expect); } catch (error) { failure = error; }
  expect(failure).toBeDefined(); expect(Object.getOwnPropertyDescriptor(failure, 'name')).toBeUndefined();
  const safe = diagnostics.fail(failure);
  expect(safe.message).toBe('Public inventory proof failed at permissions-constraint (assertion).');
  await expect(diagnostics.finish([])).rejects.toBe(safe);
  expect(await read('upgrade')).toMatchObject({ stage: 'permissions-constraint',
    firstFailure: { stage: 'permissions-constraint', category: 'assertion', sqlState: null } });
});

it.each(['own-accessors','inherited-accessors','proxy','native-error-prototype-proxy','revoked-proxy'] as const)(
  'does not consult caller-controlled names or prototype traps for %s', async mode => {
    const access = vi.fn(() => { throw new Error(secret); });
    const accessors = { code: { get: access }, name: { get: access }, message: { get: access }, cause: { get: access } };
    const traps = { get: access, getPrototypeOf: access, getOwnPropertyDescriptor: access };
    let error: unknown;
    if (mode === 'own-accessors') error = Object.defineProperties(new Error(), accessors);
    else if (mode === 'inherited-accessors') error = Object.create(Object.defineProperties({}, accessors));
    else if (mode === 'native-error-prototype-proxy') error = Object.setPrototypeOf(new Error(), new Proxy({}, traps));
    else if (mode === 'revoked-proxy') { const proxy = Proxy.revocable(new Error(), traps); proxy.revoke(); error = proxy.proxy; }
    else error = new Proxy(new Error(), traps);
    const diagnostics = createPublicInventoryDiagnostics('upgrade'); diagnostics.stage('permissions-role');
    const safe = diagnostics.fail(error);
    expect(safe.message).toBe('Public inventory proof failed at permissions-role (unexpected).');
    await expect(diagnostics.finish([])).rejects.toBe(safe); expect(access).not.toHaveBeenCalled();
    const artifact = await readFile(join(directory, filename('upgrade')), 'utf8'); expect(artifact).not.toContain(secret);
    expect(JSON.parse(artifact)).toMatchObject({ firstFailure: { stage: 'permissions-role', category: 'unexpected', sqlState: null } });
  },
);

it('retains a real assertion stage through later SQL, cleanup and artifact-write failures without exposing assertion values', async () => {
  await createPublicInventoryDiagnostics('upgrade').finish([]);
  const before = await readFile(join(directory, filename('upgrade')), 'utf8');
  let failure: unknown;
  try { expect({ source: secret }).toEqual({ source: 'expected' }); } catch (error) { failure = error; }
  const diagnostics = createPublicInventoryDiagnostics('upgrade'); diagnostics.stage('permissions-constraint');
  const safe = diagnostics.fail(failure); expect(diagnostics.fail(sqlError())).toBe(safe);
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true), close = vi.fn(async () => {});
  await expect(diagnostics.finish([async () => { throw sqlError(); }, close])).rejects.toBe(safe);
  expect(close).toHaveBeenCalledOnce(); expect(stderr).toHaveBeenCalledExactlyOnceWith('PUBLIC_PERIOD_DIAGNOSTIC_ARTIFACT_WRITE_FAILED\n');
  expect(safe.message).toBe('Public inventory proof failed at permissions-constraint (assertion).');
  expect(safe.cause).toBeUndefined(); expect(safe.stack).not.toContain(secret); expect(JSON.stringify(safe)).not.toContain(secret);
  expect(await readFile(join(directory, filename('upgrade')), 'utf8')).toBe(before);
});
