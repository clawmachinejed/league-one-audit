import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { DatabaseClient, DatabaseQueryOptions, DatabaseRow } from '../lib/database';
import type { JsonObject, JsonValue, NormalizedAdministrationObservation } from '../lib/league-administration/contracts';
import type { AdministrationSourceMapping } from '../lib/league-administration/source-mapping';
import type { AdministrationWriteFence } from '../lib/league-administration/store-contracts';
import type { RosterAttempt } from '../lib/aggregator/current-roster';
import { TRADED_PICKS_VERSION, projectTradedPicks, type TradedPicksRead,
  type TradedPicksResource, type TradedPicksSelection } from '../lib/aggregator/traded-picks';
import { createLeagueAdministrationStore } from '../lib/league-administration/store';
import { normalizeAdministrationObservation } from '../lib/league-administration/normalize';
import { getOfficialDraftAdministration } from '../lib/sleeper';
import { createProjectionStore } from '../lib/projection-store';
import { exactMatchupClockInstant } from './exact-matchup-clock';
import { createIndependentDatabase, createPinnedIntegrationDatabase, ownerQuery, type IndependentDatabase } from './neon-integration-harness';

const numericId = () => '9' + BigInt('0x' + randomUUID().replaceAll('-', '').slice(0, 15));
const typedTables = ['league_traded_pick_contents', 'league_traded_pick_catalog_entries', 'league_traded_pick_entries'] as const;
const catalogResource = { kind: 'catalog' } as const;
const detailResource = (externalDraftId: string) => ({ kind: 'draft', externalDraftId } as const);
type StoredRead = Extract<TradedPicksRead, { value: unknown }>;

/** CP18 closed seven-case profile. Synthetic HTTP -> normalizer -> shared restricted writer -> typed stored reads.
 * Seven 60s bodies and two 120s hooks =11m; global work remains30m, lifecycle40m, CI50m.
 * No CP19 ordinary intake/refresh, live provider, independent-session contention or future-season traversal.
 * Embedded SET ROLE evidence cannot qualify the required restricted LOGIN/TLS assertion below. */
describe.sequential('official traded picks through restricted PostgreSQL', () => {
  let connection: IndependentDatabase;
  let administration: ReturnType<typeof createLeagueAdministrationStore>;
  beforeAll(async () => {
    connection = createIndependentDatabase(); administration = createLeagueAdministrationStore(connection.database);
    expect((await connection.database.query(`SELECT current_user,session_user,rolsuper,rolcreaterole,rolcreatedb
      FROM pg_roles WHERE rolname=current_user`))[0]).toEqual({ current_user: 'league_one_runtime',
      session_user: 'league_one_runtime', rolsuper: false, rolcreaterole: false, rolcreatedb: false });
  }, 120_000);
  afterAll(async () => { vi.restoreAllMocks(); await connection.close(); }, 120_000);
  async function fixture() {
    const external = numericId(), leagueKey = 'cp18-' + randomUUID();
    const registered = await createProjectionStore(connection.database).registerLeagueSeason({ leagueKey,
      leagueName: 'CP18 synthetic draft metadata', season: 2026, sleeperLeagueId: external, scoringRules: { rec: 0.5 } });
    if (registered.kind !== 'stored') throw new Error('CP18 fixture registration unavailable.');
    await ownerQuery("INSERT INTO league_administration_enrollments(league_id,provider,evidence) VALUES($1,'sleeper','CP18 synthetic prerequisite')", [registered.value.leagueId]);
    await ownerQuery("INSERT INTO league_administration_enrollment_seasons(league_id,season,provider,evidence) VALUES($1,2026,'sleeper','CP18 synthetic prerequisite')", [registered.value.leagueId]);
    const mapping = await administration.readSourceMapping(external); if (!mapping) throw new Error('Missing CP18 mapping.');
    return { ...registered.value, external, mapping };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  function native(f: Fixture, draftId = '90071992547409939', changes: JsonObject = {}): JsonObject {
    return { draft_id: draftId, league_id: f.external, season: '2026', sport: 'nfl', type: 'snake', status: 'complete',
      settings: { rounds: 15, teams: 2, reversal_round: 0, future_flag: false }, metadata: { name: 'Synthetic draft' },
      start_time: 1788000000000, created: 1780000000000, last_picked: 1788000300000,
      draft_order: { '90071992547409941': 2, '90071992547409940': 1 }, slot_to_roster_id: { '2': '90071992547409942', '1': 1 },
      future_native: { enabled: false, zero: 0 }, ...changes };
  }
  const pick = (round = 1, changes: JsonObject = {}): JsonObject => ({ season: '2026', round, roster_id: '1', owner_id: '2', previous_owner_id: 1, ...changes });
  const payloadFor = (row: JsonObject, tradedPicks: JsonValue = [pick()]): JsonObject => ({ tradedPicksVersion: TRADED_PICKS_VERSION,
    kind: 'draft', externalDraftId: row.draft_id, catalog: row, tradedPicks });
  const reserve = (f: Fixture, resource: TradedPicksResource, fence?: AdministrationWriteFence, store = administration) => {
    if (!store.beginTradedPicksAttempt) throw new Error('Missing CP18 reservation.');
    return store.beginTradedPicksAttempt(f.mapping, resource, randomUUID(), fence);
  };
  const write = (f: Fixture, input: NormalizedAdministrationObservation, attempt: RosterAttempt,
    fence?: AdministrationWriteFence, store = administration) => store.recordObservation(input, fence, f.mapping,
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, { attempt });
  async function observation(f: Fixture, payload: JsonValue, completeness: 'complete' | 'partial' = 'complete') {
    const [clock] = await connection.database.query('SELECT clock_timestamp() AS at FROM pg_sleep(0.005)');
    const at = exactMatchupClockInstant(clock.at);
    return normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1',
      dialect: 'sleeper-nfl-v1', scope: f.mapping.scope, family: 'drafts', week: null, completeness, payload,
      provenance: { origin: 'network', requestStartedAt: at, requestCompletedAt: at, sourceObservedAt: completeness === 'partial' ? null : at, checkedAt: at } });
  }
  async function waitForSourceClock() {
    const [clock] = await connection.database.query('SELECT clock_timestamp() AS at');
    const until = new Date(exactMatchupClockInstant(clock.at)).getTime() + 20;
    expect(until - Date.now()).toBeLessThanOrEqual(2_000);
    if (Date.now() < until) await delay(until - Date.now());
  }
  async function read(mapping: AdministrationSourceMapping, selection: TradedPicksSelection, store = administration): Promise<StoredRead> {
    if (!store.readTradedPicks) throw new Error('Missing CP18 stored reader.');
    const result = await store.readTradedPicks(mapping, selection);
    expect(['available', 'observed']).toContain(result.status);
    if (result.status !== 'available' && result.status !== 'observed') throw new Error('Missing CP18 stored metadata.');
    return result;
  }
  async function capture(f: Fixture, picks: JsonValue = [pick()], completeness: 'complete' | 'partial' = 'complete', fence?: AdministrationWriteFence) {
    const resource = detailResource(String(native(f).draft_id)), attempt = await reserve(f, resource, fence);
    const input = await observation(f, payloadFor(native(f), picks), completeness), result = await write(f, input, attempt, fence);
    const receiptId = result.tradedPicksAcceptance?.receiptId; if (!receiptId) throw new Error('Missing CP18 receipt.');
    const value = await read(f.mapping, { ...resource, receiptId });
    return { resource, attempt, input, result, value };
  }
  async function sourceCapture(f: Fixture, rows: JsonValue, responses: ReadonlyMap<string, JsonValue | Error> = new Map(), maxRequests = 10) {
    const attempts = new Map<string, RosterAttempt>([['catalog', await reserve(f, catalogResource)], ['league', await reserve(f, { kind: 'league' })]]);
    await waitForSourceClock();
    const urls: string[] = [];
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input); urls.push(url);
      if (url === `https://api.sleeper.app/v1/league/${f.external}/traded_picks`) return Response.json(responses.get('league') ?? [pick(2, { season: '2027' })]);
      if (url === `https://api.sleeper.app/v1/league/${f.external}/drafts`)
        return new Response(JSON.stringify(rows), { headers: { 'content-type': 'application/json' } });
      const match = /^https:\/\/api\.sleeper\.app\/v1\/draft\/([A-Za-z0-9_-]+)\/traded_picks$/u.exec(url);
      if (!match) throw new Error('Unexpected CP18 source endpoint: ' + url);
      const body = responses.has(match[1]) ? responses.get(match[1]) : [pick(9), pick(1, { owner_id: '90071992547409939999' })];
      if (body instanceof Error) throw body;
      return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
    });
    try {
      const acquired = await getOfficialDraftAdministration(f.external, 2026, { tradedPicksOnly: true, maxRequests,
        signal: AbortSignal.timeout(20_000), beforeDetail: async id => {
          attempts.set(id, await reserve(f, detailResource(id))); await waitForSourceClock();
        } });
      expect(acquired.providerRequests).toBe(urls.length);
      const captures = [];
      for (const document of acquired.observations) {
        const payload = document.payload as JsonObject;
        const resource = payload.kind === 'draft' ? detailResource(String(payload.externalDraftId)) : { kind: payload.kind as 'catalog' | 'league' };
        const attempt = attempts.get(resource.kind === 'draft' ? resource.externalDraftId : resource.kind);
        if (!attempt) throw new Error('Unreserved CP18 adapter capture.');
        const input = normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1',
          dialect: 'sleeper-nfl-v1', scope: f.mapping.scope, family: document.family, week: document.week,
          completeness: document.completeness ?? 'complete', payload,
          provenance: { origin: document.origin, requestStartedAt: document.requestStartedAt, requestCompletedAt: document.requestCompletedAt,
            sourceObservedAt: document.sourceObservedAt, checkedAt: new Date().toISOString() } });
        const result = await write(f, input, attempt), receiptId = result.tradedPicksAcceptance?.receiptId;
        if (!receiptId) throw new Error('Missing CP18 adapter receipt.');
        const value = await read(f.mapping, { ...resource, receiptId });
        expect(value.provenance).toEqual(input.envelope.provenance);
        const projection = projectTradedPicks(input);
        expect(value.value).toEqual(projection.value);
        expect(await connection.database.query('SELECT payload,normalized_value FROM league_administration_contents WHERE id=$1', [value.contentId]))
          .toEqual([{ payload, normalized_value: input.value }]);
        captures.push({ resource, attempt, input, result, value });
      }
      return { acquired, urls, captures };
    } finally { fetch.mockRestore(); }
  }
  async function history(f: Fixture) {
    const typed = typedTables.map(table => `(SELECT jsonb_agg(to_jsonb(typed) ORDER BY to_jsonb(typed)::text)
      FROM public.${table} typed JOIN league_administration_contents content ON content.id=typed.content_id
      WHERE content.league_season_id=$1) AS ${table}`);
    return connection.database.query(`SELECT
      (SELECT jsonb_agg(to_jsonb(content) ORDER BY content.id) FROM league_administration_contents content WHERE content.league_season_id=$1 AND family='drafts') AS legacy,
      (SELECT jsonb_agg(to_jsonb(observation) ORDER BY observation.id) FROM league_administration_observations observation WHERE observation.league_season_id=$1 AND family='drafts') AS observations,
      (SELECT jsonb_agg(to_jsonb(receipt) ORDER BY receipt.id) FROM league_roster_capture_receipts receipt JOIN league_roster_resource_attempts attempt ON attempt.id=receipt.attempt_id WHERE attempt.source_mapping->>'leagueSeasonId'=$1::text) AS receipts,
      (SELECT jsonb_agg(to_jsonb(accepted) ORDER BY accepted.id) FROM league_roster_resource_acceptances accepted JOIN league_roster_resource_scopes scope ON scope.id=accepted.scope_id WHERE scope.league_season_id=$1) AS acceptances,
      (SELECT jsonb_agg(to_jsonb(head) ORDER BY head.scope_id) FROM league_roster_resource_heads head JOIN league_roster_resource_scopes scope ON scope.id=head.scope_id WHERE scope.league_season_id=$1) AS heads,
      (SELECT jsonb_agg(to_jsonb(identity) ORDER BY identity.id) FROM league_season_drafts identity WHERE identity.league_season_id=$1) AS draft_identities,
      (SELECT jsonb_agg(to_jsonb(asset) ORDER BY asset.id) FROM league_traded_pick_assets asset WHERE asset.league_season_id=$1) AS assets,
      ${typed.join(',')}`, [f.leagueSeasonId]);
  }
  async function storedOnly<T>(body: (store: ReturnType<typeof createLeagueAdministrationStore>) => Promise<T>) {
    const statements: string[] = [];
    const database: DatabaseClient = { enabled: true,
      query: async <Row extends DatabaseRow = DatabaseRow>(sql: string, parameters?: readonly unknown[], options?: DatabaseQueryOptions) => {
        statements.push(sql); expect(sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|CALL)\b/iu);
        return connection.database.query<Row>(sql, parameters, options);
      } };
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('CP18 stored reader must not fetch.'));
    try { const result = await body(createLeagueAdministrationStore(database));
      expect(fetch).not.toHaveBeenCalled(); expect(statements.length).toBeGreaterThan(0); return result;
    } finally { fetch.mockRestore(); }
  }

  async function fenceFor(label: string) {
    const jobKey = 'cp18-' + label + '-' + randomUUID(), workerId = randomUUID();
    await ownerQuery(`INSERT INTO projection_jobs(job_key,job_type,scheduled_for,state,lease_owner,lease_until,attempt_count)
      VALUES($1,'league-administration',clock_timestamp(),'running',$2,clock_timestamp()+interval '30 seconds',1)`, [jobKey, workerId]);
    const [clock] = await connection.database.query("SELECT clock_timestamp()+interval '20 seconds' AS at");
    return { jobKey, workerId, generation: 1, deadlineAt: exactMatchupClockInstant(clock.at) } satisfies AdministrationWriteFence;
  }
  const finishJob = (fence: AdministrationWriteFence) => ownerQuery("UPDATE projection_jobs SET state='failed',lease_owner=NULL,lease_until=NULL,completed_at=clock_timestamp() WHERE job_key=$1", [fence.jobKey]);

  it('stores endpoint scoped native ownership and future references through fixture HTTP and restricted readers', async () => {
    const f = await fixture(), rows = [native(f, 'draft-b'), native(f, 'draft-a')];
    const result = await sourceCapture(f, rows, new Map([
      ['league', [pick(2, { season: '2027', owner_id: 3, unknown_native: { zero: 0, flag: false, nested: null } })]],
      ['draft-b', [pick(2, { season: '2027', owner_id: '90071992547409939999' }), pick(1)]],
      ['draft-a', [pick(2, { season: '2027', owner_id: 4 })]],
    ]));
    expect(result.urls).toEqual([`https://api.sleeper.app/v1/league/${f.external}/traded_picks`, `https://api.sleeper.app/v1/league/${f.external}/drafts`,
      'https://api.sleeper.app/v1/draft/draft-b/traded_picks', 'https://api.sleeper.app/v1/draft/draft-a/traded_picks']);
    expect(result.captures[1].value).toMatchObject({ status: 'available', value: { kind: 'catalog', totalCount: 2,
      attemptedTradeCount: 2, succeededTradeCount: 2, entries: [{ sourceOrdinal: 0, externalDraftId: 'draft-b' }, { sourceOrdinal: 1, externalDraftId: 'draft-a' }] } });
    expect(result.captures[0].value).toMatchObject({ value: { kind: 'league', externalDraftId: null, entries: [{ pickSeason: { raw: '2027', value: '2027' },
      ownershipState: 'resolved', currentOwnerId: '3', extensions: { unknown_native: { zero: 0, flag: false, nested: null } } }] } });
    expect(result.captures[2].value).toMatchObject({ value: { kind: 'draft', entries: [{ sourceOrdinal: 0, round: { value: 2 }, currentOwnerId: '90071992547409939999' },
      { sourceOrdinal: 1, round: { value: 1 } }] } });
    expect(await connection.database.query(`SELECT endpoint_key,pick_season,round_value::text,original_roster_id FROM league_traded_pick_assets
      WHERE league_season_id=$1 ORDER BY endpoint_key,pick_season,round_value`, [f.leagueSeasonId])).toEqual([
      { endpoint_key: 'draft:draft-a:traded-picks', pick_season: '2027', round_value: '2', original_roster_id: '1' },
      { endpoint_key: 'draft:draft-b:traded-picks', pick_season: '2026', round_value: '1', original_roster_id: '1' },
      { endpoint_key: 'draft:draft-b:traded-picks', pick_season: '2027', round_value: '2', original_roster_id: '1' },
      { endpoint_key: 'league', pick_season: '2027', round_value: '2', original_roster_id: '1' },
    ]);
    expect(await connection.database.query('SELECT season FROM league_seasons WHERE league_id=$1', [f.leagueId])).toEqual([{ season: 2026 }]);
    expect(await connection.database.query('SELECT season FROM league_administration_enrollment_seasons WHERE league_id=$1', [f.leagueId])).toEqual([{ season: 2026 }]);
    for (let i = 1; i < result.acquired.observations.length; i++) expect(result.acquired.observations[i - 1].requestCompletedAt <= result.acquired.observations[i].requestStartedAt).toBe(true);
    await storedOnly(async store => { for (const captured of result.captures) {
      expect(await read(f.mapping, { ...captured.resource, receiptId: captured.value.receiptId }, store)).toEqual(captured.value);
      expect((await read(f.mapping, captured.resource, store)).receiptId).toBe(captured.value.receiptId);
    } });
  }, 60_000);

  it('advances fresh conflict and unknown evidence while preserving field states duplicates and previous owner ambiguity', async () => {
    const f = await fixture(), known = await capture(f), conflict = await capture(f, [pick(), pick(1, { owner_id: 3 })]);
    expect(conflict.value).toMatchObject({ status: 'available', value: { complete: true, entries: [
      { ownershipState: 'conflict', currentOwnerId: null, ownerId: { value: '2' } },
      { ownershipState: 'conflict', currentOwnerId: null, ownerId: { value: '3' } }] } });
    expect((await read(f.mapping, known.resource)).receiptId).toBe(conflict.value.receiptId);
    const absent = Object.fromEntries(Object.entries(pick()).filter(([key]) => key !== 'owner_id'));
    const unknown = await capture(f, [absent]);
    expect(await read(f.mapping, known.resource)).toMatchObject({ receiptId: unknown.value.receiptId, value: { complete: true,
      entries: [{ ownerId: { state: 'missing', raw: null, value: null }, ownershipState: 'unknown', currentOwnerId: null }] } });
    const corrected = await capture(f, [pick(1, { owner_id: 4, previous_owner_id: 2 }), pick(1, { owner_id: 4, previous_owner_id: 3 })]);
    expect(corrected.value).toMatchObject({ status: 'available', value: { entries: [
      { ownershipState: 'resolved', currentOwnerId: '4', previousOwnerState: 'conflict', evidencedPreviousOwnerId: null },
      { ownershipState: 'resolved', currentOwnerId: '4', previousOwnerState: 'conflict', evidencedPreviousOwnerId: null }] } });
    const fields = await capture(f, [pick(1, { owner_id: null, previous_owner_id: null }), pick(2, { owner_id: 0, previous_owner_id: '' }),
      pick(3, { owner_id: false, previous_owner_id: [] }), pick(4), pick(4)]);
    expect(fields.value).toMatchObject({ status: 'available', value: { complete: true, entries: [
      { ownerId: { state: 'null' }, previousOwnerId: { state: 'null' }, currentOwnerId: null },
      { ownerId: { state: 'invalid', raw: 0 }, previousOwnerId: { state: 'invalid', raw: '' }, currentOwnerId: null },
      { ownerId: { state: 'invalid', raw: false }, previousOwnerId: { state: 'invalid', raw: [] }, currentOwnerId: null },
      { sourceOrdinal: 3, ownershipState: 'resolved', currentOwnerId: '2' }, { sourceOrdinal: 4, ownershipState: 'resolved', currentOwnerId: '2' }] } });
    expect(await connection.database.query('SELECT asset_id,owner_team_id FROM league_traded_pick_entries WHERE content_id=$1 ORDER BY source_ordinal', [conflict.value.contentId]))
      .toEqual([{ asset_id: expect.any(String), owner_team_id: null }, { asset_id: expect.any(String), owner_team_id: null }]);
    const empty = await capture(f, []); expect(empty.value).toMatchObject({ status: 'available', value: { complete: true, tradesState: 'empty', totalCount: 0, entries: [] } });
    for (const captured of [known, conflict, unknown, corrected, fields]) expect(await read(f.mapping, { ...captured.resource, receiptId: captured.value.receiptId })).toEqual(captured.value);
  }, 60_000);

  it('retains corrections removals equal observations replay and native ordering with stable scoped asset history', async () => {
    const f = await fixture(), first = await capture(f, [pick(2), pick(1)]);
    const corrected = await capture(f, [pick(1, { owner_id: 3, previous_owner_id: 2 }), pick(2)]);
    const same = await capture(f, [pick(1, { owner_id: 3, previous_owner_id: 2 }), pick(2)]);
    expect(same.value.contentId).toBe(corrected.value.contentId); expect(same.value.receiptId).not.toBe(corrected.value.receiptId);
    expect(same.value.provenance).not.toEqual(corrected.value.provenance);
    const identities = await connection.database.query(`SELECT content_id,source_ordinal,asset_id,round_value::text,current_owner_id,previous_owner_id
      FROM league_traded_pick_entries WHERE content_id=ANY($1::uuid[]) ORDER BY content_id,source_ordinal`, [[first.value.contentId, corrected.value.contentId]]);
    const asset = (content: string, round: string) => identities.find(row => row.content_id === content && row.round_value === round)!.asset_id;
    expect(asset(first.value.contentId, '1')).toBe(asset(corrected.value.contentId, '1'));
    expect(asset(first.value.contentId, '2')).toBe(asset(corrected.value.contentId, '2'));
    const before = await history(f), replay = await write(f, same.input, same.attempt);
    expect(replay.tradedPicksAcceptance).toMatchObject({ reason: 'exact_receipt_replay', receiptId: same.value.receiptId }); expect(await history(f)).toEqual(before);
    await expect(write(f, await observation(f, payloadFor(native(f), [pick(1, { owner_id: 9 })])), same.attempt)).rejects.toThrow(/receipt conflict/);
    expect(await history(f)).toEqual(before);
    const removed = await capture(f, []); expect((await read(f.mapping, first.resource)).receiptId).toBe(removed.value.receiptId);
    for (const captured of [first, corrected, same]) expect(await read(f.mapping, { ...captured.resource, receiptId: captured.value.receiptId })).toEqual(captured.value);
  }, 60_000);

  it('retains failed partial malformed capped and oversized evidence without replacing complete endpoint heads', async () => {
    const f = await fixture(), first = await capture(f);
    for (const trades of [null, {}, [null], ['owner_id'], ['round'], [['owner_id']], [['round']], [pick(0)], [pick(1, { season: 2027 })], [pick(1, { roster_id: 0 })],
      [pick(1, { league_id: 'foreign' })], [pick(1, { draft_id: 'foreign' })], [pick(1, { sport: 'nba' })]]) {
      const captured = await capture(f, trades); expect(captured.result.tradedPicksAcceptance?.status).toBe('preserved');
      expect(captured.value.status).toBe('observed'); expect((await read(f.mapping, first.resource)).receiptId).toBe(first.value.receiptId);
      expect(await connection.database.query('SELECT payload FROM league_administration_contents WHERE id=$1', [captured.value.contentId])).toEqual([{ payload: captured.input.envelope.payload }]);
    }
    const partial = await capture(f, [pick(1, { owner_id: 9 })], 'partial'); expect(partial.value.status).toBe('observed');
    expect((await read(f.mapping, first.resource)).receiptId).toBe(first.value.receiptId);
    const capped = await capture(f, Array.from({ length: 10_001 }, (_, i) => pick(i + 1)));
    expect(capped.value).toMatchObject({ status: 'observed', value: null });
    const failed = await sourceCapture(f, [native(f)], new Map([[String(native(f).draft_id), new Error('fixture failure')]]));
    expect(failed.captures[0].value.status).toBe('available'); expect(failed.captures[1].value).toMatchObject({ status: 'observed', value: { failedTradeCount: 1 } });
    expect((await read(f.mapping, first.resource)).receiptId).toBe(first.value.receiptId);
    const overflow = await sourceCapture(f, Array.from({ length: 9 }, (_, i) => native(f, 'capped-' + i)));
    expect(overflow.acquired).toMatchObject({ providerRequests: 2, reason: 'draft-inventory-limit' });
    expect(overflow.captures[1].value).toMatchObject({ status: 'observed', value: { totalCount: 9, unrequestedTradeCount: 9 } });
    for (const max of [0, 1, 2]) { const bounded = await sourceCapture(f, [native(f)], new Map(), max);
      expect(bounded.acquired.providerRequests).toBe(max); expect(bounded.acquired.reason).toBe('metadata-request-budget-exceeded'); }
    const attempt = await reserve(f, first.resource), huge = await observation(f, payloadFor(native(f),
      Array.from({ length: 9_000 }, (_, i) => pick(i + 1, { padding: 'x'.repeat(700) })))), before = await history(f);
    const projection = projectTradedPicks(huge); expect(projection.status).toBe('accepted');
    await expect(write(f, huge, attempt)).rejects.toThrow(/persistence budget/);
    await expect(connection.database.query('SELECT public.record_league_administration_observation($1::jsonb)', [JSON.stringify({ ...huge,
      sourceMapping: f.mapping, tradedPicksAcceptance: { attempt }, tradedPicksProjection: projection })])).rejects.toThrow(/budget|oversized/);
    expect(await history(f)).toEqual(before); expect((await read(f.mapping, first.resource)).receiptId).toBe(first.value.receiptId);
  }, 60_000);

  it('rejects out of order foreign remapped and forged ownership submissions', async () => {
    const f = await fixture(), first = await capture(f), other = await fixture(); await capture(other);
    for (const olderFirst of [true, false]) {
      const old = await reserve(f, first.resource), next = await reserve(f, first.resource);
      const oldInput = await observation(f, payloadFor(native(f), [pick(1, { owner_id: 3 })]));
      const nextInput = await observation(f, payloadFor(native(f), [pick(1, { owner_id: 4, metadata: { olderFirst } })]));
      const a = await (olderFirst ? write(f, oldInput, old) : write(f, nextInput, next));
      const b = await (olderFirst ? write(f, nextInput, next) : write(f, oldInput, old));
      expect((olderFirst ? a : b).tradedPicksAcceptance).toMatchObject({ status: 'preserved', reason: 'newer_network_attempt_reserved' });
      expect((olderFirst ? b : a).tradedPicksAcceptance?.status).toBe('accepted');
      expect(await read(f.mapping, first.resource)).toMatchObject({ value: { entries: [{ currentOwnerId: '4' }] } });
    }
    for (const [mapping, selected] of [[other.mapping, { ...first.resource, receiptId: first.value.receiptId }],
      [f.mapping, { ...catalogResource, receiptId: first.value.receiptId }], [{ ...f.mapping, revisionId: randomUUID() }, first.resource],
      [{ ...f.mapping, scope: { ...f.mapping.scope, season: 2025 } }, first.resource]] as const)
      expect((await administration.readTradedPicks!(mapping, selected)).status).not.toBe('available');
    const attempt = await reserve(f, first.resource), input = await observation(f, payloadFor(native(f))), before = await history(f), projection = projectTradedPicks(input);
    if (projection.status !== 'accepted') throw Error('Missing projection.');
    for (const changed of [
      { ...input, sourceMapping: other.mapping, tradedPicksAcceptance: { attempt }, tradedPicksProjection: projection },
      { ...input, sourceMapping: f.mapping, tradedPicksAcceptance: { attempt }, tradedPicksProjection: { ...projection, value: { ...projection.value, season: 2025 } } },
      { ...input, value: { forged: true }, sourceMapping: f.mapping, tradedPicksAcceptance: { attempt }, tradedPicksProjection: projection },
      { ...input, envelope: { ...input.envelope, provenance: { ...input.envelope.provenance, requestStartedAt: input.envelope.provenance.requestStartedAt!.replace('T', ' ') } },
        sourceMapping: f.mapping, tradedPicksAcceptance: { attempt }, tradedPicksProjection: projection },
    ]) { await expect(connection.database.query('SELECT public.record_league_administration_observation($1::jsonb)', [JSON.stringify(changed)])).rejects.toThrow(); expect(await history(f)).toEqual(before); }
    const externalB = numericId();
    await ownerQuery("SELECT revise_league_source_connection($1,'sleeper',$2,$3,'CP18 synthetic A to B')", [f.leagueSeasonId, f.mapping.revisionId, externalB]);
    const mappingB = await administration.readSourceMapping(externalB); if (!mappingB) throw Error('Missing source B.');
    await ownerQuery("SELECT revise_league_source_connection($1,'sleeper',$2,$3,'CP18 synthetic B to A')", [f.leagueSeasonId, mappingB.revisionId, f.external]);
    const newMapping = await administration.readSourceMapping(f.external); if (!newMapping) throw Error('Missing revised source A.');
    const remapped = await history(f); await expect(write(f, input, attempt)).rejects.toThrow(); expect(await history(f)).toEqual(remapped);
    expect((await administration.readTradedPicks!(f.mapping, { ...first.resource, receiptId: first.value.receiptId })).status).not.toBe('available');
    expect((await administration.readTradedPicks!(newMapping, { ...first.resource, receiptId: first.value.receiptId })).status).not.toBe('available');
  }, 60_000);

  it('preserves legacy metadata selections and original twenty second reservation and commit fences', async () => {
    const control = await fixture(), row = native(control);
    const legacyInput = await observation(control, [{ catalog: row, draft: row, picks: [], traded_picks: [] }]);
    expect((await administration.recordObservation(legacyInput)).status).toBe('changed');
    const legacy = await administration.readSource({ ...control.mapping.scope, family: 'drafts', week: null });
    const metadataAttempt = await administration.beginDraftMetadataAttempt!(control.mapping, { kind: 'detail', externalDraftId: String(row.draft_id) }, randomUUID());
    const metadataInput = await observation(control, { metadataVersion: 'sleeper-draft-metadata-v1', kind: 'detail', externalDraftId: row.draft_id, catalog: row, draft: row });
    const metadata = await administration.recordObservation(metadataInput, undefined, control.mapping, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, undefined, undefined, { attempt: metadataAttempt });
    expect(metadata.draftMetadataAcceptance?.status).toBe('accepted');
    const selectionAttempt = await administration.beginDraftSelectionsAttempt!(control.mapping, { kind: 'selections', externalDraftId: String(row.draft_id) }, randomUUID());
    const selectionInput = await observation(control, { selectionsVersion: 'sleeper-draft-selections-v1', kind: 'selections', externalDraftId: row.draft_id, catalog: row, picks: [] });
    const selections = await administration.recordObservation(selectionInput, undefined, control.mapping, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, { attempt: selectionAttempt });
    expect(selections.draftSelectionsAcceptance?.status).toBe('accepted');
    const metadataBefore = await administration.readDraftMetadata!(control.mapping, { kind: 'detail', externalDraftId: String(row.draft_id) });
    const selectionsBefore = await administration.readDraftSelections!(control.mapping, { kind: 'selections', externalDraftId: String(row.draft_id) });
    expect(metadataBefore.status).toBe('available'); expect(selectionsBefore.status).toBe('available');
    await capture(control);
    expect(await administration.readDraftMetadata!(control.mapping, { kind: 'detail', externalDraftId: String(row.draft_id) })).toEqual(metadataBefore);
    expect(await administration.readDraftSelections!(control.mapping, { kind: 'selections', externalDraftId: String(row.draft_id) })).toEqual(selectionsBefore);
    if (legacy.status !== 'available') throw Error('Missing legacy control.');
    expect(await administration.readSource({ ...control.mapping.scope, family: 'drafts', week: null })).toEqual({ ...legacy, generation: 4 });
    const fixtures = []; for (let i = 0; i < 3; i++) fixtures.push(await fixture());
    const baselines = []; for (const f of fixtures) baselines.push(await capture(f));
    const before = []; for (const f of fixtures) before.push(await history(f));
    const fence = await fenceFor('deferred-original'), writer = await createPinnedIntegrationDatabase('runtime'); let open = false;
    try {
      await writer.database.query('BEGIN'); open = true;
      const store = createLeagueAdministrationStore(writer.database);
      for (const [index, kind] of ['changed', 'equal', 'partial'].entries()) {
        const f = fixtures[index], baseline = baselines[index], attempt = await reserve(f, baseline.resource, fence, store);
        const input = await observation(f, payloadFor(native(f), kind === 'changed' ? [pick(1, { owner_id: 4 })] : [pick()]), kind === 'partial' ? 'partial' : 'complete');
        const result = await write(f, input, attempt, fence, store); expect(result.tradedPicksAcceptance?.status).toBe(kind === 'partial' ? 'preserved' : 'accepted');
        const pending = await read(f.mapping, { ...baseline.resource, receiptId: result.tradedPicksAcceptance!.receiptId }, store);
        expect(pending.status).toBe(kind === 'partial' ? 'observed' : 'available'); expect(pending.receiptId).not.toBe(baseline.value.receiptId);
        if (kind === 'changed') expect(pending.contentId).not.toBe(baseline.value.contentId);
        if (kind === 'equal') expect(pending.contentId).toBe(baseline.value.contentId);
      }
      expect((await writer.database.query('SELECT clock_timestamp()<$1::timestamptz AS live', [fence.deadlineAt]))[0].live).toBe(true);
      await writer.database.query('SELECT pg_sleep(GREATEST(0,EXTRACT(EPOCH FROM ($1::timestamptz-clock_timestamp())))+0.025)', [fence.deadlineAt]);
      await expect(writer.database.query('COMMIT')).rejects.toThrow(/fence.*(?:stale|expired)|deadline/i); open = false;
      for (const [index, f] of fixtures.entries()) {
        expect(await history(f)).toEqual(before[index]); expect((await read(f.mapping, baselines[index].resource)).receiptId).toBe(baselines[index].value.receiptId);
        await expect(reserve(f, baselines[index].resource, fence)).rejects.toThrow(/fence.*(?:stale|expired)|deadline/i);
      }
    } finally { if (open) await writer.database.query('ROLLBACK'); await writer.close(); await finishJob(fence); }
  }, 60_000);

  it('denies direct typed mutations private helpers and history edits while reads remain provider free', async () => {
    const f = await fixture(), source = await sourceCapture(f, [native(f)]), selected = source.captures[2], before = await history(f);
    const tables = [...typedTables, 'league_traded_pick_assets'];
    for (const table of tables) {
      expect(await ownerQuery(`SELECT has_table_privilege('league_one_runtime',$1,'SELECT') AS read,
        has_table_privilege('league_one_runtime',$1,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS write,
        has_table_privilege('league_one_auth',$1,'SELECT,INSERT,UPDATE,DELETE') AS auth`, ['public.' + table])).toEqual([{ read: true, write: false, auth: false }]);
      await expect(connection.database.query(`DELETE FROM public.${table}`)).rejects.toThrow(/permission denied/);
    }
    for (const table of typedTables) await expect(ownerQuery(`DELETE FROM public.${table} WHERE content_id=$1`,
      [table === 'league_traded_pick_catalog_entries' ? source.captures[1].value.contentId : selected.value.contentId])).rejects.toThrow(/immutable|history/);
    await expect(ownerQuery(`INSERT INTO league_traded_pick_entries SELECT content_id,99,identity_state,asset_id,pick_season,round_value,original_roster_id,owner_id,previous_owner_id,
      ownership_state,current_owner_id,owner_team_id,previous_owner_state,evidenced_previous_owner_id,native_fields,extensions,raw
      FROM league_traded_pick_entries WHERE content_id=$1 LIMIT 1`, [selected.value.contentId])).rejects.toThrow(/history cannot gain later facts/);
    const helpers = await ownerQuery<{ signature: string }>(`SELECT p.oid::regprocedure::text AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND (p.proname LIKE '%traded_pick%' OR p.proname='record_league_administration_observation_v54')
      AND p.proname<>'begin_traded_picks_attempt' ORDER BY signature`);
    expect(helpers.length).toBeGreaterThanOrEqual(5);
    for (const helper of helpers) expect(await ownerQuery(`SELECT has_function_privilege('league_one_runtime',$1,'EXECUTE') AS runtime,
      has_function_privilege('league_one_auth',$1,'EXECUTE') AS auth`, [helper.signature])).toEqual([{ runtime: false, auth: false }]);
    await expect(connection.database.query('SELECT public.traded_picks_typed_value($1::uuid)', [selected.value.contentId])).rejects.toThrow(/permission denied/);
    const owner = await createPinnedIntegrationDatabase('owner');
    try {
      await owner.database.query('BEGIN'); await owner.database.query(await readFile(new URL('../scripts/provision-runtime-role.sql', import.meta.url), 'utf8'));
      for (const table of tables) expect(await owner.database.query(`SELECT has_table_privilege('league_one_runtime',$1,'SELECT') AS read,
        has_table_privilege('league_one_runtime',$1,'INSERT,UPDATE,DELETE') AS write`, ['public.' + table])).toEqual([{ read: true, write: false }]);
      expect(await owner.database.query("SELECT has_function_privilege('league_one_runtime','public.begin_traded_picks_attempt(jsonb,jsonb,uuid,jsonb)','EXECUTE') AS allowed")).toEqual([{ allowed: true }]);
      for (const helper of helpers) expect(await owner.database.query(`SELECT has_function_privilege('league_one_runtime',$1,'EXECUTE') AS runtime`, [helper.signature])).toEqual([{ runtime: false }]);
    } finally { await owner.database.query('ROLLBACK'); await owner.close(); }
    await storedOnly(async store => { for (const captured of source.captures) {
      expect(await read(f.mapping, { ...captured.resource, receiptId: captured.value.receiptId }, store)).toEqual(captured.value);
      expect((await read(f.mapping, captured.resource, store)).selection).toBe('current');
    } });
    const corrupt: DatabaseClient = { enabled: true, query: async <Row extends DatabaseRow = DatabaseRow>(sql: string, parameters?: readonly unknown[], options?: DatabaseQueryOptions) => {
      const result = await connection.database.query(sql, parameters, options);
      return result.map(row => ({ ...row, facts: (row.facts as DatabaseRow[]).map((fact, index) => index === 0 ? { ...fact, asset_scope_valid: false } : fact) })) as unknown as Row[];
    } };
    expect((await createLeagueAdministrationStore(corrupt).readTradedPicks!(f.mapping, selected.resource)).status).toBe('unavailable');
    expect(await history(f)).toEqual(before);
  }, 60_000);
});
