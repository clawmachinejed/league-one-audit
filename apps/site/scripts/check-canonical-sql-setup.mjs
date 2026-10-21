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
assert(args.length === 1 || reproduce, 'Unknown diagnostic argument');
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
  mode: reproduce ? 'original-defect-reproduction' : 'complete-local-setup', host, port, sentinel,
  cloudCalls: 0, paidRuns: 0, hostedQualification: false, steps: [], status: 'running', cleanup: false };
let stage = 'preflight', started = false;
const scrub = value => String(value ?? '').replaceAll(password, '[LOCAL_SECRET]').replaceAll(ownerPassword, '[LOCAL_SECRET]');
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
  const fresh = 'l1_setup_fresh_' + suffix; createDatabase(fresh); migrations(fresh, files); provision(fresh);
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
      rmSync(actual, { recursive: true, maxRetries: 10, retryDelay: 200 });
    }
    if (existsSync(passwordFile)) rmSync(passwordFile);
    report.cleanup = true;
  } catch (error) { report.status = 'failed'; report.cleanupFailure = scrub(error.message); process.exitCode = 1; }
  report.sources = Object.fromEntries(sources); report.finishedAt = new Date().toISOString();
  writeFileSync(join(directory, 'receipt.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, cleanup: report.cleanup, steps: report.steps.length, receipt: join(directory, 'receipt.json'), failure: report.failure }));
}
