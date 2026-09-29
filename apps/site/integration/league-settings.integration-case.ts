import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { JsonObject, JsonValue, NormalizedAdministrationObservation } from '../lib/league-administration/contracts';
import { normalizeAdministrationObservation } from '../lib/league-administration/normalize';
import { createLeagueAdministrationMethods } from '../lib/league-administration/neon/administration';
import { createProjectionStore } from '../lib/projection-store';
import type { RosterAttempt } from '../lib/aggregator/current-roster';
import { LEAGUE_SETTINGS_FIELDS, leagueSettingsScope } from '../lib/aggregator/league-settings';
import { createIndependentDatabase, ownerQuery, runtimeQuery, type IndependentDatabase } from './neon-integration-harness';

const rules = { rec: 0.5 };
describe.sequential('exact shared league-season/settings acceptance', () => {
  let connection: IndependentDatabase;
  let store: ReturnType<typeof createLeagueAdministrationMethods>;
  beforeAll(() => { connection = createIndependentDatabase(); store = createLeagueAdministrationMethods(connection.database); });
  afterAll(async () => connection.close());
  async function fixture(season = 2175) {
    const leagueKey = `settings-${randomUUID()}`; const externalLeagueId = `source-${randomUUID()}`;
    const result = await createProjectionStore(connection.database).registerLeagueSeason({ leagueKey, leagueName: 'Synthetic settings',
      season, sleeperLeagueId: externalLeagueId, scoringRules: rules });
    if (result.kind !== 'stored') throw new Error('Isolated persistence disabled.');
    await ownerQuery("INSERT INTO league_administration_enrollments(league_id,provider,evidence) VALUES($1,'sleeper','synthetic fixture')", [result.value.leagueId]);
    await ownerQuery("INSERT INTO league_administration_enrollment_seasons(league_id,season,provider,evidence) VALUES($1,$2,'sleeper','synthetic fixture')", [result.value.leagueId, season]);
    const mapping = await store.readSourceMapping(externalLeagueId); if (!mapping) throw new Error('Missing fixture mapping.');
    const payload: JsonObject = { league_id: externalLeagueId, season: String(season), sport: 'nfl', total_rosters: 2,
      name: 'Synthetic settings', avatar: null, previous_league_id: null, status: 'in_season', season_type: 'regular',
      roster_positions: ['QB', 'BN'], scoring_settings: rules, settings: { leg: 4, last_scored_leg: 3, playoff_week_start: 15, waiver_budget: 100 } };
    return { ...result.value, leagueKey, externalLeagueId, season, mapping, payload };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  async function capture(f: Fixture, payload: JsonValue = f.payload, completeness: 'complete' | 'partial' = 'complete') {
    const [clock] = await ownerQuery('SELECT clock_timestamp() AS at');
    const at = (clock.at instanceof Date ? clock.at : new Date(String(clock.at))).toISOString();
    return normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1',
      dialect: 'sleeper-nfl-v1', scope: f.mapping.scope, family: 'league', week: null, completeness, payload,
      provenance: { origin: 'network', requestStartedAt: at, requestCompletedAt: at, sourceObservedAt: at, checkedAt: at } });
  }
  const reserve = (f: Fixture) => store.beginLeagueSettingsAttempt(f.mapping, randomUUID());
  const write = (f: Fixture, input: NormalizedAdministrationObservation, attempt: RosterAttempt) =>
    store.recordObservation(input, undefined, f.mapping, undefined, undefined, { attempt });
  async function read(f: Fixture) {
    const current = await store.readAcceptedLeagueSettings(f.mapping); expect(current.status).toBe('available');
    if (current.status !== 'available') throw new Error('Missing league resource.'); return current;
  }
  async function seed() {
    const f = await fixture(); const attempt = await reserve(f); const input = await capture(f);
    const result = await write(f, input, attempt); expect(result.leagueSettingsAcceptance?.status).toBe('accepted');
    return { f, attempt, input, result, current: await read(f) };
  }

  it('binds exact raw/configuration/mapping evidence to existing league identities', async () => {
    const { f, input, result, current } = await seed();
    expect(current.leagueId).toBe(f.leagueId); expect(current.leagueSeasonId).toBe(f.leagueSeasonId);
    expect(current.accepted).toMatchObject({ scope: leagueSettingsScope(f.mapping), sourceMappingRevisionId: f.mapping.revisionId,
      acceptedGeneration: 1, effectiveFrom: null, effectiveTo: null });
    expect(current.receipt).toMatchObject({ legacyObservationId: result.observationId, rawContentHash: input.contentHash,
      configurationSemanticHash: input.semanticHash, configurationVersionId: result.versionId, provenance: input.envelope.provenance });
    expect(await ownerQuery('SELECT coverage FROM league_roster_capture_receipts WHERE id=$1', [current.receipt.id])).toEqual([
      { coverage: { periodIds: [], interval: null, entitySet: 'full', fields: LEAGUE_SETTINGS_FIELDS, pagination: 'complete', nextCursor: null, completeness: 'complete', reasons: [] } }]);
  });

  it('keeps operational status/period changes in distinct capture content with the same immutable configuration', async () => {
    const { f, current } = await seed(); const attempt = await reserve(f);
    const input = await capture(f, { ...f.payload, status: 'complete', settings: { ...(f.payload.settings as JsonObject), leg: 5 } });
    await write(f, input, attempt); const next = await read(f);
    expect(next.receipt.configurationVersionId).toBe(current.receipt.configurationVersionId);
    expect(next.receipt.configurationSemanticHash).toBe(current.receipt.configurationSemanticHash);
    expect(next.accepted.contentId).not.toBe(current.accepted.contentId);
    expect(next.value.lifecycle.value).toBe('complete'); expect(next.value.periods[0].value?.source.nativeId).toBe('5');
    expect(await ownerQuery('SELECT payload FROM league_administration_contents WHERE id=$1', [current.accepted.contentId])).toEqual([{ payload: f.payload }]);
  });

  it('retains fresh exact receipts when v1 reuses an older observation and rejects changed retries atomically', async () => {
    const { f, current, result: prior } = await seed(); const attempt = await reserve(f); const input = await capture(f);
    const result = await write(f, input, attempt); const next = await read(f);
    expect(result).toMatchObject({ status: 'unchanged', observationId: prior.observationId });
    expect(next.accepted.contentId).toBe(current.accepted.contentId); expect(next.receipt.id).not.toBe(current.receipt.id);
    expect(next.receipt.provenance).toEqual(input.envelope.provenance); expect(next.receipt.provenance).not.toEqual(current.receipt.provenance);
    expect((await write(f, input, attempt)).leagueSettingsAcceptance).toMatchObject({ status: 'accepted', reason: 'exact_receipt_replay', receiptId: next.receipt.id });
    await expect(write(f, await capture(f, { ...f.payload, name: 'Changed retry' }), attempt)).rejects.toThrow(/receipt conflict/);
    expect(await read(f)).toEqual(next);
  });

  it.each([['missing', undefined, 'absent'], ['null', null, 'null'], ['empty', {}, 'empty'], ['invalid', 7, 'invalid']] as const)
    ('accepts only identity coverage for %s optional settings, without blending old groups', async (_label, settings, state) => {
      const { f, current } = await seed(); const payload = { ...f.payload }; if (settings === undefined) delete payload.settings; else payload.settings = settings;
      const attempt = await reserve(f); const input = await capture(f, payload); const result = await write(f, input, attempt); const next = await read(f);
      expect(result.leagueSettingsAcceptance?.status).toBe('accepted'); expect(next.accepted.acceptedGeneration).toBe(2);
      expect(next.value.nativeSettings.fields.state).toBe(state); expect(next.value.waivers.budget.value).toBeNull();
      expect(next.accepted.contentId).not.toBe(current.accepted.contentId);
      if (state === 'invalid') {
        expect(result.status).toBe('rejected'); expect(next.receipt.configurationVersionId).toBeNull();
        expect(next.comparison.legacyConfiguration).toBe('rejected');
        const legacy = await store.readSource({ ...f.mapping.scope, family: 'league', week: null });
        expect(legacy).toMatchObject({ status: 'available', envelope: { payload: f.payload } });
      }
    });

  it('keeps native unknown scoring while v1 scoring-profile compatibility still blocks its current reader', async () => {
    const { f } = await seed(); const attempt = await reserve(f);
    const input = await capture(f, { ...f.payload, scoring_settings: { rec: 0.5, unknown_rule: 2 } });
    const result = await write(f, input, attempt); expect(result.status).toBe('rejected'); expect(result.leagueSettingsAcceptance?.status).toBe('accepted');
    expect((await read(f)).value.interpretation).toMatchObject({ scoring: 'limited', unsupportedScoringRules: ['unknown_rule'] });
    expect(await store.readSource({ ...f.mapping.scope, family: 'league', week: null })).toMatchObject({ status: 'conflict' });
  });

  it.each<JsonObject>([{ league_id: 'wrong' }, { season: '2174' }, { sport: 'nba' }])('preserves identity head after wrong source identity %j', async change => {
    const { f, current } = await seed(); const attempt = await reserve(f);
    expect((await write(f, await capture(f, { ...f.payload, ...change }), attempt)).leagueSettingsAcceptance?.status).toBe('preserved');
    expect(await read(f)).toEqual(current);
  });

  it('preserves complete head after partial capture, older completion and a failed latest reservation', async () => {
    const { f, current } = await seed(); const partial = await reserve(f);
    expect((await write(f, await capture(f, f.payload, 'partial'), partial)).leagueSettingsAcceptance?.status).toBe('preserved');
    const older = await reserve(f); const olderInput = await capture(f, { ...f.payload, name: 'Older response' });
    const newer = await reserve(f); const newerInput = await capture(f, { ...f.payload, name: 'Newer response' });
    await write(f, newerInput, newer); const next = await read(f);
    expect(next.accepted.acceptedGeneration).toBe(current.accepted.acceptedGeneration + 1);
    expect((await write(f, olderInput, older)).leagueSettingsAcceptance).toMatchObject({ status: 'preserved', reason: 'newer_network_attempt_reserved' });
    expect(await read(f)).toEqual(next);
    const abandoned = await reserve(f); const input = await capture(f); await reserve(f);
    expect((await write(f, input, abandoned)).leagueSettingsAcceptance?.status).toBe('preserved'); expect(await read(f)).toEqual(next);
  });

  it('rejects unreserved/cached acquisitions and changed policy tokens', async () => {
    const { f, current } = await seed(); const input = await capture(f); const attempt = await reserve(f);
    expect((await write(f, input, attempt)).leagueSettingsAcceptance?.status).toBe('preserved');
    const next = await reserve(f); const fresh = await capture(f);
    await expect(write(f, { ...fresh, envelope: { ...fresh.envelope, provenance: { ...fresh.envelope.provenance, origin: 'cache' } } }, next)).rejects.toThrow(/network capture/);
    await expect(write(f, fresh, { ...next, ordinal: next.ordinal + 1 })).rejects.toThrow(/scope mismatch/);
    expect(await read(f)).toEqual(current);
  });

  it('fences A-B-A mapping changes and keeps immutable old capture lineage', async () => {
    const { f, current } = await seed(); const attempt = await reserve(f); const input = await capture(f);
    const other = `remap-${randomUUID()}`;
    await ownerQuery("SELECT revise_league_source_connection($1,'sleeper',$2,$3,'synthetic remap')", [f.leagueSeasonId, f.mapping.revisionId, other]);
    const middle = await store.readSourceMapping(other);
    await ownerQuery("SELECT revise_league_source_connection($1,'sleeper',$2,$3,'synthetic return')", [f.leagueSeasonId, middle!.revisionId, f.externalLeagueId]);
    const latest = await store.readSourceMapping(f.externalLeagueId); const remapped = { ...f, mapping: latest! };
    await expect(write(f, input, attempt)).rejects.toThrow(/mapping.*(?:stale|mismatch)|source mapping/);
    expect(await store.readAcceptedLeagueSettings(latest!)).toEqual({ status: 'missing' });
    const fresh = await reserve(remapped); await write(remapped, await capture(remapped), fresh);
    expect((await read(remapped)).accepted.sourceMappingRevisionId).toBe(latest!.revisionId);
    expect(await ownerQuery('SELECT source_mapping_revision_id FROM league_roster_resource_acceptances WHERE receipt_id=$1', [current.receipt.id]))
      .toEqual([{ source_mapping_revision_id: f.mapping.revisionId }]);
  });

  it('leaves v1 population independently authoritative for players and managers', async () => {
    const { f, input: league, result } = await seed();
    const proof = { observationId: result.observationId!, contentHash: league.contentHash, envelope: league.envelope };
    const rosterPayload = [{ roster_id: 1, owner_id: null, co_owners: [], players: [] }, { roster_id: 2, owner_id: 'manager', co_owners: [], players: ['p'] }];
    const captureRoster = async () => {
      const input = await capture(f); return normalizeAdministrationObservation({ ...input.envelope, family: 'rosters', payload: rosterPayload });
    };
    const first = await store.beginRosterCapture(f.mapping, randomUUID(), randomUUID());
    const accepted = await store.recordObservation(await captureRoster(), undefined, f.mapping, { attempt: first.players, population: proof }, { attempt: first.managers, population: proof });
    expect(accepted.rosterAcceptance?.status).toBe('accepted'); expect(accepted.teamManagerAcceptance?.status).toBe('accepted');
    const settingsAttempt = await reserve(f); await write(f, await capture(f, { ...f.payload, total_rosters: null }), settingsAttempt);
    expect((await read(f)).value.teamCount.state).toBe('null');
    const next = await store.beginRosterCapture(f.mapping, randomUUID(), randomUUID());
    const preserved = await store.recordObservation(await captureRoster(), undefined, f.mapping, { attempt: next.players }, { attempt: next.managers });
    expect(preserved.rosterAcceptance?.status).toBe('preserved'); expect(preserved.teamManagerAcceptance?.status).toBe('preserved');
    expect(await store.readAcceptedCurrentRoster(f.mapping)).toMatchObject({ status: 'available', accepted: { acceptedGeneration: 1 } });
  });

  it('does not create shadow acceptance for old callers and isolates league/season scopes', async () => {
    const first = await seed(); const second = await fixture(2176);
    await store.recordObservation(await capture(second)); expect(await store.readAcceptedLeagueSettings(second.mapping)).toEqual({ status: 'missing' });
    const attempt = await reserve(second); await expect(write(second, first.input, attempt)).rejects.toThrow(/mapping mismatch|scope/);
    await write(second, await capture(second), attempt); expect((await read(second)).leagueSeasonId).not.toBe(first.current.leagueSeasonId);
    const old = { ...await capture(first.f, { ...first.f.payload, name: 'Old caller' }) }; delete old.leagueSettings;
    await store.recordObservation(old); expect(await read(first.f)).toEqual(first.current);
  });

  it('retains restricted permissions and rejects receipt/history tampering', async () => {
    const { current } = await seed();
    await expect(runtimeQuery('UPDATE league_roster_resource_heads SET generation=generation+1 WHERE scope_id=$1', [current.accepted.scope.connectionId])).rejects.toThrow(/permission denied/);
    await expect(ownerQuery('UPDATE league_roster_capture_receipts SET provenance=provenance WHERE id=$1', [current.receipt.id])).rejects.toThrow();
    await expect(runtimeQuery('SELECT record_league_administration_observation_v1($1::jsonb)', ['{}'])).rejects.toThrow(/permission denied/);
  });

  it('binds writer lease, generation and deadline without a tokenless fallback', async () => {
    const { f, current } = await seed(); const jobKey = `settings-fence:${randomUUID()}`; const workerId = randomUUID();
    await ownerQuery(`INSERT INTO projection_jobs(job_key,job_type,scheduled_for,state,lease_owner,lease_until,attempt_count)
      VALUES($1,'league-administration',clock_timestamp(),'running',$2,clock_timestamp()+interval '5 minutes',1)`, [jobKey, workerId]);
    const [clock] = await ownerQuery("SELECT clock_timestamp()+interval '5 minutes' AS at");
    const fence = { jobKey, workerId, generation: 1, deadlineAt: new Date(String(clock.at)).toISOString() };
    const attempt = await store.beginLeagueSettingsAttempt(f.mapping, randomUUID(), fence); const input = await capture(f);
    await expect(write(f, input, attempt)).rejects.toThrow(/scope mismatch/);
    await ownerQuery("UPDATE projection_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE job_key=$1", [jobKey]);
    await expect(store.recordObservation(input, fence, f.mapping, undefined, undefined, { attempt })).rejects.toThrow(/fence.*(?:expired|stale)/);
    expect(await read(f)).toEqual(current);
    const roster = await store.beginRosterAttempt(f.mapping, randomUUID());
    await expect(write(f, await capture(f), roster)).rejects.toThrow(/policy mismatch/);
  });
});
