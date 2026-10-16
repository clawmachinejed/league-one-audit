import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runPublicDataRefreshStep, type PublicIntakeDependencies } from '../lib/league-administration/public-intake';
import type { PublicDataRefreshStore } from '../lib/league-administration/public-refresh-contracts';
import type { AdministrationWriteFence } from '../lib/league-administration/contracts';
import type { DatabaseClient, DatabaseRow } from '../lib/database';
import { capturePublicSleeperCore } from '../lib/sleeper';
import { normalizeAdministrationObservation } from '../lib/league-administration/normalize';
import { readPublicSleeperIntake } from '../lib/league-administration/public-intake-reader';
import { createLeagueAdministrationStore } from '../lib/league-administration/store';
import type { LeagueAdministrationStore } from '../lib/league-administration/store-contracts';
import { CONTENTION_CONFIG, CONTENTION_DATABASE, CONTENTION_VERSION, STALE_PROBES,
  parseContentionConfig, contentionControl, parseContentionControl, contentionEnvironment,
  parseContentionMessage, assertSameBackend, contentionFixture, contentionFetch,
  assertContentionReader, assertFairness, isContentionFenceRejection,
  createContentionDiagnostic, parseContentionDiagnostic, createContentionDiagnosticReporter, runContentionSession,
  createContentionSelectionFault, awaitContentionAcquisitionWindow,
  type ContentionConfig, type ContentionMessage, type FairnessObservation } from './competing-workers-protocol';

vi.mock('server-only', () => ({}));
afterEach(() => {vi.restoreAllMocks();vi.useRealTimers();vi.unstubAllGlobals();});
const config = (): ContentionConfig => ({ nonce: randomUUID(), contextNonce: randomUUID(), gitSha: 'a'.repeat(40),
  profileDigest: 'b'.repeat(64), expectedDatabase: 'cp23_test', expectedBranch: 'br-cp23-test',
  fixtures: [randomUUID()], requestId: null, action: 'normal', faultFixture: null });
const at = (seconds: number) => new Date(Date.parse('2026-10-15T19:00:00.000Z') + seconds * 1_000).toISOString();
function message(input: ContentionConfig): ContentionMessage {
  return { version: CONTENTION_VERSION, nonce: input.nonce, contextNonce: input.contextNonce,
    gitSha: input.gitSha, profileDigest: input.profileDigest, pid: 400, backendPid: 401, backendStart: at(0),
    database: input.expectedDatabase, branch: input.expectedBranch, currentUser: 'league_one_runtime',
    sessionUser: 'league_one_runtime', type: 'ready', at: at(1), step: 0, requests: 0 };
}
function owned(input: ContentionConfig): ContentionMessage {
  return { ...message(input), type: 'admitted', step: 1, workerId: randomUUID(), generation: 2,
    deadlineAt: at(21), leaseUntil: at(26), requestId: input.requestId ?? randomUUID(), resource: 'core' };
}
function fairness(): FairnessObservation[] {
  return (['F','A','B','F','A','B'] as const).map((target,index) => ({ target,
    resource: index < 4 ? 'core' : 'users', admittedAt: at(index * 60),
    acceptedAt: target === 'F' ? null : at(index * 60 + 1), readerVerifiedAt: target === 'F' ? null : at(index * 60 + 2),
    requests: index < 4 ? 2 : 1, status: target === 'F' ? 'unavailable' : 'progress',
    receiptCount: target === 'F' || index >= 4 ? 1 : 3 }));
}

describe('CP23 competing worker protocol without database access', () => {
  it('keeps fixture source and process configuration closed without transferring acquired work', () => {
    const input = config(); expect(parseContentionConfig(input)).toEqual(input);
    for (const changes of [{ nonce: 'invalid' }, { contextNonce: randomUUID().toUpperCase() }, { gitSha: 'a' },
      { profileDigest: 'b' }, { expectedDatabase: 'production-db' }, { expectedBranch: 'main' },
      { fixtures: [] }, { fixtures: [input.fixtures[0],input.fixtures[0]] },
      { fixtures: Array.from({ length: 4 }, () => randomUUID()) }, { fixtures: ['invalid'] },
      { requestId: 'invalid' }, { faultFixture: randomUUID() }, { action: 'choose-target' }]) {
      expect(() => parseContentionConfig({ ...input, ...changes })).toThrow();
    }
    for (const key of ['work','fence','capture','receipt','attempt','witness','targetId','lastServedAt'])
      expect(() => parseContentionConfig({ ...input, [key]: {} })).toThrow();
    for (const value of [null,[],false,1,'fixture']) expect(() => parseContentionConfig(value)).toThrow();
  });

  it('strips owner auth control credentials and injection while admitting only an explicit runtime target', () => {
    const input = config(), url = 'postgresql://league_one_runtime:synthetic@cp23.invalid/cp23_test?sslmode=require';
    const env = contentionEnvironment({ PATH: 'bin', NODE_OPTIONS: '--import=unsafe', DATABASE_URL: 'production',
      NEON_API_KEY: 'secret', NEON_TEST_API_KEY: 'secret', PROJECTION_INTEGRATION_OWNER_DATABASE_URL: 'owner',
      AUTH_RESET_INTEGRATION_DATABASE_URL: 'auth', ACCOUNT_FRESH_INSTALL_DATABASE_URL: 'account',
      PROJECTION_INTEGRATION_OWNER_PROOF: 'proof' }, url, input);
    expect(env).toEqual({ PATH: 'bin', NODE_ENV: 'test', [CONTENTION_DATABASE]: url, [CONTENTION_CONFIG]: JSON.stringify(input) });
    for (const invalid of [url.replace('league_one_runtime','owner'), url.replace('require','disable'),
      url.replace('/cp23_test?','/other_test?'), url.replace('postgresql:','https:'), 'invalid'])
      expect(() => contentionEnvironment({}, invalid, input)).toThrow();
  });

  it('binds timing controls to one process source context and exact increasing sequence', () => {
    const input = config();
    for (const command of ['step','release','stop'] as const) {
      const valid = contentionControl(input,command,2);
      expect(parseContentionControl(valid,input,2)).toBe(command);
      for (const changes of [{ nonce: randomUUID() }, { contextNonce: randomUUID() }, { gitSha: 'c'.repeat(40) },
        { profileDigest: 'c'.repeat(64) }, { version: 'other' }, { command: 'select-target' },
        { sequence: 1 }, { sequence: 3 }, { work: {} }, { targetId: randomUUID() }])
        expect(() => parseContentionControl({ ...valid,...changes },input,2)).toThrow();
      expect(() => parseContentionControl(valid,input,0)).toThrow();
      expect(() => parseContentionControl(valid,input,1.5)).toThrow();
    }
  });

  it('rejects foreign roles processes sources targets and secret-bearing evidence', () => {
    const input = config(), valid = message(input); expect(parseContentionMessage(valid,input,400)).toEqual(valid);
    for (const changes of [{ nonce: randomUUID() }, { contextNonce: randomUUID() }, { gitSha: 'c'.repeat(40) },
      { profileDigest: 'c'.repeat(64) }, { pid: 402 }, { backendPid: 1 }, { backendPid: 1.5 },
      { backendStart: 'invalid' }, { at: 'invalid' }, { currentUser: 'owner' }, { sessionUser: 'owner' },
      { database: 'other_test' }, { branch: 'br-other-test' }, { version: 'other' }, { type: 'selected-target' },
      { requests: 3 }, { requests: -1 }, { step: -1 }, { step: 1.5 }, { error: 'unsafe secret' }, { url: 'secret' }])
      expect(() => parseContentionMessage({ ...valid,...changes },input,400)).toThrow();
  });

  it('requires owned operation evidence and admits only zero-request unowned busy results', () => {
    const input = config(), valid = owned(input);
    expect(parseContentionMessage(valid,input,400)).toEqual(valid);
    const busy = { ...message(input), type: 'result', step: 1, status: 'busy' };
    expect(parseContentionMessage(busy,input,400)).toEqual(busy);
    for (const changes of [{ workerId: undefined }, { generation: undefined }, { generation: 0 },
      { deadlineAt: undefined }, { deadlineAt: 'invalid' }, { requestId: undefined }, { resource: undefined },
      { resource: 'drafts' }, { status: 'progress' }, { rejected: STALE_PROBES }])
      expect(() => parseContentionMessage({ ...valid,...changes },input,400)).toThrow();
    for (const changes of [{ requests: 1 }, { status: 'progress' }, { workerId: randomUUID() }, { generation: 2 }])
      expect(() => parseContentionMessage({ ...busy,...changes },input,400)).toThrow();
    const selected = { ...input,requestId: randomUUID() };
    expect(() => parseContentionMessage(valid,selected,400)).toThrow();
  });

  it('binds explicit stale probes to the complete fixed mutation denominator', () => {
    const input = { ...config(), action: 'stale-core' as const }, valid = { ...owned(input), type: 'probes', requests: 2, rejected: STALE_PROBES };
    expect(parseContentionMessage(valid,input,400)).toEqual(valid);
    expect(STALE_PROBES).toEqual(['admission','typed-acceptance','failure-checkpoint','job-completion','job-failure']);
    for (const rejected of [undefined,[],STALE_PROBES.slice(1),[...STALE_PROBES].reverse(),[...STALE_PROBES,'forged']])
      expect(() => parseContentionMessage({ ...valid,rejected },input,400)).toThrow();
  });

  it('does not mistake a changed backend start or process nonce for continued live ownership', () => {
    const input = config(), first = message(input), next = { ...first,type: 'attempt' as const,step: 1 };
    expect(() => assertSameBackend(first,next)).not.toThrow();
    for (const changes of [{ pid: 500 }, { backendPid: 501 }, { backendStart: at(3) }, { nonce: randomUUID() }])
      expect(() => assertSameBackend(first,{ ...next,...changes })).toThrow();
  });

  it('recognizes only installed stale-fence SQL failures without credit for invalid payloads', () => {
    const error = (code: string,message: string) => Object.assign(new Error(message),{ code });
    expect(isContentionFenceRejection(error('P0001','public intake lease lost'),'intake')).toBe(true);
    for (const text of ['league administration writer fence is stale','public intake lease lost'])
      expect(isContentionFenceRejection(error('P0001',text),'acceptance')).toBe(true);
    for (const problem of [error('P0001','public resource checkpoint incomplete'), error('P0001','invalid league administration envelope'),
      error('23505','public intake lease lost'), error('P0001','unsafe secret'), new Error('public intake lease lost'), null, false,
      { code: 'P0001',message: 'public intake lease lost' }]) {
      expect(isContentionFenceRejection(problem,'intake')).toBe(false);
      expect(isContentionFenceRejection(problem,'acceptance')).toBe(false);
    }
  });

  it('runs the real core source adapter with only the roster endpoint failing and keeps both GET attempts', async () => {
    const base = config(), input = { ...base,faultFixture: base.fixtures[0] }, fixture = contentionFixture(input.fixtures[0]), count = vi.fn();
    vi.spyOn(globalThis,'fetch').mockImplementation(contentionFetch(input,count));
    const results = await Promise.allSettled(['league','rosters'].map(family =>
      capturePublicSleeperCore(fixture.external,family as 'league'|'rosters',new AbortController().signal)));
    expect(count).toHaveBeenCalledTimes(2);
    expect(results[0]).toMatchObject({ status: 'fulfilled',value: { family: 'league',payload: fixture.league,origin: 'network' } });
    expect(results[1].status).toBe('rejected');
  });

  it('rejects nonfixture providers methods prior seasons and aborted requests before acquisition credit', async () => {
    const input = config(), fixture = contentionFixture(input.fixtures[0]), observe = vi.fn(), source = contentionFetch(input,observe);
    await expect(source('https://api.tank01.com/')).rejects.toThrow('Nonfixture');
    await expect(source('https://api.sleeper.app/v1/user/'+fixture.manager+'/leagues/nfl/2025')).rejects.toThrow('Nonfixture');
    await expect(source('https://api.sleeper.app/v1/league/'+fixture.external,{ method: 'POST' })).rejects.toThrow('Nonfixture');
    await expect(source('https://api.sleeper.app/v1/league/'+fixture.external,{ signal: AbortSignal.abort() })).rejects.toThrow();
    expect(observe).not.toHaveBeenCalled();
    await expect(source('https://api.sleeper.app/v1/league/'+fixture.external+'/rosters')).resolves.toBeInstanceOf(Response);
    expect(observe).toHaveBeenCalledTimes(1);
  });

  it('requires all six fixed admissions and four accepted readbacks with both incomplete targets retained', () => {
    const valid = fairness(); expect(() => assertFairness(valid,at(0))).not.toThrow();
    const changes: ((rows: FairnessObservation[]) => void)[] = [rows => { rows.pop(); },rows => { rows.reverse(); },
      rows => { rows[0] = { ...rows[0],receiptCount: 0 }; },rows => { rows[0] = { ...rows[0],receiptCount: 3 }; },
      rows => { rows[0] = { ...rows[0],acceptedAt: at(1) }; },rows => { rows[3] = { ...rows[3],readerVerifiedAt: at(182) }; },
      rows => { rows[1] = { ...rows[1],status: 'busy' }; },rows => { rows[1] = { ...rows[1],receiptCount: 0 }; },
      rows => { rows[1] = { ...rows[1],acceptedAt: null,readerVerifiedAt: null }; },
      rows => { rows[1] = { ...rows[1],readerVerifiedAt: at(59) }; },rows => { rows[1] = { ...rows[1],acceptedAt: 'invalid' }; },
      rows => { rows[4] = { ...rows[4],resource: 'core' }; },rows => { rows[5] = { ...rows[5],requests: 0 }; },
      rows => { rows[2] = { ...rows[2],admittedAt: at(119) }; },rows => { rows[0] = { ...rows[0],admittedAt: at(-1) }; }];
    for (const change of changes) { const adverse = structuredClone(valid); change(adverse); expect(() => assertFairness(adverse,at(0))).toThrow(); }
    expect(() => assertFairness(valid,'invalid')).toThrow();
  });

  it('enforces each healthy deadline and its revisit bound without pooling or resetting the epoch', () => {
    for (const [index,limit] of [[1,180],[2,240],[4,360],[5,420]]) {
      const rows = fairness(); rows[index] = { ...rows[index],readerVerifiedAt: at(limit+0.001) };
      expect(() => assertFairness(rows,at(0))).toThrow();
    }
    const revisit = fairness();
    revisit[4] = { ...revisit[4],admittedAt: at(300),acceptedAt: at(301),readerVerifiedAt: at(303) };
    revisit[5] = { ...revisit[5],admittedAt: at(360),acceptedAt: at(361),readerVerifiedAt: at(362) };
    expect(() => assertFairness(revisit,at(0))).toThrow('revisit');
    const acceptedRevisit = fairness();
    acceptedRevisit[1] = { ...acceptedRevisit[1],readerVerifiedAt: at(179) };
    acceptedRevisit[4] = { ...acceptedRevisit[4],admittedAt: at(300),acceptedAt: at(302),readerVerifiedAt: at(303) };
    acceptedRevisit[5] = { ...acceptedRevisit[5],admittedAt: at(360),acceptedAt: at(361),readerVerifiedAt: at(362) };
    // A's readback gap is only 124s, but its authentic acceptance gap is 241s.
    expect(() => assertFairness(acceptedRevisit,at(0))).toThrow('revisit');
    const unserved = fairness(); unserved[5] = { ...unserved[5],acceptedAt: null,readerVerifiedAt: null };
    expect(() => assertFairness(unserved,at(0))).toThrow();
  });
});

/** Synthetic stored responses, composed by the real reader and normalizer.
 * This is an offline contract oracle, never SQL acceptance or LOGIN evidence. */
async function storedRead(users: boolean, drift?: 'settings-receipt'|'directory-capture'|'directory-observation') {
  const fixture = contentionFixture(randomUUID()), requestId = randomUUID();
  const mapping = { connectionId: randomUUID(),leagueSeasonId: randomUUID(),revisionId: randomUUID(),generation: 1,
    scope: { leagueKey: 'sleeper-'+fixture.external,provider: 'sleeper' as const,externalLeagueId: fixture.external,season: 2026 } };
  const ids = { settings: randomUUID(),players: randomUUID(),managers: randomUUID(),users: randomUUID(),capture: randomUUID(),content: randomUUID() };
  const normalize = (family: 'league'|'users',payload: typeof fixture.league | typeof fixture.users) => normalizeAdministrationObservation({
    schemaVersion: 'league-administration-v1',normalizerVersion: 'sleeper-administration-v1',dialect: 'sleeper-nfl-v1',scope: mapping.scope,
    family,week: null,completeness: 'complete',payload,provenance: { origin: 'network',requestStartedAt: at(0),requestCompletedAt: at(1),sourceObservedAt: at(1),checkedAt: at(1) } });
  const league = normalize('league',fixture.league), directory = normalize('users',fixture.users);
  if (league.status !== 'accepted' || league.leagueSettings?.status !== 'complete' || directory.status !== 'accepted') throw new Error('Offline source normalization failed.');
  const reference = (resourceKind: string,nativeNamespace: string,nativeId: string) => ({ provider: 'sleeper',resourceKind,nativeNamespace,nativeId });
  const manager = { providerManagerId: randomUUID(),sourceManager: reference('manager','sleeper-user',fixture.manager) };
  const capture = { id: ids.capture,intakeId: requestId,contentId: ids.content,legacyObservationId: ids.users,sourceMapping: mapping,
    requestStartedAt: at(0),requestCompletedAt: at(1),sourceObservedAt: at(1),recordedAt: at(2) };
  const query = vi.fn(async (sql: string): Promise<readonly DatabaseRow[]> => {
    if (sql.includes('public-data-intake:read-request')) return [{ id: requestId,seasons: [2026],terminal: users,external_manager_id: fixture.manager }];
    if (sql.includes('public-data-intake:read-lists')) return [{ season: 2026 }];
    if (sql.includes('public-data-intake:read-candidates')) return [{ season: 2026,external_league_id: fixture.external,name: fixture.league.name,
      stage: users ? 'complete' : 'users',league_season_id: mapping.leagueSeasonId,settings_receipt_id: ids.settings,
      players_receipt_id: ids.players,managers_receipt_id: ids.managers,users_observation_id: users ? ids.users : null,directory_capture: users ? capture : null }];
    if (sql.includes('public-data-intake:read-rejections')) return [];
    throw new Error('Unexpected stored reader query.');
  });
  const client = { enabled: true,query } as unknown as DatabaseClient;
  const available = (id: string) => ({ status: 'available',accepted: { observationIds: [drift === 'settings-receipt' && id === ids.settings ? randomUUID() : id] },receipt: { id } });
  const administration = { ...createLeagueAdministrationStore({ enabled: false,reason: 'missing-database-url' }),
    readSourceMapping: vi.fn().mockResolvedValue(mapping),
    readAcceptedLeagueSettings: vi.fn().mockResolvedValue({ ...available(ids.settings),value: league.leagueSettings.value }),
    readAcceptedCurrentRoster: vi.fn().mockResolvedValue({ ...available(ids.players),teams: [1,2].map(id => ({ seasonTeamId: randomUUID(),externalRosterId: String(id),players: [],currentGroups: {} })) }),
    readAcceptedTeamManagers: vi.fn().mockResolvedValue({ ...available(ids.managers),teams: [1,2].map(id => ({ seasonTeamId: randomUUID(),sourceTeam: reference('team','sleeper-roster',String(id)),
      primaryOwner: id === 1 ? { state: 'owned',manager } : { state: 'unowned',manager: null },coManagers: { state: 'known',managers: [],completeness: 'complete' } })) }),
    readSource: vi.fn().mockResolvedValue(users ? { status: 'available',observationId: drift === 'directory-observation' ? randomUUID() : ids.users,value: directory.value } : { status: 'missing' }),
    readManagerDirectoryCapture: vi.fn().mockResolvedValue({ status: 'available',version: 'sleeper-manager-directory-v1',leagueSeasonId: mapping.leagueSeasonId,
      sourceMapping: mapping,captureBinding: 'intake-directory-capture',capture: drift === 'directory-capture' ? { ...capture,id: randomUUID() } : capture,managers: [{ ...manager,displayName: fixture.username,username: null,avatar: null,commissioner: { state: 'absent',value: null,sourcePath: 'is_owner' } }] }),
  } as unknown as LeagueAdministrationStore;
  const noFetch = vi.spyOn(globalThis,'fetch').mockImplementation(async () => { throw new Error('Stored read tried source access.'); });
  const read = await readPublicSleeperIntake(client,administration,requestId);
  expect(noFetch).not.toHaveBeenCalled();
  expect(query.mock.calls.every(([sql]) => !/\b(insert|update|delete)\b/iu.test(sql))).toBe(true);
  return { read,fixture };
}

describe('CP23 oracle against the actual stored reader contract', () => {
  it.each([false,true])('accepts actual reader status and receipt-bound typed fixture values with users=%s', async users => {
    const { read,fixture } = await storedRead(users);
    expect(read.status).toBe(users ? 'available' : 'pending');
    expect(() => assertContentionReader(read,fixture,users)).not.toThrow();
    if (users) expect(() => assertContentionReader({ ...read,status: 'complete' },fixture,true)).toThrow();
  });
  it('rejects absent foreign incomplete and incorrect stored facts despite available labels', async () => {
    const { read,fixture } = await storedRead(true);
    if (read.status === 'missing' || !read.leagues[0].resources) throw new Error('Offline reader missing.');
    const changes: ((value: Record<string,unknown>) => void)[] = [value => { value.status = 'pending'; },value => { value.leagues = []; }];
    for (const change of changes) { const adverse = structuredClone(read); change(adverse); expect(() => assertContentionReader(adverse,fixture,true)).toThrow(); }
    for (const key of ['settings','heldRoster','teamManagers','directory','managerDirectory']) {
      const adverse = structuredClone(read) as unknown as { leagues: { resources: Record<string,unknown> }[] };
      adverse.leagues[0].resources[key] = { status: 'unavailable' };
      expect(() => assertContentionReader(adverse,fixture,true)).toThrow();
    }
    expect(() => assertContentionReader(read,contentionFixture(randomUUID()),true)).toThrow();
    const values: readonly [string,unknown][] = [
      ['settings.value.sourceLeague.nativeId','foreign'],['settings.value.sourceLeague.provider','yahoo'],
      ['settings.value.season',2025],['settings.value.name.value','Wrong league'],['settings.value.teamCount.value',3],
      ['settings.value.scoring.rules.state','known'],['settings.value.slots.state','known'],
      ['heldRoster.teams.0.externalRosterId','foreign'],['heldRoster.teams.0.players',[{}]],
      ['teamManagers.teams.0.primaryOwner.manager.sourceManager.nativeId','foreign'],
      ['teamManagers.teams.1.primaryOwner.state','owned'],['teamManagers.teams.0.coManagers.managers',[{}]],
      ['managerDirectory.managers.0.sourceManager.nativeId','foreign'],['managerDirectory.managers.0.displayName','Wrong manager'],
    ];
    for (const [path,replacement] of values) {
      const adverse = structuredClone(read), parts = ['leagues','0','resources',...path.split('.')];
      let row = adverse as unknown as Record<string,unknown>;
      for (const key of parts.slice(0,-1)) row = row[key] as Record<string,unknown>;
      row[parts.at(-1)!] = replacement;
      expect(() => assertContentionReader(adverse,fixture,true),path).toThrow();
    }

  });
  it.each(['settings-receipt','directory-capture','directory-observation'] as const)('rejects actual reader lineage drift: %s', async drift => {
    const { read,fixture } = await storedRead(true,drift);
    expect(() => assertContentionReader(read,fixture,true)).toThrow();
  });

});

describe('CP23 repaired worker failure boundaries',()=>{
  it('sanitizes known failures without inspecting getters, prototypes, stacks, causes or unknown messages',()=>{
    const input=config(), secret='postgresql://owner:DO_NOT_RETAIN@host/db SQL secret';
    const known=createContentionDiagnostic(input,400,'evidence',Object.assign(new Error('CP23 backend identity changed.'),{code:secret,cause:secret,stack:secret}));
    expect(known).toMatchObject({code:'backend-identity-changed',sqlState:null,cleanupFailed:false});
    const getter=vi.fn(()=>{throw new Error(secret);});
    const hostile=Object.defineProperties({},{message:{get:getter},code:{get:getter},stack:{get:getter},cause:{get:getter}});
    const values=[new Error(secret),{message:{toString:getter},code:{toString:getter}},hostile,
      Object.create({message:'CP23 backend identity changed.',code:'P0001'}),new Proxy({},{getOwnPropertyDescriptor:getter}),null,secret];
    for(const value of values){
      const diagnostic=createContentionDiagnostic(input,400,'step',value);
      expect(diagnostic.code).toBe('worker-error');expect(diagnostic.sqlState).toBeNull();
      expect(JSON.stringify(diagnostic)).not.toContain('DO_NOT_RETAIN');
      expect(Object.keys(diagnostic).sort()).toEqual(['at','cleanupFailed','code','contextNonce','gitSha','nonce','phase','pid','profileDigest','sqlState','type','version']);
    }
    // Only the proxy's own-descriptor traps run; no property getter/toString runs.
    expect(getter).toHaveBeenCalledTimes(2);
    expect(createContentionDiagnostic(input,400,'step',Object.assign(new Error(secret),{code:'P0001'}))).toMatchObject({code:'database-error',sqlState:'P0001'});
    for(const [message,code] of [['CP23 original work missing.','original-work-missing'],['CP23 stale operation was accepted.','stale-operation-accepted'],
      ['CP23 stale rejection was not an installed SQL guard.','wrong-stale-guard'],['CP23 stale job transition accepted.','stale-job-transition-accepted'],
      ['CP23 unexpected admitted resource.','unexpected-resource'],['CP23 worker elapsed limit exhausted.','worker-deadline']])
      expect(createContentionDiagnostic(input,400,'step',new Error(message)).code).toBe(code);
  });

  it('accepts one source-bound fatal without startup proof and rejects foreign, duplicate, malformed or success-bearing records',()=>{
    const input=config(),valid=createContentionDiagnostic(input,400,'session-open',new Error('synthetic startup failure'));
    expect(parseContentionDiagnostic(valid,input,400)).toEqual(valid);
    expect(()=>parseContentionMessage(valid,input,400)).toThrow();
    expect(()=>parseContentionDiagnostic(valid,input,400,valid)).toThrow();
    for(const changes of [{nonce:randomUUID()},{contextNonce:randomUUID()},{gitSha:'c'.repeat(40)},{profileDigest:'d'.repeat(64)},
      {pid:401},{version:'other'},{type:'ready'},{phase:'unknown'},{code:'raw secret'},{sqlState:'SECRET'},{cleanupFailed:'yes'},
      {backendPid:401},{currentUser:'league_one_runtime'},{requests:0},{status:'progress'},{message:'secret'},
      {at:'2026-10-15 (secret)'},{at:'2026-10-15T19:00:00.000Z'+' '.repeat(10_000)},{at:'2026-10-15'},
      {at:'2026-10-15T19:00:00.000+00:00'}]) expect(()=>parseContentionDiagnostic({...valid,...changes},input,400)).toThrow();
    const missing=Object.fromEntries(Object.entries(valid).filter(([key])=>key!=='sqlState'));
    expect(()=>parseContentionDiagnostic(missing,input,400)).toThrow();
  });

  it('sends at most one fatal and completes a closed or unacknowledged IPC attempt within500ms',async()=>{
    const input=config(),error=new Error('CP23 backend identity changed.');
    const accepted=vi.fn((_value:unknown,callback:(error?:Error)=>void)=>callback());
    const first=createContentionDiagnosticReporter(input,400,accepted);
    expect(await first('evidence',error)).toBe(true);expect(await first('cleanup',error,true)).toBe(false);
    expect(accepted).toHaveBeenCalledOnce();
    const closed=vi.fn(()=>{throw Object.assign(new Error('secret closed peer'),{code:'ERR_IPC_CHANNEL_CLOSED'});});
    expect(await createContentionDiagnosticReporter(input,400,closed)('evidence',error)).toBe(false);
    const callbackError=vi.fn((_value:unknown,callback:(error?:Error)=>void)=>callback(new Error('closed peer')));
    expect(await createContentionDiagnosticReporter(input,400,callbackError)('evidence',error)).toBe(false);
    expect(await createContentionDiagnosticReporter(input,400)('evidence',error)).toBe(false);
    vi.useFakeTimers();const noAck=vi.fn(),report=createContentionDiagnosticReporter(input,400,noAck);
    let done=false;const pending=report('evidence',error).then(value=>{done=true;return value;});
    await vi.advanceTimersByTimeAsync(499);expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);expect(await pending).toBe(false);
    expect(await report('cleanup',error,true)).toBe(false);expect(noAck).toHaveBeenCalledOnce();
  });

  it('preserves the first worker failure and phase when close also fails, with cleanup-only failure explicit',async()=>{
    const original=new Error('CP23 backend identity changed.'),closeError=new Error('secret close failure');
    const close=vi.fn(async()=>{throw closeError;});
    const failure=await runContentionSession(async()=>{throw original;},close,()=> 'evidence');
    expect(failure).toEqual({phase:'evidence',error:original,cleanupFailed:true});expect(close).toHaveBeenCalledOnce();
    expect(createContentionDiagnostic(config(),400,failure!.phase,failure!.error,failure!.cleanupFailed))
      .toMatchObject({phase:'evidence',code:'backend-identity-changed',cleanupFailed:true});
    expect(await runContentionSession(async()=>{},close,()=> 'step')).toEqual({phase:'cleanup',error:closeError,cleanupFailed:true});
    const normalClose=vi.fn(async()=>{});
    expect(await runContentionSession(async()=>{},normalClose,()=> 'step')).toBeNull();expect(normalClose).toHaveBeenCalledOnce();
  });

  it('injects one failure only after the real selector identifies F and never on the normal competitor',()=>{
    const input=config(),f=contentionFixture(input.fixtures[0]),h=contentionFixture(randomUUID());
    const fail=createContentionSelectionFault({...input,action:'selection-failure',faultFixture:f.id});
    expect(()=>fail(h.manager)).not.toThrow();expect(()=>fail(f.manager)).toThrow('Declared CP23 pre-admission');
    expect(()=>fail(f.manager)).not.toThrow();expect(()=>fail(h.manager)).not.toThrow();
    const normal=createContentionSelectionFault({...input,action:'normal',faultFixture:f.id});
    expect(()=>normal(f.manager)).not.toThrow();expect(()=>normal(f.manager)).not.toThrow();
  });

  it('waits for both observed SQL gates, rejects malformed gates and cannot accept a late observation',async()=>{
    let clock=0;const seen:number[]=[];
    await awaitContentionAcquisitionWindow(async()=>{seen.push(clock);return {job_eligible:clock>=500,admission_eligible:clock>=1_000};},2_000,
      ()=>clock,async ms=>{expect(ms).toBeLessThanOrEqual(500);clock+=ms;});
    expect(seen).toEqual([0,500,1_000]);
    await expect(awaitContentionAcquisitionWindow(async()=>({job_eligible:true,admission_eligible:undefined as unknown as boolean}),1_000,()=>0,async()=>{})).rejects.toThrow('observation');
    clock=0;await expect(awaitContentionAcquisitionWindow(async()=>({job_eligible:false,admission_eligible:true}),1_000,()=>clock,async ms=>{clock+=ms;})).rejects.toThrow('exhausted');
    clock=0;await expect(awaitContentionAcquisitionWindow(async()=>{clock=1_000;return {job_eligible:true,admission_eligible:true};},1_000,()=>clock,async()=>{})).rejects.toThrow('exhausted');
    for(const ms of [0,-1,75_001,NaN,Infinity]) await expect(awaitContentionAcquisitionWindow(async()=>({job_eligible:true,admission_eligible:true}),ms)).rejects.toThrow('budget');
  });
});

/** Synthetic durable timeline + actual ordinary runner and fixture callbacks.
 * This proves orchestration, not PostgreSQL selectors, receipts or hosted acceptance. */
function selectionTimeline(repaired:boolean){
  const input=config(),f=contentionFixture(input.fixtures[0]),h=contentionFixture(randomUUID());
  let clock=30_000,retryAt=0,lastAdmission=0,completedAt:number|null=null,generation=0;
  let selected:{target:'F'|'H';requestId:string;fence:AdministrationWriteFence}|undefined;
  const failures:Array<{target:string;owner:string;generation:number;at:number}>=[],admissions:Array<{target:string;at:number}>=[];
  const oneShot=createContentionSelectionFault({...input,action:'selection-failure',faultFixture:f.id});
  const fault=(manager:string)=>{if(repaired)oneShot(manager);else if(manager===f.manager)throw new Error('Declared CP23 pre-admission boundary failure.');};
  const dependencies={now:()=>new Date(clock),jobs:{
    acquireJob:async(input:Parameters<PublicIntakeDependencies['jobs']['acquireJob']>[0])=>{
      expect(input.leaseSeconds).toBe(25);expect(input.minimumIntervalSeconds).toBe(60);
      if(completedAt!==null&&clock<completedAt+60_000)return {kind:'busy'};
      return {kind:'acquired',attempt:++generation,leaseUntil:new Date(clock+25_000).toISOString()};
    },completeJob:async()=>{completedAt=clock;return true;},failJob:async()=>{completedAt=null;return true;},
  },refresh:{select:async(fence:AdministrationWriteFence)=>{
    const target=clock>=retryAt?'F':'H',fixture=target==='F'?f:h;
    selected={target,requestId:fixture.id,fence};fault(fixture.manager);
    return {status:'selected',targetId:fixture.id,configurationRevision:1,cycleConfigurationRevision:1,cycle:1,requestId:fixture.id};
  },recordSelectionFailure:async(_selection:unknown,fence:AdministrationWriteFence)=>{
    expect(selected).toMatchObject({target:'F',fence});expect(_selection).toBeNull();
    failures.push({target:'F',owner:fence.workerId,generation:fence.generation,at:clock});retryAt=clock+60_000;
    return {status:'recorded',retryAt:new Date(retryAt).toISOString()};
  }},intake:{recover:async()=>{},next:async(requestId:string)=>({kind:'core',requestId,externalLeagueId:h.external,season:2026}),
    admit:async()=>{if(clock<lastAdmission+60_000)return false;admissions.push({target:selected!.target,at:clock});lastAdmission=clock;return true;},fail:async()=>{},
  },administration:{readSourceMapping:async()=>{throw new Error('Offline test stops after the actual admission boundary.');}}} as unknown as PublicIntakeDependencies&{refresh:PublicDataRefreshStore};
  return {run:()=>runPublicDataRefreshStep(dependencies,new AbortController().signal),fault,failures,admissions,
    now:()=>clock,advance:(ms:number)=>{clock+=ms;},retry:()=>retryAt,
    probe:async()=>({job_eligible:completedAt===null||clock>=completedAt+60_000,admission_eligible:clock>=lastAdmission+60_000})};
}
describe('CP23 actual runner selection-failure chronology with synthetic stores',()=>{
  it('reproduces the old healthy admission backoff, completed cooldown and second failing selection',async()=>{
    const model=selectionTimeline(false);
    expect(await model.run()).toMatchObject({status:'unavailable',providerRequests:0});
    expect(await model.run()).toEqual({status:'backoff',providerRequests:0});
    expect(model.failures).toHaveLength(1);expect(model.admissions).toEqual([]);
    model.advance(60_000);
    expect(await model.run()).toMatchObject({status:'unavailable',providerRequests:0});
    expect(model.failures.map(row=>row.at)).toEqual([30_000,90_000]);expect(model.admissions).toEqual([]);
  });
  it('uses the actual prewait and one-shot path before allowing H admission inside the original F retry window',async()=>{
    const model=selectionTimeline(true);
    await awaitContentionAcquisitionWindow(async()=>{expect(model.failures).toEqual([]);return model.probe();},75_000,model.now,async ms=>model.advance(ms));
    expect(model.now()).toBe(60_000);
    expect(await model.run()).toMatchObject({status:'unavailable',providerRequests:0});
    expect(model.failures).toHaveLength(1);expect(model.failures[0]).toMatchObject({target:'F',at:60_000,generation:1});
    expect(model.failures[0].owner).toMatch(/^[0-9a-f-]{36}$/);
    await model.run(); // Stops deliberately after admission: no synthetic typed receipt or success credit.
    expect(model.admissions).toEqual([{target:'H',at:60_000}]);
    expect(model.admissions[0].at).toBeLessThan(model.retry());expect(model.failures).toHaveLength(1);
  });
});
