import { expect } from 'vitest';
import type { DatabaseClient } from '../lib/database';
import type { ProjectionStore } from '../lib/projection-store';
import { enrollIntegrationSeason } from './administration-enrollment-fixture';

type Batch = Parameters<ProjectionStore['recordAllPlayerBatch']>[0];

/** Runs inside the caller's rolled-back owner transaction, using the existing
 * complete all-player fixture and scorer rather than a second scoring pipeline. */
export async function verifyEnrolledPublication(input: {
  query: DatabaseClient['query']; store: ProjectionStore; original: Batch;
  buildExpanded: (league: { leagueSeasonId: string; scoringProfileId: string }, weight: number) => Promise<Batch>;
}) {
  const { query, store, original } = input;
  const season = original.observation.season;
  const first = await store.recordAllPlayerBatch(original);
  expect(first.kind).toBe('stored');
  const readiness = () => query<{ ready: boolean }>(`SELECT public.all_player_score_set_is_publication_ready(
    pointer.all_player_score_set_id,$2::jsonb,pointer.all_player_stat_observation_id) AS ready
    FROM current_all_player_score_sets pointer WHERE season=$1 ORDER BY scoring_profile_id`,
  [season, JSON.stringify(original.scoreSets.map(set => set.scoringProfileId).sort())]);
  const snapshot = () => query(`SELECT
    (SELECT count(*)::integer FROM all_player_stat_contents) AS contents,
    (SELECT count(*)::integer FROM all_player_stat_entries) AS entries,
    (SELECT count(*)::integer FROM all_player_stat_observations) AS observations,
    (SELECT count(*)::integer FROM all_player_scores) AS scores,
    (SELECT jsonb_agg(to_jsonb(row) ORDER BY id) FROM all_player_league_acceptances row) AS acceptances,
    (SELECT jsonb_agg(to_jsonb(row) ORDER BY league_season_id,provider,season,season_type,week,scorer_version)
      FROM current_all_player_league_scores row) AS league_heads,
    (SELECT count(*)::integer FROM all_player_score_sets) AS score_sets,
    (SELECT count(*)::integer FROM all_player_score_verifications) AS verifications,
    (SELECT jsonb_agg(to_jsonb(pointer) ORDER BY scoring_profile_id)
      FROM current_all_player_score_sets pointer WHERE season=$1) AS pointers`, [season]);
  const rejectUnchanged = async () => {
    const before = await snapshot();
    const job = await query("SELECT * FROM projection_jobs WHERE job_key='all-player-ingestion:sleeper'");
    await expect(store.recordAllPlayerBatch(original)).rejects.toThrow(/canonical league scoring profiles|missing a canonical scoring profile|parity observations are incomplete/iu);
    expect(await snapshot()).toEqual(before);
    expect(await query("SELECT * FROM projection_jobs WHERE job_key='all-player-ingestion:sleeper'")).toEqual(job);
    expect((await readiness()).some(row => !row.ready)).toBe(true);
  };
  for (const scenario of ['later-season', 'missing-season', 'missing-connection', 'shared-profile', 'distinct-profile'] as const) {
    await query('SAVEPOINT enrollment_case');
    try {
      const key = `portable-publication-${scenario}`;
      if (scenario === 'later-season' || scenario === 'missing-season' || scenario === 'missing-connection') {
        await query('INSERT INTO leagues(league_key,name) VALUES($1,$1)', [key]);
        if (scenario === 'missing-connection') {
          await query(`INSERT INTO league_seasons(league_id,season,scoring_profile_id)
            SELECT id,$2::smallint,$3::uuid FROM leagues WHERE league_key=$1`,
          [key, season, original.scoreSets[0].scoringProfileId]);
        }
        await enrollIntegrationSeason(query, [key], scenario === 'later-season' ? season + 1 : season);
        if (scenario === 'later-season') {
          expect((await readiness()).every(row => row.ready)).toBe(true);
          expect((await store.recordAllPlayerBatch(original)).kind).toBe('stored');
        } else await rejectUnchanged();
      } else {
        const weight = scenario === 'shared-profile' ? 4 : 8;
        const registered = await store.registerLeagueSeason({ leagueKey: key, leagueName: key, season,
          sleeperLeagueId: key, scoringRules: { pass_td: weight } });
        if (registered.kind !== 'stored') throw new Error('Synthetic enrollment registration unavailable.');
        await enrollIntegrationSeason(query, [key], season);
        await query(`INSERT INTO league_period_authorities (
          league_key,default_season,default_season_type,default_week,active_season,active_season_type,
          active_week,league_lifecycle,nfl_phase,source_provider,source_revision,source_observed_at,
          verified_at,source_external_league_id,expected_roster_count,expected_starter_slot_count,expected_roster_ids
        ) SELECT $1,default_season,default_season_type,default_week,active_season,active_season_type,
          active_week,league_lifecycle,nfl_phase,source_provider,$1,source_observed_at,verified_at,$1,
          expected_roster_count,expected_starter_slot_count,expected_roster_ids
          FROM league_period_authorities WHERE league_key='league1'`, [key]);
        await rejectUnchanged();
        const expanded = await input.buildExpanded(registered.value, weight);
        expect(expanded.scoreSets).toHaveLength(scenario === 'shared-profile' ? 2 : 3);
        const published = await store.recordAllPlayerBatch(expanded);
        if (published.kind !== 'stored') throw new Error('Expanded publication unavailable.');
        // Existing profile content can be semantically unchanged and verified;
        // all profiles still need the exact new observation's coordinated proof.
        expect(published.value.scoreSets.every(set => set.pointerOutcome === 'advanced' || set.pointerOutcome === 'verified')).toBe(true);
        expect(await query<{ count: number; observations: number }>(`SELECT count(*)::integer AS count,
          count(DISTINCT all_player_stat_observation_id)::integer AS observations
          FROM current_all_player_score_sets WHERE season=$1`, [season]))
          .toEqual([{ count: expanded.scoreSets.length, observations: 1 }]);
        // Retiring today's collection fleet cannot change an explicitly enrolled
        // historical period's complete publication group.
        await query(`UPDATE league_administration_enrollments SET active=false
          WHERE league_id=(SELECT id FROM leagues WHERE league_key=$1)`, [key]);
        expect((await store.recordAllPlayerBatch(expanded)).kind).toBe('stored');
      }
    } finally { await query('ROLLBACK TO SAVEPOINT enrollment_case'); }
  }

  // Exact-season DATA adoption determines participation, independently of a
  // scoring profile or source connection. Included memberships still fail closed.
  for (const scenario of ['data-null', 'data-null-active-parent', 'data-null-adopted-parent',
    'ordinary-null', 'near-match-data-marker', 'data-missing-season', 'data-missing-connection',
    'data-wrong-provider', 'data-wrong-season-connection', 'data-nonnull-profile',
    'data-nonnull-inactive-adoption', 'data-nonnull-other-season-adoption',
    'data-nonnull-active-data-parent', 'data-adopted-missing-connection'] as const) {
    await query('SAVEPOINT official_membership_case');
    try {
      const key = `official-publication-${scenario}`;
      const [league] = await query('INSERT INTO leagues(league_key,name) VALUES($1,$1) RETURNING id', [key]);
      const accountParent = ['data-null-adopted-parent', 'data-nonnull-inactive-adoption',
        'data-nonnull-other-season-adoption', 'data-adopted-missing-connection'].includes(scenario);
      const active = ['data-null-active-parent', 'data-null-adopted-parent', 'data-nonnull-other-season-adoption',
        'data-nonnull-active-data-parent', 'data-adopted-missing-connection'].includes(scenario);
      let seasonId: unknown;
      if (scenario !== 'data-missing-season') {
        const [registered] = await query(`INSERT INTO league_seasons(league_id,season,scoring_profile_id)
          VALUES($1,$2::smallint,$3::uuid) RETURNING id`, [league.id, season,
          scenario.startsWith('data-nonnull') || scenario === 'data-adopted-missing-connection'
            ? original.scoreSets[0].scoringProfileId : null]);
        seasonId = registered.id;
      }
      if (scenario === 'data-wrong-season-connection') {
        const [other] = await query(`INSERT INTO league_seasons(league_id,season,scoring_profile_id)
          VALUES($1,$2::smallint,NULL) RETURNING id`, [league.id, season + 1]);
        await query(`INSERT INTO league_source_connections(league_season_id,provider,external_league_id)
          VALUES($1,'sleeper',$2)`, [other.id, key]);
      } else if (!['data-missing-season', 'data-missing-connection', 'data-adopted-missing-connection'].includes(scenario)) {
        await query(`INSERT INTO league_source_connections(league_season_id,provider,external_league_id)
          VALUES($1,$2,$3)`, [seasonId, scenario === 'data-wrong-provider' ? 'synthetic-other-provider' : 'sleeper', key]);
      }
      await query(`INSERT INTO league_administration_enrollments(league_id,provider,active,evidence,data_adopted_seasons)
        VALUES($1,'sleeper',$2,$3,$4::integer[])`, [league.id, active,
        accountParent ? 'account-onboarding-v1' : 'public-data-intake-v1',
        scenario === 'data-nonnull-other-season-adoption' ? [season + 1]
          : accountParent || scenario === 'data-nonnull-active-data-parent' ? [season] : []]);
      await query(`INSERT INTO league_administration_enrollment_seasons(league_id,season,provider,evidence)
        VALUES($1,$2::smallint,'sleeper',$3)`, [league.id, season,
        scenario === 'ordinary-null' ? 'isolated fixture season approval'
          : scenario === 'near-match-data-marker' ? 'public-data-intake-v1 ' : 'public-data-intake-v1']);
      if (['ordinary-null', 'near-match-data-marker', 'data-null-adopted-parent', 'data-adopted-missing-connection'].includes(scenario)) {
        await rejectUnchanged();
      } else {
        const before = await snapshot();
        expect((await readiness()).every(row => row.ready)).toBe(true);
        expect((await store.recordAllPlayerBatch(original)).kind).toBe('stored');
        expect(await snapshot()).toEqual(before);
      }
    } finally {
      await query('ROLLBACK TO SAVEPOINT official_membership_case');
      await query('RELEASE SAVEPOINT official_membership_case');
    }
  }

  // Adoption includes the selected DATA season even when its immutable original
  // membership marker stays DATA. Both shared and distinct profiles need parity.
  for (const weight of [4, 8]) {
    await query('SAVEPOINT adopted_data_profile');
    try {
      const key = `adopted-data-publication-${weight}`;
      const registration = await store.registerLeagueSeason({ leagueKey: key, leagueName: key, season,
        sleeperLeagueId: key, scoringRules: { pass_td: weight } });
      if (registration.kind !== 'stored') throw new Error('Adopted DATA fixture registration unavailable.');
      const league = registration.value;
      await query(`INSERT INTO league_administration_enrollments(league_id,provider,active,evidence,data_adopted_seasons)
        VALUES($1,'sleeper',true,'account-onboarding-v1',ARRAY[$2]::integer[])`, [league.leagueId, season]);
      await query(`INSERT INTO league_administration_enrollment_seasons(league_id,season,provider,evidence)
        VALUES($1,$2,'sleeper','public-data-intake-v1')`, [league.leagueId, season]);
      await query(`INSERT INTO league_period_authorities SELECT (jsonb_populate_record(NULL::league_period_authorities,
        to_jsonb(original)||jsonb_build_object('league_key',$1::text,'source_external_league_id',$1::text,
          'source_revision',$1::text))).* FROM league_period_authorities original WHERE league_key='league1'`, [key]);
      await rejectUnchanged();
      const expanded = await input.buildExpanded(league, weight);
      expect(expanded.scoreSets).toHaveLength(weight === 4 ? 2 : 3);
      const result = await store.recordAllPlayerBatch(expanded);
      if (result.kind !== 'stored') throw new Error('Adopted DATA publication unavailable.');
      expect(result.value.scoreSets.every(set => set.pointerOutcome === 'advanced' || set.pointerOutcome === 'verified')).toBe(true);
      expect(await query(`SELECT count(*)::integer AS profiles,count(DISTINCT all_player_stat_observation_id)::integer AS observations
        FROM current_all_player_score_sets WHERE season=$1`, [season]))
        .toEqual([{ profiles: expanded.scoreSets.length, observations: 1 }]);
    } finally {
      await query('ROLLBACK TO SAVEPOINT adopted_data_profile');
      await query('RELEASE SAVEPOINT adopted_data_profile');
    }
  }
}
