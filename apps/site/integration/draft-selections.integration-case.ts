import { loadCompletePlayerCatalog } from '../lib/sleeper-player-catalog';
import { CURRENT_ROSTER_POLICY } from '../lib/aggregator/current-roster';
import { PUBLIC_INTAKE_JOB } from '../lib/league-administration/public-intake-contracts';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { DatabaseClient, DatabaseQueryOptions, DatabaseRow } from '../lib/database';
import type { AdministrationEnvelope, JsonObject, JsonValue, NormalizedAdministrationObservation } from '../lib/league-administration/contracts';
import type { AdministrationSourceMapping } from '../lib/league-administration/source-mapping';
import type { AdministrationWriteFence } from '../lib/league-administration/store-contracts';
import type { RosterAttempt } from '../lib/aggregator/current-roster';
import { DRAFT_SELECTIONS_VERSION, projectDraftSelections, type DraftSelectionsRead,
  type DraftSelectionsResource, type DraftSelectionsSelection } from '../lib/aggregator/draft-selections';
import { createLeagueAdministrationStore } from '../lib/league-administration/store';
import { normalizeAdministrationObservation } from '../lib/league-administration/normalize';
import { getOfficialDraftAdministration } from '../lib/sleeper';
import { createProjectionStore } from '../lib/projection-store';
import { exactMatchupClockInstant } from './exact-matchup-clock';
import { createIndependentDatabase, createPinnedIntegrationDatabase, ownerQuery, type IndependentDatabase } from './neon-integration-harness';

const numericId = () => '9' + BigInt('0x' + randomUUID().replaceAll('-', '').slice(0, 15));
const typedTables = ['league_draft_selection_contents', 'league_draft_selection_catalog_entries', 'league_draft_selection_entries'] as const;
const catalogResource = { kind: 'catalog' } as const;
const detailResource = (externalDraftId: string) => ({ kind: 'selections', externalDraftId } as const);
type StoredRead = Extract<DraftSelectionsRead, { value: unknown }>;

/** CP17 authored bounded selection profile; real SQL qualification remains separate.
 * Existing fixture HTTP adapter -> normalizer -> restricted shared writer -> typed tables -> stored readers.
 * Eight 60s cases + two 120s hooks =12m; 8m setup +3m reporting +7m overhead inside30m work.
 * Original20s fences, fixed0.25CU,40m lifecycle,50m CI and zero retries unchanged.
 * Synthetic2026 prerequisites; no CP18 trades or CP19 intake/refresh, independent-session contention,
 * natural cadence, live provider or production qualification. Offline full-case PGlite execution
 * uses SET ROLE and cannot establish hosted restricted LOGIN/TLS or external cleanup. */
describe.sequential('official draft selections through restricted PostgreSQL', () => {
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
    const external = numericId(), leagueKey = 'cp17-' + randomUUID();
    const registered = await createProjectionStore(connection.database).registerLeagueSeason({ leagueKey,
      leagueName: 'CP17 synthetic draft metadata', season: 2026, sleeperLeagueId: external, scoringRules: { rec: 0.5 } });
    if (registered.kind !== 'stored') throw new Error('CP17 fixture registration unavailable.');
    await ownerQuery("INSERT INTO league_administration_enrollments(league_id,provider,evidence) VALUES($1,'sleeper','CP17 synthetic prerequisite')", [registered.value.leagueId]);
    await ownerQuery("INSERT INTO league_administration_enrollment_seasons(league_id,season,provider,evidence) VALUES($1,2026,'sleeper','CP17 synthetic prerequisite')", [registered.value.leagueId]);
    const mapping = await administration.readSourceMapping(external); if (!mapping) throw new Error('Missing CP17 mapping.');
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
  const pick = (number = 1, changes: JsonObject = {}): JsonObject => ({ pick_no: number, round: 1, draft_slot: 2,
    player_id: 'cp17-player', roster_id: '1', picked_by: '', is_keeper: null, metadata: { future: false }, ...changes });
  const payloadFor = (row: JsonObject, picks: JsonValue = [pick()]): JsonObject => ({ selectionsVersion: DRAFT_SELECTIONS_VERSION,
    kind: 'selections', externalDraftId: row.draft_id, catalog: row, picks });
  const reserve = (f: Fixture, resource: DraftSelectionsResource, fence?: AdministrationWriteFence, store = administration) => {
    if (!store.beginDraftSelectionsAttempt) throw new Error('Missing CP17 reservation.');
    return store.beginDraftSelectionsAttempt(f.mapping, resource, randomUUID(), fence);
  };
  const write = (f: Fixture, input: NormalizedAdministrationObservation, attempt: RosterAttempt,
    fence?: AdministrationWriteFence, store = administration) => store.recordObservation(input, fence, f.mapping,
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, { attempt });
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
  async function read(mapping: AdministrationSourceMapping, selection: DraftSelectionsSelection, store = administration): Promise<StoredRead> {
    if (!store.readDraftSelections) throw new Error('Missing CP17 stored reader.');
    const result = await store.readDraftSelections(mapping, selection);
    expect(['available', 'observed']).toContain(result.status);
    if (result.status !== 'available' && result.status !== 'observed') throw new Error('Missing CP17 stored metadata.');
    return result;
  }
  async function capture(f: Fixture, picks: JsonValue = [pick()], completeness: 'complete' | 'partial' = 'complete', fence?: AdministrationWriteFence) {
    const resource = detailResource(String(native(f).draft_id)), attempt = await reserve(f, resource, fence);
    const input = await observation(f, payloadFor(native(f), picks), completeness), result = await write(f, input, attempt, fence);
    const receiptId = result.draftSelectionsAcceptance?.receiptId; if (!receiptId) throw new Error('Missing CP17 receipt.');
    const value = await read(f.mapping, { ...resource, receiptId });
    return { resource, attempt, input, result, value };
  }
  async function sourceCapture(f: Fixture, rows: JsonValue, responses: ReadonlyMap<string, JsonValue | Error> = new Map(), maxRequests = 9) {
    const attempts = new Map<string, RosterAttempt>([['catalog', await reserve(f, catalogResource)]]);
    await waitForSourceClock();
    const urls: string[] = [];
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input); urls.push(url);
      if (url === `https://api.sleeper.app/v1/league/${f.external}/drafts`)
        return new Response(JSON.stringify(rows), { headers: { 'content-type': 'application/json' } });
      const match = /^https:\/\/api\.sleeper\.app\/v1\/draft\/([A-Za-z0-9_-]+)\/picks$/u.exec(url);
      if (!match) throw new Error('Unexpected CP17 source endpoint: ' + url);
      const body = responses.has(match[1]) ? responses.get(match[1]) : [pick(9), pick(1, { player_id: 'unresolved' })];
      if (body instanceof Error) throw body;
      return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
    });
    try {
      const acquired = await getOfficialDraftAdministration(f.external, 2026, { selectionsOnly: true, maxRequests,
        signal: AbortSignal.timeout(20_000), beforeDetail: async id => {
          attempts.set(id, await reserve(f, detailResource(id))); await waitForSourceClock();
        } });
      expect(acquired.providerRequests).toBe(urls.length);
      const captures = [];
      for (const document of acquired.observations) {
        const payload = document.payload as JsonObject;
        const resource = payload.kind === 'catalog' ? catalogResource : detailResource(String(payload.externalDraftId));
        const attempt = attempts.get(resource.kind === 'catalog' ? 'catalog' : resource.externalDraftId);
        if (!attempt) throw new Error('Unreserved CP17 adapter capture.');
        const input = normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1',
          dialect: 'sleeper-nfl-v1', scope: f.mapping.scope, family: document.family, week: document.week,
          completeness: document.completeness ?? 'complete', payload,
          provenance: { origin: document.origin, requestStartedAt: document.requestStartedAt, requestCompletedAt: document.requestCompletedAt,
            sourceObservedAt: document.sourceObservedAt, checkedAt: new Date().toISOString() } });
        const result = await write(f, input, attempt), receiptId = result.draftSelectionsAcceptance?.receiptId;
        if (!receiptId) throw new Error('Missing CP17 adapter receipt.');
        const value = await read(f.mapping, { ...resource, receiptId });
        expect(value.provenance).toEqual(input.envelope.provenance);
        const projection = projectDraftSelections(input);
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
      (SELECT jsonb_agg(to_jsonb(link) ORDER BY to_jsonb(link)::text) FROM league_draft_selection_link_receipts link WHERE link.league_season_id=$1) AS link_headers,
      (SELECT jsonb_agg(to_jsonb(link) ORDER BY to_jsonb(link)::text) FROM league_draft_selection_player_links link JOIN league_draft_selection_link_receipts h ON h.selection_acceptance_id=link.selection_acceptance_id WHERE h.league_season_id=$1) AS player_links,
      ${typed.join(',')}`, [f.leagueSeasonId]);
  }
  async function storedOnly<T>(body: (store: ReturnType<typeof createLeagueAdministrationStore>) => Promise<T>) {
    const statements: string[] = [];
    const database: DatabaseClient = { enabled: true,
      query: async <Row extends DatabaseRow = DatabaseRow>(sql: string, parameters?: readonly unknown[], options?: DatabaseQueryOptions) => {
        statements.push(sql); expect(sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|CALL)\b/iu);
        return connection.database.query<Row>(sql, parameters, options);
      } };
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('CP17 stored reader must not fetch.'));
    try { const result = await body(createLeagueAdministrationStore(database));
      expect(fetch).not.toHaveBeenCalled(); expect(statements.length).toBeGreaterThan(0); return result;
    } finally { fetch.mockRestore(); }
  }

  async function fenceFor(label: string) {
    const jobKey = 'cp17-' + label + '-' + randomUUID(), workerId = randomUUID();
    await ownerQuery(`INSERT INTO projection_jobs(job_key,job_type,scheduled_for,state,lease_owner,lease_until,attempt_count)
      VALUES($1,'league-administration',clock_timestamp(),'running',$2,clock_timestamp()+interval '30 seconds',1)`, [jobKey, workerId]);
    const [clock] = await connection.database.query("SELECT clock_timestamp()+interval '20 seconds' AS at");
    return { jobKey, workerId, generation: 1, deadlineAt: exactMatchupClockInstant(clock.at) } satisfies AdministrationWriteFence;
  }
  const finishJob = (fence: AdministrationWriteFence) => ownerQuery("UPDATE projection_jobs SET state='failed',lease_owner=NULL,lease_until=NULL,completed_at=clock_timestamp() WHERE job_key=$1", [fence.jobKey]);

  it('stores native selections and source ordering through fixture HTTP and restricted stored readers', async () => {
    const f = await fixture(), rows = [native(f, 'draft-b'), native(f, 'draft-a')];
    const result = await sourceCapture(f, rows, new Map([['draft-b', [pick(12), pick(2, { player_id: '007', roster_id: '90071992547409939999' })]],
      ['draft-a', [pick(1, { round: 2, draft_slot: 1, roster_id: 2 })]]]));
    expect(result.urls).toEqual([`https://api.sleeper.app/v1/league/${f.external}/drafts`, 'https://api.sleeper.app/v1/draft/draft-b/picks', 'https://api.sleeper.app/v1/draft/draft-a/picks']);
    expect(result.captures[0].value).toMatchObject({ status: 'available', value: { kind: 'catalog', totalCount: 2,
      attemptedSelectionCount: 2, succeededSelectionCount: 2, entries: [{ sourceOrdinal: 0, externalDraftId: 'draft-b' }, { sourceOrdinal: 1, externalDraftId: 'draft-a' }] } });
    const first = result.captures[1];
    expect(first.value).toMatchObject({ value: { entries: [{ sourceOrdinal: 0, pickNumber: { value: 12 } },
      { sourceOrdinal: 1, pickNumber: { value: 2 }, playerId: { value: '007' }, rosterId: { raw: '90071992547409939999', value: '90071992547409939999' } }] } });
    expect(await connection.database.query(`SELECT source_ordinal,pick_number::text,external_roster_id,player_id FROM league_draft_selection_entries WHERE content_id=$1 ORDER BY source_ordinal`, [first.value.contentId]))
      .toEqual([{ source_ordinal: 0, pick_number: '12', external_roster_id: '1', player_id: 'cp17-player' },
        { source_ordinal: 1, pick_number: '2', external_roster_id: '90071992547409939999', player_id: '007' }]);
    await storedOnly(async store => {
      for (const captured of result.captures) {
        expect(await read(f.mapping, { ...captured.resource, receiptId: captured.value.receiptId }, store)).toEqual(captured.value);
        expect((await read(f.mapping, captured.resource, store)).receiptId).toBe(captured.value.receiptId);
      }
    });
  }, 60_000);

  it('preserves optional field states complete empty keeper evidence and legacy draft compatibility', async () => {
    const f = await fixture(), row = native(f);
    const legacyInput = await observation(f, [{ catalog: row, draft: row, picks: [], traded_picks: [] }]);
    expect(legacyInput.status).toBe('accepted'); expect((await administration.recordObservation(legacyInput)).status).toBe('changed');
    const legacyBefore = await administration.readSource({ ...f.mapping.scope, family: 'drafts', week: null });
    if (legacyBefore.status !== 'available') throw Error('Missing legacy baseline.');
    expect(legacyBefore.generation).toBe(1);
    const captured = await capture(f, [{ pick_no: 8, picked_by: '', is_keeper: null, metadata: {} },
      pick(1, { round: 0, draft_slot: false, roster_id: null, player_id: '', is_keeper: false, metadata: [] }),
      pick(4, { is_keeper: true, future_native: { number: 0, flag: false, value: null } })]);
    expect(captured.value).toMatchObject({ status: 'available', value: { complete: true, entries: [
      { round: { state: 'missing' }, rosterId: { state: 'missing' }, playerId: { state: 'missing' }, draftSlot: { state: 'missing' },
        pickedBy: { state: 'empty', raw: '', value: '' }, isKeeper: { state: 'null' }, metadata: { state: 'empty' } },
      { round: { state: 'invalid', raw: 0 }, draftSlot: { state: 'invalid' }, rosterId: { state: 'null' }, playerId: { state: 'invalid', raw: '' }, isKeeper: { value: false }, metadata: { state: 'invalid', raw: [] } },
      { isKeeper: { value: true }, extensions: { future_native: { number: 0, flag: false, value: null } } }] } });
    const empty = await capture(f, []); expect(empty.value).toMatchObject({ status: 'available', value: { complete: true, picksState: 'empty', totalCount: 0, entries: [] } });
    expect(await administration.readSource({ ...f.mapping.scope, family: 'drafts', week: null })).toEqual({ ...legacyBefore, generation: 3 });
    const metadataAttempt = await administration.beginDraftMetadataAttempt!(f.mapping, { kind: 'detail', externalDraftId: String(row.draft_id) }, randomUUID());
    const metadataInput = await observation(f, { metadataVersion: 'sleeper-draft-metadata-v1', kind: 'detail', externalDraftId: row.draft_id, catalog: row, draft: row });
    const metadata = await administration.recordObservation(metadataInput, undefined, f.mapping, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, undefined, undefined, { attempt: metadataAttempt });
    expect(metadata.draftMetadataAcceptance?.status).toBe('accepted');
    expect(await administration.readDraftMetadata!(f.mapping, { kind: 'detail', externalDraftId: String(row.draft_id) })).toMatchObject({ status: 'available', value: { kind: 'detail', picks: 'not-requested' } });
    expect(await administration.readSource({ ...f.mapping.scope, family: 'drafts', week: null })).toEqual({ ...legacyBefore, generation: 4 });
    expect(await read(f.mapping, { ...captured.resource, receiptId: captured.value.receiptId })).toEqual(captured.value);
    const urls: string[] = [], fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input); urls.push(url); return Response.json(url.endsWith('/drafts') ? [row] : url.endsWith('/picks') || url.endsWith('/traded_picks') ? [] : row);
    });
    try {
      const legacy = await getOfficialDraftAdministration(f.external, 2026, { maxRequests: 4 });
      expect(legacy.providerRequests).toBe(4); expect(urls).toHaveLength(4); expect(legacy.observations[0].payload).toEqual([{ catalog: row, draft: row, picks: [], traded_picks: [] }]);
    } finally { fetch.mockRestore(); }
  }, 60_000);

  it('retains duplicate contradictory malformed capped and failed captures without replacing last good selections', async () => {
    const f = await fixture(), first = await capture(f);
    for (const picks of [[pick(1), pick(1)], [pick(1), pick(1, { player_id: 'corrected' })], [pick(1, { draft_id: 'foreign' })],
      [pick(1, { league_id: 'foreign' })], [pick(1, { season: '2025' })], [{ pick_no: '1' }], [null], [['draft_id']], ['draft_id'], null, { malformed: true }]) {
      const captured = await capture(f, picks);
      expect(captured.value.status).toBe('observed'); expect(captured.value.value?.complete).toBe(false);
      expect((await read(f.mapping, first.resource)).receiptId).toBe(first.value.receiptId);
      expect(await read(f.mapping, { ...captured.resource, receiptId: captured.value.receiptId })).toEqual(captured.value);
    }
    const partial = await capture(f, [], 'partial'); expect(partial.value).toMatchObject({ status: 'observed', value: { picksState: 'empty' } });
    const diagnosticRosters = ['987654321', '987654322', '987654323'];
    const diagnostic = await capture(f, [pick(91, { league_id: 'foreign', roster_id: diagnosticRosters[0] }),
      pick(92, { roster_id: diagnosticRosters[1] }), pick(92, { roster_id: diagnosticRosters[1] }), { roster_id: diagnosticRosters[2] }]);
    expect(diagnostic.value).toMatchObject({ status: 'observed', value: { entries: [
      { identityState: 'conflict', rosterId: { value: diagnosticRosters[0] } }, { identityState: 'duplicate', rosterId: { value: diagnosticRosters[1] } },
      { identityState: 'duplicate', rosterId: { value: diagnosticRosters[1] } }, { identityState: 'invalid', rosterId: { value: diagnosticRosters[2] } }] } });
    expect(await connection.database.query('SELECT external_roster_id FROM league_season_teams WHERE league_season_id=$1 AND external_roster_id=ANY($2::text[])',
      [f.leagueSeasonId, diagnosticRosters])).toEqual([]);
    expect(await connection.database.query('SELECT external_roster_id,season_team_id FROM league_draft_selection_entries WHERE content_id=$1 ORDER BY source_ordinal',
      [diagnostic.value.contentId])).toEqual([diagnosticRosters[0], diagnosticRosters[1], diagnosticRosters[1], diagnosticRosters[2]].map(external_roster_id => ({ external_roster_id, season_team_id: null })));
    expect((await read(f.mapping, first.resource)).receiptId).toBe(first.value.receiptId);
    const capped = await capture(f, Array.from({ length: 10001 }, (_, i) => ({ pick_no: i + 1 })));
    expect(capped.value).toMatchObject({ status: 'observed', value: null });
    expect((await read(f.mapping, first.resource)).receiptId).toBe(first.value.receiptId);
    const overflow = await sourceCapture(f, Array.from({ length: 9 }, (_, i) => native(f, 'draft' + i)));
    expect(overflow.acquired.providerRequests).toBe(1); expect(overflow.captures[0].value).toMatchObject({ status: 'observed', value: { totalCount: 9, unrequestedSelectionCount: 9 } });
    const sibling = await sourceCapture(f, [native(f), native(f, 'sibling')], new Map<string, JsonValue | Error>([[String(native(f).draft_id), Error('source failed')], ['sibling', []]]));
    expect(sibling.captures[0].value).toMatchObject({ value: { failedSelectionCount: 1, succeededSelectionCount: 1 } });
    expect(sibling.captures[1].value.status).toBe('observed'); expect(sibling.captures[2].value.status).toBe('available');
    expect((await read(f.mapping, first.resource)).receiptId).toBe(first.value.receiptId);
  }, 60_000);

  it('retains corrected removed equal and replayed selections with stable native pick identities', async () => {
    const f = await fixture(), first = await capture(f, [pick(9), pick(1)]), same = await capture(f, [pick(9), pick(1)]);
    expect(same.value.contentId).toBe(first.value.contentId); expect(same.value.receiptId).not.toBe(first.value.receiptId);
    const before = await history(f);
    expect((await write(f, same.input, same.attempt)).draftSelectionsAcceptance).toMatchObject({ status: 'accepted', reason: 'exact_receipt_replay', receiptId: same.value.receiptId });
    expect(await history(f)).toEqual(before);
    const corrected = await capture(f, [pick(9, { player_id: 'new-player', roster_id: 2, round: 2, draft_slot: 3 })]);
    expect(corrected.value.contentId).not.toBe(first.value.contentId);
    expect(corrected.value).toMatchObject({ value: { totalCount: 1, entries: [{ playerId: { value: 'new-player' }, rosterId: { value: '2' }, round: { value: 2 }, pickNumber: { value: 9 } }] } });
    const identities = await connection.database.query(`SELECT content_id,selection_id FROM league_draft_selection_entries WHERE content_id=ANY($1::uuid[]) AND pick_number=9`, [[first.value.contentId, corrected.value.contentId]]);
    expect(identities).toHaveLength(2); expect(new Set(identities.map(identity => identity.selection_id)).size).toBe(1);
    expect(await read(f.mapping, { ...first.resource, receiptId: first.value.receiptId })).toEqual(first.value);
    const empty = await capture(f, []); expect(empty.value).toMatchObject({ value: { totalCount: 0, entries: [] } });
    expect(await read(f.mapping, { ...corrected.resource, receiptId: corrected.value.receiptId })).toEqual(corrected.value);
  }, 60_000);

  it('freezes unresolved directory conflict and later resolved player links without rewriting history', async () => {
    const f = await fixture(), suffix = randomUUID();
    const ids = { resolved: 'cp17-resolved-' + suffix, missing: 'cp17-missing-' + suffix,
      mixed: 'cp17-mixed-' + suffix, roster: 'cp17-roster-' + suffix, orphan: 'cp17-orphan-' + suffix };
    const jobs = createProjectionStore(connection.database);
    const resource = { kind: 'selections' as const, externalDraftId: native(f).draft_id as string };
    const now = async () => {
      const [row] = await connection.database.query('SELECT clock_timestamp() AS at');
      return (row.at instanceof Date ? row.at : new Date(String(row.at))).toISOString();
    };
    async function directory(rows: Record<string, unknown>) {
      // Only mutable operational cadence is arranged as a synthetic prerequisite;
      // immutable source clocks, attempts, versions and receipts remain untouched.
      await ownerQuery(`UPDATE public.league_player_directory_heads SET last_network_at=clock_timestamp()-interval '25 hours',
        next_network_at=clock_timestamp()-interval '1 hour' WHERE provider='sleeper' AND sport='nfl'`);
      const workerId = randomUUID(), at = await now();
      const acquired = await jobs.acquireJob({ jobKey: PUBLIC_INTAKE_JOB, jobType: PUBLIC_INTAKE_JOB,
        workerId, scheduledFor: at, leaseSeconds: 25, payload: { policy: 'public-player-directory-v1', mode: 'player-directory' } });
      if (acquired.kind !== 'acquired') throw new Error('CP17 directory job not acquired: ' + acquired.kind);
      const fence: AdministrationWriteFence = { jobKey: PUBLIC_INTAKE_JOB, workerId, generation: acquired.attempt,
        deadlineAt: new Date(Date.parse(at) + 20_000).toISOString() };
      try {
        const reservation = await administration.beginPlayerDirectoryAttempt(randomUUID(), fence);
        if (reservation.status !== 'reserved') throw new Error('CP17 directory attempt not reserved: ' + reservation.status);
        const mocked = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
          expect(String(input)).toBe('https://api.sleeper.app/v1/players/nfl'); return new Response(JSON.stringify(rows));
        });
        let source;
        try {
          source = await loadCompletePlayerCatalog({ attempt: reservation.attempt, signal: AbortSignal.timeout(10_000) });
          expect(mocked).toHaveBeenCalledTimes(1);
        } finally { mocked.mockRestore(); }
        expect(source.status).toBe('complete');
        const result = await administration.recordPlayerDirectoryCapture(reservation.attempt, source, fence);
        expect(result.status).toBe('accepted');
        if (!result.acceptedVersionId) throw new Error('CP17 accepted directory version missing');
        return result.acceptedVersionId;
      } finally {
        if (!await jobs.completeJob(PUBLIC_INTAKE_JOB, workerId)) await jobs.failJob(PUBLIC_INTAKE_JOB, workerId, 'CP17 directory fixture closure');
      }
    }
    async function picked() {
      const fence = await fenceFor('links');
      try {
        await capture(f, [pick(1, { player_id: ids.resolved }), pick(2, { player_id: ids.missing }),
          pick(3, { player_id: ids.mixed })], 'complete', fence);
      } finally { await finishJob(fence); }
      const value = await administration.readDraftSelections!(f.mapping, resource);
      if (value.status !== 'available' || !value.playerLinks) throw new Error('CP17 stored player links unavailable: ' + JSON.stringify(value));
      return value;
    }
    const directoryOne = await directory({
      [ids.resolved]: { player_id: ids.resolved, position: 'RB', full_name: 'First immutable player' },
      [ids.mixed]: { player_id: ids.mixed, position: 'DEF', fantasy_positions: ['LB'] },
      [ids.roster]: { player_id: ids.roster, position: 'WR' },
    });
    const first = await picked();
    expect(first.playerLinks).toMatchObject({ directoryVersionId: directoryOne, outcome: 'partial',
      counts: { selections: 3, resolved: 1, unresolved: 1, conflict: 1 } });
    expect(first.playerLinks!.links[0]).toMatchObject({ nativePlayerId: ids.resolved, identityState: 'resolved', entityKind: 'player' });
    expect(first.playerLinks!.links[1]).toMatchObject({ nativePlayerId: ids.missing, identityState: 'unresolved', reasons: ['directory_player_missing'], canonicalEntityId: null });
    expect(first.playerLinks!.links[2]).toMatchObject({ nativePlayerId: ids.mixed, identityState: 'conflict', reasons: ['kind_conflict'], canonicalEntityId: null });
    const firstFrozen = await administration.readDraftSelections!(f.mapping, { ...resource, receiptId: first.receiptId });
    expect(firstFrozen).toEqual({ ...first, selection: 'receipt' });
    const directoryTwo = await directory({
      [ids.resolved]: { player_id: ids.resolved, position: 'RB', full_name: 'Changed directory label' },
      [ids.missing]: { player_id: ids.missing, position: 'WR' },
      [ids.mixed]: { player_id: ids.mixed, position: 'LB', fantasy_positions: ['IDP'] },
      [ids.roster]: { player_id: ids.roster, position: 'WR' },
    });
    expect(directoryTwo).not.toBe(directoryOne);
    const second = await picked();
    expect(second.playerLinks).toMatchObject({ directoryVersionId: directoryTwo, outcome: 'complete',
      counts: { selections: 3, resolved: 3, unresolved: 0, conflict: 0 } });
    expect(second.playerLinks!.links.every(link => link.mappingProof.length === 1 && link.mappingProof[0].mappingStatus === 'verified')).toBe(true);
    expect(await administration.readDraftSelections!(f.mapping, { ...resource, receiptId: first.receiptId })).toEqual(firstFrozen);

    // Build an independent CP6-only reference through the existing roster owner.
    // Its native player never appears in draft selection evidence.
    const rosterFence = await fenceFor('roster-history-control');
    let rosterReceiptId: string;
    try {
      const settingsAt = await now();
      const envelope = (payload: AdministrationEnvelope['payload'], family: 'league' | 'rosters', at: string): AdministrationEnvelope => ({
        schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1', dialect: 'sleeper-nfl-v1',
        scope: f.mapping.scope, family, week: null, completeness: 'complete', payload,
        provenance: { origin: 'network', requestStartedAt: at, requestCompletedAt: at, checkedAt: at, sourceObservedAt: at },
      });
      const configuration = normalizeAdministrationObservation(envelope({ league_id: f.mapping.scope.externalLeagueId,
        season: '2026', sport: 'nfl', total_rosters: 1, scoring_settings: { rec: 0.5 }, roster_positions: ['WR', 'BN'] }, 'league', settingsAt));
      const configurationWrite = await administration.recordObservation(configuration);
      if (!configurationWrite.observationId) throw new Error('CP17 roster population evidence missing');
      const attempt = await administration.beginRosterAttempt(f.mapping, randomUUID(), CURRENT_ROSTER_POLICY, rosterFence);
      const input = normalizeAdministrationObservation(envelope([{ roster_id: 1, players: [ids.roster], starters: [], reserve: [], taxi: [] }], 'rosters', await now()), { expectedRosterCount: 1 });
      const write = await administration.recordObservation(input, rosterFence, f.mapping, { attempt,
        population: { observationId: configurationWrite.observationId, contentHash: configuration.contentHash, envelope: configuration.envelope } });
      expect(write.rosterAcceptance?.status).toBe('accepted');
      if (!write.rosterAcceptance?.receiptId) throw new Error('CP17 roster control receipt missing');
      rosterReceiptId = write.rosterAcceptance.receiptId;
    } finally { await finishJob(rosterFence); }
    const rosterBefore = await administration.readRosterPlayerLinks({ rosterReceiptId, leagueSeasonId: f.mapping.leagueSeasonId });
    if (rosterBefore.status !== 'available') throw new Error('CP17 roster control links unavailable');
    expect(rosterBefore.links).toHaveLength(1);
    const draftOld = second.playerLinks!.links[0].canonicalEntityId!, rosterOld = rosterBefore.links[0].canonicalEntityId!;
    const draftCorrected = randomUUID(), rosterCorrected = randomUUID(), orphanCorrected = randomUUID();
    await ownerQuery(`INSERT INTO public.scoring_entities(id,kind,display_name) VALUES
      ($1,'player','Corrected draft fixture identity'),($2,'player','Corrected roster fixture identity'),($3,'player','True orphan target')`,
    [draftCorrected, rosterCorrected, orphanCorrected]);
    for (const [nativeId, target] of [[ids.resolved, draftCorrected], [ids.roster, rosterCorrected]]) {
      await ownerQuery(`UPDATE public.external_scoring_entity_ids SET scoring_entity_id=$1
        WHERE provider='sleeper' AND entity_kind='player' AND external_id=$2`, [target, nativeId]);
    }
    const identity = (nativeId: string) => ({ key: 'player:' + nativeId, kind: 'player' as const,
      displayName: 'Shared owner correction fixture', nflTeam: null, preserveExistingMetadata: true,
      providerIds: [{ provider: 'sleeper', externalId: nativeId }] });
    const orphan = await jobs.upsertScoringEntities([identity(ids.orphan)]);
    if (orphan.kind !== 'stored') throw new Error('CP17 true orphan setup failed');
    const orphanOld = orphan.value[0].entityId!;
    await ownerQuery(`UPDATE public.external_scoring_entity_ids SET scoring_entity_id=$1
      WHERE provider='sleeper' AND entity_kind='player' AND external_id=$2`, [orphanCorrected, ids.orphan]);
    const corrected = await jobs.upsertScoringEntities([identity(ids.resolved), identity(ids.roster), identity(ids.orphan)]);
    expect(corrected).toMatchObject({ kind: 'stored', value: [
      { entityId: draftCorrected, conflict: false }, { entityId: rosterCorrected, conflict: false }, { entityId: orphanCorrected, conflict: false },
    ] });
    expect(await connection.database.query('SELECT id FROM public.scoring_entities WHERE id=$1', [draftOld])).toEqual([{ id: draftOld }]);
    expect(await connection.database.query('SELECT id FROM public.scoring_entities WHERE id=$1', [rosterOld])).toEqual([{ id: rosterOld }]);
    expect(await connection.database.query('SELECT id FROM public.scoring_entities WHERE id=$1', [orphanOld])).toEqual([]);
    expect(await connection.database.query('SELECT external_id FROM public.external_scoring_entity_ids WHERE scoring_entity_id=ANY($1::uuid[])', [[draftOld, rosterOld]])).toEqual([]);
    const third = await picked();
    expect(third.playerLinks!.links[0].canonicalEntityId).toBe(draftCorrected);
    expect(await administration.readDraftSelections!(f.mapping, { ...resource, receiptId: first.receiptId })).toEqual(firstFrozen);
    expect(await administration.readDraftSelections!(f.mapping, { ...resource, receiptId: second.receiptId })).toEqual({ ...second, selection: 'receipt' });
    expect(await administration.readRosterPlayerLinks({ rosterReceiptId, leagueSeasonId: f.mapping.leagueSeasonId })).toEqual(rosterBefore);
    await expect(ownerQuery('UPDATE public.league_draft_selection_player_links SET canonical_entity_id=$1 WHERE selection_acceptance_id=$2',
      [draftCorrected, second.acceptanceId])).rejects.toThrow();
  }, 60_000);


  it('rejects out of order foreign remapped and forged selection submissions', async () => {
    const f = await fixture(), first = await capture(f), other = await fixture(); await capture(other);
    for (const olderFirst of [true, false]) {
      const old = await reserve(f, first.resource), next = await reserve(f, first.resource);
      const oldInput = await observation(f, payloadFor(native(f), [pick(1, { player_id: 'old' })]));
      const nextInput = await observation(f, payloadFor(native(f), [pick(1, { player_id: 'next', metadata: { olderFirst } })]));
      const a = await (olderFirst ? write(f, oldInput, old) : write(f, nextInput, next));
      const b = await (olderFirst ? write(f, nextInput, next) : write(f, oldInput, old));
      expect((olderFirst ? a : b).draftSelectionsAcceptance).toMatchObject({ status: 'preserved', reason: 'newer_network_attempt_reserved' });
      expect((olderFirst ? b : a).draftSelectionsAcceptance?.status).toBe('accepted');
      expect(await read(f.mapping, first.resource)).toMatchObject({ value: { entries: [{ playerId: { value: 'next' } }] } });
    }
    for (const [mapping, selected] of [[other.mapping, { ...first.resource, receiptId: first.value.receiptId }],
      [f.mapping, { ...catalogResource, receiptId: first.value.receiptId }], [{ ...f.mapping, revisionId: randomUUID() }, first.resource],
      [{ ...f.mapping, scope: { ...f.mapping.scope, season: 2025 } }, first.resource]] as const)
      expect((await administration.readDraftSelections!(mapping, selected)).status).not.toBe('available');
    const attempt = await reserve(f, first.resource), input = await observation(f, payloadFor(native(f))), before = await history(f), projection = projectDraftSelections(input);
    if (projection.status !== 'accepted') throw Error('Missing projection.');
    for (const changed of [
      { ...input, sourceMapping: other.mapping, draftSelectionsAcceptance: { attempt }, draftSelectionsProjection: projection },
      { ...input, sourceMapping: f.mapping, draftSelectionsAcceptance: { attempt }, draftSelectionsProjection: { ...projection, value: { ...projection.value, season: 2025 } } },
      { ...input, value: { forged: true }, sourceMapping: f.mapping, draftSelectionsAcceptance: { attempt }, draftSelectionsProjection: projection },
      { ...input, envelope: { ...input.envelope, provenance: { ...input.envelope.provenance, requestStartedAt: input.envelope.provenance.requestStartedAt!.replace('T', ' ') } },
        sourceMapping: f.mapping, draftSelectionsAcceptance: { attempt }, draftSelectionsProjection: projection },
    ]) { await expect(connection.database.query('SELECT public.record_league_administration_observation($1::jsonb)', [JSON.stringify(changed)])).rejects.toThrow(); expect(await history(f)).toEqual(before); }
    const externalB = numericId();
    await ownerQuery("SELECT revise_league_source_connection($1,'sleeper',$2,$3,'CP17 synthetic A to B')", [f.leagueSeasonId, f.mapping.revisionId, externalB]);
    const mappingB = await administration.readSourceMapping(externalB); if (!mappingB) throw Error('Missing source B.');
    await ownerQuery("SELECT revise_league_source_connection($1,'sleeper',$2,$3,'CP17 synthetic B to A')", [f.leagueSeasonId, mappingB.revisionId, f.external]);
    const newMapping = await administration.readSourceMapping(f.external); if (!newMapping) throw Error('Missing revised source A.');
    const remapped = await history(f); await expect(write(f, input, attempt)).rejects.toThrow(); expect(await history(f)).toEqual(remapped);
    expect((await administration.readDraftSelections!(f.mapping, { ...first.resource, receiptId: first.value.receiptId })).status).not.toBe('available');
    expect((await administration.readDraftSelections!(newMapping, { ...first.resource, receiptId: first.value.receiptId })).status).not.toBe('available');
  }, 60_000);

  it('rolls back expired reservations and deferred changed or equal commits under original twenty second fences', async () => {
    const fixtures = []; for (let i = 0; i < 3; i++) fixtures.push(await fixture());
    const baselines = []; for (const f of fixtures) baselines.push(await capture(f));
    const before = []; for (const f of fixtures) before.push(await history(f));
    const fence = await fenceFor('deferred-original'), writer = await createPinnedIntegrationDatabase('runtime'); let open = false;
    try {
      await writer.database.query('BEGIN'); open = true;
      const store = createLeagueAdministrationStore(writer.database);
      for (const [index, kind] of ['changed', 'equal', 'partial'].entries()) {
        const f = fixtures[index], baseline = baselines[index], attempt = await reserve(f, baseline.resource, fence, store);
        const input = await observation(f, payloadFor(native(f), kind === 'changed' ? [pick(1, { player_id: 'changed' })] : [pick()]), kind === 'partial' ? 'partial' : 'complete');
        const result = await write(f, input, attempt, fence, store); expect(result.draftSelectionsAcceptance?.status).toBe(kind === 'partial' ? 'preserved' : 'accepted');
        const pending = await read(f.mapping, { ...baseline.resource, receiptId: result.draftSelectionsAcceptance!.receiptId }, store);
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
    const f = await fixture(), source = await sourceCapture(f, [native(f)]), selected = source.captures[1], before = await history(f);
    const tables = [...typedTables, 'league_draft_selections', 'league_draft_selection_link_receipts', 'league_draft_selection_player_links'];
    for (const table of tables) {
      expect(await ownerQuery(`SELECT has_table_privilege('league_one_runtime',$1,'SELECT') AS read,
        has_table_privilege('league_one_runtime',$1,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS write,
        has_table_privilege('league_one_auth',$1,'SELECT,INSERT,UPDATE,DELETE') AS auth`, ['public.' + table])).toEqual([{ read: true, write: false, auth: false }]);
      await expect(connection.database.query(`DELETE FROM public.${table}`)).rejects.toThrow(/permission denied/);
    }
    for (const table of typedTables) await expect(ownerQuery(`DELETE FROM public.${table} WHERE content_id=$1`,
      [table === 'league_draft_selection_catalog_entries' ? source.captures[0].value.contentId : selected.value.contentId])).rejects.toThrow(/immutable|history/);
    await expect(ownerQuery(`INSERT INTO league_draft_selection_entries SELECT content_id,99,identity_state,external_draft_id,draft_id,selection_id,
      pick_number,round_value,draft_slot,player_id,external_roster_id,season_team_id,picked_by,is_keeper,native_fields,metadata,extensions,raw
      FROM league_draft_selection_entries WHERE content_id=$1 LIMIT 1`, [selected.value.contentId])).rejects.toThrow(/history cannot gain later facts/);
    const helpers = await ownerQuery<{ signature: string }>(`SELECT p.oid::regprocedure::text AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND (p.proname LIKE '%draft_selection%' OR p.proname='record_league_administration_observation_v53')
      AND p.proname<>'begin_draft_selections_attempt' ORDER BY signature`);
    expect(helpers.length).toBeGreaterThanOrEqual(5);
    for (const helper of helpers) expect(await ownerQuery(`SELECT has_function_privilege('league_one_runtime',$1,'EXECUTE') AS runtime,
      has_function_privilege('league_one_auth',$1,'EXECUTE') AS auth`, [helper.signature])).toEqual([{ runtime: false, auth: false }]);
    await expect(connection.database.query('SELECT public.draft_selections_typed_value($1::uuid)', [selected.value.contentId])).rejects.toThrow(/permission denied/);
    const owner = await createPinnedIntegrationDatabase('owner');
    try {
      await owner.database.query('BEGIN'); await owner.database.query(await readFile(new URL('../scripts/provision-runtime-role.sql', import.meta.url), 'utf8'));
      for (const table of tables) expect(await owner.database.query(`SELECT has_table_privilege('league_one_runtime',$1,'SELECT') AS read,
        has_table_privilege('league_one_runtime',$1,'INSERT,UPDATE,DELETE') AS write`, ['public.' + table])).toEqual([{ read: true, write: false }]);
      expect(await owner.database.query("SELECT has_function_privilege('league_one_runtime','public.begin_draft_selections_attempt(jsonb,jsonb,uuid,jsonb)','EXECUTE') AS allowed")).toEqual([{ allowed: true }]);
      for (const helper of helpers) expect(await owner.database.query(`SELECT has_function_privilege('league_one_runtime',$1,'EXECUTE') AS runtime`, [helper.signature])).toEqual([{ runtime: false }]);
    } finally { await owner.database.query('ROLLBACK'); await owner.close(); }
    await storedOnly(async store => { for (const captured of source.captures) {
      expect(await read(f.mapping, { ...captured.resource, receiptId: captured.value.receiptId }, store)).toEqual(captured.value);
      expect((await read(f.mapping, captured.resource, store)).selection).toBe('current');
    } });
    expect(await history(f)).toEqual(before);
  }, 60_000);
});
