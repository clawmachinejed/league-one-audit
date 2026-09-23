-- Add directly observed Sleeper native counters to the unchanged sparse
-- stat-times-weight contract. These are additive event qualifications, not a
-- new scoring algorithm. Previously accepted v1 profiles, hashes, results,
-- immutable history and pointers retain exactly the same interpretation.
-- No new table, grant, provider request, enrollment or historical rewrite.
-- Projection support remains separately qualified in application code.
CREATE OR REPLACE FUNCTION public.all_player_scoring_contract_supported(
  p_provider text,
  p_scorer_version text,
  p_rules jsonb
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT p_provider = 'sleeper'
    AND p_scorer_version = 'sleeper-actual-v1'
    AND jsonb_typeof(p_rules) = 'object'
    AND EXISTS (
      SELECT 1 FROM jsonb_each(p_rules) rule
      WHERE jsonb_typeof(rule.value) = 'number'
        AND (rule.value #>> '{}')::numeric <> 0
    )
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_each(p_rules) rule
      WHERE jsonb_typeof(rule.value) IS DISTINCT FROM 'number'
        OR ((rule.value #>> '{}')::numeric <> 0 AND rule.key <> ALL (ARRAY[
          'pass_yd', 'pass_td', 'pass_int', 'rush_yd', 'rush_td', 'rec', 'rec_yd',
          'rec_td', 'pass_2pt', 'rush_2pt', 'rec_2pt', 'fum_lost', 'sack', 'int',
          'def_st_fum_rec', 'def_td', 'def_st_td', 'safe', 'blk_kick', 'pts_allow_0',
          'pts_allow_1_6', 'pts_allow_7_13', 'pts_allow_14_20', 'pts_allow_21_27',
          'pts_allow_28_34', 'pts_allow_35p', 'fgm', 'fgmiss', 'xpm', 'xpmiss',
          'pass_td_40p', 'rush_td_40p', 'rec_td_40p', 'fum_rec', 'fum_rec_td',
          'st_td', 'def_2pt', 'def_3_and_out', 'def_4_and_stop', 'fgm_yds_over_30',
          'pass_int_td', 'st_fum_rec', 'ff', 'def_st_ff', 'st_ff',
          'fgm_0_19', 'fgm_20_29', 'fgm_30_39', 'fgm_40_49', 'fgm_50_59', 'fgm_60p'
        ]::text[]))
    )
$$;
REVOKE ALL ON FUNCTION public.all_player_scoring_contract_supported(
  text, text, jsonb
) FROM PUBLIC;

