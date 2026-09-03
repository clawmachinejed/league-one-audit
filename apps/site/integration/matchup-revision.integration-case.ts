import { describe, expect, it } from 'vitest';
import { isMatchupsData } from '../lib/matchups-response';
import { validationCases } from '../lib/matchups-validation-test-support';
import { snapshotFreshnessMetadata, selectSnapshotMetadata } from '../lib/projection-freshness';
import { COMPACT_MATCHUP_PAYLOAD_COLUMNS, snapshotRevisionFromRow } from '../lib/projections/adapters/neon/snapshot-revision';
import { InvalidStoredProjectionSnapshotError } from '../lib/projection-store';
import { runtimeQuery } from './neon-integration-harness';

describe.sequential('compact matchup validation against isolated Neon', () => {
  it.each(validationCases())('matches full validation for $name without payload transfer', async ({ json, valid }) => {
    const rows = await runtimeQuery(`WITH snapshot(payload) AS (VALUES ($1::jsonb))
      SELECT ${COMPACT_MATCHUP_PAYLOAD_COLUMNS} FROM snapshot`, [json]);
    const row = rows[0];
    expect(row).not.toHaveProperty('payload');
    const compactJson = JSON.stringify(row);
    for (const privateValue of ['Private fixture manager', 'Private fixture team', 'Private fixture player', 'private-fixture-player']) {
      expect(compactJson).not.toContain(privateValue);
    }
    const envelope = {
      snapshot_id: 'snapshot-fixture', league_season_id: 'season-fixture', week: 1,
      model_version: 'clock-v1', revision_key: 'a'.repeat(64),
      calculated_at: '2026-09-13T18:00:00.000Z', published_at: '2026-09-13T18:00:00.000Z',
      verified_at: '2026-09-13T18:00:00.000Z', is_current: true, activity_windows: [],
      ...row,
    };
    if (!valid) {
      expect(() => snapshotRevisionFromRow(envelope)).toThrow(InvalidStoredProjectionSnapshotError);
      return;
    }
    const payload: unknown = JSON.parse(json);
    expect(isMatchupsData(payload)).toBe(true);
    if (!isMatchupsData(payload)) return;
    const compact = snapshotRevisionFromRow(envelope);
    const full = snapshotFreshnessMetadata({
      snapshotId: 'snapshot-fixture', leagueSeasonId: 'season-fixture', week: 1,
      modelVersion: 'clock-v1', revisionKey: 'a'.repeat(64),
      calculatedAt: envelope.calculated_at, publishedAt: envelope.published_at,
      verifiedAt: envelope.verified_at, activityWindows: [], isCurrent: true, payload,
    });
    for (const temporalState of ['past', 'active', 'future'] as const) {
      const context = {
        defaultSeason: 2026, defaultWeek: 2, activeSeason: 2026, activeWeek: 1,
        lifecycle: 'active' as const, nflPhase: 'regular' as const, temporalState, refreshDue: false,
      };
      for (const now of ['2026-09-13T18:03:00Z', '2026-09-13T18:03:00.001Z', '2026-09-14T01:00:00Z']) {
        expect(selectSnapshotMetadata(compact, context, new Date(now)))
          .toEqual(selectSnapshotMetadata(full, context, new Date(now)));
      }
    }
  });
});
