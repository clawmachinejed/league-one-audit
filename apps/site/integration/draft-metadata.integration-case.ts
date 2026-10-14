import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { DatabaseClient, DatabaseQueryOptions, DatabaseRow } from '../lib/database';
import type { JsonObject, JsonValue, NormalizedAdministrationObservation } from '../lib/league-administration/contracts';
import type { AdministrationSourceMapping } from '../lib/league-administration/source-mapping';
import type { AdministrationWriteFence } from '../lib/league-administration/store-contracts';
import type { RosterAttempt } from '../lib/aggregator/current-roster';
import { DRAFT_METADATA_VERSION, projectDraftMetadata, type DraftMetadataRead,
  type DraftMetadataResource, type DraftMetadataSelection } from '../lib/aggregator/draft-metadata';
import { createLeagueAdministrationStore } from '../lib/league-administration/store';
import { normalizeAdministrationObservation } from '../lib/league-administration/normalize';
import { getOfficialDraftAdministration } from '../lib/sleeper';
import { createProjectionStore } from '../lib/projection-store';
import { exactMatchupClockInstant } from './exact-matchup-clock';
import { createIndependentDatabase, createPinnedIntegrationDatabase, ownerQuery, type IndependentDatabase } from './neon-integration-harness';

const numericId = () => '9' + BigInt('0x' + randomUUID().replaceAll('-', '').slice(0, 15));
const typedTables = ['league_draft_metadata_contents', 'league_draft_metadata_entries', 'league_draft_metadata_facts',
  'league_draft_metadata_user_slots', 'league_draft_metadata_slot_rosters'] as const;
const catalogResource = { kind: 'catalog' } as const;
const detailResource = (externalDraftId: string) => ({ kind: 'detail', externalDraftId } as const);
type StoredRead = Extract<DraftMetadataRead, { value: unknown }>;

/** CP16 AUTHORED / SQL-UNQUALIFIED. DATA-CP16-2026-10-14-QUALIFICATION-SCOPE.
 * Data resource: official 2026 Sleeper draft identity/settings/order/status.
 * Existing path: fixture HTTP -> existing adapter/normalizer -> restricted
 * administration acceptance -> typed relational tables -> current/exact reader.
 * Persisted result: immutable independent metadata receipts, native field states,
 * explicit coverage/counts; selections and trades remain not-requested.
 * Real evidence/gaps: this module is authored proof only until separately
 * authorized actual PostgreSQL execution; no live or operating proof follows.
 * Eight 60s cases + two 120s hooks = 12m. The remaining 18m inside unchanged
 * 30m work allocates 8m setup/migrations/roles, 3m reporting/global teardown,
 * and 7m overhead. These are planning allowances, not measured stage guarantees.
 * Fixed 0.25 CU, 40m lifecycle, 50m CI, original 20s fences and no retries remain.
 * All identities, enrollment and HTTP bodies are synthetic prerequisites; none
 * is ordinary DATA intake, live source, CP17/18 picks/trades, or CP19 cadence. */
describe.sequential('official draft metadata through restricted PostgreSQL', () => {
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
    const external = numericId(), leagueKey = 'cp16-' + randomUUID();
    const registered = await createProjectionStore(connection.database).registerLeagueSeason({ leagueKey,
      leagueName: 'CP16 synthetic draft metadata', season: 2026, sleeperLeagueId: external, scoringRules: { rec: 0.5 } });
    if (registered.kind !== 'stored') throw new Error('CP16 fixture registration unavailable.');
    await ownerQuery("INSERT INTO league_administration_enrollments(league_id,provider,evidence) VALUES($1,'sleeper','CP16 synthetic prerequisite')", [registered.value.leagueId]);
    await ownerQuery("INSERT INTO league_administration_enrollment_seasons(league_id,season,provider,evidence) VALUES($1,2026,'sleeper','CP16 synthetic prerequisite')", [registered.value.leagueId]);
    const mapping = await administration.readSourceMapping(external); if (!mapping) throw new Error('Missing CP16 mapping.');
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
  const payloadFor = (row: JsonObject): JsonObject => ({ metadataVersion: DRAFT_METADATA_VERSION, kind: 'detail',
    externalDraftId: row.draft_id, catalog: row, draft: row });
  const reserve = (f: Fixture, resource: DraftMetadataResource, fence?: AdministrationWriteFence, store = administration) => {
    if (!store.beginDraftMetadataAttempt) throw new Error('Missing CP16 reservation.');
    return store.beginDraftMetadataAttempt(f.mapping, resource, randomUUID(), fence);
  };
  const write = (f: Fixture, input: NormalizedAdministrationObservation, attempt: RosterAttempt,
    fence?: AdministrationWriteFence, store = administration) => store.recordObservation(input, fence, f.mapping,
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, { attempt });
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
  async function read(mapping: AdministrationSourceMapping, selection: DraftMetadataSelection, store = administration): Promise<StoredRead> {
    if (!store.readDraftMetadata) throw new Error('Missing CP16 stored reader.');
    const result = await store.readDraftMetadata(mapping, selection);
    expect(['available', 'observed']).toContain(result.status);
    if (result.status !== 'available' && result.status !== 'observed') throw new Error('Missing CP16 stored metadata.');
    return result;
  }
  async function capture(f: Fixture, row = native(f), completeness: 'complete' | 'partial' = 'complete') {
    const resource = detailResource(String(row.draft_id)), attempt = await reserve(f, resource);
    const input = await observation(f, payloadFor(row), completeness), result = await write(f, input, attempt);
    const receiptId = result.draftMetadataAcceptance?.receiptId; if (!receiptId) throw new Error('Missing CP16 receipt.');
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
      const match = /^https:\/\/api\.sleeper\.app\/v1\/draft\/([A-Za-z0-9_-]+)$/u.exec(url);
      if (!match) throw new Error('Unexpected CP16 source endpoint: ' + url);
      const body = responses.has(match[1]) ? responses.get(match[1]) : Array.isArray(rows)
        ? rows.find(row => row !== null && typeof row === 'object' && !Array.isArray(row) && row.draft_id === match[1]) : null;
      if (body instanceof Error) throw body;
      return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
    });
    try {
      const acquired = await getOfficialDraftAdministration(f.external, 2026, { metadataOnly: true, maxRequests,
        signal: AbortSignal.timeout(20_000), beforeDetail: async id => {
          attempts.set(id, await reserve(f, detailResource(id))); await waitForSourceClock();
        } });
      expect(acquired.providerRequests).toBe(urls.length);
      const captures = [];
      for (const document of acquired.observations) {
        const payload = document.payload as JsonObject;
        const resource = payload.kind === 'catalog' ? catalogResource : detailResource(String(payload.externalDraftId));
        const attempt = attempts.get(resource.kind === 'catalog' ? 'catalog' : resource.externalDraftId);
        if (!attempt) throw new Error('Unreserved CP16 adapter capture.');
        const input = normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1',
          dialect: 'sleeper-nfl-v1', scope: f.mapping.scope, family: document.family, week: document.week,
          completeness: document.completeness ?? 'complete', payload,
          provenance: { origin: document.origin, requestStartedAt: document.requestStartedAt, requestCompletedAt: document.requestCompletedAt,
            sourceObservedAt: document.sourceObservedAt, checkedAt: new Date().toISOString() } });
        const result = await write(f, input, attempt), receiptId = result.draftMetadataAcceptance?.receiptId;
        if (!receiptId) throw new Error('Missing CP16 adapter receipt.');
        const value = await read(f.mapping, { ...resource, receiptId });
        expect(value.provenance).toEqual(input.envelope.provenance);
        const projection = projectDraftMetadata(input);
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
      ${typed.join(',')}`, [f.leagueSeasonId]);
  }
  async function storedOnly<T>(body: (store: ReturnType<typeof createLeagueAdministrationStore>) => Promise<T>) {
    const statements: string[] = [];
    const database: DatabaseClient = { enabled: true,
      query: async <Row extends DatabaseRow = DatabaseRow>(sql: string, parameters?: readonly unknown[], options?: DatabaseQueryOptions) => {
        statements.push(sql); expect(sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|CALL)\b/iu);
        return connection.database.query<Row>(sql, parameters, options);
      } };
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('CP16 stored reader must not fetch.'));
    try { const result = await body(createLeagueAdministrationStore(database));
      expect(fetch).not.toHaveBeenCalled(); expect(statements.length).toBeGreaterThan(0); return result;
    } finally { fetch.mockRestore(); }
  }

  it('stores multiple native draft identities settings order and status through the fixture HTTP adapter and restricted reader', async () => {
    const f = await fixture(), rows = [native(f, '90071992547409939'), native(f, '90071992547409938', { type: 'auction', status: 'drafting' })];
    const result = await sourceCapture(f, rows);
    expect(result.urls).toEqual([`https://api.sleeper.app/v1/league/${f.external}/drafts`, ...rows.map(row => `https://api.sleeper.app/v1/draft/${row.draft_id}`)]);
    const catalog = result.captures[0].value;
    expect(catalog).toMatchObject({ status: 'available', value: { kind: 'catalog', complete: true, totalCount: 2,
      validIdentityCount: 2, attemptedDetailCount: 2, succeededDetailCount: 2, failedDetailCount: 0, unrequestedDetailCount: 0 } });
    if (catalog.value?.kind !== 'catalog') throw new Error('Expected catalog.');
    expect(catalog.value.entries.map(entry => [entry.externalDraftId, entry.sourceOrdinal])).toEqual([['90071992547409939', 0], ['90071992547409938', 1]]);
    for (const [index, capture] of result.captures.slice(1).entries()) {
      expect(capture.value).toMatchObject({ status: 'available', sourceMappingRevisionId: f.mapping.revisionId, value: {
        kind: 'detail', externalDraftId: rows[index].draft_id, picks: 'not-requested', tradedPicks: 'not-requested', detail: {
          externalLeagueId: f.external, season: 2026, status: { state: 'supplied', raw: rows[index].status, value: rows[index].status },
          settings: { value: rows[index].settings }, draftOrder: { value: rows[index].draft_order }, slotToRosterId: { value: rows[index].slot_to_roster_id },
          userSlots: [{ externalUserId: '90071992547409940', slot: { value: 1 } }, { externalUserId: '90071992547409941', slot: { value: 2 } }],
          slotRosters: [{ slotKey: '1', externalRosterId: { raw: 1, value: '1' } }, { slotKey: '2', externalRosterId: { value: '90071992547409942' } }],
          extensions: { future_native: { enabled: false, zero: 0 } } } } });
      expect((await read(f.mapping, capture.resource)).receiptId).toBe(capture.value.receiptId);
      expect(await connection.database.query(`SELECT external_draft_id,external_league_id,season,status_value FROM league_draft_metadata_facts
        WHERE content_id=$1 AND source_kind='detail'`, [capture.value.contentId])).toEqual([
        { external_draft_id: rows[index].draft_id, external_league_id: f.external, season: 2026, status_value: rows[index].status }]);
    }
    expect(await connection.database.query('SELECT external_draft_id,source_ordinal FROM league_draft_metadata_entries WHERE content_id=$1 ORDER BY source_ordinal', [catalog.contentId]))
      .toEqual(rows.map((row, source_ordinal) => ({ external_draft_id: row.draft_id, source_ordinal })));
  }, 60_000);

  it('distinguishes native optional states and accepts metadata independently without changing legacy draft coverage', async () => {
    const f = await fixture(), row = { ...native(f, undefined, { status: 'pre_draft', settings: {}, metadata: null, draft_order: null,
      slot_to_roster_id: {}, start_time: 0, last_picked: false }) }; delete row.created;
    // Seed a separately complete legacy bundle; metadata-only observations must
    // not turn missing selections/trades into new legacy completeness.
    const legacyInput = await observation(f, [{ catalog: row, draft: row, picks: [], traded_picks: [] }]);
    expect(legacyInput.status).toBe('accepted');
    expect((await administration.recordObservation(legacyInput, undefined, f.mapping)).status).toBe('changed');
    const legacyBefore = await administration.readSource({ ...f.mapping.scope, family: 'drafts', week: null });
    expect(legacyBefore.status).toBe('available');
    const source = await sourceCapture(f, [row]), value = source.captures[1].value;
    expect(value).toMatchObject({ status: 'available', value: { complete: true, picks: 'not-requested', tradedPicks: 'not-requested', detail: {
      status: { state: 'supplied', value: 'pre_draft' }, settings: { state: 'empty', raw: {}, value: {} }, metadata: { state: 'null' },
      draftOrder: { state: 'null' }, slotToRosterId: { state: 'empty' }, startTime: { state: 'supplied', raw: 0, value: 0 },
      created: { state: 'missing' }, lastPicked: { state: 'invalid', raw: false, value: null } } } });
    const invalidOptional = await capture(f, { ...row, settings: false, status: '', draft_order: { user: 0 }, slot_to_roster_id: { '1': false } });
    expect(invalidOptional.value).toMatchObject({ status: 'available', value: { detail: { settings: { state: 'invalid', raw: false },
      status: { state: 'empty', raw: '', value: '' }, userSlots: [{ slot: { state: 'invalid', raw: 0 } }],
      slotRosters: [{ externalRosterId: { state: 'invalid', raw: false } }] } } });
    expect(source.captures.every(capture => capture.result.status === 'rejected')).toBe(true);
    expect(await administration.readSource({ ...f.mapping.scope, family: 'drafts', week: null })).toEqual(legacyBefore);
    const partial = await capture(f, row, 'partial'); expect(partial.result.draftMetadataAcceptance?.status).toBe('preserved');
    expect((await read(f.mapping, partial.resource)).receiptId).toBe(invalidOptional.value.receiptId);
    expect(await administration.readSource({ ...f.mapping.scope, family: 'drafts', week: null })).toEqual(legacyBefore);
    // The old full-bundle adapter still requests and retains selections/trades.
    const urls: string[] = [], fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input); urls.push(url);
      return new Response(JSON.stringify(url.endsWith('/drafts') ? [row] : url.endsWith('/picks') || url.endsWith('/traded_picks') ? [] : row));
    });
    try { const legacy = await getOfficialDraftAdministration(f.external, 2026, { maxRequests: 4 });
      expect(legacy.providerRequests).toBe(4); expect(urls).toHaveLength(4);
      expect(legacy.observations[0].payload).toEqual([{ catalog: row, draft: row, picks: [], traded_picks: [] }]);
      const input = await observation(f, legacy.observations[0].payload as JsonValue);
      expect(input.status).toBe('accepted');
    } finally { fetch.mockRestore(); }
  }, 60_000);

  it('preserves complete empty eight draft capacity and honest nine draft overflow counts', async () => {
    const f = await fixture(), empty = await sourceCapture(f, []);
    expect(empty.acquired.providerRequests).toBe(1); expect(empty.captures).toHaveLength(1);
    expect(empty.captures[0].value).toMatchObject({ status: 'available', value: { complete: true, totalCount: 0, entries: [],
      validIdentityCount: 0, attemptedDetailCount: 0, succeededDetailCount: 0, failedDetailCount: 0, unrequestedDetailCount: 0 } });
    const eight = Array.from({ length: 8 }, (_, index) => native(f, 'draft-' + index));
    const maximum = await sourceCapture(f, eight); expect(maximum.acquired.providerRequests).toBe(9); expect(maximum.captures).toHaveLength(9);
    expect(maximum.captures[0].value).toMatchObject({ status: 'available', value: { complete: true, totalCount: 8, attemptedDetailCount: 8, succeededDetailCount: 8 } });
    const nine = [...eight, native(f, 'draft-8')], overflow = await sourceCapture(f, nine);
    expect(overflow.acquired).toMatchObject({ providerRequests: 1, reason: 'draft-inventory-limit' }); expect(overflow.captures).toHaveLength(1);
    expect(overflow.captures[0].value).toMatchObject({ status: 'observed', acceptanceId: null, value: { complete: false, totalCount: 9,
      validIdentityCount: 9, invalidIdentityCount: 0, attemptedDetailCount: 0, succeededDetailCount: 0, failedDetailCount: 0, unrequestedDetailCount: 9 } });
    expect((await read(f.mapping, catalogResource)).receiptId).toBe(maximum.captures[0].value.receiptId);
    expect(await read(f.mapping, { ...catalogResource, receiptId: empty.captures[0].value.receiptId })).toEqual(empty.captures[0].value);
  }, 60_000);

  it('preserves valid siblings and last good metadata through partial failed malformed and conflicting captures', async () => {
    const f = await fixture(), rows = ['a', 'b', 'c', 'd'].map(id => native(f, id));
    const original = await sourceCapture(f, rows);
    const changed = { ...rows[0], status: 'complete', metadata: { correction: true } };
    const adverse = await sourceCapture(f, rows, new Map<string, JsonValue | Error>([
      ['a', changed], ['b', new Error('Synthetic failed detail')], ['c', []], ['d', { ...rows[3], league_id: 'foreign' }],
    ]));
    expect(adverse.acquired.providerRequests).toBe(5);
    expect(adverse.captures[0].value).toMatchObject({ status: 'observed', value: { complete: false, totalCount: 4,
      attemptedDetailCount: 4, succeededDetailCount: 1, failedDetailCount: 3, unrequestedDetailCount: 0 } });
    expect(adverse.captures[1].value).toMatchObject({ status: 'available', value: { detail: { metadata: { value: { correction: true } } } } });
    for (const index of [2, 3, 4]) {
      expect(adverse.captures[index].value.status).toBe('observed');
      expect((await read(f.mapping, adverse.captures[index].resource)).receiptId).toBe(original.captures[index].value.receiptId);
    }
    const mixed = await sourceCapture(f, [rows[0], { ...rows[1], season: '2025' }]);
    expect(mixed.captures[0].value).toMatchObject({ status: 'observed', value: { totalCount: 2, validIdentityCount: 1,
      invalidIdentityCount: 1, attemptedDetailCount: 1, succeededDetailCount: 1, failedDetailCount: 0, unrequestedDetailCount: 1 } });
    expect((await read(f.mapping, catalogResource)).receiptId).toBe(original.captures[0].value.receiptId);
    const malformed = await sourceCapture(f, { unexpected: true });
    expect(malformed.captures[0].value).toMatchObject({ status: 'observed', value: { complete: false, totalCount: null, attemptedDetailCount: 0 } });
    expect((await read(f.mapping, catalogResource)).receiptId).toBe(original.captures[0].value.receiptId);
  }, 60_000);

  it('retains immutable corrections fresh equal content receipts exact replay and both completion orders', async () => {
    const f = await fixture(), first = await capture(f), same = await capture(f);
    expect(same.value.status).toBe('available'); expect(same.value.contentId).toBe(first.value.contentId);
    expect(same.value.receiptId).not.toBe(first.value.receiptId); expect(same.value.provenance).not.toEqual(first.value.provenance);
    const beforeReplay = await history(f);
    expect((await write(f, same.input, same.attempt)).draftMetadataAcceptance)
      .toMatchObject({ status: 'accepted', reason: 'exact_receipt_replay', receiptId: same.value.receiptId });
    expect(await history(f)).toEqual(beforeReplay);
    const correction = await capture(f, native(f, undefined, { status: 'drafting', last_picked: 1, draft_order: { user: 1 } }));
    expect(correction.value.contentId).not.toBe(first.value.contentId);
    expect(correction.value).toMatchObject({ value: { detail: { status: { value: 'drafting' }, lastPicked: { value: 1 } } } });
    expect(await read(f.mapping, { ...first.resource, receiptId: first.value.receiptId })).toEqual(first.value);
    for (const olderFirst of [true, false]) {
      const older = await reserve(f, first.resource), newer = await reserve(f, first.resource);
      const olderInput = await observation(f, payloadFor(native(f, undefined, { metadata: { completion: 'older' } })));
      const newerInput = await observation(f, payloadFor(native(f, undefined, { metadata: { completion: 'newer', olderFirst } })));
      const oldWrite = () => write(f, olderInput, older), newWrite = () => write(f, newerInput, newer);
      const a = await (olderFirst ? oldWrite() : newWrite()), b = await (olderFirst ? newWrite() : oldWrite());
      expect((olderFirst ? a : b).draftMetadataAcceptance).toMatchObject({ status: 'preserved', reason: 'newer_network_attempt_reserved' });
      expect((olderFirst ? b : a).draftMetadataAcceptance?.status).toBe('accepted');
      expect(await read(f.mapping, first.resource)).toMatchObject({ value: { detail: { metadata: { value: { completion: 'newer', olderFirst } } } } });
    }
    const old = await reserve(f, first.resource), input = await observation(f, payloadFor(native(f)));
    await reserve(f, first.resource); const before = await read(f.mapping, first.resource);
    expect((await write(f, input, old)).draftMetadataAcceptance?.status).toBe('preserved');
    expect(await read(f.mapping, first.resource)).toEqual(before);
  }, 60_000);

  it('rejects foreign receipts wrong season remapping and forged metadata atomically', async () => {
    const f = await fixture(), first = await capture(f), other = await fixture();
    const unrelated = await capture(other); expect(unrelated.value.receiptId).not.toBe(first.value.receiptId);
    const identities = await connection.database.query('SELECT id,league_season_id FROM league_season_drafts WHERE league_season_id=ANY($1::uuid[]) AND external_draft_id=$2',
      [[f.leagueSeasonId, other.leagueSeasonId], first.resource.externalDraftId]);
    expect(identities).toHaveLength(2); expect(new Set(identities.map(identity => identity.id)).size).toBe(2);
    for (const [mapping, selection] of [[other.mapping, { ...first.resource, receiptId: first.value.receiptId }],
      [f.mapping, { ...catalogResource, receiptId: first.value.receiptId }],
      [{ ...f.mapping, revisionId: randomUUID() }, { ...first.resource, receiptId: first.value.receiptId }],
      [{ ...f.mapping, scope: { ...f.mapping.scope, season: 2025 } }, first.resource]] as const)
      expect((await administration.readDraftMetadata!(mapping, selection)).status).not.toBe('available');
    const attempt = await reserve(f, first.resource), input = await observation(f, payloadFor(native(f))), before = await history(f);
    const projection = projectDraftMetadata(input); if (projection.status !== 'accepted') throw new Error('Missing CP16 projection.');
    for (const changed of [
      { ...input, sourceMapping: other.mapping, draftMetadataAcceptance: { attempt }, draftMetadataProjection: projection },
      { ...input, sourceMapping: f.mapping, draftMetadataAcceptance: { attempt }, draftMetadataProjection: { ...projection, value: { ...projection.value, season: 2025 } } },
      { ...input, value: { forged: true }, sourceMapping: f.mapping, draftMetadataAcceptance: { attempt }, draftMetadataProjection: projection },
      { ...input, envelope: { ...input.envelope, provenance: { ...input.envelope.provenance,
        requestStartedAt: input.envelope.provenance.requestStartedAt!.replace('T', ' ') } },
      sourceMapping: f.mapping, draftMetadataAcceptance: { attempt }, draftMetadataProjection: projection },
    ]) { await expect(connection.database.query('SELECT public.record_league_administration_observation($1::jsonb)', [JSON.stringify(changed)])).rejects.toThrow();
      expect(await history(f)).toEqual(before); }
    // A missing reason is not SQL NULL-equivalent to the required JSON null.
    // Forge the otherwise valid empty-catalog projection to exercise SQL's
    // independent shape check, rather than relying on the TypeScript rejection.
    const catalogAttempt = await reserve(f, catalogResource);
    const validEmpty = await observation(f, { metadataVersion: DRAFT_METADATA_VERSION, kind: 'catalog', catalog: [], details: [], reason: null });
    const emptyProjection = projectDraftMetadata(validEmpty); expect(emptyProjection.status).toBe('accepted');
    const missingReasonPayload = { ...(validEmpty.envelope.payload as JsonObject) }; delete missingReasonPayload.reason;
    const missingReason = normalizeAdministrationObservation({ ...validEmpty.envelope, payload: missingReasonPayload });
    expect(projectDraftMetadata(missingReason).status).toBe('rejected');
    const beforeMissingReason = await history(f);
    await expect(connection.database.query('SELECT public.record_league_administration_observation($1::jsonb)', [JSON.stringify({
      ...missingReason, sourceMapping: f.mapping, draftMetadataAcceptance: { attempt: catalogAttempt }, draftMetadataProjection: emptyProjection,
    })])).rejects.toThrow();
    expect(await history(f)).toEqual(beforeMissingReason);
    // Trusted-owner injection still cannot borrow league configuration/population
    // to satisfy a draft acceptance through another family's shared-lineage arm.
    const settingsInput = normalizeAdministrationObservation({ ...input.envelope, family: 'league', payload: {
      league_id: f.external, season: '2026', sport: 'nfl', name: 'CP16 synthetic configuration', total_rosters: 2,
      scoring_settings: { rec: 0.5 }, roster_positions: ['QB', 'BN'], settings: {} } });
    expect(settingsInput.status).toBe('accepted');
    const settingsResult = await administration.recordObservation(settingsInput, undefined, f.mapping);
    const [configuration] = await connection.database.query('SELECT content_id FROM league_administration_observations WHERE id=$1', [settingsResult.observationId]);
    const injectedAttempt = await reserve(f, first.resource), injectedReceipt = randomUUID(), beforeInjection = await history(f);
    const owner = await createPinnedIntegrationDatabase('owner');
    try {
      await owner.database.query('BEGIN');
      await owner.database.query(`INSERT INTO league_roster_capture_receipts(id,attempt_id,content_id,legacy_observation_id,evidence_hash,
        provenance,configuration_content_id,population_evidence,expected_team_count,coverage)
        SELECT $1,$2,content_id,legacy_observation_id,evidence_hash,provenance,$3,jsonb_build_object('observationId',$4::text),2,coverage
        FROM league_roster_capture_receipts WHERE id=$5`,
      [injectedReceipt, injectedAttempt.id, configuration.content_id, settingsResult.observationId, first.value.receiptId]);
      await expect((async () => {
        await owner.database.query(`INSERT INTO league_roster_resource_acceptances(scope_id,receipt_id,source_mapping_revision_id,generation)
          VALUES($1,$2,$3,$4)`, [injectedAttempt.scopeId, injectedReceipt, f.mapping.revisionId, injectedAttempt.expectedGeneration + 1]);
        await owner.database.query('SET CONSTRAINTS ALL IMMEDIATE');
      })()).rejects.toThrow(/resource acceptance lineage mismatch/);
    } finally { await owner.database.query('ROLLBACK'); await owner.close(); }
    expect(await history(f)).toEqual(beforeInjection);
    const stale = await reserve(f, first.resource), staleInput = await observation(f, payloadFor(native(f)));
    const externalB = numericId();
    await ownerQuery("SELECT revise_league_source_connection($1,'sleeper',$2,$3,'CP16 synthetic A to B')", [f.leagueSeasonId, f.mapping.revisionId, externalB]);
    const mappingB = await administration.readSourceMapping(externalB); if (!mappingB) throw new Error('Missing remapped source B.');
    await ownerQuery("SELECT revise_league_source_connection($1,'sleeper',$2,$3,'CP16 synthetic B to A')", [f.leagueSeasonId, mappingB.revisionId, f.external]);
    const mappingA = await administration.readSourceMapping(f.external); if (!mappingA) throw new Error('Missing remapped source A.');
    expect(mappingA.revisionId).not.toBe(f.mapping.revisionId);
    const remapped = await history(f); await expect(write(f, staleInput, stale)).rejects.toThrow(); expect(await history(f)).toEqual(remapped);
    expect((await administration.readDraftMetadata!(f.mapping, { ...first.resource, receiptId: first.value.receiptId })).status).not.toBe('available');
    expect((await administration.readDraftMetadata!(mappingA, { ...first.resource, receiptId: first.value.receiptId })).status).not.toBe('available');
  }, 60_000);

  it('rolls back observed locks and deferred changed or equal commits after original twenty second fences expire', async () => {
    // Four independent leagues avoid the legacy writer's per-league advisory
    // lock. Each owns distinct sessions, scope, job and original 20s fence.
    // Parallel expiry is test contention evidence within this sequential case;
    // it is not parallel suite selection or a shorter replacement deadline.
    const fixtures = await Promise.all(Array.from({ length: 4 }, () => fixture()));
    const baselines = await Promise.all(fixtures.map(f => capture(f)));
    async function fenceFor(label: string) {
      const jobKey = 'cp16-' + label + '-' + randomUUID(), workerId = randomUUID();
      await ownerQuery(`INSERT INTO projection_jobs(job_key,job_type,scheduled_for,state,lease_owner,lease_until,attempt_count)
        VALUES($1,'league-administration',clock_timestamp(),'running',$2,clock_timestamp()+interval '30 seconds',1)`, [jobKey, workerId]);
      const [clock] = await connection.database.query("SELECT clock_timestamp()+interval '20 seconds' AS at");
      return { jobKey, workerId, generation: 1, deadlineAt: exactMatchupClockInstant(clock.at) } satisfies AdministrationWriteFence;
    }
    const finishJob = (fence: AdministrationWriteFence) => ownerQuery("UPDATE projection_jobs SET state='failed',lease_owner=NULL,lease_until=NULL,completed_at=clock_timestamp() WHERE job_key=$1", [fence.jobKey]);
    async function locked() {
      const f = fixtures[0], original = baselines[0];
      const blocker = await createPinnedIntegrationDatabase('owner'), writer = await createPinnedIntegrationDatabase('runtime');
      let fence: AdministrationWriteFence | undefined, pending: Promise<{ error?: unknown }> | undefined, open = false;
      try {
        const [blockerPid] = await blocker.database.query('SELECT pg_backend_pid() AS pid');
        const [writerPid] = await writer.database.query('SELECT pg_backend_pid() AS pid,session_user AS role');
        expect(writerPid.role).toBe('league_one_runtime');
        fence = await fenceFor('observed-lock');
        const attempt = await reserve(f, original.resource, fence), input = await observation(f, payloadFor(native(f, undefined, { status: 'drafting' })));
        const before = await history(f);
        await blocker.database.query('BEGIN'); open = true;
        const held = await blocker.database.query('SELECT scope_id FROM league_roster_resource_heads WHERE scope_id=$1 FOR UPDATE', [attempt.scopeId]);
        expect(held).toHaveLength(1);
        let settled = false;
        pending = write(f, input, attempt, fence, createLeagueAdministrationStore(writer.database))
          .then(() => ({}), error => ({ error })).finally(() => { settled = true; });
        let observed = false;
        for (let poll = 0; poll < 100; poll++) {
          const [row] = await blocker.database.query(`SELECT $1::integer=ANY(pg_blocking_pids($2::integer))
            AND EXISTS(SELECT 1 FROM pg_locks waited WHERE waited.pid=$2::integer
              AND waited.locktype='transactionid' AND NOT waited.granted) AS blocked`, [blockerPid.pid, writerPid.pid]);
          if (row.blocked) { observed = true; break; } await delay(20);
        }
        expect(observed).toBe(true); expect(settled).toBe(false);
        await blocker.database.query('SELECT pg_sleep(GREATEST(0,EXTRACT(EPOCH FROM ($1::timestamptz-clock_timestamp())))+0.025)', [fence.deadlineAt]);
        await blocker.database.query('COMMIT'); open = false;
        expect(String((await pending).error)).toMatch(/fence.*(?:stale|expired)|deadline/i);
        expect(await history(f)).toEqual(before);
        expect(await read(f.mapping, original.resource)).toMatchObject({ receiptId: original.value.receiptId });
      } finally {
        if (open) await blocker.database.query('ROLLBACK');
        if (pending) await pending;
        await Promise.allSettled([writer.close(), blocker.close()]);
        if (fence) await finishJob(fence);
      }
    }
    async function deferred(index: number, kind: 'changed' | 'equal' | 'partial') {
      const f = fixtures[index], original = baselines[index], writer = await createPinnedIntegrationDatabase('runtime');
      let open = false, fence: AdministrationWriteFence | undefined;
      const before = await history(f);
      try {
        expect((await writer.database.query('SELECT session_user AS role'))[0].role).toBe('league_one_runtime');
        fence = await fenceFor('deferred-' + kind);
        await writer.database.query('BEGIN'); open = true;
        const store = createLeagueAdministrationStore(writer.database), attempt = await reserve(f, original.resource, fence, store);
        const row = kind === 'changed' ? native(f, undefined, { metadata: { changed: true } }) : native(f);
        const input = await observation(f, payloadFor(row), kind === 'partial' ? 'partial' : 'complete');
        const result = await write(f, input, attempt, fence, store);
        expect(result.draftMetadataAcceptance?.status).toBe(kind === 'partial' ? 'preserved' : 'accepted');
        const receiptId = result.draftMetadataAcceptance?.receiptId; expect(receiptId).toBeTruthy();
        expect((await writer.database.query('SELECT clock_timestamp()<$1::timestamptz AS live', [fence.deadlineAt]))[0].live).toBe(true);
        const pendingReceipt = await read(f.mapping, { ...original.resource, receiptId }, store);
        expect(pendingReceipt.status).toBe(kind === 'partial' ? 'observed' : 'available');
        if (kind === 'changed') expect(pendingReceipt.contentId).not.toBe(original.value.contentId);
        if (kind === 'equal') expect(pendingReceipt.contentId).toBe(original.value.contentId);
        expect(pendingReceipt.receiptId).not.toBe(original.value.receiptId);
        await writer.database.query('SELECT pg_sleep(GREATEST(0,EXTRACT(EPOCH FROM ($1::timestamptz-clock_timestamp())))+0.025)', [fence.deadlineAt]);
        await expect(writer.database.query('COMMIT')).rejects.toThrow(/fence.*(?:stale|expired)|deadline/i); open = false;
        expect(await history(f)).toEqual(before);
        expect(await read(f.mapping, original.resource)).toMatchObject({ receiptId: original.value.receiptId });
      } finally {
        if (open) await writer.database.query('ROLLBACK');
        await writer.close(); if (fence) await finishJob(fence);
      }
    }
    const outcomes = await Promise.allSettled([locked(), deferred(1, 'changed'), deferred(2, 'equal'), deferred(3, 'partial')]);
    for (const outcome of outcomes) if (outcome.status === 'rejected') throw outcome.reason;
  }, 60_000);

  it('denies direct typed mutations private helpers and history changes while current and exact reads stay source free', async () => {
    const f = await fixture(), source = await sourceCapture(f, [native(f)]), first = source.captures[0], before = await history(f);
    for (const table of [...typedTables, 'league_season_drafts']) {
      const column = table === 'league_season_drafts' ? 'league_season_id' : 'content_id';
      const identity = table === 'league_season_drafts' ? f.leagueSeasonId : first.value.contentId;
      expect((await connection.database.query(`SELECT count(*)::integer AS count FROM public.${table} WHERE ${column}=$1`, [identity]))[0].count).toBeGreaterThan(0);
      await expect(connection.database.query(`DELETE FROM public.${table} WHERE ${column}=$1`, [identity])).rejects.toThrow(/permission denied/);
      expect(await ownerQuery(`SELECT has_table_privilege('league_one_runtime',$1,'SELECT') AS read,
        has_table_privilege('league_one_runtime',$1,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS write,
        has_table_privilege('league_one_auth',$1,'SELECT,INSERT,UPDATE,DELETE') AS auth`, ['public.' + table]))
        .toEqual([{ read: true, write: false, auth: false }]);
      await expect(ownerQuery(`DELETE FROM public.${table} WHERE ${column}=$1`, [identity])).rejects.toThrow(/immutable|history/);
    }
    await expect(ownerQuery(`INSERT INTO league_draft_metadata_entries(content_id,source_ordinal,identity_state,external_draft_id,detail_state)
      SELECT content_id,99,identity_state,external_draft_id,detail_state FROM league_draft_metadata_entries WHERE content_id=$1 LIMIT 1`,
      [first.value.contentId])).rejects.toThrow(/history cannot gain later facts/);
    const helpers = await ownerQuery<{ signature: string }>(`SELECT p.oid::regprocedure::text AS signature FROM pg_proc p
      JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND (p.proname LIKE '%draft_metadata%' OR p.proname='record_league_administration_observation_v52')
      AND p.proname NOT IN ('begin_draft_metadata_attempt','read_draft_metadata') ORDER BY signature`);
    expect(helpers.length).toBeGreaterThanOrEqual(5);
    for (const helper of helpers) expect(await ownerQuery(`SELECT has_function_privilege('league_one_runtime',$1,'EXECUTE') AS runtime,
      has_function_privilege('league_one_auth',$1,'EXECUTE') AS auth`, [helper.signature])).toEqual([{ runtime: false, auth: false }]);
    await expect(connection.database.query('SELECT public.draft_metadata_typed_value($1::uuid)', [first.value.contentId])).rejects.toThrow(/permission denied/);
    const owner = await createPinnedIntegrationDatabase('owner');
    try {
      await owner.database.query('BEGIN');
      await owner.database.query(await readFile(new URL('../scripts/provision-runtime-role.sql', import.meta.url), 'utf8'));
      for (const table of [...typedTables, 'league_season_drafts']) expect(await owner.database.query(`SELECT has_table_privilege('league_one_runtime',$1,'SELECT') AS read,
        has_table_privilege('league_one_runtime',$1,'INSERT,UPDATE,DELETE') AS write`, ['public.' + table])).toEqual([{ read: true, write: false }]);
      for (const helper of helpers) expect(await owner.database.query(`SELECT has_function_privilege('league_one_runtime',$1,'EXECUTE') AS runtime`,
        [helper.signature])).toEqual([{ runtime: false }]);
      expect(await owner.database.query("SELECT has_function_privilege('league_one_runtime','public.begin_draft_metadata_attempt(jsonb,jsonb,uuid,jsonb)','EXECUTE') AS allowed"))
        .toEqual([{ allowed: true }]);
    } finally { await owner.database.query('ROLLBACK'); await owner.close(); }
    await storedOnly(async store => {
      for (const capture of source.captures) {
        expect(await read(f.mapping, { ...capture.resource, receiptId: capture.value.receiptId }, store)).toEqual(capture.value);
        expect((await read(f.mapping, capture.resource, store)).selection).toBe('current');
      }
    });
    expect(await history(f)).toEqual(before);
  }, 60_000);
});
