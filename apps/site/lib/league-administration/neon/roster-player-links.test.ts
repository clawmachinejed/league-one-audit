import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseClient, DatabaseRow } from '../../database';
import { CURRENT_ROSTER_POLICY, currentRosterScope } from '../../aggregator/current-roster';
import { ROSTER_PLAYER_LINK_VERSION } from '../../aggregator/roster-player-links';
import { normalizeAdministrationObservation } from '../normalize';
import type { AdministrationEnvelope, JsonObject } from '../contracts';
import type { AdministrationSourceMapping } from '../source-mapping';
import { rosterPlayerLinkMethods, ROSTER_PLAYER_LINK_READ_SQL } from './roster-player-links';

vi.mock('server-only', () => ({}));
afterEach(() => vi.unstubAllGlobals());
const uuid = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const mapping: AdministrationSourceMapping = { connectionId: uuid(1), leagueSeasonId: uuid(2), revisionId: uuid(3), generation: 1,
  scope: { leagueKey: 'fixture', provider: 'sleeper', externalLeagueId: 'league-exact', season: 2026 } };
const provenance: AdministrationEnvelope['provenance'] = { origin: 'network', requestStartedAt: '2026-10-01T01:00:00.000Z',
  requestCompletedAt: '2026-10-01T01:00:01.000Z', sourceObservedAt: '2026-10-01T01:00:01.000Z', checkedAt: '2026-10-01T01:00:01.000Z' };
const payload: readonly JsonObject[] = [{ roster_id: 1, players: ['001', 'NYJ', 'missing', '0'], starters: ['001', '0'], reserve: null, taxi: [] },
  { roster_id: 2, players: [], reserve: [] }];
const selection = { rosterReceiptId: uuid(4), leagueSeasonId: mapping.leagueSeasonId };
function directory() {
  const sourceRevision = `sha256:${'a'.repeat(64)}`, observedAt = '2026-09-30T12:00:01.000Z';
  return { versionId: uuid(10), contentId: uuid(11), receiptId: uuid(12), attemptId: uuid(13), generation: 2, acceptedAt: '2026-09-30T12:00:02.000Z',
    sourceRevision, requestStartedAt: '2026-09-30T12:00:00.000Z', requestCompletedAt: observedAt, sourceObservedAt: observedAt,
    rowCount: 2, sourceSlices: [{ scope: 'all', endpoint: '/players/nfl', status: 'available', sourceRevision, observedAt,
      complete: true, rowCount: 2, validRowCount: 2, invalidRowCount: 0, conflictRowCount: 0 }] };
}
function proof(id: string, kind: string, target: string) {
  return { provider: 'sleeper', entityKind: kind, externalId: id, scoringEntityId: target, mappingStatus: 'verified',
    validFrom: '2026-09-01T00:00:00.000Z', validTo: null, canonicalKind: kind };
}
function storedRow(raw: readonly JsonObject[] = payload): Record<string, unknown> {
  const normalized = normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1',
    dialect: 'sleeper-nfl-v1', scope: mapping.scope, family: 'rosters', week: null, completeness: 'complete', provenance, payload: raw }, { expectedRosterCount: 2 });
  const links = ['001', 'NYJ', 'missing', '0'].map((nativePlayerId, index) => ({ seasonTeamId: uuid(20), externalRosterId: '1', nativePlayerId,
    membershipOrdinal: index + 1, entityKind: index === 0 ? 'player' : index === 1 ? 'team_defense' : null,
    identityState: index < 2 ? 'resolved' : 'unresolved', canonicalEntityId: index < 2 ? uuid(30 + index) : null,
    reasons: index < 2 ? [] : [index === 2 ? 'directory_player_missing' : 'vacancy_marker_not_player'],
    directoryIdentityStatus: index < 2 ? 'valid' : 'missing', kindEvidence: index < 2 ? {
      position: index === 0 ? 'LB' : 'DEF', fantasyPositions: null, positionState: 'supplied', fantasyPositionsState: 'missing' } : null,
    mappingProof: index < 2 ? [proof(nativePlayerId, index === 0 ? 'player' : 'team_defense', uuid(30 + index))] : [] }));
  return { storage_format: 'acceptance-v1', link_content_id: null, shared_content: null, legacy_links_present: true,
    roster_acceptance_id: uuid(5), roster_receipt_id: selection.rosterReceiptId, roster_content_id: uuid(6),
    league_season_id: mapping.leagueSeasonId, content_league_season_id: mapping.leagueSeasonId, source_mapping_revision_id: mapping.revisionId,
    link_version: ROSTER_PLAYER_LINK_VERSION, directory_version_id: uuid(10), resolved_at: '2026-10-01T01:00:03.000Z',
    mapping_evaluated_at: '2026-10-01T01:00:02.000Z', outcome: 'partial', reasons: ['unresolved_player_links'],
    held_count: 4, team_count: 2, resolved_count: 2, unresolved_count: 2, conflict_count: 0,
    generation: 1, identity: { scope: currentRosterScope(mapping), policy: CURRENT_ROSTER_POLICY }, connection_id: mapping.connectionId,
    provenance, coverage: { periodIds: [], interval: null, entitySet: 'full', fields: ['players'], pagination: 'complete', nextCursor: null, completeness: 'complete', reasons: [] },
    expected_team_count: 2, source_mapping: mapping, content_hash: normalized.contentHash, payload: raw, normalized_value: normalized.value,
    normalizer_version: 'sleeper-administration-v1', completeness: 'complete', provider: 'sleeper', external_league_id: mapping.scope.externalLeagueId,
    identities: [{ seasonTeamId: uuid(20), externalRosterId: '1' }, { seasonTeamId: uuid(21), externalRosterId: '2' }], links, directory: directory() };
}
/** Query-result double only; actual PostgreSQL canonical JSONB hashing is proved in integration. */
function sharedRow(row = storedRow()): Record<string, unknown> {
  const shared = structuredClone(row);
  const omitted = shared.outcome === 'capacity_exceeded' || shared.outcome === 'owner_unqualified';
  Object.assign(shared, { storage_format: 'shared-v1', link_content_id: omitted ? null : uuid(50), legacy_links_present: false,
    computed_link_content_hash: 'a'.repeat(64), shared_content: omitted ? null : {
      id: uuid(50), leagueSeasonId: shared.league_season_id, sourceMappingRevisionId: shared.source_mapping_revision_id,
      directoryVersionId: shared.directory_version_id, linkVersion: shared.link_version, storageVersion: 'shared-roster-player-links-v1',
      contentHash: 'a'.repeat(64), firstReceiptPresent: true, held: shared.held_count, resolved: shared.resolved_count,
      unresolved: shared.unresolved_count, conflict: shared.conflict_count } });
  return shared;
}
function fixture(row: DatabaseRow | null = storedRow()) {
  const query = vi.fn(async (sql: string, parameters?: readonly unknown[]) => {
    expect(sql).toBe(ROSTER_PLAYER_LINK_READ_SQL); expect(parameters).toEqual([selection.rosterReceiptId, selection.leagueSeasonId]);
    return row ? [row] : [];
  });
  const client = { enabled: true, query } as unknown as DatabaseClient;
  return { query, read: () => rosterPlayerLinkMethods(client).readRosterPlayerLinks(selection) };
}

describe('stored immutable roster player link reader', () => {
  it('returns exact IDP/defense links, missing rows, original dates and native category presence with one stored query', async () => {
    const fetch = vi.fn(() => { throw new Error('Provider forbidden.'); }); vi.stubGlobal('fetch', fetch);
    const f = fixture(); const result = await f.read();
    expect(result).toMatchObject({ status: 'available', outcome: 'partial', mapping, rosterSource: provenance,
      mappingEvaluatedAt: '2026-10-01T01:00:02.000Z', directory: { sourceObservedAt: '2026-09-30T12:00:01.000Z' },
      counts: { teams: 2, held: 4, resolved: 2, unresolved: 2, conflict: 0 }, links: [
        { nativePlayerId: '001', entityKind: 'player', canonicalEntityId: uuid(30), membershipOrdinal: 1 },
        { nativePlayerId: 'NYJ', entityKind: 'team_defense', canonicalEntityId: uuid(31) },
        { nativePlayerId: 'missing', reasons: ['directory_player_missing'] }, { nativePlayerId: '0', reasons: ['vacancy_marker_not_player'] }],
      teams: [{ categories: { reserve: { state: 'null' }, taxi: { state: 'empty' }, starters: { raw: ['001', '0'] } } },
        { categories: { players: { state: 'empty' }, starters: { state: 'missing' }, reserve: { state: 'empty' } } }] });
    expect(f.query).toHaveBeenCalledTimes(1); expect(fetch).not.toHaveBeenCalled();
    expect(ROSTER_PLAYER_LINK_READ_SQL).not.toMatch(/external_scoring_entity_ids|current_mapping_revision_id|resource_heads|directory_heads/);
    expect(ROSTER_PLAYER_LINK_READ_SQL).toContain('LIMIT 10001'); expect(ROSTER_PLAYER_LINK_READ_SQL).toContain('LIMIT 1001');
  });
  it('keeps the old receipt stable after a new membership correction and independently pinned directory version', async () => {
    const old = storedRow();
    const corrected = storedRow([{ ...payload[0], players: ['002', 'NYJ'], starters: ['002', '0'] }, payload[1]]);
    const previous = corrected.links as Array<Record<string, unknown>>;
    corrected.links = [{ ...previous[0], nativePlayerId: '002', canonicalEntityId: uuid(40),
      mappingProof: [proof('002', 'player', uuid(40))] }, previous[1]];
    Object.assign(corrected, { roster_receipt_id: uuid(44), roster_acceptance_id: uuid(45), roster_content_id: uuid(46), generation: 2,
      outcome: 'complete', reasons: [], held_count: 2, resolved_count: 2, unresolved_count: 0, directory_version_id: uuid(47),
      directory: { ...directory(), versionId: uuid(47), contentId: uuid(48), receiptId: uuid(49) } });
    const query = vi.fn(async (sql: string, parameters: readonly unknown[]) => {
      expect(sql).toBe(ROSTER_PLAYER_LINK_READ_SQL);
      expect(parameters[1]).toBe(mapping.leagueSeasonId);
      return parameters[0] === selection.rosterReceiptId ? [old] : parameters[0] === uuid(44) ? [corrected] : [];
    });
    const reader = rosterPlayerLinkMethods({ enabled: true, query } as unknown as DatabaseClient);
    const before = await reader.readRosterPlayerLinks(selection);
    const after = await reader.readRosterPlayerLinks({ ...selection, rosterReceiptId: uuid(44) });
    expect(after).toMatchObject({ status: 'available', outcome: 'complete', directory: { versionId: uuid(47) },
      links: [{ nativePlayerId: '002', canonicalEntityId: uuid(40) }, { nativePlayerId: 'NYJ' }] });
    expect(await reader.readRosterPlayerLinks(selection)).toEqual(before);
    expect(query).toHaveBeenCalledTimes(3);
  });
  it.each(['acceptance-v1', 'shared-v1'].flatMap(format =>
    ['native', 'ordinal', 'team', 'extra', 'missing', 'count', 'scope', 'mapping', 'content', 'kind', 'canonical', 'expired', 'unverified']
      .map(corruption => [format, corruption])))('rejects the entire %s %s-corrupted snapshot', async (format, corruption) => {
    const row = format === 'shared-v1' ? sharedRow() : storedRow(); const links = row.links as Array<Record<string, unknown>>;
    if (corruption === 'native') links[0].nativePlayerId = '1';
    if (corruption === 'ordinal') links[0].membershipOrdinal = 2;
    if (corruption === 'team') links[0].seasonTeamId = uuid(99);
    if (corruption === 'extra') links.push({ ...links[0] });
    if (corruption === 'missing') links.pop();
    if (corruption === 'count') row.resolved_count = 3;
    if (corruption === 'scope') row.league_season_id = uuid(99);
    if (corruption === 'mapping') row.source_mapping_revision_id = uuid(99);
    if (corruption === 'content') row.content_hash = 'changed';
    if (corruption === 'kind') links[0].kindEvidence = { position: 'DEF', fantasyPositions: ['LB'], positionState: 'supplied', fantasyPositionsState: 'supplied' };
    if (corruption === 'canonical') links[0].canonicalEntityId = uuid(99);
    const proofs = links[0].mappingProof as Array<Record<string, unknown>>;
    if (corruption === 'expired') proofs[0].validTo = '2026-10-01T01:00:02.000Z';
    if (corruption === 'unverified') proofs[0].mappingStatus = 'unverified';
    expect(await fixture(row).read()).toEqual({ status: 'unavailable', reason: 'roster_player_link_evidence_unavailable' });
  });
  it('preserves PostgreSQL microseconds and evaluates mapping validity without millisecond rounding', async () => {
    const row = storedRow();
    row.mapping_evaluated_at = '2026-10-01 01:00:02.123456+00';
    row.resolved_at = '2026-10-01 01:00:02.123457+00';
    const links = row.links as Array<Record<string, unknown>>;
    const mappings = links[0].mappingProof as Array<Record<string, unknown>>;
    mappings[0].validFrom = '2026-10-01T01:00:02.123455+00:00';
    mappings[0].validTo = '2026-10-01T01:00:02.123457+00:00';
    const result = await fixture(row).read();
    expect(result).toMatchObject({ status: 'available', mappingEvaluatedAt: row.mapping_evaluated_at, resolvedAt: row.resolved_at,
      links: [{ mappingProof: [{ validFrom: mappings[0].validFrom, validTo: mappings[0].validTo }] }, {}, {}, {}] });
    expect(await fixture(row).read()).toEqual(result);
    mappings[0].validFrom = '2026-10-01T01:00:02.123457+00:00';
    mappings[0].validTo = null;
    expect(await fixture(row).read()).toMatchObject({ status: 'unavailable' });
    mappings[0].validFrom = '2026-10-01T01:00:02.123455+00:00';
    mappings[0].validTo = '2026-10-01T01:00:02.123456+00:00';
    expect(await fixture(row).read()).toMatchObject({ status: 'unavailable' });
  });
  it('distinguishes no-directory evidence from a missing row and retains unknown held membership', async () => {
    const row = storedRow(); row.directory = null; row.directory_version_id = null; row.resolved_count = 0; row.unresolved_count = 4;
    row.links = (row.links as Array<Record<string, unknown>>).map(link => ({ ...link, canonicalEntityId: null, entityKind: null,
      identityState: 'unresolved', directoryIdentityStatus: 'missing', kindEvidence: null, mappingProof: [], reasons: ['directory_unavailable'] }));
    expect(await fixture(row).read()).toMatchObject({ status: 'available', outcome: 'partial', directory: null, counts: { held: 4 },
      links: [{ nativePlayerId: '001', reasons: ['directory_unavailable'] }, {}, {}, {}] });
  });
  it('retains a frozen conflicting map without treating it as a resolved membership', async () => {
    const row = storedRow(); row.resolved_count = 1; row.conflict_count = 1;
    const links = row.links as Array<Record<string, unknown>>;
    links[0] = { ...links[0], identityState: 'conflict', canonicalEntityId: null, reasons: ['canonical_kind_conflict'],
      mappingProof: [proof('001', 'team_defense', uuid(40))] };
    expect(await fixture(row).read()).toMatchObject({ status: 'available', links: [{ identityState: 'conflict', canonicalEntityId: null,
      mappingProof: [{ scoringEntityId: uuid(40), entityKind: 'team_defense' }] }, {}, {}, {}] });
  });
  it('returns explicit whole-snapshot capacity and owner outcomes without pretending omitted links are complete', async () => {
    const row = storedRow([{ ...payload[0], players: Array.from({ length: 10_001 }, (_, i) => String(i + 1)) }, payload[1]]);
    Object.assign(row, { outcome: 'capacity_exceeded', reasons: ['capacity_exceeded'],
      links: [], held_count: 10_001, resolved_count: 0, unresolved_count: 10_001 });
    expect(await fixture(row).read()).toEqual({ status: 'capacity_exceeded', reason: 'roster_player_link_capacity_exceeded',
      rosterReceiptId: selection.rosterReceiptId, counts: { teams: 2, held: 10_001 } });
    Object.assign(row, { held_count: 4, unresolved_count: 4, payload });
    expect(await fixture(row).read()).toMatchObject({ status: 'capacity_exceeded', counts: { held: 4 } }); // The proof-byte ceiling can bind before row count.
    Object.assign(row, { outcome: 'owner_unqualified', reasons: ['owner_unqualified'] });
    expect(await fixture(row).read()).toEqual({ status: 'unavailable', reason: 'roster_player_link_owner_unqualified' });
  });
  it('fails closed on overbound actual rows even when declared counts lie, and rejects invalid selection before SQL', async () => {
    const row = storedRow(); row.links = Array.from({ length: 10_001 }, () => (row.links as unknown[])[0]);
    expect(await fixture(row).read()).toMatchObject({ status: 'unavailable' });
    const query = vi.fn();
    expect(await rosterPlayerLinkMethods({ enabled: true, query } as unknown as DatabaseClient)
      .readRosterPlayerLinks({ ...selection, leagueSeasonId: 'bad' })).toMatchObject({ status: 'unavailable' });
    expect(query).not.toHaveBeenCalled();
  });
  it('keeps pre-migration absence and a database failure explicit without read-side backfill', async () => {
    expect(await fixture(null).read()).toEqual({ status: 'missing', reason: 'roster_player_links_not_recorded' });
    const query = vi.fn(async () => { throw new Error('database unavailable'); });
    expect(await rosterPlayerLinkMethods({ enabled: true, query } as unknown as DatabaseClient).readRosterPlayerLinks(selection))
      .toEqual({ status: 'unavailable', reason: 'roster_player_link_evidence_unavailable' });
    expect(query).toHaveBeenCalledTimes(1);
  });
});


describe('dual-format immutable roster membership storage', () => {
  it('returns exactly the same public shape for legacy and shared partial membership, with one bounded stored query', async () => {
    const fetch = vi.fn(() => { throw new Error('Provider forbidden.'); }); vi.stubGlobal('fetch', fetch);
    const legacy = fixture(), shared = fixture(sharedRow());
    const result = await shared.read();
    expect(result.status).toBe('available');
    expect(result).toEqual(await legacy.read());
    expect(shared.query).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
    expect(ROSTER_PLAYER_LINK_READ_SQL).not.toMatch(/external_scoring_entity_ids|current_mapping_revision_id|resource_heads|directory_heads/);
    expect(ROSTER_PLAYER_LINK_READ_SQL).toContain("linked.storage_format='acceptance-v1'");
    expect(ROSTER_PLAYER_LINK_READ_SQL).toContain("linked.storage_format='shared-v1'");
    expect(ROSTER_PLAYER_LINK_READ_SQL).toContain('LIMIT 10001');
    expect(ROSTER_PLAYER_LINK_READ_SQL).toContain('LIMIT 1001');
  });
  it('retains every unresolved held member with a NULL pinned directory, without substituting a directory head', async () => {
    const legacy = storedRow();
    Object.assign(legacy, { directory: null, directory_version_id: null, resolved_count: 0, unresolved_count: 4,
      links: (legacy.links as Array<Record<string, unknown>>).map(link => ({ ...link, canonicalEntityId: null, entityKind: null,
        identityState: 'unresolved', directoryIdentityStatus: 'missing', kindEvidence: null, mappingProof: [], reasons: ['directory_unavailable'] })) });
    const shared = sharedRow(legacy);
    expect(await fixture(shared).read()).toEqual(await fixture(legacy).read());
    expect(await fixture(shared).read()).toMatchObject({ status: 'available', directory: null, counts: { held: 4 }, links: [{}, {}, {}, {}] });
    (shared.shared_content as Record<string, unknown>).directoryVersionId = uuid(99);
    expect(await fixture(shared).read()).toEqual({ status: 'unavailable', reason: 'roster_player_link_evidence_unavailable' });
  });
  it('accepts a complete empty shared set and distinguishes a missing header from that empty set', async () => {
    const legacy = storedRow(payload.map(team => ({ ...team, players: [] })));
    Object.assign(legacy, { outcome: 'complete', reasons: [], held_count: 0, resolved_count: 0, unresolved_count: 0,
      links: [], legacy_links_present: false });
    const shared = sharedRow(legacy);
    expect(await fixture(shared).read()).toEqual(await fixture(legacy).read());
    expect(await fixture(shared).read()).toMatchObject({ status: 'available', outcome: 'complete', counts: { teams: 2, held: 0 }, links: [] });
    shared.shared_content = null;
    expect(await fixture(shared).read()).toEqual({ status: 'unavailable', reason: 'roster_player_link_evidence_unavailable' });
  });
  it.each(['capacity_exceeded', 'owner_unqualified'])('retains the shared %s outcome without inventing a content set', async outcome => {
    const legacy = storedRow();
    Object.assign(legacy, { outcome, reasons: [outcome], links: [], resolved_count: 0, unresolved_count: 4, legacy_links_present: false });
    const shared = sharedRow(legacy);
    expect(await fixture(shared).read()).toEqual(await fixture(legacy).read());
    shared.link_content_id = uuid(50);
    expect(await fixture(shared).read()).toEqual({ status: 'unavailable', reason: 'roster_player_link_evidence_unavailable' });
  });
  it.each(['unknown-format', 'missing-format', 'legacy-with-pointer', 'legacy-with-header', 'missing-pointer', 'missing-header',
    'double-representation', 'missing-representation-proof', 'id', 'league', 'mapping', 'directory', 'link-version', 'storage-version',
    'missing-first-receipt', 'malformed-hash', 'different-hash', 'held', 'resolved', 'unresolved', 'conflict'])
    ('rejects %s representation before treating it as valid history', async corruption => {
      const row = sharedRow(), header = row.shared_content as Record<string, unknown>;
      if (corruption === 'unknown-format') row.storage_format = 'future-v2';
      if (corruption === 'missing-format') delete row.storage_format;
      if (corruption === 'legacy-with-pointer') Object.assign(row, { storage_format: 'acceptance-v1', shared_content: null });
      if (corruption === 'legacy-with-header') Object.assign(row, { storage_format: 'acceptance-v1', link_content_id: null });
      if (corruption === 'missing-pointer') row.link_content_id = null;
      if (corruption === 'missing-header') row.shared_content = null;
      if (corruption === 'double-representation') row.legacy_links_present = true;
      if (corruption === 'missing-representation-proof') delete row.legacy_links_present;
      if (corruption === 'id') header.id = uuid(99);
      if (corruption === 'league') header.leagueSeasonId = uuid(99);
      if (corruption === 'mapping') header.sourceMappingRevisionId = uuid(99);
      if (corruption === 'directory') header.directoryVersionId = null;
      if (corruption === 'link-version') header.linkVersion = 'future-v2';
      if (corruption === 'storage-version') header.storageVersion = 'future-v2';
      if (corruption === 'missing-first-receipt') header.firstReceiptPresent = false;
      if (corruption === 'malformed-hash') header.contentHash = row.computed_link_content_hash = 'not-a-digest';
      if (corruption === 'different-hash') row.computed_link_content_hash = 'b'.repeat(64);
      if (['held', 'resolved', 'unresolved', 'conflict'].includes(corruption)) header[corruption] = Number(header[corruption]) + 1;
      expect(await fixture(row).read()).toEqual({ status: 'unavailable', reason: 'roster_player_link_evidence_unavailable' });
    });
  it('preserves independent capture identities and microsecond times when fresh history reuses the same content', async () => {
    const first = sharedRow();
    const next = sharedRow();
    Object.assign(next, { roster_receipt_id: uuid(44), roster_acceptance_id: uuid(45), roster_content_id: uuid(46), generation: 2,
      mapping_evaluated_at: '2026-10-01 01:00:02.123456+00', resolved_at: '2026-10-01 01:00:02.123457+00' });
    const nextLinks = next.links as Array<Record<string, unknown>>;
    const mappings = nextLinks[0].mappingProof as Array<Record<string, unknown>>;
    mappings[0].validFrom = '2026-09-01T00:00:00.000001+00:00';
    ((first.links as Array<Record<string, unknown>>)[0].mappingProof as Array<Record<string, unknown>>)[0].validFrom = mappings[0].validFrom;
    const query = vi.fn(async (sql: string, parameters: readonly unknown[]) => {
      expect(sql).toBe(ROSTER_PLAYER_LINK_READ_SQL);
      return parameters[0] === selection.rosterReceiptId ? [first] : parameters[0] === uuid(44) ? [next] : [];
    });
    const reader = rosterPlayerLinkMethods({ enabled: true, query } as unknown as DatabaseClient);
    const before = await reader.readRosterPlayerLinks(selection);
    const after = await reader.readRosterPlayerLinks({ ...selection, rosterReceiptId: uuid(44) });
    expect(before).toMatchObject({ status: 'available', rosterAcceptanceId: uuid(5), rosterReceiptId: selection.rosterReceiptId });
    expect(after).toMatchObject({ status: 'available', rosterAcceptanceId: uuid(45), rosterReceiptId: uuid(44), rosterContentId: uuid(46),
      mappingEvaluatedAt: next.mapping_evaluated_at, resolvedAt: next.resolved_at,
      links: [{ mappingProof: [{ validFrom: '2026-09-01T00:00:00.000001+00:00' }] }, {}, {}, {}] });
    expect(await reader.readRosterPlayerLinks(selection)).toEqual(before);
    expect(query).toHaveBeenCalledTimes(3);
    mappings[0].validTo = next.mapping_evaluated_at;
    expect(await reader.readRosterPlayerLinks({ ...selection, rosterReceiptId: uuid(44) })).toEqual({ status: 'unavailable', reason: 'roster_player_link_evidence_unavailable' });
  });
  it('rejects overbound shared rows and duplicate receipt rows without another query', async () => {
    const row = sharedRow(); row.links = Array.from({ length: 10_001 }, () => (row.links as unknown[])[0]);
    const shared = fixture(row);
    expect(await shared.read()).toEqual({ status: 'unavailable', reason: 'roster_player_link_evidence_unavailable' });
    expect(shared.query).toHaveBeenCalledTimes(1);
    const query = vi.fn(async () => [sharedRow(), sharedRow()]);
    expect(await rosterPlayerLinkMethods({ enabled: true, query } as unknown as DatabaseClient).readRosterPlayerLinks(selection))
      .toEqual({ status: 'unavailable', reason: 'roster_player_link_evidence_unavailable' });
    expect(query).toHaveBeenCalledTimes(1);
  });
});

describe('roster link logical provenance projection', () => {
  it('returns original roster source alongside either stored link representation', async () => {
    for (const row of [storedRow(), sharedRow()]) {
      const f = fixture(row);
      expect(await f.read()).toMatchObject({ status: 'available', rosterSource: provenance });
      expect(f.query).toHaveBeenCalledOnce();
    }
    expect(ROSTER_PLAYER_LINK_READ_SQL).toContain('public.roster_capture_provenance(receipt) AS provenance');
    expect(ROSTER_PLAYER_LINK_READ_SQL).not.toMatch(/receipt\.provenance/u);
  });
  it('does not retry after shared provenance reconstruction fails', async () => {
    const query = vi.fn(async () => { throw Error('shared roster provenance binding mismatch'); });
    expect(await rosterPlayerLinkMethods({ enabled: true, query } as unknown as DatabaseClient).readRosterPlayerLinks(selection))
      .toEqual({ status: 'unavailable', reason: 'roster_player_link_evidence_unavailable' });
    expect(query).toHaveBeenCalledOnce();
  });
});
