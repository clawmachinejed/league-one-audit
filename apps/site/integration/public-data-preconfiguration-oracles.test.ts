import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { types } from '@neondatabase/serverless';
import ts from 'typescript';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createProjectionStore } from '../lib/projection-store';
import { createLeagueAdministrationStore, createPublicIntakeStore } from '../lib/league-administration/store';
import { recordCapturedAdministration } from '../lib/league-administration/runtime';
import { normalizeAdministrationObservation } from '../lib/league-administration/normalize';
import { readPublicSleeperIntake } from '../lib/league-administration/public-intake-reader';
import { capturePublicSleeperCore } from '../lib/sleeper';
import { LEAGUE_SETTINGS_FIELDS, LEAGUE_SETTINGS_POLICY, leagueSettingsScope } from '../lib/aggregator/league-settings';
import type { DatabaseClient, DatabaseRow } from '../lib/database';
import type { NormalizedAdministrationObservation } from '../lib/league-administration/contracts';
import type { AdministrationSourceMapping } from '../lib/league-administration/source-mapping';
import type { LeagueAdministrationStore } from '../lib/league-administration/store-contracts';
vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }));
afterEach(() => { vi.restoreAllMocks(); });

// Execute the maintained case and assertions, not a copied expected result. SQL
// responses below are driver-shaped boundary fixtures, never PostgreSQL proof.
const suiteName = 'official preconfiguration source normalization to restricted typed storage';
let matrixSource: string, recoverySource: string;
beforeAll(async () => {
  const source = await readFile(new URL('./public-data-intake.integration-case.ts', import.meta.url), 'utf8');
  const tree = ts.createSourceFile('r037.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const cases: ts.Block[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(tree) === 'describe'
      && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === suiteName) {
      const callback = node.arguments[1];
      if (!ts.isArrowFunction(callback) || !ts.isBlock(callback.body)) throw new Error('R037 suite shape changed.');
      for (const statement of callback.body.statements) {
        if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)
          || statement.expression.expression.getText(tree) !== 'it') continue;
        const body = statement.expression.arguments[1];
        if (!ts.isArrowFunction(body) || !ts.isBlock(body.body)) throw new Error('R037 case shape changed.');
        cases.push(body.body);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(tree); expect(cases).toHaveLength(2);
  recoverySource = cases[0].getText(tree).slice(1, -1);
  matrixSource = cases[1].getText(tree).slice(1, -1);
});
function execute(source: string, bindings: Record<string, unknown>): Promise<unknown> {
  return new Function(...Object.keys(bindings), ts.transpile(`return (async () => {${source}})()`,
    { target: ts.ScriptTarget.ES2022 } ))(...Object.values(bindings));
}
const jsonb = <T>(value: T): T => types.getTypeParser(3802)(JSON.stringify(value)) as T;
const bigint = (value: number) => types.getTypeParser(20)(String(value));
const integer = (value: number) => types.getTypeParser(23)(String(value));
const timestamp = () => types.getTypeParser(1184)('2026-10-09 12:00:00.123456+00');
const conflict = 'scoring_profile_change_requires_explicit_compatibility_and_period_review';
function settingsRow(input: NormalizedAdministrationObservation, mapping: AdministrationSourceMapping,
  leagueId: string, generation: number, attemptId: string = randomUUID()): DatabaseRow {
  const contentId = randomUUID();
  return { identity: jsonb({ scope: leagueSettingsScope(mapping), policy: LEAGUE_SETTINGS_POLICY }),
    generation: bigint(generation), ordinal: bigint(generation), source_mapping_revision_id: mapping.revisionId,
    source_mapping: jsonb(mapping), league_id: leagueId, league_season_id: mapping.leagueSeasonId,
    provider: 'sleeper', external_league_id: mapping.scope.externalLeagueId, normalizer_version: input.envelope.normalizerVersion,
    completeness: input.envelope.completeness, receipt_id: randomUUID(), attempt_id: attemptId,
    legacy_observation_id: randomUUID(), provenance: jsonb(input.envelope.provenance), payload: jsonb(input.envelope.payload),
    normalized_value: jsonb(input.value), content_id: contentId, configuration_content_id: contentId,
    content_hash: input.contentHash, semantic_hash: input.semanticHash,
    configuration_version_id: input.status === 'accepted' ? randomUUID() : null,
    population_evidence: null, expected_team_count: null, coverage: jsonb({ periodIds: [], interval: null, entitySet: 'full',
      fields: LEAGUE_SETTINGS_FIELDS, pagination: 'complete', nextCursor: null, completeness: 'complete', reasons: [] }) };
}

async function matrix(fault = '') {
  const leagueId = randomUUID(), seasonId = randomUUID();
  let mapping: AdministrationSourceMapping, current: DatabaseRow, writes = 0, reads = 0, historyReads = 0;
  const receipts: DatabaseRow[] = [];
  const legacyHead = randomUUID(), legacyVersion = randomUUID();
  const query = vi.fn(async (sql: string, parameters: readonly unknown[] = []): Promise<readonly DatabaseRow[]> => {
    if (sql === 'SELECT session_user AS role') return [{ role: 'league_one_runtime' }];
    if (sql.includes('register-league-season-official-data')) {
      expect(parameters.slice(0, 2)).toEqual([null, null]);
      mapping = { connectionId: randomUUID(), leagueSeasonId: seasonId, revisionId: randomUUID(), generation: 1,
        scope: { leagueKey: String(parameters[2]), provider: 'sleeper', externalLeagueId: String(parameters[5]), season: Number(parameters[4]) } };
      return fault === 'registration affected rows' ? [] : [{ league_id: leagueId, league_season_id: seasonId, scoring_profile_id: null }];
    }
    if (sql.includes('read-source-mapping')) return [{ connection_id: mapping.connectionId, league_season_id: seasonId,
      revision_id: mapping.revisionId, mapping_generation: bigint(1), league_key: mapping.scope.leagueKey,
      provider: 'sleeper', external_league_id: mapping.scope.externalLeagueId, season: integer(2194) }];
    if (sql.includes('begin-league-settings')) return [{ result: jsonb({ id: parameters[1], scopeId: randomUUID(), ordinal: writes + 1, expectedGeneration: writes }) }];
    if (sql.includes('record-observation')) {
      const input = JSON.parse(String(parameters[0])) as NormalizedAdministrationObservation & {
        sourceMapping: AdministrationSourceMapping; leagueSettingsAcceptance: { attempt: { id: string } } };
      expect(input.sourceMapping).toEqual(mapping); expect(input.leagueSettings?.status).toBe('complete');
      writes++;
      current = settingsRow(input, mapping, leagueId, writes, input.leagueSettingsAcceptance.attempt.id);
      receipts.push({ id: current.receipt_id, content_id: current.content_id, provenance: current.provenance, recorded_at: timestamp() });
      const invalid = input.status === 'rejected';
      const later = writes === 14;
      const result = { status: invalid || later ? 'rejected' : 'changed', ...(later ? { reason: conflict } : {}),
        observationId: current.legacy_observation_id,
        leagueSettingsAcceptance: { status: 'accepted', receiptId: current.receipt_id, acceptedGeneration: writes } };
      if (fault === 'invalid legacy accepted' && invalid) result.status = 'changed';
      if (fault === 'invalid typed rejected' && invalid) result.leagueSettingsAcceptance.status = 'preserved';
      if (fault === 'later wrong conflict' && later) result.reason = 'unrelated rejection';
      if (fault === 'later legacy accepted' && later) result.status = 'changed';
      return fault === 'writer affected rows' ? [] : [{ result: jsonb(result) }];
    }
    if (sql.includes('read-accepted-league-settings')) {
      reads++;
      const row: Record<string, unknown> = structuredClone(current);
      if (fault === 'invalid configuration version' && writes === 10) row.configuration_version_id = randomUUID();
      if (fault === 'missing receipt') return [];
      if (fault === 'duplicate receipt') return [row, row];
      if (fault === 'corrupt raw content' && writes === 14) row.content_hash = 'corrupt';
      if (fault === 'wrong bigint generation' && writes === 14) row.generation = '9007199254740993';
      return [row];
    }
    if (sql.startsWith('SELECT scoring_profile_id FROM league_seasons')) {
      expect(parameters).toEqual([seasonId]);
      return [{ scoring_profile_id: fault === 'season profile activated' && writes === 14 ? randomUUID() : null }];
    }
    if (sql === 'SELECT id,rules_hash,rules FROM scoring_profiles ORDER BY id') {
      return fault === 'unexpected profile' && writes > 0 ? [{ id: randomUUID(), rules_hash: 'unexpected', rules: {} }] : [];
    }
    if (sql.startsWith('SELECT * FROM league_roster_capture_receipts')) {
      historyReads++;
      const ids = parameters[0] as string[];
      const rows = receipts.filter(row => ids.includes(String(row.id))).map(row => ({ ...structuredClone(row) }));
      if (fault === 'receipt history mutated' && historyReads === 2) rows[0].recorded_at = new Date('2026-10-09T12:00:01.123Z');
      return rows;
    }
    if (sql.startsWith('SELECT id,scoring_profile_id FROM league_configuration_versions')) {
      return [{ id: fault === 'invalid version invented' && writes > 9 ? randomUUID() : legacyVersion, scoring_profile_id: null }];
    }
    if (sql.startsWith('SELECT accepted_observation_id')) {
      return [{ accepted_observation_id: fault === 'legacy head advanced' && writes > 9 ? randomUUID() : legacyHead }];
    }
    if (sql.startsWith('SELECT version.scoring_profile_id')) {
      expect(parameters).toEqual([seasonId, JSON.stringify({ pass_td: 7.037, rec: 0 })]);
      return Array.from({ length: fault === 'missing version' ? 0 : fault === 'duplicate version' ? 2 : 1 }, () => ({ scoring_profile_id: randomUUID() }));
    }
    if (sql.includes('list-season-enrollments')) {
      expect(sql).toContain("membership.evidence<>'public-data-intake-v1'");
      return fault === 'calculation enrollment leaked' ? [{ league_id: leagueId, league_key: mapping.scope.leagueKey,
        name: 'Unexpected enrollment', league_season_id: seasonId, intended_season: 2194, season: 2194,
        provider: 'sleeper', external_league_id: mapping.scope.externalLeagueId, scoring_profile_id: null }] : [];
    }
    throw new Error('Unexpected R037 offline query: ' + sql.slice(0, 80));
  });
  const ownerQuery = vi.fn(async (sql: string, parameters: unknown[]) => {
    expect(sql).toMatch(/^INSERT INTO league_administration_enrollment(s|_seasons)/);
    expect(sql).toContain("'public-data-intake-v1'"); expect(parameters[0]).toBe(leagueId); return [];
  });
  await execute(matrixSource, { connection: { database: { enabled: true, query } }, expect, vi, randomUUID,
    createProjectionStore, createLeagueAdministrationStore, ownerQuery, capturePublicSleeperCore, recordCapturedAdministration });
  expect(ownerQuery).toHaveBeenCalledTimes(2); expect(writes).toBe(14); expect(reads).toBe(14); expect(historyReads).toBe(2);
}

describe('R037 maintained matrix oracles, offline boundary responses', () => {
  it('executes all nine combinations, four invalid fields and later configuration through the real adapters and reader', async () => {
    await matrix();
  });
  it.each(['registration affected rows', 'writer affected rows', 'invalid legacy accepted', 'invalid typed rejected',
    'invalid configuration version', 'later wrong conflict', 'later legacy accepted', 'missing receipt', 'duplicate receipt',
    'corrupt raw content', 'wrong bigint generation', 'season profile activated', 'unexpected profile',
    'receipt history mutated', 'legacy head advanced', 'invalid version invented', 'missing version', 'duplicate version', 'calculation enrollment leaked'])
    ('rejects %s instead of accepting incomplete matrix proof', async fault => { await expect(matrix(fault)).rejects.toThrow(); });
});

function recoveryFixture() {
  const leagueId = randomUUID(), seasonId = randomUUID(), id = randomUUID();
  const native = '4987654321098765432', season = 2193, at = '2026-10-09T12:00:00.123Z';
  const mapping = { connectionId: randomUUID(), leagueSeasonId: seasonId, revisionId: randomUUID(), generation: 1,
    scope: { leagueKey: 'sleeper-' + native, provider: 'sleeper' as const, externalLeagueId: native, season } };
  const payload = { league_id: native, season: String(season), sport: 'nfl', name: 'Fresh unconfigured DATA league', total_rosters: 1, settings: {} };
  const input = normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1',
    dialect: 'sleeper-nfl-v1', scope: mapping.scope, family: 'league', week: null, completeness: 'complete', payload,
    provenance: { origin: 'network', requestStartedAt: at, requestCompletedAt: at, sourceObservedAt: at, checkedAt: at } });
  const row = settingsRow(input, mapping, leagueId, 1);
  const committed = { league_id: leagueId, league_season_id: seasonId, scoring_profile_id: null,
    connection_id: mapping.connectionId, current_mapping_revision_id: mapping.revisionId };
  return { leagueId, seasonId, id, native, season, mapping, payload, input, row, committed };
}
async function recovery(fault = '') {
  const f = recoveryFixture(); let identities = 0, progressIndex = 0;
  const query = vi.fn(async (sql: string): Promise<readonly DatabaseRow[]> => {
    if (sql.includes('public_data_collection_reservations')) return fault === 'missing reservation' ? [] : [{ external_league_id: f.native }];
    if (sql.startsWith('SELECT league_season_id,bootstrap_payload')) return [{ league_season_id: null,
      bootstrap_payload: fault === 'checkpoint already written' ? jsonb(f.payload) : null }];
    if (sql.startsWith('SELECT active,evidence')) return [{ active: fault === 'active enrollment', evidence: 'public-data-intake-v1' }];
    if (sql.startsWith('SELECT * FROM league_period_authorities')) return fault === 'period authority invented' ? [{ league_key: f.mapping.scope.leagueKey }] : [];
    if (sql.startsWith('SELECT count(*)::integer')) return [{ attempts: integer(fault === 'wrong dispatch count' ? 1 : 2), owners: integer(fault === 'same dispatch owner' ? 1 : 2) }];
    if (sql.includes('read-accepted-league-settings')) return [f.row];
    if (sql.includes('read-request')) return [{ id: f.id, seasons: [f.season], external_manager_id: f.native, terminal: true }];
    if (sql.includes('read-lists')) return [{ season: f.season, request_started_at: timestamp(), request_completed_at: timestamp() }];
    if (sql.includes('read-candidates')) return [{ season: f.season, external_league_id: f.native, stage: 'complete', league_season_id: f.seasonId,
      settings_receipt_id: f.row.receipt_id, players_receipt_id: 'players', managers_receipt_id: 'managers', users_observation_id: 'directory',
      directory_capture: { id: randomUUID(), sourceMapping: f.mapping } }];
    if (sql.includes('read-rejections') || sql.includes('list-season-enrollments')) return [];
    throw new Error('Unexpected R037 recovery query: ' + sql.slice(0, 80));
  });
  const database = { enabled: true, query } as unknown as DatabaseClient;
  const administration = { ...createLeagueAdministrationStore(database), readSourceMapping: async () => f.mapping,
    readAcceptedCurrentRoster: async () => ({ status: fault === 'roster unavailable' ? 'unavailable' : 'available', accepted: { observationIds: ['players'] } }),
    readAcceptedTeamManagers: async () => ({ status: 'available', accepted: { observationIds: ['managers'] } }),
    readSource: async () => ({ status: 'available', observationId: 'directory' }) } as unknown as LeagueAdministrationStore;
  const identity = async () => { identities++; return fault === 'missing identity' ? [] : [{ ...f.committed,
    ...(fault === 'configured identity' ? { scoring_profile_id: randomUUID() } : {}),
    ...(fault === 'identity changed on retry' && identities === 2 ? { connection_id: randomUUID() } : {}) }]; };
  const start = recoverySource.indexOf('      const committed = await identity();');
  const end = recoverySource.indexOf('    } finally { fetch.mockRestore(); }', start);
  expect(start).toBeGreaterThan(-1); expect(end).toBeGreaterThan(start);
  await execute(recoverySource.slice(start, end), { database, administration, identity, id: f.id, native: f.native, season: f.season,
    expect, readPublicSleeperIntake, progress: async () => ({ status: 'progress', resource: ['bootstrap', 'core', 'users'][progressIndex++] }) });
  expect(identities).toBe(2);
}
describe('R037 recovery final oracles, offline boundary responses', () => {
  it('executes every post-interruption readback assertion with actual JSON, bigint and timestamptz driver shapes', async () => {
    await recovery();
    expect(typeof bigint(2)).toBe('string'); expect(integer(2)).toBe(2);
    expect(timestamp()).toEqual(new Date('2026-10-09T12:00:00.123Z'));
    expect(jsonb({ pass_td: 7.037, rec: 0 })).toEqual({ pass_td: 7.037, rec: 0 });
  });
  it.each(['missing identity', 'configured identity', 'missing reservation', 'checkpoint already written',
    'identity changed on retry', 'roster unavailable', 'active enrollment', 'period authority invented', 'wrong dispatch count', 'same dispatch owner'])
    ('rejects %s in the maintained recovery assertions', async fault => { await expect(recovery(fault)).rejects.toThrow(); });
  it('interrupts only after the fenced registration commits, then retries the same identity without a second registration', async () => {
    const f = recoveryFixture(); const events: string[] = [];
    let committed = false;
    const query = vi.fn(async (sql: string, parameters: readonly unknown[] = []): Promise<readonly DatabaseRow[]> => {
      if (sql.includes('resolve-registration')) return committed ? [{ league_key: f.mapping.scope.leagueKey, season: f.season,
        league_id: f.leagueId, league_season_id: f.seasonId }] : [];
      if (sql.includes('checkpoint')) { expect(JSON.parse(String(parameters[1]))).toMatchObject({ leagueId: f.leagueId, leagueSeasonId: f.seasonId }); events.push('checkpoint'); return []; }
      throw new Error('Unexpected registration query.');
    });
    const queryAfterLock = vi.fn(async (sql: string, parameters: readonly unknown[], lock: { statement: string; verifyAfter?: { statement: string } }) => {
      expect(sql).toContain('register-league-season-official-data'); expect(parameters.slice(0, 2)).toEqual([null, null]);
      expect(lock.statement).toContain('guard_public_data_intake'); expect(lock.verifyAfter?.statement).toContain('guard_public_data_intake');
      committed = true; events.push('committed');
      return [[], [{ league_id: f.leagueId, league_season_id: f.seasonId, scoring_profile_id: null }]];
    });
    const database = { enabled: true, query, queryAfterLock } as unknown as DatabaseClient;
    const start = recoverySource.indexOf('    if (!database.queryAfterLock)');
    const end = recoverySource.indexOf('    const dependencies =', start);
    expect(start).toBeGreaterThan(-1); expect(end).toBeGreaterThan(start);
    const wrapped = await execute(recoverySource.slice(start, end) + '\nreturn { interruptedDatabase, interrupted: () => interrupted };', { database }) as
      { interruptedDatabase: DatabaseClient; interrupted: () => boolean };
    const work = { requestId: f.id, revision: 2, kind: 'bootstrap' as const, externalLeagueId: f.native, season: f.season };
    const fence = { jobKey: 'public-data-intake', workerId: randomUUID(), generation: 1, deadlineAt: '2193-01-01T00:00:00Z' };
    const capture = { family: 'league' as const, week: null, payload: f.payload, requestStartedAt: '2026-10-08T12:00:00Z', requestCompletedAt: '2026-10-08T12:00:00Z' };
    const intake = createPublicIntakeStore(wrapped.interruptedDatabase);
    await expect(intake.register(work, capture, fence)).rejects.toThrow('canonical identity committed; bootstrap checkpoint not reached');
    expect(wrapped.interrupted()).toBe(true); expect(events).toEqual(['committed']);
    await intake.register(work, capture, fence);
    expect(events).toEqual(['committed', 'checkpoint']); expect(queryAfterLock).toHaveBeenCalledOnce();
  });
});
