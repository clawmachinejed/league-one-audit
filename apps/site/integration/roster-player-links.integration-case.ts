import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CURRENT_ROSTER_POLICY, type RosterPopulationEvidence } from '../lib/aggregator/current-roster';
import type { RosterPlayerLinksRead } from '../lib/aggregator/roster-player-links';
import type { AdministrationEnvelope, AdministrationWriteFence, JsonValue } from '../lib/league-administration/contracts';
import type { AdministrationSourceMapping } from '../lib/league-administration/source-mapping';
import { normalizeAdministrationObservation } from '../lib/league-administration/normalize';
import { createLeagueAdministrationStore, createPublicIntakeStore, createPublicDataRefreshStore } from '../lib/league-administration/store';
import { runPublicIntakeStep, runPublicDataRefreshStep } from '../lib/league-administration/public-intake';
import { readPublicSleeperIntake } from '../lib/league-administration/public-intake-reader';
import { readPublicDataRefresh } from '../lib/league-administration/public-refresh-reader';
import { PUBLIC_INTAKE_JOB } from '../lib/league-administration/public-intake-contracts';
import { createProjectionStore } from '../lib/projection-store';
import { deterministicUuid } from '../lib/projections/adapters/neon/database-values';
import { loadCompletePlayerCatalog } from '../lib/sleeper-player-catalog';
import type { DatabaseClient, DatabaseQueryOptions, DatabaseRow } from '../lib/database';
import { createIndependentDatabase, createPinnedIntegrationDatabase, ownerQuery, type IndependentDatabase } from './neon-integration-harness';

type AvailableLinks = Extract<RosterPlayerLinksRead, { status: 'available' }>;
type Fixture = { leagueKey: string; leagueId: string; leagueSeasonId: string; externalLeagueId: string;
  mapping: AdministrationSourceMapping; population: RosterPopulationEvidence };
const prefix = 'cp6-' + randomUUID();
const ids = { idp: '007' + prefix, odd: prefix + '-odd', defense: prefix + '-def', unicode: 'é-' + prefix,
  reserve: prefix + '-reserve', taxi: prefix + '-taxi', missing: prefix + '-missing', kindless: prefix + '-kindless', mixed: prefix + '-mixed' };
const native = {
  [ids.idp]: { player_id: ids.idp, position: 'LB', full_name: 'Same Name', team: null, active: false, fantasy_positions: ['IDP'] },
  [ids.odd]: { player_id: ids.odd, position: 'UNFAMILIAR', full_name: 'Same Name', team: 'FA' },
  [ids.defense]: { player_id: ids.defense, position: 'DEF', fantasy_positions: ['DEF'], full_name: 'Synthetic defense' },
  [ids.unicode]: { player_id: ids.unicode, position: 'DL' },
  [ids.reserve]: { player_id: ids.reserve, position: 'RB' }, [ids.taxi]: { player_id: ids.taxi, position: 'WR' },
  [ids.kindless]: { player_id: ids.kindless, position: null, fantasy_positions: [] },
  [ids.mixed]: { player_id: ids.mixed, position: 'DEF', fantasy_positions: ['LB'] },
};
const roster = () => [{ roster_id: 1, players: [ids.idp, ids.odd, ids.defense, ids.unicode, ids.reserve, ids.taxi],
  starters: [ids.idp, '0', ids.defense], reserve: [ids.reserve], taxi: [ids.taxi] },
{ roster_id: 2, players: [], starters: [], reserve: [], taxi: [] }];

/** AUTHORED / UNEXECUTED CP6 qualification. HTTP responses and enrollment
 * premises are synthetic; writes, locks, identity decisions and reads use the
 * guarded restricted LOGIN. No immutable acceptance or source time is rewritten.
 * Directory cadence setup changes only its mutable operational prerequisite;
 * ordinary intake/refresh observes actual minute admission spacing. This module
 * does not prove a live catalog, daily cadence, fleet SLO or release.
 * Nine direct ordered cases, one beforeAll/afterAll, no retries or skipped cases. */
describe.sequential('immutable roster player links through restricted PostgreSQL', () => {
  let connection: IndependentDatabase;
  let store: ReturnType<typeof createLeagueAdministrationStore>;
  const activeOwners = new Set<() => Promise<void>>();
  beforeAll(async () => {
    connection = createIndependentDatabase(); store = createLeagueAdministrationStore(connection.database);
    expect((await connection.database.query(`SELECT current_user,session_user,rolsuper,rolcreaterole,rolcreatedb
      FROM pg_roles WHERE rolname=current_user`))[0]).toEqual({ current_user: 'league_one_runtime',
      session_user: 'league_one_runtime', rolsuper: false, rolcreaterole: false, rolcreatedb: false });
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    try {
      for (const finish of [...activeOwners]) await finish();
      const until = Date.now() + 85_000;
      while (true) {
        const [clock] = await connection.database.query(`SELECT
          NOT EXISTS(SELECT 1 FROM public.public_data_dispatches WHERE admitted_at>clock_timestamp()-interval '60 seconds')
          AND NOT EXISTS(SELECT 1 FROM public.projection_jobs WHERE job_key=$1
            AND (state='running' OR completed_at>clock_timestamp()-interval '60 seconds')) AS ready`, [PUBLIC_INTAKE_JOB]);
        if (clock.ready === true) break;
        if (Date.now() >= until) throw new Error('CP6 shared minute cleanup did not settle.');
        await delay(250);
      }
    } finally { await connection.close(); }
  });
  async function databaseNow() {
    const [row] = await connection.database.query('SELECT clock_timestamp() AS at');
    return new Date(String(row.at)).toISOString();
  }
  async function claim(options: { publicDirectory?: boolean; deadlineMs?: number; leaseSeconds?: number } = {}) {
    const jobs = createProjectionStore(connection.database), workerId = randomUUID();
    const jobKey = options.publicDirectory ? PUBLIC_INTAKE_JOB : 'cp6-roster:' + randomUUID(), at = await databaseNow();
    const acquired = await jobs.acquireJob({ jobKey, jobType: options.publicDirectory ? PUBLIC_INTAKE_JOB : 'league-administration',
      workerId, scheduledFor: at, leaseSeconds: options.leaseSeconds ?? 25,
      payload: options.publicDirectory ? { policy: 'public-player-directory-v1', mode: 'player-directory' } : {} });
    if (acquired.kind !== 'acquired') throw new Error('CP6 fixture could not acquire its existing job owner.');
    const fence: AdministrationWriteFence = { jobKey, workerId, generation: acquired.attempt,
      deadlineAt: new Date(Date.parse(at) + (options.deadlineMs ?? 20_000)).toISOString() };
    const finish = async () => {
      if (!await jobs.completeJob(jobKey, workerId)) await jobs.failJob(jobKey, workerId, 'CP6 fixture owner closure');
      activeOwners.delete(finish);
    };
    activeOwners.add(finish); return { fence, finish };
  }
  async function capture(f: Pick<Fixture, 'leagueKey' | 'externalLeagueId'>, payload: JsonValue,
    options: { family?: 'league' | 'rosters'; completeness?: 'complete' | 'partial'; expectedRosterCount?: number } = {}) {
    const at = await databaseNow();
    const envelope: AdministrationEnvelope = { schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1',
      dialect: 'sleeper-nfl-v1', scope: { leagueKey: f.leagueKey, provider: 'sleeper', externalLeagueId: f.externalLeagueId, season: 2026 },
      family: options.family ?? 'rosters', week: null, completeness: options.completeness ?? 'complete', payload,
      provenance: { origin: 'network', requestStartedAt: at, requestCompletedAt: at, sourceObservedAt: at, checkedAt: at } };
    return normalizeAdministrationObservation(envelope, { expectedRosterCount: options.expectedRosterCount });
  }
  async function population(f: Pick<Fixture, 'leagueKey' | 'externalLeagueId'>, total = 2): Promise<RosterPopulationEvidence> {
    const input = await capture(f, { league_id: f.externalLeagueId, season: '2026', sport: 'nfl', total_rosters: total,
      scoring_settings: { rec: 0.5 }, roster_positions: ['IDP', 'DEF', 'BN'] }, { family: 'league' });
    const result = await store.recordObservation(input);
    if (!result.observationId) throw new Error('Missing CP6 population observation.');
    return { observationId: result.observationId, contentHash: input.contentHash, envelope: input.envelope };
  }
  async function fixture(total = 2): Promise<Fixture> {
    const leagueKey = 'cp6-' + randomUUID(), externalLeagueId = '8' + BigInt('0x' + randomUUID().replaceAll('-', '').slice(0, 10));
    const result = await createProjectionStore(connection.database).registerLeagueSeason({ leagueKey, leagueName: 'CP6 isolated DATA fixture',
      season: 2026, sleeperLeagueId: externalLeagueId, scoringRules: { rec: 0.5 } });
    if (result.kind !== 'stored') throw new Error('Missing CP6 canonical registration.');
    await ownerQuery(`INSERT INTO public.league_administration_enrollments(league_id,provider,evidence)
      VALUES($1,'sleeper','CP6 isolated enrollment prerequisite')`, [result.value.leagueId]);
    await ownerQuery(`INSERT INTO public.league_administration_enrollment_seasons(league_id,season,provider,evidence)
      VALUES($1,2026,'sleeper','CP6 isolated enrollment prerequisite')`, [result.value.leagueId]);
    const mapping = await store.readSourceMapping(externalLeagueId); if (!mapping) throw new Error('Missing CP6 source mapping.');
    const base = { leagueKey, externalLeagueId, ...result.value, mapping };
    return { ...base, population: await population(base, total) };
  }
  async function write(f: Fixture, payload: JsonValue = roster(), options: { completeness?: 'complete' | 'partial'; unfenced?: boolean } = {}) {
    const owner = options.unfenced ? null : await claim();
    try {
      const attempt = await store.beginRosterAttempt(f.mapping, randomUUID(), CURRENT_ROSTER_POLICY, owner?.fence);
      const input = await capture(f, payload, { completeness: options.completeness });
      const result = await store.recordObservation(input, owner?.fence, f.mapping, { attempt, population: f.population });
      return { attempt, input, result };
    } finally { await owner?.finish(); }
  }
  async function current(f: Fixture, reader = store) {
    const result = await reader.readAcceptedCurrentRoster(f.mapping, { includePlayerLinks: true });
    if (result.status !== 'available') throw new Error('CP6 roster unavailable: ' + result.status); return result;
  }
  async function links(f: Fixture, receiptId: string, reader = store): Promise<AvailableLinks> {
    const result = await reader.readRosterPlayerLinks({ rosterReceiptId: receiptId, leagueSeasonId: f.leagueSeasonId });
    if (result.status !== 'available') throw new Error('CP6 link snapshot unavailable: ' + JSON.stringify(result)); return result;
  }
  async function directory(rows: Record<string, unknown> = native) {
    await ownerQuery(`UPDATE public.league_player_directory_heads SET last_network_at=clock_timestamp()-interval '25 hours',
      next_network_at=clock_timestamp()-interval '1 hour' WHERE provider='sleeper' AND sport='nfl'`);
    const until = Date.now() + 85_000;
    while (true) {
      const owner = await claim({ publicDirectory: true });
      try {
      const reservation = await store.beginPlayerDirectoryAttempt(randomUUID(), owner.fence);
      if (reservation.status !== 'reserved') {
        if (Date.now() >= until) throw new Error('CP6 directory fixture did not reserve: ' + reservation.status);
        await owner.finish(); await delay(1_000); continue;
      }
      const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
        expect(String(input)).toBe('https://api.sleeper.app/v1/players/nfl'); return new Response(JSON.stringify(rows));
      });
      let source;
      try { source = await loadCompletePlayerCatalog({ attempt: reservation.attempt, signal: AbortSignal.timeout(10_000) });
        expect(fetch).toHaveBeenCalledTimes(1); } finally { fetch.mockRestore(); }
      expect(source.status).toBe('complete');
      const result = await store.recordPlayerDirectoryCapture(reservation.attempt, source, owner.fence);
      expect(result.status).toBe('accepted'); return result.acceptedVersionId!;
      } finally { if (activeOwners.has(owner.finish)) await owner.finish(); }
    }
  }
  async function state(f: Fixture) {
    return ownerQuery(`SELECT
      (SELECT count(*)::int FROM league_administration_contents WHERE league_season_id=$1) AS contents,
      (SELECT count(*)::int FROM league_administration_observations WHERE league_season_id=$1) AS observations,
      (SELECT jsonb_agg(to_jsonb(h) ORDER BY h.scope_id) FROM league_roster_resource_heads h
        JOIN league_roster_resource_scopes s ON s.id=h.scope_id WHERE s.league_season_id=$1) AS heads,
      (SELECT count(*)::int FROM league_roster_capture_receipts r JOIN league_roster_resource_attempts a ON a.id=r.attempt_id
        JOIN league_roster_resource_scopes s ON s.id=a.scope_id WHERE s.league_season_id=$1) AS receipts,
      (SELECT count(*)::int FROM league_roster_player_link_receipts WHERE league_season_id=$1) AS snapshots,
      (SELECT count(*)::int FROM league_roster_player_links l JOIN league_roster_player_link_receipts r
        ON r.roster_acceptance_id=l.roster_acceptance_id WHERE r.league_season_id=$1) AS links,
      (SELECT count(*)::int FROM scoring_entities) AS entities,
      (SELECT count(*)::int FROM external_scoring_entity_ids) AS mappings`, [f.leagueSeasonId]);
  }
  async function readOnly<T>(body: (reader: ReturnType<typeof createLeagueAdministrationStore>, database: DatabaseClient) => Promise<T>) {
    const queries: string[] = [];
    const database: DatabaseClient = { enabled: true,
      query: async <Row extends DatabaseRow = DatabaseRow>(sql: string, parameters?: readonly unknown[], options?: DatabaseQueryOptions) => {
        queries.push(sql); expect(sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|CALL|upsert_scoring_entity_identities)\b/iu);
        return connection.database.query<Row>(sql, parameters, options);
      } };
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('CP6 stored read must not acquire source.'));
    try { const value = await body(createLeagueAdministrationStore(database), database);
      expect(fetch).not.toHaveBeenCalled(); expect(queries.length).toBeGreaterThan(0); return value; } finally { fetch.mockRestore(); }
  }

  it('preserves official membership without directory evidence or a qualified identity owner', async () => {
    const f = await fixture(), beforeDirectory = await store.readAcceptedPlayerDirectory();
    const first = await write(f, [{ roster_id: 1, players: [ids.idp, ids.missing], starters: ['0'] }, { roster_id: 2, players: [] }]);
    expect(first.result.rosterAcceptance?.status).toBe('accepted');
    const read = await current(f), saved = await links(f, read.receipt.id);
    expect(saved).toMatchObject({ outcome: 'partial', counts: { held: 2, resolved: 0, unresolved: 2 } });
    expect(saved.links.every(link => link.canonicalEntityId === null)).toBe(true);
    expect(saved.links[0].reasons).toContain(beforeDirectory.status === 'available' ? 'directory_player_missing' : 'directory_unavailable');
    const before = await state(f); await write(f, roster(), { unfenced: true });
    const unqualified = await current(f);
    expect(unqualified.playerLinks).toMatchObject({ status: 'unavailable' });
    expect(unqualified.teams[0].players.every(player => player.canonicalEntityId === null)).toBe(true);
    expect((await state(f))[0].entities).toBe(before[0].entities); expect(await links(f, read.receipt.id)).toEqual(saved);
  }, 60_000);

  it('shares existing canonical identities across leagues without filtering native player kinds or inventing aliases', async () => {
    const version = await directory(), jobs = createProjectionStore(connection.database);
    const existing = await jobs.upsertScoringEntities([{ key: 'preexisting:' + ids.idp, kind: 'player',
      displayName: 'Preserved canonical metadata', nflTeam: 'BUF', providerIds: [{ provider: 'sleeper', externalId: ids.idp }] }]);
    if (existing.kind !== 'stored') throw new Error('Missing existing identity.');
    const a = await fixture(), b = await fixture(); await write(a); await write(b);
    const readA = await current(a), readB = await current(b);
    const savedA = await links(a, readA.receipt.id), savedB = await links(b, readB.receipt.id);
    expect(savedA).toMatchObject({ outcome: 'complete', directory: { versionId: version }, counts: { held: 6, resolved: 6, unresolved: 0, conflict: 0 } });
    expect(savedA.links.map(link => link.canonicalEntityId)).toEqual(savedB.links.map(link => link.canonicalEntityId));
    expect(savedA.links[0].canonicalEntityId).toBe(existing.value[0].entityId);
    expect(new Set(savedA.links.map(link => link.canonicalEntityId)).size).toBe(6);
    expect(readA.teams[0].seasonTeamId).not.toBe(readB.teams[0].seasonTeamId);
    expect(savedA.links.map(link => link.entityKind)).toEqual(['player', 'player', 'team_defense', 'player', 'player', 'player']);
    for (const link of savedA.links) {
      expect(link.mappingProof).toHaveLength(1);
      expect(link.mappingProof[0]).toMatchObject({ provider: 'sleeper', externalId: link.nativePlayerId,
        entityKind: link.entityKind, scoringEntityId: link.canonicalEntityId, mappingStatus: 'verified', canonicalKind: link.entityKind });
      const kind = link.entityKind!;
      expect((await connection.database.query('SELECT public.scoring_identity_uuid($1,$2) AS id',
        ['scoring-entity:' + kind, kind + ':' + link.nativePlayerId]))[0].id)
        .toBe(deterministicUuid('scoring-entity:' + kind, kind + ':' + link.nativePlayerId));
      if (link.nativePlayerId !== ids.idp) expect(link.canonicalEntityId).toBe(deterministicUuid('scoring-entity:' + kind, kind + ':' + link.nativePlayerId));
    }
    expect(await connection.database.query('SELECT display_name,nfl_team FROM scoring_entities WHERE id=$1', [existing.value[0].entityId]))
      .toEqual([{ display_name: 'Preserved canonical metadata', nfl_team: 'BUF' }]);
    expect(await connection.database.query("SELECT external_id FROM external_scoring_entity_ids WHERE provider='tank01' AND scoring_entity_id=ANY($1::uuid[])",
      [savedA.links.map(link => link.canonicalEntityId)])).toEqual([]);
    const reused = await jobs.upsertScoringEntities([{ key: 'later-projection:' + ids.odd, kind: 'player', displayName: 'Same Name', nflTeam: null,
      preserveExistingMetadata: true, providerIds: [{ provider: 'sleeper', externalId: ids.odd }] }]);
    expect(reused).toMatchObject({ kind: 'stored', value: [{ entityId: savedA.links[1].canonicalEntityId, conflict: false }] });
    await readOnly(async reader => {
      expect(await current(a, reader)).toEqual(readA); expect(await links(a, readA.receipt.id, reader)).toEqual(savedA);
      expect(await reader.readRosterPlayerLinks({ rosterReceiptId: readA.receipt.id, leagueSeasonId: b.leagueSeasonId })).toMatchObject({ status: 'missing' });
    });
  }, 90_000);

  it('freezes corrections transfers categories unchanged captures and exact replay while partial data preserves history', async () => {
    const f = await fixture(); await write(f); const first = await current(f), historical = await links(f, first.receipt.id);
    const changed = roster(); changed[0].players = [ids.idp, ids.reserve]; changed[0].starters = ['0', ids.reserve];
    changed[0].reserve = [ids.idp]; changed[0].taxi = [];
    changed[1].players = [ids.odd, ids.defense]; changed[1].starters = [ids.defense];
    await write(f, changed); const moved = await current(f), movedLinks = await links(f, moved.receipt.id);
    expect(movedLinks.links.find(link => link.nativePlayerId === ids.odd)?.seasonTeamId).toBe(first.teams[1].seasonTeamId);
    expect(movedLinks.links.find(link => link.nativePlayerId === ids.odd)?.canonicalEntityId).toBe(historical.links[1].canonicalEntityId);
    expect(moved.teams[0].currentGroups.starters.value?.[1].membership?.canonicalEntityId).toBe(historical.links[4].canonicalEntityId);
    expect(moved.teams.flatMap(team => team.players).every(player => player.effectiveFrom === null && player.effectiveTo === null)).toBe(true);
    const owner = await claim();
    try {
      const attempt = await store.beginRosterAttempt(f.mapping, randomUUID(), CURRENT_ROSTER_POLICY, owner.fence);
      const input = await capture(f, changed);
      const result = await store.recordObservation(input, owner.fence, f.mapping, { attempt, population: f.population });
      const same = await current(f), snapshot = await links(f, same.receipt.id), before = await state(f);
      expect(same.accepted.contentId).toBe(moved.accepted.contentId); expect(same.receipt.id).not.toBe(moved.receipt.id);
      expect(snapshot.rosterSource).toEqual(input.envelope.provenance);
      expect((await store.recordObservation(input, owner.fence, f.mapping, { attempt, population: f.population })).rosterAcceptance).toEqual(result.rosterAcceptance);
      expect(await links(f, same.receipt.id)).toEqual(snapshot); expect(await state(f)).toEqual(before);
    } finally { await owner.finish(); }
    const lastGood = await current(f);
    for (const payload of [[{ roster_id: 1, players: [] }], [{ roster_id: 1, players: [ids.idp], starters: 7 }, { roster_id: 2, players: [] }]] as JsonValue[]) {
      expect((await write(f, payload)).result.rosterAcceptance?.status).toBe('preserved'); expect(await current(f)).toEqual(lastGood);
    }
    const groupOnly: JsonValue = [{ roster_id: 1, players: [ids.idp, ids.reserve], starters: [], reserve: null },
      { roster_id: 2, players: [ids.odd, ids.defense], starters: [ids.odd], reserve: [], taxi: [] }];
    await write(f, groupOnly); const groups = await current(f), groupLinks = await links(f, groups.receipt.id);
    expect(groupLinks.teams[0].categories).toMatchObject({ starters: { state: 'empty' }, reserve: { state: 'null' }, taxi: { state: 'missing' } });
    // A corrected mapping must not delete the old canonical identity referenced by history.
    const oldOdd = historical.links.find(link => link.nativePlayerId === ids.odd)!.canonicalEntityId;
    const correctedOdd = randomUUID();
    await ownerQuery("INSERT INTO scoring_entities(id,kind,display_name) VALUES($1,'player','Corrected canonical premise')", [correctedOdd]);
    await ownerQuery("UPDATE external_scoring_entity_ids SET scoring_entity_id=$1 WHERE provider='sleeper' AND entity_kind='player' AND external_id=$2", [correctedOdd, ids.odd]);
    const correction = await createProjectionStore(connection.database).upsertScoringEntities([{ key: 'player:' + ids.odd,
      kind: 'player', displayName: 'Correction reuse', nflTeam: null, preserveExistingMetadata: true,
      providerIds: [{ provider: 'sleeper', externalId: ids.odd }] }]);
    expect(correction).toMatchObject({ kind: 'stored', value: [{ entityId: correctedOdd, conflict: false }] });
    expect(await connection.database.query('SELECT id FROM scoring_entities WHERE id=$1', [oldOdd])).toEqual([{ id: oldOdd }]);
    await write(f, groupOnly);
    expect((await current(f)).teams[1].players[0].canonicalEntityId).toBe(correctedOdd);
    expect(await links(f, first.receipt.id)).toEqual(historical);
    await ownerQuery("UPDATE external_scoring_entity_ids SET scoring_entity_id=$1 WHERE provider='sleeper' AND entity_kind='player' AND external_id=$2", [oldOdd, ids.odd]);
    await directory({ ...native, [ids.odd]: { player_id: ids.odd, position: 'DEF' } });
    expect(await links(f, first.receipt.id)).toEqual(historical);
    await write(f, [{ roster_id: 1, players: [], starters: [], reserve: [], taxi: [] }, { roster_id: 2, players: [] }]);
    const empty = await current(f), emptyLinks = await links(f, empty.receipt.id);
    expect(emptyLinks).toMatchObject({ outcome: 'complete', counts: { held: 0, resolved: 0 }, links: [] });
    expect(empty.teams.every(team => team.players.length === 0)).toBe(true); expect(await links(f, moved.receipt.id)).toEqual(movedLinks);
    await directory();
  }, 120_000);

  it('retains explicit unresolved mapping kind vacancy and oversized native identifier evidence without name inference', async () => {
    const cases = ['unverified', 'retired', 'future', 'expired', 'wrong-kind', 'cross-kind', 'same-a', 'same-b'] as const;
    const entries = Object.fromEntries(cases.map(name => [prefix + '-' + name, { player_id: prefix + '-' + name, position: 'LB' }]));
    const wrappedDefense = prefix + '-wrapped-defense', blankKind = prefix + '-blank-kind', foreign = prefix + '-foreign';
    await directory({ ...native, ...entries,
      [wrappedDefense]: { player_id: wrappedDefense, position: '\t DEF \n' },
      [blankKind]: { player_id: blankKind, position: '\u00a0\t\n', fantasy_positions: [] },
      [foreign]: { player_id: foreign, position: 'LB' } });
    const nativeKinds = await fixture();
    await write(nativeKinds, [{ roster_id: 1, players: [wrappedDefense, blankKind] }, { roster_id: 2, players: [] }]);
    const nativeRead = await current(nativeKinds), nativeLinks = await links(nativeKinds, nativeRead.receipt.id);
    expect(nativeLinks.links[0]).toMatchObject({ entityKind: 'team_defense', identityState: 'resolved' });
    expect(nativeLinks.links[1].reasons).toContain('kind_unavailable');
    for (const claimedLeague of ['foreign-league', null, Number(nativeKinds.externalLeagueId)]) {
      await write(nativeKinds, [{ roster_id: 1, league_id: claimedLeague, players: [foreign] }, { roster_id: 2, players: [] }]);
      const wrongSource = await current(nativeKinds), wrongLinks = await links(nativeKinds, wrongSource.receipt.id);
      expect(wrongLinks.links[0].reasons).toContain('roster_source_scope_conflict');
      expect(wrongSource.teams[0].players[0].canonicalEntityId).toBeNull();
      expect(await connection.database.query("SELECT 1 FROM external_scoring_entity_ids WHERE provider='sleeper' AND external_id=$1", [foreign])).toEqual([]);
    }
    await write(nativeKinds, [{ roster_id: 1, league_id: nativeKinds.externalLeagueId, players: [foreign] }, { roster_id: 2, players: [] }]);
    expect((await current(nativeKinds)).teams[0].players[0].identityState).toBe('resolved');
    const shared = randomUUID();
    for (const name of cases) {
      const entityId = name.startsWith('same-') ? shared : randomUUID(), kind = name === 'wrong-kind' ? 'team_defense' : 'player';
      await ownerQuery(`INSERT INTO scoring_entities(id,kind,display_name) VALUES($1,$2,'Synthetic mapping premise') ON CONFLICT DO NOTHING`, [entityId, kind]);
      await ownerQuery(`INSERT INTO external_scoring_entity_ids(provider,entity_kind,external_id,scoring_entity_id,mapping_status,valid_from,valid_to)
        VALUES('sleeper','player',$1,$2,$3,clock_timestamp()+$4::interval,
          CASE WHEN $5::boolean THEN clock_timestamp()-interval '1 minute' ELSE NULL END)`,
      [prefix + '-' + name, entityId, ['unverified', 'retired'].includes(name) ? name : 'verified', name === 'future' ? '1 hour' : '-2 hours', name === 'expired']);
      if (name === 'cross-kind') {
        const defenseId = randomUUID();
        await ownerQuery("INSERT INTO scoring_entities(id,kind,display_name) VALUES($1,'team_defense','Synthetic opposite-kind premise')", [defenseId]);
        await ownerQuery("INSERT INTO external_scoring_entity_ids(provider,entity_kind,external_id,scoring_entity_id) VALUES('sleeper','team_defense',$1,$2)", [prefix + '-' + name, defenseId]);
      }
    }
    const huge = 'x'.repeat(12_000), f = await fixture();
    const held = [ids.missing, ids.kindless, ids.mixed, '0', huge, ...cases.map(name => prefix + '-' + name)];
    await write(f, [{ roster_id: 1, players: held, starters: ['0', ids.missing], reserve: [ids.missing], taxi: [ids.missing] }, { roster_id: 2, players: [] }]);
    const read = await current(f), saved = await links(f, read.receipt.id);
    expect(read.teams[0].players.map(player => player.sourceEntity.nativeId)).toEqual(held);
    expect(saved.links.every(link => link.canonicalEntityId === null)).toBe(true);
    const reason = (id: string, expected: string) => expect(saved.links.find(link => link.nativePlayerId === id)?.reasons).toContain(expected);
    reason(ids.missing, 'directory_player_missing'); reason(ids.kindless, 'kind_unavailable'); reason(ids.mixed, 'kind_conflict');
    reason('0', 'vacancy_marker_not_player'); reason(huge, 'native_player_id_invalid');
    reason(prefix + '-unverified', 'canonical_mapping_unverified'); reason(prefix + '-retired', 'canonical_mapping_retired');
    reason(prefix + '-future', 'canonical_mapping_not_yet_valid'); reason(prefix + '-expired', 'canonical_mapping_expired');
    reason(prefix + '-wrong-kind', 'canonical_identity_conflict'); reason(prefix + '-cross-kind', 'canonical_kind_conflict');
    reason(prefix + '-same-a', 'canonical_identity_conflict'); reason(prefix + '-same-b', 'canonical_identity_conflict');
    const first = saved.links.find(link => link.nativePlayerId === prefix + '-unverified')!;
    await ownerQuery("UPDATE external_scoring_entity_ids SET mapping_status='verified' WHERE provider='sleeper' AND external_id=$1", [first.nativePlayerId]);
    expect(await links(f, read.receipt.id)).toEqual(saved);
    await write(f, [{ roster_id: 1, players: [first.nativePlayerId] }, { roster_id: 2, players: [] }]);
    expect((await current(f)).teams[0].players[0].canonicalEntityId).toBe(first.mappingProof[0].scoringEntityId);
    await directory();
  }, 120_000);

  it('pins accepted head ordering through failed attempts and source mapping changes without reinterpreting history', async () => {
    const f = await fixture(); await write(f); const first = await current(f), historical = await links(f, first.receipt.id);
    for (const latestFirst of [false, true]) {
      const owner = await claim();
      try {
        const older = await store.beginRosterAttempt(f.mapping, randomUUID(), CURRENT_ROSTER_POLICY, owner.fence);
        const latest = await store.beginRosterAttempt(f.mapping, randomUUID(), CURRENT_ROSTER_POLICY, owner.fence);
        const staleInput = await capture(f, [{ roster_id: 1, players: [ids.idp] }, { roster_id: 2, players: [] }]);
        const currentInput = await capture(f, [{ roster_id: 1, players: [ids.defense] }, { roster_id: 2, players: [] }]);
        const commit = (newest: boolean) => store.recordObservation(newest ? currentInput : staleInput, owner.fence, f.mapping,
          { attempt: newest ? latest : older, population: f.population });
        const results = latestFirst ? [await commit(true), await commit(false)] : [await commit(false), await commit(true)];
        expect(results.filter(result => result.rosterAcceptance?.status === 'accepted')).toHaveLength(1);
        expect((await current(f)).teams[0].players.map(player => player.sourceEntity.nativeId)).toEqual([ids.defense]);
      } finally { await owner.finish(); }
    }
    const lastGood = await current(f);
    await write(f, [{ roster_id: 1, players: [] }], { completeness: 'partial' }); expect(await current(f)).toEqual(lastGood);
    const target = 'remapped-' + randomUUID();
    await ownerQuery("SELECT public.revise_league_source_connection($1,'sleeper',$2,$3,'CP6 synthetic A to B')", [f.leagueSeasonId, f.mapping.revisionId, target]);
    const bMapping = await store.readSourceMapping(target); if (!bMapping) throw new Error('Missing remap B.');
    const b = { ...f, externalLeagueId: target, mapping: bMapping, population: await population({ ...f, externalLeagueId: target }) };
    await write(b, [{ roster_id: 1, players: [ids.odd] }, { roster_id: 2, players: [] }]); const readB = await current(b);
    await ownerQuery("SELECT public.revise_league_source_connection($1,'sleeper',$2,$3,'CP6 synthetic B to A')", [f.leagueSeasonId, bMapping.revisionId, f.externalLeagueId]);
    const aMapping = await store.readSourceMapping(f.externalLeagueId); if (!aMapping) throw new Error('Missing remap A.');
    const restored = { ...f, mapping: aMapping, population: await population(f) };
    await write(restored); expect(aMapping.revisionId).not.toBe(f.mapping.revisionId);
    await readOnly(async reader => {
      expect(await links(f, first.receipt.id, reader)).toEqual(historical);
      expect((await links(b, readB.receipt.id, reader)).mapping.revisionId).toBe(bMapping.revisionId);
    });
  }, 120_000);

  it('reuses the winning canonical identity after a real concurrent first writer commits', async () => {
    const id = prefix + '-race'; await directory({ ...native, [id]: { player_id: id, position: 'LB' } });
    const f = await fixture(), blocker = await createPinnedIntegrationDatabase('runtime'), writer = await createPinnedIntegrationDatabase('runtime');
    let pending: Promise<unknown> | undefined; const owner = await claim();
    try {
      const attempt = await store.beginRosterAttempt(f.mapping, randomUUID(), CURRENT_ROSTER_POLICY, owner.fence);
      const input = await capture(f, [{ roster_id: 1, players: [id] }, { roster_id: 2, players: [] }]);
      const [blockerPid] = await blocker.database.query('SELECT pg_backend_pid() AS pid'), [writerPid] = await writer.database.query('SELECT pg_backend_pid() AS pid');
      await blocker.database.query('BEGIN');
      const winner = await createProjectionStore(blocker.database).upsertScoringEntities([{ key: 'concurrent-winner:' + id,
        kind: 'player', displayName: 'Concurrent identity', nflTeam: null, providerIds: [{ provider: 'sleeper', externalId: id }] }]);
      if (winner.kind !== 'stored') throw new Error('Missing concurrent canonical winner.');
      let settled = false;
      pending = createLeagueAdministrationStore(writer.database).recordObservation(input, owner.fence, f.mapping, { attempt, population: f.population })
        .finally(() => { settled = true; });
      let blocked = false;
      for (let index = 0; index < 80; index++) {
        const [row] = await blocker.database.query('SELECT $1::int=ANY(pg_blocking_pids($2::int)) AS blocked', [blockerPid.pid, writerPid.pid]);
        if (row.blocked) { blocked = true; break; } await delay(25);
      }
      expect(blocked).toBe(true); expect(settled).toBe(false); await blocker.database.query('COMMIT'); await pending;
      expect((await current(f)).teams[0].players[0].canonicalEntityId).toBe(winner.value[0].entityId);
      expect(await connection.database.query('SELECT id FROM scoring_entities WHERE id=$1', [deterministicUuid('scoring-entity:player', 'player:' + id)]))
        .toEqual([]);
    } finally {
      await blocker.database.query('ROLLBACK').catch(() => undefined); await pending?.catch(() => undefined);
      await owner.finish(); await writer.close(); await blocker.close();
    }
    // Preserve the legacy identity owner's post-wait validity semantics.
    const expiryFixture = await fixture(), expiryOwner = await claim();
    const expiryBlocker = await createPinnedIntegrationDatabase('owner'), expiryWriter = await createPinnedIntegrationDatabase('runtime');
    let expiryPending: Promise<unknown> | undefined;
    try {
      const attempt = await store.beginRosterAttempt(expiryFixture.mapping, randomUUID(), CURRENT_ROSTER_POLICY, expiryOwner.fence);
      const input = await capture(expiryFixture, [{ roster_id: 1, players: [id] }, { roster_id: 2, players: [] }]);
      const [mapping] = await ownerQuery(`UPDATE external_scoring_entity_ids SET valid_to=clock_timestamp()+interval '8 seconds'
        WHERE provider='sleeper' AND entity_kind='player' AND external_id=$1 RETURNING scoring_entity_id,valid_to`, [id]);
      const [blockerPid] = await expiryBlocker.database.query('SELECT pg_backend_pid() AS pid');
      const [writerPid] = await expiryWriter.database.query('SELECT pg_backend_pid() AS pid');
      await expiryBlocker.database.query('BEGIN');
      await expiryBlocker.database.query('SELECT id FROM scoring_entities WHERE id=$1 FOR UPDATE', [mapping.scoring_entity_id]);
      let settled = false;
      expiryPending = createLeagueAdministrationStore(expiryWriter.database).recordObservation(input, expiryOwner.fence,
        expiryFixture.mapping, { attempt, population: expiryFixture.population }).finally(() => { settled = true; });
      let blocked = false;
      for (let index = 0; index < 80; index++) {
        const [row] = await expiryBlocker.database.query('SELECT $1::int=ANY(pg_blocking_pids($2::int)) AS blocked', [blockerPid.pid, writerPid.pid]);
        if (row.blocked) { blocked = true; break; } await delay(25);
      }
      expect(blocked).toBe(true); expect(settled).toBe(false);
      await expiryBlocker.database.query("SELECT pg_sleep(GREATEST(0,EXTRACT(EPOCH FROM ($1::timestamptz-clock_timestamp())))+0.05)", [mapping.valid_to]);
      await expiryBlocker.database.query('COMMIT'); await expiryPending;
      const expired = await current(expiryFixture), frozen = await links(expiryFixture, expired.receipt.id);
      expect(frozen.links[0].canonicalEntityId).toBeNull();
      expect(frozen.links[0].reasons).toContain('canonical_mapping_expired');
      expect(Date.parse(frozen.mappingEvaluatedAt)).toBeGreaterThanOrEqual(new Date(String(mapping.valid_to)).getTime());
      expect(frozen.links[0].mappingProof[0].mappingStatus).toBe('verified');
    } finally {
      await expiryBlocker.database.query('ROLLBACK').catch(() => undefined); await expiryPending?.catch(() => undefined);
      await expiryOwner.finish(); await expiryWriter.close(); await expiryBlocker.close();
    }
    await directory();
  }, 90_000);

  it('rolls back canonical writes links and acceptance when an observed identity lock outlives deadline or lease', async () => {
    for (const expiry of ['deadline', 'lease'] as const) {
      const id = prefix + '-late-' + expiry;
      const blockedId = deterministicUuid('scoring-entity:player', 'player:' + id);
      const fresh = Array.from({ length: 4_096 }, (_, index) => prefix + '-orphan-' + expiry + '-' + index)
        .find(candidate => deterministicUuid('scoring-entity:player', 'player:' + candidate) < blockedId);
      if (!fresh) throw new Error('Could not construct a bounded earlier canonical insert.');
      // The shared INSERT orders target UUIDs; this fresh row is inserted before the observed blocked row.
      expect(deterministicUuid('scoring-entity:player', 'player:' + fresh) < blockedId).toBe(true);
      await directory({ ...native, [id]: { player_id: id, position: 'LB' }, [fresh]: { player_id: fresh, position: 'LB' } });
      const f = await fixture(); await write(f);
      const seeded = await createProjectionStore(connection.database).upsertScoringEntities([{ key: 'player:' + id,
        kind: 'player', displayName: 'Identity lock fixture', nflTeam: null, providerIds: [{ provider: 'sleeper', externalId: id }] }]);
      if (seeded.kind !== 'stored') throw new Error('Missing blocking identity.');
      const blocker = await createPinnedIntegrationDatabase('owner'), writer = await createPinnedIntegrationDatabase('runtime');
      const owner = await claim({ deadlineMs: expiry === 'deadline' ? 8_000 : 20_000, leaseSeconds: expiry === 'lease' ? 8 : 25 });
      let pending: Promise<{ error?: unknown }> | undefined;
      try {
        const attempt = await store.beginRosterAttempt(f.mapping, randomUUID(), CURRENT_ROSTER_POLICY, owner.fence);
        const input = await capture(f, [{ roster_id: 1, players: [fresh, id] }, { roster_id: 2, players: [] }]);
        const before = await state(f), prior = await current(f);
        const [blockerPid] = await blocker.database.query('SELECT pg_backend_pid() AS pid'), [writerPid] = await writer.database.query('SELECT pg_backend_pid() AS pid');
        await blocker.database.query('BEGIN');
        await blocker.database.query('SELECT id FROM scoring_entities WHERE id=$1 FOR UPDATE', [seeded.value[0].entityId]);
        let settled = false;
        pending = createLeagueAdministrationStore(writer.database).recordObservation(input, owner.fence, f.mapping, { attempt, population: f.population })
          .then(() => ({}), error => ({ error })).finally(() => { settled = true; });
        let blocked = false;
        for (let index = 0; index < 80; index++) {
          const [row] = await blocker.database.query('SELECT $1::int=ANY(pg_blocking_pids($2::int)) AS blocked', [blockerPid.pid, writerPid.pid]);
          if (row.blocked) { blocked = true; break; } await delay(25);
        }
        expect(blocked).toBe(true); expect(settled).toBe(false);
        const [limit] = await blocker.database.query(`SELECT CASE WHEN $2::boolean THEN $3::timestamptz ELSE lease_until END AS at
          FROM projection_jobs WHERE job_key=$1`, [owner.fence.jobKey, expiry === 'deadline', owner.fence.deadlineAt]);
        await blocker.database.query("SELECT pg_sleep(GREATEST(0,EXTRACT(EPOCH FROM ($1::timestamptz-clock_timestamp())))+0.05)", [limit.at]);
        await blocker.database.query('COMMIT'); expect(String((await pending).error)).toMatch(/fence|expired|lease/iu);
        expect(await state(f)).toEqual(before); expect(await current(f)).toEqual(prior);
        expect(await connection.database.query('SELECT id FROM scoring_entities WHERE id=$1', [deterministicUuid('scoring-entity:player', 'player:' + fresh)]))
          .toEqual([]);
      } finally {
        await blocker.database.query('ROLLBACK').catch(() => undefined); await pending;
        await owner.finish(); await writer.close(); await blocker.close();
      }
    }
    await directory();
  }, 120_000);

  it('keeps capacity outcomes explicit and denies history mutation while preserving runtime identity permissions', async () => {
    const f = await fixture(), many = Array.from({ length: 10_001 }, (_, index) => prefix + '-capacity-' + index);
    const before = await state(f); await write(f, [{ roster_id: 1, players: many }, { roster_id: 2, players: [] }]);
    const read = await current(f);
    expect(read.teams[0].players).toHaveLength(10_001);
    expect(read.playerLinks).toMatchObject({ status: 'capacity_exceeded', counts: { held: 10_001, teams: 2 } });
    expect((await state(f))[0].entities).toBe(before[0].entities);
    expect(await connection.database.query(`SELECT count(*)::int AS count FROM league_roster_player_links l
      JOIN league_roster_player_link_receipts r USING(roster_acceptance_id) WHERE r.roster_receipt_id=$1`, [read.receipt.id])).toEqual([{ count: 0 }]);
    const teams = await fixture(1_001);
    await write(teams, Array.from({ length: 1_001 }, (_, index) => ({ roster_id: index + 1, players: [] })));
    expect((await current(teams)).playerLinks).toMatchObject({ status: 'capacity_exceeded', counts: { teams: 1_001, held: 0 } });
    const wide = prefix + '-wide-kind';
    await directory({ ...native, [wide]: { player_id: wide, position: 'P'.repeat(70_000) } });
    const wideTeams = await fixture(150), beforeWide = await state(wideTeams);
    await write(wideTeams, Array.from({ length: 150 }, (_, index) => ({ roster_id: index + 1, players: [wide] })));
    expect((await current(wideTeams)).playerLinks).toMatchObject({ status: 'capacity_exceeded', counts: { teams: 150, held: 150 } });
    expect((await state(wideTeams))[0].entities).toBe(beforeWide[0].entities);
    await directory();
    for (const table of ['league_roster_player_link_receipts', 'league_roster_player_links']) {
      expect((await connection.database.query(`SELECT has_table_privilege(current_user,$1,'SELECT') AS readable,
        has_table_privilege(current_user,$1,'INSERT') AS insertable,has_table_privilege(current_user,$1,'UPDATE') AS updatable,
        has_table_privilege(current_user,$1,'DELETE') AS deletable`, ['public.' + table]))[0])
        .toEqual({ readable: true, insertable: false, updatable: false, deletable: false });
      await expect(connection.database.query('DELETE FROM public.' + table)).rejects.toThrow(/permission denied/iu);
    }
    await expect(ownerQuery('DELETE FROM public.league_roster_player_link_receipts WHERE roster_receipt_id=$1', [read.receipt.id]))
      .rejects.toThrow(/immutable|append.only/iu);
    const [helper] = await connection.database.query(`SELECT p.prosecdef,
      has_function_privilege(current_user,p.oid,'EXECUTE') AS callable,
      EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS public_execute
      FROM pg_proc p WHERE p.oid='public.upsert_scoring_entity_identities(jsonb)'::regprocedure`);
    expect(helper).toEqual({ prosecdef: false, callable: true, public_execute: false });
    for (const signature of ['public.validate_roster_player_link_lineage()', 'public.assert_roster_player_link_fence(jsonb)', 'public.capture_roster_player_links()']) {
      expect((await connection.database.query(`SELECT has_function_privilege(current_user,$1,'EXECUTE') AS executable,
        EXISTS(SELECT 1 FROM pg_proc p,aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
          WHERE p.oid=$1::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE') AS public_execute`, [signature]))[0])
        .toEqual({ executable: false, public_execute: false });
    }
    await expect(connection.database.query("SELECT public.assert_roster_player_link_fence(NULL)")).rejects.toThrow(/permission denied/iu);
    await expect(ownerQuery('UPDATE public.league_roster_player_links SET native_player_id=native_player_id')).rejects.toThrow(/immutable|append.only/iu);
    const provisioner = await readFile(new URL('../scripts/provision-runtime-role.sql', import.meta.url), 'utf8');
    const block = provisioner.match(/-- BEGIN OPTIONAL ROSTER PLAYER LINKS GRANTS([\s\S]*?)-- END OPTIONAL ROSTER PLAYER LINKS GRANTS/u)?.[1];
    if (!block) throw new Error('Missing maintained CP6 optional grant block.');
    let restored = false;
    try {
      await ownerQuery('REVOKE SELECT ON public.league_roster_player_links FROM league_one_runtime');
      await ownerQuery('REVOKE EXECUTE ON FUNCTION public.upsert_scoring_entity_identities(jsonb) FROM league_one_runtime');
      await expect(connection.database.query('SELECT 1 FROM public.league_roster_player_links LIMIT 1')).rejects.toThrow(/permission denied/iu);
      await expect(connection.database.query("SELECT public.upsert_scoring_entity_identities('[]'::jsonb)")).rejects.toThrow(/permission denied/iu);
      await ownerQuery(block); await ownerQuery(block); restored = true;
      expect(await connection.database.query("SELECT public.upsert_scoring_entity_identities('[]'::jsonb)->'rows' AS rows")).toEqual([{ rows: [] }]);
      expect(await store.readRosterPlayerLinks({ rosterReceiptId: read.receipt.id, leagueSeasonId: f.leagueSeasonId })).toMatchObject({ status: 'capacity_exceeded' });
    } finally { if (!restored) await ownerQuery(block); }
  }, 120_000);

  it('stores and reads linked membership through ordinary public intake and one real refresh cycle', async () => {
    await directory();
    const id = randomUUID(), manager = '9' + BigInt('0x' + randomUUID().replaceAll('-', '').slice(0, 15));
    const external = '8' + BigInt('0x' + randomUUID().replaceAll('-', '').slice(0, 15)), username = 'cp6_manager_' + manager;
    const league = { league_id: external, season: '2026', sport: 'nfl', name: 'CP6 ordinary DATA league', total_rosters: 1,
      settings: {}, scoring_settings: {}, roster_positions: ['IDP', 'BN'] };
    let held = [ids.idp], requests = 0; const requestUrls: string[] = [];
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input); requests++; requestUrls.push(url);
      if (url === 'https://api.sleeper.app/v1/user/' + username || url === 'https://api.sleeper.app/v1/user/' + manager) return new Response(JSON.stringify({ user_id: manager, username }));
      if (url === 'https://api.sleeper.app/v1/user/' + manager + '/leagues/nfl/2026') return new Response(JSON.stringify([league]));
      if (url === 'https://api.sleeper.app/v1/league/' + external) return new Response(JSON.stringify(league));
      if (url === 'https://api.sleeper.app/v1/league/' + external + '/rosters') return new Response(JSON.stringify([
        { roster_id: 1, owner_id: manager, players: held, starters: held, reserve: [], taxi: [] }]));
      if (url === 'https://api.sleeper.app/v1/league/' + external + '/users') return new Response(JSON.stringify([{ user_id: manager, display_name: 'CP6 manager' }]));
      throw new Error('Unexpected CP6 ordinary provider scope.');
    });
    const intake = createPublicIntakeStore(connection.database), refresh = createPublicDataRefreshStore(connection.database);
    const dependencies = { intake, administration: store, jobs: createProjectionStore(connection.database), managerEvidenceVersion: 'v2' as const };
    let target: { targetId: string; configurationRevision: number } | undefined;
    const configuration = { id: randomUUID(), expectedRevision: 0, identityRequestId: id, seasons: [2026], cadenceSeconds: 60,
      expiresAt: new Date(Date.now() + 25 * 60_000).toISOString(), paused: false };
    try {
      await intake.submit({ id, username, seasons: [2026] });
      const stages = ['identity', 'leagues', 'bootstrap', 'core', 'users'];
      async function progress(recurring: boolean) {
        for (const resource of stages) {
          const until = Date.now() + 150_000; let done = false;
          do {
            const outcome = recurring ? await runPublicDataRefreshStep({ ...dependencies, refresh }, AbortSignal.timeout(20_000))
              : await runPublicIntakeStep(id, dependencies, AbortSignal.timeout(20_000));
            if (['busy', 'backoff', 'idle'].includes(outcome.status)) { await delay(1_000); continue; }
            expect(outcome).toMatchObject({ status: 'progress', resource, providerRequests: resource === 'core' ? 2 : 1 });
            done = true; break;
          } while (Date.now() < until);
          expect(done).toBe(true);
        }
      }
      await progress(false); expect(await intake.next(id)).toBe('complete'); expect(requests).toBe(6);
      const mapping = await store.readSourceMapping(external); if (!mapping) throw new Error('Ordinary CP6 mapping missing.');
      const first = await store.readAcceptedCurrentRoster(mapping, { includePlayerLinks: true });
      if (first.status !== 'available') throw new Error('Missing ordinary CP6 roster.');
      expect(first.teams[0].players[0].identityState).toBe('resolved');
      const saved = await store.readRosterPlayerLinks({ rosterReceiptId: first.receipt.id, leagueSeasonId: mapping.leagueSeasonId });
      target = await refresh.configure(configuration); held = [ids.defense];
      await progress(true); expect(requests).toBe(12);
      expect(requestUrls[6]).toBe('https://api.sleeper.app/v1/user/' + manager); fetch.mockRestore();
      await readOnly(async (reader, database) => {
        const result = await readPublicDataRefresh(database, reader, target!.targetId, { managerEvidenceVersion: 'v2' });
        expect(result).toMatchObject({ status: 'available', intake: { leagues: [{ resources: { heldRoster: {
          status: 'available', playerLinks: { status: 'available', outcome: 'complete' }, teams: [{ players: [{ identityState: 'resolved' }] }] } } }] } });
        expect(await reader.readRosterPlayerLinks({ rosterReceiptId: first.receipt.id, leagueSeasonId: mapping.leagueSeasonId })).toEqual(saved);
        expect(await readPublicSleeperIntake(database, reader, id, { managerEvidenceVersion: 'v2' }))
          .toMatchObject({ leagues: [{ resources: { heldRoster: { status: 'unavailable', reason: 'intake-capture-not-current-head' } } }] });
      });
    } finally {
      fetch.mockRestore();
      if (target) await refresh.configure({ ...configuration, expectedRevision: target.configurationRevision,
        expiresAt: new Date(Date.now() + 60_000).toISOString(), paused: true });
    }
  }, 15 * 60_000);
});
