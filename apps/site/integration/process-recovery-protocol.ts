import { createHash } from 'node:crypto';
import { integrationChildEnvironment } from './disposable-integration';

export const PROCESS_RECOVERY_VERSION = 'cp22-process-recovery-v1';
export const PROCESS_RECOVERY_CONFIG = 'CP22_WORKER_CONFIG';
export const PROCESS_RECOVERY_DATABASE = 'CP22_RUNTIME_DATABASE_URL';
export const PROCESS_RECOVERY_BARRIERS = ['none', 'draft-admitted', 'bootstrap-rolled-back', 'bootstrap-committed',
  'core-first-accepted', 'core-all-accepted', 'users-checkpoint', 'refresh-selected'] as const;
export type RecoveryBarrier = typeof PROCESS_RECOVERY_BARRIERS[number];
export type RecoveryWorkerConfig = Readonly<{ nonce: string; fixtureId: string; requestId: string;
  contextNonce: string; gitSha: string; profileDigest: string; expectedDatabase: string; expectedBranch: string;
  mode: 'intake' | 'refresh'; barrier: RecoveryBarrier; untilProgress: boolean }>;
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.test(value);
export function parseRecoveryWorkerConfig(value: unknown): RecoveryWorkerConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid CP22 worker configuration.');
  const row = value as Record<string, unknown>;
  if (Object.keys(row).sort().join('|') !== 'barrier|contextNonce|expectedBranch|expectedDatabase|fixtureId|gitSha|mode|nonce|profileDigest|requestId|untilProgress'
    || !uuid(row.nonce) || !uuid(row.fixtureId) || !uuid(row.requestId) || !uuid(row.contextNonce)
    || typeof row.gitSha !== 'string' || !/^[0-9a-f]{40}$/u.test(row.gitSha)
    || typeof row.profileDigest !== 'string' || !/^[0-9a-f]{64}$/u.test(row.profileDigest)
    || typeof row.expectedDatabase !== 'string' || !/^[a-z][a-z0-9_]{0,62}$/u.test(row.expectedDatabase)
    || typeof row.expectedBranch !== 'string' || !/^br-[a-z0-9-]{1,100}$/u.test(row.expectedBranch)
    || !['intake', 'refresh'].includes(String(row.mode)) || !PROCESS_RECOVERY_BARRIERS.includes(row.barrier as RecoveryBarrier)
    || typeof row.untilProgress !== 'boolean') throw new Error('Invalid CP22 worker configuration.');
  return row as RecoveryWorkerConfig;
}
export function recoveryWorkerEnvironment(source: Record<string, string | undefined>, databaseUrl: string, config: RecoveryWorkerConfig): NodeJS.ProcessEnv {
  parseRecoveryWorkerConfig(config);
  const parsed = new URL(databaseUrl);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || decodeURIComponent(parsed.username) !== 'league_one_runtime'
    || !['require', 'verify-full', 'verify-ca'].includes(parsed.searchParams.get('sslmode') ?? '')
    || decodeURIComponent(parsed.pathname.slice(1)) !== config.expectedDatabase) {
    throw new Error('CP22 requires the explicit restricted runtime connection.');
  }
  return { ...integrationChildEnvironment(source), [PROCESS_RECOVERY_DATABASE]: databaseUrl,
    [PROCESS_RECOVERY_CONFIG]: JSON.stringify(config) };
}
/** A one-use startup acknowledgment only. It carries no selected work or
 * durable state and cannot release any crash barrier. */
export function recoveryStartMessage(config: RecoveryWorkerConfig) {
  return { version: PROCESS_RECOVERY_VERSION, type: 'start' as const, nonce: config.nonce,
    contextNonce: config.contextNonce, gitSha: config.gitSha, profileDigest: config.profileDigest };
}
export function assertRecoveryStart(value: unknown, config: RecoveryWorkerConfig): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid CP22 start acknowledgment.');
  const expected = recoveryStartMessage(config), row = value as Record<string, unknown>;
  if (Object.keys(row).sort().join('|') !== Object.keys(expected).sort().join('|')
    || Object.entries(expected).some(([key, wanted]) => row[key] !== wanted)) throw new Error('Invalid CP22 start acknowledgment.');
}
/** Only disclosed synthetic identifiers/payloads. No prior attempt, capture,
 * receipt, witness, work selection, or recovery result enters a new process. */
export function recoveryFixture(fixtureId: string) {
  if (!uuid(fixtureId)) throw new Error('Invalid CP22 fixture identity.');
  const digest = createHash('sha256').update(fixtureId).digest('hex');
  const manager = '7' + BigInt('0x' + digest.slice(0, 14));
  const external = '8' + BigInt('0x' + digest.slice(14, 28));
  const username = 'cp22_' + manager, draftId = 'cp22-' + fixtureId;
  const league = { league_id: external, season: '2026', sport: 'nfl', name: 'CP22 unrelated synthetic league',
    total_rosters: 2, settings: {} };
  const catalog = { draft_id: draftId, league_id: external, season: '2026', sport: 'nfl', type: 'snake',
    status: 'pre_draft', settings: { teams: 2, rounds: 1 } };
  const base = 'https://api.sleeper.app/v1/league/' + external;
  const payloads = new Map<string, unknown>([
    ['https://api.sleeper.app/v1/user/' + username, { user_id: manager, username }],
    ['https://api.sleeper.app/v1/user/' + manager, { user_id: manager, username }],
    ['https://api.sleeper.app/v1/user/' + manager + '/leagues/nfl/2026', [league]],
    [base, league], [base + '/drafts', [catalog]], [base + '/traded_picks', []],
    ['https://api.sleeper.app/v1/draft/' + draftId, { ...catalog, status: 'complete' }],
    ['https://api.sleeper.app/v1/draft/' + draftId + '/picks', []],
    ['https://api.sleeper.app/v1/draft/' + draftId + '/traded_picks', []],
    [base + '/rosters', [1, 2].map(roster_id => ({ roster_id, owner_id: roster_id === 1 ? manager : null,
      co_owners: [], players: [], starters: [], reserve: [], taxi: [] }))],
    [base + '/users', [{ user_id: manager, display_name: username }]],
  ]);
  return { manager, external, username, draftId, league, catalog, payloads };
}
export function fixtureFetch(fixtureId: string, observe: (url: string) => void): typeof fetch {
  const fixture = recoveryFixture(fixtureId);
  return async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if ((init?.method ?? (input instanceof Request ? input.method : 'GET')) !== 'GET' || !fixture.payloads.has(url)) {
      throw new Error('CP22 rejected a nonfixture acquisition.');
    }
    init?.signal?.throwIfAborted();
    observe(url);
    return Response.json(fixture.payloads.get(url));
  };
}

export type RecoveryMessage = Readonly<{ version: typeof PROCESS_RECOVERY_VERSION; nonce: string; contextNonce: string;
  gitSha: string; profileDigest: string; pid: number; type: 'ready' | 'claim' | 'admitted' | 'barrier' | 'result' | 'failed';
  backendPid: number; backendStart: string; database: string; branch: string;
  currentUser: 'league_one_runtime'; sessionUser: 'league_one_runtime';
  at: string; requests: number; workerId?: string; generation?: number; deadlineAt?: string;
  resource?: string; barrier?: RecoveryBarrier; status?: string; requestId?: string }>;
export function parseRecoveryMessage(value: unknown, config: RecoveryWorkerConfig, pid: number): RecoveryMessage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid CP22 worker evidence.');
  const row = value as Record<string, unknown>;
  const keys = new Set(['version', 'nonce', 'contextNonce', 'gitSha', 'profileDigest', 'pid', 'type', 'backendPid', 'backendStart', 'database', 'branch',
    'currentUser', 'sessionUser', 'at', 'requests', 'workerId', 'generation', 'deadlineAt', 'resource', 'barrier', 'status', 'requestId']);
  if (Object.keys(row).some(key => !keys.has(key)) || row.version !== PROCESS_RECOVERY_VERSION || row.nonce !== config.nonce
    || row.contextNonce !== config.contextNonce || row.gitSha !== config.gitSha || row.profileDigest !== config.profileDigest || row.pid !== pid
    || !Number.isSafeInteger(row.backendPid) || Number(row.backendPid) <= 1
    || row.currentUser !== 'league_one_runtime' || row.sessionUser !== 'league_one_runtime'
    || !['ready', 'claim', 'admitted', 'barrier', 'result', 'failed'].includes(String(row.type))
    || !Number.isSafeInteger(row.requests) || Number(row.requests) < 0 || Number(row.requests) > 2
    || row.database !== config.expectedDatabase || row.branch !== config.expectedBranch
    || ['at', 'backendStart'].some(key => typeof row[key] !== 'string' || !Number.isFinite(Date.parse(row[key] as string)))
    || row.workerId !== undefined && !uuid(row.workerId)
    || row.generation !== undefined && (!Number.isSafeInteger(row.generation) || Number(row.generation) < 1)
    || row.deadlineAt !== undefined && (typeof row.deadlineAt !== 'string' || !Number.isFinite(Date.parse(row.deadlineAt)))
    || row.requestId !== undefined && !uuid(row.requestId)
    || row.barrier !== undefined && !PROCESS_RECOVERY_BARRIERS.includes(row.barrier as RecoveryBarrier)
    || row.resource !== undefined && !['identity', 'leagues', 'bootstrap', 'core', 'users', 'drafts'].includes(String(row.resource))
    || row.status !== undefined && !['progress', 'busy', 'backoff', 'complete', 'partial', 'unavailable', 'idle', 'capacity'].includes(String(row.status))) {
    throw new Error('Invalid CP22 worker evidence.');
  }
  if (row.type !== 'ready' && (!uuid(row.workerId) || !Number.isSafeInteger(row.generation))
    || row.type === 'admitted' && (!row.deadlineAt || !row.requestId || !row.resource)
    || row.type === 'barrier' && (row.barrier !== config.barrier || config.barrier === 'none'
      || !row.deadlineAt || !row.requestId || config.barrier === 'refresh-selected' && config.mode !== 'refresh'
      || config.barrier !== 'refresh-selected' && !row.resource)
    || row.type !== 'barrier' && row.barrier !== undefined
    || row.type === 'result' && !row.status || row.type !== 'result' && row.status !== undefined
    || row.type === 'ready' && ['workerId', 'generation', 'deadlineAt', 'resource', 'requestId'].some(key => row[key] !== undefined)) {
    throw new Error('Invalid CP22 message boundary.');
  }
  const barrierResource: Partial<Record<RecoveryBarrier, string>> = { 'draft-admitted': 'drafts',
    'bootstrap-rolled-back': 'bootstrap', 'bootstrap-committed': 'bootstrap', 'core-first-accepted': 'core',
    'core-all-accepted': 'core', 'users-checkpoint': 'users' };
  if (config.mode === 'intake' && row.requestId !== undefined && row.requestId !== config.requestId
    || row.type === 'barrier' && row.resource !== barrierResource[config.barrier]) {
    throw new Error('CP22 evidence belongs to different durable work.');
  }
  return row as RecoveryMessage;
}
