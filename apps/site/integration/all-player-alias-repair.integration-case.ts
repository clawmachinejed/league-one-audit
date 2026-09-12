import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { createPinnedIntegrationDatabase, ownerQuery, type IndependentDatabase } from './neon-integration-harness';

const BAD_ENTITY = '10ae356b-990f-5ed1-8b31-2fd98dd5acbd';
const SYNTHETIC_DEPLOYED_SHA = 'a'.repeat(40);
const repairSql = readFile(new URL('../release/retire-4429835-8063.sql', import.meta.url), 'utf8');
type Query = IndependentDatabase['database']['query'];
type Fixture = Readonly<{ query: Query; profileId: string; gameId: string; observationId: string; unrelatedEntityId: string }>;

/** Every fixture and lease adjustment remains inside a rolled-back owner
 * transaction in the existing sentinel-guarded, serial integration suite. */
async function withFixture(run: (fixture: Fixture) => Promise<void>): Promise<void> {
  const connection = await createPinnedIntegrationDatabase('owner');
  const query = connection.database.query;
  try {
    await query('BEGIN');
    // Other serial test files can leave synthetic leases live. Restore them
    // exactly through the enclosing rollback; never reset the shared schema.
    await query(`UPDATE projection_jobs SET lease_until = clock_timestamp() - interval '1 second'
      WHERE state = 'running' AND lease_until > clock_timestamp()`);
    const rows = await query<{
      profile_id: string; game_id: string; observation_id: string; unrelated_entity_id: string;
    }>(`WITH profile AS (
      INSERT INTO scoring_profiles (rules_hash,rules) VALUES ($1,'{"pass_td":4}'::jsonb) RETURNING id
    ), entities AS (
      INSERT INTO scoring_entities (id,kind,display_name,nfl_team) VALUES
        ($2::uuid,'player','Synthetic false pairing','SEA'),
        ($3::uuid,'player','Synthetic unaffected identity','ATL') RETURNING id
    ), aliases AS (
      INSERT INTO external_scoring_entity_ids
        (provider,entity_kind,external_id,scoring_entity_id,mapping_status,valid_from)
      SELECT provider,'player',external_id,entities.id,'verified',now()-interval '1 day'
      FROM entities CROSS JOIN (VALUES ('tank01','4429835'),('sleeper','8063')) source(provider,external_id)
      WHERE entities.id=$2::uuid RETURNING external_id
    ), game AS (
      INSERT INTO nfl_games (season,season_type,week,home_team,away_team,kickoff_at)
      VALUES (2196,'reg',18,'SEA','ATL',now()+interval '1 day') RETURNING id
    ), runs AS (
      INSERT INTO pregame_projection_runs (provider,season,season_type,week,model_version,
        source_revision,request_started_at,request_completed_at,fetched_at,quality)
      SELECT 'tank01',2196,'reg',18,'alias-repair-fixture',$1 || ':' || ordinal::text,
        now()-interval '2 minutes',now()-interval '1 minute',now()-interval '1 minute','complete'
      FROM generate_series(1,4) ordinal RETURNING id
    ), candidates AS (
      INSERT INTO pregame_projection_candidates
        (projection_run_id,nfl_game_id,scoring_entity_id,scoring_profile_id,projection_points,projected_stats)
      SELECT runs.id,game.id,entities.id,profile.id,3.25,'{"rush_yd":32.5}'::jsonb
      FROM runs CROSS JOIN game CROSS JOIN profile CROSS JOIN entities
      WHERE entities.id=$2::uuid RETURNING projection_run_id
    ), league AS (
      INSERT INTO leagues (league_key,name) VALUES ($1,'Synthetic alias repair') RETURNING id
    ), season AS (
      INSERT INTO league_seasons (league_id,season,scoring_profile_id)
      SELECT league.id,2196,profile.id FROM league CROSS JOIN profile RETURNING id
    ), observation AS (
      INSERT INTO league_week_observations (league_season_id,provider,week,source_revision,
        request_started_at,request_completed_at,observed_at,quality)
      SELECT season.id,'sleeper',18,$1,now(),now(),now(),'complete' FROM season RETURNING id
    ), unrelated_point AS (
      INSERT INTO official_player_point_observations
        (league_week_observation_id,external_roster_id,scoring_entity_id,points,is_starter)
      SELECT observation.id,'unrelated',entities.id,4.1,false FROM observation CROSS JOIN entities
      WHERE entities.id=$3::uuid RETURNING scoring_entity_id
    ) SELECT profile.id::text AS profile_id,game.id::text AS game_id,
      observation.id::text AS observation_id,unrelated_point.scoring_entity_id::text AS unrelated_entity_id
      FROM profile CROSS JOIN game CROSS JOIN observation CROSS JOIN unrelated_point`,
    [`alias-repair-${randomUUID()}`, BAD_ENTITY, randomUUID()]);
    expect(rows).toHaveLength(1);
    await query(`SELECT set_config('league_one.alias_repair_authorization',$1,true),
      set_config('league_one.alias_repair_application_sha',$2,true),
      set_config('league_one.alias_repair_expected_candidates','4',true)`,
    ['retire-tank01-4429835-sleeper-8063', SYNTHETIC_DEPLOYED_SHA]);
    await run({ query, profileId: rows[0].profile_id, gameId: rows[0].game_id,
      observationId: rows[0].observation_id, unrelatedEntityId: rows[0].unrelated_entity_id });
  } finally {
    try { await query('ROLLBACK'); } finally { await connection.close(); }
  }
}

async function snapshot(query: Query) {
  const rows = await query<{ evidence: Record<string, unknown> }>(`SELECT jsonb_build_object(
    'aliases',(SELECT jsonb_agg(to_jsonb(mapping) ORDER BY provider,external_id)
      FROM external_scoring_entity_ids mapping WHERE entity_kind='player'
        AND ((provider='tank01' AND external_id='4429835') OR (provider='sleeper' AND external_id IN ('8063','12048')))),
    'entity',(SELECT to_jsonb(entity) FROM scoring_entities entity WHERE id=$1::uuid),
    'candidates',(SELECT jsonb_agg(to_jsonb(candidate) ORDER BY projection_run_id)
      FROM pregame_projection_candidates candidate WHERE scoring_entity_id=$1::uuid),
    'baselines',(SELECT jsonb_agg(to_jsonb(baseline) ORDER BY source_projection_run_id)
      FROM pregame_projection_baselines baseline WHERE scoring_entity_id=$1::uuid),
    'officialPoints',(SELECT jsonb_agg(to_jsonb(points) ORDER BY league_week_observation_id,external_roster_id,scoring_entity_id)
      FROM official_player_point_observations points),
    'jobs',(SELECT jsonb_agg(to_jsonb(job) ORDER BY job_key) FROM projection_jobs job)
    ) AS evidence`, [BAD_ENTITY]);
  return rows[0].evidence;
}

async function expectRepairRejected(fixture: Fixture, message: RegExp) {
  const before = await snapshot(fixture.query);
  await fixture.query('SAVEPOINT attempted_repair');
  await expect(fixture.query(await repairSql)).rejects.toThrow(message);
  await fixture.query('ROLLBACK TO SAVEPOINT attempted_repair');
  expect(await snapshot(fixture.query)).toEqual(before);
}

describe('reviewed exact alias retirement SQL in the isolated owner harness', () => {
  it('retires only the false projection alias, preserving official identity and immutable references', async () => {
    await withFixture(async ({ query }) => {
      const before = await snapshot(query);
      await query(await repairSql);
      const after = await snapshot(query);
      expect(after).toEqual({ ...before, aliases: expect.any(Array) });
      const aliases = after.aliases as Array<Record<string, unknown>>;
      const original = before.aliases as Array<Record<string, unknown>>;
      expect(aliases).toHaveLength(2);
      expect(aliases.find((row) => row.provider === 'sleeper')).toEqual(original.find((row) => row.provider === 'sleeper'));
      expect(aliases.find((row) => row.provider === 'tank01')).toEqual({
        ...original.find((row) => row.provider === 'tank01'), mapping_status: 'retired', valid_to: expect.any(String),
      });
      expect(after.candidates).toHaveLength(4);
      expect(aliases.some((row) => row.external_id === '12048')).toBe(false);
    });
  });

  it('replays the exact script without changing retirement time or retained references', async () => {
    await withFixture(async ({ query }) => {
      await query(await repairSql);
      const retired = await snapshot(query);
      await query(await repairSql);
      expect(await snapshot(query)).toEqual(retired);
    });
  });

  it('preserves the historical retirement time of an already applied correction', async () => {
    await withFixture(async ({ query }) => {
      await query(`UPDATE external_scoring_entity_ids SET mapping_status='retired',valid_to=now()-interval '1 hour'
        WHERE provider='tank01' AND entity_kind='player' AND external_id='4429835'`);
      const retired = await snapshot(query);
      await query(await repairSql);
      expect(await snapshot(query)).toEqual(retired);
    });
  });

  it.each(['candidate-count','baseline','official-points'] as const)('aborts when reviewed %s references differ', async (variant) => {
    await withFixture(async (fixture) => {
      if (variant === 'candidate-count') await fixture.query(
        "SELECT set_config('league_one.alias_repair_expected_candidates','3',true)",
      );
      if (variant === 'baseline') await fixture.query(`INSERT INTO pregame_projection_baselines
        (nfl_game_id,scoring_entity_id,scoring_profile_id,projection_provider,model_version,
          source_projection_run_id,projection_points,projected_stats,frozen_at)
        SELECT nfl_game_id,scoring_entity_id,scoring_profile_id,'tank01','alias-repair-fixture',
          projection_run_id,projection_points,projected_stats,now()
        FROM pregame_projection_candidates WHERE scoring_entity_id=$1::uuid LIMIT 1`, [BAD_ENTITY]);
      if (variant === 'official-points') await fixture.query(`INSERT INTO official_player_point_observations
        (league_week_observation_id,external_roster_id,scoring_entity_id,points,is_starter)
        VALUES ($1::uuid,'affected',$2::uuid,0,false)`, [fixture.observationId, BAD_ENTITY]);
      await expectRepairRejected(fixture, /affected references changed/u);
    });
  });

  it('aborts on any live job owner, including an unrelated existing worker lane', async () => {
    await withFixture(async (fixture) => {
      await fixture.query(`INSERT INTO projection_jobs
        (job_key,job_type,scheduled_for,state,lease_owner,lease_until)
        VALUES ($1,'projection-sync',now(),'running','alias-race-owner',now()+interval '1 minute')`,
      [`alias-live-${randomUUID()}`]);
      await expectRepairRejected(fixture, /live ownership/u);
    });
  });

  it('aborts if the reviewed projection alias points to a different canonical entity', async () => {
    await withFixture(async (fixture) => {
      await fixture.query(`UPDATE external_scoring_entity_ids SET scoring_entity_id=$1::uuid
        WHERE provider='tank01' AND entity_kind='player' AND external_id='4429835'`, [fixture.unrelatedEntityId]);
      await expectRepairRejected(fixture, /canonical pairing has changed/u);
    });
  });

  it.each(['authorization','application-sha'] as const)('requires the exact reviewed %s precondition', async (variant) => {
    await withFixture(async (fixture) => {
      await fixture.query('SELECT set_config($1,$2,true)', [
        variant === 'authorization' ? 'league_one.alias_repair_authorization' : 'league_one.alias_repair_application_sha',
        'unreviewed',
      ]);
      await expectRepairRejected(fixture, variant === 'authorization' ? /authorization is missing/u : /application revision is missing/u);
    });
  });

  it('denies the release script to the runtime role and restores the transaction after rejection', async () => {
    const before = await snapshot(ownerQuery);
    const connection = await createPinnedIntegrationDatabase('runtime');
    try {
      await connection.database.query('BEGIN');
      await expect(connection.database.query(await repairSql)).rejects.toThrow(/permission denied/u);
    } finally {
      try { await connection.database.query('ROLLBACK'); } finally { await connection.close(); }
    }
    expect(await snapshot(ownerQuery)).toEqual(before);
  });

  it('rolls back a successful retirement if the surrounding release transaction fails', async () => {
    await withFixture(async ({ query }) => {
      const before = await snapshot(query);
      await query('SAVEPOINT release_sequence');
      await query(await repairSql);
      await expect(query("DO $$ BEGIN RAISE EXCEPTION 'synthetic later release failure'; END $$"))
        .rejects.toThrow(/synthetic later release failure/u);
      await query('ROLLBACK TO SAVEPOINT release_sequence');
      expect(await snapshot(query)).toEqual(before);
    });
  });
});
