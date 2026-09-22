/** Private shared read boundary for the account Neon adapter. No provider requests, raw roster
 * JSON, display-identity overrides, or historical membership shortcuts. */
export const ACCOUNT_SOURCE_CTES = `WITH enrolled AS (
  SELECT league.id,league.league_key,league.name,season.id AS season_id,intended.season,
    enrollment.provider,enrollment.active,connection.external_league_id
  FROM public.league_administration_enrollments enrollment
  JOIN public.leagues league ON league.id=enrollment.league_id
  LEFT JOIN LATERAL (SELECT max(candidate.season) AS season
    FROM public.league_administration_enrollment_seasons candidate
    WHERE candidate.league_id=league.id AND candidate.provider=enrollment.provider) intended ON true
  LEFT JOIN public.league_seasons season ON season.league_id=league.id AND season.season=intended.season
  LEFT JOIN public.league_source_connections connection ON connection.league_season_id=season.id AND connection.provider=enrollment.provider
  WHERE (enrollment.active OR EXISTS(SELECT 1 FROM public.app_user_leagues saved WHERE saved.league_id=league.id))
    AND enrollment.provider='sleeper' AND league.league_key IN ('league1','league2','dynasty')
), sources AS (
  SELECT enrolled.*,family.name AS family,head.checked_at,head.verified_at,
    -- Identical network verification can advance the head while retaining an
    -- accepted cache observation whose original provider timestamp was unknown.
    coalesce(observation.source_observed_at,head.verified_at) AS source_observed_at,
    content.id AS content_id,
    coalesce(enrolled.active AND head.read_conflict IS NULL AND head.generation>0
      AND observation.outcome IN ('changed','unchanged') AND observation.league_season_id=enrolled.season_id
      AND observation.family=family.name AND observation.week=0
      AND content.accepted AND content.completeness='complete'
      AND content.normalizer_version='sleeper-administration-v1' AND content.family=family.name AND content.week=0
      AND content.league_season_id=enrolled.season_id AND content.provider=enrolled.provider
      AND content.external_league_id=enrolled.external_league_id,false) AS valid
  FROM enrolled CROSS JOIN (VALUES('rosters'),('users')) family(name)
  LEFT JOIN public.league_administration_heads head ON head.league_season_id=enrolled.season_id AND head.family=family.name AND head.week=0
  LEFT JOIN public.league_administration_observations observation ON observation.id=head.accepted_observation_id
  LEFT JOIN public.league_administration_contents content ON content.id=observation.content_id
), provider_accounts AS (
  SELECT DISTINCT ON (manager.id) manager.id,manager.provider,manager.external_manager_id,
    nullif(left(entry.source_value->>'username',100),'') AS username,
    coalesce(nullif(left(entry.source_value->>'display_name',100),''),nullif(left(entry.source_value->>'username',100),''),manager.external_manager_id) AS display_name
  FROM sources source
  JOIN public.league_administration_manager_entries entry ON entry.content_id=source.content_id
  JOIN public.league_source_manager_accounts manager ON manager.id=entry.manager_id AND manager.provider=source.provider
  WHERE source.family='users' AND source.valid AND source.verified_at IS NOT NULL
    AND source.checked_at<=clock_timestamp() AND source.verified_at<=source.checked_at
  ORDER BY manager.id,source.verified_at DESC,source.id
)`;

export const ACCOUNT_VIEW_SQL = `${ACCOUNT_SOURCE_CTES}
SELECT jsonb_build_object(
  'profile',(SELECT jsonb_build_object('id',id,'displayName',display_name,'revision',revision)
    FROM public.app_users WHERE id=public.current_app_actor()),
  'links',coalesce((SELECT jsonb_agg(jsonb_build_object('id',link.id,'sourceManagerAccountId',link.source_manager_account_id,
    'displayName',coalesce(account.display_name,manager.external_manager_id),'provider',manager.provider,
    'assurance',link.assurance,'revision',link.revision) ORDER BY link.linked_at,link.id)
    FROM public.app_provider_account_links link
    JOIN public.league_source_manager_accounts manager ON manager.id=link.source_manager_account_id
    LEFT JOIN provider_accounts account ON account.id=manager.id
    WHERE link.revoked_at IS NULL),'[]'::jsonb),
  'saved',coalesce((SELECT jsonb_agg(jsonb_build_object('leagueId',league_id,'favorite',favorite,'sortPosition',sort_position,
    'preferredSeasonTeamId',preferred_season_team_id,'revision',revision)) FROM public.app_user_leagues),'[]'::jsonb),
  'sources',coalesce((SELECT jsonb_agg(jsonb_build_object('id',source.id,'key',source.league_key,'name',source.name,
    'season',source.season,'valid',source.valid,'checkedAt',source.checked_at,'verifiedAt',source.verified_at,
    'observedAt',source.source_observed_at,
    'memberships',coalesce((SELECT jsonb_agg(jsonb_build_object('teamId',team.id,'rosterId',team.external_roster_id,
      'sourceManagerAccountId',membership.manager_id,'role',membership.role))
      FROM public.league_administration_memberships membership
      JOIN public.league_season_teams team ON team.id=membership.team_id AND team.league_season_id=source.season_id
        AND team.provider=source.provider AND team.external_league_id=source.external_league_id
      JOIN public.league_administration_team_entries entry ON entry.content_id=source.content_id AND entry.team_id=team.id
        AND entry.league_season_id=source.season_id
      WHERE membership.content_id=source.content_id AND membership.league_season_id=source.season_id AND source.valid),'[]'::jsonb))
      ORDER BY source.league_key) FROM sources source WHERE source.family='rosters'),'[]'::jsonb),
  'providerAccounts',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'provider',provider,'externalId',external_manager_id,
    'displayName',display_name,'username',username) ORDER BY display_name,id) FROM provider_accounts),'[]'::jsonb),
  'groups',coalesce((SELECT jsonb_agg(jsonb_build_object('id',groups.id,'name',groups.name,'leagueIds',
    coalesce((SELECT jsonb_agg(membership.league_id) FROM public.app_league_group_memberships membership
      JOIN enrolled ON enrolled.id=membership.league_id
      WHERE membership.group_id=groups.id AND membership.ended_at IS NULL AND membership.started_at<=clock_timestamp()),'[]'::jsonb)))
    FROM public.app_league_groups groups WHERE groups.status='active'),'[]'::jsonb)
) AS view`;
