import { describe, expect, it, vi } from 'vitest';
import type { DatabaseClient, DatabaseRow } from '../../../database';
import type { SnapshotSourceHistoryInput } from '../../shared/source-history';
vi.mock('server-only', () => ({}));
import { createSnapshotSourceHistoryReader } from './source-history';
import { createProjectionSourceHistoryReader } from '../../../projection-store';

const uuid = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const request: SnapshotSourceHistoryInput = {
  snapshotId: uuid(1), leagueSeasonId: uuid(2), season: 2026, week: 4, modelVersion: 'clock-v1',
};
const reservedAt = '2026-09-29T12:00:00.000001+00:00';
const startedAt = '2026-09-29T12:00:00.001Z';
const completedAt = '2026-09-29T12:00:01.000Z';
const checkedAt = '2026-09-29T12:00:02.000Z';
const actual = { origin: 'network', requestStartedAt: startedAt, requestCompletedAt: completedAt,
  sourceObservedAt: completedAt, checkedAt };

function association(offset: number, generation = 1) {
  const capture = { id: uuid(offset), connection_id: uuid(3), league_season_id: request.leagueSeasonId,
    source_mapping_revision_id: uuid(offset + 1), week: request.week, reserved_at: reservedAt };
  const revision = { id: capture.source_mapping_revision_id, connection_id: capture.connection_id,
    league_season_id: request.leagueSeasonId, generation, provider: 'sleeper', external_league_id: 'source-league',
    source_namespace: 'nfl:2026' };
  const entries = (['league', 'matchups'] as const).map((family, index) => {
    const content = { id: uuid(offset + 4 + index), league_season_id: request.leagueSeasonId,
      provider: 'sleeper', external_league_id: 'source-league', family, week: family === 'league' ? 0 : request.week,
      content_hash: String(index + 1).repeat(64), configuration_version_id: family === 'league' ? uuid(9) : null,
      normalizer_version: 'sleeper-administration-v1', accepted: true, completeness: 'complete' };
    const legacy_observation = { id: uuid(offset + 6 + index), content_id: content.id,
      league_season_id: request.leagueSeasonId, family, week: content.week, outcome: 'unchanged',
      origin: 'network', request_started_at: startedAt, request_completed_at: completedAt,
      source_observed_at: completedAt, checked_at: checkedAt };
    const input = { id: uuid(offset + 2 + index), capture_id: capture.id, family,
      observation_id: legacy_observation.id, content_id: content.id,
      configuration_version_id: content.configuration_version_id, provenance: { ...actual } };
    return { input, capture: { ...capture }, revision: { ...revision }, content, legacy_observation };
  });
  const observation = { id: uuid(offset + 8), league_season_id: request.leagueSeasonId, provider: 'sleeper',
    week: request.week, quality: 'complete', request_started_at: startedAt, request_completed_at: completedAt,
    observed_at: completedAt, source_data: { leagueKey: 'league1', season: '2026', week: request.week,
      administration: { observationId: entries[0].input.observation_id, configurationVersionId: uuid(9), generation: 7,
        sourceCapture: { captureId: capture.id, leagueInputId: entries[0].input.id, matchupInputId: entries[1].input.id } } } };
  return { observation, entries };
}
function fixture() {
  const original = association(20);
  const verification = association(40, 3);
  return {
    snapshot_id: request.snapshotId, league_season_id: request.leagueSeasonId, season: request.season,
    league_key: 'league1', week: request.week, model_version: request.modelVersion,
    league_week_observation_id: original.observation.id, game_state_observation_ids: [uuid(99), uuid(98)],
    current_snapshot_id: request.snapshotId, verification_source_observation_id: verification.observation.id,
    original_observation: original.observation, verification_observation: verification.observation,
    inputs: [...original.entries, ...verification.entries],
  };
}
function reader(rows: readonly DatabaseRow[]) {
  const query = vi.fn<(statement: string, parameters?: readonly unknown[]) => Promise<readonly DatabaseRow[]>>(async () => rows);
  const client = { enabled: true, query } as DatabaseClient;
  return { query, reader: createSnapshotSourceHistoryReader(client) };
}
async function read(row: DatabaseRow = fixture()) {
  const result = await reader([row]).reader.readSnapshotSourceHistory(request);
  if (result.status !== 'available') throw new Error('Expected source history fixture.');
  return result;
}

describe('exact snapshot calculation input source history', () => {
  it('keeps original and verification captures, mapping revisions and actual source IDs distinct', async () => {
    const row = fixture();
    const { reader: adapter, query } = reader([row]);
    const result = await adapter.readSnapshotSourceHistory(request);
    expect(result).toMatchObject({ status: 'available', purpose: 'calculation-input-source-history', scope: request,
      analyticsCompatibility: 'not_evaluated', original: { leagueWeekObservationId: uuid(28),
        gameStateObservationIds: [uuid(99), uuid(98)], source: { status: 'linked', captureId: uuid(20), reservedAt,
          mapping: { revisionId: uuid(21), generation: 1 },
          leagueInput: { observationId: uuid(26), contentId: uuid(24), configurationVersionId: uuid(9) },
          matchupInput: { observationId: uuid(27), acquisitionSourceEpoch: 'capture_mapping_proved' } } },
      verification: { status: 'current_snapshot', leagueWeekObservationId: uuid(48), source: { status: 'linked',
        mapping: { revisionId: uuid(41), generation: 3 }, leagueInput: { configurationVersionId: uuid(9) } } } });
    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0]).toEqual([expect.stringContaining('season.season=$3'),
      [request.snapshotId, request.leagueSeasonId, request.season, request.week, request.modelVersion]]);
    const sql = String(query.mock.calls[0][0]);
    expect(sql).toContain('current.snapshot_id=snapshot.id');
    expect(sql).toContain("original.source_data#>>'{administration,sourceCapture,leagueInputId}'");
    expect(sql).toContain('WHERE input.id IN (');
    expect(sql).not.toContain('input.id::text');
    expect(sql).not.toMatch(/to_jsonb\((?:original|verification)\)/);
    expect(sql).not.toMatch(/default_season|current_mapping_revision_id|league_administration_heads|ORDER BY/);
    expect(result).not.toHaveProperty('verification.gameStateObservationIds');
  });

  it('does not let linked later verification upgrade an unlinked original snapshot', async () => {
    const row = fixture();
    Reflect.deleteProperty(row.original_observation.source_data.administration, 'sourceCapture');
    const result = await read(row);
    expect(result.original.source).toEqual({ status: 'source_epoch_unproved', reason: 'legacy_unlinked' });
    expect(result.verification.source?.status).toBe('linked');
  });

  it('retains cached configuration consumption while preserving unknown acquisition epoch and age', async () => {
    const row = fixture();
    const provenance = { origin: 'cache', requestStartedAt: '2026-09-28T12:00:00.000Z',
      requestCompletedAt: '2026-09-28T12:00:01.000Z', sourceObservedAt: null, checkedAt };
    const input = row.inputs[0].input as Record<string, unknown>;
    input.provenance = provenance;
    const result = await read(row);
    expect(result.original.source).toMatchObject({ status: 'linked', leagueInput: {
      provenance, acquisitionSourceEpoch: 'source_epoch_unproved',
      legacyObservationProvenance: { origin: 'network', sourceObservedAt: completedAt },
    }, matchupInput: { acquisitionSourceEpoch: 'capture_mapping_proved' } });
  });

  it('preserves actual network input provenance when its v1 observation was reused from an older capture', async () => {
    const row = fixture();
    row.inputs[1].legacy_observation.request_started_at = '2026-09-28T12:00:00.000Z';
    row.inputs[1].legacy_observation.request_completed_at = '2026-09-28T12:00:01.000Z';
    row.inputs[1].legacy_observation.source_observed_at = '2026-09-28T12:00:01.000Z';
    const result = await read(row);
    expect(result.original.source).toMatchObject({ status: 'linked', matchupInput: {
      observationId: row.inputs[1].legacy_observation.id, provenance: actual,
      legacyObservationProvenance: { sourceObservedAt: '2026-09-28T12:00:01.000Z' },
    } });
  });

  it('does not take verification from another current snapshot when reading immutable history', async () => {
    const row = fixture();
    const result = await read({ ...row, current_snapshot_id: null, verification_source_observation_id: null,
      verification_observation: null, inputs: row.inputs.slice(0, 2) });
    expect(result.original.source.status).toBe('linked');
    expect(result.verification).toEqual({ status: 'not_current_snapshot', leagueWeekObservationId: null, source: null });
  });

  it('retains explicit absence of legacy verification linkage on an otherwise current snapshot', async () => {
    const result = await read({ ...fixture(), verification_source_observation_id: null, verification_observation: null });
    expect(result.verification).toEqual({ status: 'current_snapshot', leagueWeekObservationId: null,
      source: { status: 'source_epoch_unproved', reason: 'missing_observation' } });
  });

  it('handles missing observations without fabricating original source history', async () => {
    const result = await read({ ...fixture(), original_observation: null });
    expect(result.original.source).toEqual({ status: 'source_epoch_unproved', reason: 'missing_observation' });
    expect(result.verification.source?.status).toBe('linked');
  });

  it.each([
    ['season', 2025], ['week', 3], ['model_version', 'other-model'], ['league_season_id', uuid(100)],
    ['snapshot_id', uuid(100)], ['current_snapshot_id', uuid(100)],
  ])('refuses a returned row with wrong %s', async (key, value) => {
    expect(await reader([{ ...fixture(), [key]: value }]).reader.readSnapshotSourceHistory(request))
      .toEqual({ status: 'unavailable', reason: 'source_history_unavailable' });
  });

  it.each([
    ['partial content', (row: ReturnType<typeof fixture>) => { row.inputs[0].content.completeness = 'partial'; }],
    ['rejected content', (row: ReturnType<typeof fixture>) => { row.inputs[0].content.accepted = false; }],
    ['another season', (row: ReturnType<typeof fixture>) => { row.inputs[1].content.league_season_id = uuid(100); }],
    ['another week', (row: ReturnType<typeof fixture>) => { row.inputs[1].content.week = 3; }],
    ['another provider source', (row: ReturnType<typeof fixture>) => { row.inputs[1].content.external_league_id = 'other-source'; }],
    ['another revision', (row: ReturnType<typeof fixture>) => { row.inputs[1].revision.id = uuid(100); }],
    ['configuration mismatch', (row: ReturnType<typeof fixture>) => { row.inputs[0].input.configuration_version_id = uuid(100); }],
    ['missing exact input', (row: ReturnType<typeof fixture>) => { row.inputs.splice(1, 1); }],
    ['duplicate input', (row: ReturnType<typeof fixture>) => { row.inputs[1] = row.inputs[0]; }],
    ['wrong official interval', (row: ReturnType<typeof fixture>) => { row.original_observation.request_started_at = completedAt; }],
    ['wrong official observed time', (row: ReturnType<typeof fixture>) => { row.original_observation.observed_at = checkedAt; }],
    ['wrong embedded season', (row: ReturnType<typeof fixture>) => { row.original_observation.source_data.season = '2025'; }],
  ])('marks %s unproved without losing the separate verification association', async (_name, change) => {
    const row = fixture();
    change(row);
    const result = await read(row);
    expect(result.original.source).toEqual({ status: 'source_epoch_unproved', reason: 'invalid_source_capture' });
    expect(result.verification.source?.status).toBe('linked');
  });

  it('refuses a partial marker instead of inferring an input from matching hashes or versions', async () => {
    const row = fixture();
    Reflect.deleteProperty(row.original_observation.source_data.administration.sourceCapture, 'leagueInputId');
    expect((await read(row)).original.source).toEqual({ status: 'source_epoch_unproved', reason: 'invalid_source_capture' });
  });

  it('does not round reservation precision into proof for an earlier network request', async () => {
    const row = fixture();
    for (const entry of row.inputs.slice(0, 2)) entry.capture.reserved_at = '2026-09-29T12:00:00.001001+00:00';
    expect((await read(row)).original.source).toEqual({ status: 'source_epoch_unproved', reason: 'invalid_source_capture' });
  });

  it('does not elevate cached matchups into a network source epoch', async () => {
    const row = fixture();
    row.inputs[1].input.provenance.origin = 'cache';
    expect((await read(row)).original.source).toEqual({ status: 'source_epoch_unproved', reason: 'invalid_source_capture' });
  });

  it.each([[[uuid(99), uuid(99)]], [['invalid-id']]])('refuses malformed original stored game IDs: %s', async (ids) => {
    expect(await reader([{ ...fixture(), game_state_observation_ids: ids }]).reader.readSnapshotSourceHistory(request))
      .toEqual({ status: 'unavailable', reason: 'source_history_unavailable' });
  });

  it('returns missing for an exact historical selection that does not exist', async () => {
    expect(await reader([]).reader.readSnapshotSourceHistory({ ...request, season: 2025 })).toEqual({ status: 'missing' });
  });

  it('rejects invalid requests before querying and rejects ambiguous rows', async () => {
    const adapter = reader([fixture(), fixture()]);
    for (const invalid of [{ week: 0 }, { week: 19 }, { season: 2026.5 }, { snapshotId: '' }, { modelVersion: ' clock-v1' }]) {
      expect(await adapter.reader.readSnapshotSourceHistory({ ...request, ...invalid }))
        .toEqual({ status: 'unavailable', reason: 'invalid_request' });
    }
    expect(adapter.query).not.toHaveBeenCalled();
    expect(await adapter.reader.readSnapshotSourceHistory(request))
      .toEqual({ status: 'unavailable', reason: 'source_history_unavailable' });
  });

  it('does not expose database errors or invoke the database when persistence is disabled', async () => {
    const client: DatabaseClient = { enabled: true, query: async () => { throw new Error('postgres://private:secret@host'); } };
    expect(await createSnapshotSourceHistoryReader(client).readSnapshotSourceHistory(request))
      .toEqual({ status: 'unavailable', reason: 'source_history_unavailable' });
    expect(await createProjectionSourceHistoryReader({ enabled: false, reason: 'missing-database-url' })
      .readSnapshotSourceHistory(request)).toEqual({ status: 'unavailable', reason: 'persistence_disabled' });
  });
});
