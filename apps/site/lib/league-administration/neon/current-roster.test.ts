import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseClient, DatabaseRow } from '../../database';
import { CURRENT_ROSTER_POLICY, currentRosterScope } from '../../aggregator/current-roster';
import type { AdministrationEnvelope, JsonObject } from '../contracts';
import type { AdministrationSourceMapping } from '../source-mapping';
import { normalizeAdministrationObservation } from '../normalize';
import { createLeagueAdministrationStore } from '../store';
import { currentRosterMethods } from './current-roster';
import { managerLineup } from '../../transform';
import { loadFantasyPlayerCatalog, projectPlayerCatalog, type FantasyPlayerCatalog } from '../../sleeper-player-catalog';
import type { CurrentRosterReadOptions } from '../../aggregator/current-roster-metadata';

vi.mock('server-only', () => ({}));
afterEach(() => vi.unstubAllGlobals());

const ids = {
  connection: '10000000-0000-4000-8000-000000000001',
  season: '20000000-0000-4000-8000-000000000001',
  revision: '30000000-0000-4000-8000-000000000001',
  scope: '40000000-0000-4000-8000-000000000001',
  attempt: '50000000-0000-4000-8000-000000000001',
  receipt: '60000000-0000-4000-8000-000000000001',
  content: '70000000-0000-4000-8000-000000000001',
  configuration: '80000000-0000-4000-8000-000000000001',
  legacyObservation: '90000000-0000-4000-8000-000000000001',
  teamOne: 'a0000000-0000-4000-8000-000000000001',
  teamTwo: 'a0000000-0000-4000-8000-000000000002',
  different: 'b0000000-0000-4000-8000-000000000001',
};
const mapping: AdministrationSourceMapping = {
  connectionId: ids.connection, leagueSeasonId: ids.season, revisionId: ids.revision, generation: 3,
  scope: { leagueKey: 'league1', provider: 'sleeper', externalLeagueId: 'fixture-source', season: 2026 },
};
const provenance: AdministrationEnvelope['provenance'] = {
  origin: 'network', requestStartedAt: '2026-09-25T12:00:00.000Z',
  requestCompletedAt: '2026-09-25T12:00:01.000Z', sourceObservedAt: '2026-09-25T12:00:01.000Z',
  checkedAt: '2026-09-25T12:00:02.000Z',
};
const payload: readonly JsonObject[] = [{ roster_id: 7, players: ['001', 'DEF'] }, { roster_id: 12, players: [], reserve: null }];
const coverage = { periodIds: [], interval: null, entitySet: 'full', fields: ['players'],
  pagination: 'complete', nextCursor: null, completeness: 'complete', reasons: [] };

function storedRow(raw: AdministrationEnvelope['payload'] = payload) {
  const normalized = normalizeAdministrationObservation({
    schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1', dialect: 'sleeper-nfl-v1',
    scope: mapping.scope, family: 'rosters', week: null, completeness: 'complete', provenance, payload: raw,
  }, { expectedRosterCount: 2 });
  return {
    identity: { scope: currentRosterScope(mapping), policy: CURRENT_ROSTER_POLICY },
    scope_id: ids.scope, generation: 2, source_mapping_revision_id: ids.revision,
    receipt_id: ids.receipt, attempt_id: ids.attempt, provenance,
    configuration_content_id: ids.configuration, expected_team_count: 2,
    legacy_observation_id: ids.legacyObservation, coverage, ordinal: 5, source_mapping: mapping,
    content_id: ids.content, content_hash: normalized.contentHash, payload: raw, normalized_value: normalized.value,
    normalizer_version: 'sleeper-administration-v1', completeness: 'complete', league_season_id: ids.season,
    provider: 'sleeper', external_league_id: mapping.scope.externalLeagueId,
    identities: [{ seasonTeamId: ids.teamTwo, externalRosterId: '12' }, { seasonTeamId: ids.teamOne, externalRosterId: '7' }],
  };
}

function database(respond: (sql: string, parameters: readonly unknown[]) => readonly DatabaseRow[]): DatabaseClient {
  return { enabled: true, async query<Row extends DatabaseRow>(sql: string, parameters: readonly unknown[] = []) {
    return respond(sql, parameters) as readonly Row[];
  } };
}

function read(row: DatabaseRow, requestedMapping = mapping) {
  return currentRosterMethods(database(() => [row])).readAcceptedCurrentRoster(requestedMapping);
}

async function metadataCatalog(): Promise<FantasyPlayerCatalog> {
  return loadFantasyPlayerCatalog(async position => ({
    ...projectPlayerCatalog(position === 'QB' || position === 'TE' ? { '001': {
      full_name: 'Source Player', position: 'QB', fantasy_positions: ['QB', 'TE'], team: 'BUF',
      injury_status: 'Questionable', status: 'Inactive', active: false,
    } } : position === 'DEF' ? { DEF: { full_name: 'Source Defense', position: 'DEF' } }
      : { [position]: { full_name: `Other ${position}`, position } }),
    observedAt: position === 'QB' ? '2026-09-28T10:00:00.000Z' : '2026-09-29T11:00:00.000Z',
  }));
}

describe('current roster shadow Neon adapter', () => {
  it('optionally decorates the actual store read from the already-loaded catalog without fetching or changing roster evidence', async () => {
    const catalog = await metadataCatalog();
    const fetcher = vi.fn(() => { throw new Error('Decoration must not fetch.'); });
    vi.stubGlobal('fetch', fetcher);
    const query = vi.fn(() => [storedRow()]);
    const store = createLeagueAdministrationStore(database(query));
    const original = await store.readAcceptedCurrentRoster(mapping);
    const decorated = await store.readAcceptedCurrentRoster(mapping, { playerCatalog: catalog });
    if (decorated.status !== 'available') throw new Error('Expected current roster.');
    const { currentPlayerMetadata, ...official } = decorated;
    expect(official).toEqual(original);
    expect(currentPlayerMetadata).toMatchObject({ status: 'available', kind: 'current-roster-metadata-evidence',
      temporalContext: 'current-display', historicalApplicability: 'unverified', freshness: 'unknown',
      catalogSourceRevision: catalog.sourceRevision, catalogComplete: true, players: [
        { sourceEntity: { nativeId: '001' }, availability: 'present', sourceAge: 'mixed',
          sources: [{ provider: 'sleeper', resource: 'nfl-player-catalog', scope: 'QB', observedAt: '2026-09-28T10:00:00.000Z' },
            { scope: 'TE', observedAt: '2026-09-29T11:00:00.000Z' }],
          name: { value: 'Source Player', sourcePaths: ['full_name'] }, nflTeam: { value: 'BUF' }, primaryPosition: { value: 'QB' },
          fantasyPositions: { value: ['QB', 'TE'] }, injuryStatus: { value: 'Questionable' }, status: { value: 'Inactive' }, active: { value: false } },
        { sourceEntity: { nativeId: 'DEF' }, nflTeam: { value: null, availability: 'missing' },
          injuryStatus: { value: null, availability: 'missing' } },
      ] });
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1]).toEqual(query.mock.calls[0]);
    expect(fetcher).not.toHaveBeenCalled();
    expect(await store.readAcceptedCurrentRoster(mapping, { playerCatalog: catalog })).toEqual(decorated);
    if (currentPlayerMetadata?.status !== 'available') throw new Error('Expected metadata.');
    const positions = currentPlayerMetadata.players[0].fantasyPositions.value;
    expect(positions).not.toBe(catalog.catalog['001'].fantasy_positions);
  });

  it.each(['missing', 'invalid'] as const)('keeps %s catalog observation times unknown without using the roster or read clock', async mode => {
    const catalog = await metadataCatalog();
    const undated = { ...catalog, sourceSlices: mode === 'missing' ? undefined : catalog.sourceSlices?.map(slice => ({
      ...slice, observedAt: '2026-02-30T10:00:00.000Z',
    })) };
    const result = await currentRosterMethods(database(() => [storedRow()])).readAcceptedCurrentRoster(mapping, { playerCatalog: undated });
    expect(result).toMatchObject({ status: 'available', accepted: { verifiedAt: provenance.sourceObservedAt }, currentPlayerMetadata: {
      status: 'available', players: [{ sourceAge: 'unknown', name: { value: 'Source Player' },
        reasons: expect.arrayContaining(['catalog_source_age_unknown']) }, {}],
    } });
    if (result.status !== 'available' || result.currentPlayerMetadata?.status !== 'available') throw new Error('Expected metadata.');
    expect(result.currentPlayerMetadata.players.flatMap(player => player.sources).every(source => source.observedAt === null)).toBe(true);
  });

  it('keeps current metadata separate from an older season and capture without asserting historical injury or team', async () => {
    const olderMapping = { ...mapping, leagueSeasonId: ids.different, scope: { ...mapping.scope, season: 2025 } };
    const earlier = Object.fromEntries(Object.entries(provenance).map(([key, value]) => [key,
      typeof value === 'string' ? value.replace('2026-', '2025-') : value])) as AdministrationEnvelope['provenance'];
    const row = { ...storedRow(), source_mapping: olderMapping, league_season_id: olderMapping.leagueSeasonId,
      identity: { scope: currentRosterScope(olderMapping), policy: CURRENT_ROSTER_POLICY }, provenance: earlier };
    const methods = currentRosterMethods(database(() => [row]));
    const original = await methods.readAcceptedCurrentRoster(olderMapping);
    const decorated = await methods.readAcceptedCurrentRoster(olderMapping, { playerCatalog: await metadataCatalog() });
    if (decorated.status !== 'available') throw new Error('Expected older retained roster.');
    const { currentPlayerMetadata, ...official } = decorated;
    expect(official).toEqual(original);
    expect(decorated.receipt.provenance).toEqual(earlier);
    expect(decorated.teams[0].currentGroups.source).toEqual(earlier);
    expect(currentPlayerMetadata).toMatchObject({ temporalContext: 'current-display', historicalApplicability: 'unverified',
      players: [{ sources: [{ observedAt: '2026-09-28T10:00:00.000Z' }, { observedAt: '2026-09-29T11:00:00.000Z' }] }, {}] });
  });

  it('isolates absent metadata, vacancy markers and inherited object properties from official groups', async () => {
    const raw = [{ roster_id: 7, players: ['missing', 'toString', '0'], starters: ['missing', '0'], reserve: [], taxi: [] }, payload[1]];
    const catalog = await metadataCatalog();
    const row = storedRow(raw); const methods = currentRosterMethods(database(() => [row]));
    const original = await methods.readAcceptedCurrentRoster(mapping);
    const decorated = await methods.readAcceptedCurrentRoster(mapping, { playerCatalog: catalog });
    if (decorated.status !== 'available') throw new Error('Expected available roster.');
    const { currentPlayerMetadata, ...official } = decorated;
    expect(official).toEqual(original);
    expect(currentPlayerMetadata).toMatchObject({ status: 'available', players: [
      { sourceEntity: { nativeId: 'missing' }, availability: 'missing', name: { value: null }, injuryStatus: { value: null } },
      { sourceEntity: { nativeId: 'toString' }, availability: 'missing' },
      { sourceEntity: { nativeId: '0' }, availability: 'missing', reasons: expect.arrayContaining(['vacancy_marker_is_not_player']) },
    ] });
  });

  it('contains malformed optional metadata failures without rejecting the accepted roster', async () => {
    const methods = currentRosterMethods(database(() => [storedRow()]));
    const original = await methods.readAcceptedCurrentRoster(mapping);
    const options = new Proxy({} as CurrentRosterReadOptions, { get() { throw new Error('Malformed optional catalog.'); } });
    const result = await methods.readAcceptedCurrentRoster(mapping, options);
    if (result.status !== 'available') throw new Error('Metadata must not reject held players.');
    const { currentPlayerMetadata, ...official } = result;
    expect(official).toEqual(original);
    expect(currentPlayerMetadata).toMatchObject({ status: 'unavailable', reason: 'catalog_evidence_unavailable' });
  });

  it.each([null, 'invalid row', []])('withholds malformed catalog row %j and its date references without blocking other metadata', async malformed => {
    const catalog = await metadataCatalog();
    const result = await currentRosterMethods(database(() => [storedRow()])).readAcceptedCurrentRoster(mapping, {
      playerCatalog: { ...catalog, catalog: { ...catalog.catalog, '001': malformed as never } },
    });
    expect(result).toMatchObject({ status: 'available', currentPlayerMetadata: { status: 'available', players: [
      { sourceEntity: { nativeId: '001' }, availability: 'missing', sources: [], sourceAge: 'unknown',
        reasons: expect.arrayContaining(['catalog_player_invalid']), name: { value: null } },
      { sourceEntity: { nativeId: 'DEF' }, availability: 'present', name: { value: 'Source Defense' } },
    ] } });
  });

  it('compares equivalent observation instants while retaining each source timestamp spelling', async () => {
    const catalog = await metadataCatalog();
    const result = await currentRosterMethods(database(() => [storedRow()])).readAcceptedCurrentRoster(mapping, {
      playerCatalog: { ...catalog, sourceSlices: catalog.sourceSlices?.map(slice => ({ ...slice,
        observedAt: slice.scope === 'QB' ? '2026-09-28T10:00:00Z' : '2026-09-28T10:00:00.000Z',
      })) },
    });
    expect(result).toMatchObject({ status: 'available', currentPlayerMetadata: { players: [
      { sourceAge: 'known', sources: [{ observedAt: '2026-09-28T10:00:00Z' }, { observedAt: '2026-09-28T10:00:00.000Z' }] }, {},
    ] } });
  });

  it('reads held players using retained team UUIDs and preserves explicit empty membership without reserve or taxi', async () => {
    const result = await read(storedRow());
    expect(result).toMatchObject({ status: 'available', accepted: {
      scope: currentRosterScope(mapping), canonicalNormalizerVersion: 'sleeper-current-players-v1',
      sourceMappingRevisionId: ids.revision, contentId: ids.content, observationIds: [ids.receipt],
      validationVersion: 'latest-network-attempt-v1', acceptedGeneration: 2,
      verifiedAt: provenance.sourceObservedAt, effectiveFrom: null, effectiveTo: null, effectiveEvidence: 'unknown',
    }, teams: [
      { seasonTeamId: ids.teamOne, externalRosterId: '7', players: [
        { seasonTeamId: ids.teamOne, sourceTeam: { provider: 'sleeper', resourceKind: 'team',
          nativeNamespace: '["nfl",2026,"fixture-source"]', nativeId: '7' },
        sourceEntity: { provider: 'sleeper', resourceKind: 'scoring-entity', nativeNamespace: 'nfl', nativeId: '001' },
        canonicalEntityId: null, identityState: 'unresolved', nativeSection: 'players', section: 'roster',
        effectiveFrom: null, effectiveTo: null, effectiveEvidence: 'unknown' },
        { sourceEntity: { nativeId: 'DEF' } },
      ] },
      { seasonTeamId: ids.teamTwo, externalRosterId: '12', players: [] },
    ] });
  });

  it('returns exact receipt provenance separately from the legacy deduplicated observation and never restamps it', async () => {
    const row = storedRow();
    const first = await read(row);
    const second = await read(row);
    expect(second).toEqual(first);
    expect(first).toMatchObject({ status: 'available', accepted: { observationIds: [ids.receipt],
      verifiedAt: provenance.sourceObservedAt }, receipt: { id: ids.receipt, attemptId: ids.attempt,
      ordinal: 5, provenance, configurationContentId: ids.configuration, expectedTeamCount: 2,
      legacyObservationId: ids.legacyObservation } });
    expect(ids.receipt).not.toBe(ids.legacyObservation);
  });

  it('projects current groups from the same accepted content without widening its players-only policy', async () => {
    const roster = { roster_id: 7, players: ['001', 'DEF', 'reserve', 'taxi', 'bench'],
      starters: ['DEF', '0', '001', '0'], reserve: ['reserve'], taxi: ['taxi'] };
    const row = storedRow([roster, payload[1]]);
    const result = await read(row);
    if (result.status !== 'available') throw new Error('Expected available held-player evidence.');
    const team = result.teams[0];
    expect(team.players.map(player => player.sourceEntity.nativeId)).toEqual(['001', 'DEF', 'reserve', 'taxi', 'bench']);
    expect(team.currentGroups).toMatchObject({ kind: 'current-roster-field-evidence', historicalApplicability: 'unverified',
      source: provenance, nativeLists: { starters: ['DEF', '0', '001', '0'], reserve: ['reserve'], taxi: ['taxi'] }, starters: { value: [
        { index: 0, nativePlayerId: 'DEF', empty: false, membership: { seasonTeamId: ids.teamOne, section: 'active', nativeSection: 'starters' } },
        { index: 1, nativePlayerId: '0', empty: true, membership: null },
        { index: 2, nativePlayerId: '001', empty: false }, { index: 3, nativePlayerId: '0', empty: true, membership: null },
      ] }, reserve: { value: [{ sourceEntity: { nativeId: 'reserve' }, section: 'reserve' }] },
      taxi: { value: [{ sourceEntity: { nativeId: 'taxi' }, section: 'taxi' }] },
      bench: { authority: 'presentation-derived', value: [{ sourceEntity: { nativeId: 'bench' }, section: 'bench' }] } });
    for (const group of ['starters', 'reserve', 'taxi', 'bench'] as const) {
      expect(team.currentGroups[group]).toMatchObject({ temporalContext: 'current-display', sourceRefs: [ids.receipt], freshness: 'unknown' });
    }
    expect(team.currentGroups.reserve.value?.[0]).toMatchObject({ canonicalEntityId: null, identityState: 'unresolved',
      effectiveFrom: null, effectiveTo: null, effectiveEvidence: 'unknown' });
    expect(result.accepted.scope).toEqual(currentRosterScope(mapping));
    expect(result.accepted.canonicalNormalizerVersion).toBe('sleeper-current-players-v1');
    expect(row.coverage.fields).toEqual(['players']);
    expect((await read(row))).toEqual(result);
    // Compare actual legacy presentation on this exact complete, nonconflicting capture.
    // Slot labels come only from the legacy fixture configuration, not the new projection.
    const legacy = managerLineup(roster, { season: String(mapping.scope.season), week: 3, maxWeek: 18,
      rosterPositions: ['DEF', 'FLEX', 'QB', 'FLEX', 'BN', 'IR', 'TAXI'] }, {});
    expect(team.currentGroups.starters.value?.map(({ index, nativePlayerId, empty }) => ({ index, nativePlayerId, empty })))
      .toEqual(legacy.starters.map((player, index) => {
        const empty = player.id === `empty-${player.slot}-${index}`;
        return { index, nativePlayerId: empty ? '0' : player.id, empty };
      }));
    expect(team.currentGroups.bench.value?.map(member => member.sourceEntity.nativeId)).toEqual(legacy.bench.map(player => player.id));
    expect(team.currentGroups.reserve.value?.map(member => member.sourceEntity.nativeId))
      .toEqual(legacy.reserve.filter(player => player.slot === 'IR').map(player => player.id));
    expect(team.currentGroups.taxi.value?.map(member => member.sourceEntity.nativeId))
      .toEqual(legacy.reserve.filter(player => player.slot === 'TAXI').map(player => player.id));
  });

  it.each([undefined, null])('keeps missing/null groups unknown while explicit empty lists remain usable: %j', async missing => {
    const raw = { roster_id: 7, players: ['001'], ...(missing === null ? { starters: null } : {}), reserve: [], taxi: [] };
    const result = await read(storedRow([raw, { roster_id: 12, players: [], starters: [], reserve: [], taxi: [] }]));
    expect(result).toMatchObject({ status: 'available', teams: [{ currentGroups: {
      starters: { value: null, availability: 'missing', completeness: 'unknown', reasons: ['source_field_missing'] },
      reserve: { value: [], availability: 'empty', completeness: 'complete' }, taxi: { value: [], availability: 'empty' },
      bench: { value: null, reasons: ['starters_evidence_unknown'] },
    } }, { currentGroups: { starters: { value: [], availability: 'empty' }, bench: { value: [], availability: 'empty' } } }] });
  });

  it.each(['starters', 'reserve', 'taxi'] as const)('isolates %s membership outside the held inventory without rejecting players', async group => {
    const raw = { roster_id: 7, players: ['001'], starters: [], reserve: [], taxi: [], [group]: ['foreign'] };
    const result = await read(storedRow([raw, payload[1]]));
    if (result.status !== 'available') throw new Error('Expected available held-player evidence.');
    expect(result.teams[0].players.map(player => player.sourceEntity.nativeId)).toEqual(['001']);
    for (const name of ['starters', 'reserve', 'taxi'] as const) {
      expect(result.teams[0].currentGroups[name]).toMatchObject(name === group
        ? { value: null, reasons: ['group_player_not_held'] } : { value: [], reasons: [] });
    }
    expect(result.teams[0].currentGroups.bench).toMatchObject({ value: null, reasons: [`${group}_evidence_unknown`] });
  });

  it.each([['starters', 'reserve'], ['starters', 'taxi'], ['reserve', 'taxi']] as const)(
    'withholds conflicting %s/%s placements and preserves the unaffected field', async (first, second) => {
      const raw = { roster_id: 7, players: ['001'], starters: [], reserve: [], taxi: [], [first]: ['001'], [second]: ['001'] };
      const result = await read(storedRow([raw, payload[1]]));
      if (result.status !== 'available') throw new Error('Expected available held-player evidence.');
      const groups = result.teams[0].currentGroups;
      expect(groups.nativeLists[first]).toEqual(['001']);
      expect(groups.nativeLists[second]).toEqual(['001']);
      expect(groups[first]).toMatchObject({ value: null, reasons: [`group_overlaps_${second}`] });
      expect(groups[second]).toMatchObject({ value: null, reasons: [`group_overlaps_${first}`] });
      for (const name of ['starters', 'reserve', 'taxi'] as const) {
        if (name !== first && name !== second) expect(groups[name]).toMatchObject({ value: [], availability: 'empty' });
      }
      expect(groups.bench.value).toBeNull();
    });

  it('treats repeated starter vacancies as slots and retains held-player order in the derived bench', async () => {
    const result = await read(storedRow([{ roster_id: 7, players: ['DEF', '001'], starters: ['0', '0'], reserve: [], taxi: [] }, payload[1]]));
    if (result.status !== 'available') throw new Error('Expected available held-player evidence.');
    const groups = result.teams[0].currentGroups;
    expect(groups.starters).toMatchObject({ availability: 'present', value: [
      { index: 0, nativePlayerId: '0', empty: true, membership: null }, { index: 1, nativePlayerId: '0', empty: true, membership: null },
    ] });
    expect(groups.bench.value?.map(member => member.sourceEntity.nativeId)).toEqual(['DEF', '001']);
  });

  it('keeps legacy held-player evidence but never turns its vacancy marker into a bench player', async () => {
    const result = await read(storedRow([{ roster_id: 7, players: ['0'], starters: [], reserve: [], taxi: [] }, payload[1]]));
    expect(result).toMatchObject({ status: 'available', teams: [{ players: [{ sourceEntity: { nativeId: '0' } }], currentGroups: {
      starters: { value: [], availability: 'empty' }, reserve: { value: [], availability: 'empty' },
      taxi: { value: [], availability: 'empty' }, bench: { value: null, reasons: ['held_players_contains_vacancy_marker'] },
    } }, {}] });
  });

  it.each(['reserve', 'taxi'] as const)('withholds %s vacancy markers even when they are not in held players', async group => {
    const result = await read(storedRow([{ roster_id: 7, players: ['001'], starters: ['001', '0'], reserve: [], taxi: [], [group]: ['0'] }, payload[1]]));
    if (result.status !== 'available') throw new Error('Expected available held-player evidence.');
    const groups = result.teams[0].currentGroups;
    expect(groups.nativeLists[group]).toEqual(['0']);
    expect(groups[group]).toMatchObject({ value: null, reasons: ['group_contains_vacancy_marker'] });
    expect(groups.starters.value?.map(slot => slot.nativePlayerId)).toEqual(['001', '0']);
    expect(groups[group === 'reserve' ? 'taxi' : 'reserve']).toMatchObject({ value: [], availability: 'empty' });
    expect(groups.bench).toMatchObject({ value: null, reasons: [`${group}_evidence_unknown`] });
  });

  it('handles JSONB key ordering and bigint strings without changing captured identity', async () => {
    const reorderedMapping = { scope: { season: 2026, externalLeagueId: 'fixture-source', provider: 'sleeper', leagueKey: 'league1' },
      generation: 3, revisionId: ids.revision, leagueSeasonId: ids.season, connectionId: ids.connection };
    const result = await read({ ...storedRow(), source_mapping: reorderedMapping, generation: '2', ordinal: '5',
      coverage: { reasons: [], completeness: 'complete', nextCursor: null, pagination: 'complete',
        fields: ['players'], entitySet: 'full', interval: null, periodIds: [] } });
    expect(result).toMatchObject({ status: 'available', accepted: { acceptedGeneration: 2 }, receipt: { ordinal: 5 } });
  });

  it.each([
    ['missing network request times', { ...provenance, requestStartedAt: null, requestCompletedAt: null }],
    ['missing source observation time', { ...provenance, sourceObservedAt: null }],
    ['all unknown acquisition times', { ...provenance, requestStartedAt: null, requestCompletedAt: null, sourceObservedAt: null }],
    ['cache origin', { ...provenance, origin: 'cache' }],
  ])('refuses to invent exact network evidence for %s', async (_label, receiptProvenance) => {
    expect(await read({ ...storedRow(), provenance: receiptProvenance })).toMatchObject({ status: 'unavailable' });
  });

  it('passes the qualified scope, policy and exact mapping revision to the read query', async () => {
    const query = vi.fn(() => [storedRow()]);
    const methods = currentRosterMethods(database(query));
    expect(await methods.readAcceptedCurrentRoster(mapping)).toMatchObject({ status: 'available' });
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, parameters] = query.mock.calls[0] as unknown as [string, readonly unknown[]];
    expect(sql).toContain('league-administration:read-accepted-current-roster');
    expect(JSON.parse(String(parameters[0]))).toEqual({ scope: currentRosterScope(mapping), policy: CURRENT_ROSTER_POLICY });
    expect(parameters.slice(1)).toEqual([ids.revision, 3]);
  });

  const mappingChanges: { label: string; change: (value: AdministrationSourceMapping) => AdministrationSourceMapping }[] = [
    { label: 'league key', change: value => ({ ...value, scope: { ...value.scope, leagueKey: 'league2' } }) },
    { label: 'season', change: value => ({ ...value, scope: { ...value.scope, season: 2025 } }) },
    { label: 'provider', change: value => ({ ...value, scope: { ...value.scope, provider: 'yahoo' as never } }) },
    { label: 'native league', change: value => ({ ...value, scope: { ...value.scope, externalLeagueId: 'another-source' } }) },
    { label: 'connection UUID', change: value => ({ ...value, connectionId: ids.different }) },
    { label: 'season UUID', change: value => ({ ...value, leagueSeasonId: ids.different }) },
    { label: 'mapping revision', change: value => ({ ...value, revisionId: ids.different }) },
    { label: 'mapping generation', change: value => ({ ...value, generation: 4 }) },
  ];
  it.each(mappingChanges)('refuses caller $label substitution instead of relabeling the receipt', async ({ change }) => {
    expect(await read(storedRow(), change(mapping))).toMatchObject({ status: 'unavailable' });
  });
  it.each(mappingChanges)('refuses contradictory captured $label evidence', async ({ change }) => {
    expect(await read({ ...storedRow(), source_mapping: change(mapping) })).toMatchObject({ status: 'unavailable' });
  });

  it.each([
    ['public audience', { ...CURRENT_ROSTER_POLICY, audienceId: 'private' }],
    ['coverage specification', { ...CURRENT_ROSTER_POLICY, coverageSpecId: 'players-subset' }],
    ['canonical normalizer', { ...CURRENT_ROSTER_POLICY, canonicalNormalizerVersion: 'unqualified-v2' }],
    ['acceptance policy', { ...CURRENT_ROSTER_POLICY, validationVersion: 'unqualified-v2' }],
  ])('refuses an unqualified stored %s', async (_label, policy) => {
    expect(await read({ ...storedRow(), identity: { scope: currentRosterScope(mapping), policy } }))
      .toMatchObject({ status: 'unavailable' });
  });

  it.each([
    ['subset entities', { ...coverage, entitySet: 'subset' }],
    ['other fields', { ...coverage, fields: ['reserve'] }],
    ['partial completeness', { ...coverage, completeness: 'partial' }],
    ['unfinished pagination', { ...coverage, pagination: 'continuation', nextCursor: 'next' }],
    ['period-limited inventory', { ...coverage, periodIds: [ids.different] }],
    ['missing field declaration', { ...coverage, fields: undefined }],
  ])('refuses complete replacement evidence with %s', async (_label, observedCoverage) => {
    expect(await read({ ...storedRow(), coverage: observedCoverage })).toMatchObject({ status: 'unavailable' });
  });

  it.each([
    ['missing players', [{ roster_id: 7 }, payload[1]]],
    ['null players', [{ roster_id: 7, players: null }, payload[1]]],
    ['partial population', [payload[0]]],
    ['duplicate roster identities', [payload[0], payload[0]]],
    ['duplicate player membership', [{ roster_id: 7, players: ['001', '001'] }, payload[1]]],
  ] as const)('refuses %s even when raw content has a matching hash', async (_label, raw) => {
    expect(await read(storedRow(raw))).toMatchObject({ status: 'unavailable' });
  });

  it.each([
    ['missing team', [{ seasonTeamId: ids.teamOne, externalRosterId: '7' }]],
    ['repeated roster alias', [{ seasonTeamId: ids.teamOne, externalRosterId: '7' }, { seasonTeamId: ids.teamTwo, externalRosterId: '7' }]],
    ['repeated team UUID', [{ seasonTeamId: ids.teamOne, externalRosterId: '7' }, { seasonTeamId: ids.teamOne, externalRosterId: '12' }]],
    ['unmatched roster alias', [{ seasonTeamId: ids.teamOne, externalRosterId: '7' }, { seasonTeamId: ids.teamTwo, externalRosterId: '99' }]],
  ])('refuses incomplete team lineage: %s', async (_label, identities) => {
    expect(await read({ ...storedRow(), identities })).toMatchObject({ status: 'unavailable' });
  });

  it('refuses content hash corruption and foreign accepted mapping lineage', async () => {
    expect(await read({ ...storedRow(), content_hash: 'sha256:' + '0'.repeat(64) })).toMatchObject({ status: 'unavailable' });
    expect(await read({ ...storedRow(), source_mapping_revision_id: ids.different })).toMatchObject({ status: 'unavailable' });
  });

  it('distinguishes missing acceptance from ambiguous rows and database failure', async () => {
    expect(await currentRosterMethods(database(() => [])).readAcceptedCurrentRoster(mapping)).toEqual({ status: 'missing' });
    expect(await currentRosterMethods(database(() => [storedRow(), storedRow()])).readAcceptedCurrentRoster(mapping))
      .toMatchObject({ status: 'unavailable' });
    expect(await currentRosterMethods(database(() => { throw new Error('offline'); })).readAcceptedCurrentRoster(mapping))
      .toMatchObject({ status: 'unavailable' });
  });

  it('reserves the exact qualified network scope with the worker fence and decodes database ordinals', async () => {
    const fence = { jobKey: 'maintenance', workerId: 'worker-one', generation: 8, deadlineAt: '2026-09-25T12:01:00.000Z' };
    const query = vi.fn(() => [{ result: { id: ids.attempt, scopeId: ids.scope, ordinal: '5', expectedGeneration: '2' } }]);
    const result = await currentRosterMethods(database(query)).beginRosterAttempt(mapping, ids.attempt, CURRENT_ROSTER_POLICY, fence);
    expect(result).toEqual({ id: ids.attempt, scopeId: ids.scope, ordinal: 5, expectedGeneration: 2 });
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, parameters] = query.mock.calls[0] as unknown as [string, readonly unknown[]];
    expect(sql).toContain('public.begin_current_roster_attempt');
    expect(parameters.map((value, index) => index === 1 ? value : JSON.parse(String(value))))
      .toEqual([mapping, ids.attempt, currentRosterScope(mapping), CURRENT_ROSTER_POLICY, fence]);
  });

  it('sends a null fence for unleased verification and permits initial generation zero', async () => {
    const query = vi.fn(() => [{ result: { id: ids.attempt, scopeId: ids.scope, ordinal: 1, expectedGeneration: 0 } }]);
    expect(await currentRosterMethods(database(query)).beginRosterAttempt(mapping, ids.attempt))
      .toMatchObject({ ordinal: 1, expectedGeneration: 0 });
    expect((query.mock.calls[0] as unknown as [string, readonly unknown[]])[1][4]).toBeNull();
  });

  it('rejects invalid mappings before querying and rejects malformed reservation replies', async () => {
    const query = vi.fn(() => []);
    await expect(currentRosterMethods(database(query)).beginRosterAttempt({ ...mapping, generation: 0 }, ids.attempt)).rejects.toThrow();
    expect(await currentRosterMethods(database(query)).readAcceptedCurrentRoster({ ...mapping, generation: 0 }))
      .toEqual({ status: 'unavailable', reason: 'invalid_mapping' });
    expect(query).not.toHaveBeenCalled();
    for (const rows of [[], [{ result: { id: ids.attempt, scopeId: ids.scope, ordinal: 0, expectedGeneration: 0 } }],
      [{ result: { id: ids.attempt, scopeId: ids.scope, ordinal: 1, expectedGeneration: -1 } }]]) {
      await expect(currentRosterMethods(database(() => rows)).beginRosterAttempt(mapping, ids.attempt)).rejects.toThrow();
    }
  });

  it('keeps disabled persistence from inspecting inputs or fabricating an attempt', async () => {
    const unreadable = new Proxy({} as AdministrationSourceMapping, { get() { throw new Error('must not inspect'); } });
    const store = createLeagueAdministrationStore({ enabled: false, reason: 'preview-persistence-disabled' });
    expect(await store.readAcceptedCurrentRoster(unreadable)).toEqual({ status: 'disabled' });
    await expect(store.beginRosterAttempt(unreadable, ids.attempt)).rejects.toThrow('Administration persistence disabled');
  });
});
