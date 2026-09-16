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
    (SELECT count(*)::integer FROM all_player_stat_observations) AS observations,
    (SELECT count(*)::integer FROM all_player_score_sets) AS score_sets,
    (SELECT count(*)::integer FROM all_player_score_verifications) AS verifications,
    (SELECT jsonb_agg(to_jsonb(pointer) ORDER BY scoring_profile_id)
      FROM current_all_player_score_sets pointer WHERE season=$1) AS pointers`, [season]);
  const rejectUnchanged = async () => {
    const before = await snapshot();
    await expect(store.recordAllPlayerBatch(original)).rejects.toThrow(/canonical league scoring profiles|missing a canonical scoring profile|parity observations are incomplete/iu);
    expect(await snapshot()).toEqual(before);
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
}
