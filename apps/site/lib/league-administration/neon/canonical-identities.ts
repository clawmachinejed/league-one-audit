import 'server-only';
import type { DatabaseClient } from '../../database';
import { assertCanonicalIdentityUuid, assertCanonicalSourceMapping, assertCanonicalSourceReference,
  type CanonicalLeagueSeasonInput, type CanonicalLeagueSeasonReference, type CanonicalRegistrationAuthorization,
  type CanonicalSourceMappingRead, type CanonicalSourceMappingSelection } from '../canonical-source-contracts';

export function canonicalIdentityMethods(client: DatabaseClient) {
  return {
    async registerCanonicalLeagueSeason(input: CanonicalLeagueSeasonInput,
      authorization: CanonicalRegistrationAuthorization): Promise<CanonicalLeagueSeasonReference> {
      assertCanonicalSourceReference(input.sourceLeague, 'league');
      if (input.mode !== 'official-data' || !input.leagueKey.trim() || !input.leagueName.trim()
        || !Number.isInteger(input.season) || input.season !== 2026) throw new Error('Invalid official source registration.');
      const rows = await client.query(`/* league-administration:register-canonical-official-source */
        SELECT public.register_canonical_official_source($1::jsonb,$2::jsonb,$3::jsonb) AS result`,
      [JSON.stringify({ ...input, registrationCapture: authorization.registrationCapture }),
        JSON.stringify(authorization.work), JSON.stringify(authorization.fence)]);
      if (rows.length !== 1 || !rows[0].result || typeof rows[0].result !== 'object' || Array.isArray(rows[0].result)) {
        throw new Error('Canonical registration did not return one identity.');
      }
      const result = rows[0].result as Record<string, unknown>;
      if (Object.keys(result).sort().join(',') !== 'leagueId,leagueSeasonId,mapping,scoringProfileId') {
        throw new Error('Invalid canonical registration result.');
      }
      assertCanonicalIdentityUuid(result.leagueId); assertCanonicalIdentityUuid(result.leagueSeasonId);
      if (result.scoringProfileId !== null) assertCanonicalIdentityUuid(result.scoringProfileId);
      assertCanonicalSourceMapping(result.mapping);
      const mapping = result.mapping;
      if (mapping.leagueSeasonId !== result.leagueSeasonId || mapping.scope.leagueKey !== input.leagueKey
        || mapping.scope.season !== input.season || mapping.scope.provider !== input.sourceLeague.provider
        || mapping.scope.nativeNamespace !== input.sourceLeague.nativeNamespace
        || mapping.scope.externalLeagueId !== input.sourceLeague.nativeId) throw new Error('Canonical registration source mismatch.');
      return { leagueId: result.leagueId, leagueSeasonId: result.leagueSeasonId,
        scoringProfileId: result.scoringProfileId, mapping };
    },
    async readCanonicalSourceMapping(selection: CanonicalSourceMappingSelection): Promise<CanonicalSourceMappingRead> {
      try {
        assertCanonicalSourceReference(selection.sourceLeague, 'league');
        if (selection.leagueSeasonId !== undefined) assertCanonicalIdentityUuid(selection.leagueSeasonId);
        const source = selection.sourceLeague;
        // Select all matches before checking an optional season: a wrong expected season is a conflict, not a miss.
        const rows = await client.query(`/* league-administration:read-canonical-source-mapping */
          SELECT connection.id AS connection_id,connection.league_season_id,connection.current_mapping_revision_id,
            connection.mapping_generation,connection.provider,connection.native_namespace,connection.external_league_id,
            league.league_key,season.season,revision.source_namespace,
            revision.connection_id AS revision_connection_id,revision.league_season_id AS revision_league_season_id,
            revision.provider AS revision_provider,revision.native_namespace AS revision_native_namespace,
            revision.external_league_id AS revision_external_league_id,revision.generation AS revision_generation,
            membership.provider AS enrollment_provider
          FROM public.league_source_connections connection
          JOIN public.league_seasons season ON season.id=connection.league_season_id
          JOIN public.leagues league ON league.id=season.league_id
          LEFT JOIN public.league_source_mapping_revisions revision ON revision.id=connection.current_mapping_revision_id
          LEFT JOIN public.league_administration_enrollment_seasons membership
            ON membership.league_id=league.id AND membership.season=season.season AND membership.provider=connection.provider
          WHERE connection.provider=$1 AND connection.native_namespace=$2 AND connection.external_league_id=$3 LIMIT 2`,
        [source.provider, source.nativeNamespace, source.nativeId]);
        if (!rows.length) return { status: 'missing', reason: 'canonical_source_mapping_missing' };
        if (rows.length !== 1) return { status: 'conflict', reason: 'canonical_source_mapping_ambiguous' };
        const row = rows[0];
        if (selection.leagueSeasonId !== undefined && row.league_season_id !== selection.leagueSeasonId
          || row.revision_connection_id !== row.connection_id || row.revision_league_season_id !== row.league_season_id
          || row.revision_provider !== source.provider || row.revision_native_namespace !== source.nativeNamespace
          || row.revision_external_league_id !== source.nativeId || row.enrollment_provider !== source.provider
          || String(row.revision_generation) !== String(row.mapping_generation)) {
          return { status: 'conflict', reason: 'canonical_source_mapping_lineage_conflict' };
        }
        const mapping = { connectionId: row.connection_id, leagueSeasonId: row.league_season_id,
          revisionId: row.current_mapping_revision_id, generation: Number(row.mapping_generation),
          scope: { provider: row.provider, leagueKey: row.league_key, externalLeagueId: row.external_league_id,
            season: Number(row.season), nativeNamespace: row.native_namespace }, sourceNamespace: row.source_namespace };
        assertCanonicalSourceMapping(mapping);
        return { status: 'available', mapping };
      } catch { return { status: 'unavailable', reason: 'canonical_source_mapping_unavailable' }; }
    },
  };
}
