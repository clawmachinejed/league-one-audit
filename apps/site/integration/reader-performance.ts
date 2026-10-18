import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { lstat, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STORAGE_RELATIONS, type StoragePhaseEvidence } from './reader-performance-snapshot';
import type { DatabaseClient, DatabaseRow, DatabaseQueryOptions } from '../lib/database';
import type { PublicIntakeReadOptions } from '../lib/league-administration/public-intake-contracts';
import type { QualificationBinding } from './qualification-profile';
import { validReaderSnapshotDiagnostic, type ReaderSnapshotDiagnostic } from './reader-performance-snapshot';
import { createCapacityFleetFixture } from './freshness-capacity-fixtures';

export const READER_PERFORMANCE_PROFILE = 'data-reader-performance-v1';
export const READER_PERFORMANCE_MODULE = 'integration/reader-performance.qualification-case.ts';
export const READER_PERFORMANCE_SUITE = 'bounded stored DATA reader performance through the existing PostgreSQL composition';
export const READER_PERFORMANCE_TESTS = [
  'stores the fixed sixteen league 2026 dataset through existing typed acceptance',
  'measures all one thousand scheduled composed reads at concurrency ten',
  'records bounded list reads actual query plans and immutable stored state',
] as const;
export const READER_PERFORMANCE_FULL_NAMES = READER_PERFORMANCE_TESTS.map(name => READER_PERFORMANCE_SUITE + ' > ' + name);
export const READER_PERFORMANCE_LIMITS = [1_080_000, 300_000, 120_000] as const;
export const READER_PERFORMANCE_EVIDENCE_FILE = 'reader-performance-evidence.json';
export const READER_PERFORMANCE_OPTIONS = {
  current: { managerEvidenceVersion: 'v2', periodContextVersion: 'v1', exactMatchupValuesVersion: 'v1',
    seasonHistoryVersion: 'v1', periodInventoryPage: { afterOrdinal: 6, limit: 1 } },
  history: { managerEvidenceVersion: 'v2', periodContextVersion: 'v1', exactMatchupValuesVersion: 'v1',
    seasonHistoryVersion: 'v1', periodInventoryPage: { afterOrdinal: 0, limit: 18 } },
} as const satisfies Record<string, PublicIntakeReadOptions>;
export type ReaderClass = keyof typeof READER_PERFORMANCE_OPTIONS;
export type ReaderSlot = { index: number; league: number; kind: ReaderClass; temperature: 'first-reader-call' | 'repeat-reader-call' };
export const READER_PERFORMANCE_SCHEDULE: readonly ReaderSlot[] = Object.freeze(Array.from({ length: 1_000 }, (_, index): ReaderSlot => ({
  index, league: Math.floor(index / 2) % 16, kind: index % 2 ? 'history' : 'current',
  temperature: index < 32 ? 'first-reader-call' : 'repeat-reader-call',
})));
export const readerDigest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** Authored native-shape source, never a live capture or CP26 completion witness.
 * Twenty populated rosters per league; identities shared across leagues only by native namespace. */
export function createReaderSourceDataset() {
  const retained = createCapacityFleetFixture();
  const native = (id: string) => {
    const endpoint = retained.endpointInventory.find(row => row.id === id); assert(endpoint, 'Missing existing fixture source.');
    return JSON.parse(endpoint.versions[0].utf8) as Record<string, unknown>;
  };
  const nativeRows = (id: string) => native(id) as unknown as Record<string, unknown>[];
  const player = (index: number) => 'cp27-player-' + String(index).padStart(3, '0');
  const players = Object.fromEntries(Array.from({ length: 160 }, (_, index) => [player(index + 1), {
    ...Object.values(native('shared:players'))[index % 22] as Record<string, unknown>,
    player_id: player(index + 1), full_name: 'Authored Player ' + (index + 1), first_name: 'Authored', last_name: 'Player ' + (index + 1),
    position: ['QB', 'RB', 'WR', 'TE'][index % 4], fantasy_positions: [['QB', 'RB', 'WR', 'TE'][index % 4]], team: 'ARI', active: true, status: 'Active',
  }]));
  const leagues = Array.from({ length: 16 }, (_, index) => {
    const original = retained.prototype.leagues[index], nativeId = original.nativeLeagueId, manager = String(9290000000000000000n + BigInt(index * 100 + 1));
    const username = 'cp27_reader_' + (index + 1), key = 'cp27-reader-' + (index + 1);
    const users = Array.from({ length: 21 }, (_, user) => ({ user_id: String(BigInt(manager) + BigInt(user)), username: username + '_' + user,
      display_name: 'Authored manager ' + (user + 1), is_owner: user === 0, metadata: {} }));
    const payload = { ...native(original.key + ':league'), league_id: nativeId, name: 'CP27 authored league ' + (index + 1), season: '2026', sport: 'nfl', season_type: 'regular',
      status: 'in_season', total_rosters: 20, roster_positions: ['QB', 'RB', 'WR', 'TE', 'BN', 'BN', 'BN', 'BN'],
      scoring_settings: { rec: 0.5, pass_int: -2 }, settings: { type: index % 3, leg: 18, last_scored_leg: 17,
        start_week: 1, playoff_week_start: 15, playoff_round_type: 2, playoff_teams: 4, waiver_budget: 100 } };
    const rosters = Array.from({ length: 20 }, (_, team) => ({ ...nativeRows(original.key + ':rosters')[team], roster_id: team + 1, owner_id: users[team].user_id,
      co_owners: team === 0 ? [users[20].user_id] : [], players: Array.from({ length: 8 }, (_, slot) => player(team * 8 + slot + 1)),
      starters: Array.from({ length: 4 }, (_, slot) => player(team * 8 + slot + 1)), reserve: [player(team * 8 + 7)], taxi: [player(team * 8 + 8)],
      settings: { wins: team % 4, losses: 4 - team % 4, ties: 0, fpts: 80 + team, fpts_decimal: 25, waiver_budget_used: team } }));
    const matchups = Array.from({ length: 18 }, (_, period) => rosters.map((roster, team) => ({
      ...nativeRows(original.key + ':matchups:' + (period + 1))[team],
      roster_id: roster.roster_id, matchup_id: period === 5 && team >= 18 ? null : Math.floor(team / 2) + 1,
      players: roster.players, starters: roster.starters, points: 40 + team + period,
      custom_points: period === 5 && team === 0 ? 0 : null, starters_points: [10, 10, 10, 10],
      players_points: Object.fromEntries(roster.players.map((id, slot) => [id, slot < 4 ? 10 : 0])),
    })));
    const transactions = Array.from({ length: 20 }, (_, ordinal) => ({ ...nativeRows(original.key + ':transactions:7')[0], transaction_id: nativeId + String(ordinal + 1).padStart(2, '0'),
      type: 'waiver', status: ordinal % 4 ? 'complete' : 'failed', roster_ids: [ordinal + 1],
      adds: { [player(ordinal * 8 + 5)]: ordinal + 1 }, drops: { [player(ordinal * 8 + 6)]: ordinal + 1 },
      settings: { waiver_bid: ordinal }, created: 1792108800000 + ordinal * 1000, status_updated: 1792108800000 + ordinal * 1000 }));
    const draft = { ...native(original.key + ':draft-detail'), draft_id: nativeId + '01', league_id: nativeId, season: '2026', sport: 'nfl', type: 'snake', status: 'complete',
      settings: { teams: 20, rounds: 1 }, draft_order: Object.fromEntries(users.slice(0, 20).map((user, ordinal) => [user.user_id, ordinal + 1])),
      slot_to_roster_id: Object.fromEntries(rosters.map(roster => [String(roster.roster_id), roster.roster_id])) };
    const picks = rosters.map((roster, ordinal) => ({ ...nativeRows(original.key + ':draft-picks')[ordinal], pick_no: ordinal + 1, round: 1, draft_slot: ordinal + 1, roster_id: ordinal + 1,
      player_id: roster.players[0], picked_by: users[ordinal].user_id, is_keeper: ordinal === 0, metadata: null }));
    const trades = [{ season: '2027', round: 1, roster_id: 1, owner_id: 2, previous_owner_id: 1 }];
    const winners = [{ r: 1, m: 1, t1: 1, t2: 2, w: 1, l: 2 }, { r: 1, m: 2, t1: 3, t2: 4, w: 3, l: 4 }];
    const losers = [{ r: 1, m: 1, t1: 17, t2: 18, w: 17, l: 18 }];
    const report = { data: { metadata: { key: nativeId + '_7', type: 'league_report', created: 1792108800000, last_updated: 1792108800000,
      data: { week: 7, standings: rosters.map((roster, ordinal) => ({ roster_id: roster.roster_id, round: 7, rank: ordinal + 1,
        wins: roster.settings.wins, losses: roster.settings.losses, ties: 0, points: roster.settings.fpts + 0.25, points_against: 80, record: '', streak: '' })) } } } };
    return { key, native: nativeId, manager, username, users, payload, rosters, matchups, transactions, draft, picks, trades, winners, losers, report };
  });
  return { kind: 'cp27-authored-native-source-v1' as const, season: 2026 as const,
    basis: { source: 'integration/freshness-capacity-fixtures.ts#createCapacityFleetFixture', digest: retained.digest,
      expansion: 'Disclosed populated20-roster160-player and20-transaction source expansion; CP26 remains unqualified.' }, players, leagues };
}
const sourceDataset = createReaderSourceDataset();
const expectedSourceBindings = Object.freeze(sourceDataset.leagues.map(readerDigest));
export const READER_SOURCE_DIGEST = readerDigest(sourceDataset);
const readerFailureCodes = ['53200', '53300', '53400', '57014', '57P01', '57P02', '57P03', '57P04', '57P05',
  '08000', '08001', '08003', '08004', '08006', '08007', '08P01', '42501', '42P01', '42703',
  'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'ENETUNREACH', 'EHOSTUNREACH', 'ENOTFOUND', 'EAI_AGAIN'] as const;
export type ReaderFailureDiagnostic = { category: 'postgresql' | 'transport' | 'deadline' | 'assertion' | 'unknown';
  code: typeof readerFailureCodes[number] | 'unknown' };
export type ReaderSqlFailure = ReaderFailureDiagnostic & { queryDigest: string };
const correctnessCheckpoints = ['result-status', 'league-identity', 'core-resources', 'held-roster-managers', 'exact-periods',
  'transactions', 'brackets', 'drafts', 'weekly-reports', 'official-standings', 'season-history', 'inventory', 'stable-digest'] as const;
export type ReaderCorrectnessCheckpoint = typeof correctnessCheckpoints[number];
export class ReaderCorrectnessError extends Error {
  readonly diagnostic: ReaderFailureDiagnostic;
  constructor(readonly checkpoint: ReaderCorrectnessCheckpoint, error: unknown) {
    super('CP27 reader correctness check failed at ' + checkpoint + '.'); this.name = 'ReaderCorrectnessError';
    this.diagnostic = readerFailureDiagnostic(error);
  }
}
function correctnessError(error: unknown): ReaderCorrectnessError | null {
  try { return error instanceof ReaderCorrectnessError ? error : null; } catch { return null; }
}

function ownErrorString(error: unknown, key: string): string | undefined {
  try { const descriptor = error && typeof error === 'object' ? Object.getOwnPropertyDescriptor(error, key) : undefined;
    return typeof descriptor?.value === 'string' ? descriptor.value : undefined; } catch { return undefined; }
}
/** Closed labels only: raw messages, stacks, parameter values and URLs never enter evidence. */
export function readerFailureDiagnostic(error: unknown, deadline = false): ReaderFailureDiagnostic {
  const correctness = correctnessError(error); if (correctness) return correctness.diagnostic;
  const code = ownErrorString(error, 'code');
  if (readerFailureCodes.some(value => value === code)) return { category: /^[0-9]/u.test(code!) ? 'postgresql' : 'transport', code: code as ReaderFailureDiagnostic['code'] };
  if (deadline || ['TimeoutError', 'AbortError'].includes(ownErrorString(error, 'name') ?? '')) return { category: 'deadline', code: 'unknown' };
  if (code === 'ERR_ASSERTION') return { category: 'assertion', code: 'unknown' };
  return { category: 'unknown', code: 'unknown' };
}
function assertFailureDiagnostic(value: ReaderFailureDiagnostic) {
  assert(value && ['postgresql', 'transport', 'deadline', 'assertion', 'unknown'].includes(value.category));
  assert(value.code === 'unknown' || readerFailureCodes.some(code => code === value.code));
  if (value.code !== 'unknown') assert.equal(value.category, /^[0-9]/u.test(value.code) ? 'postgresql' : 'transport');
}
export type ReaderSample = ReaderSlot & { lane: number; startedMs: number; elapsedMs: number; status: 'passed' | 'failed' | 'unserved';
  failure: 'none' | 'reader-or-correctness' | 'budget-exhausted'; statements: number; rows: number; decodedBytes: number;
  statementMs: number; resultDigest: string | null; failureDetail: (ReaderFailureDiagnostic & { stage: 'reader' | 'correctness'; checkpoint: ReaderCorrectnessCheckpoint | null }) | null;
  sqlFailure: ReaderSqlFailure | null };
export type QueryMeasurement = { digest: string; sql: string; calls: number; failures: number; rows: number; decodedBytes: number;
  elapsedMs: number; parameters: readonly unknown[]; firstFailure: ReaderFailureDiagnostic | null };
export type ReaderPlan = { digest: string; sql: string; parameterDigest: string; explainedRows: number;
  plan: readonly DatabaseRow[] };

/** SELECT-only instrumentation wraps the original client. No row cache or substitute reader. */
export function measuredReaderDatabase(database: DatabaseClient, queries: Map<string, QueryMeasurement>, sample: ReaderSample): DatabaseClient {
  return { enabled: true, async query<Row extends DatabaseRow>(sql: string, parameters: readonly unknown[] = [], options: DatabaseQueryOptions = {}) {
    assert(/^\s*(?:\/\*[\s\S]*?\*\/\s*)?(?:SELECT|WITH)\b/iu.test(sql), 'Benchmark reader issued a non-SELECT statement.');
    assert(!/\b(?:INSERT|UPDATE|DELETE|MERGE|CALL|COPY|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|FOR\s+(?:UPDATE|SHARE))\b/iu.test(sql), 'Benchmark reader attempted a write.');
    const digest = readerDigest(sql);
    let entry = queries.get(digest);
    if (!entry) { assert(queries.size < 150, 'Unexpected reader SQL inventory expansion.');
      entry = { digest, sql, calls: 0, failures: 0, rows: 0, decodedBytes: 0, elapsedMs: 0, parameters: [...parameters], firstFailure: null }; queries.set(digest, entry); }
    entry.calls++; sample.statements++;
    const started = performance.now();
    try {
      const rows = await database.query<Row>(sql, parameters, options);
      const bytes = Buffer.byteLength(JSON.stringify(rows));
      entry.rows += rows.length; sample.rows += rows.length; entry.decodedBytes += bytes; sample.decodedBytes += bytes;
      return rows;
    } catch (error) { entry.failures++; const diagnostic = readerFailureDiagnostic(error, options.signal?.aborted);
      entry.firstFailure ??= diagnostic; sample.sqlFailure ??= { ...diagnostic, queryDigest: digest }; throw error; }
    finally { const elapsed = performance.now() - started; entry.elapsedMs += elapsed; sample.statementMs += elapsed; }
  } };
}

/** Fixed assignment; unsuccessful and unserved slots remain in their original denominator. */
export async function runReaderSchedule(input: { database: DatabaseClient; queries: Map<string, QueryMeasurement>;
  read: (slot: ReaderSlot, database: DatabaseClient) => Promise<unknown>; verify: (slot: ReaderSlot, result: unknown) => string;
  maximumMs?: number }): Promise<{ samples: ReaderSample[]; maximumActive: number; elapsedMs: number }> {
  const start = performance.now(), deadline = start + (input.maximumMs ?? 280_000);
  const samples: ReaderSample[] = READER_PERFORMANCE_SCHEDULE.map(slot => ({ ...slot, lane: slot.index % 10,
    startedMs: 0, elapsedMs: 0, status: 'unserved', failure: 'budget-exhausted', statements: 0,
    rows: 0, decodedBytes: 0, statementMs: 0, resultDigest: null, failureDetail: null, sqlFailure: null }));
  let active = 0, maximumActive = 0;
  await Promise.all(Array.from({ length: 10 }, async (_, lane) => {
    for (let index = lane; index < samples.length; index += 10) {
      const sample = samples[index];
      if (performance.now() >= deadline) continue;
      sample.startedMs = performance.now() - start;
      active++; maximumActive = Math.max(maximumActive, active);
      const measured = measuredReaderDatabase(input.database, input.queries, sample);
      const signal = AbortSignal.timeout(Math.max(1, Math.min(10_000, Math.floor(deadline - performance.now()))));
      const bounded: DatabaseClient = { enabled: true, query: (sql, values, options) => measured.query(sql, values,
        { signal: options?.signal ? AbortSignal.any([signal, options.signal]) : signal }) };
      let stage: 'reader' | 'correctness' = 'reader';
      try {
        const result = await input.read(sample, bounded);
        // Timer includes original SQL, installed driver decoding, and full reader composition.
        sample.elapsedMs = performance.now() - start - sample.startedMs;
        stage = 'correctness'; sample.resultDigest = input.verify(sample, result);
        // A resource fallback cannot turn an observed SQL failure into a passing read.
        if (sample.sqlFailure) { sample.status = 'failed'; sample.failure = 'reader-or-correctness'; sample.resultDigest = null;
          sample.failureDetail = { stage: 'reader', checkpoint: null, category: sample.sqlFailure.category, code: sample.sqlFailure.code }; }
        else { sample.status = 'passed'; sample.failure = 'none'; }
      } catch (error) { sample.elapsedMs = performance.now() - start - sample.startedMs; sample.status = 'failed'; sample.failure = 'reader-or-correctness';
        sample.failureDetail = { ...readerFailureDiagnostic(error, stage === 'reader' && signal.aborted), stage, checkpoint: stage === 'correctness' ? correctnessError(error)?.checkpoint ?? null : null }; }
      finally { active--; }
    }
  }));
  return { samples, maximumActive, elapsedMs: performance.now() - start };
}

/** JSON null explicitly represents +Infinity for failed/unserved samples. */
export function readerPercentiles(samples: readonly ReaderSample[]) {
  assert(samples.length > 0);
  const sorted = samples.map(sample => sample.status === 'passed' ? sample.elapsedMs : Infinity).sort((a, b) => a - b);
  const rank = (fraction: number) => { const value = sorted[Math.ceil(sorted.length * fraction) - 1]; return Number.isFinite(value) ? value : null; };
  return { count: samples.length, passed: samples.filter(sample => sample.status === 'passed').length,
    failed: samples.filter(sample => sample.status === 'failed').length, unserved: samples.filter(sample => sample.status === 'unserved').length,
    p50Ms: rank(0.5), p95Ms: rank(0.95), p99Ms: rank(0.99), maximumMs: rank(1), failureOrdering: 'positive-infinity' as const };
}
export function assertReaderTarget(samples: readonly ReaderSample[]) {
  const result = readerPercentiles(samples);
  assert.equal(result.failed, 0, 'Reader correctness/SQL failures remain failures.'); assert.equal(result.unserved, 0, 'Unserved slots cannot qualify.');
  assert(result.p95Ms !== null && result.p95Ms <= 500, 'Reader p95 exceeds 500ms.');
  assert(result.p99Ms !== null && result.p99Ms <= 1_000, 'Reader p99 exceeds 1000ms.');
}

export type ReaderPerformanceEvidence = { kind: 'data-reader-performance-evidence-v1'; contextDigest: string; gitSha: string;
  runId: string; profile: typeof READER_PERFORMANCE_PROFILE; setupResponseCount: number; operationalResets: number;
  serverVersion: string; serverVersionNum: string; runtimeLogin: string; transport: 'production-neon-http'; sourceDigest: string;
  dataset: { leagues: number; rosters: number; weeks: number; players: number; requestIds: string[]; receiptCount: number; sourceBindings: string[] };
  cases: { name: string; state: 'unserved' | 'running' | 'passed' | 'failed'; startedAt: string | null; endedAt: string | null }[];
  samples: ReaderSample[]; maximumActive: number; elapsedMs: number; lists: { kind: 'period-task-list' | 'player-directory'; elapsedMs: number; rows: number; bound: number; digest: string;
    statements: number; statementRows: number; decodedBytes: number }[];
  queries: Omit<QueryMeasurement, 'parameters'>[]; plans: ReaderPlan[]; tableCounts: { table: string; rows: number; totalBytes: number }[];
  beforeDigest: string | null; afterDigest: string | null; snapshotFailure: ReaderSnapshotDiagnostic | null; snapshotCleanupFailures: ReaderSnapshotDiagnostic[]; providerRequests: number; blockedFetches: number; cleanupComplete: boolean };
function assertReaderEvidence(value: ReaderPerformanceEvidence, binding: QualificationBinding) {
  assert(Buffer.byteLength(JSON.stringify(value)) <= 4 * 1024 * 1024, 'Reader evidence exceeds fixed budget.');
  assert.equal(value.kind, 'data-reader-performance-evidence-v1'); assert.equal(value.contextDigest, readerDigest(binding.context));
  assert.equal(value.gitSha, binding.context.gitSha); assert.equal(binding.context.profile, READER_PERFORMANCE_PROFILE);
  assert(value.snapshotFailure === null || validReaderSnapshotDiagnostic(value.snapshotFailure));
  assert(Array.isArray(value.snapshotCleanupFailures) && value.snapshotCleanupFailures.length <= 2 && value.snapshotCleanupFailures.every(validReaderSnapshotDiagnostic));
  if (value.snapshotCleanupFailures.length) assert(value.snapshotFailure);
  assert.equal(value.profile, READER_PERFORMANCE_PROFILE); assert.equal(value.runId, binding.context.runId);
  assert.match(value.serverVersionNum, /^\d{5,6}$/u); assert(typeof value.serverVersion === 'string' && value.serverVersion.length < 100);
  assert.equal(value.runtimeLogin, 'league_one_runtime'); assert.equal(value.transport, 'production-neon-http');
  assert.equal(value.sourceDigest, READER_SOURCE_DIGEST); assert.equal(value.cases.length, READER_PERFORMANCE_TESTS.length);
  for (const [index, entry] of value.cases.entries()) {
    assert.equal(entry.name, READER_PERFORMANCE_TESTS[index]); assert(['unserved', 'running', 'passed', 'failed'].includes(entry.state));
    if (entry.state === 'passed') { assert(entry.startedAt && entry.endedAt);
      const duration = Date.parse(entry.endedAt) - Date.parse(entry.startedAt); assert(duration >= 0 && duration <= READER_PERFORMANCE_LIMITS[index]); }
    const previous = value.cases[index - 1]; if (previous?.endedAt && entry.startedAt) assert(Date.parse(entry.startedAt) >= Date.parse(previous.endedAt));
  }
  assert(value.samples.length === 0 || value.samples.length === 1_000);
  for (const [index, sample] of value.samples.entries()) {
    const slot = READER_PERFORMANCE_SCHEDULE[index]; for (const key of ['index', 'league', 'kind', 'temperature'] as const) assert.equal(sample[key], slot[key]);
    assert.equal(sample.lane, index % 10); assert(['passed', 'failed', 'unserved'].includes(sample.status));
    for (const key of ['elapsedMs', 'startedMs', 'statements', 'rows', 'decodedBytes', 'statementMs'] as const) assert(Number.isFinite(sample[key]) && sample[key] >= 0);
    if (sample.failureDetail !== null) { assertFailureDiagnostic(sample.failureDetail);
      assert.deepEqual(Object.keys(sample.failureDetail).sort(), ['category', 'checkpoint', 'code', 'stage']);
      assert(['reader', 'correctness'].includes(sample.failureDetail.stage));
      assert(sample.failureDetail.checkpoint === null || sample.failureDetail.stage === 'correctness' && correctnessCheckpoints.includes(sample.failureDetail.checkpoint)); }
    if (sample.sqlFailure !== null) { assertFailureDiagnostic(sample.sqlFailure);
      assert.deepEqual(Object.keys(sample.sqlFailure).sort(), ['category', 'code', 'queryDigest']);
      assert.match(sample.sqlFailure.queryDigest, /^[a-f0-9]{64}$/u); }
    if (sample.status === 'failed') { assert(sample.failureDetail); assert.equal(sample.failure, 'reader-or-correctness'); }
    else assert.equal(sample.failureDetail, null);
    if (sample.status === 'unserved') assert.equal(sample.sqlFailure, null);
    if (sample.status === 'passed') { assert.equal(sample.sqlFailure, null); assert.equal(sample.failure, 'none'); assert.match(sample.resultDigest!, /^[a-f0-9]{64}$/u); assert(sample.statements > 0 && sample.rows > 0); }
  }
  assert.equal(new Set(value.queries.map(query => query.digest)).size, value.queries.length);
  for (const query of value.queries) { assert.equal(query.digest, readerDigest(query.sql)); assert(query.calls > 0);
    assert(query.failures <= query.calls);
    if (query.failures > 0) { assertFailureDiagnostic(query.firstFailure!); assert.deepEqual(Object.keys(query.firstFailure!).sort(), ['category', 'code']); }
    else assert.equal(query.firstFailure, null);
    for (const key of ['calls', 'failures', 'rows', 'decodedBytes', 'elapsedMs'] as const) assert(Number.isFinite(query[key]) && query[key] >= 0); }
  for (const plan of value.plans) { assert.equal(plan.digest, readerDigest(plan.sql)); assert.match(plan.parameterDigest, /^[a-f0-9]{64}$/u); assert(plan.plan.length === 1);
    assert(Number.isFinite(plan.explainedRows) && plan.explainedRows >= 0); }
}
export function assertCompleteReaderPerformanceEvidence(input: unknown, binding: QualificationBinding): void {
  const value = input as ReaderPerformanceEvidence; assertReaderEvidence(value, binding);
  assert(value.cases.every(entry => entry.state === 'passed')); assert.equal(value.cleanupComplete, true);
  assert.equal(value.dataset.leagues, 16); assert.equal(value.dataset.rosters, 320); assert.equal(value.dataset.weeks, 288);
  assert.equal(value.dataset.players, 160); assert.equal(value.dataset.requestIds.length, 16); assert.equal(new Set(value.dataset.requestIds).size, 16);
  assert(value.dataset.receiptCount >= 16 * 18 * 2 + 16 * 4); assert.deepEqual(value.dataset.sourceBindings, expectedSourceBindings);
  assert.equal(value.setupResponseCount, 865); assert.equal(value.operationalResets, 16);
  assert.equal(value.samples.length, 1_000); assert.equal(value.maximumActive, 10); assert(value.elapsedMs <= 300_000);
  assertReaderTarget(value.samples);
  for (const kind of ['current', 'history'] as const) { const samples = value.samples.filter(sample => sample.kind === kind); assert.equal(samples.length, 500); assertReaderTarget(samples); }
  assert.equal(value.providerRequests, 0); assert.equal(value.blockedFetches, 0);
  assert.equal(value.snapshotFailure, null);
  assert.equal(value.beforeDigest, value.afterDigest); assert.match(value.beforeDigest!, /^[a-f0-9]{64}$/u);
  assert(value.queries.length > 0); assert.equal(value.plans.length, value.queries.length); assert.deepEqual(value.plans.map(plan => plan.digest).sort(), value.queries.map(query => query.digest).sort());
  // Every executed statement belongs to exactly one composed sample or separate list read.
  for (const [sampleKey, queryKey, listKey] of [['statements', 'calls', 'statements'], ['rows', 'rows', 'statementRows'], ['decodedBytes', 'decodedBytes', 'decodedBytes']] as const) {
    assert.equal(value.queries.reduce((sum, query) => sum + query[queryKey], 0), value.samples.reduce((sum, sample) => sum + sample[sampleKey], 0)
      + value.lists.reduce((sum, read) => sum + read[listKey], 0), 'Reader SQL totals do not reconcile.');
  }
  assert(value.queries.every(query => query.failures === 0)); assert(value.tableCounts.length > 0);
  assert.equal(value.lists.length, 32); assert.equal(value.lists.filter(read => read.kind === 'period-task-list').length, 16);
  for (const read of value.lists) { assert(read.rows > 0 && read.rows <= read.bound); assert(Number.isFinite(read.elapsedMs) && read.elapsedMs >= 0); }
}
/** Exclusive write retains failed samples, then independently verifies the exact bytes. */
export async function writeReaderPerformanceEvidence(value: ReaderPerformanceEvidence, binding: QualificationBinding) {
  assertReaderEvidence(value, binding); const text = JSON.stringify(value) + '\n', path = join(binding.directory, READER_PERFORMANCE_EVIDENCE_FILE);
  assert(Buffer.byteLength(text) <= 4 * 1024 * 1024); await writeFile(path, text, { flag: 'wx', mode: 0o600 });
  const stat = await lstat(path); assert(stat.isFile() && !stat.isSymbolicLink()); assert.equal(await readFile(path, 'utf8'), text);
}

// CP28 is separately selected. CP27's contracts above remain historical.
export const STORAGE_MEASUREMENT_PROFILE = 'data-storage-measurement-v1';
export const STORAGE_MEASUREMENT_SUITE = 'bounded two league DATA storage measurement through witnessed core acceptance';
export const STORAGE_MEASUREMENT_TEST = 'measures the frozen catalog forty two cores four corrections and exact pre acknowledgment replays';
export const STORAGE_MEASUREMENT_FULL_NAMES = [STORAGE_MEASUREMENT_SUITE + ' > ' + STORAGE_MEASUREMENT_TEST];
export const STORAGE_MEASUREMENT_EVIDENCE_FILE = 'cp28-storage-evidence.json';
export const STORAGE_PACKAGED_CATALOG_PATH = 'apps/site/integration/fixtures/cp28-sleeper-players-nfl.raw.json.gz';
export const STORAGE_MEASUREMENT_LIMITS = Object.freeze({ packagedBytes: 4 * 1024 * 1024, rawBytes: 16 * 1024 * 1024, captureBytes: 64 * 1024 * 1024,
  catalogEntries: 20_000, responseBytes: 128 * 1024 * 1024, coreBytes: 1024 * 1024, evidenceBytes: 4 * 1024 * 1024,
  statements: 40_000, readers: 200, catalogPages: 100, snapshotMs: 30_000, allocationBytes: 256 * 1024 * 1024 });
export const STORAGE_PHASES = ['S0-empty', 'S1-catalog', 'S2-A-prerequisites', 'S3-A-baseline', 'S4-B-prerequisites', 'S5-B-baseline',
  'S6-A-unchanged', 'S7-B-unchanged', 'S8-A-C1', 'S9-B-C1', 'S10-A-C2', 'S11-B-C2', 'S12-A-C3', 'S13-B-C3', 'S14-A-C4', 'S15-B-C4', 'S16-read-only'] as const;
export type StorageFixtureManifest = { kind: 'data-cp28-fixture-v1'; rawCatalogPath: string; rawSha256: string; rawBytes: number;
  entryCount: number; capturedAt: string; provenance: string; mapping: string[]; sourceBindings: string[]; fixtureDigest: string;
  packagedCatalog?: { path: typeof STORAGE_PACKAGED_CATALOG_PATH; sha256: string; bytes: number } };
export type StorageSource = ReturnType<typeof createStorageSourceDataset>;
export function createStorageSourceDataset(mapping: readonly string[]) {
  assert.equal(mapping.length, 160); assert.equal(new Set(mapping).size, 160);
  assert(mapping.every(id => typeof id === 'string' && id.length > 0 && id.length <= 256));
  // Reuse the already-bound CP27 source, copying only the two required core bodies.
  // Each call owns its payload/rows; it does not rebuild sixteen weekly schedules.
  const leagues = structuredClone(sourceDataset.leagues.slice(0, 2).map(({ native, manager, username, payload, rosters }) => ({ native, manager, username, payload, rosters })));
  return leagues.map(league => {
    const native = (id: string) => { const index = Number(id.slice('cp27-player-'.length)) - 1; assert(Number.isInteger(index) && index >= 0 && index < 160); return mapping[index]; };
    const baseline = league.rosters.map(row => ({ ...row, players: row.players.map(native), starters: row.starters.map(native), reserve: row.reserve.map(native), taxi: row.taxi.map(native) }));
    const versions = [baseline];
    for (let correction = 1; correction <= 4; correction++) {
      const rows = structuredClone(versions[correction - 1]);
      if (correction === 1) rows[0].starters = [mapping[4], mapping[1], mapping[2], mapping[3]];
      if (correction === 2) { rows[0].players = rows[0].players.filter(id => id !== mapping[7]); rows[0].taxi = []; }
      if (correction === 3) { rows[0].players = rows[0].players.filter(id => id !== mapping[5]); rows[1].players.push(mapping[5]); }
      if (correction === 4) { rows[0].owner_id = String(BigInt(league.manager) + 20n); rows[0].co_owners = []; rows[0].settings.fpts = 81; }
      versions.push(rows);
    }
    return { native: league.native, manager: league.manager, username: league.username, payload: league.payload, versions };
  });
}
/** Bind original catalog bytes. Parsing never replaces the transport body. */
export async function bindStorageFixture(raw: string, metadata: Pick<StorageFixtureManifest, 'rawCatalogPath' | 'capturedAt' | 'provenance'>) {
  assert(/^test-results\/cp28-fixture\/[a-zA-Z0-9._-]+\.json$/u.test(metadata.rawCatalogPath));
  assert(Number.isFinite(Date.parse(metadata.capturedAt)) && metadata.provenance.length > 0 && metadata.provenance.length <= 2000);
  const { normalizePlayerDirectoryRow, playerDirectoryDuplicateMembers } = await import('../lib/league-administration/player-directory');
  assert(Buffer.byteLength(raw) > 0 && Buffer.byteLength(raw) <= STORAGE_MEASUREMENT_LIMITS.rawBytes);
  assert.equal(playerDirectoryDuplicateMembers(raw, true).count, 0, 'Duplicate catalog members are not complete evidence.');
  const catalog: unknown = JSON.parse(raw); assert(catalog && typeof catalog === 'object' && !Array.isArray(catalog));
  const entries = Object.entries(catalog); assert(entries.length >= 160 && entries.length <= STORAGE_MEASUREMENT_LIMITS.catalogEntries);
  const positions = ['QB', 'RB', 'WR', 'TE'];
  const byPosition = positions.map(position => entries.filter(([id, value]) => {
    const row = normalizePlayerDirectoryRow(id, value);
    return row.identityStatus === 'valid' && row.providerPlayerId === id && row.position === position
      && row.fantasyPositions?.length === 1 && row.fantasyPositions[0] === position;
  }).map(([id]) => id).sort());
  assert(byPosition.every(ids => ids.length >= 40), 'Complete catalog lacks forty qualified IDs per selected position.');
  const mapping = Array.from({ length: 160 }, (_, index) => byPosition[index % 4][Math.floor(index / 4)]);
  const sourceBindings = createStorageSourceDataset(mapping).flatMap(league => [readerDigest(league.payload), ...league.versions.map(readerDigest)]);
  const bound = { kind: 'data-cp28-fixture-v1' as const, ...metadata, rawSha256: createHash('sha256').update(raw).digest('hex'),
    rawBytes: Buffer.byteLength(raw), entryCount: entries.length, mapping, sourceBindings };
  return { ...bound, fixtureDigest: readerDigest(bound) };
}
export async function loadStorageFixture(repositoryRoot: string) {
  const path = join(repositoryRoot, 'docs/aggregator-backend/data-backend-cp28-measurement-fixture.json');
  const stat = await lstat(path); assert(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 64 * 1024);
  const manifest: StorageFixtureManifest = JSON.parse(await readFile(path, 'utf8'));
  assert(/^test-results\/cp28-fixture\/[a-zA-Z0-9._-]+\.json$/u.test(manifest.rawCatalogPath));
  const { packagedCatalog, ...sourceManifest } = manifest;
  let raw: string;
  if (Object.hasOwn(manifest, 'packagedCatalog')) {
    assert(packagedCatalog && typeof packagedCatalog === 'object' && !Array.isArray(packagedCatalog));
    assert.deepEqual(Object.keys(packagedCatalog).sort(), ['bytes','path','sha256']);
    assert.equal(packagedCatalog.path, STORAGE_PACKAGED_CATALOG_PATH);
    assert(typeof packagedCatalog.sha256 === 'string' && /^[a-f0-9]{64}$/u.test(packagedCatalog.sha256));
    assert(Number.isSafeInteger(packagedCatalog.bytes) && packagedCatalog.bytes > 0 && packagedCatalog.bytes <= STORAGE_MEASUREMENT_LIMITS.packagedBytes);
    assert(Number.isSafeInteger(manifest.rawBytes) && manifest.rawBytes > 0 && manifest.rawBytes <= STORAGE_MEASUREMENT_LIMITS.rawBytes);
    assert(typeof manifest.rawSha256 === 'string' && /^[a-f0-9]{64}$/u.test(manifest.rawSha256));
    const packagePath = join(repositoryRoot, packagedCatalog.path), packageStat = await lstat(packagePath);
    assert(packageStat.isFile() && !packageStat.isSymbolicLink() && packageStat.size === packagedCatalog.bytes);
    const compressed = await readFile(packagePath); assert.equal(compressed.byteLength, packagedCatalog.bytes);
    assert.equal(createHash('sha256').update(compressed).digest('hex'), packagedCatalog.sha256, 'Frozen compressed catalog bytes changed.');
    // The native output cap applies before UTF-8 decoding, parsing, or catalog normalization.
    const decoded = gunzipSync(compressed, { maxOutputLength: STORAGE_MEASUREMENT_LIMITS.rawBytes });
    assert.equal(decoded.byteLength, manifest.rawBytes); assert.equal(createHash('sha256').update(decoded).digest('hex'), manifest.rawSha256);
    raw = new TextDecoder('utf-8', { fatal: true }).decode(decoded);
  } else {
    const rawPath = join(repositoryRoot, manifest.rawCatalogPath), rawStat = await lstat(rawPath);
    assert(rawStat.isFile() && !rawStat.isSymbolicLink() && rawStat.size > 0 && rawStat.size <= STORAGE_MEASUREMENT_LIMITS.rawBytes);
    raw = await readFile(rawPath, 'utf8');
  }
  assert.deepEqual(sourceManifest, await bindStorageFixture(raw, { rawCatalogPath: manifest.rawCatalogPath, capturedAt: manifest.capturedAt, provenance: manifest.provenance }), 'Frozen catalog or native fixture binding changed.');
  return { manifest, raw, source: createStorageSourceDataset(manifest.mapping) };
}

type StorageAdministration = import('../lib/league-administration/store-contracts').LeagueAdministrationStore;
type StorageIntake = import('../lib/league-administration/public-intake-contracts').PublicIntakeStore;
/** Exact same-request persistence replay, before the original checkpoint acknowledgement. */
export function storageReplayBoundary(administration: StorageAdministration, intake: StorageIntake, input: {
  requestId: string; audit: () => Promise<unknown>; completed: (proof: { requestId: string; tupleDigests: string[]; stateDigest: string }) => void;
}) {
  const writes: { args: Parameters<StorageAdministration['recordObservation']>; result: Awaited<ReturnType<StorageAdministration['recordObservation']>>; digest: string }[] = [];
  const original = administration.recordObservation.bind(administration), complete = intake.completeCore.bind(intake);
  let acknowledged = false;
  const identity = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(identity);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !['status', 'reason'].includes(key)).map(([key, item]) => [key, identity(item)]));
    return value;
  };
  const successful = (result: Awaited<ReturnType<StorageAdministration['recordObservation']>>) => {
    assert(['changed','unchanged','replayed'].includes(result.status), 'CP28 replay writer did not succeed.');
    for (const key of ['leagueSettingsAcceptance','rosterAcceptance','teamManagerAcceptance','teamManagerEvidenceAcceptance'] as const)
      if (result[key]) assert.equal(result[key]!.status, 'accepted', 'CP28 replay typed acceptance was not accepted.');
  };
  return { administration: { ...administration, recordObservation: async (...args: Parameters<StorageAdministration['recordObservation']>) => {
    assert(!acknowledged && writes.length < 2); assert.equal(args[0].envelope.family, writes.length === 0 ? 'league' : 'rosters');
    const digest = readerDigest(args), result = await original(...args); assert.equal(readerDigest(args), digest);
    successful(result); writes.push({ args, result, digest }); return result;
  } }, intake: { ...intake, completeCore: async (...args: Parameters<StorageIntake['completeCore']>) => {
    assert(!acknowledged && writes.length === 2); assert.equal(args[0].kind, 'core'); assert.equal(args[0].requestId, input.requestId);
    const fence = args[3]; assert(writes.every(write => readerDigest(write.args[1]) === readerDigest(fence)));
    assert(Date.now() < Date.parse(fence.deadlineAt), 'Replay original fence expired.');
    const before = await input.audit();
    for (const write of writes) {
      assert.equal(readerDigest(write.args), write.digest); assert(Date.now() < Date.parse(fence.deadlineAt));
      const replayed = await original(...write.args); successful(replayed); assert.deepEqual(identity(replayed), identity(write.result));
    }
    const after = await input.audit(); assert.deepEqual(after, before, 'Replay changed retained state.');
    assert(Date.now() < Date.parse(fence.deadlineAt)); acknowledged = true;
    await complete(...args);
    input.completed({ requestId: input.requestId, tupleDigests: writes.map(write => write.digest), stateDigest: readerDigest(after) });
  } } };
}
export type StorageMeasurementEvidence = { kind: 'data-cp28-storage-evidence-v1'; profile: typeof STORAGE_MEASUREMENT_PROFILE;
  gitSha: string; contextDigest: string; fixtureDigest: string; runId: string; state: 'running' | 'passed' | 'failed';
  startedAt: string; endedAt: string | null; serverVersion: string; runtimeLogin: string; fixtureResponses: number; responseBytes: number;
  statements: number; snapshotCleanupStatements: number; resourceReads: number; catalogPages: number; catalogDigest: string | null;
  captures: { requestId: string; league: number; correction: number; held: number; receipts: string[]; resultDigest: string; elapsedMs: number }[];
  replays: { requestId: string; tupleDigests: string[]; stateDigest: string }[];
  phases: StoragePhaseEvidence[]; deltas?: ReturnType<typeof storagePhaseDeltas>;
  failure: ReaderFailureDiagnostic | null; cleanupComplete: boolean;
  limitations: readonly string[] };
export const STORAGE_LIMITATIONS = Object.freeze(['No SQL qualification until separately authorized execution.',
  'CP26 STOPPED / INCOMPLETE; CP27 DEFERRED / UNQUALIFIED.',
  'Cloud billing, history and transfer are not hard-capped by this test; no paid execution authorized.',
  'Test statement count excludes supervisor/migration/cleanup statements; backend session maximum is unproved.',
  'Allocation threshold is observed after a phase, not a guaranteed worst-case preallocation quota.',
  'One large catalog row still uses existing PostgreSQL JSONB row hashing; 0.25-CU fit is unproved.',
  'Short finite differences do not establish retention, capacity, elapsed recurrence or restore qualification.']);
export async function assertCompleteStorageMeasurementEvidence(value: StorageMeasurementEvidence, binding: QualificationBinding) {
  assert.equal(value.kind, 'data-cp28-storage-evidence-v1'); assert.equal(value.profile, STORAGE_MEASUREMENT_PROFILE);
  assert.equal(binding.context.profile, STORAGE_MEASUREMENT_PROFILE); assert.equal(value.contextDigest, readerDigest(binding.context));
  assert.equal(value.gitSha, binding.context.gitSha); assert.equal(value.runId, binding.context.runId);
  assert.equal(value.state, 'passed'); assert.equal(value.failure, null); assert(value.cleanupComplete);
  assert.equal(value.runtimeLogin, 'league_one_runtime'); assert(value.serverVersion.length > 0);
  const manifest: StorageFixtureManifest = JSON.parse(await readFile(fileURLToPath(new URL('../../../docs/aggregator-backend/data-backend-cp28-measurement-fixture.json', import.meta.url)), 'utf8'));
  assert.equal(value.fixtureDigest, manifest.fixtureDigest);
  assert(/^[a-f0-9]{64}$/u.test(value.fixtureDigest)); assert(/^[a-f0-9]{64}$/u.test(value.catalogDigest ?? ''));
  for (const counter of [value.fixtureResponses,value.responseBytes,value.statements,value.snapshotCleanupStatements,value.resourceReads,value.catalogPages]) assert(typeof counter === 'number' && Number.isSafeInteger(counter) && counter >= 0);
  assert.equal(value.fixtureResponses, 85); assert(value.responseBytes > 0 && value.responseBytes <= STORAGE_MEASUREMENT_LIMITS.responseBytes);
  assert(value.statements > 0 && value.statements <= STORAGE_MEASUREMENT_LIMITS.statements);
  assert(value.resourceReads > 0 && value.resourceReads <= STORAGE_MEASUREMENT_LIMITS.readers);
  assert(value.catalogPages > 0 && value.catalogPages <= STORAGE_MEASUREMENT_LIMITS.catalogPages);
  assert.equal(value.captures.length, 42); assert.equal(new Set(value.captures.map(row => row.requestId)).size, 42);
  assert.equal(new Set(value.captures.flatMap(row => row.receipts)).size, 168);
  assert.equal(value.captures.reduce((sum, row) => sum + row.held, 0), 6714);
  for (const league of [0, 1]) {
    const captures = value.captures.filter(row => row.league === league); assert.equal(captures.length, 21);
    assert.deepEqual(captures.map(row => row.correction), [...Array<number>(17).fill(0), 1, 2, 3, 4]);
    for (const row of captures) { assert.equal(row.held, row.correction < 2 ? 160 : 159); assert.equal(row.receipts.length, 4); assert(typeof row.elapsedMs === 'number' && Number.isFinite(row.elapsedMs) && row.elapsedMs >= 0 && row.elapsedMs <= 20_000); }
  }
  assert.equal(value.replays.length, 2); assert.equal(new Set(value.replays.map(row => row.requestId)).size, 2);
  for (const replay of value.replays) { assert(value.captures.some(row => row.requestId === replay.requestId && row.correction === 4)); assert.equal(replay.tupleDigests.length, 2); }
  assertStoragePhaseEvidence(value.phases);
  assert.deepEqual(value.deltas, storagePhaseDeltas(value.phases));
  assert.equal(value.resourceReads, 172); assert.equal(value.catalogPages, Math.ceil(manifest.entryCount / 200)); assert.equal(value.snapshotCleanupStatements, 17);
  const sequence = [{league:0,correction:0},{league:1,correction:0},...([0,1].flatMap(league=>Array.from({length:16},()=>({league,correction:0})))),...Array.from({length:4},(_,index)=>index+1).flatMap(correction=>[0,1].map(league=>({league,correction})))];
  assert.deepEqual(value.captures.map(({league,correction})=>({league,correction})),sequence);
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
  for (const capture of value.captures) { assert(uuid.test(capture.requestId)); assert(capture.receipts.every(id=>uuid.test(id))); assert(/^[0-9a-f]{64}$/u.test(capture.resultDigest)); }
  for (const replay of value.replays) assert([...replay.tupleDigests,replay.stateDigest].every(digest=>/^[0-9a-f]{64}$/u.test(digest)));
  const finalCounts = new Map(value.phases[16].relations.map(row=>[row.table,row.rows]));
  for (const [table,count] of Object.entries({league_roster_resource_attempts:168,league_roster_capture_receipts:168,league_roster_resource_acceptances:168,league_roster_player_link_receipts:42,league_roster_player_links:6714,league_official_standings_contents:10,league_official_standings_teams:200,league_official_standings_captures:42,league_administration_contents:12,league_administration_observations:12,league_administration_team_entries:200,league_administration_manager_entries:0,league_team_manager_entries:400,league_administration_memberships:208,league_team_manager_memberships:416,league_roster_resource_scopes:8,league_roster_resource_heads:8,league_season_teams:40,league_source_manager_accounts:42,scoring_entities:160,external_scoring_entity_ids:160,league_player_directory_entries:manifest.entryCount,public_data_intakes:42,public_data_identity_observations:42,public_data_league_lists:42,public_data_league_candidates:42,public_data_dispatches:42,public_data_dispatch_outcomes:42,projection_jobs:1,public_data_collection_reservations:0})) assert.equal(finalCounts.get(table),count,table);
  for (const suffix of ['heads','attempts','contents','captures','source_slices','versions']) assert.equal(finalCounts.get('league_player_directory_'+suffix),1);
  assert.deepEqual(value.phases.map(phase => phase.name), STORAGE_PHASES);
  assert.equal(value.phases[15].digest, value.phases[16].digest); assert.deepEqual(value.limitations, STORAGE_LIMITATIONS);
  assert(Number.isFinite(Date.parse(value.startedAt)) && value.endedAt !== null && Date.parse(value.endedAt) >= Date.parse(value.startedAt));
  assert(Date.parse(value.endedAt!) - Date.parse(value.startedAt) <= 1_800_000);
  assert(Buffer.byteLength(JSON.stringify(value)) <= STORAGE_MEASUREMENT_LIMITS.evidenceBytes);
}
export async function writeStorageMeasurementEvidence(value: StorageMeasurementEvidence, binding: QualificationBinding) {
  value.deltas = storagePhaseDeltas(value.phases);
  const text = JSON.stringify(value) + '\n'; assert(Buffer.byteLength(text) <= STORAGE_MEASUREMENT_LIMITS.evidenceBytes);
  const path = join(binding.directory, STORAGE_MEASUREMENT_EVIDENCE_FILE); await writeFile(path, text, { flag: 'wx', mode: 0o600 });
  assert.equal(await readFile(path, 'utf8'), text);
}

/** Adjacent finite differences only: DATA, shared catalog and synthetic controls remain separate. */
export function storagePhaseDeltas(phases: readonly StoragePhaseEvidence[]) {
  const units=[0,1,0,1,0,1,16,16,1,1,1,1,1,1,1,1,0];
  return phases.slice(1).map((after,index)=>{
    const before=phases[index];const groups=Object.fromEntries(['per-league','shared','controls','non-data'].map(group=>{
      const sum=(phase:StoragePhaseEvidence,key:'rows'|'tupleBytes'|'jsonBytes'|'totalBytes')=>phase.relations.filter(row=>row.group===group).reduce((total,row)=>total+row[key],0);
      return[group,{rows:sum(after,'rows')-sum(before,'rows'),tupleBytes:sum(after,'tupleBytes')-sum(before,'tupleBytes'),jsonBytes:sum(after,'jsonBytes')-sum(before,'jsonBytes'),allocatedBytes:sum(after,'totalBytes')-sum(before,'totalBytes')}];
    }));
    const allocatedBytes=after.allocatedBytes-before.allocatedBytes;assert.equal(Object.values(groups).reduce((sum,group)=>sum+group.allocatedBytes,0),allocatedBytes);
    const captures=units[index+1],dataBytes=groups['per-league'].allocatedBytes+groups.shared.allocatedBytes;
    return{before:before.name,after:after.name,unit:index===0?'shared-catalog':captures?'fresh-core':'no-capture',captures,groups,allocatedBytes,
      dataAllocatedBytes:dataBytes,meanDataAllocatedBytesPerCapture:captures?dataBytes/captures:null};
  });
}
export function assertStoragePhaseEvidence(phases: readonly StoragePhaseEvidence[]) {
  assert.deepEqual(phases.map(phase=>phase.name),STORAGE_PHASES);
  const initial=phases[0];const nonnegative=(value:unknown)=>assert(typeof value==='number'&&Number.isSafeInteger(value)&&value>=0);
  for(const phase of phases){assert(/^[0-9a-f]{64}$/u.test(phase.digest));assert.equal(phase.metadataDigest,initial.metadataDigest);
    assert.equal(phase.relations.length,STORAGE_RELATIONS.length);
    assert.deepEqual(phase.relations.map(row=>({schema:row.schema,table:row.table,migration:row.migration,group:row.group,immutable:row.immutable})),STORAGE_RELATIONS);
    for(const [index,row] of phase.relations.entries()){
      for(const key of ['oid','rows','totalBytes','tableBytes','indexBytes','heapMainBytes','heapFsmBytes','heapVmBytes','heapInitBytes','toastAndAuxBytes','tupleBytes','jsonBytes'] as const)nonnegative(row[key]);
      assert(row.rows<=200_000);assert(/^[0-9a-f]{32}$/u.test(row.digest));assert(row.owner.length>0&&row.owner.length<=63);
      assert(Array.isArray(row.dependencies)&&row.dependencies.every(value=>typeof value==='string'&&value.length<=128));
      assert.equal(row.totalBytes,row.tableBytes+row.indexBytes);assert.equal(row.tableBytes,row.heapMainBytes+row.heapFsmBytes+row.heapVmBytes+row.heapInitBytes+row.toastAndAuxBytes);
      const original=initial.relations[index];assert.equal(row.oid,original.oid);assert.equal(row.owner,original.owner);assert.deepEqual(row.dependencies,original.dependencies);
      if(row.group==='non-data'){assert.equal(row.digest,original.digest);assert.equal(row.rows,original.rows);}
    }
    assert.equal(phase.digest,readerDigest(phase.relations.map(row=>({table:row.schema+'.'+row.table,rows:row.rows,digest:row.digest}))));
    nonnegative(phase.allocatedBytes);nonnegative(phase.databaseBytes);nonnegative(phase.totalRows);
    assert.equal(phase.allocatedBytes,phase.relations.reduce((sum,row)=>sum+row.totalBytes,0));assert(phase.allocatedBytes<STORAGE_MEASUREMENT_LIMITS.allocationBytes);
    assert.equal(phase.totalRows,phase.relations.reduce((sum,row)=>sum+row.rows,0));assert(phase.totalRows<=1_000_000);
    assert(Number.isFinite(phase.elapsedMs)&&phase.elapsedMs>=0&&phase.elapsedMs<=STORAGE_MEASUREMENT_LIMITS.snapshotMs);
  }
  const metadata=initial.relations.map(row=>{assert(row.metadata?.kind==='r');for(const list of [row.metadata.columns,row.metadata.constraints,row.metadata.indexes])assert(Array.isArray(list)&&list.every(value=>typeof value==='string'&&value.length<20_000));
    return{schemaname:row.schema,tablename:row.table,oid:String(row.oid),relkind:row.metadata.kind,owner:row.owner,dependencies:row.dependencies,columns:row.metadata.columns,constraints:row.metadata.constraints,indexes:row.metadata.indexes};});
  assert.equal(initial.metadataDigest,readerDigest(metadata));
  const cores=[0,0,0,1,1,2,18,34,35,36,37,38,39,40,41,42,42];
  for(const [index,phase]of phases.entries()){
    const counts=new Map(phase.relations.map(row=>[row.table,row.rows]));
    if(index===0)for(const row of phase.relations)if(row.group!=='non-data')assert.equal(row.rows,0);
    for(const row of phase.relations)if(row.table.startsWith('public_data_')&&!['public_data_intakes','public_data_identity_observations','public_data_league_lists','public_data_league_candidates','public_data_dispatches','public_data_dispatch_outcomes'].includes(row.table))assert.equal(row.rows,0);
    for(const table of ['league_roster_resource_attempts','league_roster_capture_receipts','league_roster_resource_acceptances'])assert.equal(counts.get(table),cores[index]*4);
    for(const table of ['league_roster_player_link_receipts','league_official_standings_captures'])assert.equal(counts.get(table),cores[index]);
  }
}

/** Compact before/after replay proof: selected C4 provenance and typed rows, all touched heads, and scoped growth counters. */
export function storageReplayAuditStatement(receiptIds: readonly string[], observationIds: readonly string[], leagueSeasonId: string) {
  const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u;
  assert.equal(receiptIds.length,4);assert.equal(observationIds.length,2);assert([...receiptIds,...observationIds,leagueSeasonId].every(id=>uuid.test(id)));
  const content='row.content_id IN (SELECT content_id FROM selected_receipts)',season='row.league_season_id=$3::uuid';
  const selections:[string,string][]=[
    ['league_roster_capture_receipts','row.id=ANY($1::uuid[])'],['league_roster_resource_attempts','row.id IN (SELECT attempt_id FROM selected_receipts)'],
    ['league_roster_resource_acceptances','row.receipt_id=ANY($1::uuid[])'],['league_roster_resource_scopes','row.id IN (SELECT scope_id FROM selected_receipts JOIN public.league_roster_resource_attempts attempt ON attempt.id=selected_receipts.attempt_id)'],
    ['league_roster_resource_heads','row.scope_id IN (SELECT scope_id FROM selected_receipts JOIN public.league_roster_resource_attempts attempt ON attempt.id=selected_receipts.attempt_id)'],
    ['league_administration_contents','row.id IN (SELECT content_id FROM selected_receipts)'],['league_administration_observations','row.id=ANY($2::uuid[])'],
    ['league_administration_observation_mappings','row.observation_id=ANY($2::uuid[])'],['league_administration_heads',season],['league_configuration_heads',season],
    ['league_configuration_versions',season],['league_configuration_activations',season],['league_source_mapping_revisions',season],['league_source_connections',season],
    ['league_administration_team_entries',content],['league_administration_manager_entries',content],['league_administration_memberships',content],
    ['league_team_manager_entries',content],['league_team_manager_memberships',content],
    ['league_roster_player_link_receipts','row.roster_receipt_id=ANY($1::uuid[])'],
    ['league_roster_player_links','row.roster_acceptance_id IN (SELECT id FROM public.league_roster_resource_acceptances WHERE receipt_id=ANY($1::uuid[]))'],
    ['league_official_standings_captures','row.receipt_id=ANY($1::uuid[])'],['league_official_standings_contents',content],['league_official_standings_teams',content],
    ['scoring_entities','row.id IN (SELECT canonical_entity_id FROM public.league_roster_player_links WHERE roster_acceptance_id IN (SELECT id FROM public.league_roster_resource_acceptances WHERE receipt_id=ANY($1::uuid[])))'],
    ['external_scoring_entity_ids','row.scoring_entity_id IN (SELECT canonical_entity_id FROM public.league_roster_player_links WHERE roster_acceptance_id IN (SELECT id FROM public.league_roster_resource_acceptances WHERE receipt_id=ANY($1::uuid[])))'],
  ];
  const parts=selections.flatMap(([table,where])=>[
    `SELECT 'count'::text AS kind,'${table}'::text AS relation,count(*)::text AS digest FROM public.${table}`,
    `SELECT 'row'::text AS kind,'${table}'::text AS relation,md5(to_jsonb(row)::text) AS digest FROM public.${table} row WHERE ${where}`]);
  return{sql:'WITH selected_receipts AS MATERIALIZED (SELECT * FROM public.league_roster_capture_receipts WHERE id=ANY($1::uuid[])) SELECT * FROM ('+parts.join(' UNION ALL ')+') proof ORDER BY kind,relation,digest LIMIT 4097',parameters:[receiptIds,observationIds,leagueSeasonId]};
}
