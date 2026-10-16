import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { integrationChildEnvironment } from './disposable-integration';

export const CONTENTION_VERSION = 'cp23-competing-workers-v1';
export const CONTENTION_CONFIG = 'CP23_WORKER_CONFIG';
export const CONTENTION_DATABASE = 'CP23_RUNTIME_DATABASE_URL';
export const contentionUuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.test(value);
export type ContentionConfig = Readonly<{ nonce: string; contextNonce: string; gitSha: string; profileDigest: string;
  expectedDatabase: string; expectedBranch: string; fixtures: readonly string[]; requestId: string | null;
  action: 'normal' | 'stale-core' | 'hold-selected' | 'bootstrap-lock' | 'selection-failure';
  faultFixture: string | null }>;
export function parseContentionConfig(value: unknown): ContentionConfig {
  const row = object(value);
  if (Object.keys(row).sort().join('|') !== 'action|contextNonce|expectedBranch|expectedDatabase|faultFixture|fixtures|gitSha|nonce|profileDigest|requestId'
    || !contentionUuid(row.nonce) || !contentionUuid(row.contextNonce)
    || typeof row.gitSha !== 'string' || !/^[0-9a-f]{40}$/u.test(row.gitSha)
    || typeof row.profileDigest !== 'string' || !/^[0-9a-f]{64}$/u.test(row.profileDigest)
    || typeof row.expectedDatabase !== 'string' || !/^[a-z][a-z0-9_]{0,62}$/u.test(row.expectedDatabase)
    || typeof row.expectedBranch !== 'string' || !/^br-[a-z0-9-]{1,100}$/u.test(row.expectedBranch)
    || !Array.isArray(row.fixtures) || row.fixtures.length < 1 || row.fixtures.length > 3
    || !row.fixtures.every(contentionUuid) || new Set(row.fixtures).size !== row.fixtures.length
    || row.requestId !== null && !contentionUuid(row.requestId)
    || row.faultFixture !== null && (!contentionUuid(row.faultFixture) || !row.fixtures.includes(row.faultFixture))
    || !['normal', 'stale-core', 'hold-selected', 'bootstrap-lock', 'selection-failure'].includes(String(row.action))) {
    throw new Error('Invalid CP23 worker configuration.');
  }
  return row as ContentionConfig;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid CP23 record.');
  return value as Record<string, unknown>;
}
export function contentionEnvironment(source: Record<string, string | undefined>, url: string, config: ContentionConfig): NodeJS.ProcessEnv {
  parseContentionConfig(config);
  const parsed = new URL(url);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || decodeURIComponent(parsed.username) !== 'league_one_runtime'
    || !['require', 'verify-full', 'verify-ca'].includes(parsed.searchParams.get('sslmode') ?? '')
    || decodeURIComponent(parsed.pathname.slice(1)) !== config.expectedDatabase) throw new Error('CP23 requires explicit restricted runtime LOGIN.');
  return { ...integrationChildEnvironment(source), [CONTENTION_DATABASE]: url, [CONTENTION_CONFIG]: JSON.stringify(config) };
}
export type Control = 'step' | 'release' | 'stop';
export function contentionControl(config: ContentionConfig, command: Control, sequence: number) {
  return { version: CONTENTION_VERSION, nonce: config.nonce, contextNonce: config.contextNonce,
    gitSha: config.gitSha, profileDigest: config.profileDigest, command, sequence };
}
export function parseContentionControl(value: unknown, config: ContentionConfig, sequence: number): Control {
  const row = object(value);
  if (!['step', 'release', 'stop'].includes(String(row.command)) || !Number.isSafeInteger(sequence) || sequence < 1
    || JSON.stringify(Object.keys(row).sort()) !== JSON.stringify(Object.keys(contentionControl(config, 'step', sequence)).sort())
    || Object.entries(contentionControl(config, row.command as Control, sequence)).some(([key, expected]) => row[key] !== expected)) {
    throw new Error('CP23 control binding rejected.');
  }
  return row.command as Control;
}
/** Fatal diagnostics never establish a LOGIN, backend, claim, acquisition or pass. */
export const CONTENTION_PHASES = ['configuration','source','session-open','session-identity','control','step','evidence','cleanup'] as const;
export type ContentionPhase = typeof CONTENTION_PHASES[number];
const FAILURE_CODES = ['backend-identity-changed','restricted-login-rejected','control-rejected','ipc-failed','acquisition-accounting','original-work-missing','wrong-stale-guard','stale-operation-accepted','stale-job-transition-accepted','unexpected-resource','worker-deadline','database-error','worker-error'] as const;
const SQL_STATES = ['P0001','25P02','57014','08000','08001','08003','08004','08006','08P01','53300','57P01','57P02','57P03'] as const;
export type ContentionDiagnostic = Readonly<{ version: typeof CONTENTION_VERSION; nonce: string; contextNonce: string;
  gitSha: string; profileDigest: string; pid: number; type: 'fatal'; at: string; phase: ContentionPhase;
  code: typeof FAILURE_CODES[number]; sqlState: typeof SQL_STATES[number] | null; cleanupFailed: boolean }>;
function errorData(error: unknown, key: string): unknown {
  try { return error && (typeof error === 'object' || typeof error === 'function')
    ? Object.getOwnPropertyDescriptor(error,key)?.value : undefined; } catch { return undefined; }
}
export function createContentionDiagnostic(config: ContentionConfig, pid: number, phase: ContentionPhase,
  error: unknown, cleanupFailed = false): ContentionDiagnostic {
  const message = errorData(error,'message'), state = errorData(error,'code');
  const sqlState = SQL_STATES.find(value => value === state) ?? null;
  const code = message === 'CP23 backend identity changed.' ? 'backend-identity-changed'
    : message === 'CP23 requires actual restricted LOGIN.' ? 'restricted-login-rejected'
    : typeof message === 'string' && ['CP23 control lifecycle failed.','CP23 invalid control.','CP23 barrier requires its fixed release.','CP23 received release outside its barrier.'].includes(message) ? 'control-rejected'
    : message === 'CP23 IPC failed.' ? 'ipc-failed'
    : message === 'CP23 actual acquisition accounting differs.' ? 'acquisition-accounting'
    : message === 'CP23 original work missing.' ? 'original-work-missing'
    : message === 'CP23 stale rejection was not an installed SQL guard.' ? 'wrong-stale-guard'
    : message === 'CP23 stale operation was accepted.' ? 'stale-operation-accepted'
    : message === 'CP23 stale job transition accepted.' ? 'stale-job-transition-accepted'
    : message === 'CP23 unexpected admitted resource.' ? 'unexpected-resource'
    : message === 'CP23 worker elapsed limit exhausted.' ? 'worker-deadline'
    : sqlState ? 'database-error' : 'worker-error';
  return { version: CONTENTION_VERSION, nonce: config.nonce, contextNonce: config.contextNonce,
    gitSha: config.gitSha, profileDigest: config.profileDigest, pid, type: 'fatal', at: new Date().toISOString(),
    phase, code, sqlState, cleanupFailed };
}
export function parseContentionDiagnostic(value: unknown, config: ContentionConfig, pid: number,
  previous?: ContentionDiagnostic): ContentionDiagnostic {
  const row=object(value);
  if (previous || Object.keys(row).sort().join('|') !== 'at|cleanupFailed|code|contextNonce|gitSha|nonce|phase|pid|profileDigest|sqlState|type|version'
    || row.version!==CONTENTION_VERSION || row.type!=='fatal' || row.nonce!==config.nonce || row.contextNonce!==config.contextNonce
    || row.gitSha!==config.gitSha || row.profileDigest!==config.profileDigest || row.pid!==pid || !Number.isSafeInteger(pid) || pid<1
    || typeof row.at!=='string' || row.at.length!==24 || !Number.isFinite(Date.parse(row.at)) || new Date(row.at).toISOString()!==row.at || typeof row.cleanupFailed!=='boolean'
    || !CONTENTION_PHASES.includes(row.phase as ContentionPhase) || !FAILURE_CODES.includes(row.code as typeof FAILURE_CODES[number])
    || row.sqlState!==null && !SQL_STATES.includes(row.sqlState as typeof SQL_STATES[number])) throw new Error('Invalid CP23 fatal diagnostic.');
  return row as ContentionDiagnostic;
}
export type ContentionDiagnosticSender = (value: ContentionDiagnostic, callback: (error?: Error | null) => void) => void;
export function createContentionDiagnosticReporter(config: ContentionConfig, pid: number, send?: ContentionDiagnosticSender) {
  let reported=false;
  return async (phase: ContentionPhase, error: unknown, cleanupFailed=false): Promise<boolean> => {
    if (reported) return false;
    reported=true;
    if (!send) return false;
    const diagnostic=createContentionDiagnostic(config,pid,phase,error,cleanupFailed);
    return new Promise<boolean>(resolve => {
      const timer=setTimeout(()=>resolve(false),500);
      const finish=(success:boolean)=>{clearTimeout(timer);resolve(success);};
      try {send(diagnostic,error=>finish(!error));} catch {finish(false);}
    });
  };
}
/** The only injected selection fault is after the real selector chose F. */
export function createContentionSelectionFault(config: ContentionConfig): (selectedUsername: string) => void {
  const manager=config.action==='selection-failure' && config.faultFixture ? contentionFixture(config.faultFixture).manager : null;
  let used=false;
  return selectedUsername => {
    if (!used && manager!==null && selectedUsername===manager) {
      used=true;
      throw new Error('Declared CP23 pre-admission boundary failure.');
    }
  };
}

/** Parent-side fixture wait only. Eligibility is observed from the existing SQL gates. */
export async function awaitContentionAcquisitionWindow(
  probe: () => Promise<{ job_eligible: boolean; admission_eligible: boolean }>, milliseconds: number,
  now: () => number = Date.now, wait: (milliseconds: number) => Promise<void> = delay,
): Promise<void> {
  if (!Number.isFinite(milliseconds) || milliseconds<=0 || milliseconds>75_000) throw new Error('Invalid CP23 acquisition wait budget.');
  const deadline=now()+milliseconds;
  while (now()<deadline) {
    const observed=await probe();
    if (typeof observed?.job_eligible!=='boolean' || typeof observed?.admission_eligible!=='boolean') throw new Error('Invalid CP23 acquisition gate observation.');
    if (now()>=deadline) break;
    if (observed.job_eligible && observed.admission_eligible) return;
    await wait(Math.min(500,deadline-now()));
  }
  throw new Error('CP23 acquisition eligibility wait exhausted.');
}

export type ContentionFailure = Readonly<{ phase: ContentionPhase; error: unknown; cleanupFailed: boolean }>;
/** Preserves the first failure while retaining the existing serial close ordering. */
export async function runContentionSession(operation: () => Promise<void>, close: () => Promise<void>,
  phase: () => ContentionPhase): Promise<ContentionFailure | null> {
  let failure: ContentionFailure | null=null;
  try {await operation();} catch(error) {failure={phase:phase(),error,cleanupFailed:false};}
  try {await close();} catch(error) {
    failure=failure ? {...failure,cleanupFailed:true} : {phase:'cleanup',error,cleanupFailed:true};
  }
  return failure;
}
export function assertContentionBackendIdentity(session: Readonly<Record<string,unknown>>, live: Readonly<Record<string,unknown>>): void {
  if (live.pid !== session.pid || live.backend_start !== session.backend_start) throw new Error('CP23 backend identity changed.');
}

export type ContentionMessage = Readonly<{ version: typeof CONTENTION_VERSION; nonce: string; contextNonce: string;
  gitSha: string; profileDigest: string; pid: number; backendPid: number; backendStart: string;
  database: string; branch: string; currentUser: 'league_one_runtime'; sessionUser: 'league_one_runtime';
  type: 'ready' | 'attempt' | 'claim' | 'admitted' | 'barrier' | 'probes' | 'cleanup' | 'result'; at: string; step: number; requests: number;
  workerId?: string; generation?: number; deadlineAt?: string; leaseUntil?: string; requestId?: string;
  resource?: 'bootstrap' | 'core' | 'users'; status?: string; barrier?: 'admitted' | 'captured-core' | 'selected' | 'rolled-back';
  rejected?: readonly string[] }>;
export function parseContentionMessage(value: unknown, config: ContentionConfig, pid: number): ContentionMessage {
  const row = object(value);
  const allowed = new Set(['version','nonce','contextNonce','gitSha','profileDigest','pid','backendPid','backendStart','database','branch',
    'currentUser','sessionUser','type','at','step','requests','workerId','generation','deadlineAt','leaseUntil','requestId','resource','status','barrier','rejected']);
  if (Object.keys(row).some(key => !allowed.has(key)) || row.version !== CONTENTION_VERSION || row.nonce !== config.nonce
    || row.contextNonce !== config.contextNonce || row.gitSha !== config.gitSha || row.profileDigest !== config.profileDigest || row.pid !== pid
    || !Number.isSafeInteger(row.backendPid) || Number(row.backendPid) <= 1
    || row.currentUser !== 'league_one_runtime' || row.sessionUser !== 'league_one_runtime'
    || row.database !== config.expectedDatabase || row.branch !== config.expectedBranch
    || !['ready','attempt','claim','admitted','barrier','probes','cleanup','result'].includes(String(row.type))
    || !Number.isSafeInteger(row.step) || Number(row.step) < 0
    || !Number.isSafeInteger(row.requests) || Number(row.requests) < 0 || Number(row.requests) > 2
    || ['at','backendStart'].some(key => typeof row[key] !== 'string' || !Number.isFinite(Date.parse(row[key] as string)))
    || ['deadlineAt','leaseUntil'].some(key => row[key] !== undefined && (typeof row[key] !== 'string' || !Number.isFinite(Date.parse(row[key] as string))))
    || row.workerId !== undefined && !contentionUuid(row.workerId)
    || row.requestId !== undefined && !contentionUuid(row.requestId)
    || row.generation !== undefined && (!Number.isSafeInteger(row.generation) || Number(row.generation) < 1)
    || row.resource !== undefined && !['bootstrap','core','users'].includes(String(row.resource))
    || row.status !== undefined && !['busy','backoff','progress','unavailable','complete','partial','idle','capacity'].includes(String(row.status))
    || row.barrier !== undefined && !['admitted','captured-core','selected','rolled-back'].includes(String(row.barrier))) throw new Error('Invalid CP23 worker evidence.');
  const owned = contentionUuid(row.workerId) && Number.isSafeInteger(row.generation);
  const unownedResult = row.type === 'result' && row.status === 'busy' && row.requests === 0;
  if (!['ready','attempt'].includes(String(row.type)) && !unownedResult && !owned
    || row.status === 'busy' && ['workerId','generation','deadlineAt','leaseUntil','requestId','resource'].some(key => row[key] !== undefined)
    || row.type === 'ready' && (row.step!==0 || row.requests!==0)
    || row.type !== 'ready' && Number(row.step)<1
    || row.type === 'attempt' && row.requests!==0
    || row.type === 'claim' && !row.leaseUntil
    || ['ready','attempt'].includes(String(row.type)) && ['workerId','generation','deadlineAt','leaseUntil','requestId','resource'].some(key => row[key] !== undefined)
    || row.type === 'admitted' && (!row.deadlineAt || !row.requestId || !row.resource)
    || row.type === 'barrier' && (!row.barrier || !row.deadlineAt || !row.requestId)
    || row.type !== 'barrier' && row.barrier !== undefined
    || row.type === 'result' && !row.status || row.type !== 'result' && row.status !== undefined
    || row.type === 'probes' && JSON.stringify(row.rejected) !== JSON.stringify(STALE_PROBES)
    || row.type !== 'probes' && row.rejected !== undefined
    || row.type === 'probes' && config.action !== 'stale-core'
    || row.type === 'cleanup' && !['stale-core','bootstrap-lock'].includes(config.action)
    || row.barrier === 'captured-core' && (config.action !== 'stale-core' || row.resource !== 'core')
    || row.barrier === 'selected' && config.action !== 'hold-selected'
    || row.barrier === 'rolled-back' && (config.action !== 'bootstrap-lock' || row.resource !== 'bootstrap')
    || config.requestId !== null && row.requestId !== undefined && row.requestId !== config.requestId) throw new Error('Invalid CP23 evidence boundary.');
  return row as ContentionMessage;
}
export const STALE_PROBES = ['admission','typed-acceptance','failure-checkpoint','job-completion','job-failure'] as const;
export function isContentionFenceRejection(error: unknown, family: 'intake'|'acceptance'): boolean {
  return error instanceof Error && 'code' in error && error.code === 'P0001'
    && (error.message === 'public intake lease lost' || family === 'acceptance' && error.message === 'league administration writer fence is stale');
}
export function assertSameBackend(first: ContentionMessage, next: ContentionMessage): void {
  if (first.pid !== next.pid || first.backendPid !== next.backendPid || first.backendStart !== next.backendStart
    || first.nonce !== next.nonce) throw new Error('CP23 worker/backend identity changed.');
}
export function contentionFixture(id: string) {
  if (!contentionUuid(id)) throw new Error('Invalid CP23 fixture.');
  const digest = createHash('sha256').update(id).digest('hex');
  const manager = '6' + BigInt('0x' + digest.slice(0,14)), external = '9' + BigInt('0x' + digest.slice(14,28));
  const username = 'cp23_' + manager;
  const league = { league_id: external, season: '2026', sport: 'nfl', name: 'CP23 unrelated synthetic league', total_rosters: 2, settings: {} };
  const base = 'https://api.sleeper.app/v1/league/' + external;
  const rosters = [1,2].map(roster_id => ({ roster_id, owner_id: roster_id === 1 ? manager : null, co_owners: [], players: [], starters: [], reserve: [], taxi: [] }));
  const users = [{ user_id: manager, display_name: username }];
  return { id, manager, external, username, league, rosters, users, payloads: new Map<string, unknown>([
    [base,league], [base + '/rosters',rosters], [base + '/users',users],
    ['https://api.sleeper.app/v1/user/' + username,{ user_id: manager, username }],
    ['https://api.sleeper.app/v1/user/' + manager,{ user_id: manager, username }],
    ['https://api.sleeper.app/v1/user/' + manager + '/leagues/nfl/2026',[league]],
  ]) };
}
export function contentionFetch(config: ContentionConfig, observe: () => void): typeof fetch {
  const fixtures = config.fixtures.map(contentionFixture);
  return async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const fixture = fixtures.find(item => item.payloads.has(url));
    if (!fixture || (init?.method ?? (input instanceof Request ? input.method : 'GET')) !== 'GET') throw new Error('Nonfixture CP23 acquisition rejected.');
    init?.signal?.throwIfAborted(); observe();
    if (config.action === 'normal' && fixture.id === config.faultFixture && url.endsWith('/rosters')) throw new Error('Declared CP23 fixture provider failure.');
    return Response.json(fixture.payloads.get(url));
  };
}

/** These are the actual fixture's readback and elapsed oracles, also exercised offline.
 * A metadata selection or a late successful result cannot satisfy them. */
export function assertContentionReader(value: unknown, fixture: ReturnType<typeof contentionFixture>, users: boolean): void {
  const read = object(value), leagues = read.leagues;
  if (!Array.isArray(leagues) || leagues.length !== 1) throw new Error('CP23 stored league denominator differs.');
  const league = object(leagues[0]), resources = object(league.resources);
  if (league.externalLeagueId !== fixture.external || league.season !== 2026 || league.collection !== (users ? 'complete' : 'users')) throw new Error('CP23 stored acquisition checkpoint differs.');
  for (const key of ['settings','heldRoster','teamManagers']) if (object(resources[key]).status !== 'available') throw new Error('CP23 receipt-bound resource unavailable.');
  const settings=object(object(resources.settings).value),players=object(resources.heldRoster).teams,managers=object(resources.teamManagers).teams;
  if(object(settings.sourceLeague).nativeId!==fixture.external || object(settings.sourceLeague).provider!=='sleeper'
    || settings.season!==2026 || settings.sport!=='nfl' || object(settings.name).value!==fixture.league.name
    || object(settings.teamCount).value!==2 || object(object(settings.scoring).rules).state!=='absent' || object(settings.slots).state!=='absent'
    || !Array.isArray(players) || JSON.stringify(players.map(value=>({id:object(value).externalRosterId,players:object(value).players})))!==JSON.stringify([{id:'1',players:[]},{id:'2',players:[]}])
    || !Array.isArray(managers) || managers.length!==2) throw new Error('CP23 stored official values differ.');
  const first=object(managers[0]),second=object(managers[1]),firstOwner=object(first.primaryOwner),secondOwner=object(second.primaryOwner);
  if(object(first.sourceTeam).nativeId!=='1' || object(second.sourceTeam).nativeId!=='2' || firstOwner.state!=='owned'
    || object(object(firstOwner.manager).sourceManager).nativeId!==fixture.manager || secondOwner.state!=='unowned' || secondOwner.manager!==null
    || [first,second].some(team=>JSON.stringify(object(team.coManagers).managers)!=='[]')) throw new Error('CP23 stored manager identity differs.');
  if (users) {
    const directory=object(resources.managerDirectory);
    if (read.status !== 'available' || object(resources.directory).status !== 'available' || directory.status !== 'available'
      || !Array.isArray(directory.managers) || directory.managers.length!==1
      || object(object(directory.managers[0]).sourceManager).nativeId!==fixture.manager || object(directory.managers[0]).displayName!==fixture.username) throw new Error('CP23 stored users acceptance unavailable.');
  }
}
export type FairnessObservation = Readonly<{ target: 'F' | 'A' | 'B'; resource: 'core' | 'users'; admittedAt: string;
  acceptedAt: string | null; readerVerifiedAt: string | null; requests: number; status: string; receiptCount: number }>;
export function assertFairness(observations: readonly FairnessObservation[], epoch: string): void {
  const expected = [['F','core'],['A','core'],['B','core'],['F','core'],['A','users'],['B','users']];
  if (observations.length !== 6 || !Number.isFinite(Date.parse(epoch))) throw new Error('CP23 fairness denominator incomplete.');
  const bounds = [null,180_000,240_000,null,360_000,420_000];
  observations.forEach((row,index) => {
    if (row.target !== expected[index][0] || row.resource !== expected[index][1]
      || row.requests !== (row.resource === 'core' ? 2 : 1) || !Number.isFinite(Date.parse(row.admittedAt))
      || Date.parse(row.admittedAt) < Date.parse(epoch)) throw new Error('CP23 fairness acquisition order differs.');
    if (index && Date.parse(row.admittedAt) - Date.parse(observations[index-1].admittedAt) < 60_000) throw new Error('CP23 admission clock bypassed.');
    if (row.target === 'F') {
      if (row.status !== 'unavailable' || row.acceptedAt !== null || row.readerVerifiedAt !== null || row.receiptCount !== 1) throw new Error('CP23 poisoned target received false acceptance credit.');
    } else if (row.status !== 'progress' || !row.acceptedAt || !row.readerVerifiedAt || row.receiptCount !== (row.resource === 'core' ? 3 : 1)
      || !Number.isFinite(Date.parse(row.acceptedAt)) || !Number.isFinite(Date.parse(row.readerVerifiedAt))
      || Date.parse(row.acceptedAt) < Date.parse(row.admittedAt) || Date.parse(row.readerVerifiedAt) < Date.parse(row.acceptedAt)
      || Date.parse(row.readerVerifiedAt) - Date.parse(epoch) > bounds[index]!) throw new Error('CP23 healthy target missed accepted-reader progress bound.');
  });
  for (const pair of [[1,4],[2,5]]) if (Date.parse(observations[pair[1]].readerVerifiedAt!) - Date.parse(observations[pair[0]].readerVerifiedAt!) > 240_000
    || Date.parse(observations[pair[1]].acceptedAt!) - Date.parse(observations[pair[0]].acceptedAt!) > 240_000) throw new Error('CP23 healthy target revisit bound exceeded.');
  if (Date.parse(observations[5].admittedAt) - Date.parse(observations[0].admittedAt) > 420_000) throw new Error('CP23 admission window exceeded.');
}
