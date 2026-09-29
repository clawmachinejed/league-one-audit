import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createProjectionStore } from '../lib/projection-store';
import { createLeagueAdministrationMethods } from '../lib/league-administration/neon/administration';
import { normalizeAdministrationObservation } from '../lib/league-administration/normalize';
import { installAllPlayerScheduleTestClock } from './all-player-schedule-test-clock';
import { createIndependentDatabase, createPinnedIntegrationDatabase, ownerQuery, prepareIntegrationDatabase } from './neon-integration-harness';

// This runs only inside the standard supervised disposable suite. Rebuild the
// synthetic schema using the same guarded harness; restore the full baseline
// and its test clock before any other serial suite resumes.
describe.sequential('026 expansion over ambiguous retained v1 mapping history', () => {
  beforeAll(async () => prepareIntegrationDatabase({ throughMigration: '025_account_league_enrollment.sql' }));
  afterAll(async () => { await prepareIntegrationDatabase(); await installAllPlayerScheduleTestClock(); });

  it('preserves old UUIDs, raw evidence, scoring identities and history while baselining only the current mapping', async () => {
    const runtime = createIndependentDatabase();
    const owner = await createPinnedIntegrationDatabase('owner');
    try {
      const key = `upgrade-${randomUUID()}`; const external = `source-${randomUUID()}`;
      const registration = await createProjectionStore(runtime.database).registerLeagueSeason({ leagueKey: key,
        leagueName: 'Upgrade fixture', season: 2150, sleeperLeagueId: external, scoringRules: { rec: 0.5 } });
      if (registration.kind !== 'stored') throw new Error('Integration persistence disabled');
      const { leagueId, leagueSeasonId } = registration.value;
      await ownerQuery(`INSERT INTO league_administration_enrollments(league_id,provider,evidence) VALUES($1,'sleeper','synthetic fixture')`, [leagueId]);
      await ownerQuery(`INSERT INTO league_administration_enrollment_seasons(league_id,season,provider,evidence) VALUES($1,2150,'sleeper','synthetic fixture')`, [leagueId]);
      const at = new Date().toISOString();
      const input = normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1',
        normalizerVersion: 'sleeper-administration-v1', dialect: 'sleeper-nfl-v1',
        scope: { leagueKey: key, provider: 'sleeper', externalLeagueId: external, season: 2150 },
        family: 'rosters', week: null, completeness: 'complete',
        payload: [{ roster_id: 1, players: ['a'], reserve: [], taxi: [], settings: { fpts: 9 } }],
        provenance: { origin: 'network', requestStartedAt: at, requestCompletedAt: at, sourceObservedAt: at, checkedAt: at } });
      const legacy = await createLeagueAdministrationMethods(runtime.database).recordObservation(input);
      // Duplicate/tied legacy event times cannot establish an exact old revision.
      await ownerQuery(`INSERT INTO league_source_connection_history
        (league_season_id,provider,external_league_id,evidence,recorded_at)
        SELECT $1,'sleeper',$2,'ambiguous synthetic old history',min(recorded_at)
        FROM league_source_connection_history WHERE league_season_id=$1`, [leagueSeasonId, external]);
      const snapshot = () => ownerQuery(`SELECT
        (SELECT jsonb_agg(to_jsonb(row)) FROM league_source_connection_history row WHERE league_season_id=$1) AS history,
        (SELECT jsonb_agg(to_jsonb(row)) FROM league_administration_observations row WHERE league_season_id=$1) AS observations,
        (SELECT jsonb_agg(to_jsonb(row)) FROM league_administration_contents row WHERE league_season_id=$1) AS contents,
        (SELECT jsonb_agg(to_jsonb(row)) FROM league_season_teams row WHERE league_season_id=$1) AS teams,
        (SELECT to_jsonb(row) FROM league_seasons row WHERE id=$1) AS season`, [leagueSeasonId]);
      const before = await snapshot();
      const name = '026_source_mapping_revisions.sql';
      const sql = (await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8')).replace(/\r\n?/g, '\n');
      await owner.database.query('BEGIN');
      await owner.database.query("SELECT pg_advisory_xact_lock(hashtext('league-one-schema-migrations'))");
      await owner.database.query(sql);
      await owner.database.query('INSERT INTO app_schema_migrations(name,checksum) VALUES($1,$2)', [name, createHash('sha256').update(sql).digest('hex')]);
      await owner.database.query('COMMIT');
      expect(await snapshot()).toEqual(before);
      const store = createLeagueAdministrationMethods(runtime.database);
      const token = await store.readSourceMapping(external);
      expect(token).toMatchObject({ leagueSeasonId, generation: 1 });
      expect(await ownerQuery(`SELECT previous_revision_id,history_id,evidence FROM league_source_mapping_revisions WHERE connection_id=$1`, [token!.connectionId]))
        .toEqual([{ previous_revision_id: null, history_id: null, evidence: '026: current mapping baseline only; earlier mapping lineage unverified' }]);
      expect(await store.readSource({ ...input.envelope.scope, family: 'rosters', week: null })).toMatchObject({
        status: 'available', observationId: legacy.observationId, commonRoster: { lineage: {
          sourceMappingRevisionId: null, reasons: ['mapping_revision_not_captured'] } } });
      expect((await store.recordObservation(input)).status).toBe('replayed'); // Original caller works unchanged after expansion.
    } finally {
      await owner.database.query('ROLLBACK').catch(() => undefined);
      await owner.close(); await runtime.close();
    }
  });
});
