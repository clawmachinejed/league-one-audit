import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createFakeProjectionDatabase } from '../../../projection-store-test-support';
import { createSnapshotRevisionMethods, snapshotRevisionFromRow } from './snapshot-revision';
import { InvalidStoredProjectionSnapshotError } from './snapshot-codec';

const identity = {
  projectionProvider: 'tank01', normalizerVersion: 'canonical-projection-slate-v1', modelVersion: 'clock-v1',
};

function row() {
  return {
    league_key: 'league1', default_season: 2026, default_season_type: 'reg', default_week: 5,
    active_season: 2026, active_season_type: 'reg', active_week: 1,
    league_lifecycle: 'active', nfl_phase: 'regular', source_provider: 'sleeper',
    source_revision: 'period', source_observed_at: '2026-09-13T18:00:00Z',
    period_verified_at: '2026-09-13T18:00:00Z',
    snapshot_id: 'snapshot', league_season_id: 'season', week: 5,
    model_version: 'clock-v1', revision_key: 'a'.repeat(64),
    calculated_at: '2026-09-13T18:00:00Z', published_at: '2026-09-13T18:00:00Z',
    verified_at: '2026-09-13T18:01:00Z', is_current: true, activity_windows: [],
    payload_structure_valid: true, payload_updated_at: '2026-09-13T18:00:00Z',
    payload_season: '2026', payload_week: '5', payload_league_week: '5',
    matchup_statuses: ['upcoming'], scheduled_kickoffs: ['2026-10-11T17:00:00Z'],
    scheduled_dates_without_kickoff: [],
    future_next_refresh_at: '2026-09-14T00:00:00Z',
    future_last_succeeded_at: '2026-09-13T18:00:00Z', future_attempt_expires_at: null,
    future_last_slate_content_id: 'slate-5', future_current_slate_content_id: 'slate-5',
    future_last_snapshot_revision: 'a'.repeat(64),
  };
}

describe('compact snapshot database selection', () => {
  it('uses one exact requested/default selection with the same provider and lineage qualification', async () => {
    const fake = createFakeProjectionDatabase(() => [row()]);
    const methods = createSnapshotRevisionMethods(fake.database);
    const result = await methods.readMatchupSnapshotRevisionByLeagueKey(' league1 ', undefined, identity);
    expect(result).toMatchObject({
      authority: { defaultWeek: 5, activeWeek: 1 },
      snapshot: { week: 5, revisionKey: 'a'.repeat(64), verifiedAt: '2026-09-13T18:01:00Z' },
      futureRefresh: { lastProjectionSlateContentId: 'slate-5', currentProjectionSlateContentId: 'slate-5' },
    });
    expect(result?.snapshot).not.toHaveProperty('payload');
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].parameters).toEqual(['league1', null, 'tank01', 'canonical-projection-slate-v1', 'clock-v1']);
    const sql = fake.calls[0].statement;
    expect(sql).toContain('projection-store:read-matchup-snapshot-revision-by-league-key');
    expect(sql).toContain('COALESCE($2::smallint, authority.default_week)');
    expect(sql).toContain('current.week = target.target_week');
    expect(sql).toContain('snapshot.model_version = $5');
    expect(sql).toContain('material.projection_provider = $3');
    expect(sql).toContain('material.normalizer_version = $4');
    expect(sql).toContain('material.model_version = $5');
    expect(sql).not.toMatch(/snapshot\.payload\s*(?:,|AS\s+payload)/iu);
    expect(sql).not.toMatch(/SELECT\s+snapshot\.\*/iu);
    expect(sql).not.toContain('ORDER BY');
    await methods.readMatchupSnapshotRevisionByLeagueKey('league1', 5, identity);
    expect(fake.calls[1].parameters).toEqual(['league1', 5, 'tank01', 'canonical-projection-slate-v1', 'clock-v1']);
  });

  it('preserves missing authority and missing snapshot without attempting payload decoding', async () => {
    const absent = createFakeProjectionDatabase(() => []);
    await expect(createSnapshotRevisionMethods(absent.database)
      .readMatchupSnapshotRevisionByLeagueKey('league1', 5, identity)).resolves.toBeNull();
    const missing = createFakeProjectionDatabase(() => [{ ...row(), snapshot_id: null, payload_structure_valid: false }]);
    await expect(createSnapshotRevisionMethods(missing.database)
      .readMatchupSnapshotRevisionByLeagueKey('league1', 5, identity)).resolves.toMatchObject({ snapshot: null });
  });

  it.each([0, 19, 1.5, NaN, Infinity])('rejects invalid requested week %s without a query', async (week) => {
    const fake = createFakeProjectionDatabase();
    await expect(createSnapshotRevisionMethods(fake.database)
      .readMatchupSnapshotRevisionByLeagueKey('league1', week, identity)).rejects.toThrow();
    expect(fake.calls).toHaveLength(0);
  });
});

describe('compact snapshot metadata decoding', () => {
  it('keeps JavaScript date and status refinement semantics', () => {
    const decoded = snapshotRevisionFromRow({
      ...row(), payload_updated_at: 'September 13, 2026 18:00:00 GMT',
      matchup_statuses: [[['live']]], scheduled_kickoffs: '["not-a-date",""]',
    });
    expect(decoded.payloadUpdatedAt).toBe('September 13, 2026 18:00:00 GMT');
    expect(decoded.matchupStatuses).toEqual([[['live']]]);
    expect(decoded.scheduledKickoffs).toEqual(['not-a-date', '']);
  });

  it.each([
    { payload_structure_valid: false }, { payload_updated_at: 'not-a-date' },
    { payload_season: null }, { matchup_statuses: ['running'] },
    { matchup_statuses: [{ toString: null }] }, { matchup_statuses: null },
    { scheduled_kickoffs: [null] }, { scheduled_dates_without_kickoff: '[null]' },
    { activity_windows: [{ startsAt: 'bad', endsAt: 'bad' }] },
  ])('wraps malformed structure, refinement or metadata in the shared error class: %j', (override) => {
    expect(() => snapshotRevisionFromRow({ ...row(), ...override }))
      .toThrow(InvalidStoredProjectionSnapshotError);
  });
});
