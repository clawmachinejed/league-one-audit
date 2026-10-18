import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { capacityDigest, capacityTime, freezeCapacityValue, type JsonValue, type PayloadVersion, type CapacityEndpointBinding } from './freshness-capacity-manifest';
import { createCapacityFleetFixture, type CapacityFleetFixture } from './freshness-capacity-fixtures';
import { createCapacityRecoveryManifest, type CapacityRecoveryPins, type CapacityRecoveryManifest, type RecoveryEndpoint,
  type RecoveryEndpointAcceptance, type RecoveryIntakeProof } from './freshness-capacity-recovery';
import { assertCapacityHttpEndpoint, evaluateRequestEnvelope, type RequestAccounting } from './freshness-capacity-evidence';

export const DAILY_CLOCK = Object.freeze({ invocationIntervalMs: 60_000, initialHeadsDeadlineMs: 3_600_000,
  initialCatalogDeadlineMs: 900_000, fullInventoryMs: 14_400_000, cadenceSeconds: 72_000,
  publicationOffsetMs: 68_400_000, observationMs: 90_000_000, minimumRemainingWorkMs: 91_800_000,
  maxSourceGapMs: 86_400_000, catalogGuardMs: 86_400_000, workMs: 93_600_000,
  lifecycleMs: 94_200_000, expiryMs: 97_200_000 });
export const DAILY_BOUNDARY_OFFSETS = Object.freeze([3_600_000, 68_400_000, 86_400_000, 90_000_000]);
export type CapacityDailyAuxiliary = { nativeLeagueIds: string[]; admittedNativeLeagueId: string; nativeRosterIds: string[];
  users: { label: 'a' | 'b'; username: string; nativeManagerId: string; nativeLeagueIds: string[];
    scope: { seasons: [2026]; draftPicks?: 'sleeper-2026-draft-picks-v1' } }[];
  endpoints: RecoveryEndpoint[]; expectedHttp: { a: 30; b: 6 } };
function auxiliaryFixture(fleet: CapacityFleetFixture): CapacityDailyAuxiliary {
  const nativeLeagueIds = Array.from({ length: 21 }, (_, i) => String(980000000000000000n + BigInt(i + 1))), admittedNativeLeagueId = nativeLeagueIds[0];
  assert(nativeLeagueIds.every(id => !fleet.sourceLeagues.some(row => row.nativeLeagueId === id)));
  const users: CapacityDailyAuxiliary['users'] = (['a','b'] as const).map((label, index) => ({ label,
    username: 'cp26_daily_auxiliary_' + label, nativeManagerId: String(989000000000000001n + BigInt(index)),
    nativeLeagueIds: label === 'a' ? nativeLeagueIds : [admittedNativeLeagueId],
    scope: { seasons: [2026], ...(label === 'a' ? { draftPicks: 'sleeper-2026-draft-picks-v1' as const } : {}) } }));
  const template = JSON.parse(fleet.endpointInventory.find(row => row.resource === 'league')!.versions[0].utf8);
  const leagues = nativeLeagueIds.map((league_id, i) => ({ ...template, league_id, name: 'Authored auxiliary ' + (i + 1),
    status: 'pre_draft', total_rosters: i === 0 ? 12 : 21, settings: { ...template.settings, type: 0, leg: 0 } }));
  const endpoints: RecoveryEndpoint[] = [], emptyScope: CapacityEndpointBinding['scope'] = {
    leagueKey: null, nativeLeagueId: null, nativeWeek: null, nativeDraftId: null, nativeManagerId: null, nativePosition: null };
  const add = (id: string, resource: CapacityEndpointBinding['resource'], url: string, payload: unknown, scope: Partial<CapacityEndpointBinding['scope']> = {}) => {
    const value = sourceVersion('daily-auxiliary:' + id, payload);
    endpoints.push({ id: 'auxiliary:' + id, resource, method: 'GET', url, requestUtf8: null, requestSha256: null,
      scope: { ...emptyScope, ...scope }, pairIds: [], before: value, after: value,
      requirement: 'post-restore-unchanged', changedFields: [] });
  };
  for (const user of users) {
    add('identity-' + user.label, 'identity', 'https://api.sleeper.app/v1/user/' + user.username,
      { user_id: user.nativeManagerId, username: user.username, display_name: 'Authored auxiliary ' + user.label }, { nativeManagerId: user.nativeManagerId });
    add('discovery-' + user.label, 'league-list', 'https://api.sleeper.app/v1/user/' + user.nativeManagerId + '/leagues/nfl/2026',
      leagues.filter(row => user.nativeLeagueIds.includes(row.league_id)), { nativeManagerId: user.nativeManagerId });
  }
  leagues.forEach((payload, i) => add('league-' + (i + 1), 'league', 'https://api.sleeper.app/v1/league/' + payload.league_id,
    payload, { nativeLeagueId: payload.league_id, leagueKey: 'auxiliary-' + (i + 1) }));
  const base = 'https://api.sleeper.app/v1/league/' + admittedNativeLeagueId, scope = { nativeLeagueId: admittedNativeLeagueId, leagueKey: 'auxiliary-1' };
  const nativeRosterIds = Array.from({ length: 12 }, (_, i) => String(i + 1));
  add('rosters', 'rosters', base + '/rosters', nativeRosterIds.map(id => ({ roster_id: Number(id), owner_id: null,
    co_owners: [], players: [], starters: [], reserve: [], taxi: [] })), scope);
  add('users', 'users', base + '/users', [], scope);
  const draftId = admittedNativeLeagueId + '01', draft = { draft_id: draftId, league_id: admittedNativeLeagueId, season: '2026', sport: 'nfl',
    type: 'snake', status: 'pre_draft', settings: { teams: 12, rounds: 1 }, draft_order: null, slot_to_roster_id: null };
  add('drafts', 'draft-catalog', base + '/drafts', [draft], scope);
  add('league-trades', 'league-trades', base + '/traded_picks', [], scope);
  const draftBase = 'https://api.sleeper.app/v1/draft/' + draftId, draftScope = { ...scope, nativeDraftId: draftId };
  add('draft-detail', 'draft-detail', draftBase, draft, draftScope);
  add('draft-picks', 'draft-selections', draftBase + '/picks', [], draftScope);
  add('draft-trades', 'draft-trades', draftBase + '/traded_picks', [], draftScope);
  return { nativeLeagueIds, admittedNativeLeagueId, nativeRosterIds, users, endpoints, expectedHttp: { a: 30, b: 6 } };
}
export type CapacityDailyManifest = { kind: 'cp26-daily-manifest-v1'; seed: string;
  source: CapacityRecoveryManifest['source']; clock: typeof DAILY_CLOCK; bindingPlan: CapacityRecoveryManifest;
  leagues: { key: string; nativeLeagueId: string; status: 'in_season' | 'post_season' }[];
  endpoints: RecoveryEndpoint[]; auxiliary: CapacityDailyAuxiliary; initialScope: CapacityRecoveryManifest['initialScope'];
  initialRequests: CapacityRecoveryManifest['initialRequests'];
  targets: { cohort: string; username: string; nativeUsername: string; cadenceSeconds: 72000; cycles: readonly [1, 2]; endpointIds: string[]; activeLeagueKeys: string[] }[];
  boundaryOffsets: readonly number[]; gaps: string[]; digest: string };
const made = new WeakSet<CapacityDailyManifest>();
function sourceVersion(version: string, value: unknown): PayloadVersion {
  const utf8 = JSON.stringify(value); return { version, utf8, sha256: createHash('sha256').update(utf8).digest('hex') };
}
/** The recovery plan supplies native payload and reader bindings only, never its outage/timing evidence. */
export function createCapacityDailyManifest(fleet: CapacityFleetFixture, pins: CapacityRecoveryPins): CapacityDailyManifest {
  const bindingPlan = createCapacityRecoveryManifest(fleet, pins);
  const leagues = bindingPlan.leagues.map((row, index) => ({ key: row.key, nativeLeagueId: row.nativeLeagueId,
    status: index < 12 ? 'in_season' as const : 'post_season' as const }));
  const inactive = new Set(leagues.filter(row => row.status === 'post_season').map(row => row.nativeLeagueId));
  const endpoints = bindingPlan.endpoints.map(endpoint => {
    const convert = (original: PayloadVersion, suffix: string) => {
      const value = JSON.parse(original.utf8) as Record<string, unknown> | Record<string, unknown>[];
      if (endpoint.resource === 'league' && inactive.has(String((value as Record<string, unknown>).league_id))) (value as Record<string, unknown>).status = 'post_season';
      if (endpoint.resource === 'league-list') for (const row of value as Record<string, unknown>[]) if (inactive.has(String(row.league_id))) row.status = 'post_season';
      return JSON.stringify(value) === original.utf8 ? original : sourceVersion('daily:' + endpoint.id + ':' + suffix, value);
    };
    return { ...endpoint, before: convert(endpoint.before, 'v0'), after: convert(endpoint.after, 'v1') };
  });
  const auxiliary = auxiliaryFixture(fleet);
  const body = { kind: 'cp26-daily-manifest-v1' as const, seed: fleet.prototype.plan.seed, source: bindingPlan.source,
    clock: DAILY_CLOCK, bindingPlan, leagues, endpoints: [...endpoints, ...auxiliary.endpoints], auxiliary, initialScope: bindingPlan.initialScope, initialRequests: bindingPlan.initialRequests,
    targets: bindingPlan.correctionTargets.map(row => ({ cohort: row.cohort, username: row.username, nativeUsername: row.nativeUsername,
      cadenceSeconds: 72000 as const, cycles: [1, 2] as const, endpointIds: row.endpointIds,
      activeLeagueKeys: bindingPlan.initialRequests.find(request => request.cohort === row.cohort)!.leagueKeys.filter(key => leagues.find(row => row.key === key)!.status === 'in_season') })),
    boundaryOffsets: DAILY_BOUNDARY_OFFSETS, gaps: [
      'This representative twelve-active/four-inactive daily lane does not qualify the separate sixteen-active percentile or 15-minute gates.',
      'Actual restricted LOGIN, complete source/receipt/reader lineage, positive shared facade work and independently verified cleanup remain mandatory.',
      'The catalog follows the first eligible scheduled attempt after its unchanged 24-hour attempt guard; failures and actual last success remain explicit.' ] };
  const result = freezeCapacityValue({ ...body, digest: capacityDigest(body) }); made.add(result); return result;
}
export function assertCapacityDailyManifest(manifest: CapacityDailyManifest) {
  if (made.has(manifest)) return;
  const { digest, ...body } = manifest; assert.equal(capacityDigest(body), digest, 'daily manifest hash drift');
  const { fixtureSha256, ...pins } = manifest.source, fixture = createCapacityFleetFixture(manifest.seed);
  assert.equal(fixture.digest, fixtureSha256); assert.deepEqual(manifest, createCapacityDailyManifest(fixture, pins));
}
export type DailyTargetEvidence = { cohort: string; targetId: string; configurationRevision: number; configuredAt: number;
  configuredCompletedAt: number; input: Record<string, JsonValue> };
export type DailyIntakeEvidence = { requestId: string; cohort: string; kind: 'initial' | 'cycle'; cycle: number | null;
  targetId: string | null; createdAt: number; dueAt: number | null; completedAt: number; proof: RecoveryIntakeProof };
export type DailyCatalogChoice = { kind: 'claim' | 'reserve'; querySha256: string; params: JsonValue[];
  response: { fields: string[]; rows: JsonValue[] } | null;
  span: { startedAt: number; endedAt: number; monotonicStartedAt: number; monotonicEndedAt: number };
  status: 'success' | 'failed' | 'unclassified' };
export function dailyCatalogChoiceRows(choice: DailyCatalogChoice) {
  assert.equal(choice.status, 'success'); assert(choice.response); const { fields,rows }=choice.response;
  assert.deepEqual(fields,choice.kind==='claim'?['attempt_count','lease_until']:['result']);assert(rows.length<=1);
  return rows.map(value=>{assert(Array.isArray(value)&&value.length===fields.length);return Object.fromEntries(fields.map((key,index)=>[key,value[index]]));});
}
export function classifyDailyCatalogChoice(choices: readonly DailyCatalogChoice[]) {
  try {
    assert(choices.length>=1&&choices.length<=2); const claim=choices[0];assert.equal(claim.kind,'claim');
    const acquired=dailyCatalogChoiceRows(claim);if(acquired.length===0){assert.equal(choices.length,1);return 'claim-busy' as const;}
    assert.equal(choices.length,2);const reserve=choices[1];assert.equal(reserve.kind,'reserve');
    const raw=dailyCatalogChoiceRows(reserve);assert.equal(raw.length,1);const value=raw[0].result;
    const result=typeof value==='string'?JSON.parse(value):value;assert(result&&typeof result==='object'&&!Array.isArray(result));
    if(result.status==='backoff'){assert(Number.isFinite(Date.parse(result.retryAt)));return 'reservation-backoff' as const;}
    assert.equal(result.status,'reserved');assert(result.attempt&&typeof result.attempt==='object');return 'reserved' as const;
  }catch{return 'unclassified' as const;}
}
export type DailyCatalogTurn = { ordinal: number; scheduledAt: number; startedAt: number; endedAt: number;
  state: 'invoked' | 'missed' | 'read-failed'; catalogChoices: DailyCatalogChoice[]; read: JsonValue; invocationOutcome: JsonValue; invocationFailed: boolean | null; lastAttemptId: string | null; retryAt: number | null; attemptIds: string[] };
export type DailyQueueSnapshot = { at: number; requests: JsonValue[]; cycles: JsonValue[]; configurations: JsonValue[]; outcomes: JsonValue[] };
export type DailyAuxiliaryRead = { requestId: string; span: { startedAt: number; endedAt: number; monotonicStartedAt: number; monotonicEndedAt: number };
  request: JsonValue; candidates: JsonValue[]; mapping: JsonValue; read: JsonValue; additionalPages: JsonValue[]; queries: JsonValue[];
  currentReadProofIds: string[]; immutableProofIds: string[]; completedEndpointIds: string[]; immutableReceiptRead: JsonValue; retainedRoster: JsonValue };
export type DailyAuxiliaryEvidence = { startedAt: number; endedAt: number; initialState: JsonValue;
  requests: { label: 'a' | 'b'; requestId: string; submittedAt: number; receiptAt: number; receipt: JsonValue; completedAt: number; proof: DailyAuxiliaryRead }[];
  overlap: { a: DailyAuxiliaryRead; b: DailyAuxiliaryRead }; queueDigest: string };
export type CapacityDailyEvidence = { manifestDigest: string; startedAt: number; endedAt: number; workDeadlineAt: number;
  auxiliary: DailyAuxiliaryEvidence;
  ownerCoverage: { owner: string; startedAt: number; endedAt: number }[]; requests: RequestAccounting;
  targets: DailyTargetEvidence[]; initialSubmissions: { cohort: string; requestId: string; submittedAt: number; receiptAt: number | null; receipt: JsonValue }[];
  initialHeadConfirmations: { pairId: string; requestId: string; at: number; proofId: string }[];
  intakes: DailyIntakeEvidence[]; endpointAcceptances: RecoveryEndpointAcceptance[];
  catalogTurns: DailyCatalogTurn[]; queue: DailyQueueSnapshot[];
  boundaries: { scheduledAt: number; startedAt: number; endedAt: number; proofIds: string[] }[] };
function unique<T>(rows: readonly T[], key: (row: T) => string) {
  const result = new Map<string, T>(); for (const row of rows) { const id = key(row); assert(!result.has(id), 'duplicate daily row: ' + id); result.set(id, row); } return result;
}
/** Pure timing/inventory reconciliation. The parent independently resolves every actual SQL/reader proof. */
export function evaluateCapacityDaily(manifest: CapacityDailyManifest, evidence: CapacityDailyEvidence) {
  assertCapacityDailyManifest(manifest); assert.equal(evidence.manifestDigest, manifest.digest);
  const start = capacityTime(evidence.startedAt), end = capacityTime(evidence.endedAt), fixedEnd = start + DAILY_CLOCK.observationMs;
  assert(end >= start); assert(evidence.workDeadlineAt >= start + DAILY_CLOCK.minimumRemainingWorkMs);
  const errors: string[] = [], missing: string[] = [], need = (condition: unknown, name: string, at = fixedEnd) => { if (!condition) (end >= at ? errors : missing).push(name); };
  need(end >= fixedEnd, 'fixed daily observation end'); assert(end <= evidence.workDeadlineAt, 'daily window exceeded supervisor');
  assert(evidence.auxiliary.endedAt <= start && evidence.auxiliary.startedAt <= evidence.auxiliary.endedAt);
  assert.equal(evidence.auxiliary.requests.length, 2);
  assert.equal(new Set(evidence.auxiliary.requests.map(row => row.requestId)).size, 2);
  for (const user of manifest.auxiliary.users) {
    const row = evidence.auxiliary.requests.find(row => row.label === user.label); assert(row);
    assert(row.submittedAt >= evidence.auxiliary.startedAt && row.receiptAt >= row.submittedAt && row.receiptAt - row.submittedAt <= 2000);
    assert(row.completedAt >= row.receiptAt && row.completedAt <= evidence.auxiliary.endedAt);
    assert.equal(row.proof.requestId, row.requestId); assert.equal(evidence.auxiliary.overlap[user.label].requestId, row.requestId);
    assert(evidence.auxiliary.overlap[user.label].span.startedAt >= Math.max(...evidence.auxiliary.requests.map(item => item.completedAt)));
  }
  const attempts = unique(evidence.requests.attempts, row => row.id), targets = unique(evidence.targets, row => row.cohort);
  for (const attempt of attempts.values()) assertCapacityHttpEndpoint(attempt, true);
  for (const owner of manifest.source.requestOwners) {
    const rows = evidence.ownerCoverage.filter(row => row.owner === owner); assert(rows.length <= 1);
    need(rows[0] && rows[0].startedAt <= start && rows[0].endedAt >= end, 'complete owner coverage: ' + owner);
  }
  const inputs = unique(evidence.initialSubmissions, row => row.cohort), intakeIds = unique(evidence.intakes, row => row.requestId);

  for (const input of manifest.initialRequests) {
    const row = inputs.get(input.cohort); need(row && row.submittedAt >= start && row.receiptAt !== null && row.receiptAt >= row.submittedAt && row.receiptAt - row.submittedAt <= 2000, 'initial receipt: ' + input.cohort, start + DAILY_CLOCK.initialHeadsDeadlineMs);
    if (!row) continue;
    for (const key of input.leagueKeys) for (const family of ['rosters', 'lineups', 'official-scores', 'transactions']) {
      const heads = evidence.initialHeadConfirmations.filter(item => item.pairId === key + '/' + family);
      need(heads.length === 1 && heads[0].requestId === row.requestId && heads[0].at >= row.submittedAt && heads[0].at <= start + DAILY_CLOCK.initialHeadsDeadlineMs,
        'initial current head: ' + key + '/' + family, start + DAILY_CLOCK.initialHeadsDeadlineMs);
    }
    const initial = intakeIds.get(row.requestId);
    need(initial && initial.kind === 'initial' && initial.proof.coverage === 'complete-materialized-initial-scope'
      && initial.completedAt >= row.receiptAt! && initial.completedAt - row.submittedAt <= DAILY_CLOCK.fullInventoryMs, 'initial selected completion: ' + input.cohort, start + DAILY_CLOCK.fullInventoryMs);
  }
  for (const planned of manifest.targets) {
    const target = targets.get(planned.cohort); need(target, 'configured daily target: ' + planned.cohort, start + DAILY_CLOCK.initialHeadsDeadlineMs); if (!target) continue;
    assert.equal(target.input.cadenceSeconds, DAILY_CLOCK.cadenceSeconds); assert.equal(target.input.paused, false);
    assert(target.configuredAt >= start && target.configuredCompletedAt >= target.configuredAt && target.configuredCompletedAt <= start + DAILY_CLOCK.initialHeadsDeadlineMs);
    const completed = evidence.intakes.filter(row => row.kind === 'cycle' && row.targetId === target.targetId).sort((a, b) => a.cycle! - b.cycle!);
    need(completed.length === 2, 'two complete daily cycles: ' + planned.cohort);
    for (const cycle of completed) {
      assert(cycle.cycle === 1 || cycle.cycle === 2); assert.equal(cycle.cohort, planned.cohort); assert.equal(cycle.proof.requestId, cycle.requestId);
      assert.equal(cycle.proof.terminal, true); assert.equal(cycle.proof.coverage, 'complete-materialized-inventory');
      assert.equal(cycle.proof.parity, 'immutable-intake-receipts-and-current-readers'); assert(cycle.dueAt !== null && cycle.createdAt >= cycle.dueAt);
      assert.deepEqual([...cycle.proof.completedEndpointIds].sort(), [...planned.endpointIds].sort());
      need(cycle.completedAt >= cycle.createdAt && cycle.completedAt - cycle.createdAt <= DAILY_CLOCK.fullInventoryMs && cycle.completedAt <= fixedEnd, 'full inventory deadline: ' + cycle.requestId);
    }
    if (completed.length === 2) {
      assert.equal(completed[0].cycle, 1); assert.equal(completed[1].cycle, 2);
      assert.equal(completed[1].dueAt! - completed[0].dueAt!, DAILY_CLOCK.cadenceSeconds * 1000, 'SQL daily due grid changed');
      need(completed[1].completedAt - completed[0].completedAt <= DAILY_CLOCK.maxSourceGapMs && fixedEnd - completed[1].completedAt <= DAILY_CLOCK.maxSourceGapMs, 'complete correction sweep gap: ' + planned.cohort);
    }
  }
  const successes = evidence.endpointAcceptances.filter(row => row.requestId !== null && intakeIds.get(row.requestId)?.kind === 'cycle');
  for (const row of evidence.endpointAcceptances) {
    const endpoint = manifest.endpoints.find(item => item.id === row.endpointId); assert(endpoint, 'undeclared daily endpoint');
    const attempt = attempts.get(row.attemptId); assert(attempt?.outcome === 'success' && attempt.responseSha256 === row.payloadSha256);
    assert.equal(attempt.origin + attempt.path, endpoint.url); assert.equal(attempt.method, endpoint.method);
    const expected = attempt.at < start + DAILY_CLOCK.publicationOffsetMs ? endpoint.before : endpoint.after;
    assert.equal(row.version, expected.version); assert.equal(row.payloadSha256, expected.sha256);
    assert(row.sourceObservedAt >= attempt.endedAt && row.readAt >= row.sourceObservedAt && row.readAt <= end);
    if (row.acceptedAt !== null) assert(row.acceptedAt >= row.sourceObservedAt && row.acceptedAt <= row.readAt);
  }
  const dailyResources = [...new Set(manifest.targets.flatMap(row => row.endpointIds))].map(endpointId => {
    const rows = successes.filter(row => row.endpointId === endpointId).sort((a, b) => a.sourceObservedAt - b.sourceObservedAt);
    const genuine = [...new Map(rows.map(row => [row.attemptId, row])).values()];
    const gaps = genuine.slice(1).map((row, index) => ({ sourceGapMs: row.sourceObservedAt - genuine[index].sourceObservedAt,
      confirmationGapMs: row.readAt - genuine[index].sourceObservedAt }));
    const pass = genuine.length >= 2 && gaps.every(gap => gap.confirmationGapMs <= DAILY_CLOCK.maxSourceGapMs)
      && fixedEnd - genuine.at(-1)!.sourceObservedAt <= DAILY_CLOCK.maxSourceGapMs;
    need(pass, 'daily successful source gap/tail: ' + endpointId);
    return { endpointId, observations: genuine.length, gaps, tailMs: genuine.length ? fixedEnd - genuine.at(-1)!.sourceObservedAt : null, pass };
  });
  const turns = unique(evidence.catalogTurns, row => String(row.ordinal));
  let initialCatalog: number | null = null, recurrence: number | null = null, recurrenceRetryAt: number | null = null;
  for (let ordinal = 0; ordinal < DAILY_CLOCK.observationMs / DAILY_CLOCK.invocationIntervalMs; ordinal++) {
    const row = turns.get(String(ordinal)), at = start + ordinal * DAILY_CLOCK.invocationIntervalMs;
    need(row, 'catalog eligibility turn: ' + ordinal, at + DAILY_CLOCK.invocationIntervalMs); if (!row) continue;
    assert.equal(row.scheduledAt, at); assert(row.startedAt >= at && row.endedAt >= row.startedAt);
    if (row.state === 'missed') { assert.equal(row.invocationOutcome, null); assert.equal(row.invocationFailed, null); }
    else need(row.invocationFailed === false && row.invocationOutcome !== null, 'successful daily facade turn: ' + ordinal, row.endedAt);
    const eligible = row.retryAt === null || row.startedAt >= row.retryAt;
    for (const id of row.attemptIds) {
      const attempt = attempts.get(id); assert(attempt && attempt.owner === 'data-refresh' && attempt.method === 'GET' && attempt.path === '/v1/players/nfl');
      assert(attempt.at >= row.startedAt && attempt.endedAt <= row.endedAt);
      assert(row.retryAt === null || attempt.at >= row.retryAt, 'catalog attempted before unchanged guard');
      if (initialCatalog === null) initialCatalog = attempt.at; else if (recurrence === null) {
        assert(row.lastAttemptId !== null && row.retryAt !== null, 'catalog recurrence requires persisted attempt eligibility');
        recurrence = attempt.at; recurrenceRetryAt = row.retryAt;
      }
    }
    if (row.state === 'invoked' && (eligible || row.catalogChoices.length > 0)) {
      if (!eligible) assert(row.retryAt !== null && row.catalogChoices[0].span.startedAt >= row.retryAt, 'catalog choice before unchanged guard');
      const choice=classifyDailyCatalogChoice(row.catalogChoices);need(choice!=='unclassified','classified eligible catalog choice: '+ordinal,row.endedAt);
      if(choice==='reserved')need(row.attemptIds.length===1,'reserved catalog physical attempt: '+ordinal,row.endedAt);
      else assert.equal(row.attemptIds.length,0);
    } else { assert.equal(row.attemptIds.length, 0); assert.equal(row.catalogChoices.length,0); }
  }
  need(initialCatalog !== null && initialCatalog <= start + DAILY_CLOCK.initialCatalogDeadlineMs, 'initial catalog attempt', start + DAILY_CLOCK.initialCatalogDeadlineMs);
  need(recurrence !== null && recurrenceRetryAt !== null && recurrence >= recurrenceRetryAt, 'real guarded catalog recurrence');
  for (const offset of DAILY_BOUNDARY_OFFSETS) {
    const rows = evidence.boundaries.filter(row => row.scheduledAt === start + offset);
    need(rows.length === 1 && rows[0].startedAt >= start + offset && rows[0].startedAt <= start + offset + 1000
      && rows[0].endedAt <= start + offset + 60_000 && rows[0].proofIds.length > 0, 'fixed daily boundary: ' + offset, start + offset + 60_000);
  }
  // This fresh isolated lane starts collecting before auxiliary setup. Its first hour has no
  // fabricated lookback: report and gate the complete observed prefix separately, then use
  // the unchanged evaluator once a real hour of coverage exists. Setup attempts carry forward.
  assert(evidence.requests.coverageStartedAt <= evidence.auxiliary.startedAt);
  const rollingStart = evidence.requests.coverageStartedAt + 3_600_000;
  const prefix = evidence.requests.attempts.filter(row => ['data-refresh','independent-measurement'].includes(row.owner)
    && row.at <= rollingStart).sort((a,b)=>a.at-b.at);
  const peak = (span: number) => { let left=0,maximum=0; for(let right=0;right<prefix.length;right++) {
    while(prefix[left].at<=prefix[right].at-span)left++; maximum=Math.max(maximum,right-left+1); } return maximum; };
  const prefixRequestEnvelope = { startedAt: evidence.requests.coverageStartedAt, endedAt: rollingStart,
    totalAttempts: prefix.length, minutePeak: peak(60_000), hourPeak: peak(3_600_000) };
  need(prefixRequestEnvelope.minutePeak<=40 && prefixRequestEnvelope.hourPeak<=1800,'setup and initial DATA request envelope');
  const requestEnvelope = evaluateRequestEnvelope(manifest.source.requestOwners, evidence.requests, rollingStart, end, manifest.source.requestBudgetPolicy);
  need(requestEnvelope.pass, 'DATA request envelope');
  return { kind: 'cp26-daily-offline-analysis-v1', pass: errors.length === 0 && missing.length === 0,
    errors, missing, dailyResources, catalog: { initialAttemptAt: initialCatalog, repeatedAttemptAt: recurrence, recurrenceRetryAt, physicalSourceGapMs: recurrence !== null && initialCatalog !== null ? recurrence - initialCatalog : null, choices: evidence.catalogTurns.filter(row=>row.catalogChoices.length).map(row=>({ordinal:row.ordinal,classification:classifyDailyCatalogChoice(row.catalogChoices)})) }, prefixRequestEnvelope, requestEnvelope,
    activePercentilesQualified: false, checkpoint26Qualified: false };
}
