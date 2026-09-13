import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';
import { createProjectionStore } from '../lib/projection-store';
import { allPlayerEligibilityCounts,
  type AllPlayerAssumedNonParticipationEvidence } from '../lib/projections/domain/all-player-eligibility';
import type { AllPlayerStatObservation } from '../lib/projections/domain/all-player-statistics';
import { createPinnedIntegrationDatabase, ownerQuery, type IndependentDatabase } from './neon-integration-harness';

type Query = IndependentDatabase['database']['query'];
type Json = Record<string, unknown>;
const period = { season: 2194, seasonType: 'reg', week: 16 } as const;
const weekly = (fields: Json = {}): Json => ({ kind: 'weekly-stat', source: 'weekly-stat-provider', ...fields });
const missing = { kind: 'missing-provider-row', inventoryFingerprint: `sha256:${'d'.repeat(64)}` } as const;
const assumed = (basis: unknown): Json => ({ kind: 'assumed-nonparticipation',
  policy: 'missing-participation-as-zero-v1', source: 'product-policy', effectivePeriod: period, basis });

describe('013 explicit missing participation assumption in the isolated database', () => {
  let gameId: string;
  beforeAll(async () => {
    gameId = (await ownerQuery<{ id: string }>(`INSERT INTO nfl_games
      (season,season_type,week,home_team,away_team,kickoff_at)
      VALUES (2194,'reg',16,'NE','NYJ','2194-09-01T00:00:00Z') RETURNING id::text`))[0].id;
  });

  async function withContent(run: (query: Query, id: string) => Promise<void>, version = 'sleeper-weekly-stats-v4') {
    const connection = await createPinnedIntegrationDatabase('runtime');
    const query = connection.database.query;
    try {
      await query('BEGIN');
      const id = randomUUID();
      await query(`INSERT INTO all_player_stat_contents
        (id,provider,season,season_type,week,normalizer_version,semantic_hash,quality,coverage,warnings,entry_count)
        VALUES ($1::uuid,'sleeper',2194,'reg',16,$2,$3,'partial','{"complete":false}','[]',1)`,
      [id, version, randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '')]);
      await run(query, id);
    } finally { try { await query('ROLLBACK'); } finally { await connection.close(); } }
  }

  async function insertEntry(query: Query, id: string, stats: Json, evidence: Json,
    counts: readonly [number | null, number | null], options: { kind?: 'player' | 'team_defense'; replay?: boolean } = {}) {
    return query(`INSERT INTO all_player_stat_entries
      (all_player_stat_content_id,provider_external_id,entity_kind,game_phase,position,nfl_team,nfl_game_id,
       stats,eligible_game_count,appearance_game_count,eligibility_evidence,ordinal)
      VALUES ($1::uuid,$2,$3,'final',$4,'NE',$5::uuid,$6::jsonb,$7::smallint,$8::smallint,$9::jsonb,0)
      ${options.replay ? 'ON CONFLICT DO NOTHING' : ''}`,
    [id, options.kind === 'team_defense' ? 'NE' : 'synthetic-policy-player', options.kind ?? 'player',
      options.kind === 'team_defense' ? 'DEF' : 'QB', gameId, JSON.stringify(stats), ...counts, JSON.stringify(evidence)]);
  }

  async function seal(query: Query, id: string, version = 'sleeper-weekly-stats-v4') {
    await query(`INSERT INTO all_player_stat_observations
      (id,all_player_stat_content_id,provider,season,season_type,week,normalizer_version,source_revision,
       request_started_at,request_completed_at,observed_at,quality)
      VALUES (gen_random_uuid(),$1::uuid,'sleeper',2194,'reg',16,$2,$1::text,
        '2194-09-01T00:00:00Z','2194-09-01T00:01:00Z','2194-09-01T00:01:00Z','partial')`, [id, version]);
  }

  it('matches independent TypeScript and SQL derivation for versioned assumptions and rejected concealment', async () => {
    const bases: unknown[] = [missing, weekly(), weekly({ gmsActive: 1 }), weekly({ appearances: 0 }),
      weekly({ individualSnaps: { off_snp: 0, def_snp: 0, st_snp: 0 } }),
      weekly({ gmsActive: 1, individualSnaps: { st_snp: 0 } }),
      weekly({ gmsActive: 0 }), weekly({ gmsActive: 1, appearances: 0 }), weekly({ appearances: 1 }),
      weekly({ individualSnaps: { off_snp: 1 } }), weekly({ gmsActive: 0, appearances: 1 }),
      weekly({ appearances: 0, individualSnaps: { st_snp: 1 } }),
      weekly({ rawFlags: { gp: 'bad' } }), weekly({ rawFlags: { off_snp: -1 } }),
      weekly({ individualSnaps: { tm_off_snp: 1 } }), { ...missing, inventoryFingerprint: 'unproven' },
      null, {}, { kind: 'unknown-weekly-stat', source: 'weekly-stat-provider' }];
    const evidence: Json[] = bases.map(assumed);
    evidence.push({ ...assumed(missing), policy: 'different-policy' }, { ...assumed(missing), source: 'gamebook' },
      { ...assumed(missing), observedAt: '2194-09-01T00:00:00.000Z' },
      { ...assumed(missing), effectivePeriod: { ...period, seasonType: 'post' } },
      { ...assumed(missing), effectivePeriod: { ...period, week: 0 } });
    const cases = evidence.flatMap((item) => ([null, 0, 1] as const).flatMap((eligible) =>
      ([null, 0, 1] as const).map((appearance) => {
        const counts = allPlayerEligibilityCounts(item);
        return { evidence: item, eligible, appearance,
          expected: counts !== null && counts.eligibleGameCount === eligible && counts.appearanceGameCount === appearance };
      })));
    const rows = await ownerQuery<{ actual: boolean; expected: boolean }>(`SELECT
      all_player_eligibility_evidence_matches(evidence,eligible,appearance) AS actual,expected
      FROM jsonb_to_recordset($1::jsonb) AS input(evidence jsonb,eligible smallint,appearance smallint,expected boolean)`,
    [JSON.stringify(cases)]);
    expect(rows).toHaveLength(cases.length);
    expect(rows.filter((row) => row.actual !== row.expected)).toEqual([]);
  });

  it('retains independent unknown eligibility and assumed zero appearances through the runtime role', async () => {
    await withContent(async (query, id) => {
      await insertEntry(query, id, {}, assumed(missing), [null, 0]);
      await seal(query, id);
      expect((await query<{ eligible: number | null; appearance: number }>(`SELECT
        eligible_game_count AS eligible,appearance_game_count AS appearance FROM all_player_stat_entries
        WHERE all_player_stat_content_id=$1`, [id]))[0]).toEqual({ eligible: null, appearance: 0 });
    });
    await withContent(async (query, id) => {
      await insertEntry(query, id, { gms_active: 1 }, assumed(weekly({ gmsActive: 1 })), [1, 0]);
      await seal(query, id);
    });
  });

  it('keeps v2/v3 missing and clean weekly observations byte-identical on sealed replay', async () => {
    for (const version of ['sleeper-weekly-stats-v2','sleeper-weekly-stats-v3']) {
      await withContent(async (query, id) => {
        await insertEntry(query, id, { gms_active: 1 }, weekly({ gmsActive: 1 }), [null, null]);
        await seal(query, id, version);
        const before = await query('SELECT to_jsonb(entry) AS entry FROM all_player_stat_entries entry WHERE all_player_stat_content_id=$1', [id]);
        await insertEntry(query, id, { gms_active: 1 }, weekly({ gmsActive: 1 }), [null, null], { replay: true });
        expect(await query('SELECT to_jsonb(entry) AS entry FROM all_player_stat_entries entry WHERE all_player_stat_content_id=$1', [id]))
          .toEqual(before);
      }, version);
    }
  });

  it('rejects assumptions on old versions, defenses, wrong periods and hidden missing-row statistics', async () => {
    for (const version of ['sleeper-weekly-stats-v2','sleeper-weekly-stats-v3']) {
      await withContent(async (query, id) => {
        await expect(insertEntry(query, id, {}, assumed(missing), [null, 0])).rejects.toThrow(/v4 player observation/);
      }, version);
    }
    await withContent(async (query, id) => {
      await expect(insertEntry(query, id, {}, assumed(missing), [null, 0], { kind: 'team_defense' }))
        .rejects.toThrow(/v4 player observation/);
    });
    await withContent(async (query, id) => {
      await expect(insertEntry(query, id, {}, { ...assumed(missing), effectivePeriod: { ...period, week: 15 } }, [null, 0]))
        .rejects.toThrow(/does not match its content period/);
    });
    await withContent(async (query, id) => {
      await expect(insertEntry(query, id, { pass_yd: 40 }, assumed(missing), [null, 0]))
        .rejects.toThrow(/requires empty statistics/);
    });
  });

  it('binds raw weekly flags and all snaps beneath the policy wrapper and rejects unsupported count pairs', async () => {
    const invalid = [
      { stats: {}, evidence: assumed(weekly({ gmsActive: 1 })), counts: [1, 0], message: /flag disagrees/ },
      { stats: { off_snp: 2 }, evidence: assumed(weekly()), counts: [null, 0], message: /snap evidence disagrees/ },
      { stats: {}, evidence: weekly(), counts: [null, 0], message: /does not support its counts/ },
      { stats: {}, evidence: assumed(missing), counts: [null, 1], message: /does not support its counts/ },
      { stats: {}, evidence: assumed(missing), counts: [1, null], message: /does not support its counts/ },
    ] as const;
    for (const item of invalid) await withContent(async (query, id) => {
      await expect(insertEntry(query, id, item.stats, item.evidence, item.counts)).rejects.toThrow(item.message);
    });
  });

  it('does not permit a complete score set or pointer for an unknown-eligibility observation', async () => {
    await withContent(async (query, id) => {
      await insertEntry(query, id, {}, assumed(missing), [null, 0]);
      await seal(query, id);
      const counts = (await query<{ scores: number; pointers: number }>(`SELECT
        (SELECT count(*)::integer FROM all_player_scores WHERE all_player_stat_content_id=$1) AS scores,
        (SELECT count(*)::integer FROM current_all_player_score_sets WHERE season=2194 AND week=16) AS pointers`, [id]))[0];
      expect(counts).toEqual({ scores: 0, pointers: 0 });
    });
  });

  it('measures bounded v4 raw history, exact replay and later unchanged retrieval through the actual writer', async () => {
    const connection = await createPinnedIntegrationDatabase('owner');
    const query = connection.database.query;
    try {
      await query('BEGIN');
      await query("DELETE FROM projection_jobs WHERE job_key='all-player-ingestion:sleeper'");
      const store = createProjectionStore(connection.database);
      const claim = await store.acquireAllPlayerJob({ mode: 'backfill', period, workerId: '013-assumption-measurement',
        leaseSeconds: 120, deadlineAt: new Date(Date.now() + 110_000).toISOString() });
      if (claim.kind !== 'acquired') throw new Error('Synthetic policy measurement claim failed.');
      expect(await store.markAllPlayerRequest({ fence: claim.fence, period })).toBe(true);
      const evidence = assumed(missing) as AllPlayerAssumedNonParticipationEvidence;
      const observation: AllPlayerStatObservation = { provider: 'sleeper', ...period, normalizerVersion: 'sleeper-weekly-stats-v4',
        sourceRevision: `synthetic-policy-${randomUUID()}`, requestStartedAt: '2194-09-01T00:00:00.000Z',
        requestCompletedAt: '2194-09-01T00:01:00.000Z', observedAt: '2194-09-01T00:01:00.000Z',
        quality: 'partial', coverage: { complete: false, unknownEligibilityCount: 1000,
          unknownAppearanceCount: 0, assumedNonParticipationCount: 1000,
          participationAssumptionPolicy: 'missing-participation-as-zero-v1' }, warnings: [],
        entries: Array.from({ length: 1000 }, (_, index) => ({ entityKind: 'player',
          providerExternalId: `synthetic-policy-${index}`, nflGameId: gameId, nflTeam: 'NE', position: 'QB', stats: {},
          eligibilityEvidence: evidence, eligibleGameCount: null, appearanceGameCount: 0, gamePhase: 'final' })) };
      const measure = async () => query<{ name: string; heap_bytes: number; index_bytes: number; toast_aux_bytes: number; total_bytes: number }>(`SELECT
        relname AS name,pg_relation_size(oid)::integer AS heap_bytes,pg_indexes_size(oid)::integer AS index_bytes,
        (pg_table_size(oid)-pg_relation_size(oid))::integer AS toast_aux_bytes,pg_total_relation_size(oid)::integer AS total_bytes
        FROM pg_class WHERE relnamespace='public'::regnamespace AND relname=ANY($1::text[]) ORDER BY relname`,
      [['all_player_stat_contents','all_player_stat_entries','all_player_stat_observations']]);
      const before = await measure();
      const started = performance.now();
      const first = await store.recordAllPlayerBatch({ observation, scoreSets: [], verifiedAt: observation.observedAt, fence: claim.fence });
      const firstWallMs = performance.now() - started;
      if (first.kind !== 'stored') throw new Error('Synthetic v4 partial write failed.');
      expect(first.value.entriesStored).toBe(1000);
      await expect(store.recordAllPlayerBatch({ observation: { ...observation, quality: 'complete',
        coverage: { ...observation.coverage, complete: true } }, scoreSets: [],
      verifiedAt: observation.observedAt, fence: claim.fence })).rejects.toThrow(/eligibility/);
      const afterFirst = await measure();
      const replay = await store.recordAllPlayerBatch({ observation, scoreSets: [], verifiedAt: observation.observedAt, fence: claim.fence });
      if (replay.kind !== 'stored') throw new Error('Synthetic v4 replay failed.');
      expect(replay.value.entriesStored).toBe(0);
      expect(replay.value.statObservationId).toBe(first.value.statObservationId);
      const laterObservation = { ...observation, sourceRevision: `${observation.sourceRevision}-later`,
        requestStartedAt: '2194-09-01T12:00:00.000Z', requestCompletedAt: '2194-09-01T12:01:00.000Z',
        observedAt: '2194-09-01T12:01:00.000Z' };
      const laterStarted = performance.now();
      const later = await store.recordAllPlayerBatch({ observation: laterObservation, scoreSets: [],
        verifiedAt: laterObservation.observedAt, fence: claim.fence });
      const laterWallMs = performance.now() - laterStarted;
      if (later.kind !== 'stored') throw new Error('Synthetic later v4 observation failed.');
      expect(later.value.entriesStored).toBe(0);
      expect(later.value.statContentId).toBe(first.value.statContentId);
      const afterLater = await measure();
      const count = (await query<{ entries: number; unknown_eligible: number; zero_appearances: number; observations: number }>(`SELECT
        count(*)::integer AS entries,count(*) FILTER(WHERE eligible_game_count IS NULL)::integer AS unknown_eligible,
        count(*) FILTER(WHERE appearance_game_count=0)::integer AS zero_appearances,
        (SELECT count(*)::integer FROM all_player_stat_observations WHERE all_player_stat_content_id=$1) AS observations
        FROM all_player_stat_entries WHERE all_player_stat_content_id=$1`, [first.value.statContentId]))[0];
      expect(count).toEqual({ entries: 1000, unknown_eligible: 1000, zero_appearances: 1000, observations: 2 });
      await writeFile(new URL('../release/013-assumption-capacity.integration.json', import.meta.url), `${JSON.stringify({
        observedAt: new Date().toISOString(), kind: 'synthetic-1000-player-partial-assumption', providerRequests: 0,
        limitation: 'Bounded synthetic raw-history allocation only; no source completion or whole-season fit claim. All writes roll back.',
        before, afterFirst, afterLater, count, entriesStored: [1000, 0, 0], firstWallMs, laterWallMs,
      }, null, 2)}\n`);
    } finally { try { await query('ROLLBACK'); } finally { await connection.close(); } }
  }, 120_000);
});
