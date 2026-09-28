import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AdministrationEnvelope } from '../lib/league-administration/contracts';
import type { AdministrationSourceMapping } from '../lib/league-administration/source-mapping';
import { createLeagueAdministrationMethods } from '../lib/league-administration/neon/administration';
import { normalizeAdministrationObservation } from '../lib/league-administration/normalize';
import { createProjectionStore } from '../lib/projection-store';
import { compatibleScoringRulesHash } from '../lib/projections/shared/revision-compatibility';
import { createIndependentDatabase, createPinnedIntegrationDatabase, ownerQuery, runtimeQuery, type IndependentDatabase } from './neon-integration-harness';

const rules = { rec: 0.5 };
type Fixture = { leagueKey: string; leagueId: string; leagueSeasonId: string; externalLeagueId: string };
describe.sequential('durable mapping revisions through the sole roster writer', () => {
  let connection: IndependentDatabase;
  let store: ReturnType<typeof createLeagueAdministrationMethods>;
  beforeAll(() => { connection = createIndependentDatabase(); store = createLeagueAdministrationMethods(connection.database); });
  afterAll(async () => connection.close());

  async function fixture(): Promise<Fixture> {
    const leagueKey = `mapping-${randomUUID()}`; const externalLeagueId = `source-${randomUUID()}`;
    const result = await createProjectionStore(connection.database).registerLeagueSeason({ leagueKey,
      leagueName: 'Synthetic mapping fixture', season: 2150, sleeperLeagueId: externalLeagueId, scoringRules: rules });
    if (result.kind !== 'stored') throw new Error('Integration persistence disabled');
    const { leagueId, leagueSeasonId } = result.value;
    await ownerQuery(`INSERT INTO league_administration_enrollments(league_id,provider,evidence) VALUES($1,'sleeper','synthetic fixture')`, [leagueId]);
    await ownerQuery(`INSERT INTO league_administration_enrollment_seasons(league_id,season,provider,evidence)
      VALUES($1,2150,'sleeper','synthetic fixture')`, [leagueId]);
    return { leagueKey, externalLeagueId, leagueId, leagueSeasonId };
  }
  async function mapping(f: Fixture) {
    const result = await store.readSourceMapping(f.externalLeagueId);
    if (!result) throw new Error('Missing fixture mapping'); return result;
  }
  async function roster(f: Fixture, player = 'player-a', origin: 'network' | 'cache' = 'network') {
    const [row] = await ownerQuery(`SELECT clock_timestamp() AS at`);
    // Use the database clock, avoiding host/server skew in the lineage fixture.
    const at = row.at instanceof Date ? row.at.toISOString() : new Date(String(row.at)).toISOString();
    const envelope: AdministrationEnvelope = { schemaVersion: 'league-administration-v1',
      normalizerVersion: 'sleeper-administration-v1', dialect: 'sleeper-nfl-v1',
      scope: { leagueKey: f.leagueKey, provider: 'sleeper', externalLeagueId: f.externalLeagueId, season: 2150 },
      family: 'rosters', week: null, completeness: 'complete',
      payload: [{ roster_id: 1, owner_id: 'owner', players: [player], reserve: [], taxi: [], settings: { wins: 2 } }],
      provenance: { origin, requestStartedAt: at, requestCompletedAt: at, sourceObservedAt: origin === 'network' ? at : null, checkedAt: at } };
    return normalizeAdministrationObservation(envelope, { expectedRosterCount: 1 });
  }
  async function revise(f: Fixture, token: AdministrationSourceMapping, target = f.externalLeagueId, evidence = 'reviewed correction') {
    const [row] = await ownerQuery(`SELECT public.revise_league_source_connection($1,'sleeper',$2,$3,$4) AS id`,
      [f.leagueSeasonId, token.revisionId, target, evidence]);
    return String(row.id);
  }
  async function counts(f: Fixture) {
    return ownerQuery(`SELECT
      (SELECT count(*)::int FROM league_administration_contents WHERE league_season_id=$1) AS contents,
      (SELECT count(*)::int FROM league_administration_observations WHERE league_season_id=$1) AS observations,
      (SELECT row_to_json(head) FROM league_administration_heads head WHERE league_season_id=$1 AND family='rosters') AS head`, [f.leagueSeasonId]);
  }

  it('keeps registration refresh identity stable and exact revision-CAS retry idempotent', async () => {
    const f = await fixture(); const original = await mapping(f);
    await createProjectionStore(connection.database).registerLeagueSeason({ leagueKey: f.leagueKey,
      leagueName: 'Renamed', season: 2150, sleeperLeagueId: f.externalLeagueId, scoringRules: rules });
    expect(await mapping(f)).toEqual(original);
    const correction = await revise(f, original);
    expect(await revise(f, original)).toBe(correction);
    const current = await mapping(f);
    expect(current).toMatchObject({ connectionId: original.connectionId, generation: 2, revisionId: correction });
    await expect(revise(f, original, f.externalLeagueId, 'different intent')).rejects.toThrow(/compare-and-swap/);
    expect(await ownerQuery(`SELECT count(*)::int AS count FROM league_source_mapping_revisions WHERE connection_id=$1`, [original.connectionId]))
      .toEqual([{ count: 2 }]);
  });

  it('appends exact same-content capture over a legacy head without relabeling old evidence or team IDs', async () => {
    const f = await fixture(); const token = await mapping(f);
    const legacy = await store.recordObservation(await roster(f));
    const before = await ownerQuery(`SELECT id FROM league_season_teams WHERE league_season_id=$1`, [f.leagueSeasonId]);
    const input = await roster(f);
    const qualified = await store.recordObservation(input, undefined, token);
    expect(qualified.status).toBe('unchanged'); expect(qualified.observationId).not.toBe(legacy.observationId);
    expect((await store.recordObservation(input, undefined, token)).status).toBe('replayed');
    expect(await ownerQuery(`SELECT id FROM league_season_teams WHERE league_season_id=$1`, [f.leagueSeasonId])).toEqual(before);
    expect(await ownerQuery(`SELECT * FROM league_administration_observation_mappings WHERE observation_id=$1`, [legacy.observationId])).toEqual([]);
    expect(await store.readSource({ ...token.scope, family: 'rosters', week: null })).toMatchObject({ status: 'available',
      commonRoster: { kind: 'legacy-retained-roster', lineage: { sourceMappingRevisionId: token.revisionId,
        sourceConnectionId: token.connectionId, mappingGeneration: 1, reasons: ['v2_acceptance_not_qualified'] } } });
  });

  it.each(['player-a', 'player-b'])('rejects A1 -> B2 -> A3 in-flight %s and leaves evidence and head unchanged', async player => {
    const f = await fixture(); const a1 = await mapping(f);
    const acceptedInput = await roster(f); await store.recordObservation(acceptedInput, undefined, a1);
    const inflight = await roster(f, player);
    const away = { ...f, externalLeagueId: `away-${randomUUID()}` };
    await revise(f, a1, away.externalLeagueId, 'remap away');
    const b2 = await mapping(away); await revise(away, b2, f.externalLeagueId, 'remap back');
    const a3 = await mapping(f); expect(a3.connectionId).toBe(a1.connectionId); expect(a3.generation).toBe(3);
    const before = await counts(f);
    await expect(store.recordObservation(inflight, undefined, a1)).rejects.toThrow(/mapping revision is stale/);
    await expect(store.recordObservation(acceptedInput, undefined, a1)).rejects.toThrow(/mapping revision is stale/); // Replay too.
    expect(await counts(f)).toEqual(before);
    const fresh = await store.recordObservation(await roster(f, player), undefined, a3);
    expect(['changed', 'unchanged']).toContain(fresh.status);
    expect(await store.readSource({ ...a3.scope, family: 'rosters', week: null })).toMatchObject({ commonRoster: {
      lineage: { sourceMappingRevisionId: a3.revisionId, mappingGeneration: 3 } } });
  });

  it('fences cache unchanged shortcuts and same-source correction without promoting cache lineage', async () => {
    const f = await fixture(); const first = await mapping(f);
    await store.recordObservation(await roster(f), undefined, first);
    const cached = await roster(f, 'player-a', 'cache');
    await revise(f, first); const next = await mapping(f);
    const before = await counts(f);
    await expect(store.recordObservation(cached, undefined, first)).rejects.toThrow(/mapping revision is stale/);
    expect(await counts(f)).toEqual(before);
    const fresh = await store.recordObservation(await roster(f), undefined, next);
    expect(fresh.observationId).toBeDefined();
    const other = await fixture(); const otherToken = await mapping(other);
    const cacheOnly = await store.recordObservation(await roster(other, 'player-a', 'cache'), undefined, otherToken);
    expect(await ownerQuery(`SELECT * FROM league_administration_observation_mappings WHERE observation_id=$1`, [cacheOnly.observationId])).toEqual([]);
  });

  it('rejects a token writer blocked behind an uncommitted same-source revision on a second session', async () => {
    const f = await fixture(); const token = await mapping(f);
    await store.recordObservation(await roster(f), undefined, token);
    const input = await roster(f, 'in-flight-change');
    const owner = await createPinnedIntegrationDatabase('owner');
    const writer = await createPinnedIntegrationDatabase('runtime');
    let completion: Promise<{ error?: unknown }> | undefined;
    try {
      const [ownerPid] = await owner.database.query('SELECT pg_backend_pid() AS pid');
      const [writerPid] = await writer.database.query('SELECT pg_backend_pid() AS pid');
      await owner.database.query('BEGIN');
      await owner.database.query(`SELECT revise_league_source_connection($1,'sleeper',$2,$3,'held same-source correction')`,
        [f.leagueSeasonId, token.revisionId, f.externalLeagueId]);
      let settled = false;
      completion = createLeagueAdministrationMethods(writer.database).recordObservation(input, undefined, token)
        .then(() => ({}), error => ({ error })).finally(() => { settled = true; });
      let blocked = false;
      for (let attempt = 0; attempt < 50; attempt++) {
        const [state] = await ownerQuery(`SELECT $1::integer=ANY(pg_blocking_pids($2::integer)) AS blocked`, [ownerPid.pid, writerPid.pid]);
        if (state.blocked) { blocked = true; break; }
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      expect(blocked).toBe(true); expect(settled).toBe(false);
      await owner.database.query('COMMIT');
      const afterRemap = await counts(f);
      const result = await completion;
      expect(String(result.error)).toMatch(/mapping revision is stale/);
      expect(await counts(f)).toEqual(afterRemap);
      expect((await mapping(f)).generation).toBe(2);
    } finally {
      await owner.database.query('ROLLBACK').catch(() => undefined);
      await completion;
      await writer.close(); await owner.close();
    }
  });

  it('rejects source scope and connection identity substitution', async () => {
    const f = await fixture(); const token = await mapping(f); const input = await roster(f);
    const other = await fixture(); const foreign = await mapping(other);
    await expect(store.recordObservation(input, undefined, foreign)).rejects.toThrow(/scope mismatch/);
    await expect(store.recordObservation(input, undefined, { ...foreign, scope: token.scope })).rejects.toThrow(/mapping revision is stale/);
  });

  it('retains legacy rollback writes explicitly unverified and preserves exact historical revision links', async () => {
    const f = await fixture(); const token = await mapping(f);
    const exact = await store.recordObservation(await roster(f), undefined, token);
    await revise(f, token);
    const legacy = await store.recordObservation(await roster(f, 'rollback-caller'));
    expect(legacy.status).toBe('changed');
    expect(await store.readSource({ ...token.scope, family: 'rosters', week: null })).toMatchObject({ status: 'available', commonRoster: {
      lineage: { sourceMappingRevisionId: null, reasons: ['mapping_revision_not_captured'] } } });
    expect(await ownerQuery(`SELECT source_mapping_revision_id FROM league_administration_observation_mappings WHERE observation_id=$1`, [exact.observationId]))
      .toEqual([{ source_mapping_revision_id: token.revisionId }]);
  });

  it('allocates a new annual connection and revision while preserving league, season and team identities', async () => {
    const f = await fixture(); const token = await mapping(f);
    await store.recordObservation(await roster(f), undefined, token);
    const before = await ownerQuery(`SELECT id FROM league_season_teams WHERE league_season_id=$1`, [f.leagueSeasonId]);
    const nextExternal = `annual-${randomUUID()}`;
    const [next] = await ownerQuery(`SELECT public.connect_league_administration_season($1,2151::smallint,$2,$3,$4,$5::jsonb,'reviewed annual continuity') AS id`,
      [f.leagueId, f.externalLeagueId, nextExternal, compatibleScoringRulesHash(rules), JSON.stringify(rules)]);
    const nextToken = await store.readSourceMapping(nextExternal);
    expect(nextToken).toMatchObject({ generation: 1, leagueSeasonId: next.id, scope: { season: 2151, leagueKey: f.leagueKey } });
    expect(nextToken?.connectionId).not.toBe(token.connectionId); expect(nextToken?.revisionId).not.toBe(token.revisionId);
    expect(await mapping(f)).toEqual(token);
    expect(await ownerQuery(`SELECT id FROM league_season_teams WHERE league_season_id=$1`, [f.leagueSeasonId])).toEqual(before);
  });

  it('denies runtime pointer forgery, revision and lineage mutation, and owner-only entry points', async () => {
    const f = await fixture(); const token = await mapping(f);
    for (const mutation of ["id=gen_random_uuid()", 'mapping_generation=mapping_generation+1', 'current_mapping_revision_id=gen_random_uuid()']) {
      await expect(runtimeQuery(`UPDATE league_source_connections SET ${mutation} WHERE league_season_id=$1`, [f.leagueSeasonId])).rejects.toThrow();
    }
    for (const table of ['league_source_mapping_revisions', 'league_administration_observation_mappings']) {
      for (const privilege of ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'TRIGGER', 'REFERENCES']) {
        expect(await ownerQuery(`SELECT has_table_privilege('league_one_runtime',$1,$2) AS allowed`, [`public.${table}`, privilege])).toEqual([{ allowed: false }]);
      }
    }
    await expect(runtimeQuery(`SELECT revise_league_source_connection($1,'sleeper',$2,$3,'forged')`,
      [f.leagueSeasonId, token.revisionId, f.externalLeagueId])).rejects.toThrow(/permission denied/);
    await expect(ownerQuery(`UPDATE league_source_mapping_revisions SET evidence='rewrite' WHERE id=$1`, [token.revisionId])).rejects.toThrow(/immutable/);
    const catalog = await ownerQuery(`SELECT proname,prosecdef,proconfig,
      EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) acl
        WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE') AS public_execute
      FROM pg_proc p WHERE pronamespace='public'::regnamespace AND proname IN
      ('revise_league_source_connection','guard_source_mapping_pointer','record_initial_source_mapping_revision')`);
    expect(catalog).toHaveLength(3);
    for (const row of catalog) expect(row).toMatchObject({ prosecdef: true, public_execute: false, proconfig: ['search_path=pg_catalog, public, pg_temp'] });
  });

  it('rejects contradictory owner lineage inserts, and cannot replace or erase an exact link', async () => {
    const f = await fixture(); const token = await mapping(f); const foreign = await mapping(await fixture());
    const legacy = await store.recordObservation(await roster(f));
    await expect(ownerQuery(`INSERT INTO league_administration_observation_mappings VALUES($1,$2)`,
      [legacy.observationId, foreign.revisionId])).rejects.toThrow(/lineage mismatch/);
    const exact = await store.recordObservation(await roster(f), undefined, token);
    await expect(ownerQuery(`UPDATE league_administration_observation_mappings SET source_mapping_revision_id=$2 WHERE observation_id=$1`,
      [exact.observationId, foreign.revisionId])).rejects.toThrow(/immutable/);
    await expect(ownerQuery(`DELETE FROM league_administration_observation_mappings WHERE observation_id=$1`, [exact.observationId])).rejects.toThrow(/immutable/);
  });
});
