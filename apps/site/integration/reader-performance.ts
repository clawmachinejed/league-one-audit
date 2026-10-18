import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DatabaseClient, DatabaseRow } from '../lib/database';
import type { PublicIntakeReadOptions } from '../lib/league-administration/public-intake-contracts';
import type { QualificationBinding } from './qualification-profile';
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
export type ReaderSample = ReaderSlot & { lane: number; startedMs: number; elapsedMs: number; status: 'passed' | 'failed' | 'unserved';
  failure: 'none' | 'reader-or-correctness' | 'budget-exhausted'; statements: number; rows: number; decodedBytes: number;
  statementMs: number; resultDigest: string | null };
export type QueryMeasurement = { digest: string; sql: string; calls: number; failures: number; rows: number; decodedBytes: number;
  elapsedMs: number; parameters: readonly unknown[] };
export type ReaderPlan = { digest: string; sql: string; parameterDigest: string; explainedRows: number;
  plan: readonly DatabaseRow[] };

/** SELECT-only instrumentation wraps the original client. No row cache or substitute reader. */
export function measuredReaderDatabase(database: DatabaseClient, queries: Map<string, QueryMeasurement>, sample: ReaderSample): DatabaseClient {
  return { enabled: true, async query<Row extends DatabaseRow>(sql: string, parameters: readonly unknown[] = [], options = {}) {
    assert(/^\s*(?:\/\*[\s\S]*?\*\/\s*)?(?:SELECT|WITH)\b/iu.test(sql), 'Benchmark reader issued a non-SELECT statement.');
    assert(!/\b(?:INSERT|UPDATE|DELETE|MERGE|CALL|COPY|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|FOR\s+(?:UPDATE|SHARE))\b/iu.test(sql), 'Benchmark reader attempted a write.');
    const digest = readerDigest(sql);
    let entry = queries.get(digest);
    if (!entry) { assert(queries.size < 150, 'Unexpected reader SQL inventory expansion.');
      entry = { digest, sql, calls: 0, failures: 0, rows: 0, decodedBytes: 0, elapsedMs: 0, parameters: [...parameters] }; queries.set(digest, entry); }
    entry.calls++; sample.statements++;
    const started = performance.now();
    try {
      const rows = await database.query<Row>(sql, parameters, options);
      const bytes = Buffer.byteLength(JSON.stringify(rows));
      entry.rows += rows.length; sample.rows += rows.length; entry.decodedBytes += bytes; sample.decodedBytes += bytes;
      return rows;
    } catch (error) { entry.failures++; throw error; }
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
    rows: 0, decodedBytes: 0, statementMs: 0, resultDigest: null }));
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
      try {
        const result = await input.read(sample, bounded);
        // Timer includes original SQL, installed driver decoding, and full reader composition.
        sample.elapsedMs = performance.now() - start - sample.startedMs;
        sample.resultDigest = input.verify(sample, result); sample.status = 'passed'; sample.failure = 'none';
      } catch { sample.elapsedMs = performance.now() - start - sample.startedMs; sample.status = 'failed'; sample.failure = 'reader-or-correctness'; }
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
  beforeDigest: string | null; afterDigest: string | null; providerRequests: number; blockedFetches: number; cleanupComplete: boolean };
function assertReaderEvidence(value: ReaderPerformanceEvidence, binding: QualificationBinding) {
  assert(Buffer.byteLength(JSON.stringify(value)) <= 4 * 1024 * 1024, 'Reader evidence exceeds fixed budget.');
  assert.equal(value.kind, 'data-reader-performance-evidence-v1'); assert.equal(value.contextDigest, readerDigest(binding.context));
  assert.equal(value.gitSha, binding.context.gitSha); assert.equal(binding.context.profile, READER_PERFORMANCE_PROFILE);
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
    if (sample.status === 'passed') { assert.equal(sample.failure, 'none'); assert.match(sample.resultDigest!, /^[a-f0-9]{64}$/u); assert(sample.statements > 0 && sample.rows > 0); }
  }
  assert.equal(new Set(value.queries.map(query => query.digest)).size, value.queries.length);
  for (const query of value.queries) { assert.equal(query.digest, readerDigest(query.sql)); assert(query.calls > 0);
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
