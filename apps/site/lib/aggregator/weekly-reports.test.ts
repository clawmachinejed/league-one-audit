import { describe, expect, it } from 'vitest';
import retained from '../../test-support/fixtures/cp13-live-source-2026/weekly-reports.json';
import { normalizeAdministrationObservation } from '../league-administration/normalize';
import type { AdministrationEnvelope, JsonValue } from '../league-administration/contracts';
import { normalizeWeeklyReportEnvelope, projectWeeklyReport, WEEKLY_REPORT_TEAM_LIMIT } from './weekly-reports';

function envelope(index = 0): AdministrationEnvelope {
  const observation = retained.observations[index];
  return { schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1', dialect: 'sleeper-nfl-v1',
    scope: { provider: 'sleeper', leagueKey: 'unrelated-canonical-test-key', externalLeagueId: observation.externalLeagueId, season: 2026 },
    family: 'weekly_report', week: observation.requestedWeek, completeness: 'complete',
    provenance: { origin: 'network', requestStartedAt: observation.report.source.requestStartedAt,
      requestCompletedAt: observation.report.source.requestCompletedAt, sourceObservedAt: observation.report.source.sourceObservedAt,
      checkedAt: observation.report.source.requestCompletedAt }, payload: structuredClone(observation.report.document) };
}
function document(index = 0) { return structuredClone(retained.observations[index].report.document); }
function accepted(input: AdministrationEnvelope) {
  const normalized = normalizeAdministrationObservation(input);
  expect(normalized.status).toBe('accepted');
  const result = projectWeeklyReport(normalized);
  if (result.status !== 'accepted') throw new Error(JSON.stringify(result.diagnostics));
  return { normalized, value: result.value };
}

describe('native weekly report normalization', () => {
  it.each([0, 1])('preserves every native fact and report clock in retained observation %s', index => {
    const input = envelope(index), before = JSON.stringify(input), { value, normalized } = accepted(input);
    const metadata = retained.observations[index].report.document.data.metadata;
    expect(value).toMatchObject({ publication: 'published', season: 2026, nativeWeek: metadata.data.week,
      nativeReportWeek: metadata.data.week, reportKey: metadata.key,
      metadata: { created: { state: 'known', value: metadata.created }, lastUpdated: { state: 'known', value: metadata.last_updated } } });
    expect(value.teams).toHaveLength(12);
    for (const [sourceOrdinal, native] of metadata.data.standings.entries()) {
      const team = value.teams[sourceOrdinal], prefix = `data.metadata.data.standings[${sourceOrdinal}]`;
      expect(team).toMatchObject({ externalRosterId: String(native.roster_id), sourceOrdinal });
      for (const key of ['round', 'record', 'streak', 'wins', 'losses', 'ties'] as const) {
        expect(team[key]).toEqual({ state: 'known', value: native[key], sourcePath: `${prefix}.${key}` });
      }
      expect(team.providerRank).toEqual({ state: 'known', value: native.rank, sourcePath: `${prefix}.rank` });
      expect(team.pointsFor).toEqual({ state: 'known', value: String(native.points), sourcePath: `${prefix}.points` });
      expect(team.pointsAgainst).toEqual({ state: 'known', value: String(native.points_against), sourcePath: `${prefix}.points_against` });
    }
    expect(normalized.envelope.provenance).toEqual(input.provenance);
    expect(Date.parse(input.provenance.sourceObservedAt!)).toBeGreaterThan(metadata.last_updated);
    expect(value).not.toHaveProperty('officialOutcome'); expect(value).not.toHaveProperty('finality');
    expect(value.limitations).toContain('report_population_unproved');
    expect(JSON.stringify(input)).toBe(before);
  });

  it('retains supplied tie records and cumulative strings without score or week indexing', () => {
    const first = accepted(envelope()).value, fourth = accepted(envelope(1)).value;
    for (const rosterId of ['10', '12']) {
      const weekOne = first.teams.find(team => team.externalRosterId === rosterId)!;
      const weekFour = fourth.teams.find(team => team.externalRosterId === rosterId)!;
      expect(weekOne.record.value).toBe('T'); expect(weekFour.record.value).toBe('TWLW');
      expect(weekOne.pointsFor.value).toBe('110.19999694824219');
      expect(weekOne.pointsFor.value).not.toBe('110.2');
      expect(weekFour.wins.value).toBe(2); expect(weekFour.losses.value).toBe(1); expect(weekFour.ties.value).toBe(1);
    }
  });

  it('keeps native round independent and opaque strings untrimmed without count consistency inference', () => {
    const payload = document(); Object.assign(payload.data.metadata.data.standings[0], { round: 17, record: ' W? ', streak: '', wins: 0 });
    const team = accepted({ ...envelope(), payload }).value.teams[0];
    expect(team.round.value).toBe(17); expect(team.record.value).toBe(' W? '); expect(team.streak.value).toBe(''); expect(team.wins.value).toBe(0);
  });

  it('isolates optional missing, null and invalid facts while retaining useful source values', () => {
    const payload = document() as unknown as { data: { metadata: { created?: JsonValue; last_updated?: JsonValue; data: { standings: Record<string, JsonValue>[] } } } };
    delete payload.data.metadata.created; payload.data.metadata.last_updated = null;
    const row = payload.data.metadata.data.standings[0]; delete row.rank; row.record = null; row.streak = 3;
    row.round = -1; row.points = -2.375; row.points_against = '3.2'; row.wins = 0; row.losses = null; row.ties = 0.5;
    const value = accepted({ ...envelope(), payload: payload as JsonValue }).value, team = value.teams[0];
    expect(value.metadata.created.state).toBe('absent'); expect(value.metadata.lastUpdated.state).toBe('null');
    expect(team.providerRank.state).toBe('absent'); expect(team.record.state).toBe('null'); expect(team.streak.state).toBe('invalid');
    expect(team.round.state).toBe('invalid'); expect(team.pointsFor.value).toBe('-2.375'); expect(team.pointsAgainst.state).toBe('invalid');
    expect(team.wins).toMatchObject({ state: 'known', value: 0 }); expect(team.losses.state).toBe('null'); expect(team.ties.state).toBe('invalid');
  });

  it('preserves explicit unpublished observations separately from an empty published report', () => {
    const unpublished = accepted({ ...envelope(), payload: { data: { metadata: null } } }).value;
    expect(unpublished).toMatchObject({ publication: 'unpublished', nativeWeek: 1, nativeReportWeek: null,
      reportKey: '1395875117568913408_1', teams: [], metadata: { created: { state: 'absent' }, lastUpdated: { state: 'absent' } } });
    const payload = document(); payload.data.metadata.data.standings = [];
    expect(accepted({ ...envelope(), payload }).value).toMatchObject({ publication: 'published', nativeReportWeek: 1, teams: [] });
  });

  it.each([
    { errors: [{ message: 'partial failure' }], data: document().data }, { errors: null, data: document().data },
    { errors: {}, data: document().data }, { data: null }, { data: {} }, {},
  ] as JsonValue[])('rejects missing or partially failed GraphQL evidence %j', payload => {
    expect(normalizeAdministrationObservation({ ...envelope(), payload }).status).toBe('rejected');
  });

  it('allows an explicitly empty GraphQL errors array without changing facts', () => {
    expect(accepted({ ...envelope(), payload: { ...document(), errors: [] } }).value).toEqual(accepted(envelope()).value);
  });

  it.each(['key', 'type', 'week', 'roster', 'duplicate', 'standings'] as const)('rejects wrong report identity or structure: %s', field => {
    const payload = document() as unknown as { data: { metadata: Record<string, JsonValue> } };
    const metadata = payload.data.metadata, data = metadata.data as Record<string, JsonValue>, rows = data.standings as Record<string, JsonValue>[];
    if (field === 'key') metadata.key = '1395875117568913408_2';
    if (field === 'type') metadata.type = 'another_report';
    if (field === 'week') data.week = 2;
    if (field === 'roster') rows[0].roster_id = '11';
    if (field === 'duplicate') rows[1].roster_id = rows[0].roster_id;
    if (field === 'standings') data.standings = null;
    expect(normalizeAdministrationObservation({ ...envelope(), payload: payload as JsonValue }).status).toBe('rejected');
  });

  it.each([0, 19, 1.5, null])('rejects out-of-scope native week %s', week => {
    expect(normalizeAdministrationObservation({ ...envelope(), week }).status).toBe('rejected');
  });

  it('rejects other seasons and partial envelopes', () => {
    expect(normalizeAdministrationObservation({ ...envelope(), scope: { ...envelope().scope, season: 2025 } }).status).toBe('rejected');
    expect(normalizeAdministrationObservation({ ...envelope(), completeness: 'partial' }).status).toBe('rejected');
  });

  it('enforces the declared report row and byte limits without truncating', () => {
    const payload = document(); const native = payload.data.metadata.data.standings[0];
    payload.data.metadata.data.standings = Array.from({ length: WEEKLY_REPORT_TEAM_LIMIT }, (_, index) => ({ ...native, roster_id: index + 1 }));
    expect(accepted({ ...envelope(), payload }).value.teams).toHaveLength(WEEKLY_REPORT_TEAM_LIMIT);
    payload.data.metadata.data.standings.push({ ...native, roster_id: 21 });
    expect(normalizeWeeklyReportEnvelope({ ...envelope(), payload })).toMatchObject({ status: 'rejected', diagnostics: [{ code: 'weekly_report_team_limit' }] });
    const oversized = document(); oversized.data.metadata.data.standings[0].record = 'a'.repeat(1024 * 1024);
    expect(normalizeWeeklyReportEnvelope({ ...envelope(), payload: oversized })).toMatchObject({ status: 'rejected', diagnostics: [{ code: 'weekly_report_value_limit' }] });
    expect(normalizeWeeklyReportEnvelope({ ...envelope(), payload: { ...document(), extra: 'a'.repeat(8 * 1024 * 1024) } }))
      .toMatchObject({ status: 'rejected', diagnostics: [{ code: 'weekly_report_payload_limit' }] });
  });

  it('retains equal-timestamp corrections and unknown payload changes as material content', () => {
    const original = accepted(envelope()), payload = document(); payload.data.metadata.data.standings[0].points += 1;
    const changed = accepted({ ...envelope(), payload });
    expect(changed.value.metadata).toEqual(original.value.metadata);
    expect(changed.normalized.contentHash).not.toBe(original.normalized.contentHash);
    expect(changed.normalized.semanticHash).not.toBe(original.normalized.semanticHash);
    const extended = accepted({ ...envelope(), payload: { ...document(), extension: 'new-native-fact' } });
    expect(extended.normalized.semanticHash).not.toBe(original.normalized.semanticHash);
    expect(extended.value).toEqual(original.value);
  });

  it('rejects forged normalized values and hashes without mutating valid source', () => {
    const normalized = normalizeAdministrationObservation(envelope());
    expect(projectWeeklyReport({ ...normalized, contentHash: 'forged' }).status).toBe('rejected');
    expect(projectWeeklyReport({ ...normalized, semanticHash: 'forged' }).status).toBe('rejected');
    if (normalized.value?.family !== 'weekly_report') throw new Error('Missing report');
    expect(projectWeeklyReport({ ...normalized, value: { family: 'weekly_report', report: { ...normalized.value.report, teams: [] } } }).status).toBe('rejected');
    expect(projectWeeklyReport(normalized).status).toBe('accepted');
  });
});
