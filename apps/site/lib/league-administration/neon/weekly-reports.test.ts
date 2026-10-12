import { describe, expect, it, vi } from 'vitest';
import retained from '../../../test-support/fixtures/cp13-live-source-2026/weekly-reports.json';
import type { DatabaseClient, DatabaseRow } from '../../database';
import { WEEKLY_REPORT_POLICY, WEEKLY_REPORT_VERSION, weeklyReportScope, projectWeeklyReport } from '../../aggregator/weekly-reports';
import { normalizeAdministrationObservation } from '../normalize';
import { createLeagueAdministrationStore } from '../store';
import { createLeagueAdministrationMethods } from './administration';
import { ACCEPTED_WEEKLY_REPORT_SQL, readAcceptedWeeklyReportRows, weeklyReportCoverage, weeklyReportMethods } from './weekly-reports';
vi.mock('server-only', () => ({}));
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = '2026-10-12T22:00:00.000Z';
const mapping = { connectionId: id(1), leagueSeasonId: id(2), revisionId: id(3), generation: 1,
  scope: { leagueKey: 'cp13-report', provider: 'sleeper' as const, externalLeagueId: '1395875117568913408', season: 2026 } };
function fixture(index = 0, payload: unknown = retained.observations[index].report.document) {
  const week = retained.observations[index].requestedWeek;
  const normalized = normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1',
    dialect: 'sleeper-nfl-v1', scope: mapping.scope, family: 'weekly_report', week, completeness: 'complete',
    provenance: { origin: 'network', requestStartedAt: at, requestCompletedAt: at, sourceObservedAt: at, checkedAt: at },
    payload: payload as never });
  const projected = projectWeeklyReport(normalized); if (projected.status !== 'accepted') throw Error('Invalid report fixture');
  const row: DatabaseRow = { identity: { scope: weeklyReportScope(mapping, week), policy: WEEKLY_REPORT_POLICY },
    latest_ordinal: 1, head_accepted_id: id(4), head_generation: 1, acceptance_id: id(4), generation: 1,
    source_mapping_revision_id: id(3), receipt_id: id(5), attempt_id: id(6), reserved_attempt_id: id(6),
    legacy_observation_id: id(7), provenance: normalized.envelope.provenance, coverage: weeklyReportCoverage(week),
    configuration_content_id: null, population_evidence: null, expected_team_count: null, ordinal: 1, expected_generation: 0,
    source_mapping: mapping, capture_nonce: id(9), write_fence: null, capture_after_reservation: true,
    content_id: id(8), content_hash: normalized.contentHash, semantic_hash: normalized.semanticHash,
    payload: normalized.envelope.payload, normalized_value: normalized.value, normalizer_version: 'sleeper-administration-v1',
    completeness: 'complete', content_accepted: true, league_season_id: id(2), provider: 'sleeper', external_league_id: mapping.scope.externalLeagueId,
    family: 'weekly_report', week, observation_content_id: id(8), observation_league_season_id: id(2), first_acceptance_content_id: id(8),
    value_header: { content_id: id(8), first_acceptance_id: id(4), value_version: WEEKLY_REPORT_VERSION, native_week: week,
      report_key: projected.value.reportKey, publication: projected.value.publication, native_report_week: projected.value.nativeReportWeek,
      team_count: projected.value.teams.length, limitations: projected.value.limitations }, typed_value: projected.value,
    identities: projected.value.teams.map((team, i) => ({ externalRosterId: team.externalRosterId, seasonTeamId: id(100 + i),
      identityLeagueSeasonId: id(2), identityProvider: 'sleeper', identityExternalLeagueId: mapping.scope.externalLeagueId,
      identityExternalRosterId: team.externalRosterId })) };
  return { normalized, projected, row, selection: { nativeWeek: week } };
}
function database(query: (sql: string, values: readonly unknown[]) => readonly DatabaseRow[]): DatabaseClient {
  return { enabled: true, async query<Row extends DatabaseRow>(sql: string, values: readonly unknown[] = []) { return query(sql, values) as readonly Row[]; } };
}

describe('stored native weekly reports', () => {
  it.each([0, 1])('preserves all 12 retained native rows at report index %s with report-only meaning', index => {
    const f = fixture(index), read = readAcceptedWeeklyReportRows([f.row], mapping, f.selection);
    expect(read).toMatchObject({ status: 'available', selection: 'current', reportReceiptId: id(5), acceptedGeneration: 1,
      historicalApplicability: 'report-only', freshness: 'unknown', value: f.projected.value });
    if (read.status !== 'available') throw Error('Unavailable report');
    expect(read.value.teams).toHaveLength(12);
    expect(read.value.teams.every(team => team.seasonTeamId)).toBe(true);
    expect(read.provenance.sourceObservedAt).toBe(at);
    expect(read.value.metadata.created.value).toBe(retained.observations[index].report.document.data.metadata.created);
    expect(read.value.teams.find(team => team.externalRosterId === '10')?.record.value).toBe(index === 0 ? 'T' : 'TWLW');
    if (!index) expect(read.value.teams.find(team => team.externalRosterId === '10')?.pointsFor.value).toBe('110.19999694824219');
  });
  it.each(['source_mapping', 'identity', 'content_hash', 'semantic_hash', 'normalized_value', 'typed_value', 'source_mapping_revision_id',
    'observation_content_id', 'first_acceptance_content_id', 'coverage', 'expected_generation', 'configuration_content_id',
    'family', 'week', 'attempt_id', 'head_accepted_id', 'head_generation', 'capture_after_reservation'])(
  'rejects substituted %s evidence', key => {
    const f = fixture();
    expect(readAcceptedWeeklyReportRows([{ ...f.row, [key]: 'forged' }], mapping, f.selection).status).toBe('unavailable');
  });
  it('keeps a failed latest observation visible while explicit accepted history is readable', () => {
    const f = fixture();
    expect(readAcceptedWeeklyReportRows([{ ...f.row, receipt_id: null, acceptance_id: null }], mapping, f.selection))
      .toEqual({ status: 'unavailable', reason: 'latest_report_attempt_has_no_capture' });
    expect(readAcceptedWeeklyReportRows([{ ...f.row, acceptance_id: null }], mapping, f.selection))
      .toEqual({ status: 'unavailable', reason: 'report_capture_not_accepted' });
    const older = { ...f.row, latest_ordinal: 3, head_accepted_id: id(40), head_generation: 2 };
    expect(readAcceptedWeeklyReportRows([older], mapping, f.selection).status).toBe('unavailable');
    expect(readAcceptedWeeklyReportRows([older], mapping, { ...f.selection, reportReceiptId: id(5) })).toMatchObject({ status: 'available', selection: 'receipt' });
  });
  it('represents report removal as an accepted unpublished snapshot', () => {
    const f = fixture(0, { data: { metadata: null } });
    expect(readAcceptedWeeklyReportRows([f.row], mapping, f.selection)).toMatchObject({ status: 'available',
      value: { publication: 'unpublished', nativeReportWeek: null, teams: [], metadata: { created: { state: 'absent' } } } });
  });
  it('canonicalizes NUMERIC text without rounding native report points', () => {
    const f = fixture(), value = structuredClone(f.projected.value);
    (value.teams[0].pointsFor as { value: string }).value = '173.5000';
    expect(readAcceptedWeeklyReportRows([{ ...f.row, typed_value: value }], mapping, f.selection).status).toBe('available');
    (value.teams[0].pointsFor as { value: string }).value = '173.5000000001';
    expect(readAcceptedWeeklyReportRows([{ ...f.row, typed_value: value }], mapping, f.selection).status).toBe('unavailable');
  });
  it('rejects foreign or reused canonical team identities', () => {
    const f = fixture();
    const identities = structuredClone(f.row.identities) as Record<string, unknown>[];
    identities[0].identityExternalLeagueId = 'another-league';
    expect(readAcceptedWeeklyReportRows([{ ...f.row, identities }], mapping, f.selection).status).toBe('unavailable');
    identities[0].identityExternalLeagueId = mapping.scope.externalLeagueId; identities[1].seasonTeamId = identities[0].seasonTeamId;
    expect(readAcceptedWeeklyReportRows([{ ...f.row, identities }], mapping, f.selection).status).toBe('unavailable');
  });
  it('requires the report acquisition to bind the exact work, fence, attempt and nonce', () => {
    const f = fixture(), fence = { jobKey: 'league-administration-public-intake', workerId: id(20), generation: 1, deadlineAt: at };
    const witness = { version: 'public-network-capture-v1',
      work: { requestId: id(21), revision: 1, kind: 'weekly-report', externalLeagueId: mapping.scope.externalLeagueId, season: 2026, nativeWeek: 1 },
      fence, mapping, dispatchNonce: id(22), attempts: { weekly_report: { id: id(6), nonce: id(9) } } };
    const row = { ...f.row, write_fence: fence, capture_after_reservation: false,
      provenance: { ...f.normalized.envelope.provenance, acquisition: witness } };
    expect(readAcceptedWeeklyReportRows([row], mapping, f.selection).status).toBe('available');
    for (const invalid of [
      { ...row, capture_nonce: id(90) }, { ...row, write_fence: { ...fence, generation: 2 } },
      { ...row, provenance: { ...row.provenance, acquisition: { ...witness, work: { ...witness.work, nativeWeek: 4 } } } },
      { ...row, provenance: { ...row.provenance, acquisition: { ...witness, attempts: { weekly_report: { id: id(90), nonce: id(9) } } } } },
    ]) expect(readAcceptedWeeklyReportRows([invalid], mapping, f.selection).status).toBe('unavailable');
  });
  it('distinguishes missing captures, missing typed values, wrong week, and database failure', async () => {
    const f = fixture();
    expect(readAcceptedWeeklyReportRows([], mapping, f.selection)).toEqual({ status: 'missing', reason: 'report_capture_missing' });
    expect(readAcceptedWeeklyReportRows([{ ...f.row, value_header: null }], mapping, f.selection)).toEqual({ status: 'missing', reason: 'typed_report_not_recorded' });
    expect(readAcceptedWeeklyReportRows([f.row], mapping, { nativeWeek: 4 }).status).toBe('unavailable');
    expect(readAcceptedWeeklyReportRows([f.row], mapping, { ...f.selection, reportReceiptId: id(99) }).status).toBe('unavailable');
    expect((await weeklyReportMethods(database(() => { throw Error('offline'); })).readAcceptedWeeklyReport(mapping, f.selection)).status).toBe('unavailable');
  });
  it('uses one restricted SELECT and binds current mapping and optional immutable receipt', async () => {
    const f = fixture(), query = vi.fn(() => [f.row]);
    expect((await weeklyReportMethods(database(query)).readAcceptedWeeklyReport(mapping, { ...f.selection, reportReceiptId: id(5) })).status).toBe('available');
    expect(query).toHaveBeenCalledExactlyOnceWith(ACCEPTED_WEEKLY_REPORT_SQL,
      [JSON.stringify({ scope: weeklyReportScope(mapping, 1), policy: WEEKLY_REPORT_POLICY }), id(3), 1, id(5)]);
    expect(ACCEPTED_WEEKLY_REPORT_SQL).not.toMatch(/\b(?:UPDATE|INSERT|DELETE|fetch)\b/u);
  });
  it('reserves exact report scope and rejects malformed reservation identities', async () => {
    const query = vi.fn(() => [{ result: { id: id(6), scopeId: id(10), ordinal: '2', expectedGeneration: '1' } }]);
    const methods = weeklyReportMethods(database(query));
    expect(await methods.beginWeeklyReportAttempt(mapping, 4, id(6))).toEqual({ id: id(6), scopeId: id(10), ordinal: 2, expectedGeneration: 1 });
    await expect(methods.beginWeeklyReportAttempt(mapping, 0, id(6))).rejects.toThrow();
    await expect(methods.beginWeeklyReportAttempt({ ...mapping, scope: { ...mapping.scope, season: 2025 } }, 1, id(6))).rejects.toThrow();
    await expect(weeklyReportMethods(database(() => [{ result: { id: id(90) } }])).beginWeeklyReportAttempt(mapping, 1, id(6))).rejects.toThrow();
    expect(query).toHaveBeenCalledTimes(1);
  });
  it('adds report projection only for its own explicit writer reservation', async () => {
    const f = fixture(), attempt = { id: id(6), scopeId: id(10), ordinal: 1, expectedGeneration: 0 };
    const query = vi.fn((sql: string, values: readonly unknown[]) => {
      expect(sql).toContain('league-administration:record-observation'); expect(values).toHaveLength(1);
      return [{ result: { status: 'changed' } }];
    });
    const methods = createLeagueAdministrationMethods(database(query));
    await methods.recordObservation(f.normalized);
    expect(JSON.parse(String(query.mock.calls[0][1][0]))).not.toHaveProperty('weeklyReportProjection');
    await methods.recordObservation(f.normalized, undefined, mapping, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, { attempt });
    expect(JSON.parse(String(query.mock.calls[1][1][0]))).toMatchObject({ weeklyReportAcceptance: { attempt }, weeklyReportProjection: f.projected });
    expect(await createLeagueAdministrationStore({ enabled: false, reason: 'missing-database-url' }).readAcceptedWeeklyReport!(mapping, f.selection)).toEqual({ status: 'disabled' });
  });
});
