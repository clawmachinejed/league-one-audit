import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseClient, DatabaseRow } from '../database';
import type { AdministrationEnvelope, NormalizedAdministrationObservation } from '../league-administration/contracts';
import { createLeagueAdministrationMethods } from '../league-administration/neon/administration';
import { normalizeAdministrationObservation } from '../league-administration/normalize';
import { recordCapturedAdministration, type CapturedAdministrationDocument } from '../league-administration/runtime';
import type { AdministrationWriteResult } from '../league-administration/store-contracts';
import { createPageAdministrationReader } from '../page-source';

vi.mock('server-only', () => ({}));
vi.mock('react', () => ({ cache: <T,>(value: T) => value }));

const scope = { leagueKey: 'league1', provider: 'sleeper', externalLeagueId: '1378899999999999999', season: 2026 } as const;
const seasonId = '11111111-1111-4111-8111-111111111111';
const identities = [
  { seasonTeamId: '22222222-2222-4222-8222-222222222222', externalRosterId: '1' },
  { seasonTeamId: '33333333-3333-4333-8333-333333333333', externalRosterId: '2' },
];
const checkedAt = '2026-09-28T12:00:02.000Z';
const payload = [
  { roster_id: 1, owner_id: 'manager-one', players: ['1234', '5678', 'ATL'], reserve: ['5678'], taxi: [], starters: ['1234', '0'],
    settings: { wins: 1 }, metadata: { source_extension: 'retained verbatim' } },
  { roster_id: 2, owner_id: null, players: [], reserve: null, taxi: [], starters: [] },
];

function document(overrides: Partial<CapturedAdministrationDocument> = {}): CapturedAdministrationDocument {
  return { family: 'rosters', week: null, payload, origin: 'network',
    requestStartedAt: '2026-09-28T12:00:00.000Z', requestCompletedAt: '2026-09-28T12:00:01.000Z', ...overrides };
}

const configuration: AdministrationEnvelope = {
  schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1', dialect: 'sleeper-nfl-v1',
  scope, family: 'league', week: null, completeness: 'complete',
  provenance: { origin: 'network', requestStartedAt: '2026-09-28T12:00:00.000Z',
    requestCompletedAt: '2026-09-28T12:00:01.000Z', sourceObservedAt: '2026-09-28T12:00:01.000Z', checkedAt },
  payload: { league_id: scope.externalLeagueId, season: '2026', sport: 'nfl', total_rosters: 2,
    name: 'Roster bridge fixture', scoring_settings: { pass_yd: 0.04 }, roster_positions: ['QB', 'BN'] },
};

function storedRow(input: NormalizedAdministrationObservation, generation = 1): DatabaseRow {
  const { envelope } = input;
  return { league_key: scope.leagueKey, league_season_id: seasonId, season: scope.season,
    provider: scope.provider, external_league_id: scope.externalLeagueId, observed_external_league_id: scope.externalLeagueId,
    generation, checked_at: envelope.provenance.checkedAt, verified_at: envelope.provenance.sourceObservedAt,
    observation_checked_at: envelope.provenance.checkedAt, read_conflict: null,
    observation_id: `44444444-4444-4444-8444-${String(generation).padStart(12, '0')}`,
    content_id: `55555555-5555-4555-8555-${String(generation).padStart(12, '0')}`, content_hash: input.contentHash,
    origin: envelope.provenance.origin, request_started_at: envelope.provenance.requestStartedAt,
    request_completed_at: envelope.provenance.requestCompletedAt, source_observed_at: envelope.provenance.sourceObservedAt,
    configuration_version_id: envelope.family === 'league' ? '66666666-6666-4666-8666-666666666666' : null,
    normalizer_version: envelope.normalizerVersion, completeness: envelope.completeness,
    payload: envelope.payload, normalized_value: input.value, family: envelope.family, week: envelope.week ?? 0,
    roster_team_identities: identities };
}

/** Scripted SQL results exercise the actual runtime/adapter/page path. They do
 * not implement, simulate, or qualify Postgres acceptance and concurrency. */
function path(writeStatuses: readonly AdministrationWriteResult['status'][] = ['changed']) {
  const writes: NormalizedAdministrationObservation[] = [];
  const queries: { sql: string; parameters: readonly unknown[] }[] = [];
  let rosterRows: readonly DatabaseRow[] = [];
  let unavailable = false;
  const configRow = storedRow(normalizeAdministrationObservation(configuration));
  const client: DatabaseClient = { enabled: true, async query<Row extends DatabaseRow>(sql: string, parameters: readonly unknown[] = []) {
    queries.push({ sql, parameters });
    if (sql.includes('league-administration:record-observation')) {
      const input = JSON.parse(String(parameters[0])) as NormalizedAdministrationObservation;
      writes.push(input);
      const status = writeStatuses[writes.length - 1];
      if (!status) throw new Error('Unexpected write in the scripted transport fixture.');
      return [{ result: { status, observationId: '44444444-4444-4444-8444-000000000001',
        generation: 1, leagueSeasonId: seasonId } }] as unknown as readonly Row[];
    }
    if (unavailable) throw new Error('Scripted database unavailable.');
    if (sql.includes('league-administration:read-source-by-connection')) return [configRow] as unknown as readonly Row[];
    if (sql.includes('league-administration:read-source')) return rosterRows as readonly Row[];
    throw new Error('Unexpected query in the scripted transport fixture.');
  } };
  const store = { enabled: true, ...createLeagueAdministrationMethods(client) };
  return {
    writes, queries, store,
    capture: (source = document()) => recordCapturedAdministration(scope, [source], {
      store, expectedRosterCount: 2, now: () => new Date(checkedAt),
    }),
    selectAcceptedCapture(index: number, generation = 1, overrides: DatabaseRow = {}) {
      rosterRows = [{ ...storedRow(writes[index], generation), ...overrides }];
    },
    failReads() { unavailable = true; },
    read: () => createPageAdministrationReader(() => store)({ ...scope, family: 'rosters', week: null }),
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-28T12:00:30.000Z'));
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('The retained roster path must not call a provider.'); }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('retained roster path adapter replay conformance (not SQL acceptance proof)', () => {
  it('writes the original capture once and projects the accepted stored roster without another source request', async () => {
    const fixture = path();
    expect(await fixture.capture()).toMatchObject({ status: 'stored', results: [{ result: { status: 'changed' } }] });
    fixture.selectAcceptedCapture(0);
    const read = await fixture.read();
    expect(read).toMatchObject({ status: 'available', payload, commonRoster: {
      status: 'available', kind: 'legacy-retained-roster', schemaVersion: 'aggregator-roster-v1',
      normalizerVersion: 'sleeper-roster-bridge-v1', scope: { ...scope, leagueSeasonId: seasonId },
      lineage: { observationId: '44444444-4444-4444-8444-000000000001',
        rawContentRef: '55555555-5555-4555-8555-000000000001', rawContentHash: fixture.writes[0].contentHash,
        generation: 1, sourceMappingRevisionId: null, reasons: ['mapping_revision_not_captured'] },
      source: { sourceUpdatedAt: null, sourceObservedAt: document().requestCompletedAt, checkedAt },
      teams: identities.map(({ seasonTeamId }) => ({ seasonTeamId })),
      comparison: { status: 'equal', fields: ['players', 'reserve', 'taxi'] },
    } });
    expect(fixture.writes[0].envelope.payload).toEqual(payload);
    expect(fixture.queries).toHaveLength(3); // One existing write; configuration and roster reads.
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['replayed', 'unchanged'] as const)('retains the accepted observation on a %s writer response', async (status) => {
    const fixture = path(['changed', status]);
    await fixture.capture();
    fixture.selectAcceptedCapture(0);
    const first = await fixture.read();
    expect(await fixture.capture()).toMatchObject({ status: 'stored', results: [{ result: { status } }] });
    expect(fixture.writes[1]).toEqual(fixture.writes[0]);
    expect(await fixture.read()).toEqual(first);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('projects a corrected accepted capture with the existing season-team identities and leaves prior evidence intact', async () => {
    const fixture = path(['changed', 'changed']);
    await fixture.capture();
    fixture.selectAcceptedCapture(0);
    const prior = await fixture.read();
    const correctedPayload = [{ ...payload[0], players: ['new-player'], reserve: [], taxi: [] }, payload[1]];
    await fixture.capture(document({ payload: correctedPayload,
      requestStartedAt: '2026-09-28T12:00:01.100Z', requestCompletedAt: '2026-09-28T12:00:01.900Z' }));
    fixture.selectAcceptedCapture(1, 2);
    expect(await fixture.read()).toMatchObject({ status: 'available', payload: correctedPayload,
      commonRoster: { status: 'available', lineage: { generation: 2,
        observationId: '44444444-4444-4444-8444-000000000002' },
      teams: identities.map(({ seasonTeamId }) => ({ seasonTeamId })) } });
    expect(fixture.writes[1].contentHash).not.toBe(fixture.writes[0].contentHash);
    expect(fixture.writes[0].envelope.payload).toEqual(payload);
    expect(prior).toMatchObject({ payload, commonRoster: { lineage: { generation: 1 } } });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    { label: 'partial', status: 'rejected', source: document({ payload: [payload[0]], completeness: 'partial' }) },
    { label: 'malformed', status: 'rejected', source: document({ payload: [{ roster_id: 1 }, { roster_id: 1 }] }) },
    { label: 'older observation', status: 'stale', source: document({ payload: [{ ...payload[0], players: [] }, payload[1]],
      requestStartedAt: '2026-09-28T11:59:58.000Z', requestCompletedAt: '2026-09-28T11:59:59.000Z' }) },
  ] as const)('follows the retained head after a $label attempt instead of publishing that attempt', async ({ status, source }) => {
    const fixture = path(['changed', status]);
    await fixture.capture();
    fixture.selectAcceptedCapture(0);
    const prior = await fixture.read();
    expect(await fixture.capture(source)).toMatchObject({ status: 'unavailable', results: [{ result: { status } }] });
    expect(await fixture.read()).toEqual(prior);
    expect(fixture.writes).toHaveLength(2);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps raw roster reads usable when canonical team identity evidence is unavailable', async () => {
    const fixture = path();
    await fixture.capture();
    fixture.selectAcceptedCapture(0, 1, { roster_team_identities: [] });
    expect(await fixture.read()).toMatchObject({ status: 'available', payload, commonRoster: { status: 'unavailable' } });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('preserves the existing missing, stale and unavailable fallbacks without publishing shadow data', async () => {
    const fixture = path();
    expect(await fixture.read()).toEqual({ status: 'fallback', reason: 'missing' });
    await fixture.capture();
    fixture.selectAcceptedCapture(0, 1, { verified_at: '2026-09-28T11:58:00.000Z' });
    expect(await fixture.read()).toEqual({ status: 'fallback', reason: 'stale' });
    fixture.failReads();
    expect(await fixture.read()).toEqual({ status: 'fallback', reason: 'unavailable' });
    expect(fetch).not.toHaveBeenCalled();
  });
});
