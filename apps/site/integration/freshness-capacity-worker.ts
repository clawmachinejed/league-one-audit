/** One supervised process using the ordinary production facade and stored observer. */
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, mkdir, lstat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { FLEET_CONFIG, FLEET_VERSION, parseFleetConfig, parseFleetCommand, fleetStart, fleetEnd, fleetFetch,
  type FleetCommand, type FleetMessage, type FleetSqlAttempt } from './freshness-capacity-protocol';
import { FLEET_REQUEST_OWNERS, FLEET_HEALTHY_CLOCK, FLEET_RECOVERY_PROFILE, FLEET_DAILY_PROFILE, buildFleetHealthyManifest, buildFleetRecoveryManifest, buildFleetDailyManifest, fleetDocumentRows, writeFleetEvidenceChunks, packFleetDailySqlAttempts, packFleetDailyRequestLedger, packFleetDailyManifestReference } from './freshness-capacity-profile';
import { loadCapacityNamedSourceFixture } from './freshness-capacity-fixtures';
import { capacityDigest, freezeCapacityValue, type JsonValue } from './freshness-capacity-manifest';
import { evaluateCapacityEvidence, type HttpAttempt } from './freshness-capacity-evidence';
import { RECOVERY_CLOCK, evaluateCapacityRecovery, type CapacityRecoveryEvidence } from './freshness-capacity-recovery';
import { DAILY_CLOCK, evaluateCapacityDaily, type CapacityDailyEvidence } from './freshness-capacity-daily';
import type { DatabaseClient } from '../lib/database';
import type { ProviderRequestOwner } from '../lib/provider-request-telemetry';

const siteRoot = fileURLToPath(new URL('../', import.meta.url));
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const asJson = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue;
function failureKind(error: unknown): 'assertion' | 'aborted' | 'operation' {
  return error instanceof assert.AssertionError ? 'assertion' : error instanceof Error && error.name === 'AbortError' ? 'aborted' : 'operation';
}
type NativeRow = Record<string, JsonValue>;
type NativeDocument = { url: string; utf8: string; sha256: string; disclosure: string };

/** Controlled replay facts are distinguished from authored supplements and original capture clocks. */
export async function fleetCoexistenceFixture() {
  const named = loadCapacityNamedSourceFixture(), payloads = new Map<string, NativeDocument>();
  const add = (url: string, payload: unknown, disclosure: string) => {
    const utf8 = JSON.stringify(payload); assert(!payloads.has(url), 'duplicate coexistence endpoint');
    payloads.set(url, { url, utf8, sha256: hash(utf8), disclosure });
  };
  for (const collection of named.collections) for (const sample of collection.samples) for (const item of sample.resources) {
    const document = item.document, url = 'https://api.sleeper.app/v1/league/' + sample.nativeLeagueId
      + (document.family === 'league' ? '' : '/' + document.family + (document.week === null ? '' : '/' + document.week));
    if (!payloads.has(url)) add(url, document.payload,
      'Retained native payload unchanged; original source clock remains in named fixture metadata, separate from replay capture clock.');
  }
  const schedulePath = 'test-support/fixtures/sleeper-2026-season-schedule.json';
  const scheduleBytes = await readFile(join(siteRoot, schedulePath)), schedule = JSON.parse(scheduleBytes.toString('utf8')).body as NativeRow[];
  add('https://api.sleeper.com/schedule/nfl/regular/2026', schedule, 'Retained native season schedule; no time rewriting.');
  add('https://api.sleeper.app/v1/state/nfl', { season: '2026', season_type: 'regular', week: 6, leg: 6, display_week: 6, season_start_date: '2026-09-10' },
    'Authored native state; actual primary period remains selected by the maintained calendar/authority logic.');
  for (let week = 1; week <= 18; week++) add('https://api.sleeper.com/scores/nfl/regular/2026/' + week,
    schedule.filter(row => row.week === week).map(row => ({ season: '2026', season_type: 'regular', week, date: row.date, status: row.status,
      metadata: { home_team: row.home, away_team: row.away }, start_time: Date.parse(String(row.date) + 'T17:00:00Z') })),
    'Authored native score metadata from retained schedule dates; not an original observed result.');
  const catalog: NativeRow[] = [], sourceFiles = [{ path: schedulePath, sha256: hash(scheduleBytes) }];
  for (const position of ['QB', 'RB', 'WR', 'TE', 'K', 'DEF']) {
    const path = 'test-support/fixtures/all-player-foundation/catalog-' + position + '.json', bytes = await readFile(join(siteRoot, path));
    sourceFiles.push({ path, sha256: hash(bytes) }); const rows = JSON.parse(bytes.toString('utf8')) as NativeRow[]; catalog.push(...rows);
    add('https://api.sleeper.app/v1/players/nfl?position=' + position, Object.fromEntries(rows.map(row => [String(row.player_id), row])),
      'Retained September catalog fixture; new replay fetch times do not change its historical provenance.');
  }
  for (const sample of named.collections[0].samples) {
    const prefix = 'https://api.sleeper.app/v1/league/' + sample.nativeLeagueId;
    const rosters = JSON.parse(payloads.get(prefix + '/rosters')!.utf8) as NativeRow[];
    const ids = [...new Set(rosters.flatMap(row => [row.owner_id, ...(Array.isArray(row.co_owners) ? row.co_owners : [])]).filter(Boolean))];
    add(prefix + '/users', ids.map((id, index) => ({ user_id: id, display_name: 'Authored replay owner ' + index, username: 'cp26-replay-owner-' + index, avatar: null, metadata: {} })),
      'Original owner IDs, authored display labels; no invented native discovery ancestry.');
    for (let week = 0; week <= 18; week++) add(prefix + '/transactions/' + week, [], 'Authored empty native response for maintenance coexistence, not retained transaction parity.');
    add(prefix + '/traded_picks', [], 'Authored empty traded picks for maintenance coexistence.');
    const drafts = Array.from({ length: 8 }, (_, index) => ({ draft_id: 'cp26_replay_' + sample.key + '_' + (index + 1), league_id: sample.nativeLeagueId,
      season: '2026', sport: 'nfl', status: 'pre_draft', type: 'snake', settings: { teams: rosters.length, rounds: 1 }, draft_order: {}, slot_to_roster_id: {}, metadata: { name: 'Authored maintenance draft' } }));
    add(prefix + '/drafts', drafts, 'Eight authored native pre-draft bundles for existing finite maintenance rotation.');
    for (const draft of drafts) {
      const url = 'https://api.sleeper.app/v1/draft/' + draft.draft_id;
      add(url, draft, 'Authored maintenance draft detail.'); add(url + '/picks', [], 'Authored maintenance draft selections.');
      add(url + '/traded_picks', [], 'Authored maintenance draft trades.');
    }
  }
  const { NFL_TEAMS, canonicalNflTeam } = await import('../lib/nfl-teams');
  const rostered = new Set(named.collections[0].samples.flatMap(sample => (JSON.parse(payloads.get('https://api.sleeper.app/v1/league/' + sample.nativeLeagueId + '/rosters')!.utf8) as NativeRow[])
    .flatMap(row => Array.isArray(row.players) ? row.players.map(String) : [])));
  const players = new Map<string, NativeRow>();
  for (const row of catalog) if (rostered.has(String(row.player_id)) && ['QB', 'RB', 'WR', 'TE'].includes(String(row.position)) && canonicalNflTeam(String(row.team))) players.set(String(row.player_id), row);
  for (const team of NFL_TEAMS) for (const position of ['QB', 'RB', 'WR', 'TE']) {
    const row = catalog.find(row => canonicalNflTeam(String(row.team)) === team && row.position === position); assert(row); players.set(String(row.player_id), row);
  }
  const tank = 'https://tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com';
  add(tank + '/getNFLPlayerList', { statusCode: 200, body: [...players.values()].map(row => ({ playerID: 'cp26-tank-' + row.player_id, sleeperBotID: row.player_id, longName: row.full_name })) },
    'Authored Tank01 crosswalk linked to retained native player IDs.');
  const playerProjections = Object.fromEntries([...players.values()].map(row => {
    const playerID = 'cp26-tank-' + row.player_id;
    return [playerID, { playerID, longName: row.full_name, pos: row.position, team: row.team,
      Passing: { passAttempts: '34.5', passCompletions: '22.1', passYds: '275.25', passTD: '2.1', int: '0.6' },
      Rushing: { carries: '4', rushYds: '12.5', rushTD: '0.2' }, Receiving: { targets: '5', receptions: '3', recYds: '31', recTD: '0.2' },
      twoPointConversion: '.05', fumblesLost: '0.10' }];
  }));
  const teamDefenseProjections = Object.fromEntries(NFL_TEAMS.map((team, index) => [team, { teamID: String(index + 1), teamAbv: team,
    returnTD: '.1', defTD: '.2', safeties: '.05', fumbleRecoveries: '.8', ptsAgainst: '20.5', interceptions: '1.25', sacks: '2.75', blockKick: '.1' }]));
  add(tank + '/getNFLProjections?week=2&itemFormat=map', { statusCode: 200, body: { playerProjections, teamDefenseProjections } }, 'Authored plausible native projection fixture, not live projections.');
  add(tank + '/getNFLScoresOnly?gameWeek=2&season=2026&seasonType=reg&topPerformers=false', { statusCode: 200,
    body: Object.fromEntries(schedule.filter(row => row.week === 2).map((row, index) => { const gameID = 'cp26-authored-week2-game-' + index;
      return [gameID, { gameID, home: row.home, away: row.away, gameStatusCode: '0', gameStatus: 'Not Started Yet', gameClock: '' }]; })) }, 'Authored pregame state linked to retained calendar teams.');
  return freezeCapacityValue({ named, documents: [...payloads.values()], sourceFiles, digest: capacityDigest({ named, documents: [...payloads.values()], sourceFiles }) });
}

async function installFleetCache(directory: string) {
  const require = createRequire(join(siteRoot, 'package.json'));
  const { IncrementalCache } = require('next/dist/server/lib/incremental-cache/index.js');
  const { nodeFs } = require('next/dist/server/lib/node-fs-methods.js');
  const FileSystemCache = require('next/dist/server/lib/incremental-cache/file-system-cache.js').default;
  const cacheDirectory = join(directory, 'next-cache'); await mkdir(cacheDirectory); await mkdir(join(cacheDirectory, 'server'));
  const cache = new IncrementalCache({ fs: nodeFs, dev: false, flushToDisk: true, minimalMode: false,
    serverDistDir: join(cacheDirectory, 'server'), requestHeaders: {}, maxMemoryCacheSize: 50 * 1024 * 1024, fetchCacheKeyPrefix: '',
    getPrerenderManifest: () => ({ version: 4, routes: {}, dynamicRoutes: {}, notFoundRoutes: [], preview: { previewModeId: 'cp26-controlled-replay' } }) });
  assert(cache.cacheHandler instanceof FileSystemCache && !cache.hasCustomCacheHandler);
  (globalThis as unknown as { __incrementalCache: unknown }).__incrementalCache = cache;
  return { kind: 'installed-next-filesystem-cache', directory: cacheDirectory, customHandler: false, sourceFiles: await Promise.all([
    'next/package.json', 'next/dist/server/lib/incremental-cache/index.js', 'next/dist/server/lib/incremental-cache/file-system-cache.js',
    'next/dist/server/lib/node-fs-methods.js', 'next/dist/server/web/spec-extension/unstable-cache.js',
  ].map(async name => ({ name, sha256: hash(await readFile(require.resolve(name))) }))) };
}

async function main() {
  // Next's standalone entry expects the genuine Node implementation before its lazy imports.
  (globalThis as unknown as { AsyncLocalStorage: typeof AsyncLocalStorage }).AsyncLocalStorage = AsyncLocalStorage;
  const config = parseFleetConfig(JSON.parse(process.env[FLEET_CONFIG] ?? 'null')), url = process.env.DATABASE_URL;
  assert(url && process.send && !process.env.NODE_OPTIONS, 'closed fleet child launch required');
  const rawDirectory = await lstat(config.evidenceDirectory); assert(rawDirectory.isDirectory() && !rawDirectory.isSymbolicLink());
  const buildOptions = { fixtureId: config.fixtureId, gitSha: config.gitSha, plannedPostgresqlVersion: config.plannedPostgresqlVersion };
  const dailyBuilt = config.profile === FLEET_DAILY_PROFILE ? await buildFleetDailyManifest(buildOptions) : null;
  const recoveryBuilt = config.profile === FLEET_RECOVERY_PROFILE ? await buildFleetRecoveryManifest(buildOptions) : null;
  const built = dailyBuilt ? { fixture: dailyBuilt.fixture, manifest: dailyBuilt.observerManifest, sourceFiles: dailyBuilt.sourceFiles } : recoveryBuilt ? { fixture: recoveryBuilt.fixture, manifest: recoveryBuilt.observerManifest, sourceFiles: recoveryBuilt.sourceFiles } : await buildFleetHealthyManifest(buildOptions);
  assert.equal(built.fixture.digest, config.fixtureDigest); assert.equal(dailyBuilt?.dailyManifest.digest ?? recoveryBuilt?.recoveryManifest.digest ?? built.manifest.digest, config.manifestDigest);
  const coexistence = await fleetCoexistenceFixture(), cache = await installFleetCache(config.evidenceDirectory);
  // Controlled HTTP never delegates provider traffic. This synthetic key reaches no real provider.
  process.env.TANK01_API_KEY = 'cp26-controlled-fixture-key'; delete process.env.ALL_PLAYER_RECURRING_ENABLED;
  const [{ getDatabase }, { createIndependentPinnedDatabase }, { createCapacityObserver, createCapacityDailyCatalogFetch }, { createCapacityFixtureTransport, createCapacityRecoveryTransport, createCapacityDailyTransport, packCapacityDailyResponses }, telemetry,
    intakeRuntime, intakeContracts, refreshContracts, { createProjectionStore }, { createLeagueAdministrationStore }, { runProductionProjectionSync }] = await Promise.all([
    import('../lib/database'), import('./neon-integration-harness'), import('./freshness-capacity-observer'), import('./freshness-capacity-transport'),
    import('../lib/provider-request-telemetry'), import('../lib/league-administration/public-intake-runtime'), import('../lib/league-administration/public-intake-contracts'),
    import('../lib/league-administration/public-refresh-contracts'), import('../lib/projection-store'), import('../lib/league-administration/store'),
    import('../lib/projections/runtime/projection-dispatch'),
  ]);
  const connection = await createIndependentPinnedDatabase(url), configuredDatabase = getDatabase(); assert(configuredDatabase.enabled);
  const http: DatabaseClient = configuredDatabase;
  const identitySql = `SELECT current_user,session_user,current_database() AS database,current_setting('neon.branch_id',true) AS branch,
    current_setting('server_version') AS version,current_setting('server_version_num') AS version_num,pg_backend_pid() AS pid,
    (SELECT backend_start::text FROM pg_stat_activity WHERE pid=pg_backend_pid()) AS backend_start,
    (SELECT rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolinherit OR rolbypassrls FROM pg_roles WHERE rolname=current_user) AS elevated`;
  const [session] = await connection.database.query(identitySql), [httpIdentity] = await http.query(identitySql);
  for (const identity of [session, httpIdentity]) {
    assert.equal(identity.current_user, 'league_one_runtime'); assert.equal(identity.session_user, 'league_one_runtime');
    assert.equal(identity.database, config.expectedDatabase); assert.equal(identity.branch, config.expectedBranch); assert.equal(identity.elevated, false);
    assert.equal(String(identity.version).split(' ')[0], config.plannedPostgresqlVersion);
  }
  const commands: FleetCommand[] = []; let sequence = 0, invalid = false, disconnected = false;
  process.on('message', value => { try { commands.push(parseFleetCommand(value, config, ++sequence)); } catch { invalid = true; } });
  process.once('disconnect', () => { disconnected = true; });
  const sqlAttempts: FleetSqlAttempt[] = [], rejected: { at: number; method: string; origin: string; path: string; owner: string | null }[] = [];
  const secondaryResponses: { attemptId: string; owner: string; document: NativeDocument; at: number; endedAt: number; monotonicStart: number; monotonicEnd: number }[] = [];
  const tankAttempts: Record<string, JsonValue>[] = [], ownerAttempts = new Map<ProviderRequestOwner, HttpAttempt[]>(FLEET_REQUEST_OWNERS.map(owner => [owner, []]));
  let originalStart: number | null = null;
  const coverageStartedAt = Date.now(); let observer: ReturnType<typeof createCapacityObserver> | null = null;
  const currentObserver = () => observer;
  const sourceTransports = new Map(FLEET_REQUEST_OWNERS.map(owner => [owner, createCapacityFixtureTransport(built.fixture, {
    owner, purpose: owner === 'independent-measurement' ? 'independent-measurement' : 'refresh', anchors: () => observer?.anchors() ?? new Map(),
    onAttempt(attempt) { const ledger = ownerAttempts.get(owner)!; ledger.push(freezeCapacityValue({ ...attempt, sequence: ledger.length + 1 })); },
  })]));
  const providerFetch: typeof fetch = async (input, init) => {
    const request = input instanceof Request ? input : null, sourceUrl = new URL(request?.url ?? String(input));
    const method = (init?.method ?? request?.method ?? 'GET').toUpperCase(), owner = telemetry.getProviderRequestOwner();
    if (!owner) { rejected.push({ at: Date.now(), method, origin: sourceUrl.origin, path: sourceUrl.pathname, owner }); throw new Error('Unknown provider owner.'); }
    if (sourceUrl.hostname.endsWith('.rapidapi.com') && owner !== 'primary-projection') {
      const at = Date.now(); rejected.push({ at, method, origin: sourceUrl.origin, path: sourceUrl.pathname, owner });
      tankAttempts.push({ sequence: tankAttempts.length + 1, id: owner + ':' + randomUUID(), owner, at, endedAt: Date.now(), method, origin: sourceUrl.origin,
        path: sourceUrl.pathname + sourceUrl.search, outcome: 'failed', responseSha256: null });
      throw new Error('Tank01 is restricted to the existing primary owner.');
    }
    const document = coexistence.documents.find(row => row.url === sourceUrl.href);
    if (!document || owner === 'data-refresh' && !sourceUrl.hostname.includes('rapidapi.com')) return sourceTransports.get(owner)!.fetch(input, init);
    const at = Date.now(), monotonicStart = performance.now(), id = owner + ':' + randomUUID(), signal = init?.signal ?? request?.signal;
    let outcome: HttpAttempt['outcome'] = 'failed', responseSha256: string | null = null;
    try {
      assert.equal(method, 'GET'); signal?.throwIfAborted();
      if (recoveryBuilt && originalStart !== null && !sourceUrl.hostname.endsWith('.rapidapi.com')
        && at >= originalStart + RECOVERY_CLOCK.outageStartMs && at < originalStart + RECOVERY_CLOCK.outageEndMs) throw new Error('Controlled Sleeper provider outage.'); const bytes = new TextEncoder().encode(document.utf8); assert.equal(hash(bytes), document.sha256);
      const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); controller.close(); } });
      const endedAt = Date.now(), monotonicEnd = performance.now(); responseSha256 = document.sha256; outcome = 'success';
      secondaryResponses.push({ attemptId: id, owner, document, at, endedAt, monotonicStart, monotonicEnd });
      return new Response(stream, { headers: { 'content-type': 'application/json', 'content-length': String(bytes.length) } });
    } catch (error) { if (signal?.aborted) outcome = 'timeout'; throw error; }
    finally {
      const endedAt = secondaryResponses.find(row => row.attemptId === id)?.endedAt ?? Date.now();
      if (sourceUrl.hostname.endsWith('.rapidapi.com')) tankAttempts.push({ sequence: tankAttempts.length + 1, id, owner, at, endedAt, method, origin: sourceUrl.origin,
        path: sourceUrl.pathname + sourceUrl.search, outcome, responseSha256 });
      else { const ledger = ownerAttempts.get(owner)!; ledger.push(freezeCapacityValue({ id, owner, sequence: ledger.length + 1, at, endedAt,
        method: 'GET', origin: sourceUrl.origin, path: sourceUrl.pathname + sourceUrl.search, purpose: 'refresh', outcome, responseSha256 })); }
    }
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fleetFetch({ runtimeUrl: url, originalFetch: dailyBuilt ? createCapacityDailyCatalogFetch(originalFetch, row => { assert(observer); observer.recordDailyCatalogChoice(row); }) : originalFetch, providerFetch, onSql: row => sqlAttempts.push(row) });
  const journals = () => FLEET_REQUEST_OWNERS.map(owner => { const source = sourceTransports.get(owner)!.journal(); return Object.freeze({
    owner, coverageStartedAt, coverageEndedAt: Date.now(), attempts: Object.freeze([...ownerAttempts.get(owner)!]), responses: source.responses,
    rejectedRequests: Object.freeze([...source.rejectedRequests, ...rejected]),
  }); });
  const calls: { action: string; span: ReturnType<typeof fleetEnd>; outcome: JsonValue; failed: boolean }[] = [];
  let dailyStartedAt: number | null = null;
  const prepared: { leagueKey: string; leagueId: string; leagueSeasonId: string; nativeLeagueId: string }[] = [];
  const setup: Record<string, JsonValue>[] = []; const configuredTargets: { cohort: string; targetId: string; configurationRevision: number; configuredAt: number; configuredCompletedAt: number; input: Record<string, JsonValue> }[] = []; const requestIds = new Map<string, string>(); const configured = new Set<string>();
  let rawWritten = false;
  const fullScope = { seasons: [2026], periodInventory: intakeContracts.PUBLIC_PERIOD_INVENTORY,
    playoffBrackets: intakeContracts.PUBLIC_PLAYOFF_BRACKETS, draftPicks: intakeContracts.PUBLIC_DRAFT_PICKS,
    transactionHistory: intakeContracts.PUBLIC_TRANSACTION_HISTORY, weeklyReports: Array.from({ length: 18 }, (_, index) => ({ season: 2026, nativeWeek: index + 1 })) };
  const selection = { enabled: true as const, managerEvidenceVersion: 'v2' as const, batchPolicy: intakeContracts.PUBLIC_DATA_BATCH_POLICY,
    schedulingPolicy: refreshContracts.PUBLIC_DATA_RESOURCE_SCHEDULE_POLICY, playerDirectoryPolicy: 'public-player-directory-daily-v1' as const };
  const remaining = () => { assert(!invalid && !disconnected && Date.now() < config.workDeadlineAt, 'original supervised work window closed'); return config.workDeadlineAt - Date.now(); };
  const send = async (message: Pick<FleetMessage, 'type' | 'sequence' | 'action' | 'span' | 'inventory' | 'result' | 'error'>) => {
    const [current] = await connection.database.query('SELECT pg_backend_pid() AS pid'); assert.equal(current.pid, session.pid);
    const value: FleetMessage = { profile: config.profile, version: FLEET_VERSION, nonce: config.nonce, contextNonce: config.contextNonce, gitSha: config.gitSha,
      profileDigest: config.profileDigest, fixtureDigest: config.fixtureDigest, manifestDigest: config.manifestDigest, workDeadlineAt: config.workDeadlineAt,
      plannedPostgresqlVersion: config.plannedPostgresqlVersion, pid: process.pid, backendPid: Number(session.pid), backendStart: String(session.backend_start),
      database: String(session.database), branch: String(session.branch), sessionUser: String(session.session_user), currentUser: String(session.current_user),
      httpSessionUser: String(httpIdentity.session_user), httpCurrentUser: String(httpIdentity.current_user), ...message };
    await new Promise<void>((resolve, reject) => process.send!(value, error => error ? reject(new Error('Fleet evidence delivery failed.')) : resolve()));
  };
  async function facade(enabled: 'omitted' | 'false' | 'enabled') {
    const start = fleetStart(); let outcome: JsonValue = null, failed = false;
    try {
      const run = (invocationStartedAt: number) => runProductionProjectionSync({ invocationStartedAt,
        ...(enabled === 'omitted' ? {} : { publicDataRefresh: enabled === 'enabled' ? selection : { ...selection, enabled: false } as never }) });
      outcome = asJson(observer ? await observer.observeInvocation('data-refresh', run) : await run(Date.now()));
      return outcome;
    } catch (error) { failed = true; throw error; }
    finally { calls.push({ action: enabled, span: fleetEnd(start), outcome, failed }); }
  }
  async function configureReady() {
    assert(observer && originalStart !== null);
    for (const user of built.fixture.users.filter(row => row.cohort !== 'auxiliary')) {
      const requestId = requestIds.get(user.cohort); if (!requestId || configured.has(user.cohort)) continue;
      if (!user.leagueKeys.every(key => built.manifest.plan.pairs.filter(pair => pair.leagueKey === key).every(pair => observer!.anchors().has(pair.id)))) continue;
      const targetId = randomUUID(), configuredAt = Date.now();
      const input = { id: targetId, expectedRevision: 0, identityRequestId: requestId, ...fullScope, cadenceSeconds: dailyBuilt ? DAILY_CLOCK.cadenceSeconds : 86400, expiresAt: new Date(config.workDeadlineAt).toISOString(), paused: false };
      const result = await intakeRuntime.configurePublicSleeperRefresh(input, selection);
      assert(result.status === 'configured' || result.status === 'replayed');
      const active = await intakeRuntime.configurePublicSleeperResourceSchedule({ targetId, expectedRevision: result.configurationRevision,
        activePeriods: user.leagueKeys.filter(key => !dailyBuilt || dailyBuilt.dailyManifest.leagues.find(row => row.key === key)!.status === 'in_season').map(key => { const league = built.fixture.sourceLeagues.find(row => row.key === key)!;
          return { season: 2026 as const, externalLeagueId: league.nativeLeagueId, nativeWeek: Number(league.nativePeriod) }; }) }, selection);
      assert('configurationRevision' in active); configuredTargets.push({ cohort: user.cohort, targetId, configurationRevision: result.configurationRevision, configuredAt, configuredCompletedAt: Date.now(), input: asJson(input) as Record<string, JsonValue> }); setup.push(asJson({ operation: 'configure', cohort: user.cohort, configuredAt, result, active }) as Record<string, JsonValue>); configured.add(user.cohort);
    }
  }
  async function prepare() {
    assert(originalStart === null); originalStart = Date.now();
    assert(originalStart + (dailyBuilt ? DAILY_CLOCK.minimumRemainingWorkMs : recoveryBuilt ? RECOVERY_CLOCK.workMs - RECOVERY_CLOCK.evidenceReserveMs : FLEET_HEALTHY_CLOCK.workMs - FLEET_HEALTHY_CLOCK.evidenceReserveMs) <= config.workDeadlineAt,
      'insufficient original lifecycle budget; no renewed work window');
    if (dailyBuilt) for (const owner of FLEET_REQUEST_OWNERS) {
      assert.equal(sourceTransports.get(owner)!.journal().attempts.length, 0);
      sourceTransports.set(owner, createCapacityDailyTransport(dailyBuilt.dailyManifest, { owner, startedAt: () => dailyStartedAt,
        purpose: owner === 'independent-measurement' ? 'independent-measurement' : 'refresh',
        onAttempt(attempt) { const ledger = ownerAttempts.get(owner)!; ledger.push(freezeCapacityValue({ ...attempt, sequence: ledger.length + 1 })); } }));
    }
    if (recoveryBuilt) for (const owner of FLEET_REQUEST_OWNERS) {
      assert.equal(sourceTransports.get(owner)!.journal().attempts.length, 0);
      sourceTransports.set(owner, createCapacityRecoveryTransport(recoveryBuilt.recoveryManifest, { owner, startedAt: originalStart,
        purpose: owner === 'independent-measurement' ? 'independent-measurement' : 'refresh',
        onAttempt(attempt) { const ledger = ownerAttempts.get(owner)!; ledger.push(freezeCapacityValue({ ...attempt, sequence: ledger.length + 1 })); } }));
    }
    observer = createCapacityObserver(built.manifest, { database: http, startedAt: recoveryBuilt || dailyBuilt ? originalStart : originalStart + FLEET_HEALTHY_CLOCK.benchmarkOffsetMs, journals,
      ...(dailyBuilt ? { daily: dailyBuilt.dailyManifest } : recoveryBuilt ? { recovery: recoveryBuilt.recoveryManifest } : {}) });
    if (!dailyBuilt) {
    const directory = await observer.observeInvocation('data-refresh', at => telemetry.withProviderRequestOwner('data-refresh',
      () => intakeRuntime.runSelectedPublicDataRefresh(selection, at)));
    setup.push(asJson({ operation: 'initial-shared-directory', at: Date.now(), outcome: directory, cadence: 'First eligible scheduled DATA turn after the existing 24-hour guard; this lane exercises only initial capture.' }) as Record<string, JsonValue>);
    if (recoveryBuilt) await observer.observeRecoveryPlayerDirectory();
    }
    const jobs = createProjectionStore(http);
    for (const sample of coexistence.named.collections[0].samples) {
      const league = JSON.parse(coexistence.documents.find(row => row.url === 'https://api.sleeper.app/v1/league/' + sample.nativeLeagueId)!.utf8) as NativeRow;
      const result = await jobs.registerLeagueSeason({ leagueKey: sample.key, leagueName: String(league.name),
        season: 2026, sleeperLeagueId: sample.nativeLeagueId, scoringRules: league.scoring_settings as Record<string, number> });
      assert.equal(result.kind, 'stored'); if (result.kind !== 'stored') throw new Error('Named registration unavailable.');
      prepared.push({ leagueKey: sample.key, leagueId: result.value.leagueId, leagueSeasonId: result.value.leagueSeasonId, nativeLeagueId: sample.nativeLeagueId });
    }
    for (const user of built.fixture.users.filter(row => !dailyBuilt && (row.cohort === 'accepted' || recoveryBuilt && row.cohort !== 'auxiliary'))) {
      const requestId = randomUUID(); requestIds.set(user.cohort, requestId);
      const submit = async () => { const result = await intakeRuntime.submitPublicSleeperIntake({ id: requestId, username: user.username, ...(dailyBuilt ? dailyBuilt.dailyManifest.initialScope : recoveryBuilt ? recoveryBuilt.recoveryManifest.initialScope : fullScope) }, { enabled: true, requestId, managerEvidenceVersion: 'v2' });
        assert(result.status === 'retained' || result.status === 'capacity'); return result; };
      if (recoveryBuilt || dailyBuilt) await observer.observeRecoverySubmission('initial-' + user.cohort, requestId, submit);
      else { const receipt = await submit(); setup.push(asJson({ operation: 'initial-submit', at: Date.now(), requestId, receipt }) as Record<string, JsonValue>); assert.equal(receipt.status, 'retained'); }
    }
    return { originalStart, prepared, cache, sourceFiles: built.sourceFiles, coexistenceDigest: coexistence.digest };
  }
  async function namedReadback() {
    const store = createLeagueAdministrationStore(http), jobs = createProjectionStore(http), rows: Record<string, JsonValue>[] = [];
    const { ACTIVE_PROJECTION_SOURCE } = await import('../lib/projection-source-config');
    const sourceAttemptsBefore = [...ownerAttempts.values()].reduce((sum, rows) => sum + rows.length, 0) + tankAttempts.length;
    for (const sample of coexistence.named.collections[0].samples) {
      const mapping = await store.readSourceMapping(sample.nativeLeagueId); assert(mapping);
      const settings = await store.readAcceptedLeagueSettings(mapping), roster = await store.readAcceptedCurrentRoster(mapping);
      assert.equal(settings.status, 'available'); assert.equal(roster.status, 'available');
      const current = await store.readSource({ ...mapping.scope, family: 'league', week: null });
      const held = await store.readSource({ ...mapping.scope, family: 'rosters', week: null });
      assert.equal(current.status, 'available'); assert.equal(held.status, 'available');
      const context = await jobs.readMatchupSnapshotByLeagueKey(sample.key, 2, { projectionProvider: String(ACTIVE_PROJECTION_SOURCE.provider),
        normalizerVersion: ACTIVE_PROJECTION_SOURCE.normalizerVersion, modelVersion: ACTIVE_PROJECTION_SOURCE.modelVersion });
      const snapshot = await jobs.readCurrentSnapshot(mapping.leagueSeasonId, 2); assert(context?.snapshot && snapshot);
      assert.equal(context.snapshot.snapshotId, snapshot.snapshotId); assert.equal(capacityDigest(asJson(context.snapshot.payload)), capacityDigest(asJson(snapshot.payload)));
      assert.equal(snapshot.modelVersion, 'clock-v1'); assert.equal(snapshot.payload.week, 2); assert.equal(String(snapshot.payload.league.season), '2026');
      assert(current.status === 'available' && held.status === 'available');
      for (const [family, read] of [['league', current], ['rosters', held]] as const) {
        const expected = sample.resources.find(row => row.document.family === family)!.document.payload;
        assert.equal(capacityDigest(asJson(read.envelope.payload)), capacityDigest(expected));
        assert.equal(read.envelope.scope.externalLeagueId, sample.nativeLeagueId); assert.equal(read.envelope.provenance.origin, 'network');
      }
      const nativeRosters = sample.resources.find(row => row.document.family === 'rosters')!.document.payload as NativeRow[];
      const playerIds = [...new Set(nativeRosters.flatMap(row => Array.isArray(row.players) ? row.players.map(String) : []))];
      const selection = { leagueSeasonId: mapping.leagueSeasonId, season: 2026, seasonType: 'reg' as const, week: 2, provider: 'tank01', modelVersion: 'clock-v1', sleeperPlayerIds: playerIds };
      const candidates = await jobs.readLatestCandidatesBySleeperIds(selection), frozen = await jobs.readFrozenBaselinesBySleeperIds(selection);
      rows.push(asJson({ key: sample.key, nativeLeagueId: sample.nativeLeagueId, mapping, settings, roster, current, held, context, snapshot, candidates, frozen,
        baselineTiming: 'Historical kickoff clocks are unchanged; post-kickoff replay does not fabricate a pregame baseline.' }) as Record<string, JsonValue>);
    }
    assert.equal([...ownerAttempts.values()].reduce((sum, rows) => sum + rows.length, 0) + tankAttempts.length, sourceAttemptsBefore, 'named stored readers attempted provider HTTP');
    return { original: coexistence.named, reads: rows, boundary: 'actual stored named settings and current rosters; exact source parity verified by the parent' };
  }
  async function healthy() {
    assert(observer && originalStart !== null && !rawWritten); const observed = observer, startAt = originalStart;
    const endAt = startAt + FLEET_HEALTHY_CLOCK.workMs - FLEET_HEALTHY_CLOCK.evidenceReserveMs;
    assert(endAt <= config.workDeadlineAt, 'fixed fleet window exceeds original work deadline');
    let stopped = false, submitted = false; const timerController = new AbortController();
    const wait = async (milliseconds: number) => { if (milliseconds > 0) await delay(milliseconds, undefined, { signal: timerController.signal }); };
    const completedImports = new Set<string>(), sampleOrdinals = new Map<string, number>();
    const loops: Promise<void>[] = [];
    const keepRunning = () => { remaining(); return !stopped && Date.now() < endAt; };
    // The existing facade is fully awaited. Missed nominal calls are retained, never stacked or retried.
    loops.push((async () => {
      for (let ordinal = 0; keepRunning(); ordinal++) {
        const scheduledAt = startAt + ordinal * 60_000;
        if (scheduledAt >= endAt) break;
        if (Date.now() < scheduledAt) await wait(scheduledAt - Date.now());
        if (!keepRunning()) break;
        if (Date.now() - scheduledAt >= 60_000) { setup.push({ operation: 'missed-facade-slot', ordinal, scheduledAt, at: Date.now() }); continue; }
        try { await facade('enabled'); } catch { /* The immutable call row retains failure; ordinary future slots remain scheduled. */ }
        await observed.observeDispatches();
      }
    })());
    loops.push((async () => {
      let ordinal = 0; const completedEnds = new Set<string>();
      while (keepRunning()) {
        const anchors = observed.anchors(), endpoints = built.manifest.plan.leagues.flatMap(row => {
          if (completedEnds.has(row.key)) return [];
          const values = built.manifest.plan.pairs.filter(pair => pair.leagueKey === row.key).map(pair => anchors.get(pair.id));
          return values.every(value => value !== undefined) ? [{ key: row.key, at: Math.max(...values as number[]) + built.manifest.plan.observationHorizonMs }] : [];
        });
        const minuteAt = startAt + ordinal * 60_000, endBoundary = Math.min(Infinity, ...endpoints.map(row => row.at));
        const scheduledAt = Math.min(minuteAt, endBoundary); if (scheduledAt > endAt) break;
        if (Date.now() < scheduledAt) await wait(scheduledAt - Date.now());
        const boundaryKeys = endpoints.filter(row => row.at === scheduledAt).map(row => row.key);
        const keys = scheduledAt === minuteAt ? built.manifest.plan.leagues.filter(row => !completedEnds.has(row.key)).map(row => row.key) : boundaryKeys;
        if (keys.length) await telemetry.withProviderRequestOwner('independent-measurement', () => observed.observeAncillary(scheduledAt, requestIds, keys, boundaryKeys.length > 0));
        for (const key of boundaryKeys) completedEnds.add(key);
        if (scheduledAt === minuteAt) ordinal++;
        if (completedEnds.size === built.manifest.plan.leagues.length) break;
      }
    })());
    loops.push((async () => {
      while (keepRunning()) {
        const now = Date.now(), anchors = observed.anchors(); let nextAt = now + 1000, due = false;
        for (const [pair, anchor] of anchors) {
          const ordinal = sampleOrdinals.get(pair) ?? 0; if (ordinal >= 121) continue;
          const at = anchor + (ordinal + 1) * 60_000; nextAt = Math.min(nextAt, at); if (at <= now) due = true;
        }
        if (due) {
          await observed.observeDueSamples();
          for (const [pair, anchor] of anchors) sampleOrdinals.set(pair, Math.min(121, Math.max(0, Math.floor((now - anchor) / 60_000))));
        } else await wait(Math.max(1, nextAt - Date.now()));
      }
    })());
    loops.push((async () => {
      for (let ordinal = 0; keepRunning(); ordinal++) {
        const scheduledAt = startAt + ordinal * 10_000;
        if (Date.now() < scheduledAt) await wait(scheduledAt - Date.now());
        if (!keepRunning()) break;
        const anchors = observed.anchors();
        await Promise.all(built.manifest.plan.leagues.filter(row => row.cohort === 'accepted' || submitted).map(async row => {
          if (!built.manifest.plan.pairs.filter(pair => pair.leagueKey === row.key).every(pair => anchors.has(pair.id))) await observed.firstAcceptance(row.key);
          await observed.observeEvents(row.key);
        }));
        await configureReady();
        for (const cohort of ['intake-a', 'intake-b'] as const) {
          const id = requestIds.get(cohort); if (!id || completedImports.has(cohort)) continue;
          const [request] = await http.query('SELECT terminal FROM public.public_data_intakes WHERE id=$1::uuid', [id]);
          if (request?.terminal !== true) continue;
          const result = await observed.observeIntake(cohort); if (result?.completeAt !== null && result?.completeAt !== undefined) completedImports.add(cohort);
        }
      }
    })());
    loops.push((async () => {
      const scheduledAt = startAt + FLEET_HEALTHY_CLOCK.freshSubmissionOffsetMs;
      if (Date.now() < scheduledAt) await wait(scheduledAt - Date.now()); remaining();
      const attempts = (['intake-a', 'intake-b'] as const).map(cohort => {
        const user = built.fixture.users.find(row => row.cohort === cohort)!, requestId = randomUUID(); requestIds.set(cohort, requestId);
        return observed.observeSubmission(cohort, requestId, async () => {
          const result = await intakeRuntime.submitPublicSleeperIntake({ id: requestId, username: user.username, ...fullScope }, { enabled: true, requestId, managerEvidenceVersion: 'v2' });
          assert(result.status === 'retained' || result.status === 'capacity'); return result;
        });
      });
      await Promise.all(attempts); submitted = true;
    })());
    const settled = await Promise.allSettled(loops.map(async loop => { try { await loop; } catch (error) { stopped = true; timerController.abort(); throw error; } }));
    const failedLoop = settled.some(row => row.status === 'rejected');
    const evidenceFailures: { stage: string; kind: ReturnType<typeof failureKind> }[] = [];
    try { await observed.observeDueSamples(); await observed.observeDispatches(); }
    catch (error) { evidenceFailures.push({ stage: 'final-observation', kind: failureKind(error) }); }
    let final: ReturnType<typeof observed.snapshot>;
    try { final = observed.snapshot(); }
    catch (error) { evidenceFailures.push({ stage: 'observer-snapshot', kind: failureKind(error) }); final = observed.diagnosticSnapshot(); }
    let analysis: ReturnType<typeof evaluateCapacityEvidence> | null = null;
    try { if (final.journalValidation === 'validated' && final.evidence.endedAt >= final.evidence.startedAt) analysis = evaluateCapacityEvidence(built.manifest, final.evidence); }
    catch (error) { evidenceFailures.push({ stage: 'capacity-analysis', kind: failureKind(error) }); }
    let ancillary: ReturnType<typeof observed.ancillaryAnalysis> | null = null;
    try { ancillary = observed.ancillaryAnalysis(final.evidence.endedAt); }
    catch (error) { evidenceFailures.push({ stage: 'ancillary-analysis', kind: failureKind(error) }); }
    let named: JsonValue;
    try { named = asJson(await namedReadback()); } catch { named = { status: 'unavailable', reason: 'named-stored-read-failed' }; }
    const closed = final.openInvocations === 0 && final.durableDispatches.every(row => row.outcome !== null) && rejected.length === 0;
    let jobInventory: readonly unknown[] | null = null;
    try { jobInventory = await http.query('SELECT job_key,state,attempt_count,last_error,completed_at FROM public.projection_jobs ORDER BY job_key'); }
    catch (error) { evidenceFailures.push({ stage: 'final-job-inventory', kind: failureKind(error) }); }
    const primary = { fixture: coexistence, cache, calls, sqlAttempts, tankAttempts, tankCoverage: { startedAt: coverageStartedAt, endedAt: Date.now(), attempts: tankAttempts.length }, secondaryResponses, rejected, evidenceFailures, setup,
      server: { version: session.version, versionNum: session.version_num },
      jobs: jobInventory };
    const documents = {
      'transport-attempts': final.evidence.requests,
      'transport-responses': FLEET_REQUEST_OWNERS.map(owner => ({ owner, responses: sourceTransports.get(owner)!.journal().responses })),
      'observer-lineage': { ancillaryQueryRows: final.ancillaryQueryRows, ancillaryProofs: final.ancillaryProofs, ancillaryAnchors: final.ancillaryAnchors, ancillaryRequests: final.ancillaryRequests, receiptProofs: final.receiptProofs, endpointProofs: final.endpointProofs, currentIntakeReads: final.currentIntakeReads, dispatchOutcomes: final.dispatchOutcomes, durableDispatches: final.durableDispatches, dispatchObservations: final.dispatchObservations },
      'observer-reads': { ancillaryReads: final.ancillaryReads, lineage: final.lineage, intakePages: final.intakePages, intakePageReads: final.intakePageReads },
      'observer-operations': { ancillaryAnalysis: ancillary, operations: final.operations, failures: final.failures, invocations: final.invocations, ownerCoverage: final.ownerCoverage,
        openInvocations: final.openInvocations, dispatchJournalReadAt: final.dispatchJournalReadAt },
      'capacity-evidence': { manifest: built.manifest, evidence: final.evidence, analysis, journalValidation: final.journalValidation, evidenceFailures },
      'named-regressions': named,
      'primary-coexistence': primary,
    } as const;
    const inventory = await writeFleetEvidenceChunks(config.evidenceDirectory, built.manifest.digest,
      Object.entries(documents).flatMap(([stream, value]) => fleetDocumentRows(stream as keyof typeof documents, value)));
    rawWritten = true;
    return { inventory, result: { originalStart, endedAt: Date.now(), observerFailures: final.failures.length, offlineChecksPass: analysis?.offlineChecksPass === true && ancillary?.pass === true && evidenceFailures.length === 0, failedLoop, closed,
      checkpoint26Qualified: false, fullElapsedWindowMs: Date.now() - startAt, primaryCalls: calls.length } };
  }
  async function daily() {
    assert(dailyBuilt && observer && originalStart !== null && !rawWritten);
    const observed = observer, dailyManifest = dailyBuilt.dailyManifest;
    const evidenceFailures: { stage: string; kind: ReturnType<typeof failureKind> }[] = [];
    const auxiliaryIds = new Set<string>(); let setupSucceeded = false;
    try {
      const completedAuxiliary: { label: 'a' | 'b'; proof: NonNullable<Awaited<ReturnType<typeof observed.observeDailyAuxiliaryIntake>>> }[] = [];
      let nextInvocationAt = Date.now();
      for (const user of dailyManifest.auxiliary.users) {
        const requestId = randomUUID(); auxiliaryIds.add(requestId);
        await observed.observeDailyAuxiliarySubmission(user.label, requestId, async () => {
          const result = await intakeRuntime.submitPublicSleeperIntake({ id: requestId, username: user.username, ...user.scope },
            { enabled: true, requestId, managerEvidenceVersion: 'v2' }); assert(result.status === 'retained' || result.status === 'capacity'); return result;
        });
        if (nextInvocationAt > Date.now()) await delay(nextInvocationAt - Date.now()); remaining();
        await observed.observeInvocation('data-refresh', at => { nextInvocationAt = at + 61_000;
          return telemetry.withProviderRequestOwner('data-refresh', () => intakeRuntime.runSelectedPublicIntakeBatch({
            enabled: true, requestId, managerEvidenceVersion: 'v2', batchPolicy: 'public-data-batch-v1' }, at)); });
        await observed.observeDispatches(); const proof = await observed.observeDailyAuxiliaryIntake(user.label); assert(proof);
        completedAuxiliary.push({ label: user.label, proof });
      }
      if (nextInvocationAt > Date.now()) await delay(nextInvocationAt - Date.now()); remaining();
      dailyStartedAt = await observed.beginDailyWindow(completedAuxiliary);
      assert(dailyStartedAt + DAILY_CLOCK.minimumRemainingWorkMs <= config.workDeadlineAt, 'auxiliary setup consumed the original work reserve');
      originalStart = dailyStartedAt;
      for (const user of built.fixture.users.filter(row => row.cohort !== 'auxiliary')) {
        const requestId = randomUUID(); requestIds.set(user.cohort, requestId);
        await observed.observeRecoverySubmission('initial-' + user.cohort, requestId, async () => {
          const result = await intakeRuntime.submitPublicSleeperIntake({ id: requestId, username: user.username, ...dailyManifest.initialScope },
            { enabled: true, requestId, managerEvidenceVersion: 'v2' }); assert(result.status === 'retained' || result.status === 'capacity'); return result;
        });
      }
      setupSucceeded = true;
    } catch (error) { evidenceFailures.push({ stage: 'daily-auxiliary-setup', kind: failureKind(error) }); }
    const startAt = dailyStartedAt ?? originalStart, endAt = startAt + DAILY_CLOCK.observationMs;
    const timer = new AbortController(); let stopped = !setupSucceeded; const completed = new Set<string>();
    const wait = async (at: number) => { if (at > Date.now()) await delay(at - Date.now(), undefined, { signal: timer.signal }); };
    const active = () => { remaining(); return !stopped && Date.now() < endAt; };
    const loops: Promise<void>[] = [];
    loops.push((async () => {
      for (let ordinal = 0; ordinal < DAILY_CLOCK.observationMs / 60_000 && !stopped; ordinal++) {
        await wait(startAt + ordinal * 60_000); remaining();
        const missed = Date.now() >= startAt + (ordinal + 1) * 60_000;
        try { await observed.observeDailyTurn(ordinal, () => facade('enabled'), missed); }
        catch { /* The exact failed facade and pre-owner catalog read remain in the journal. */ }
        await observed.observeDispatches();
      }
    })());
    loops.push((async () => {
      for (let ordinal = 0; active(); ordinal++) {
        await wait(startAt + ordinal * 10_000); if (!active()) break;
        if (Date.now() <= startAt + DAILY_CLOCK.initialHeadsDeadlineMs) { await observed.observeRecoveryHeads('initial'); await configureReady(); }
        // Ordinary full-history inventory only. Internal occurrences remain in the complete dispatch journal.
        const queue = await observed.observeDailyQueue();
        for (const value of queue.requests) {
          const request = value as Record<string, JsonValue>, id = String(request.id);
          if (auxiliaryIds.has(id)) { assert.equal(request.terminal, true); continue; }
          if (request.terminal !== true || completed.has(id)) continue;
          if (await observed.observeDailyIntake(id)) completed.add(id);
        }
      }
    })());
    loops.push((async () => { for (const offset of dailyManifest.boundaryOffsets) {
      if (stopped) break;
      await wait(startAt + offset); remaining();
      await telemetry.withProviderRequestOwner('independent-measurement', () => observed.observeDailyBoundary(startAt + offset));
    } })());
    const settled = await Promise.allSettled(loops.map(async loop => { try { await loop; } catch (error) { stopped = true; timer.abort(); throw error; } }));
    try { await observed.observeDispatches(); await observed.observeDailyQueue(); }
    catch (error) { evidenceFailures.push({ stage: 'daily-final-observation', kind: failureKind(error) }); }
    let final: ReturnType<typeof observed.snapshot>;
    try { final = observed.snapshot(); } catch (error) { evidenceFailures.push({ stage: 'daily-observer-snapshot', kind: failureKind(error) }); final = observed.diagnosticSnapshot(); }
    let rows: ReturnType<typeof observed.dailySnapshot> | null = null;
    try { rows = observed.dailySnapshot(); } catch (error) { evidenceFailures.push({ stage: 'daily-snapshot', kind: failureKind(error) }); }
    const evidence: CapacityDailyEvidence | null = rows ? { ...rows, targets: configuredTargets, workDeadlineAt: config.workDeadlineAt, ownerCoverage: final.ownerCoverage } : null;
    let analysis: ReturnType<typeof evaluateCapacityDaily> | null = null;
    try { if (evidence && final.journalValidation === 'validated') analysis = evaluateCapacityDaily(dailyManifest, evidence); }
    catch (error) { evidenceFailures.push({ stage: 'daily-analysis', kind: failureKind(error) }); }
    let named: JsonValue; try { named = asJson(await namedReadback()); } catch { named = { status: 'unavailable', reason: 'named-stored-read-failed' }; }
    let jobs: readonly unknown[] | null = null;
    try { jobs = await http.query('SELECT job_key,state,attempt_count,last_error,completed_at FROM public.projection_jobs ORDER BY job_key'); }
    catch (error) { evidenceFailures.push({ stage: 'daily-final-jobs', kind: failureKind(error) }); }
    const primary = { fixture: coexistence, cache, calls, sqlAttempts: packFleetDailySqlAttempts(sqlAttempts), tankAttempts,
      tankCoverage: { startedAt: coverageStartedAt, endedAt: Date.now(), attempts: tankAttempts.length },
      secondaryResponses: secondaryResponses.map(({ document, ...row }) => ({ ...row, documentRef: document.sha256 })),
      rejected, evidenceFailures, setup, server: { version: session.version, versionNum: session.version_num }, jobs };
    const documents = {
      'transport-attempts': evidence?.requests ?? final.evidence.requests,
      'transport-responses': packCapacityDailyResponses(FLEET_REQUEST_OWNERS.map(owner => ({ owner, responses: sourceTransports.get(owner)!.journal().responses }))),
      'observer-lineage': { ancillaryQueryRows: final.ancillaryQueryRows, ancillaryProofs: final.ancillaryProofs, ancillaryAnchors: final.ancillaryAnchors,
        ancillaryRequests: final.ancillaryRequests, receiptProofs: final.receiptProofs, endpointProofs: final.endpointProofs, currentIntakeReads: final.currentIntakeReads,
        dispatchOutcomes: final.dispatchOutcomes, durableDispatches: final.durableDispatches, dispatchObservations: final.dispatchObservations },
      'observer-reads': { ancillaryReads: final.ancillaryReads, lineage: final.lineage, intakePages: final.intakePages, intakePageReads: final.intakePageReads },
      'observer-operations': { operations: final.operations, failures: final.failures, invocations: final.invocations, ownerCoverage: final.ownerCoverage,
        openInvocations: final.openInvocations, dispatchJournalReadAt: final.dispatchJournalReadAt },
      'capacity-evidence': { manifest: packFleetDailyManifestReference('daily-manifest', dailyManifest),
        observerManifest: packFleetDailyManifestReference('observer-manifest', built.manifest),
        evidence: evidence ? { ...evidence, requests: packFleetDailyRequestLedger(evidence.requests) } : null,
        analysis, journalValidation: final.journalValidation, evidenceFailures },
      'named-regressions': named, 'primary-coexistence': primary,
    } as const;
    const inventory = await writeFleetEvidenceChunks(config.evidenceDirectory, config.manifestDigest,
      Object.entries(documents).flatMap(([stream, value]) => fleetDocumentRows(stream as keyof typeof documents, value))); rawWritten = true;
    const closed = final.openInvocations === 0 && final.durableDispatches.every(row => row.outcome !== null) && rejected.length === 0;
    return { inventory, result: { originalStart, endedAt: Date.now(), offlineChecksPass: analysis?.pass === true && evidenceFailures.length === 0,
      failedLoop: settled.some(row => row.status === 'rejected'), closed, checkpoint26Qualified: false, activePercentilesQualified: false, primaryCalls: calls.length } };
  }
  async function recovery() {
    assert(recoveryBuilt && observer && originalStart !== null && !rawWritten);
    const observed = observer, recoveryManifest = recoveryBuilt.recoveryManifest, startAt = originalStart;
    const endAt = startAt + RECOVERY_CLOCK.backlogDeadlineMs; assert(endAt <= config.workDeadlineAt);
    const outage = { startedAt: 0, dependencyRestoredAt: null as number | null, runnerRestoredAt: null as number | null };
    const timer = new AbortController(); let stopped = false, catalogObserved = false;
    const completed = new Set<string>(), endpointCompleted = new Set<string>(), queuedCompleted = new Set<string>();
    const wait = async (at: number) => { if (at > Date.now()) await delay(at - Date.now(), undefined, { signal: timer.signal }); };
    const active = () => { remaining(); return !stopped && Date.now() < endAt; };
    const loops: Promise<void>[] = [];
    loops.push((async () => {
      for (let ordinal = 0; active(); ordinal++) {
        const scheduledAt = startAt + ordinal * 60_000; if (scheduledAt >= endAt) break; await wait(scheduledAt); if (!active()) break;
        if (Date.now() - scheduledAt >= 60_000) { setup.push({ operation: 'missed-facade-slot', ordinal, scheduledAt, at: Date.now() }); continue; }
        if (Date.now() >= startAt + RECOVERY_CLOCK.outageEndMs && outage.runnerRestoredAt === null) outage.runnerRestoredAt = Date.now();
        try { await facade('enabled'); } catch { /* Exact failed calls remain in the immutable all-owner journal. */ }
        await observed.observeDispatches();
        if (!catalogObserved && Date.now() < startAt + RECOVERY_CLOCK.outageStartMs
          && calls.some(row => row.action === 'enabled' && !row.failed && row.outcome && typeof row.outcome === 'object'
            && !Array.isArray(row.outcome) && row.outcome.status === 'completed' && Number(row.outcome.publishedLeagues) > 0)) {
          await telemetry.withProviderRequestOwner('independent-measurement', () => observed.observeRecoveryPrimaryCatalog()); catalogObserved = true;
        }
      }
    })());
    loops.push((async () => {
      for (let ordinal = 0; !stopped; ordinal++) {
        const scheduledAt = startAt + ordinal * 60_000; if (scheduledAt > endAt) break;
        await wait(scheduledAt); remaining();
        await telemetry.withProviderRequestOwner('independent-measurement', () => observed.observeAncillary(scheduledAt, requestIds, undefined, scheduledAt === endAt));
      }
    })());
    loops.push((async () => {
      for (let ordinal = 0; active(); ordinal++) {
        await wait(startAt + ordinal * 10_000); if (!active()) break;
        if (Date.now() < startAt + RECOVERY_CLOCK.outageStartMs) { await observed.observeRecoveryHeads('initial'); await configureReady();
          for (const requestId of requestIds.values()) if (!queuedCompleted.has(requestId)) {
            const [request] = await http.query('SELECT terminal FROM public.public_data_intakes WHERE id=$1::uuid', [requestId]);
            if (request?.terminal === true && await observed.observeRecoveryQueuedIntake(requestId)) queuedCompleted.add(requestId);
          }
        }
        if (Date.now() >= startAt + RECOVERY_CLOCK.outageEndMs) {
          await observed.observeRecoveryHeads('recovered');
          const ordinary = await http.query(`SELECT id,username FROM public.public_data_intakes request
            WHERE terminal AND to_jsonb(request)->>'resource_occurrence_id' IS NULL ORDER BY created_at,id`);
          for (const request of ordinary) {
            const id = String(request.id); if (queuedCompleted.has(id) || recoveryManifest.submissions.some(row => row.input.id === id)) continue;
            const result = await observed.observeRecoveryQueuedIntake(id); if (result) queuedCompleted.add(id);
          }
          for (const submission of recoveryManifest.submissions) {
            if (completed.has(submission.id)) continue;
            const [request] = await http.query('SELECT terminal FROM public.public_data_intakes WHERE id=$1::uuid', [submission.input.id]);
            if (request?.terminal !== true) continue;
            if (!endpointCompleted.has(submission.id)) { await observed.observeRecoveryEndpoints(submission.input.id); endpointCompleted.add(submission.id); }
            const result = await observed.observeRecoveryIntake(submission.id); if (result.completedAt !== null) completed.add(submission.id);
          }
        }
      }
    })());
    loops.push((async () => { for (let ordinal = 0; ordinal <= 120; ordinal++) {
      await wait(startAt + RECOVERY_CLOCK.outageStartMs + ordinal * 60_000); remaining(); await observed.observeRecoverySamples();
    } })());
    loops.push((async () => { await wait(startAt + RECOVERY_CLOCK.outageStartMs - 30_000); await observed.observeRecoveryHeads('before'); })());
    loops.push((async () => { await wait(startAt + RECOVERY_CLOCK.outageStartMs); outage.startedAt = Date.now();
      setup.push({ operation: 'fixed-provider-outage-observed', at: outage.startedAt, plannedAt: startAt + RECOVERY_CLOCK.outageStartMs });
      await observed.observeRecoveryHeads('during'); })());
    loops.push((async () => { await wait(startAt + RECOVERY_CLOCK.outageEndMs); outage.dependencyRestoredAt = Date.now();
      setup.push({ operation: 'fixed-provider-restoration-observed', at: outage.dependencyRestoredAt, plannedAt: startAt + RECOVERY_CLOCK.outageEndMs }); await observed.observeRecoveryQueue('restored'); })());
    loops.push((async () => { await wait(startAt + RECOVERY_CLOCK.submissionMs);
      await Promise.all(recoveryManifest.submissions.map(submission => observed.observeRecoverySubmission(submission.id, submission.input.id, async () => {
        const result = await intakeRuntime.submitPublicSleeperIntake(submission.input, { enabled: true, requestId: submission.input.id, managerEvidenceVersion: 'v2' });
        assert(result.status === 'retained' || result.status === 'capacity'); return result;
      }))); await observed.observeRecoveryQueue('after-submissions');
    })());
    const settled = await Promise.allSettled(loops.map(async loop => { try { await loop; } catch (error) { stopped = true; timer.abort(); throw error; } }));
    const evidenceFailures: { stage: string; kind: ReturnType<typeof failureKind> }[] = [];
    try { await observed.observeDispatches(); await observed.observeRecoveryQueue('final'); } catch (error) { evidenceFailures.push({ stage: 'final-dispatch-observation', kind: failureKind(error) }); }
    let recoveryRows: ReturnType<typeof observed.recoverySnapshot> | null = null;
    try { recoveryRows = observed.recoverySnapshot(); } catch (error) { evidenceFailures.push({ stage: 'recovery-snapshot', kind: failureKind(error) }); }
    let final: ReturnType<typeof observed.snapshot>;
    try { final = observed.snapshot(); } catch (error) { evidenceFailures.push({ stage: 'observer-snapshot', kind: failureKind(error) }); final = observed.diagnosticSnapshot(); }
    const evidence: CapacityRecoveryEvidence | null = recoveryRows ? { ...recoveryRows, workDeadlineAt: config.workDeadlineAt,
      ownerCoverage: final.ownerCoverage, outage, queue: { ...recoveryRows.queue, targets: configuredTargets, completed: recoveryRows.queue.completed as unknown as CapacityRecoveryEvidence['queue']['completed'] }, submissions: recoveryRows.submissions.filter(row => row.id.startsWith('replay-')) as unknown as CapacityRecoveryEvidence['submissions'] } : null;
    let analysis: ReturnType<typeof evaluateCapacityRecovery> | null = null;
    try { if (evidence && final.journalValidation === 'validated') analysis = evaluateCapacityRecovery(recoveryManifest, evidence); }
    catch (error) { evidenceFailures.push({ stage: 'recovery-analysis', kind: failureKind(error) }); }
    let ancillary: ReturnType<typeof observed.ancillaryAnalysis> | null = null;
    try { ancillary = observed.ancillaryAnalysis(final.evidence.endedAt, Math.max(outage.dependencyRestoredAt ?? Infinity, outage.runnerRestoredAt ?? Infinity)); }
    catch (error) { evidenceFailures.push({ stage: 'ancillary-analysis', kind: failureKind(error) }); }
    let named: JsonValue; try { named = asJson(await namedReadback()); } catch { named = { status: 'unavailable', reason: 'named-stored-read-failed' }; }
    let jobInventory: readonly unknown[] | null = null;
    try { jobInventory = await http.query('SELECT job_key,state,attempt_count,last_error,completed_at FROM public.projection_jobs ORDER BY job_key'); }
    catch (error) { evidenceFailures.push({ stage: 'final-job-inventory', kind: failureKind(error) }); }
    const primary = { fixture: coexistence, cache, calls, sqlAttempts, tankAttempts, tankCoverage: { startedAt: coverageStartedAt, endedAt: Date.now(), attempts: tankAttempts.length }, secondaryResponses, rejected, evidenceFailures, setup,
      server: { version: session.version, versionNum: session.version_num },
      jobs: jobInventory,
      backlog: await http.query('SELECT to_jsonb(request) AS request FROM public.public_data_intakes request ORDER BY created_at,id').catch(error => { evidenceFailures.push({ stage: 'final-backlog-inventory', kind: failureKind(error) }); return null; }) };
    const documents = {
      'transport-attempts': evidence?.requests ?? final.evidence.requests,
      'transport-responses': FLEET_REQUEST_OWNERS.map(owner => ({ owner, responses: sourceTransports.get(owner)!.journal().responses })),
      'observer-lineage': { ancillaryQueryRows: final.ancillaryQueryRows, ancillaryProofs: final.ancillaryProofs, ancillaryAnchors: final.ancillaryAnchors, ancillaryRequests: final.ancillaryRequests, receiptProofs: final.receiptProofs, endpointProofs: final.endpointProofs, currentIntakeReads: final.currentIntakeReads, dispatchOutcomes: final.dispatchOutcomes,
        durableDispatches: final.durableDispatches, dispatchObservations: final.dispatchObservations },
      'observer-reads': { ancillaryReads: final.ancillaryReads, lineage: final.lineage, intakePages: final.intakePages, intakePageReads: final.intakePageReads },
      'observer-operations': { ancillaryAnalysis: ancillary, operations: final.operations, failures: final.failures, invocations: final.invocations, ownerCoverage: final.ownerCoverage,
        openInvocations: final.openInvocations, dispatchJournalReadAt: final.dispatchJournalReadAt, initialSubmissions: recoveryRows?.submissions.filter(row => row.id.startsWith('initial-')) ?? [] },
      'capacity-evidence': { manifest: recoveryManifest, observerManifest: built.manifest, evidence, analysis, journalValidation: final.journalValidation, evidenceFailures },
      'named-regressions': named, 'primary-coexistence': primary,
    } as const;
    const inventory = await writeFleetEvidenceChunks(config.evidenceDirectory, config.manifestDigest,
      Object.entries(documents).flatMap(([stream, value]) => fleetDocumentRows(stream as keyof typeof documents, value))); rawWritten = true;
    const closed = final.openInvocations === 0 && final.durableDispatches.every(row => row.outcome !== null) && rejected.length === 0;
    return { inventory, result: { originalStart, endedAt: Date.now(), offlineChecksPass: analysis?.pass === true && ancillary?.pass === true && evidenceFailures.length === 0,
      failedLoop: settled.some(row => row.status === 'rejected'), closed, checkpoint26Qualified: false, primaryCalls: calls.length } };
  }
  try {
    await send({ type: 'ready', sequence: 0, action: null, span: fleetEnd(fleetStart()), inventory: null, result: null, error: false });
    const expected = ['omitted', 'false', 'prepare', dailyBuilt ? 'run-daily' : recoveryBuilt ? 'run-recovery' : 'run-healthy', 'snapshot', 'stop']; let served = 0;
    while (remaining() > 0) {
      while (!commands.length) { remaining(); await delay(25); }
      const command = commands.shift()!; assert.equal(command.action, expected[served++], 'closed worker command sequence changed');
      if (command.action === 'stop') break;
      const start = fleetStart(); let result: Record<string, unknown> | null = null, inventory: FleetMessage['inventory'] = null, error = false;
      try {
        if (command.action === 'prepare') result = await prepare();
        else if (command.action === 'run-daily') { const value = await daily(); result = value.result; inventory = value.inventory; }
        else if (command.action === 'run-recovery') { const value = await recovery(); result = value.result; inventory = value.inventory; }
        else if (command.action === 'run-healthy') { const value = await healthy(); result = value.result; inventory = value.inventory; }
        else if (command.action === 'snapshot') result = { rawWritten, calls: calls.length, rejected: rejected.length, sqlAttempts: sqlAttempts.length,
          openInvocations: currentObserver()?.snapshot().openInvocations ?? 0 };
        else {
          assert(command.action === 'omitted' || command.action === 'false');
          const before = ownerAttempts.get('data-refresh')!.length;
          try { await facade(command.action); } catch { /* Empty initial registry rejection remains an actual primary outcome. */ }
          result = { dataAttemptsBefore: before, dataAttemptsAfter: ownerAttempts.get('data-refresh')!.length, call: calls.at(-1) };
        }
      } catch (cause) { error = true; result = { failure: { stage: command.action, kind: failureKind(cause) }, rawWritten }; }
      await send({ type: 'result', sequence: command.sequence, action: command.action, span: fleetEnd(start), result, inventory, error });
    }
  } finally { globalThis.fetch = originalFetch; await connection.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // Raw database errors, URLs, SQL parameters and provider credentials never enter IPC.
  main().then(() => process.disconnect?.(), () => { process.exitCode = 1; process.disconnect?.(); });
}
