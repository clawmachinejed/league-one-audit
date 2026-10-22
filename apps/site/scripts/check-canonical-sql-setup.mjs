#!/usr/bin/env node
// Opt-in LOCAL installation diagnostic. Never connects to an existing database.
// Usage: node scripts/check-canonical-sql-setup.mjs --pg-bin=<trusted PostgreSQL 18 bin directory>
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';

const site = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
assert(args.length >= 1 && args.length <= 2 && args[0].startsWith('--pg-bin='));
const reproduce = args[1] === '--reproduce-fixture-defect';
const nativeTiming = ['--reproduce-native-timing', '--verify-native-timing'].includes(args[1]) ? args[1] : null;
const canonicalSuite = args[1] === '--verify-canonical-suite';
const arrayAppend = args[1] === '--reproduce-canonical-array-append';
assert(args.length === 1 || reproduce || nativeTiming || canonicalSuite || arrayAppend, 'Unknown diagnostic argument');
const binary = realpathSync(args[0].slice('--pg-bin='.length));
const executable = name => join(binary, name + (process.platform === 'win32' ? '.exe' : ''));
const sha = value => createHash('sha256').update(value).digest('hex');
const sources = new Map();
function source(path) {
  const value = readFileSync(join(site, path), 'utf8').replace(/\r\n/g, '\n');
  const previous = sources.get(path);
  if (previous) assert.equal(sha(value), previous.sha256, 'Source changed during validation');
  sources.set(path, { sha256: sha(value), bytes: Buffer.byteLength(value) });
  return value;
}
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  ['systemroot', 'windir', 'temp', 'tmp', 'path'].includes(key.toLowerCase())));
const host = '127.0.0.1';
async function freePort(port = 0) {
  const probe = createServer();
  await new Promise((ok, no) => { probe.once('error', no); probe.listen(port, host, ok); });
  const actual = probe.address().port;
  await new Promise((ok, no) => probe.close(error => error ? no(error) : ok()));
  return actual;
}
const port = await freePort();
const parent = join(site, 'test-results/canonical-standings/local-sql-setup');
mkdirSync(parent, { recursive: true });
const directory = mkdtempSync(join(parent, 'attempt-'));
const data = join(directory, 'data');
const passwordFile = join(directory, 'bootstrap-password.txt');
const admin = 'l1_setup_cluster_admin', owner = 'l1_setup_owner';
const password = randomBytes(32).toString('hex'), ownerPassword = randomBytes(32).toString('hex');
const sentinel = randomUUID();
const report = { kind: 'canonical-local-sql-setup-v1', startedAt: new Date().toISOString(),
  mode: arrayAppend ? 'canonical-array-append-expression-only' : canonicalSuite ? 'complete-local-canonical-suite' : nativeTiming ?? (reproduce ? 'original-defect-reproduction' : 'complete-local-setup'), host, port, sentinel,
  cloudCalls: 0, paidRuns: 0, hostedQualification: false, steps: [], status: 'running', cleanup: false };
let stage = 'preflight', started = false;
const additionalSecrets = [];
const scrub = value => [password, ownerPassword, ...additionalSecrets].reduce((text, secret) => text.replaceAll(secret, '[LOCAL_SECRET]'), String(value ?? ''));
function command(name, arguments_, options = {}) {
  const result = spawnSync(executable(name), arguments_, { env, encoding: 'utf8', windowsHide: true,
    timeout: 60000, maxBuffer: 8 * 1024 * 1024, ...options });
  return result;
}
function sql(database, text, label, { adminLogin = false, expectError = null } = {}) {
  stage = label;
  const startedAt = Date.now();
  const result = command('psql', ['-X', '-qAt', '-h', host, '-p', String(port), '-U', adminLogin ? admin : owner,
    '-d', database, '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'], {
    env: { ...env, PGPASSWORD: adminLogin ? password : ownerPassword, PGCONNECT_TIMEOUT: '5' },
    input: "SET statement_timeout='60s'; SET check_function_bodies=on;\n" + text });
  const log = scrub(result.stderr);
  writeFileSync(join(directory, String(report.steps.length).padStart(3, '0') + '-' + label + '.log'), log);
  report.steps.push({ label, database, passed: expectError ? result.status !== 0 && log.includes(expectError) : result.status === 0,
    expectedErrorMarker: expectError, durationMs: Date.now() - startedAt });
  assert(report.steps.at(-1).passed && !result.error, `${label} failed; see diagnostic receipt/log`);
  return result.stdout.trim();
}
function migrations(database, files) {
  for (const name of files) {
    const body = source('migrations/' + name), checksum = sha(body);
    sql(database, `BEGIN; SELECT pg_advisory_xact_lock(hashtext('league-one-schema-migrations'));\n${body}\n` +
      `INSERT INTO app_schema_migrations(name,checksum) VALUES('${name}','${checksum}'); COMMIT;`, 'migration-' + name.slice(0, 3));
  }
}
function provision(database, names = ['runtime', 'account', 'auth']) {
  for (const name of names) sql(database, source(`scripts/provision-${name}-role.sql`), 'provision-' + name);
}
function arrayAppendChecks(database) {
  const migration = source('migrations/068_canonical_standings_acceptance.sql');
  const declaration = /keys text\[\]:=(ARRAY\[[^\]]+\]);/.exec(migration);
  assert(declaration, 'Exact canonical key declaration missing');
  assert(migration.includes("THEN keys:=keys||'legacyInput'; END IF;"), 'Original ambiguous append is absent');
  const expected = [...declaration[1].matchAll(/'([^']+)'/g)].map(match => match[1]);
  assert.equal(expected.length, 17); assert(!expected.includes('legacyInput'));
  sql(database, `DO $$ DECLARE keys text[]:=${declaration[1]}; BEGIN keys:=keys||'legacyInput'; END; $$;`,
    'original-canonical-array-append', { expectError: '22P02: malformed array literal: "legacyInput"' });
  const corrected = JSON.parse(sql(database, `SELECT array_to_json(keys||ARRAY['legacyInput'])
    FROM (SELECT ${declaration[1]} AS keys) original;`, 'explicit-canonical-array-append'));
  assert.deepEqual(corrected, [...expected, 'legacyInput']);
  report.expression = { source: 'migrations/068_canonical_standings_acceptance.sql',
    sourceSha256: sources.get('migrations/068_canonical_standings_acceptance.sql').sha256,
    original: "keys||'legacyInput'", originalSqlState: '22P02', originalMessage: 'malformed array literal: "legacyInput"',
    corrected: "keys||ARRAY['legacyInput']", originalKeys: expected, correctedKeys: corrected,
    fullCaseExecuted: false, applicationMigrationsInstalled: false };
}
function createDatabase(database) {
  assert(/^l1_setup_(fresh|upgrade)_[0-9a-f]{8}$/.test(database));
  sql('postgres', `CREATE DATABASE ${database} OWNER ${owner}; COMMENT ON DATABASE ${database} IS '${sentinel}';`, 'create-' + database, { adminLogin: true });
  const identity = JSON.parse(sql(database, `SELECT json_build_object('database',current_database(),'user',session_user,
    'host',host(inet_server_addr()),'port',inet_server_port(),'version',current_setting('server_version_num'),
    'sentinel',shobj_description(oid,'pg_database'),'superuser',(SELECT rolsuper FROM pg_roles WHERE rolname=session_user))
    FROM pg_database WHERE datname=current_database();`, 'identity-' + database));
  assert.deepEqual(identity, { database, user: owner, host, port, version: report.versionNum, sentinel, superuser: false });
  sql(database, 'DROP SCHEMA public; CREATE SCHEMA public; REVOKE CREATE ON SCHEMA public FROM PUBLIC;', 'empty-schema-initialization');
  sql(database, 'CREATE TABLE app_schema_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now());', 'ledger-' + database);
}
const quote = value => "'" + JSON.stringify(value).replaceAll("'", "''") + "'::jsonb";
const identityTables = ['league_source_connections', 'league_source_mapping_revisions', 'league_source_connection_history', 'league_season_teams'];
function legacySnapshot(database) {
  const additions = "ARRAY['native_namespace','source_league_namespace','previous_native_namespace','canonical_registration_context']";
  return JSON.parse(sql(database, 'SELECT jsonb_build_object(' + identityTables.map(name =>
    `'${name}',(SELECT jsonb_agg(to_jsonb(r)-${additions} ORDER BY id) FROM ${name} r)`).join(',') + ');', 'legacy-snapshot'));
}
function fixtureChecks(database) {
  const registry = JSON.parse(sql(database, 'SELECT public.canonical_standings_fixture_registry();', 'registry-execute'));
  // Load the maintained TypeScript fixture source through the existing tsx dependency; no copied oracle.
  const fixturePath = 'integration/canonical-standings-fixtures.ts'; source(fixturePath);
  const exported = spawnSync(process.execPath, ['--conditions=react-server', '--import', 'tsx', '--input-type=module', '-e',
    `globalThis.fetch=()=>{throw Error('Network disabled')}; const m=await import('./integration/canonical-standings-fixtures.ts');
    const deliveries=m.STANDINGS_FIXTURES.map(fixture=>{
      const mapping={connectionId:'11111111-1111-4111-8111-111111111111',leagueSeasonId:'22222222-2222-4222-8222-222222222222',
        revisionId:'33333333-3333-4333-8333-333333333333',generation:1,sourceNamespace:fixture.sourceNamespace,
        scope:{provider:fixture.sourceLeague.provider,leagueKey:fixture.leagueKey,externalLeagueId:fixture.sourceLeague.nativeId,
          season:2026,nativeNamespace:fixture.sourceLeague.nativeNamespace}};
      const fence={jobKey:'local-verifier-only',workerId:'local-verifier-only',generation:1,deadlineAt:'2026-02-01T00:00:10.000Z'};
      const attempt={id:'44444444-4444-4444-8444-444444444444',scopeId:'55555555-5555-4555-8555-555555555555',
        ordinal:1,expectedGeneration:0,nonce:'66666666-6666-4666-8666-666666666666'};
      return m.buildFixtureStandingsDelivery(fixture,mapping,attempt,fence,
        {captureId:'77777777-7777-4777-8777-777777777777',checkedAt:'2026-02-01T00:00:00.000Z'});
    }); console.log(JSON.stringify({fixtures:m.STANDINGS_FIXTURES,deliveries}));`],
    { cwd: site, env, encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
  assert.equal(exported.status, 0, 'Maintained fixture export failed');
  const exportedData = JSON.parse(exported.stdout), expected = exportedData.fixtures;
  assert.equal(expected.length, 18); assert.deepEqual(registry, expected);
  for (const [index, delivery] of exportedData.deliveries.entries()) {
    const verified = JSON.parse(sql(database, `SELECT public.verify_fixture_standings_delivery(${quote(delivery)});`, 'fixture-verifier-' + expected[index].id));
    assert.deepEqual(verified.canonicalValue, delivery.canonicalValue);
    assert.deepEqual(verified.coverage, delivery.coverage);
    assert.deepEqual(verified.nativeSourceRef, delivery.nativeSourceRef);
  }
  const complete = exportedData.deliveries[expected.findIndex(value => value.id === 'alpha-complete')];
  const duplicates = structuredClone(complete.canonicalValue);
  duplicates.teams = [duplicates.teams[0], { ...duplicates.teams[0], sourceOrdinal: 1 }];
  sql(database, `SELECT public.validate_canonical_standings_value(${quote(duplicates)},'fixture-sports','${complete.policy.teamNamespace}');`,
    'canonical-duplicate-rejection', { expectError: 'P0001: duplicate canonical standings team' });
  const cases = [
    [{ x: 0 }, 'rank', 'invalid', null], [{ x: 1 }, 'rank', 'known', 1], [{ x: 0 }, 'count', 'known', 0],
    [{ x: -1 }, 'count', 'invalid', null], [{ x: 1.5 }, 'count', 'invalid', null],
    [{ x: Number.MAX_SAFE_INTEGER }, 'rank', 'known', Number.MAX_SAFE_INTEGER],
    [{ x: Number.MAX_SAFE_INTEGER + 1 }, 'rank', 'invalid', null],
    [{}, 'count', 'absent', null], [{ x: null }, 'count', 'null', null],
    [{ x: '0' }, 'points', 'known', '0'], [{ x: '-0.25' }, 'points', 'known', '-0.25'],
    [{ x: '01.50' }, 'points', 'invalid', null], [{ x: '-0' }, 'points', 'invalid', null],
    [{ x: '1.00' }, 'points', 'invalid', null], [{ x: '1'.repeat(1025) }, 'points', 'invalid', null],
    [{ x: '1' }, 'rank', 'invalid', null], [[], 'count', 'invalid', null], [{ x: true }, 'count', 'invalid', null],
  ];
  const values = cases.map(([parent_, kind]) => `public.canonical_standings_fixture_fact(${quote(parent_)},'x','${kind}')`);
  const actual = JSON.parse(sql(database, 'SELECT jsonb_build_array(' + values.join(',') + ');', 'numeric-boundaries'));
  assert.deepEqual(actual, cases.map(([, , state, value]) => ({ state, value })));
  const privateSignatures = source('integration/canonical-standings-fixture-policy.sql').split('-- Every helper and policy remains private')[1]
    .match(/'public\.[a-z_]+\([^']*\)'/g);
  assert.equal(privateSignatures.length, 10);
  const exposed = sql(database, `SELECT count(*) FROM unnest(ARRAY[${privateSignatures.join(',')}]) signature,
    unnest(ARRAY['league_one_runtime','league_one_account','league_one_auth']) role_name
    WHERE has_function_privilege(role_name,signature,'EXECUTE');`, 'private-helper-permissions');
  assert.equal(exposed, '0');
  report.steps.push({ label: 'fixture-assertions', database, passed: true, registryEntries: 18,
    completeRegistryParity: true, verifierCases: 18, canonicalDuplicateRejected: true, numericCases: cases.length, privateRoleChecks: 30 });
}
async function nativeTimingProgram() {
  const assert = (await import('node:assert/strict')).default;
  const { readFileSync } = await import('node:fs');
  const { createHash, randomUUID } = await import('node:crypto');
  const { Socket } = await import('node:net');
  const { setTimeout: delay } = await import('node:timers/promises');
  const { stripTypeScriptTypes } = await import('node:module');
  const { Client } = await import('@neondatabase/serverless');
  const { createJobMethods } = await import('./lib/projections/adapters/neon/jobs.ts');
  const { createPublicIntakeStore, createLeagueAdministrationStore } = await import('./lib/league-administration/store.ts');
  const { runPublicIntakeStep } = await import('./lib/league-administration/public-intake.ts');
  const { capturePublicSleeperIdentity, capturePublicSleeperLeagueList, capturePublicSleeperCore } = await import('./lib/sleeper.ts');
  const { PUBLIC_INTAKE_JOB } = await import('./lib/league-administration/public-intake-contracts.ts');
  const config = JSON.parse(process.env.L1_LOCAL_TIMING_CONTEXT);
  delete process.env.L1_LOCAL_TIMING_CONTEXT;
  const moduleText = readFileSync('integration/canonical-standings.qualification-case.ts', 'utf8').replace(/\r\n/g, '\n');
  assert.equal(createHash('sha256').update(moduleText).digest('hex'), config.moduleSha256);
  const fixtureText = moduleText.slice(moduleText.indexOf('const nativeSources ='), moduleText.indexOf('/** Source candidate'));
  const { nativeSources, nativeLeague, nativeRosters } = new Function(stripTypeScriptTypes(fixtureText) + '\nreturn { nativeSources, nativeLeague, nativeRosters };')();
  const loopStart = moduleText.indexOf('    const started = Date.now(), before = requests.length;');
  const loopEnd = moduleText.indexOf('    const mapping = await administration.readSourceMapping', loopStart);
  assert(loopStart > 0 && loopEnd > loopStart);
  const loopSource = moduleText.slice(loopStart, loopEnd);
  assert(loopSource.includes('225_000') && loopSource.includes('AbortSignal.timeout(20_000)'));
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const runLoop = new AsyncFunction('requestId', 'dependencies', 'requests', 'nativeStepDurationsMs', 'runPublicIntakeStep', 'delay', 'expect', loopSource);
  const expect = (actual, message) => ({
    toBe: expected => assert.equal(actual, expected, message),
    toBeLessThan: expected => assert(actual < expected, message),
    toMatchObject: expected => { for (const [key, value] of Object.entries(expected)) assert.deepEqual(actual[key], value, message); },
  });
  const socket = new Socket();
  const client = new Client({ host: '127.0.0.1', port: config.port, database: config.database,
    user: 'league_one_runtime', password: config.password, ssl: false, stream: socket,
    application_name: 'canonical-native-timing-local', connectionTimeoutMillis: 5000,
    statement_timeout: 10000, query_timeout: 15000, idle_in_transaction_session_timeout: 30000 });
  client.on('error', () => {});
  const query = async (statement, parameters = [], options = {}) => {
    options.signal?.throwIfAborted();
    const result = await client.query(statement, [...parameters]);
    options.signal?.throwIfAborted(); return (Array.isArray(result) ? result.at(-1) : result).rows;
  };
  const database = { enabled: true, query, queryAfterLock: async (statement, parameters, lock, options = {}) => {
    options.signal?.throwIfAborted(); await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    try {
      const locked = await query(lock.statement, lock.parameters, options);
      const result = await query(statement, parameters, options);
      if (lock.verifyAfter) await query(lock.verifyAfter.statement, lock.verifyAfter.parameters, options);
      options.signal?.throwIfAborted(); await client.query('COMMIT'); return [locked, result];
    } catch (error) { await client.query('ROLLBACK'); throw error; }
  } };
  const requests = [], nativeStepDurationsMs = [], journeys = [];
  let allowedNative = null, forbiddenRequests = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input)), source = allowedNative;
    if (url.origin !== 'https://api.sleeper.app' || !source || (init?.method ?? 'GET') !== 'GET') {
      forbiddenRequests++; throw new Error('Local timing provider tripwire');
    }
    let payload;
    if (url.pathname === `/v1/user/${source.username}`) payload = { user_id: source.manager, username: source.username, display_name: source.username };
    else if (url.pathname === `/v1/user/${source.manager}/leagues/nfl/2026`) payload = [nativeLeague(source)];
    else if (url.pathname === `/v1/league/${source.id}`) payload = nativeLeague(source);
    else if (url.pathname === `/v1/league/${source.id}/rosters`) payload = nativeRosters(source.manager);
    else { forbiddenRequests++; throw new Error('Unregistered local timing fixture path'); }
    requests.push({ path: url.pathname, at: new Date().toISOString() });
    return new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } });
  };
  const snapshot = async () => (await query(`SELECT clock_timestamp() AS database_now, job_key,state,scheduled_for,completed_at,attempt_count,lease_until,
    (SELECT max(admitted_at) FROM public_data_dispatches) AS last_admitted_at
    FROM projection_jobs WHERE job_key=$1`, [PUBLIC_INTAKE_JOB]))[0] ?? null;
  try {
    await client.connect(); assert.equal(socket.remoteAddress, '127.0.0.1'); assert.equal(socket.remotePort, config.port);
    const [identity] = await query(`SELECT current_database() AS database,current_user,session_user,host(inet_server_addr()) AS host,
      inet_server_port() AS port,current_setting('server_version_num') AS version,shobj_description(d.oid,'pg_database') AS sentinel,
      r.rolsuper,r.rolcreatedb,r.rolcreaterole,r.rolreplication,r.rolbypassrls,r.rolcanlogin,
      EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid) AS memberships
      FROM pg_database d JOIN pg_roles r ON r.rolname=current_user WHERE d.datname=current_database()`);
    assert.deepEqual(identity, { database: config.database, current_user: 'league_one_runtime', session_user: 'league_one_runtime', host: '127.0.0.1',
      port: config.port, version: config.version, sentinel: config.sentinel, rolsuper: false, rolcreatedb: false, rolcreaterole: false,
      rolreplication: false, rolbypassrls: false, rolcanlogin: true, memberships: false });
    const intake = createPublicIntakeStore(database), administration = createLeagueAdministrationStore(database);
    const dependencies = { intake, administration, jobs: createJobMethods(database),
      source: { identity: capturePublicSleeperIdentity, leagues: capturePublicSleeperLeagueList,
        core: (external, family, signal, witness) => capturePublicSleeperCore(external, family, signal, undefined, witness) } };
    const journey = async (source, index) => {
      allowedNative = source; const requestId = randomUUID(); await intake.submit({ id: requestId, username: source.username, seasons: [2026] });
      const result = { index, requestId, startedAt: new Date().toISOString(), initialJob: await snapshot(), statuses: {}, progress: [], passed: false };
      const observed = async (...args) => {
        const value = await runPublicIntakeStep(...args);
        result.statuses[value.status] = (result.statuses[value.status] ?? 0) + 1;
        if (value.status !== 'busy' && value.status !== 'backoff') {
          const progress = { resource: value.resource, status: value.status, providerRequests: value.providerRequests,
            at: new Date().toISOString(), job: await snapshot() }; result.progress.push(progress);
          console.log(JSON.stringify({ kind: 'native-timing-stage', index, ...progress }));
        }
        return value;
      };
      try { await runLoop(requestId, dependencies, requests, nativeStepDurationsMs, observed, delay, expect); result.passed = true; }
      catch (error) { result.failure = { name: error.name, message: error.message }; }
      result.finishedAt = new Date().toISOString(); result.finalJob = await snapshot(); journeys.push(result); return result;
    };
    const setupStartedAt = Date.now();
    const first = await journey(nativeSources[0], 1); assert(first.passed, 'Initial native timing journey failed');
    let cooldown = null, nativeSetupSegmentMs = Date.now() - setupStartedAt;
    if (config.corrected) {
      const start = moduleText.indexOf('    // BEGIN canonical native fixture cooldown');
      const end = moduleText.indexOf('    // END canonical native fixture cooldown', start);
      assert(start > 0 && end > start, 'Missing actual qualification cooldown fragment');
      const fragment = moduleText.slice(start, end);
      const state = { completedRequestId: first.requestId, cooldown: null };
      await new AsyncFunction('q', 'delay', 'expect', 'PUBLIC_INTAKE_JOB', 'nativeTiming', fragment)(query, delay, expect, PUBLIC_INTAKE_JOB, state);
      cooldown = state.cooldown;
      nativeSetupSegmentMs = Date.now() - setupStartedAt;
      assert(nativeSetupSegmentMs < 420000, 'Native setup segment exceeded unchanged420s allowance');
      console.log(JSON.stringify({ kind: 'native-timing-cooldown', cooldown }));
    }
    const second = await journey(nativeSources[1], 2);
    assert.equal(second.passed, config.corrected);
    assert.deepEqual(second.progress.map(row => row.resource), config.corrected ? ['identity', 'leagues', 'bootstrap', 'core'] : ['identity', 'leagues', 'bootstrap']);
    if (!config.corrected) assert.match(second.failure.message, /Native dispatch exceeded bounded real-time interval/);
    const dispatches = await query(`SELECT resource,admitted_at,worker_id,generation,intake_id FROM public_data_dispatches ORDER BY admitted_at`);
    assert.equal(dispatches.length, config.corrected ? 8 : 7);
    for (let index = 1; index < dispatches.length; index++) assert(new Date(dispatches[index].admitted_at) - new Date(dispatches[index - 1].admitted_at) >= 60000);
    assert.equal(requests.length, config.corrected ? 10 : 8); assert.equal(forbiddenRequests, 0);
    console.log(JSON.stringify({ kind: 'native-timing-result', passed: true, corrected: config.corrected, identity, moduleSha256: config.moduleSha256,
      loopSha256: createHash('sha256').update(loopSource).digest('hex'), journeys, cooldown, dispatches, requests, nativeStepDurationsMs,
      nativeSetupSegmentMs,
      forbiddenRequests, actualProviderRequests: 0, limits: { journeyMs: 225000, caseMs: 240000, setupMs: 420000, cadenceMs: 60000, invocationMs: 20000, leaseMs: 25000 },
      limitation: 'Ordinary intake timing only: real jobs/admission/storage with fixture HTTP. Canonical companion selection, acceptance, replay and mutation probes are not executed. The 420s check covers the first native journey plus cooldown, not the complete beforeAll; the hosted 13-case qualification is not executed.' }));
  } finally { globalThis.fetch = originalFetch; try { await client.end(); } finally { socket.destroy(); } }
}
async function nativeTimingChecks(database) {
  const runtimePassword = randomBytes(32).toString('hex'); additionalSecrets.push(runtimePassword);
  sql(database, `ALTER ROLE league_one_runtime PASSWORD '${runtimePassword}';`, 'local-runtime-password');
  const config = { database, port, password: runtimePassword, sentinel, version: report.versionNum,
    corrected: nativeTiming === '--verify-native-timing', moduleSha256: sha(source('integration/canonical-standings.qualification-case.ts')) };
  const program = '(' + nativeTimingProgram.toString() + ')().catch(error=>{ console.error(JSON.stringify({kind:"native-timing-error",name:error.name,message:error.message,code:error.code})); process.exitCode=1; });';
  const child = spawn(process.execPath, ['--conditions=react-server', '--import', 'tsx', '--input-type=module', '-e', program],
    { cwd: site, env: { ...env, L1_LOCAL_TIMING_CONTEXT: JSON.stringify(config) }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', diagnostics = '';
  child.stdout.on('data', data => { const text = scrub(data).replaceAll(runtimePassword, '[LOCAL_SECRET]'); output += text; process.stdout.write(text); });
  child.stderr.on('data', data => { diagnostics += scrub(data).replaceAll(runtimePassword, '[LOCAL_SECRET]'); });
  const timer = setTimeout(() => child.kill(), 600000);
  const code = await new Promise((ok, no) => { child.once('error', no); child.once('close', ok); }).finally(() => clearTimeout(timer));
  writeFileSync(join(directory, 'native-timing.log'), output + diagnostics);
  assert.equal(code, 0, 'Native timing diagnostic failed; see owned log');
  report.nativeTiming = output.trim().split(/\r?\n/).map(line => JSON.parse(line)).find(row => row.kind === 'native-timing-result');
  assert(report.nativeTiming?.passed, 'Missing native timing result');
}
async function canonicalSuiteChecks(database, baseMigrationNames) {
  const runtimePassword = randomBytes(32).toString('hex'); additionalSecrets.push(runtimePassword);
  sql(database, `ALTER ROLE league_one_runtime PASSWORD '${runtimePassword}';`, 'local-runtime-password');
  for (const role of ['league_one_runtime', 'league_one_account', 'league_one_auth']) {
    sql(database, `GRANT ${role} TO ${owner} WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;`, 'local-set-role-' + role);
  }
  stage = 'canonical-suite';
  for (const path of ['integration/canonical-standings-local-setup.ts', 'integration/qualification-reporter.ts',
    'integration/neon-integration-harness.ts', 'integration/server-only-stub.ts', 'integration/canonical-standings-profile.ts',
    'integration/canonical-standings.qualification-case.ts']) source(path);
  const contextResult = spawnSync(process.execPath, ['--conditions=react-server', '--import', 'tsx', '--input-type=module', '-e',
    `import { createQualificationContext,qualificationArguments } from './integration/qualification-profile.ts';
    const context=await createQualificationContext(process.cwd(),process.argv[1],process.argv[2],'data-canonical-standings-v1');
    console.log(JSON.stringify({context,args:qualificationArguments(context.profile,'./integration/qualification-reporter.ts')}));`,
    report.baseCommit, sentinel], { cwd: site, env, encoding: 'utf8', windowsHide: true, timeout: 30000 });
  assert.equal(contextResult.status, 0, 'Local canonical context binding failed: ' + scrub(contextResult.stderr));
  const binding = JSON.parse(contextResult.stdout);
  writeFileSync(join(directory, 'local-qualification-context.json'), JSON.stringify(binding.context, null, 2));
  const configPath = join(directory, 'local-vitest.config.mjs');
  const slash = path => path.replaceAll('\\', '/');
  const config = `export default ${JSON.stringify({ root: slash(site), resolve: { alias: {
    '@': slash(site), 'server-only': slash(join(site, 'integration/server-only-stub.ts')),
  } }, test: { environment: 'node', fileParallelism: false, maxWorkers: 1, hookTimeout: 120000,
    testTimeout: 60000, includeTaskLocation: true, include: ['integration/canonical-standings.qualification-case.ts'],
    setupFiles: [slash(join(site, 'integration/canonical-standings-local-setup.ts'))], retry: 0,
  } }, null, 2)};\n`;
  writeFileSync(configPath, config, { flag: 'wx' });
  report.localConfigSha256 = sha(config);
  const local = { authorization: 'I_AUTHORIZE_OWNED_LOOPBACK_CANONICAL_SUITE', database, port, sentinel,
    version: report.versionNum, site, directory, baseMigrationNames,
    ownerUrl: `postgresql://${owner}:${ownerPassword}@${host}:${port}/${database}`,
    runtimeUrl: `postgresql://league_one_runtime:${runtimePassword}@${host}:${port}/${database}` };
  const remaining = 1800000 - (Date.now() - report.canonicalSetupStartedAtMs);
  assert(remaining > 0);
  const child = spawn(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--config', configPath, ...binding.args], {
    cwd: site, env: { ...env, L1_LOCAL_CANONICAL_CONTEXT: JSON.stringify(local),
      PROJECTION_INTEGRATION_QUALIFICATION_CONTEXT: JSON.stringify(binding.context),
      PROJECTION_INTEGRATION_ARTIFACT_DIRECTORY: directory }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '', pendingOutput = '', timedOut = false, childClosed = false, spawnError;
  const closed = new Promise(ok => child.once('close', code => { childClosed = true; ok(code); }));
  child.once('error', error => { spawnError = error; });
  const terminate = () => {
    if (process.platform === 'win32' && child.pid) spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { env, windowsHide: true });
    else child.kill();
  };
  const capture = data => {
    pendingOutput += String(data);
    const end = pendingOutput.lastIndexOf('\n');
    if (end < 0) return;
    const value = scrub(pendingOutput.slice(0, end + 1));
    pendingOutput = pendingOutput.slice(end + 1); output += value; process.stdout.write(value);
  };
  let timer, code;
  try {
    child.stdout.on('data', capture); child.stderr.on('data', capture);
    timer = setTimeout(() => { timedOut = true; terminate(); }, remaining);
    code = await closed;
    if (spawnError) throw spawnError;
  } finally {
    clearTimeout(timer);
    if (!childClosed) { terminate(); await closed; }
  }
  if (pendingOutput) { const value = scrub(pendingOutput); output += value; process.stdout.write(value); }
  writeFileSync(join(directory, 'canonical-suite.log'), output);
  report.localSuite = { exitCode: code, timedOut, hostedQualification: false,
    sourceState: 'baseCommit plus receipt-bound working source bytes; not a clean committed candidate',
    transport: 'installed driver over owned loopback Socket; existing pinned harness session and savepoints',
    setupTiming: 'Preinstalled 001–065 plus launch/import and actual beforeAll measured conservatively through S01 start; hosted TLS/lifecycle not exercised.' };
  const validation = spawnSync(process.execPath, ['--conditions=react-server', '--import', 'tsx', '--input-type=module', '-e',
    `import assert from 'node:assert/strict'; import {readFileSync} from 'node:fs'; import {join} from 'node:path';
    import {validateQualificationReport,qualificationDigest} from './integration/qualification-profile.ts';
    import {assertCanonicalStandingsEvidence,CANONICAL_STANDINGS_TESTS,CANONICAL_STANDINGS_BEFORE_ALL_MS} from './integration/canonical-standings-profile.ts';
    const directory=process.argv[1], started=Number(process.argv[2]);
    const context=JSON.parse(readFileSync(join(directory,'local-qualification-context.json'),'utf8'));
    const report=JSON.parse(readFileSync(join(directory,'qualification-report.json'),'utf8'));
    const evidence=JSON.parse(readFileSync(join(directory,'canonical-standings-evidence.json'),'utf8'));
    const cases=report.modules.flatMap(module=>module.cases), first=cases.find(value=>value.name.endsWith(CANONICAL_STANDINGS_TESTS[0]));
    const setupElapsedMs=first?.diagnostic?.startTime-started;
    const result={kind:'canonical-local-case-validation-v1',collected:cases.length,executed:cases.filter(c=>c.readyEvents===1).length,
      passed:cases.filter(c=>c.state==='passed').length,failed:cases.filter(c=>c.state==='failed').length,
      skipped:cases.filter(c=>c.state==='skipped').length,boundaries:evidence.boundaryAssertions.length,setupElapsedMs,accepted:false};
    try { assert(first?.state==='passed'); assert(Number.isFinite(setupElapsedMs)&&setupElapsedMs>=0&&setupElapsedMs<=CANONICAL_STANDINGS_BEFORE_ALL_MS);
      validateQualificationReport(context,report); assertCanonicalStandingsEvidence(evidence,qualificationDigest(context));
      const sessions=JSON.parse(readFileSync(join(directory,'local-session-evidence.json'),'utf8')); assert.equal(sessions.prepared,true);assert.equal(sessions.forbiddenFetches,0);
      result.accepted=true;
    } catch(error) { result.failure=error.message.slice(0,1024); process.exitCode=1; }
    console.log(JSON.stringify(result));`, directory, String(report.canonicalSetupStartedAtMs)],
    { cwd: site, env, encoding: 'utf8', windowsHide: true, timeout: 30000 });
  writeFileSync(join(directory, 'canonical-suite-validation.log'), scrub(validation.stdout + validation.stderr));
  if (validation.stdout.trim()) report.localSuite.validation = JSON.parse(validation.stdout.trim());
  assert.equal(code, 0, 'Actual local canonical case failed; retained original report and diagnostics');
  assert.equal(validation.status, 0, 'Local canonical report/companion/setup-budget validation failed');
}
try {
  source('scripts/check-canonical-sql-setup.mjs');
  source('integration/qualification-profile.ts');
  const support = [...source('integration/qualification-profile.ts').split('export async function assertCanonicalStandingsSupportSources')[0].matchAll(/\{ path: '([^']+)', sourceDigest: '([a-f0-9]{64})' \}/g)];
  assert.equal(support.length, 319);
  for (const [, path, expected] of support) assert.equal(sha(source(path)), expected, 'Canonical support pin mismatch: ' + path);
  const gitHead = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: site, env, encoding: 'utf8', windowsHide: true });
  assert.equal(gitHead.status, 0); report.baseCommit = gitHead.stdout.trim();
  assert(!existsSync(data));
  const version = command('postgres', ['--version']); assert.equal(version.status, 0); assert.match(version.stdout, /PostgreSQL\) 18\./);
  report.binary = { version: version.stdout.trim(), postgresSha256: sha(readFileSync(executable('postgres'))) };
  writeFileSync(passwordFile, password + '\n', { flag: 'wx', mode: 0o600 });
  if (process.platform === 'win32') {
    const who = spawnSync('whoami.exe', [], { env, encoding: 'utf8', windowsHide: true }); assert.equal(who.status, 0);
    const acl = spawnSync('icacls.exe', [directory, '/inheritance:r', '/grant:r', who.stdout.trim() + ':(OI)(CI)F'], { env, windowsHide: true });
    assert.equal(acl.status, 0, 'Private diagnostic directory ACL failed');
  }
  stage = 'initdb';
  const init = command('initdb', ['-D', data, '-U', admin, '--pwfile=' + passwordFile, '--auth=scram-sha-256', '--encoding=UTF8', '--locale=C']);
  writeFileSync(join(directory, 'initdb.log'), scrub(init.stdout + init.stderr)); assert.equal(init.status, 0);
  stage = 'start'; started = true;
  const out = openSync(join(directory, 'postgres.log'), 'wx');
  const child = spawn(executable('postgres'), ['-D', data, '-h', host, '-p', String(port),
    '-c', 'log_statement=none', '-c', 'log_min_error_statement=panic'],
    { env, detached: true, windowsHide: true, stdio: ['ignore', out, out] });
  let startupError; child.on('error', error => { startupError = error; }); child.unref(); closeSync(out);
  let ready = false;
  for (let tick = 0; tick < 300; tick++) {
    if (startupError) throw startupError;
    if (existsSync(join(data, 'postmaster.pid')) && readFileSync(join(data, 'postmaster.pid'), 'utf8').trim().split(/\r?\n/)[7]?.trim() === 'ready') { ready = true; break; }
    await new Promise(ok => setTimeout(ok, 100));
  }
  assert(ready, 'Owned PostgreSQL startup deadline');
  const pid = readFileSync(join(data, 'postmaster.pid'), 'utf8').trim().split(/\r?\n/);
  assert.equal(realpathSync(pid[1]), realpathSync(data)); assert.equal(Number(pid[3]), port);
  report.pid = Number(pid[0]);
  writeFileSync(join(directory, 'owner.json'), JSON.stringify({ sentinel, dataDirectory: data, pid: report.pid, host, port }));
  report.versionNum = sql('postgres', "SELECT current_setting('server_version_num');", 'version', { adminLogin: true });
  assert(+report.versionNum >= 180000 && +report.versionNum < 190000);
  sql('postgres', `CREATE ROLE ${owner} LOGIN NOSUPERUSER CREATEDB CREATEROLE PASSWORD '${ownerPassword}';`, 'local-owner', { adminLogin: true });
  const files = readdirSync(join(site, 'migrations')).filter(name => /^\d+_[a-z0-9_]+\.sql$/.test(name)).sort();
  assert.equal(files.length, 69); assert.equal(files.at(-1), '069_canonical_native_compatibility.sql');
  const suffix = randomBytes(4).toString('hex');
  const fresh = 'l1_setup_fresh_' + suffix;
  if (canonicalSuite) report.canonicalSetupStartedAtMs = Date.now();
  createDatabase(fresh);
  if (!arrayAppend) { migrations(fresh, canonicalSuite ? files.slice(0, 65) : files); provision(fresh); }
  if (arrayAppend) { arrayAppendChecks(fresh); }
  else if (canonicalSuite) { await canonicalSuiteChecks(fresh, files.slice(0, 65)); }
  else if (nativeTiming) { await nativeTimingChecks(fresh); } else {
  const clockSource = source('integration/all-player-schedule-test-clock.ts');
  const clockSql = /await ownerQuery\(`([\s\S]*?)`\);/.exec(clockSource); assert(clockSql);
  sql(fresh, clockSql[1], 'schedule-clock-install');
  sql(fresh, 'SELECT public.all_player_request_clock();', 'schedule-clock-execute');
  const fixtureSql = source('integration/canonical-standings-fixture-policy.sql');
  if (reproduce) {
    assert.equal(sha(fixtureSql), 'efe08d0675854ec161881fd7c67866f21dbf21d3dd9d785a7e02d3763cddd7e0');
    sql(fresh, 'BEGIN;\n' + fixtureSql + '\nCOMMIT;', 'original-whole-fixture', { expectError: '42601' });
    assert.equal(sql(fresh, "SELECT to_regprocedure('public.canonical_standings_fixture_registry()') IS NULL;", 'failed-fixture-rollback'), 't');
  } else {
    sql(fresh, 'BEGIN;\n' + fixtureSql + '\nCOMMIT;', 'fresh-whole-fixture'); fixtureChecks(fresh);
    const upgrade = 'l1_setup_upgrade_' + suffix; createDatabase(upgrade); migrations(upgrade, files.slice(0, 65)); provision(upgrade);
    sql(upgrade, `BEGIN;
      INSERT INTO leagues(id,league_key,name) VALUES('10000000-0000-0000-0000-000000000001','local-setup-legacy','Local synthetic legacy');
      INSERT INTO league_seasons(id,league_id,season) VALUES('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',2026);
      INSERT INTO league_source_connections(league_season_id,provider,external_league_id)
        VALUES('20000000-0000-0000-0000-000000000001','sleeper','local legacy id with spaces');
      INSERT INTO league_season_teams(league_season_id,provider,external_league_id,external_roster_id)
        VALUES('20000000-0000-0000-0000-000000000001','sleeper','local legacy id with spaces','1');
      SELECT revise_league_source_connection(league_season_id,provider,current_mapping_revision_id,'local remapped id','local diagnostic synthetic history') FROM league_source_connections;
      COMMIT;`, 'synthetic-legacy-identities');
    const before = legacySnapshot(upgrade); for (const table of identityTables) assert(before[table].length > 0);
    migrations(upgrade, files.slice(65)); assert.deepEqual(legacySnapshot(upgrade), before);
    assert.equal(sql(upgrade, `SELECT count(*) FROM league_season_teams WHERE native_namespace='["nfl",2026,"local legacy id with spaces"]';`, 'legacy-namespace'), '1');
    provision(upgrade, ['runtime']);
    sql(upgrade, `SELECT public.canonical_source_namespace_policy('{"provider":"fixture-sports","resourceKind":"league","nativeNamespace":"league:alpha","nativeId":"club:ABC-7"}',2026);`,
      'production-fixture-policy-denial', { expectError: 'P0001: unregistered canonical source namespace' });
    sql(upgrade, 'BEGIN;\n' + fixtureSql + '\nCOMMIT;', 'upgrade-whole-fixture'); fixtureChecks(upgrade);
    // Reprovision after overlay too: catch an accidental privilege widening by any of the three scripts.
    provision(upgrade); fixtureChecks(upgrade);
    report.legacyRows = Object.fromEntries(identityTables.map(table => [table, before[table].length]));
    for (const database of [fresh, upgrade]) {
      const ledger = JSON.parse(sql(database, "SELECT jsonb_agg(jsonb_build_object('name',name,'checksum',checksum) ORDER BY name) FROM app_schema_migrations;", 'verify-migration-ledger'));
      assert.deepEqual(ledger, files.map(name => ({ name, checksum: sources.get('migrations/' + name).sha256 })));
    }
  }
  }
  for (const path of sources.keys()) source(path);
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.failure = { stage, message: scrub(error.message) }; process.exitCode = 1;
} finally {
  try {
    if (started && existsSync(join(data, 'postmaster.pid'))) {
      const pid = readFileSync(join(data, 'postmaster.pid'), 'utf8').trim().split(/\r?\n/);
      assert.equal(realpathSync(pid[1]), realpathSync(data)); assert.equal(Number(pid[3]), port);
      const stop = command('pg_ctl', ['-D', data, '-m', 'fast', '-w', '-t', '30', 'stop']); assert.equal(stop.status, 0);
    }
    assert(!existsSync(join(data, 'postmaster.pid'))); await freePort(port);
    if (existsSync(data)) {
      const actual = realpathSync(data), allowed = realpathSync(directory) + sep;
      assert(actual.startsWith(allowed) && actual === join(realpathSync(directory), 'data'));
      if (process.platform === 'win32' && report.pid) {
        const systemRoot = Object.entries(env).find(([key]) => key.toLowerCase() === 'systemroot')?.[1];
        assert(systemRoot, 'Trusted Windows system directory missing');
        const powershell = realpathSync(join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'));
        // Fixed native code receives literal values only through this owned child environment.
        // All guards and removal run in one shell; a reused PID fails closed without termination.
        const removalScript = String.raw`
$ErrorActionPreference = 'Stop'
$parent = (Resolve-Path -LiteralPath $env:LEAGUE_ONE_CLEANUP_PARENT).ProviderPath
$target = (Resolve-Path -LiteralPath $env:LEAGUE_ONE_CLEANUP_TARGET).ProviderPath
if ($parent -cne $env:LEAGUE_ONE_CLEANUP_PARENT -or $target -cne $env:LEAGUE_ONE_CLEANUP_TARGET -or
    $target -cne (Join-Path $parent 'data')) { throw 'Owned cleanup path mismatch' }
$ownedProcessId = [int]$env:LEAGUE_ONE_CLEANUP_PID
$ownedPort = [int]$env:LEAGUE_ONE_CLEANUP_PORT
$owned = Get-Content -Raw -LiteralPath (Join-Path $parent 'owner.json') | ConvertFrom-Json
if ($owned.dataDirectory -cne $target -or $owned.pid -ne $ownedProcessId -or $owned.port -ne $ownedPort -or
    $owned.host -cne '127.0.0.1' -or $owned.sentinel -cne $env:LEAGUE_ONE_CLEANUP_SENTINEL) { throw 'Owned cleanup identity mismatch' }
if ((Test-Path -LiteralPath (Join-Path $target 'postmaster.pid')) -or
    ((Get-Item -LiteralPath $parent -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -or
    ((Get-Item -LiteralPath $target -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -or
    @(Get-ChildItem -LiteralPath $target -Recurse -Force | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }).Count) {
  throw 'Owned cleanup live postmaster or reparse point found'
}
$processPresent = $false
try { $null = [Diagnostics.Process]::GetProcessById($ownedProcessId); $processPresent = $true } catch [ArgumentException] {}
if ($processPresent) { throw 'Owned cleanup process still present' }
$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Parse('127.0.0.1'), $ownedPort)
$listener.Server.ExclusiveAddressUse = $true
try { $listener.Start() } finally { $listener.Stop() }
Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction Stop
if (Test-Path -LiteralPath $target) { throw 'Owned cleanup data remains' }
Write-Output 'Verified owned data removal completed.'
`;
        report.cleanupMethod = 'windows-native-literal-path';
        report.cleanupExecutable = { path: powershell, sha256: sha(readFileSync(powershell)) };
        const removal = spawnSync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', removalScript], {
          env: { ...env, LEAGUE_ONE_CLEANUP_PARENT: realpathSync(directory), LEAGUE_ONE_CLEANUP_TARGET: actual,
            LEAGUE_ONE_CLEANUP_PID: String(report.pid), LEAGUE_ONE_CLEANUP_PORT: String(port), LEAGUE_ONE_CLEANUP_SENTINEL: sentinel },
          encoding: 'utf8', windowsHide: true, timeout: 30_000, maxBuffer: 1024 * 1024 });
        writeFileSync(join(directory, 'cleanup-data.log'), scrub(removal.stdout) + scrub(removal.stderr));
        assert(!removal.error && removal.status === 0, 'Owned native Windows removal failed; see cleanup-data.log');
        assert(!existsSync(data), 'Owned data remains after native removal');
      } else rmSync(actual, { recursive: true, maxRetries: 10, retryDelay: 200 });
    }
    if (existsSync(passwordFile)) rmSync(passwordFile);
    assert(!existsSync(data) && !existsSync(passwordFile), 'Owned cleanup files remain');
    report.cleanup = true;
  } catch (error) { report.status = 'failed'; report.cleanupFailure = scrub(error.message); process.exitCode = 1; }
  report.sources = Object.fromEntries(sources); report.finishedAt = new Date().toISOString();
  writeFileSync(join(directory, 'receipt.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, cleanup: report.cleanup, steps: report.steps.length, receipt: join(directory, 'receipt.json'), failure: report.failure }));
}
