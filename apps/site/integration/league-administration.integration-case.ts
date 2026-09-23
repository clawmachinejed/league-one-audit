import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AdministrationEnvelope, AdministrationFamily, JsonValue } from '../lib/league-administration/contracts';
import { normalizeAdministrationObservation } from '../lib/league-administration/normalize';
import { createLeagueAdministrationMethods } from '../lib/league-administration/neon/administration';
import { createProjectionStore } from '../lib/projection-store';
import { compatibleScoringRulesHash } from '../lib/projections/shared/revision-compatibility';
import { createIndependentDatabase, integrationEnvironment, ownerQuery, runtimeQuery,
  type IndependentDatabase } from './neon-integration-harness';

const rules = { pass_td: 4, rec: 0.5 };
type Fixture = { leagueKey: string; leagueId: string; leagueSeasonId: string; externalLeagueId: string; profileId: string };

function envelope(fixture: Fixture, tick: number, payload?: JsonValue,
  family: AdministrationFamily = 'league', week: number | null = null): AdministrationEnvelope {
  const at = (seconds: number) => new Date(Date.UTC(2026, 8, 12, 12, 0, tick * 10 + seconds)).toISOString();
  return {
    schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1', dialect: 'sleeper-nfl-v1',
    scope: { leagueKey: fixture.leagueKey, provider: 'sleeper', externalLeagueId: fixture.externalLeagueId, season: 2150 },
    family, week, completeness: 'complete',
    provenance: { origin: 'network', requestStartedAt: at(0), requestCompletedAt: at(1), sourceObservedAt: at(1), checkedAt: at(2) },
    payload: payload ?? { league_id: fixture.externalLeagueId, season: '2150', sport: 'nfl', name: 'A', total_rosters: 1,
      roster_positions: ['QB', 'BN'], scoring_settings: rules, settings: { playoff_week_start: 15, waiver_budget: 100 } },
  };
}

describe.sequential('portable league administration against the isolated Neon database', () => {
  let connection: IndependentDatabase;
  let administration: ReturnType<typeof createLeagueAdministrationMethods>;
  beforeAll(() => { connection = createIndependentDatabase(); administration = createLeagueAdministrationMethods(connection.database); });
  afterAll(async () => { await connection.close(); });

  async function fixture(): Promise<Fixture> {
    const leagueKey = `administration-${randomUUID()}`;
    const externalLeagueId = `source-${randomUUID()}`;
    const registration = await createProjectionStore(connection.database).registerLeagueSeason({
      leagueKey, leagueName: 'Administration integration', season: 2150, sleeperLeagueId: externalLeagueId, scoringRules: rules,
    });
    if (registration.kind !== 'stored') throw new Error('Isolated database unexpectedly disabled.');
    const { leagueId, leagueSeasonId, scoringProfileId } = registration.value;
    await ownerQuery(`INSERT INTO public.league_administration_enrollments(league_id,provider,evidence)
      VALUES($1,'sleeper','isolated integration fixture')`, [leagueId]);
    await ownerQuery(`INSERT INTO public.league_administration_enrollment_seasons(league_id,season,provider,evidence)
      VALUES($1,2150,'sleeper','isolated integration fixture')`, [leagueId]);
    return { leagueKey, externalLeagueId, leagueId, leagueSeasonId, profileId: scoringProfileId };
  }

  it('reuses unchanged content, records A to B to A, and never guesses a historical effective week', async () => {
    const f = await fixture();
    const first = await administration.recordObservation(normalizeAdministrationObservation(envelope(f, 1)));
    const repeat = await administration.recordObservation(normalizeAdministrationObservation(envelope(f, 2)));
    const b = { ...envelope(f, 3), payload: { ...(envelope(f, 3).payload as object), name: 'B' } as JsonValue };
    const second = await administration.recordObservation(normalizeAdministrationObservation(b));
    const third = await administration.recordObservation(normalizeAdministrationObservation(envelope(f, 4)));
    expect(first.status).toBe('changed'); expect(repeat.status).toBe('unchanged');
    expect(repeat.observationId).toBe(first.observationId);
    expect(second.versionId).not.toBe(first.versionId); expect(third.versionId).toBe(first.versionId);
    expect(third.observationId).not.toBe(first.observationId);
    const counts = await ownerQuery(`SELECT
      (SELECT count(*)::integer FROM league_configuration_versions WHERE league_season_id=$1) AS versions,
      (SELECT count(*)::integer FROM league_administration_observations WHERE league_season_id=$1) AS observations,
      (SELECT count(*)::integer FROM league_configuration_activations WHERE league_season_id=$1 AND applicability='evidenced_period') AS historical`, [f.leagueSeasonId]);
    expect(counts).toEqual([{ versions: 2, observations: 3, historical: 0 }]);
    expect(await administration.readSource({ ...envelope(f, 4).scope, family: 'league', week: null }))
      .toMatchObject({ status: 'available', observationId: third.observationId, versionId: first.versionId, generation: 3 });
  });

  it('retains a changed scoring version without rebinding or exposing an unapproved scoring head', async () => {
    const f = await fixture();
    const original = await administration.recordObservation(normalizeAdministrationObservation(envelope(f, 1)));
    const changed = envelope(f, 2, { ...(envelope(f, 2).payload as object), scoring_settings: { rec: 1 },
      roster_positions: ['QB', 'WR', 'BN'] } as JsonValue);
    const result = await administration.recordObservation(normalizeAdministrationObservation(changed));
    expect(result.status).toBe('rejected'); expect(result.versionId).not.toBe(original.versionId);
    expect(await administration.readSource({ ...changed.scope, family: 'league', week: null }))
      .toMatchObject({ status: 'conflict', reason: 'scoring_profile_change_requires_explicit_compatibility_and_period_review' });
    expect(await ownerQuery('SELECT scoring_profile_id FROM league_seasons WHERE id=$1', [f.leagueSeasonId]))
      .toEqual([{ scoring_profile_id: f.profileId }]);
    const components = await ownerQuery(`SELECT head.component,activation.configuration_version_id FROM league_configuration_heads head
      JOIN league_configuration_activations activation ON activation.id=head.activation_id WHERE head.league_season_id=$1`, [f.leagueSeasonId]);
    expect(components.find(row => row.component === 'scoring')?.configuration_version_id).toBe(original.versionId);
    expect(components.find(row => row.component === 'roster')?.configuration_version_id).toBe(result.versionId);
    await ownerQuery(`SELECT public.activate_league_configuration_component($1,'scoring','reg',1::smallint,14::smallint,
      'confirmed scoring-only correction applies from week 1',1)`, [result.versionId]);
    expect(await ownerQuery(`SELECT component,from_week,through_week FROM league_configuration_activations
      WHERE league_season_id=$1 AND applicability='evidenced_period'`, [f.leagueSeasonId]))
      .toEqual([{ component: 'scoring', from_week: 1, through_week: 14 }]);
    await expect(ownerQuery(`SELECT public.activate_league_configuration_component($1,'scoring','reg',1::smallint,14::smallint,'stale correction',1)`, [result.versionId]))
      .rejects.toThrow(/compare-and-swap/u);
  });

  it('retains reordered collection evidence and provenance without advancing its semantic generation', async () => {
    const f = await fixture();
    const users = [{ user_id: 'manager-a', display_name: 'A' }, { user_id: 'manager-b', display_name: 'B' }];
    const firstInput = normalizeAdministrationObservation(envelope(f, 1, users, 'users'));
    const reorderedInput = normalizeAdministrationObservation(envelope(f, 2, [...users].reverse(), 'users'));
    expect(firstInput.status).toBe('accepted'); expect(reorderedInput.status).toBe('accepted');
    expect(reorderedInput.contentHash).not.toBe(firstInput.contentHash);
    expect(reorderedInput.semanticHash).toBe(firstInput.semanticHash);
    const first = await administration.recordObservation(firstInput);
    const reordered = await administration.recordObservation(reorderedInput);
    expect(first).toMatchObject({ status: 'changed', generation: 1 });
    expect(reordered).toMatchObject({ status: 'unchanged', generation: first.generation });
    expect(reordered.observationId).not.toBe(first.observationId);
    expect(await ownerQuery(`SELECT count(*)::integer AS contents,count(DISTINCT content_hash)::integer AS raw_hashes,
      count(DISTINCT semantic_hash)::integer AS semantic_hashes FROM league_administration_contents
      WHERE league_season_id=$1 AND family='users'`, [f.leagueSeasonId]))
      .toEqual([{ contents: 2, raw_hashes: 2, semantic_hashes: 1 }]);
    expect(await ownerQuery(`SELECT observation.id,observation.outcome,content.payload
      FROM league_administration_observations observation JOIN league_administration_contents content ON content.id=observation.content_id
      WHERE observation.league_season_id=$1 AND observation.family='users' ORDER BY observation.source_observed_at`, [f.leagueSeasonId]))
      .toEqual([{ id: first.observationId, outcome: 'changed', payload: users },
        { id: reordered.observationId, outcome: 'unchanged', payload: [...users].reverse() }]);
    expect(await ownerQuery(`SELECT accepted_observation_id,latest_observation_id FROM league_administration_heads
      WHERE league_season_id=$1 AND family='users'`, [f.leagueSeasonId]))
      .toEqual([{ accepted_observation_id: reordered.observationId, latest_observation_id: reordered.observationId }]);
    expect(await administration.readSource({ ...firstInput.envelope.scope, family: 'users', week: null }))
      .toMatchObject({ status: 'available', observationId: reordered.observationId, generation: first.generation,
        checkedAt: reorderedInput.envelope.provenance.checkedAt, verifiedAt: reorderedInput.envelope.provenance.sourceObservedAt,
        envelope: reorderedInput.envelope });
    const changedUsers = [{ ...users[0], display_name: 'Renamed A' }, users[1]];
    const changedInput = normalizeAdministrationObservation(envelope(f, 3, changedUsers, 'users'));
    expect(changedInput.semanticHash).not.toBe(firstInput.semanticHash);
    const changed = await administration.recordObservation(changedInput);
    expect(changed).toMatchObject({ status: 'changed', generation: 2 });
    expect(changed.observationId).not.toBe(reordered.observationId);
    expect(await administration.readSource({ ...firstInput.envelope.scope, family: 'users', week: null }))
      .toMatchObject({ status: 'available', observationId: changed.observationId, generation: changed.generation,
        envelope: { payload: changedUsers } });
  });

  it('preserves collection stale, equal-time and unknown-age cache guards despite equivalent semantic hashes', async () => {
    const f = await fixture();
    const users = [{ user_id: 'manager-a', display_name: 'A' }, { user_id: 'manager-b', display_name: 'B' }];
    const acceptedInput = normalizeAdministrationObservation(envelope(f, 3, users, 'users'));
    const accepted = await administration.recordObservation(acceptedInput);
    const readInput = { ...acceptedInput.envelope.scope, family: 'users' as const, week: null };
    const acceptedRead = await administration.readSource(readInput);
    const olderInput = normalizeAdministrationObservation(envelope(f, 2, [...users].reverse(), 'users'));
    expect(olderInput.semanticHash).toBe(acceptedInput.semanticHash);
    expect((await administration.recordObservation(olderInput)).status).toBe('stale');
    expect(await administration.readSource(readInput)).toEqual(acceptedRead);
    const cachedEnvelope = envelope(f, 4, [...users].reverse(), 'users');
    const cachedInput = normalizeAdministrationObservation({ ...cachedEnvelope, provenance: { ...cachedEnvelope.provenance,
      origin: 'cache', requestStartedAt: null, requestCompletedAt: null, sourceObservedAt: null } });
    expect((await administration.recordObservation(cachedInput)).status).toBe('stale');
    expect(await administration.readSource(readInput)).toEqual(acceptedRead);
    const sameCachedInput = normalizeAdministrationObservation({ ...cachedInput.envelope, payload: users });
    expect((await administration.recordObservation(sameCachedInput)).status).toBe('unchanged');
    expect(await administration.readSource(readInput)).toEqual(acceptedRead);
    const equalTime = await administration.recordObservation(normalizeAdministrationObservation(envelope(f, 3, [...users].reverse(), 'users')));
    expect(equalTime).toMatchObject({ status: 'rejected', reason: 'equal_source_time_has_different_content', generation: 2 });
    expect(await administration.readSource(readInput))
      .toEqual({ status: 'conflict', reason: 'equal_source_time_has_different_content' });
    expect(await ownerQuery(`SELECT accepted_observation_id,latest_observation_id,
      checked_at=$2::timestamptz AS original_checked_at,verified_at=$3::timestamptz AS original_verified_at
      FROM league_administration_heads WHERE league_season_id=$1 AND family='users'`,
    [f.leagueSeasonId, acceptedInput.envelope.provenance.checkedAt, acceptedInput.envelope.provenance.sourceObservedAt]))
      .toEqual([{ accepted_observation_id: accepted.observationId, latest_observation_id: equalTime.observationId,
        original_checked_at: true, original_verified_at: true }]);
    const recoveredInput = normalizeAdministrationObservation(envelope(f, 5, users, 'users'));
    const recovered = await administration.recordObservation(recoveredInput);
    expect(recovered).toMatchObject({ status: 'unchanged', generation: 3 });
    expect(await administration.readSource(readInput))
      .toMatchObject({ status: 'available', observationId: recovered.observationId, generation: recovered.generation,
        envelope: recoveredInput.envelope });
  });

  it('updates readable league operational evidence while reusing the unchanged settings version', async () => {
    const f = await fixture();
    const payload = envelope(f, 1).payload as Record<string, JsonValue>;
    const settings = payload.settings as Record<string, JsonValue>;
    const firstInput = normalizeAdministrationObservation(envelope(f, 1, { ...payload, status: 'pre_draft',
      settings: { ...settings, leg: 1, last_scored_leg: 0 } }));
    const nextInput = normalizeAdministrationObservation(envelope(f, 2, { ...payload, status: 'in_season',
      settings: { ...settings, leg: 2, last_scored_leg: 1 } }));
    expect(firstInput.status).toBe('accepted'); expect(nextInput.status).toBe('accepted');
    expect(nextInput.contentHash).not.toBe(firstInput.contentHash);
    expect(nextInput.semanticHash).toBe(firstInput.semanticHash);
    const first = await administration.recordObservation(firstInput);
    const next = await administration.recordObservation(nextInput);
    expect(first).toMatchObject({ status: 'changed', generation: 1 });
    expect(next).toMatchObject({ status: 'changed', generation: 2, versionId: first.versionId });
    expect(next.observationId).not.toBe(first.observationId);
    expect(await administration.readSource({ ...nextInput.envelope.scope, family: 'league', week: null }))
      .toMatchObject({ status: 'available', observationId: next.observationId, versionId: first.versionId,
        generation: next.generation, verifiedAt: nextInput.envelope.provenance.sourceObservedAt, envelope: nextInput.envelope });
    expect(await ownerQuery(`SELECT
      (SELECT count(*)::integer FROM league_configuration_versions WHERE league_season_id=$1) AS versions,
      (SELECT count(*)::integer FROM league_administration_contents WHERE league_season_id=$1) AS contents,
      (SELECT count(*)::integer FROM league_administration_observations WHERE league_season_id=$1) AS observations`, [f.leagueSeasonId]))
      .toEqual([{ versions: 1, contents: 2, observations: 2 }]);
  });

  it('serializes replaying captures, keeps older and unproven cache evidence from replacing newer source facts', async () => {
    const f = await fixture();
    const input = normalizeAdministrationObservation(envelope(f, 3));
    const other = createIndependentDatabase();
    try {
      const results = await Promise.all([administration.recordObservation(input), createLeagueAdministrationMethods(other.database).recordObservation(input)]);
      expect(results.map(value => value.status).sort()).toEqual(['changed', 'replayed']);
    } finally { await other.close(); }
    expect((await administration.recordObservation(normalizeAdministrationObservation(envelope(f, 1)))).status).toBe('stale');
    const cached = envelope(f, 5, { ...(envelope(f, 5).payload as object), name: 'unproven cached A' } as JsonValue);
    const cacheInput = normalizeAdministrationObservation({ ...cached, provenance: { ...cached.provenance,
      origin: 'cache', requestStartedAt: null, requestCompletedAt: null, sourceObservedAt: null } });
    expect((await administration.recordObservation(cacheInput)).status).toBe('stale');
    const read = await administration.readSource({ ...input.envelope.scope, family: 'league', week: null });
    expect(read).toMatchObject({ status: 'available', generation: 1, envelope: { payload: { name: 'A' } } });
    const sameCache = normalizeAdministrationObservation({ ...envelope(f, 6), provenance: { ...cached.provenance,
      origin: 'cache', requestStartedAt: null, requestCompletedAt: null, sourceObservedAt: null } });
    expect((await administration.recordObservation(sameCache)).status).toBe('unchanged');
    expect(await administration.readSource({ ...input.envelope.scope, family: 'league', week: null })).toEqual(read);
    const newB = normalizeAdministrationObservation(envelope(f, 7, { ...(envelope(f, 7).payload as object), name: 'B' } as JsonValue));
    expect((await administration.recordObservation(newB)).status).toBe('changed');
    expect((await administration.recordObservation(input)).status).toBe('stale');
    const oldKnownCache = normalizeAdministrationObservation({ ...envelope(f, 9), provenance: {
      ...envelope(f, 9).provenance, origin: 'cache', sourceObservedAt: input.envelope.provenance.sourceObservedAt } });
    expect((await administration.recordObservation(oldKnownCache)).status).toBe('stale');
  });

  it('retains partial and invalid captures while serving the last complete operational head', async () => {
    const f = await fixture();
    const roster = [{ roster_id: 1, owner_id: 'owner-a', co_owners: ['owner-b'], players: ['unmapped-player'], starters: ['0'], reserve: [], taxi: [] }];
    const complete = await administration.recordObservation(normalizeAdministrationObservation(envelope(f, 1, roster, 'rosters')));
    const partial = normalizeAdministrationObservation({ ...envelope(f, 2, [], 'rosters'), completeness: 'partial' });
    expect((await administration.recordObservation(partial)).status).toBe('rejected');
    const invalid = normalizeAdministrationObservation(envelope(f, 3, [{ roster_id: 1 }, { roster_id: 1 }], 'rosters'));
    expect(invalid.status).toBe('rejected');
    expect((await administration.recordObservation(invalid)).status).toBe('rejected');
    expect(await administration.readSource({ ...envelope(f, 3).scope, family: 'rosters', week: null }))
      .toMatchObject({ status: 'available', observationId: complete.observationId, checkedAt: envelope(f, 1).provenance.checkedAt,
        envelope: { payload: roster } });
    expect((await administration.recordObservation(invalid)).status).toBe('rejected');
    expect(await ownerQuery(`SELECT count(*)::integer AS memberships FROM league_administration_memberships WHERE league_season_id=$1`, [f.leagueSeasonId]))
      .toEqual([{ memberships: 2 }]);
  });

  it('scopes teams to their source season, preserves changed memberships and exact weekly transactions including week zero', async () => {
    const a = await fixture(); const b = await fixture();
    for (const f of [a, b]) await administration.recordObservation(normalizeAdministrationObservation(envelope(f, 1,
      [{ roster_id: 1, owner_id: 'shared-manager', players: [], starters: [] }], 'rosters')));
    await administration.recordObservation(normalizeAdministrationObservation(envelope(a, 2,
      [{ roster_id: 1, owner_id: 'replacement-manager', players: [], starters: [] }], 'rosters')));
    expect(await ownerQuery(`SELECT count(DISTINCT team_id)::integer AS teams,count(*)::integer AS memberships
      FROM league_administration_memberships WHERE league_season_id=ANY($1::uuid[])`, [[a.leagueSeasonId, b.leagueSeasonId]]))
      .toEqual([{ teams: 2, memberships: 3 }]);
    await administration.recordObservation(normalizeAdministrationObservation(envelope(a, 3, [], 'transactions', 0)));
    await administration.recordObservation(normalizeAdministrationObservation(envelope(a, 4, [], 'transactions', 1)));
    expect(await administration.readSource({ ...envelope(a, 3).scope, family: 'transactions', week: 0 }))
      .toMatchObject({ status: 'available', envelope: { family: 'transactions', week: 0 } });
    expect(await administration.readSource({ ...envelope(a, 3).scope, family: 'transactions', week: 2 })).toEqual({ status: 'missing' });
  });

  it('checks the existing worker lease generation and deadline before writing administration evidence', async () => {
    const f = await fixture(); const jobKey = `administration:${randomUUID()}`; const workerId = randomUUID();
    await ownerQuery(`INSERT INTO projection_jobs(job_key,job_type,scheduled_for,state,lease_owner,lease_until,attempt_count)
      VALUES($1,'league-administration',now(),'running',$2,now()+interval '5 minutes',3)`, [jobKey, workerId]);
    const fence = { jobKey, workerId, generation: 2, deadlineAt: new Date(Date.now() + 60_000).toISOString() };
    const input = normalizeAdministrationObservation(envelope(f, 1));
    await expect(administration.recordObservation(input, fence)).rejects.toThrow(/writer fence/u);
    expect((await administration.recordObservation(input, { ...fence, generation: 3 })).status).toBe('changed');
    await expect(administration.recordObservation(input, { ...fence, generation: 3, deadlineAt: '2020-01-01T00:00:00.000Z' }))
      .rejects.toThrow(/writer fence/u);
  });

  it('requires evidenced owner source remaps, invalidates old heads and keeps normal unchanged registration compatible', async () => {
    const f = await fixture();
    await administration.recordObservation(normalizeAdministrationObservation(envelope(f, 1)));
    await createProjectionStore(connection.database).registerLeagueSeason({ leagueKey: f.leagueKey, leagueName: 'Same', season: 2150,
      sleeperLeagueId: f.externalLeagueId, scoringRules: rules });
    expect(await ownerQuery(`SELECT count(*)::integer AS count FROM league_source_connection_history WHERE league_season_id=$1`, [f.leagueSeasonId]))
      .toEqual([{ count: 1 }]);
    await expect(runtimeQuery('UPDATE league_source_connections SET external_league_id=$2 WHERE league_season_id=$1', [f.leagueSeasonId, 'wrong-source']))
      .rejects.toThrow(/evidenced owner remap/u);
    await expect(runtimeQuery(`SELECT public.remap_league_source_connection($1,'sleeper',$2,$3,'runtime attempt')`, [f.leagueSeasonId, f.externalLeagueId, `new-${f.externalLeagueId}`]))
      .rejects.toThrow(/permission/u);
    await ownerQuery(`SELECT public.remap_league_source_connection($1,'sleeper',$2,$3,'documented source correction')`, [f.leagueSeasonId, f.externalLeagueId, `new-${f.externalLeagueId}`]);
    expect(await administration.readSourceByConnection({ provider: 'sleeper', externalLeagueId: f.externalLeagueId, family: 'league', week: null }))
      .toMatchObject({ status: 'conflict' });
    await expect(administration.recordObservation(normalizeAdministrationObservation(envelope(f, 2)))).rejects.toThrow();
  });

  it('allows owner-approved annual continuity with shared profiles and pins intended season membership', async () => {
    const f = await fixture();
    await expect(createProjectionStore(connection.database).registerLeagueSeason({ leagueKey: f.leagueKey, leagueName: 'Same', season: 2151,
      sleeperLeagueId: `2151-${f.externalLeagueId}`, scoringRules: rules })).rejects.toThrow(/continuity approval/u);
    await ownerQuery(`SELECT public.connect_league_administration_season($1,2151::smallint,$2,$3,$4,$5::jsonb,'source previous_league_id verified')`,
      [f.leagueId, f.externalLeagueId, `2151-${f.externalLeagueId}`, compatibleScoringRulesHash(rules), JSON.stringify(rules)]);
    expect(await ownerQuery(`SELECT scoring_profile_id FROM league_seasons WHERE league_id=$1 ORDER BY season`, [f.leagueId]))
      .toEqual([{ scoring_profile_id: f.profileId }, { scoring_profile_id: f.profileId }]);
    expect((await administration.listEnrollments()).find(row => row.leagueId === f.leagueId))
      .toMatchObject({ season: 2151, externalLeagueId: `2151-${f.externalLeagueId}` });
    expect(await ownerQuery(`SELECT season FROM league_administration_enrollment_seasons WHERE league_id=$1 ORDER BY season`, [f.leagueId]))
      .toEqual([{ season: 2150 }, { season: 2151 }]);
  });

  it('denies runtime table mutation and owner history edits, seals child entries, and validates calculation lineage', async () => {
    const f = await fixture();
    const configuration = await administration.recordObservation(normalizeAdministrationObservation(envelope(f, 1)));
    const roster = await administration.recordObservation(normalizeAdministrationObservation(envelope(f, 2,
      [{ roster_id: 1, owner_id: 'manager', players: [], starters: [] }], 'rosters')));
    await expect(runtimeQuery('UPDATE league_administration_heads SET generation=99 WHERE league_season_id=$1', [f.leagueSeasonId])).rejects.toThrow(/permission/u);
    await expect(ownerQuery('DELETE FROM league_configuration_versions WHERE id=$1', [configuration.versionId])).rejects.toThrow(/immutable/u);
    await expect(ownerQuery(`INSERT INTO league_administration_team_entries(content_id,league_season_id,team_id,source_value)
      SELECT observation.content_id,$2,team.id,'{}'::jsonb FROM league_administration_observations observation
      JOIN league_season_teams team ON team.league_season_id=$2 WHERE observation.id=$1`, [roster.observationId, f.leagueSeasonId]))
      .rejects.toThrow(/sealed/u);
    const sourceData = { administration: { observationId: configuration.observationId, configurationVersionId: configuration.versionId, generation: configuration.generation } };
    const insert = `INSERT INTO league_week_observations(league_season_id,provider,week,source_revision,request_started_at,request_completed_at,observed_at,quality,expected_game_count,source_data)
      VALUES($1,'sleeper',1,$2,now(),now(),now(),'complete',1,$3::jsonb)`;
    await runtimeQuery(insert, [f.leagueSeasonId, randomUUID(), JSON.stringify(sourceData)]);
    await expect(runtimeQuery(insert, [f.leagueSeasonId, randomUUID(), JSON.stringify({ administration: { ...sourceData.administration, generation: 999 } })]))
      .rejects.toThrow(/lineage/u);
    const privileges = await ownerQuery(`SELECT p.proname,has_function_privilege('league_one_runtime',p.oid,'EXECUTE') AS runtime,
      EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) acl WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE') AS public
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
        AND p.proname IN ('record_league_administration_observation','activate_league_configuration_component','remap_league_source_connection','connect_league_administration_season')`);
    expect(privileges).toHaveLength(4);
    for (const row of privileges) expect(row).toMatchObject({ public: false, runtime: row.proname === 'record_league_administration_observation' });
  });

  it('keeps the writer schema-qualified under temporary shadow tables', async () => {
    const f = await fixture(); const temporary = createIndependentDatabase(integrationEnvironment().runtimeDatabaseUrl);
    try {
      await temporary.database.query('BEGIN');
      await temporary.database.query('CREATE TEMP TABLE league_administration_heads (trap text)');
      expect((await createLeagueAdministrationMethods(temporary.database).recordObservation(normalizeAdministrationObservation(envelope(f, 1)))).status).toBe('changed');
      await temporary.database.query('ROLLBACK');
    } finally { await temporary.close(); }
  });

  it('rechecks configuration at publication and permits a fresh verification observation with reused immutable snapshot content', async () => {
    const f = await fixture();
    async function official(configuration: Awaited<ReturnType<typeof administration.recordObservation>>) {
      const id = randomUUID();
      await runtimeQuery(`INSERT INTO league_week_observations(id,league_season_id,provider,week,source_revision,request_started_at,request_completed_at,observed_at,quality,expected_game_count,source_data)
        VALUES($1::uuid,$2,'sleeper',1,$1::text,now(),now(),now(),'complete',1,$3::jsonb)`, [id, f.leagueSeasonId, JSON.stringify({ administration: {
        observationId: configuration.observationId, configurationVersionId: configuration.versionId, generation: configuration.generation,
      } })]);
      return id;
    }
    const first = await administration.recordObservation(normalizeAdministrationObservation(envelope(f, 1)));
    const originalSource = await official(first); const snapshotId = randomUUID();
    await ownerQuery(`INSERT INTO projection_snapshots(id,league_season_id,week,model_version,revision_key,content_hash,
      league_week_observation_id,calculated_at,payload) VALUES($1,$2,1,'administration-test','original','hash',$3,now(),'{}'::jsonb)`,
    [snapshotId, f.leagueSeasonId, originalSource]);
    const second = await administration.recordObservation(normalizeAdministrationObservation(envelope(f, 2,
      { ...(envelope(f, 2).payload as object), name: 'Changed after calculation' } as JsonValue)));
    const publish = `INSERT INTO current_projection_snapshots(league_season_id,week,snapshot_id,calculated_at,verification_source_observation_id)
      VALUES($1,1,$2,now(),$3)`;
    await expect(runtimeQuery(publish, [f.leagueSeasonId, snapshotId, originalSource])).rejects.toThrow(/published snapshot administration lineage/u);
    const freshSource = await official(second);
    await runtimeQuery(publish, [f.leagueSeasonId, snapshotId, freshSource]);
    await runtimeQuery('UPDATE current_projection_snapshots SET verified_at=now() WHERE league_season_id=$1', [f.leagueSeasonId]);
    expect(await ownerQuery('SELECT snapshot_id,verification_source_observation_id FROM current_projection_snapshots WHERE league_season_id=$1', [f.leagueSeasonId]))
      .toEqual([{ snapshot_id: snapshotId, verification_source_observation_id: freshSource }]);
  });

  it('selects the latest intended season, ignoring unapproved higher registrations and refusing an incomplete intended one', async () => {
    const f = await fixture();
    try {
      await ownerQuery('INSERT INTO league_seasons(league_id,season,scoring_profile_id) VALUES($1,2151,$2)', [f.leagueId, f.profileId]);
      expect((await administration.listEnrollments()).find(row => row.leagueId === f.leagueId))
        .toMatchObject({ season: 2150, externalLeagueId: f.externalLeagueId });
      await ownerQuery(`INSERT INTO league_administration_enrollment_seasons(league_id,season,provider,evidence)
        VALUES($1,2151,'sleeper','intended season; connection not yet registered')`, [f.leagueId]);
      await expect(administration.listEnrollments()).rejects.toThrow(/Missing administration/u);
      expect((await administration.listEnrollmentInventory()).entries.find(row => row.intended.leagueId === f.leagueId))
        .toMatchObject({ status: 'unavailable', intended: { season: 2151 }, reason: 'missing-source-connection' });
      expect(await administration.readEnrollment({ leagueKey: f.leagueKey }, 2150))
        .toMatchObject({ status: 'ready', enrollment: { season: 2150, externalLeagueId: f.externalLeagueId } });
    } finally {
      await ownerQuery('UPDATE league_administration_enrollments SET active=false WHERE league_id=$1', [f.leagueId]);
    }
  });

  it('tracks real network verification separately from cached checks and rejected source attempts', async () => {
    const f = await fixture();
    const read = () => administration.readSource({ ...envelope(f, 1).scope, family: 'league', week: null });
    const cached = { ...envelope(f, 1), provenance: { ...envelope(f, 1).provenance, origin: 'cache' as const, sourceObservedAt: null } };
    await administration.recordObservation(normalizeAdministrationObservation(cached));
    expect(await read()).toMatchObject({ status: 'available', verifiedAt: null });
    await administration.recordObservation(normalizeAdministrationObservation(envelope(f, 2)));
    expect(await read()).toMatchObject({ status: 'available', verifiedAt: envelope(f, 2).provenance.sourceObservedAt });
    const laterCache = { ...envelope(f, 3), provenance: { ...envelope(f, 3).provenance, origin: 'cache' as const, sourceObservedAt: null } };
    await administration.recordObservation(normalizeAdministrationObservation(laterCache));
    expect(await read()).toMatchObject({ status: 'available', verifiedAt: envelope(f, 2).provenance.sourceObservedAt,
      checkedAt: envelope(f, 2).provenance.checkedAt });
    await administration.recordObservation(normalizeAdministrationObservation(envelope(f, 4)));
    expect(await read()).toMatchObject({ status: 'available', verifiedAt: envelope(f, 4).provenance.sourceObservedAt });
    await administration.recordObservation(normalizeAdministrationObservation(envelope(f, 5, { malformed: true })));
    expect(await read()).toMatchObject({ status: 'available', verifiedAt: envelope(f, 4).provenance.sourceObservedAt,
      checkedAt: envelope(f, 4).provenance.checkedAt });
  });

  it('retains accepted metadata and partial attempts without leaking another annual source or replacing complete evidence', async () => {
    const f = await fixture();
    const families = ['drafts', 'traded_picks', 'winners_bracket', 'losers_bracket'] as const;
    for (const family of families) {
      const first = normalizeAdministrationObservation(envelope(f, 1, [], family));
      expect(first.status).toBe('accepted');
      const accepted = await administration.recordObservation(first);
      expect((await administration.recordObservation(first)).status).toBe('replayed');
      const partial = normalizeAdministrationObservation({ ...envelope(f, 2, [], family), completeness: 'partial',
        provenance: { ...envelope(f, 2).provenance, sourceObservedAt: null } });
      expect((await administration.recordObservation(partial)).status).toBe('rejected');
      const failed = normalizeAdministrationObservation({ ...envelope(f, 3, null, family), payload: null, completeness: 'partial',
        provenance: { ...envelope(f, 3).provenance, sourceObservedAt: null } });
      expect(failed.status).toBe('rejected');
      const failure = await administration.recordObservation(failed);
      expect(failure.status).toBe('rejected');
      expect(await ownerQuery('SELECT source_observed_at FROM league_administration_observations WHERE id=$1', [failure.observationId]))
        .toEqual([{ source_observed_at: null }]);
      expect(await administration.readSource({ ...first.envelope.scope, family, week: null }))
        .toMatchObject({ status: 'available', observationId: accepted.observationId,
          verifiedAt: first.envelope.provenance.sourceObservedAt, envelope: { family, week: null, payload: [] } });
    }
    const nextExternal = `2151-${f.externalLeagueId}`;
    await ownerQuery(`SELECT public.connect_league_administration_season($1,2151::smallint,$2,$3,$4,$5::jsonb,'metadata annual continuity verified')`,
      [f.leagueId, f.externalLeagueId, nextExternal, compatibleScoringRulesHash(rules), JSON.stringify(rules)]);
    const next = { ...envelope(f, 3, [], 'drafts'), scope: { ...envelope(f, 3).scope, season: 2151, externalLeagueId: nextExternal } };
    expect(await administration.readSource({ ...next.scope, family: 'drafts', week: null })).toEqual({ status: 'missing' });
    const captured = await administration.recordObservation(normalizeAdministrationObservation(next));
    expect(await administration.readSourceByConnection({ provider: 'sleeper', externalLeagueId: nextExternal, family: 'drafts', week: null }))
      .toMatchObject({ status: 'available', observationId: captured.observationId,
        envelope: { scope: { leagueKey: f.leagueKey, season: 2151, externalLeagueId: nextExternal } } });
    expect(await administration.readSourceByConnection({ provider: 'sleeper', externalLeagueId: f.externalLeagueId, family: 'drafts', week: null }))
      .toMatchObject({ status: 'available', envelope: { scope: { season: 2150, externalLeagueId: f.externalLeagueId } } });
  });

  it('retains each validation result when identical source content fails under different roster expectations', async () => {
    const f = await fixture();
    const source = envelope(f, 1, [{ roster_id: 1 }, { roster_id: 1 }], 'rosters');
    const first = normalizeAdministrationObservation(source, { expectedRosterCount: 1 });
    const second = normalizeAdministrationObservation(source, { expectedRosterCount: 2 });
    expect(first.status).toBe('rejected'); expect(second.status).toBe('rejected');
    expect(first.contentHash).toBe(second.contentHash); expect(first.diagnostics).not.toEqual(second.diagnostics);
    const a = await administration.recordObservation(first); const b = await administration.recordObservation(second);
    expect(a.observationId).not.toBe(b.observationId);
    const rows = await ownerQuery(`SELECT content_id,diagnostics FROM league_administration_observations
      WHERE id=ANY($1::uuid[]) ORDER BY recorded_at,id`, [[a.observationId, b.observationId]]);
    expect(rows).toHaveLength(2); expect(rows[0].content_id).toBe(rows[1].content_id);
    expect(rows.map(row => row.diagnostics)).toEqual([first.diagnostics, second.diagnostics]);
  });
});
