/* projection-store:register-league-season */
        WITH profile AS (
          INSERT INTO scoring_profiles (rules_hash, rules)
          VALUES ($1, $2::jsonb)
          ON CONFLICT (rules_hash) DO UPDATE SET rules = scoring_profiles.rules
          RETURNING id
        ), league AS (
          INSERT INTO leagues (league_key, name)
          VALUES ($3, $4)
          ON CONFLICT (league_key) DO UPDATE
          SET name = EXCLUDED.name, updated_at = now()
          RETURNING id
        ), season AS (
          INSERT INTO league_seasons (league_id, season, scoring_profile_id)
          SELECT league.id, $5, profile.id FROM league CROSS JOIN profile
          ON CONFLICT (league_id, season) DO UPDATE
          SET updated_at = now()
          WHERE league_seasons.scoring_profile_id = EXCLUDED.scoring_profile_id
          RETURNING id, league_id, scoring_profile_id
        ), connection AS (
          INSERT INTO league_source_connections
            (league_season_id, provider, external_league_id)
          SELECT season.id, 'sleeper', $6 FROM season
          ON CONFLICT (league_season_id, provider) DO UPDATE
          SET external_league_id = EXCLUDED.external_league_id, connected_at = now()
          RETURNING league_season_id
        )
        SELECT season.league_id, season.id AS league_season_id, season.scoring_profile_id
        FROM season JOIN connection ON connection.league_season_id = season.id