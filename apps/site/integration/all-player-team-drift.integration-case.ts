import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createProjectionStore } from '../lib/projection-store';
import { prepareAllPlayerBatch } from '../lib/projections/adapters/neon/all-player-statistics';
import type { AllPlayerStatObservation } from '../lib/projections/domain/all-player-statistics';
import { createIndependentDatabase, createPinnedIntegrationDatabase, ownerQuery } from './neon-integration-harness';
import { createAllPlayerContextMethods } from '../lib/projections/adapters/neon/all-player-context';

/** Captured Jimmy Horn / Sleeper 12523 Week 1 statistics, accepted September 15.
 * His September 16 catalog entry has team=null. The source excerpt provenance
 * is documented in all-player-week-one-team-drift.test.ts. The game context
 * below is explicitly unresolved; it does not assert a different historical team.
 */
const observation: AllPlayerStatObservation = {
  provider: 'sleeper', season: 2026, seasonType: 'reg', week: 1,
  normalizerVersion: 'sleeper-weekly-stats-v4', sourceRevision: 'captured-jimmy-horn-teamless-replay',
  requestStartedAt: '2026-09-16T22:49:27.925Z', requestCompletedAt: '2026-09-16T22:49:27.925Z',
  observedAt: '2026-09-16T22:49:27.925Z', quality: 'partial', warnings: ['unmapped-games:1'],
  coverage: { complete: false, providerPresentEntityCount: 1, providerMissingEntityCount: 0,
    unknownEligibilityCount: 0, unknownAppearanceCount: 0, assumedNonParticipationCount: 0,
    unmappedGameCount: 1, participationAssumptionPolicy: 'missing-participation-as-zero-v1' },
  entries: [{ entityKind: 'player', providerExternalId: '12523', position: 'WR',
    nflTeam: null, nflGameId: null, gamePhase: 'unknown', eligibleGameCount: 1, appearanceGameCount: 1,
    eligibilityEvidence: { kind: 'weekly-stat', source: 'weekly-stat-provider', gmsActive: 1,
      appearances: 1, individualSnaps: { st_snp: 12, off_snp: 14 } },
    stats: { gp: 1, kr: 5, pr: 2, fum: 1, kr_yd: 101, pr_yd: 17, kr_lng: 26, kr_ypa: 20.2,
      pr_lng: 17, pr_ypa: 8.5, st_snp: 12, off_snp: 14, pts_ppr: -2, pts_std: -2,
      rec_tgt: 1, fum_lost: 1, tm_st_snp: 37, gms_active: 1, tm_def_snp: 75,
      tm_off_snp: 68, pos_rank_ppr: 110, pos_rank_std: 110, pts_half_ppr: -2,
      pos_rank_half_ppr: 110 },
  }],
};

describe('captured Week 1 team drift at the isolated PostgreSQL boundary', () => {
  it('retains and exactly replays captured stats through the real runtime writer with a live budgeted fence', async () => {
    const connection = createIndependentDatabase();
    const store = createProjectionStore(connection.database);
    const jobKey = 'all-player-ingestion:sleeper';
    let previousJob: Record<string, unknown> | undefined;
    let ownsFixtureJob = false;
    // The period is synthetic so this writer fixture cannot affect the captured
    // 2026 season or another integration file's league-reader assertions.
    const period = { season: 2194, seasonType: 'reg', week: 1 } as const;
    const capturedStatsInSyntheticPeriod: AllPlayerStatObservation = {
      ...observation, ...period, sourceRevision: `018-jimmy-horn-writer-${randomUUID()}`,
    };
    try {
      previousJob = (await ownerQuery<{ job: Record<string, unknown> }>(
        'SELECT to_jsonb(job) AS job FROM projection_jobs job WHERE job_key=$1', [jobKey]))[0]?.job;
      await ownerQuery('DELETE FROM projection_jobs WHERE job_key=$1', [jobKey]);
      ownsFixtureJob = true;
      const claim = await store.acquireAllPlayerJob({ mode: 'recurring', period,
        workerId: '018-captured-stat-writer', leaseSeconds: 120,
        deadlineAt: new Date(Date.now() + 110_000).toISOString() });
      if (claim.kind !== 'acquired') throw new Error('Isolated captured-stat writer claim failed.');
      expect(await store.markAllPlayerRequest({ fence: claim.fence, period })).toBe(true);
      const input = { observation: capturedStatsInSyntheticPeriod, scoreSets: [],
        verifiedAt: observation.observedAt, fence: claim.fence };
      const first = await store.recordAllPlayerBatch(input);
      if (first.kind !== 'stored') throw new Error('Isolated captured-stat write failed.');
      expect(first.value.entriesStored).toBe(1);
      expect(first.value.scoreSets).toEqual([]);
      const replay = await store.recordAllPlayerBatch(input);
      if (replay.kind !== 'stored') throw new Error('Isolated captured-stat replay failed.');
      expect(replay.value).toMatchObject({ statContentId: first.value.statContentId,
        statObservationId: first.value.statObservationId, semanticHash: first.value.semanticHash,
        entriesStored: 0, scoreSets: [] });
      const stored = (await connection.database.query<{
        contents: number; observations: number; entries: number; score_sets: number;
        scores: number; pointers: number;
      }>(`SELECT
        (SELECT count(*)::integer FROM all_player_stat_contents WHERE id=$1::uuid) AS contents,
        (SELECT count(*)::integer FROM all_player_stat_observations
          WHERE all_player_stat_content_id=$1::uuid) AS observations,
        (SELECT count(*)::integer FROM all_player_stat_entries
          WHERE all_player_stat_content_id=$1::uuid) AS entries,
        (SELECT count(*)::integer FROM all_player_score_sets
          WHERE all_player_stat_content_id=$1::uuid) AS score_sets,
        (SELECT count(*)::integer FROM all_player_scores
          WHERE all_player_stat_content_id=$1::uuid) AS scores,
        (SELECT count(*)::integer FROM current_all_player_score_sets
          WHERE season=2194 AND season_type='reg' AND week=1) AS pointers`, [first.value.statContentId]))[0];
      expect(stored).toEqual({ contents: 1, observations: 1, entries: 1, score_sets: 0, scores: 0, pointers: 0 });
      const entries = await connection.database.query<{
        provider_external_id: string; eligible_game_count: number; appearance_game_count: number;
        nfl_game_id: null; nfl_team: null; game_phase: string; stats: unknown;
      }>(`SELECT provider_external_id,eligible_game_count,appearance_game_count,
        nfl_game_id,nfl_team,game_phase,stats FROM all_player_stat_entries
        WHERE all_player_stat_content_id=$1::uuid`, [first.value.statContentId]);
      expect(entries).toEqual([{ provider_external_id: '12523', eligible_game_count: 1,
        appearance_game_count: 1, nfl_game_id: null, nfl_team: null, game_phase: 'unknown',
        stats: observation.entries[0].stats }]);
      expect(await store.validateAllPlayerJobFence(claim.fence)).toBe(true);
      expect((await store.readAllPlayerJobState())?.payload.requestStarts).toHaveLength(1);
    } finally {
      try {
        if (ownsFixtureJob) {
          await ownerQuery('DELETE FROM projection_jobs WHERE job_key=$1', [jobKey]);
          if (previousJob) await ownerQuery(
            'INSERT INTO projection_jobs SELECT * FROM jsonb_populate_record(NULL::projection_jobs,$1::jsonb)',
            [JSON.stringify(previousJob)]);
        }
      } finally { await connection.close(); }
    }
  });

  // The original 001–017 characterization ran before 018 and reproduced the
  // rejection. These assertions prove repaired retention with unchanged guards.
  it('retains the captured Jimmy Horn record, replays it exactly, and keeps sealed raw history immutable', async () => {
    const prepared = prepareAllPlayerBatch({ observation, scoreSets: [], verifiedAt: observation.observedAt });
    expect(prepared.entries[0]).toMatchObject({ providerExternalId: '12523', eligibleGameCount: 1,
      appearanceGameCount: 1, nflGameId: null, gamePhase: 'unknown' });
    const connection = await createPinnedIntegrationDatabase('runtime');
    const query = connection.database.query;
    const contentId = randomUUID();
    try {
      await query('BEGIN');
      await query(`INSERT INTO all_player_stat_contents
        (id,provider,season,season_type,week,normalizer_version,semantic_hash,quality,coverage,warnings,entry_count)
        VALUES ($1::uuid,'sleeper',2026,'reg',1,'sleeper-weekly-stats-v4',$2,'partial',$3::jsonb,$4::jsonb,1)`,
      [contentId, randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', ''),
        JSON.stringify(observation.coverage), JSON.stringify(observation.warnings)]);
      const insert = (stats = observation.entries[0].stats) => query(`INSERT INTO all_player_stat_entries
        (all_player_stat_content_id,provider_external_id,entity_kind,game_phase,position,nfl_team,nfl_game_id,
          stats,eligible_game_count,appearance_game_count,eligibility_evidence,ordinal)
        VALUES ($1::uuid,'12523','player','unknown','WR',NULL,NULL,$2::jsonb,1,1,$3::jsonb,0)
        ON CONFLICT DO NOTHING`,
      [contentId, JSON.stringify(stats), JSON.stringify(observation.entries[0].eligibilityEvidence)]);
      await insert();
      await query(`INSERT INTO all_player_stat_observations
        (id,all_player_stat_content_id,provider,season,season_type,week,normalizer_version,source_revision,
          request_started_at,request_completed_at,observed_at,quality)
        VALUES (gen_random_uuid(),$1::uuid,'sleeper',2026,'reg',1,'sleeper-weekly-stats-v4',$1::text,
          '2026-09-16T22:49:27.925Z','2026-09-16T22:49:27.925Z','2026-09-16T22:49:27.925Z','partial')`, [contentId]);
      await insert();
      const saved = await query<{ eligible: number; appearances: number; game_id: null; stats: unknown }>(`SELECT
        eligible_game_count AS eligible,appearance_game_count AS appearances,nfl_game_id AS game_id,stats
        FROM all_player_stat_entries WHERE all_player_stat_content_id=$1::uuid`, [contentId]);
      expect(saved).toEqual([{ eligible: 1, appearances: 1, game_id: null, stats: observation.entries[0].stats }]);
      expect((await query<{ scores: number; pointers: number }>(`SELECT
        (SELECT count(*)::integer FROM all_player_scores WHERE all_player_stat_content_id=$1) AS scores,
        (SELECT count(*)::integer FROM current_all_player_score_sets pointer
          JOIN all_player_stat_observations observed ON observed.id=pointer.all_player_stat_observation_id
          WHERE observed.all_player_stat_content_id=$1) AS pointers`, [contentId]))[0])
        .toEqual({ scores: 0, pointers: 0 });
      await expect(insert({ ...observation.entries[0].stats, fum_lost: 0 })).rejects.toThrow(/sealed|replay conflicts/);
    } finally {
      try { await query('ROLLBACK'); } finally { await connection.close(); }
    }
  });

  it.each([
    { quality: 'complete', phase: 'unknown', kind: 'player', position: 'WR' },
    { quality: 'partial', phase: 'final', kind: 'player', position: 'WR' },
    { quality: 'partial', phase: 'live', kind: 'player', position: 'WR' },
    { quality: 'partial', phase: 'unknown', kind: 'team_defense', position: 'DEF' },
  ])('does not permit missing game context for $quality/$kind/$phase', async (variant) => {
    const connection = await createPinnedIntegrationDatabase('runtime');
    const query = connection.database.query;
    const contentId = randomUUID();
    try {
      await query('BEGIN');
      await query(`INSERT INTO all_player_stat_contents
        (id,provider,season,season_type,week,normalizer_version,semantic_hash,quality,coverage,warnings,entry_count)
        VALUES ($1::uuid,'sleeper',2026,'reg',1,'sleeper-weekly-stats-v4',$2,$3,$4::jsonb,'[]',1)`,
      [contentId, randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', ''),
        variant.quality, JSON.stringify({ complete: variant.quality === 'complete' })]);
      await expect(query(`INSERT INTO all_player_stat_entries
        (all_player_stat_content_id,provider_external_id,entity_kind,game_phase,position,nfl_team,nfl_game_id,
          stats,eligible_game_count,appearance_game_count,eligibility_evidence,ordinal)
        VALUES ($1::uuid,$2,$3,$4,$5,NULL,NULL,'{"gp":1}',1,1,
          '{"kind":"weekly-stat","source":"weekly-stat-provider","appearances":1}',0)`,
      [contentId, variant.kind === 'player' ? '12523' : 'CAR', variant.kind, variant.phase, variant.position]))
        .rejects.toThrow('eligible all-player entry requires an NFL game');
    } finally { try { await query('ROLLBACK'); } finally { await connection.close(); } }
  });

  it('reads all exact-period team histories with stable earliest evidence and durable conflict markers', async () => {
    const connection = await createPinnedIntegrationDatabase('runtime');
    const query = connection.database.query;
    const externalId = `team-context-${randomUUID()}`;
    const insert = async (team: string | null, observedAt: string,
      options: { week?: number; provider?: string; conflicted?: boolean } = {}) => {
      const contentId = randomUUID();
      const observationId = randomUUID();
      const source = options.provider ?? 'sleeper';
      const week = options.week ?? 1;
      await query(`INSERT INTO all_player_stat_contents
        (id,provider,season,season_type,week,normalizer_version,semantic_hash,quality,coverage,warnings,entry_count)
        VALUES ($1::uuid,$2,2195,'reg',$3,'sleeper-weekly-stats-v4',$4,'partial',$5::jsonb,'[]',1)`,
      [contentId, source, week, randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', ''),
        JSON.stringify({ complete: false, ...(options.conflicted ? { periodTeamContextConflicts: {
          [externalId]: { source: 'stored-all-player-observations', role: 'conflict-only', currentTeam: 'BUF' },
        } } : {}) })]);
      await query(`INSERT INTO all_player_stat_entries
        (all_player_stat_content_id,provider_external_id,entity_kind,game_phase,position,nfl_team,nfl_game_id,
          stats,eligible_game_count,appearance_game_count,eligibility_evidence,ordinal)
        VALUES ($1::uuid,$2,'player','unknown','WR',$3,NULL,'{}',NULL,NULL,
          '{"kind":"unknown-weekly-stat","source":"weekly-stat-provider"}',0)`,
      [contentId, externalId, team]);
      await query(`INSERT INTO all_player_stat_observations
        (id,all_player_stat_content_id,provider,season,season_type,week,normalizer_version,source_revision,
          request_started_at,request_completed_at,observed_at,quality)
        VALUES ($1::uuid,$2::uuid,$3,2195,'reg',$4,'sleeper-weekly-stats-v4',$2::text,
          $5::timestamptz,$5::timestamptz,$5::timestamptz,'partial')`,
      [observationId, contentId, source, week, observedAt]);
      return observationId;
    };
    try {
      await query('BEGIN');
      const firstId = await insert('CAR', '2195-09-15T04:00:00.000Z');
      const secondTeamId = await insert('ATL', '2195-09-15T05:00:00.000Z');
      await insert(null, '2195-09-16T04:00:00.000Z', { conflicted: true });
      await insert('BUF', '2195-09-16T05:00:00.000Z', { week: 2 });
      await insert('BUF', '2195-09-16T05:00:00.000Z', { provider: 'tank01' });
      const reader = createAllPlayerContextMethods(connection.database);
      const request = { provider: 'sleeper', season: 2195, seasonType: 'reg' as const, week: 1 };
      const first = await reader.readAllPlayerHistoricalTeamContexts(request);
      expect(first).toEqual([
        { providerExternalId: externalId, nflTeam: 'ATL', sourceObservationId: secondTeamId,
          observedAt: '2195-09-15T05:00:00.000Z', effectivePeriod: { season: 2195, seasonType: 'reg', week: 1 },
          hasUnresolvedConflict: true },
        { providerExternalId: externalId, nflTeam: 'CAR', sourceObservationId: firstId,
          observedAt: '2195-09-15T04:00:00.000Z', effectivePeriod: { season: 2195, seasonType: 'reg', week: 1 },
          hasUnresolvedConflict: true },
      ]);
      await insert('CAR', '2195-09-16T06:00:00.000Z');
      expect(await reader.readAllPlayerHistoricalTeamContexts(request)).toEqual(first);
    } finally { try { await query('ROLLBACK'); } finally { await connection.close(); } }
  });
});
