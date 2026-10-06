import 'server-only';
import type { DatabaseClient, DatabaseRow, DatabaseQueryOptions } from '../../database';
import { createProjectionStore } from '../../projection-store';
import { normalizeAdministrationObservation } from '../normalize';
import { ADMINISTRATION_DIALECT, ADMINISTRATION_NORMALIZER_VERSION, ADMINISTRATION_SCHEMA_VERSION, type JsonValue } from '../contracts';
import { validatePublicIntake, type PublicIntakeStore, type PublicIntakeWork } from '../public-intake-contracts';

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid public intake record.');
  return value as Record<string, unknown>;
}

export function createPublicIntakeStore(client: DatabaseClient): PublicIntakeStore {
  async function checkpoint(work: PublicIntakeWork, capture: unknown, fence: unknown) {
    await client.query(`/* public-data-intake:checkpoint */
      SELECT public.checkpoint_public_data_intake($1::jsonb,$2::jsonb,$3::jsonb)`,
    [JSON.stringify(work), JSON.stringify(capture), JSON.stringify(fence)]);
  }
  return {
    async submit(input) {
      await client.query(`/* public-data-intake:submit */ SELECT public.submit_public_data_intake($1::jsonb)`,
        [JSON.stringify(validatePublicIntake(input))]);
    },
    async recover(requestId, fence) {
      await client.query(`/* public-data-intake:recover */
        SELECT public.recover_public_data_dispatch($1::uuid,$2::jsonb)`, [requestId, JSON.stringify(fence)]);
    },
    async next(requestId) {
      const rows = await client.query(`/* public-data-intake:next */ SELECT public.next_public_data_intake($1::uuid) AS result`, [requestId]);
      const result = rows[0]?.result;
      if (result === 'complete' || result === 'partial' || result === 'unavailable' || result === 'backoff') return result;
      const work = record(result);
      if (work.requestId !== requestId || !Number.isSafeInteger(work.revision) || Number(work.revision) < 0
        || !['identity', 'leagues', 'bootstrap', 'core', 'users'].includes(String(work.kind))) {
        throw new Error('Invalid public intake work.');
      }
      return work as PublicIntakeWork;
    },
    recordIdentity: checkpoint,
    recordLeagues: checkpoint,
    async admit(work, fence) {
      const rows = await client.query(`/* public-data-intake:admit-dispatch */
        SELECT public.admit_public_data_dispatch($1::jsonb,$2::jsonb) AS admitted`, [JSON.stringify(work), JSON.stringify(fence)]);
      return rows[0]?.admitted === true;
    },
    async register(work, capture, fence) {
      const reject = () => checkpoint(work, { ...capture, diagnostic: 'invalid-source' }, fence);
      if (!capture.payload || typeof capture.payload !== 'object' || Array.isArray(capture.payload)) return reject();
      const payload = record(capture.payload);
      const rows = await client.query(`/* public-data-intake:resolve-registration */
        SELECT league.league_key,season.season,league.id AS league_id,season.id AS league_season_id FROM public.league_source_connections connection
        JOIN public.league_seasons season ON season.id=connection.league_season_id
        JOIN public.leagues league ON league.id=season.league_id
        WHERE connection.provider='sleeper' AND connection.external_league_id=$1`, [work.externalLeagueId]);
      if (rows.length > 1 || rows[0] && Number(rows[0].season) !== work.season) throw new Error('Ambiguous public source identity.');
      const leagueKey = rows.length ? String(rows[0].league_key) : `sleeper-${work.externalLeagueId}`;
      const scope = { leagueKey, provider: 'sleeper' as const, externalLeagueId: work.externalLeagueId, season: work.season };
      const normalized = normalizeAdministrationObservation({ schemaVersion: ADMINISTRATION_SCHEMA_VERSION,
        normalizerVersion: ADMINISTRATION_NORMALIZER_VERSION, dialect: ADMINISTRATION_DIALECT,
        scope, family: 'league', week: null, completeness: 'complete', payload: capture.payload as JsonValue,
        provenance: { origin: 'network', requestStartedAt: capture.requestStartedAt,
          requestCompletedAt: capture.requestCompletedAt, sourceObservedAt: capture.requestCompletedAt,
          checkedAt: new Date().toISOString() } });
      // Official representability only. Unrecognized analytics rules/slots/divisions
      // are retained, and do not enroll or enable the calculation workers.
      if (normalized.status !== 'accepted' || payload.sport !== 'nfl'
        || typeof payload.name !== 'string' || !payload.name.trim()
        || !payload.settings || typeof payload.settings !== 'object' || Array.isArray(payload.settings)
        || !Array.isArray(payload.roster_positions) || !payload.roster_positions.length
        || !Number.isInteger(payload.total_rosters) || Number(payload.total_rosters) < 1
        || !payload.scoring_settings || typeof payload.scoring_settings !== 'object' || Array.isArray(payload.scoring_settings)) return reject();
      const scoring = record(payload.scoring_settings);
      if (!Object.keys(scoring).length || Object.values(scoring).some(value => typeof value !== 'number' || !Number.isFinite(value))) {
        return reject();
      }
      if (Number(payload.total_rosters) > 20) {
        await checkpoint(work, { ...capture, capacity: 'roster-count-unqualified' }, fence);
        return;
      }
      // Reuse shared registration. It keeps existing season scoring profiles immutable
      // and source mapping triggers reject rebinds; no annual continuity is inferred.
      if (!client.queryAfterLock) throw new Error('Fenced public registration requires the shared transaction boundary.');
      const lockedQuery = client.queryAfterLock.bind(client);
      const guarded: DatabaseClient = { enabled: true, query: async <Row extends DatabaseRow = DatabaseRow>(
        statement: string, parameters: readonly unknown[] = [], options?: DatabaseQueryOptions) => {
        const result = await lockedQuery<Row>(statement, parameters, {
          statement: 'SELECT public.guard_public_data_intake($1::jsonb,$2::jsonb)',
          parameters: [JSON.stringify(work), JSON.stringify({ ...fence, reserveCollection: true })],
          verifyAfter: { statement: 'SELECT public.guard_public_data_intake($1::jsonb,$2::jsonb)',
            parameters: [JSON.stringify(work), JSON.stringify(fence)] },
        }, options);
        return result[1];
      } };
      const registered = rows.length ? { kind: 'stored' as const, value: { leagueId: String(rows[0].league_id),
        leagueSeasonId: String(rows[0].league_season_id) } }
        : await createProjectionStore(guarded).registerLeagueSeason({ leagueKey, leagueName: payload.name,
        season: work.season, sleeperLeagueId: work.externalLeagueId, scoringRules: scoring as Record<string, number> });
      if (registered.kind !== 'stored') throw new Error('Public registration unavailable.');
      await checkpoint(work, { ...capture, leagueId: registered.value.leagueId,
        leagueSeasonId: registered.value.leagueSeasonId }, fence);
    },
    completeCore: (work, mapping, captured, fence) => checkpoint(work, { mapping, ...captured }, fence),
    fail: (work, fence) => checkpoint(work, { failed: true }, fence),
  };
}
