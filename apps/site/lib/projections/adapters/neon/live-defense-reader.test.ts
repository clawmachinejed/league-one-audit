import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { createFakeProjectionDatabase } from '../../../projection-store-test-support';
import { DEFENSE_PROJECTION_MODEL_VERSION, NFL_TEAM_CODES } from '../../domain/contracts';
import { createLiveDefenseReadMethods } from './live-defense-reader';

const at = '2026-09-20T19:00:00.000Z';
const now = Date.parse(at) + 60_000;
const period = { season: 2026, seasonType: 'regular', week: 2 } as const;
const evidence = () => ({
  version: DEFENSE_PROJECTION_MODEL_VERSION, status: 'available', period,
  requestStartedAt: at, requestCompletedAt: at, observedAt: at,
  sourceRevision: 'sha256:original-capture',
  entries: [{ team: 'SEA', stats: { sack: 2, pts_allow: 7, pts_allow_7_13: 1 } }],
});
const row = (value: unknown, databaseNow = now) => ({ evidence: value, database_now_ms: String(databaseNow) });

describe('compact persisted live defense evidence reader', () => {
  it('unions the same capture across leagues in one bounded-period read without refreshing original timestamps', async () => {
    const original = evidence();
    const fake = createFakeProjectionDatabase(() => [row(original), row({ ...original,
      entries: [{ team: 'SF', stats: { pts_allow: 0, pts_allow_0: 1 } }, ...original.entries],
    })]);
    const capture = await createLiveDefenseReadMethods(fake.database).readLiveDefenseStatCapture(period);
    expect(capture).toEqual({ period, sourceRevision: original.sourceRevision,
      requestStartedAt: at, requestCompletedAt: at, observedAt: at,
      entries: [...original.entries, { team: 'SF', stats: { pts_allow: 0, pts_allow_0: 1 } }],
    });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].parameters).toEqual([2026, 2, NFL_TEAM_CODES, DEFENSE_PROJECTION_MODEL_VERSION]);
    expect(fake.calls[0].statement).toContain("observation.source_data -> 'liveDefense'");
    expect(fake.calls[0].statement).toContain("clock_timestamp() - interval '90 seconds'");
    expect(fake.calls[0].statement).toContain('JOIN LATERAL');
    expect(fake.calls[0].statement).toContain('LIMIT 1');
  });

  it('reuses the hourly observation original revision and age with exact period and observed-defense row guards', async () => {
    const original = { ...evidence(), entries: [{ team: 'SEA', stats: { pts_allow_0: 1, def_3_and_out: 1, gp: 1 } }] };
    const fake = createFakeProjectionDatabase(() => [{ ...row(original), source_kind: 'hourly' }]);
    expect(await createLiveDefenseReadMethods(fake.database).readLiveDefenseStatCapture(period))
      .toEqual({ period, sourceRevision: original.sourceRevision, requestStartedAt: at,
        requestCompletedAt: at, observedAt: at, entries: original.entries });
    const sql = fake.calls[0].statement;
    expect(sql).toContain('FROM all_player_stat_observations observation');
    expect(sql).toContain("observation.normalizer_version = 'sleeper-weekly-stats-v4'");
    expect(sql).toContain('observation.request_started_at BETWEEN');
    expect(sql).toContain('observation.request_completed_at BETWEEN');
    expect(sql).toContain("entry.eligibility_evidence ->> 'kind' = 'weekly-stat'");
    expect(sql).toContain("entry.eligibility_evidence ->> 'source' = 'weekly-stat-provider'");
    expect(sql).toContain("entry.entity_kind = 'team_defense' AND entry.position = 'DEF'");
    expect(sql).toContain('entry.provider_external_id = entry.nfl_team');
    expect(sql).toContain('EXISTS (SELECT 1 FROM enrolled)');
  });

  it('prefers the intact hourly envelope for the same retrieval without splicing compact or older statistics', async () => {
    const original = evidence();
    const hourly = { ...original, entries: original.entries.map((entry) => ({ ...entry, stats: { ...entry.stats, gp: 1 } })) };
    const older = { ...original, sourceRevision: 'sha256:older',
      requestStartedAt: '2026-09-20T18:59:50.000Z', requestCompletedAt: '2026-09-20T18:59:50.000Z',
      observedAt: '2026-09-20T18:59:50.000Z', entries: [{ team: 'SF', stats: { pts_allow_0: 1 } }] };
    const fake = createFakeProjectionDatabase(() => [row(original), row(older), { ...row(hourly), source_kind: 'hourly' }]);
    expect(await createLiveDefenseReadMethods(fake.database).readLiveDefenseStatCapture(period))
      .toMatchObject({ entries: hourly.entries, observedAt: at, sourceRevision: original.sourceRevision });
  });

  it('never combines an older retrieval under the newest source revision or timestamp', async () => {
    const older = evidence();
    const laterAt = '2026-09-20T19:00:30.000Z';
    const later = { ...older, requestStartedAt: laterAt, requestCompletedAt: laterAt, observedAt: laterAt,
      sourceRevision: 'sha256:newer', entries: [{ team: 'SF', stats: { pts_allow: 14, pts_allow_14_20: 1 } }] };
    const fake = createFakeProjectionDatabase(() => [row(older), row(later)]);
    expect(await createLiveDefenseReadMethods(fake.database).readLiveDefenseStatCapture(period))
      .toMatchObject({ sourceRevision: later.sourceRevision, observedAt: laterAt, entries: later.entries });
  });

  it.each([
    ['stale original start', { ...evidence(), requestStartedAt: '2026-09-20T18:59:29.999Z' }],
    ['stale original capture', { ...evidence(), requestStartedAt: '2026-09-20T18:59:29.999Z',
      requestCompletedAt: '2026-09-20T18:59:29.999Z', observedAt: '2026-09-20T18:59:29.999Z' }],
    ['future capture', { ...evidence(), requestCompletedAt: '2026-09-20T19:01:00.001Z' }],
    ['wrong week', { ...evidence(), period: { ...period, week: 3 } }],
    ['wrong season', { ...evidence(), period: { ...period, season: 2027 } }],
    ['wrong mode', { ...evidence(), period: { ...period, seasonType: 'postseason' } }],
    ['noncanonical timestamp', { ...evidence(), observedAt: '2026-09-20T19:00:00+00:00' }],
    ['missing source revision', { ...evidence(), sourceRevision: '' }],
    ['unsupported version', { ...evidence(), version: 'unknown' }],
    ['unavailable evidence', { ...evidence(), status: 'unavailable' }],
    ['empty entries', { ...evidence(), entries: [] }],
    ['aggregate team', { ...evidence(), entries: [{ team: 'TEAM_SEA', stats: { pts_allow: 7 } }] }],
    ['numeric player identity', { ...evidence(), entries: [{ team: '123', stats: { sack: 1 } }] }],
    ['aliased team', { ...evidence(), entries: [{ team: 'LA', stats: { pts_allow: 7 } }] }],
    ['numeric string', { ...evidence(), entries: [{ team: 'SEA', stats: { pts_allow: '7' } }] }],
    ['nonfinite count', { ...evidence(), entries: [{ team: 'SEA', stats: { pts_allow: NaN } }] }],
    ['nested data', { ...evidence(), entries: [{ team: 'SEA', stats: { provider: { pts_allow: 7 } } }] }],
    ['invalid stat key', { ...evidence(), entries: [{ team: 'SEA', stats: { 'invalid key': 7 } }] }],
    ['duplicate team', { ...evidence(), entries: [...evidence().entries, ...evidence().entries] }],
  ])('rejects %s instead of treating unavailable evidence as zero', async (_, invalid) => {
    const fake = createFakeProjectionDatabase(() => [row(invalid)]);
    expect(await createLiveDefenseReadMethods(fake.database).readLiveDefenseStatCapture(period)).toBeNull();
  });

  it('requires database time and rejects conflicting same-source team statistics', async () => {
    const invalidClock = createFakeProjectionDatabase(() => [{ evidence: evidence(), database_now_ms: undefined }]);
    expect(await createLiveDefenseReadMethods(invalidClock.database).readLiveDefenseStatCapture(period)).toBeNull();
    const fake = createFakeProjectionDatabase(() => [row(evidence()), row({ ...evidence(),
      entries: [{ team: 'SEA', stats: { sack: 3, pts_allow: 7, pts_allow_7_13: 1 } }],
    })]);
    expect(await createLiveDefenseReadMethods(fake.database).readLiveDefenseStatCapture(period)).toBeNull();
  });

  it('rejects equal-time conflicting source envelopes deterministically', async () => {
    const rows = [row(evidence()), row({ ...evidence(), sourceRevision: 'sha256:conflict' })];
    for (const ordered of [rows, [...rows].reverse()]) {
      const fake = createFakeProjectionDatabase(() => ordered);
      expect(await createLiveDefenseReadMethods(fake.database).readLiveDefenseStatCapture(period)).toBeNull();
    }
  });

  it('does no query for an unsupported period', async () => {
    const fake = createFakeProjectionDatabase();
    expect(await createLiveDefenseReadMethods(fake.database).readLiveDefenseStatCapture({ ...period, week: 0 })).toBeNull();
    expect(fake.calls).toHaveLength(0);
  });
});
