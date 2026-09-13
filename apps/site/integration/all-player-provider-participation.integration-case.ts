import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';
import { createProjectionStore } from '../lib/projection-store';
import type { AllPlayerStatObservation } from '../lib/projections/domain/all-player-statistics';
import type { AllPlayerProviderContext } from '../lib/projections/domain/all-player-provider-context';
import { createPinnedIntegrationDatabase, ownerQuery, type IndependentDatabase } from './neon-integration-harness';

type Query = IndependentDatabase['database']['query'];
type Evidence = Record<string, unknown>;
const weekly = (fields: Evidence = {}): Evidence => ({ kind: 'weekly-stat', source: 'weekly-stat-provider', ...fields });
const ineligible = { kind: 'explicit-ineligible', source: 'manual-review', reason: 'inactive',
  sourceRevision: 'synthetic-reviewed-period', observedAt: '2195-09-01T00:00:00.000Z',
  effectivePeriod: { season: 2195, seasonType: 'reg', week: 17 } };
const period = (decision: string, evidence: Evidence) => ({ ...ineligible, kind: 'period-participation',
  decision, reason: 'Synthetic isolated participation evidence', weekly: evidence });

describe('012 provider participation guards in the isolated runtime database', () => {
  let gameId: string;
  beforeAll(async () => {
    gameId = (await ownerQuery<{ id: string }>(`INSERT INTO nfl_games
      (season,season_type,week,home_team,away_team,kickoff_at)
      VALUES (2195,'reg',17,'NE','NYJ','2195-09-01T00:00:00Z') RETURNING id::text`))[0].id;
  });

  async function withContent(run: (query: Query, contentId: string) => Promise<void>, version = 'sleeper-weekly-stats-v3') {
    const connection = await createPinnedIntegrationDatabase('runtime');
    const query = connection.database.query;
    try {
      await query('BEGIN');
      const contentId = randomUUID();
      await query(`INSERT INTO all_player_stat_contents
        (id,provider,season,season_type,week,normalizer_version,semantic_hash,quality,coverage,warnings,entry_count)
        VALUES ($1::uuid,'sleeper',2195,'reg',17,$2,$3,'partial','{"complete":false}','[]',1)`,
      [contentId, version, randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '')]);
      await run(query, contentId);
    } finally {
      try { await query('ROLLBACK'); } finally { await connection.close(); }
    }
  }

  async function insertEntry(query: Query, contentId: string, stats: Evidence, evidence: Evidence,
    counts: readonly [number | null, number | null] = [null, null],
    options: { kind?: 'player' | 'team_defense'; gameId?: string | null; replay?: boolean } = {}) {
    return query(`INSERT INTO all_player_stat_entries
      (all_player_stat_content_id,provider_external_id,entity_kind,game_phase,position,nfl_team,
       nfl_game_id,stats,eligible_game_count,appearance_game_count,eligibility_evidence,ordinal)
      VALUES ($1::uuid,$2,$3,'final',$4,'NE',$5::uuid,$6::jsonb,$7::smallint,$8::smallint,$9::jsonb,0)
      ${options.replay ? 'ON CONFLICT DO NOTHING' : ''}`,
    [contentId, options.kind === 'team_defense' ? 'NE' : 'synthetic-participant', options.kind ?? 'player',
      options.kind === 'team_defense' ? 'DEF' : 'QB', options.gameId === undefined ? gameId : options.gameId,
      JSON.stringify(stats), counts[0], counts[1], JSON.stringify(evidence)]);
  }

  async function insertObservation(query: Query, contentId: string, context: unknown,
    version = 'sleeper-weekly-stats-v3', observationId = randomUUID()) {
    return query(`INSERT INTO all_player_stat_observations
      (id,all_player_stat_content_id,provider,season,season_type,week,normalizer_version,source_revision,
       request_started_at,request_completed_at,observed_at,quality,provider_context)
      VALUES ($1::uuid,$2::uuid,'sleeper',2195,'reg',17,$3,$1::text,'2195-09-01T00:00:00Z',
        '2195-09-01T00:01:00Z','2195-09-01T00:01:00Z','partial',$4::jsonb)`,
    [observationId, contentId, version, context === null ? null : JSON.stringify(context)]);
  }

  function context(): AllPlayerProviderContext {
    return { version: 'catalog-status-context-v1', role: 'context-only', source: 'official-player-catalog',
      sourceRevision: `sha256:${'b'.repeat(64)}`, observedAt: '2195-09-01T00:00:30.000Z', effectivePeriod: null,
      players: [{ providerExternalId: 'synthetic-participant', nflGameId: gameId,
        currentTeam: 'SEA', status: 'Inactive', active: false, injuryStatus: 'Out' }] };
  }

  it('matches SQL eligibility across positive snaps, zeros, malformed values, and nested contradictions', async () => {
    const cases: Array<{ evidence: Evidence; eligible: number | null; appearance: number | null; valid: boolean }> = [];
    const add = (evidence: Evidence, eligible: number | null, appearance: number | null, valid = true) =>
      cases.push({ evidence, eligible, appearance, valid });
    for (const key of ['off_snp','def_snp','st_snp']) {
      add(weekly({ individualSnaps: { [key]: 1 } }), 1, 1);
      add(weekly({ individualSnaps: { [key]: 0 } }), null, null);
      add(weekly({ gmsActive: 0, individualSnaps: { [key]: 1 } }), null, null);
      add(weekly({ appearances: 0, individualSnaps: { [key]: 1 } }), null, null);
      add(weekly({ appearances: 1, individualSnaps: { [key]: 0 } }), 1, 1);
      for (const invalid of [-1, 0.5, 9007199254740992, '1', null, true]) {
        add(weekly({ rawFlags: { [key]: invalid } }), null, null);
        add(weekly({ individualSnaps: { [key]: invalid } }), null, null, false);
      }
      add(weekly({ rawFlags: { [key]: 1 } }), null, null, false);
      add(weekly({ individualSnaps: { [key]: 1 }, rawFlags: { [key]: 'bad' } }), null, null, false);
    }
    add(weekly({ individualSnaps: {} }), null, null, false);
    add(weekly({ individualSnaps: { tm_off_snp: 1 } }), 1, 1, false);
    add(weekly({ gmsActive: 1 }), null, null);
    add(weekly({ gmsActive: 0, appearances: 1 }), null, null);
    add(weekly({ gmsActive: 1, appearances: 0 }), 1, 0);
    add(weekly({ gmsActive: 1, rawFlags: { gms_active: 'bad' } }), null, null, false);
    add(weekly({ appearances: 1, rawFlags: { gp: 'bad' } }), null, null, false);
    for (const conflicting of [weekly({ appearances: 0, individualSnaps: { off_snp: 1 } }),
      weekly({ rawFlags: { st_snp: 'bad' } })]) {
      for (const decision of ['appearance','dressed-unused','ineligible','ambiguous']) {
        add(period(decision, conflicting), null, null);
        add(period(decision, conflicting), 1, 1, false);
      }
      add({ kind: 'conflict', weekly: conflicting, ineligibility: ineligible }, null, null);
      add({ kind: 'combined-ineligible', weekly: conflicting, ineligibility: ineligible }, 0, 0, false);
    }
    const rows = await ownerQuery<{ actual: boolean; expected: boolean }>(`SELECT
      all_player_eligibility_evidence_matches(evidence,eligible,appearance) AS actual,valid AS expected
      FROM jsonb_to_recordset($1::jsonb) AS input(evidence jsonb,eligible smallint,appearance smallint,valid boolean)`,
    [JSON.stringify(cases)]);
    expect(rows).toHaveLength(cases.length);
    expect(rows.filter((row) => row.actual !== row.expected)).toEqual([]);
  });

  it('stores positive individual snaps with exact game context and null partial pointers', async () => {
    await withContent(async (query, id) => {
      await insertEntry(query, id, { off_snp: 2 }, weekly({ individualSnaps: { off_snp: 2 } }), [1, 1]);
      await insertObservation(query, id, null);
      expect((await query<{ eligible: number; appearance: number }>(`SELECT eligible_game_count AS eligible,
        appearance_game_count AS appearance FROM all_player_stat_entries WHERE all_player_stat_content_id=$1`, [id]))[0])
        .toEqual({ eligible: 1, appearance: 1 });
      expect((await query<{ count: number }>(`SELECT count(*)::integer AS count FROM current_all_player_score_sets
        WHERE season=2195 AND week=17`))[0].count).toBe(0);
    });
  });

  it('preserves old v2 sealed replay with snap statistics that were not eligibility evidence', async () => {
    await withContent(async (query, id) => {
      const evidence = weekly({ gmsActive: 1 });
      await insertEntry(query, id, { gms_active: 1, off_snp: 2 }, evidence);
      await insertObservation(query, id, null, 'sleeper-weekly-stats-v2');
      await insertEntry(query, id, { gms_active: 1, off_snp: 2 }, evidence, [null, null], { replay: true });
      expect((await query<{ count: number }>(`SELECT count(*)::integer AS count FROM all_player_stat_entries
        WHERE all_player_stat_content_id=$1`, [id]))[0].count).toBe(1);
    }, 'sleeper-weekly-stats-v2');
  });

  it('rejects v3 missing, invented, and mismatched raw snap evidence through the runtime role', async () => {
    const cases = [
      { stats: { off_snp: 1 }, evidence: weekly(), message: /snap evidence disagrees/ },
      { stats: {}, evidence: weekly({ individualSnaps: { off_snp: 1 } }), message: /snap evidence disagrees/ },
      { stats: { off_snp: 2 }, evidence: weekly({ individualSnaps: { off_snp: 1 } }), message: /snap evidence disagrees/ },
      { stats: { gp: 1 }, evidence: { kind: 'unknown-weekly-stat', source: 'weekly-stat-provider' }, message: /require weekly evidence/ },
      { stats: { off_snp: 1 }, evidence: ineligible, message: /require weekly evidence/ },
    ];
    for (const item of cases) await withContent(async (query, id) => {
      const counts: [number | null, number | null] = item.evidence === ineligible ? [0, 0]
        : 'individualSnaps' in item.evidence ? [1, 1] : [null, null];
      await expect(insertEntry(query, id, item.stats, item.evidence, counts)).rejects.toThrow(item.message);
    });
  });

  it('retains malformed numeric flags and omits malformed nonnumeric stats with faithful null counts', async () => {
    for (const raw of [-1, 0.5, 'bad', null]) await withContent(async (query, id) => {
      await insertEntry(query, id, typeof raw === 'number' ? { off_snp: raw } : {},
        weekly({ rawFlags: { off_snp: raw } }));
      await insertObservation(query, id, null);
    });
  });

  it('requires player identity and exact requested game for positive snap evidence', async () => {
    await withContent(async (query, id) => {
      await expect(insertEntry(query, id, { off_snp: 1 }, weekly({ individualSnaps: { off_snp: 1 } }),
        [1, 1], { kind: 'team_defense' })).rejects.toThrow(/requires a player identity/);
    });
    await withContent(async (query, id) => {
      await expect(insertEntry(query, id, { off_snp: 1 }, weekly({ individualSnaps: { off_snp: 1 } }),
        [1, 1], { gameId: null })).rejects.toThrow(/requires an NFL game/);
    });
  });

  it('retains advisory current status only on observations and preserves immutable historical content', async () => {
    await withContent(async (query, id) => {
      await insertEntry(query, id, { off_snp: 2 }, weekly({ individualSnaps: { off_snp: 2 } }), [1, 1]);
      const observationId = randomUUID();
      await insertObservation(query, id, context(), 'sleeper-weekly-stats-v3', observationId);
      const laterContext = { ...context(), observedAt: '2195-09-01T00:00:40.000Z' };
      await insertObservation(query, id, laterContext);
      const result = (await query<{ contents: number; entries: number; observations: number; eligible: number }>(`SELECT
        (SELECT count(*)::integer FROM all_player_stat_contents WHERE id=$1) AS contents,
        (SELECT count(*)::integer FROM all_player_stat_entries WHERE all_player_stat_content_id=$1) AS entries,
        (SELECT count(*)::integer FROM all_player_stat_observations WHERE all_player_stat_content_id=$1) AS observations,
        (SELECT eligible_game_count FROM all_player_stat_entries WHERE all_player_stat_content_id=$1) AS eligible`, [id]))[0];
      expect(result).toEqual({ contents: 1, entries: 1, observations: 2, eligible: 1 });
      await expect(query('UPDATE all_player_stat_observations SET provider_context=NULL WHERE id=$1', [observationId]))
        .rejects.toThrow(/permission denied|immutable/);
    });
  });

  it('rejects direct SQL context forgery, duplicate identities, future timestamps, and excessive metadata', async () => {
    const invalid: Array<{ value: unknown; message: RegExp }> = [
      { value: { ...context(), effectivePeriod: { season: 2195, seasonType: 'reg', week: 17 } }, message: /invalid shape/ },
      { value: { ...context(), observedAt: '2195-09-01T00:02:00.000Z' }, message: /observation time/ },
      { value: { ...context(), players: [...context().players, ...context().players] }, message: /duplicate/ },
      { value: { ...context(), players: [{ ...context().players[0], nflGameId: randomUUID() }] }, message: /observed player and game/ },
      { value: { ...context(), players: [{ ...context().players[0], providerExternalId: 'NE' }] }, message: /observed player and game/ },
      { value: { ...context(), players: [{ ...context().players[0], status: 'x'.repeat(129) }] }, message: /invalid player metadata/ },
      { value: { ...context(), players: [{ ...context().players[0], status: ' Active ' }] }, message: /invalid player metadata/ },
      { value: { ...context(), role: 'eligibility-proof' }, message: /invalid shape/ },
      { value: { ...context(), extra: 'x'.repeat(1200001) }, message: /invalid shape/ },
    ];
    for (const item of invalid) await withContent(async (query, id) => {
      await insertEntry(query, id, {}, weekly());
      await expect(insertObservation(query, id, item.value)).rejects.toThrow(item.message);
    });
  });

  it('measures actual writer reuse for 4,356 synthetic players when only catalog context changes', async () => {
    const connection = await createPinnedIntegrationDatabase('owner');
    const query = connection.database.query;
    try {
      await query('BEGIN');
      // Confine this synthetic claim and every data write to one owner rollback.
      // Direct-runtime guard tests above independently prove least privilege.
      await query("DELETE FROM projection_jobs WHERE job_key='all-player-ingestion:sleeper'");
      const store = createProjectionStore(connection.database);
      const claim = await store.acquireAllPlayerJob({ mode: 'backfill',
        period: { season: 2195, seasonType: 'reg', week: 17 }, workerId: '012-context-measurement',
        leaseSeconds: 120, deadlineAt: new Date(Date.now() + 110_000).toISOString() });
      if (claim.kind !== 'acquired') throw new Error('Synthetic measurement claim failed.');
      expect(await store.markAllPlayerRequest({ fence: claim.fence,
        period: { season: 2195, seasonType: 'reg', week: 17 } })).toBe(true);
      const entries: AllPlayerStatObservation['entries'] = Array.from({ length: 4356 }, (_, index) => ({
        providerExternalId: `synthetic-context-${index}`, entityKind: 'player',
        position: 'QB', nflTeam: 'NE', nflGameId: gameId, gamePhase: 'final', stats: { gms_active: 1 },
        eligibleGameCount: null, appearanceGameCount: null,
        eligibilityEvidence: { kind: 'weekly-stat', source: 'weekly-stat-provider', gmsActive: 1 },
      }));
      const initial: AllPlayerStatObservation = { provider: 'sleeper', season: 2195, seasonType: 'reg', week: 17,
        normalizerVersion: 'sleeper-weekly-stats-v3', sourceRevision: `context-measurement-${randomUUID()}`,
        requestStartedAt: '2195-09-01T00:00:00.000Z', requestCompletedAt: '2195-09-01T00:01:00.000Z',
        observedAt: '2195-09-01T00:01:00.000Z', quality: 'partial', coverage: { complete: false }, warnings: [], entries,
        providerContext: { ...context(), players: entries.map((entry) => ({ providerExternalId: entry.providerExternalId,
          nflGameId: entry.nflGameId, currentTeam: 'NE', status: 'Active', active: true })) } };
      const measure = async () => (await query<{ table_name: string; heap_bytes: number; indexes_bytes: number;
        toast_and_auxiliary_bytes: number; total_bytes: number }>(`SELECT relname AS table_name,
        pg_relation_size(oid)::integer AS heap_bytes,pg_indexes_size(oid)::integer AS indexes_bytes,
        (pg_table_size(oid)-pg_relation_size(oid))::integer AS toast_and_auxiliary_bytes,
        pg_total_relation_size(oid)::integer AS total_bytes FROM pg_class
        WHERE relnamespace='public'::regnamespace AND relname=ANY($1::text[]) ORDER BY relname`,
      [['all_player_stat_contents','all_player_stat_entries','all_player_stat_observations']]));
      const before = await measure();
      const started = performance.now();
      const first = await store.recordAllPlayerBatch({ observation: initial, scoreSets: [],
        verifiedAt: initial.observedAt, fence: claim.fence });
      const firstWallMs = performance.now() - started;
      if (first.kind !== 'stored') throw new Error('Synthetic context write failed.');
      expect(first.value.entriesStored).toBe(4356);
      const afterInitial = await measure();
      const changed: AllPlayerStatObservation = { ...initial,
        sourceRevision: `${initial.sourceRevision}-later`, requestStartedAt: '2195-09-01T12:00:00.000Z',
        requestCompletedAt: '2195-09-01T12:01:00.000Z', observedAt: '2195-09-01T12:01:00.000Z',
        providerContext: { ...initial.providerContext!, sourceRevision: `sha256:${'c'.repeat(64)}`,
          observedAt: '2195-09-01T12:00:30.000Z', players: initial.providerContext!.players.map((player) => ({
            ...player, status: 'Inactive', active: false, injuryStatus: 'Out' })) } };
      const laterStarted = performance.now();
      const later = await store.recordAllPlayerBatch({ observation: changed, scoreSets: [],
        verifiedAt: changed.observedAt, fence: claim.fence });
      const laterWallMs = performance.now() - laterStarted;
      if (later.kind !== 'stored') throw new Error('Synthetic later context write failed.');
      expect(later.value.entriesStored).toBe(0);
      expect(later.value.statContentId).toBe(first.value.statContentId);
      expect(later.value.semanticHash).toBe(first.value.semanticHash);
      expect(later.value.statObservationId).not.toBe(first.value.statObservationId);
      const afterContextChange = await measure();
      const rows = (await query<{ entries: number; observations: number; context_bytes: number }>(`SELECT
        (SELECT count(*)::integer FROM all_player_stat_entries WHERE all_player_stat_content_id=$1) AS entries,
        count(*)::integer AS observations,sum(pg_column_size(provider_context))::integer AS context_bytes
        FROM all_player_stat_observations WHERE all_player_stat_content_id=$1`, [first.value.statContentId]))[0];
      expect(rows.entries).toBe(4356);
      expect(rows.observations).toBe(2);
      const replay = await store.recordAllPlayerBatch({ observation: initial, scoreSets: [],
        verifiedAt: initial.observedAt, fence: claim.fence });
      expect(replay.kind === 'stored' && replay.value.entriesStored).toBe(0);
      await query('SAVEPOINT conflicting_context_replay');
      await expect(store.recordAllPlayerBatch({ observation: { ...initial,
        providerContext: { ...initial.providerContext!, players: changed.providerContext!.players } },
      scoreSets: [], verifiedAt: initial.observedAt, fence: claim.fence })).rejects.toThrow();
      await query('ROLLBACK TO SAVEPOINT conflicting_context_replay');
      const artifact = { observedAt: new Date().toISOString(), kind: 'synthetic-partial-context-only',
        limitation: 'Synthetic 4356 player entries; no actual complete-period evidence or season fit proof. Transaction rolls back. Physical allocation is measured, not inferred from JSON.',
        providerRequests: 0, rows, before, afterInitial, afterContextChange,
        rawEntriesStored: [first.value.entriesStored, later.value.entriesStored],
        writeWallMs: [firstWallMs, laterWallMs], eachWriteWithin55Seconds: firstWallMs < 55000 && laterWallMs < 55000,
        compactContextBytes: [initial, changed].map((observation) => Buffer.byteLength(JSON.stringify(observation.providerContext))),
      };
      await writeFile(new URL('../release/012-context-capacity.integration.json', import.meta.url), `${JSON.stringify(artifact, null, 2)}\n`);
    } finally {
      try { await query('ROLLBACK'); } finally { await connection.close(); }
    }
  }, 120_000);
});
