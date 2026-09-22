-- Optional owner-only bootstrap after 020. This creates no app user, provider
-- association, source enrollment or team membership. Review/authorize separately
-- from applying the dormant schema. Public leagues remain independently scored.
BEGIN;
SELECT set_config('app.request_id',gen_random_uuid()::text,true),set_config('app.actor_user_id','',true);
DO $$ DECLARE group_uuid uuid; BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('app:seed:league-one-two',0));
  IF (SELECT count(*) FROM public.leagues league JOIN public.league_administration_enrollments enrollment
      ON enrollment.league_id=league.id AND enrollment.active AND enrollment.provider='sleeper'
      WHERE league.league_key IN ('league1','league2','dynasty'))<>3 THEN
    RAISE EXCEPTION 'bootstrap requires the three existing canonical active leagues'; END IF;
  IF EXISTS(SELECT 1 FROM public.app_league_group_memberships membership JOIN public.leagues league ON league.id=membership.league_id
    WHERE league.league_key='dynasty' AND membership.ended_at IS NULL) THEN
    RAISE EXCEPTION 'bootstrap expects Dynasty to remain independent'; END IF;
  INSERT INTO public.app_league_groups(group_key,name,description)
    VALUES('league-one-two','League One / League Two','Related leagues for public browsing')
    ON CONFLICT(group_key) DO NOTHING;
  SELECT id INTO STRICT group_uuid FROM public.app_league_groups WHERE group_key='league-one-two' AND status='active';
  IF EXISTS(SELECT 1 FROM public.app_league_group_memberships membership JOIN public.leagues league ON league.id=membership.league_id
    WHERE membership.group_id=group_uuid AND membership.ended_at IS NULL AND league.league_key NOT IN ('league1','league2')) THEN
    RAISE EXCEPTION 'existing affiliation conflicts with approved two-league bootstrap'; END IF;
  INSERT INTO public.app_league_group_memberships(group_id,league_id)
    SELECT group_uuid,id FROM public.leagues WHERE league_key IN ('league1','league2')
    ON CONFLICT(group_id,league_id) WHERE ended_at IS NULL DO NOTHING;
END; $$;
COMMIT;
