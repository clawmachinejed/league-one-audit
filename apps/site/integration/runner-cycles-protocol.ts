import { createHash } from 'node:crypto';
import { integrationChildEnvironment } from './disposable-integration';
import { createBackendControlsDatabaseFetchGuard } from './backend-controls-fetch';

export const RUNNER_CONFIG = 'CP25_WORKER_CONFIG';
export const RUNNER_VERSION = 'cp25-runner-cycles-v1';
export const RUNNER_STAGES = ['identity', 'leagues', 'bootstrap', 'exact-matchups', 'core', 'users'] as const;
/** Exact unscoped readEnrollmentInventory statement, independently reproduced
 * through the real facade/store/Neon client. Registry reads have their own 3s
 * abort signal; that signal is not evidence of opt-in DATA work. */
export const RUNNER_REGISTRY_SQL_DIGEST = '5e84998e81647f3fec082ccebacef64c5664b33cf3bf8c45252599ef88f4455c';
export type RunnerSqlObservation = Readonly<{ signal: boolean; registry: boolean }>;
function registryEnvelope(body: BodyInit|null|undefined): boolean {
  // The installed Neon client supplies a string body. Never consume a Request
  // stream or parse potentially large DATA payloads to exempt a registry read.
  if (typeof body !== 'string' || Buffer.byteLength(body,'utf8') > 8_192) return false;
  try {
    const value: unknown = JSON.parse(body);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const row = value as Record<string,unknown>;
    if (Object.keys(row).sort().join('|') !== 'params|query' || typeof row.query !== 'string'
      || !Array.isArray(row.params) || row.params.length !== 0) return false;
    return createHash('sha256').update(row.query.replace(/\r\n?/gu,'\n')).digest('hex') === RUNNER_REGISTRY_SQL_DIGEST;
  } catch { return false; }
}
/** Exact protected publication/account inventory reviewed against the57 installed
 * migrations. Canonical identities/settings are legitimate DATA owners. */
export const RUNNER_PROTECTED_PUBLIC_TABLES = [
  'all_player_league_acceptances','all_player_score_sets','all_player_score_verifications','all_player_scores','all_player_stat_contents','all_player_stat_entries','all_player_stat_observations',
  'app_identity_audit_events','app_league_group_memberships','app_league_groups','app_login_identities','app_provider_account_links','app_schema_migrations','app_user_leagues','app_users',
  'current_all_player_league_scores','current_all_player_score_sets','current_pregame_projection_candidates','current_projection_slates','current_projection_snapshots',
  'external_game_ids','game_state_observations','league_calculation_capture_inputs','league_calculation_source_captures','league_period_authorities',
  'league_week_expected_games','league_week_lineup_watch_states','league_week_materialization_states','league_week_observations','nfl_games',
  'official_player_point_observations','official_roster_point_observations','pregame_projection_baselines','pregame_projection_candidates','pregame_projection_runs',
  'projection_jobs','projection_period_refresh_states','projection_slate_contents','projection_slate_entries','projection_slate_observations','projection_snapshots',
] as const;
export function runnerSnapshotQuery(catalog:readonly {schemaname:string;tablename:string}[],protectedOnly=false) {
  if(!catalog.length||catalog.length>300)throw new Error('Invalid CP25 snapshot catalogue.');
  const keys=new Set<string>();for(const item of catalog){
    if(!['public','website_auth'].includes(item.schemaname)||! /^[A-Za-z_][A-Za-z0-9_]*$/u.test(item.tablename)
      ||keys.has(item.schemaname+'.'+item.tablename))throw new Error('Invalid CP25 snapshot identifier.');
    keys.add(item.schemaname+'.'+item.tablename);}
  if(protectedOnly)for(const table of RUNNER_PROTECTED_PUBLIC_TABLES)if(!keys.has('public.'+table))throw new Error('Missing CP25 protected table.');
  if(!['account','rateLimit','session','user','verification'].every(table=>keys.has('website_auth.'+table)))throw new Error('Missing CP25 auth table.');
  const tables=catalog.filter(item=>!protectedOnly||item.schemaname==='website_auth'||RUNNER_PROTECTED_PUBLIC_TABLES.includes(item.tablename as typeof RUNNER_PROTECTED_PUBLIC_TABLES[number]))
    .sort((a,b)=>(a.schemaname+'.'+a.tablename).localeCompare(b.schemaname+'.'+b.tablename));
  const sql=tables.map(({schemaname,tablename})=>`SELECT '${schemaname}.${tablename}' AS name,COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) AS rows FROM "${schemaname}"."${tablename}" t${protectedOnly&&schemaname==='public'&&tablename==='projection_jobs'?' WHERE job_key<>$1':''}`).join(' UNION ALL ')+' ORDER BY name';
  return {sql,parameters:protectedOnly?['league-administration-public-intake']:[],tables:tables.map(item=>item.schemaname+'.'+item.tablename)};
}
export type RunnerConfig = Readonly<{ nonce: string; fixtureId: string; contextNonce: string; gitSha: string;
  profileDigest: string; expectedDatabase: string; expectedBranch: string }>;
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.test(value);
function exactKeys(value: object, keys: readonly string[]) {
  if (Object.keys(value).sort().join('|') !== [...keys].sort().join('|')) throw new Error('Invalid CP25 fields.');
}
export function runnerTimestamp(value: unknown): string {
  const milliseconds = value instanceof Date ? value.getTime() : typeof value === 'string' ? Date.parse(value) : NaN;
  if (!Number.isFinite(milliseconds)) throw new Error('Invalid CP25 timestamp.');
  return new Date(milliseconds).toISOString();
}
export function parseRunnerConfig(value: unknown): RunnerConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid CP25 configuration.');
  exactKeys(value, ['nonce','fixtureId','contextNonce','gitSha','profileDigest','expectedDatabase','expectedBranch']);
  const row = value as Record<string, unknown>;
  if (!uuid(row.nonce) || !uuid(row.fixtureId) || !uuid(row.contextNonce)
    || typeof row.gitSha !== 'string' || !/^[0-9a-f]{40}$/u.test(row.gitSha)
    || typeof row.profileDigest !== 'string' || !/^[0-9a-f]{64}$/u.test(row.profileDigest)
    || typeof row.expectedDatabase !== 'string' || !/^[a-z][a-z0-9_]{0,62}$/u.test(row.expectedDatabase)
    || typeof row.expectedBranch !== 'string' || !/^br-[a-z0-9-]{1,100}$/u.test(row.expectedBranch)) throw new Error('Invalid CP25 configuration.');
  return row as RunnerConfig;
}
export function runnerEnvironment(source: Record<string,string|undefined>, url: string, config: RunnerConfig): NodeJS.ProcessEnv {
  parseRunnerConfig(config);
  const parsed = new URL(url);
  if (!['postgres:','postgresql:'].includes(parsed.protocol) || decodeURIComponent(parsed.username) !== 'league_one_runtime'
    || !['require','verify-full','verify-ca'].includes(parsed.searchParams.get('sslmode') ?? '')
    || decodeURIComponent(parsed.pathname.slice(1)) !== config.expectedDatabase) throw new Error('CP25 requires its restricted runtime connection.');
  // No owner/auth/account URL, sentinel, inherited NODE_OPTIONS or provider key.
  return { ...integrationChildEnvironment(source), DATABASE_URL: url, [RUNNER_CONFIG]: JSON.stringify(config) };
}
export type RunnerCommand = { version: typeof RUNNER_VERSION; nonce: string; sequence: number;
  action: 'invoke'|'release'|'stop'; selection: 'omitted'|'false'|'enabled'; variant: 1|2; holdIdentity: boolean };
export function runnerCommand(config: RunnerConfig, sequence: number, action: RunnerCommand['action'],
  selection: RunnerCommand['selection'] = 'enabled', variant: 1|2 = 1, holdIdentity = false): RunnerCommand {
  return { version: RUNNER_VERSION, nonce: config.nonce, sequence, action, selection, variant, holdIdentity };
}
export function parseRunnerCommand(value: unknown, config: RunnerConfig, sequence: number): RunnerCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid CP25 command.');
  exactKeys(value, ['version','nonce','sequence','action','selection','variant','holdIdentity']);
  const row = value as RunnerCommand;
  if (row.version !== RUNNER_VERSION || row.nonce !== config.nonce || row.sequence !== sequence
    || !['invoke','release','stop'].includes(row.action) || !['omitted','false','enabled'].includes(row.selection)
    || ![1,2].includes(row.variant) || typeof row.holdIdentity !== 'boolean'
    || row.action !== 'invoke' && (row.selection !== 'enabled' || row.variant !== 1 || row.holdIdentity)) throw new Error('Invalid CP25 command.');
  return row;
}
export type RunnerMessage = { version: typeof RUNNER_VERSION; nonce: string; contextNonce: string; gitSha: string; profileDigest: string;
  pid: number; backendPid: number; backendStart: string; database: string; branch: string; sessionUser: 'league_one_runtime'; currentUser: 'league_one_runtime';
  httpSessionUser: 'league_one_runtime'; httpCurrentUser: 'league_one_runtime'; type: 'ready'|'barrier'|'result'; invocation: number; at: string;
  gets: number; sqlRequests: number; signalRequests: number; registrySqlRequests: number; registrySignalRequests: number;
  facade: 'not-run'|'registry-unavailable'; paths: string[]; invocationStartedAt: string|null };
export function parseRunnerMessage(value: unknown, config: RunnerConfig, pid: number): RunnerMessage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid CP25 evidence.');
  exactKeys(value, ['version','nonce','contextNonce','gitSha','profileDigest','pid','backendPid','backendStart','database','branch','sessionUser','currentUser',
    'httpSessionUser','httpCurrentUser','type','invocation','at','gets','sqlRequests','signalRequests','registrySqlRequests','registrySignalRequests','facade','paths','invocationStartedAt']);
  const row = value as RunnerMessage;
  if (row.version !== RUNNER_VERSION || row.nonce !== config.nonce || row.contextNonce !== config.contextNonce || row.gitSha !== config.gitSha
    || row.profileDigest !== config.profileDigest || row.pid !== pid || !Number.isSafeInteger(row.backendPid) || row.backendPid <= 1
    || row.database !== config.expectedDatabase || row.branch !== config.expectedBranch
    || [row.currentUser,row.sessionUser,row.httpCurrentUser,row.httpSessionUser].some(role => role !== 'league_one_runtime')
    || !['ready','barrier','result'].includes(row.type) || !['not-run','registry-unavailable'].includes(row.facade)
    || !Number.isInteger(row.invocation) || row.invocation < 0 || row.invocation > 32
    || !Number.isInteger(row.gets) || row.gets < 0 || row.gets > 2
    || !Number.isInteger(row.sqlRequests) || row.sqlRequests < 0 || row.sqlRequests > 100
    || !Number.isInteger(row.signalRequests) || row.signalRequests < 0 || row.signalRequests > row.sqlRequests
    || !Number.isInteger(row.registrySqlRequests) || row.registrySqlRequests < 0 || row.registrySqlRequests > row.sqlRequests
    || !Number.isInteger(row.registrySignalRequests) || row.registrySignalRequests < 0 || row.registrySignalRequests > row.registrySqlRequests
    || row.registrySignalRequests > row.signalRequests || row.signalRequests-row.registrySignalRequests > row.sqlRequests-row.registrySqlRequests
    || !Array.isArray(row.paths) || row.paths.length !== row.gets || row.paths.some(path => !/^\/v1\/(?:user|league)\/[a-zA-Z0-9_/-]{1,100}$/u.test(path))
    || row.type === 'ready' && (row.invocation !== 0 || row.gets !== 0 || row.facade !== 'not-run')
    || row.type !== 'ready' && row.invocation < 1 || row.type === 'result' && row.facade !== 'registry-unavailable') throw new Error('Invalid CP25 evidence.');
  if (runnerTimestamp(row.at) !== row.at || typeof row.backendStart !== 'string' || !Number.isFinite(Date.parse(row.backendStart))
    || row.type === 'ready' && row.invocationStartedAt !== null
    || row.type !== 'ready' && runnerTimestamp(row.invocationStartedAt) !== row.invocationStartedAt) throw new Error('Invalid CP25 evidence time.');
  return row;
}

/** Synthetic source only. Cycle two changes native lineup/score/roster while
 * retaining identical settings and users content for genuine later observations. */
export function runnerFixture(fixtureId: string, variant: 1|2, emptyList = false) {
  if (!uuid(fixtureId) || ![1,2].includes(variant)) throw new Error('Invalid CP25 fixture.');
  const hash = createHash('sha256').update(fixtureId).digest('hex');
  const manager = '7' + BigInt('0x' + hash.slice(0,14)), external = '8' + BigInt('0x' + hash.slice(14,28));
  const username = 'cp25_' + manager;
  const league = { league_id: external, season: '2026', sport: 'nfl', season_type: 'regular', name: 'CP25 unrelated synthetic league',
    status: 'in_season', total_rosters: 2, roster_positions: ['QB','BN'], scoring_settings: { pass_yd: 0.04 },
    settings: { leg: 1, last_scored_leg: 0, start_week: 1, playoff_week_start: 15 } };
  const player = variant === 1 ? 'cp25a' : 'cp25b';
  const rosters = [1,2].map(roster_id => ({ roster_id, owner_id: roster_id === 1 ? manager : null, co_owners: [],
    players: roster_id === 1 ? [player] : [], starters: roster_id === 1 ? [player] : [], reserve: [], taxi: [],
    settings: { wins: 0, losses: 0, ties: 0, fpts: 0, fpts_decimal: 0, waiver_budget_used: 0 } }));
  const matchups = [1,2].map(roster_id => ({ roster_id, matchup_id: 1, players: roster_id === 1 ? [player] : [],
    starters: roster_id === 1 ? [player] : [], points: roster_id === 1 ? (variant === 1 ? 0 : 12.25) : 0,
    starters_points: roster_id === 1 ? [variant === 1 ? 0 : 12.25] : [], players_points: roster_id === 1 ? { [player]: variant === 1 ? 0 : 12.25 } : {} }));
  const base = '/v1/league/' + external;
  const payloads = new Map<string,unknown>([
    ['/v1/user/' + username, { user_id: manager, username }], ['/v1/user/' + manager, { user_id: manager, username }],
    ['/v1/user/' + manager + '/leagues/nfl/2026', emptyList ? [] : [league]], [base,league],
    [base + '/rosters',rosters], [base + '/users',[{ user_id: manager, display_name: username }]], [base + '/matchups/1',matchups],
  ]);
  return { manager, external, username, league, rosters, matchups, payloads };
}
export function runnerFetch(options: { runtimeUrl: string; fixtureId: string; variant: () => 1|2; emptyList?: boolean;
  originalFetch: typeof fetch; sql: (observation: RunnerSqlObservation) => void; source: (path: string, signal: AbortSignal|null|undefined) => Promise<void>|void }): typeof fetch {
  const isDatabase = createBackendControlsDatabaseFetchGuard(options.runtimeUrl);
  return async (input, init) => {
    if (isDatabase(input,init)) {
      options.sql({ signal: Boolean(init?.signal ?? (input instanceof Request ? input.signal : undefined)), registry: registryEnvelope(init?.body) });
      return options.originalFetch(input,init);
    }
    const request = input instanceof Request ? input : undefined, url = new URL(request ? request.url : String(input));
    const fixture = runnerFixture(options.fixtureId,options.variant(),options.emptyList);
    if (url.origin !== 'https://api.sleeper.app' || url.search || url.hash || !fixture.payloads.has(url.pathname)
      || (init?.method ?? request?.method ?? 'GET') !== 'GET') throw new Error('CP25 rejected nonfixture acquisition.');
    const signal = init?.signal ?? request?.signal; signal?.throwIfAborted();
    await options.source(url.pathname,signal); signal?.throwIfAborted();
    return Response.json(fixture.payloads.get(url.pathname));
  };
}
