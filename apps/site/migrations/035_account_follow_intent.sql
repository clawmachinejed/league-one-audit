-- BC-M1 D04 / RD12: preserve explicit unfollow revision without turning
-- membership expiry, disconnect or recovery into a preference mutation.
-- The existing app_user_leagues row and its audit remain the sole follow writer.
CREATE TABLE public.app_user_league_preference_tombstones (
  app_user_id uuid NOT NULL REFERENCES public.app_users(id),
  league_id uuid NOT NULL REFERENCES public.leagues(id),
  last_revision bigint NOT NULL CHECK(last_revision>0),
  ended_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(ended_at)),
  request_id uuid NOT NULL,
  PRIMARY KEY(app_user_id,league_id)
);
ALTER TABLE public.app_user_league_preference_tombstones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_user_league_preference_tombstones FROM PUBLIC;

CREATE FUNCTION public.retain_account_follow_intent_v1() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor_id uuid; league_uuid uuid; previous_revision bigint; request_uuid uuid;
BEGIN
  actor_id := CASE WHEN TG_OP='DELETE' THEN OLD.app_user_id ELSE NEW.app_user_id END;
  league_uuid := CASE WHEN TG_OP='DELETE' THEN OLD.league_id ELSE NEW.league_id END;
  -- The mandatory BEFORE STATEMENT authority guard already owns this Actor
  -- before PostgreSQL acquires a preference tuple lock. Owner maintenance must
  -- name the same actor in its trusted transaction context as well.
  IF public.current_app_actor() IS DISTINCT FROM actor_id THEN
    RAISE EXCEPTION USING ERRCODE='P4101',MESSAGE='account authority unavailable';
  END IF;
  BEGIN request_uuid := nullif(current_setting('app.request_id',true),'')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION USING ERRCODE='P4101',MESSAGE='account authority unavailable';
  END;
  IF request_uuid IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P4101',MESSAGE='account authority unavailable';
  END IF;
  SELECT last_revision INTO previous_revision
    FROM public.app_user_league_preference_tombstones
    WHERE app_user_id=actor_id AND league_id=league_uuid FOR UPDATE;
  IF TG_OP='DELETE' THEN
    -- A live preference and its absence cannot coexist. Never silently repair
    -- inconsistent authority by picking whichever revision is greater.
    IF FOUND THEN RAISE EXCEPTION 'conflicting follow intention'; END IF;
    INSERT INTO public.app_user_league_preference_tombstones
      (app_user_id,league_id,last_revision,ended_at,request_id)
      VALUES(actor_id,league_uuid,OLD.revision+1,clock_timestamp(),request_uuid);
    RETURN OLD;
  END IF;
  IF FOUND THEN
    IF EXISTS(SELECT 1 FROM public.app_user_leagues
      WHERE app_user_id=actor_id AND league_id=league_uuid) THEN
      RAISE EXCEPTION 'conflicting follow intention';
    END IF;
    NEW.revision := previous_revision+1;
    DELETE FROM public.app_user_league_preference_tombstones
      WHERE app_user_id=actor_id AND league_id=league_uuid;
  ELSE
    NEW.revision := 1;
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.retain_account_follow_intent_v1() FROM PUBLIC;
CREATE TRIGGER app_user_leagues_intent_v1 BEFORE INSERT OR DELETE ON public.app_user_leagues
  FOR EACH ROW EXECUTE FUNCTION public.retain_account_follow_intent_v1();

-- No extra audit event: the existing canonical preference INSERT/DELETE event
-- and its 60-event actor rate limit commit or roll back with the tombstone.
DO $$ DECLARE role_name text; BEGIN
  FOREACH role_name IN ARRAY ARRAY['league_one_account','league_one_auth','league_one_runtime'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      EXECUTE format('REVOKE ALL ON public.app_user_league_preference_tombstones FROM %I',role_name);
      EXECUTE format('REVOKE ALL ON FUNCTION public.retain_account_follow_intent_v1() FROM %I',role_name);
    END IF;
  END LOOP;
END; $$;
