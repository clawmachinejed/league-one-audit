import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { EXACT_MATCHUPS_POLICY, exactMatchupsScope } from '../lib/aggregator/exact-matchups';
import { normalizeAdministrationObservation } from '../lib/league-administration/normalize';
import { readAcceptedExactMatchupsRows } from '../lib/league-administration/neon/exact-matchups';
import { readPublicSleeperIntake } from '../lib/league-administration/public-intake-reader';
import { createLeagueAdministrationStore } from '../lib/league-administration/store';
import type { AdministrationEnvelope, CapturedAdministrationDocument, JsonValue, PublicCaptureWitness } from '../lib/league-administration/contracts';
import type { AdministrationSourceMapping } from '../lib/league-administration/source-mapping';
import type { LeagueAdministrationStore } from '../lib/league-administration/store-contracts';
import type { DatabaseClient, DatabaseRow } from '../lib/database';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }));
afterEach(() => vi.restoreAllMocks());

// Execute the maintained SQL-case oracle and fixture factory without importing
// that integration module or its harness. Only query result rows are simulated;
// normalization, typed evidence validation and the composed reader are real.
let factorySource: string, oracleSource: string;
beforeAll(async () => {
  const source = await readFile(new URL('./public-data-intake.integration-case.ts', import.meta.url), 'utf8');
  const tree = ts.createSourceFile('inventory.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declaration = (name: string) => {
    const matches = tree.statements.filter((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === name);
    expect(matches).toHaveLength(1);
    return matches[0].getText(tree);
  };
  factorySource = declaration('inventoryProofFixture'); oracleSource = declaration('assertInventoryPeriods');
});
function compile<T>(source: string, name: string, bindings: Record<string, unknown>): T {
  const compiled = ts.transpile(source + `\nreturn ${name};`, { target: ts.ScriptTarget.ES2022 });
  return new Function(...Object.keys(bindings), compiled)(...Object.values(bindings)) as T;
}
type Fixture = {
  database: DatabaseClient; administration: LeagueAdministrationStore; season: number; native: string; manager: string;
  league: { league_id: string; season: string; total_rosters: number; [key: string]: JsonValue };
  state: { empty: boolean; cycle: number }; requests: string[];
  captures: CapturedAdministrationDocument[]; matchups: (week: number) => Record<string, JsonValue>[];
};
type Oracle = (fixture: Fixture, requestId: string, weeks: readonly number[], status: 'pending' | 'available') => Promise<unknown>;
type Fault = '' | 'missing-week' | 'custom-zero' | 'starter-points' | 'stored-payload' | 'checkpoint-receipt'
  | 'witness-reservation' | 'witness-work' | 'wrong-week' | 'duplicate-task';

function fixture(fault: Fault = '') {
  const requestId = randomUUID(), configurationContent = randomUUID();
  const rows = new Map<number, DatabaseRow>(), lineage = new Map<string, DatabaseRow>();
  const tasks: DatabaseRow[] = [];
  const query = vi.fn(async (sql: string, parameters: readonly unknown[] = []): Promise<readonly DatabaseRow[]> => {
    if (sql.includes('read-request')) return [{ id: requestId, seasons: [f.season], terminal: false,
      external_manager_id: f.manager, selected_exact_periods: [7,8].map(nativeWeek => ({ season: f.season, nativeWeek })) }];
    if (sql.includes('read-lists')) return [{ season: f.season }];
    if (sql.includes('read-candidates')) return [{ season: f.season, external_league_id: f.native,
      name: f.league.name, stage: 'core', league_season_id: mapping.leagueSeasonId }];
    if (sql.includes('read-rejections')) return [];
    if (sql.includes('read-exact-periods')) return tasks;
    if (sql.startsWith('SELECT checkpoint.*')) {
      const task = tasks.find(value => value.native_week === parameters[1]);
      return task ? [{ ...task, ...(fault === 'checkpoint-receipt' ? { matchups_receipt_id: randomUUID() } : {}) }] : [];
    }
    if (sql.startsWith('SELECT receipt.id,receipt.provenance')) {
      const ids = parameters[0] as readonly string[];
      return ids.map(id => ({ ...lineage.get(id), ...(fault === 'witness-reservation' ? { capture_nonce: randomUUID() } : {}),
        ...(fault === 'witness-work' ? { exact_witness: false } : {}) }));
    }
    if (sql.startsWith('SELECT payload FROM public.league_administration_contents')) {
      const row = [...rows.values()].find(value => value.content_id === parameters[0]);
      if (!row) throw new Error('Unknown fixture content identity.');
      const payload = structuredClone(row.payload) as Record<string, JsonValue>[];
      if (fault === 'stored-payload') payload[0].points = 999;
      return [{ payload }];
    }
    throw new Error('Unexpected offline inventory oracle query.');
  });
  const database: DatabaseClient = { enabled: true, query: query as DatabaseClient['query'] };
  const administration = { ...createLeagueAdministrationStore({ enabled: false, reason: 'missing-database-url' }),
    readSourceMapping: vi.fn(async () => mapping),
    readAcceptedExactMatchups: vi.fn(async (selected: AdministrationSourceMapping, week: number) => {
      const row = rows.get(week);
      return readAcceptedExactMatchupsRows(row ? [row] : [], selected, week);
    }) };
  const factory = compile<(client: DatabaseClient) => Fixture>(factorySource, 'inventoryProofFixture', {
    randomUUID, vi, createLeagueAdministrationStore: () => administration,
    createPublicIntakeStore: () => ({}), createProjectionStore: () => ({}),
    capturePublicSleeperIdentity: undefined, capturePublicSleeperLeagueList: undefined, capturePublicSleeperCore: undefined,
  });
  const f = factory(database);
  const mapping: AdministrationSourceMapping = { connectionId: randomUUID(), leagueSeasonId: randomUUID(), revisionId: randomUUID(), generation: 1,
    scope: { leagueKey: `sleeper-${f.native}`, provider: 'sleeper', externalLeagueId: f.native, season: f.season } };
  // Deliberately descend in UUID order while roster order ascends. A copied
  // unsorted grouping expectation must fail, rather than pass by random chance.
  const teams = [{ externalRosterId: '1', seasonTeamId: 'ffffffff-ffff-4fff-8fff-ffffffffffff' },
    { externalRosterId: '2', seasonTeamId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }];
  const baseProvenance = { origin: 'network' as const, requestStartedAt: '2026-10-09T12:00:00.000Z',
    requestCompletedAt: '2026-10-09T12:00:00.001Z', sourceObservedAt: '2026-10-09T12:00:00.001Z', checkedAt: '2026-10-09T12:00:00.002Z' };
  for (const [index, week] of [7,8].entries()) {
    const settingsReceipt = randomUUID(), matchupReceipt = randomUUID(), settingsAttempt = randomUUID(), matchupAttempt = randomUUID();
    const witness: PublicCaptureWitness = { version: 'public-network-capture-v1',
      work: { requestId, revision: index + 3, kind: 'exact-matchups', season: f.season, externalLeagueId: f.native, nativeWeek: week },
      fence: { jobKey: 'league-administration-public-intake', workerId: randomUUID(), generation: index + 1, deadlineAt: '2026-10-09T12:00:20.000Z' },
      dispatchNonce: randomUUID(), mapping,
      attempts: { settings: { id: settingsAttempt, nonce: randomUUID() }, matchups: { id: matchupAttempt, nonce: randomUUID() } } };
    const provenance = { ...baseProvenance, acquisition: witness };
    const league = normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1',
      dialect: 'sleeper-nfl-v1', scope: mapping.scope, family: 'league', week: null, completeness: 'complete', payload: f.league, provenance });
    const payload = f.matchups(week);
    if (week === 7 && fault === 'custom-zero') delete payload[0].custom_points;
    if (week === 7 && fault === 'starter-points') payload[0].starters_points = [999,null];
    const envelope: AdministrationEnvelope = { schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1',
      dialect: 'sleeper-nfl-v1', scope: mapping.scope, family: 'matchups', week, completeness: 'complete', payload, provenance };
    const normalized = normalizeAdministrationObservation(envelope, { expectedRosterCount: 2 });
    expect(normalized.status).toBe('accepted');
    rows.set(week, { identity: { scope: exactMatchupsScope(mapping, week), policy: EXACT_MATCHUPS_POLICY }, generation: 1,
      source_mapping_revision_id: mapping.revisionId, receipt_id: matchupReceipt, attempt_id: matchupAttempt, provenance,
      coverage: { periodIds: [`sleeper:matchup-week:${week}`], interval: null, entitySet: 'full', fields: ['roster_id','matchup_id'],
        pagination: 'complete', nextCursor: null, completeness: 'complete', reasons: [] },
      configuration_content_id: configurationContent, population_evidence: { contentHash: league.contentHash }, expected_team_count: 2,
      legacy_observation_id: randomUUID(), ordinal: 1, source_mapping: mapping, configuration_payload: f.league,
      configuration_hash: league.contentHash, content_id: randomUUID(), content_hash: normalized.contentHash, semantic_hash: normalized.semanticHash,
      payload, normalized_value: normalized.value, normalizer_version: 'sleeper-administration-v1', completeness: 'complete',
      league_season_id: mapping.leagueSeasonId, provider: 'sleeper', external_league_id: f.native, family: 'matchups',
      week: fault === 'wrong-week' && week === 7 ? 8 : week, teams });
    const task = { ordinal: index + 1, season: f.season, external_league_id: f.native, native_week: week,
      status: 'complete', failure_count: 0, reason: null, worker_id: witness.fence.workerId, generation: witness.fence.generation,
      league_season_id: mapping.leagueSeasonId, source_mapping: mapping, settings_receipt_id: settingsReceipt,
      matchups_receipt_id: matchupReceipt, configuration_content_id: configurationContent, settings_provenance: provenance,
      recorded_at: baseProvenance.checkedAt };
    if (fault !== 'missing-week' || week !== 8) tasks.push(task);
    for (const [role, receipt, family, captureWeek] of [
      ['settings',settingsReceipt,'league',null], ['matchups',matchupReceipt,'matchups',week],
    ] as const) {
      lineage.set(receipt, { id: receipt, provenance, capture_nonce: witness.attempts[role].nonce,
        attempt_id: witness.attempts[role].id, after_admission: true, server_window: true, exact_witness: true });
      f.captures.push({ family, week: captureWeek, origin: 'network', payload: family === 'league' ? f.league : payload,
        requestStartedAt: provenance.requestStartedAt, requestCompletedAt: provenance.requestCompletedAt,
        sourceObservedAt: provenance.sourceObservedAt, acquisition: witness });
    }
  }
  if (fault === 'duplicate-task') tasks.push({ ...tasks[0], ordinal: 3 });
  return { f, requestId, query, rows, administration, run: (source = oracleSource) =>
    compile<Oracle>(source, 'assertInventoryPeriods', { expect, readPublicSleeperIntake })(f, requestId, [7,8], 'pending') };
}

describe('maintained public inventory SQL oracle with real normalization and typed readers', () => {
  it('accepts the actual native-period namespace, custom zero, descending team UUIDs and exact receipt lineage', async () => {
    const f = fixture(); await expect(f.run()).resolves.toBeDefined();
    expect(f.f.requests).toEqual([]);
    expect(f.administration.readAcceptedExactMatchups.mock.calls.map(([, week]) => week)).toEqual([7,8,7,8]);
    expect(f.query.mock.calls.some(([sql]) => sql.startsWith('SELECT receipt.id,receipt.provenance'))).toBe(true);
  });
  it('reproduces the former wrong native-period source assertion against the actual typed reader', async () => {
    const f = fixture();
    const tree = ts.createSourceFile('oracle.ts', oracleSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    let previous = '';
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && node.expression.getText(tree) === 'expect(exact.value.period).toEqual') previous = node.getText(tree);
      ts.forEachChild(node, visit);
    };
    visit(tree); expect(previous).not.toBe('');
    const oldOracle = oracleSource.replace(previous, "expect(exact.value.period).toEqual({source:{provider:'sleeper',nativeId:f.native},season:f.season,nativeWeek:week,nflWeekMappings:[]})");
    await expect(f.run(oldOracle)).rejects.toThrow();
  });
  it('reproduces the former unsorted participant oracle with deterministic reverse UUID ordering', async () => {
    const f = fixture();
    const corrected = 'participantTeamIds: exact.value.teams.map(team => team.seasonTeamId).sort()';
    expect(oracleSource).toContain(corrected);
    await expect(f.run(oracleSource.replace(corrected, 'participantTeamIds: exact.value.teams.map(team => team.seasonTeamId)'))).rejects.toThrow();
  });
  it.each<Fault>(['missing-week','custom-zero','starter-points','stored-payload','checkpoint-receipt',
    'witness-reservation','witness-work','wrong-week','duplicate-task'])('rejects corrupted real-oracle evidence: %s', async fault => {
    const f = fixture(fault); await expect(f.run()).rejects.toThrow(); expect(f.f.requests).toEqual([]);
  });
});
