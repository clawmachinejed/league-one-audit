import { describe, expect, it, vi } from 'vitest';
import type { DatabaseClient, DatabaseRow } from '../../database';
import { CURRENT_ROSTER_POLICY, currentRosterScope } from '../../aggregator/current-roster';
import { OFFICIAL_STANDINGS_VERSION, projectOfficialStandings } from '../../aggregator/official-standings';
import type { AdministrationEnvelope, JsonValue, PublicCaptureWitness } from '../contracts';
import { normalizeAdministrationObservation } from '../normalize';
import { createLeagueAdministrationStore } from '../store';
import { OFFICIAL_STANDINGS_SQL, officialStandingsMethods, readOfficialStandingsRows } from './official-standings';
vi.mock('server-only', () => ({}));
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = '2026-10-11T12:00:00.000Z';
const mapping = { connectionId: id(1), leagueSeasonId: id(2), revisionId: id(3), generation: 1,
  scope: { leagueKey: 'cp13-unit', provider: 'sleeper' as const, externalLeagueId: '9876543210', season: 2026 } };
const witness: PublicCaptureWitness = { version: 'public-network-capture-v1',
  work: { requestId: id(10), revision: 3, kind: 'core', externalLeagueId: mapping.scope.externalLeagueId, season: 2026 },
  fence: { jobKey: 'league-administration-public-intake', workerId: id(11), generation: 2, deadlineAt: '2026-10-11T12:00:20.000Z' },
  dispatchNonce: id(12), mapping, attempts: { players: { id: id(6), nonce: id(16) },
    settings: { id: id(17), nonce: id(18) }, managers: { id: id(19), nonce: id(20) } } };
const settings = { wins: 4, losses: 1, ties: 0, fpts: 512, fpts_decimal: 37, fpts_against: 499, fpts_against_decimal: 0 };
function fixture(payload: JsonValue = [{ roster_id: 1, players: null, owner_id: { malformed: true }, settings }],
  expected: number | null = null, completeness: AdministrationEnvelope['completeness'] = 'complete') {
  const provenance = { origin: 'network' as const, requestStartedAt: at, requestCompletedAt: at, sourceObservedAt: at, checkedAt: at, acquisition: witness };
  const normalized = normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1',
    dialect: 'sleeper-nfl-v1', scope: mapping.scope, family: 'rosters', week: null, completeness, provenance, payload });
  const projection = projectOfficialStandings(normalized);
  const configuration = expected === null ? null : normalizeAdministrationObservation({ ...normalized.envelope, family: 'league', completeness: 'complete',
    payload: { league_id: mapping.scope.externalLeagueId, season: '2026', sport: 'nfl', total_rosters: expected,
      roster_positions: ['QB'], scoring_settings: {}, settings: { type: 0 } } });

  const population = expected === null ? 'unproved' : projection.status === 'qualified' && expected === projection.teams.length ? 'proven' : 'mismatch';
  const entitySet = projection.status !== 'qualified' ? 'unknown' : completeness === 'complete' && population === 'proven' ? 'full'
    : population === 'mismatch' || completeness === 'partial' ? 'partial' : 'unknown';
  const record = projection.status !== 'qualified' || !projection.teams.length ? 'unknown' : projection.teams.every(team =>
    Object.values(team.record).every(field => field.state === 'known') && team.pointsFor.state === 'known' && team.pointsAgainst.state === 'known') ? 'complete' : 'partial';
  const reasons = [...projection.reasons, ...(population === 'unproved' ? ['standings_population_unproved'] : population === 'mismatch' ? ['standings_population_mismatch'] : []),
    ...(completeness === 'partial' ? ['standings_capture_partial'] : []), ...(record !== 'complete' ? ['standings_record_fields_incomplete'] : [])];
  const row = { identity: { scope: currentRosterScope(mapping), policy: CURRENT_ROSTER_POLICY }, league_season_id: id(2),
    attempt_id: id(6), ordinal: '3', source_mapping: mapping, capture_nonce: id(16), write_fence: witness.fence, reserved_at: at,
    population_after_reservation: false,
    receipt_id: id(5), content_id: id(8), legacy_observation_id: id(7), provenance, configuration_content_id: expected === null ? null : id(9),
    population_evidence: configuration === null ? null : { provenance, contentHash: configuration.contentHash, observationId: id(21) }, expected_team_count: expected,
    configuration_content: configuration === null ? null : { id: id(9), league_season_id: mapping.leagueSeasonId, provider: 'sleeper',
      external_league_id: mapping.scope.externalLeagueId, family: 'league', week: 0, normalizer_version: 'sleeper-administration-v1',
      accepted: true, completeness: 'complete', content_hash: configuration.contentHash, payload: configuration.envelope.payload },
    population_observation: configuration === null ? null : { id: id(21), content_id: id(9), league_season_id: mapping.leagueSeasonId, family: 'league', week: 0 },
    provider: 'sleeper', external_league_id: mapping.scope.externalLeagueId, family: 'rosters', week: 0,
    content_hash: normalized.contentHash, semantic_hash: normalized.semanticHash, payload, normalizer_version: 'sleeper-administration-v1', completeness,
    observation_content_id: id(8), observation_league_season_id: id(2), first_receipt_content_id: id(8),
    qualification: { receipt_id: id(5), content_id: id(8), attempt_id: id(6), attempt_ordinal: 3, source_mapping: mapping,
      value_version: OFFICIAL_STANDINGS_VERSION, expected_team_count: expected, population_state: population, entity_set: entitySet,
      record_completeness: record, reasons, intake_id: id(10), worker_id: id(11), generation: 2 },
    value_header: { content_id: id(8), first_receipt_id: id(5), value_version: OFFICIAL_STANDINGS_VERSION,
      structural_status: projection.status, team_count: projection.teams.length, reasons: projection.reasons }, typed_value: projection,
    identities: projection.teams.map((team, index) => ({ externalRosterId: team.externalRosterId, seasonTeamId: id(30 + index),
      identityLeagueSeasonId: id(2), identityProvider: 'sleeper', identityExternalLeagueId: mapping.scope.externalLeagueId,
      identityExternalRosterId: team.externalRosterId })) };
  return { row, normalized, projection };
}
function unwitnessedFixture() {
  const { row } = fixture(undefined, 1);
  const provenance = { origin: row.provenance.origin, requestStartedAt: at, requestCompletedAt: at, sourceObservedAt: at, checkedAt: at };
  return { ...row, provenance, population_after_reservation: true,
    population_evidence: { ...row.population_evidence, provenance },
    qualification: { ...row.qualification, intake_id: null, worker_id: null, generation: null } };
}
const unprovedQualification = (row: { qualification: Record<string, unknown> }) => ({ ...row.qualification,
  expected_team_count: null, population_state: 'unproved', entity_set: 'unknown', reasons: ['standings_population_unproved'] });
const read = (row: DatabaseRow) => readOfficialStandingsRows([row], mapping, {});
function database(query: (sql: string, values: readonly unknown[]) => readonly DatabaseRow[]): DatabaseClient {
  return { enabled: true, async query<Row extends DatabaseRow>(sql: string, values: readonly unknown[] = []) { return query(sql, values) as readonly Row[]; } };
}

describe('independent stored official standings', () => {
  it('preserves official facts from a roster rejected for unrelated ownership and players', () => {
    const f = fixture(); expect(f.normalized.status).toBe('rejected');
    expect(read(f.row)).toMatchObject({ status: 'available', selection: 'current', freshness: 'unknown', temporalContext: 'season-to-date',
      historicalApplicability: 'unverified', capture: { rosterReceiptId: id(5), expectedTeamCount: null },
      coverage: { population: 'unproved', entitySet: 'unknown', recordCompleteness: 'complete' },
      teams: [{ seasonTeamId: id(30), pointsFor: { value: '512.37' }, record: { wins: { value: 4 } }, providerRank: { state: 'absent' } }] });
    expect(readOfficialStandingsRows([f.row], mapping, { rosterReceiptId: id(5) })).toMatchObject({ status: 'available', selection: 'receipt' });
  });
  it('keeps population count, document completeness and field coverage separate', () => {
    expect(read(fixture(undefined, 1).row)).toMatchObject({ status: 'available', coverage: { entitySet: 'full', population: 'proven' } });
    expect(read(fixture(undefined, 2).row)).toMatchObject({ status: 'available', coverage: { entitySet: 'partial', population: 'mismatch' } });
    expect(read(fixture(undefined, 1, 'partial').row)).toMatchObject({ status: 'available', coverage: { entitySet: 'partial', population: 'proven' } });
    expect(read(fixture([{ roster_id: 1, settings: { wins: 0, losses: null, ties: '0', fpts: 0, fpts_decimal: null } }], 1).row))
      .toMatchObject({ status: 'available', coverage: { entitySet: 'full', recordCompleteness: 'partial' }, teams: [{ record: {
        wins: { state: 'known', value: 0 }, losses: { state: 'null', value: null }, ties: { state: 'invalid', value: null } }, pointsFor: { state: 'null', value: null } }] });
  });
  it('qualifies fresh native population independently of a null legacy scoring-gated count', () => {
    const { row } = fixture(undefined, 1);
    expect(read({ ...row, expected_team_count: null })).toMatchObject({ status: 'available',
      capture: { expectedTeamCount: 1 }, coverage: { entitySet: 'full', population: 'proven' } });
  });
  it('rejects claimed full population without the exact linked native league and observation proof', () => {
    const { row } = fixture(undefined, 1);
    const configuration = row.configuration_content!;
    for (const patch of [
      { configuration_content: null }, { population_observation: null },
      { configuration_content: { ...configuration, accepted: false } },
      { configuration_content: { ...configuration, external_league_id: '9999' } },
      { configuration_content: { ...configuration, content_hash: 'wrong' } },
      { configuration_content: { ...configuration, payload: { league_id: mapping.scope.externalLeagueId, season: '2026', sport: 'nfl', total_rosters: '1' } } },
      { population_observation: { ...row.population_observation, content_id: id(99) } },
    ]) expect(read({ ...row, ...patch }).status).toBe('unavailable');
  });
  it('qualifies an unwitnessed count only when its original population request followed reservation', () => {
    const unwitnessed = unwitnessedFixture();
    expect(read(unwitnessed)).toMatchObject({ status: 'available', coverage: { population: 'proven' } });
    expect(read({ ...unwitnessed, population_after_reservation: false, population_evidence: { ...unwitnessed.population_evidence,
      provenance: { ...unwitnessed.provenance, requestStartedAt: '2026-10-10T12:00:00.000Z' } },
      qualification: unprovedQualification(unwitnessed) }))
      .toMatchObject({ status: 'available', capture: { expectedTeamCount: null }, coverage: { entitySet: 'unknown', population: 'unproved' } });
  });
  it.each(['Date', 'string'] as const)('consumes database population ordering with a %s reservation', representation => {
    const row = unwitnessedFixture();
    const reservation = '2026-10-11T12:00:00.123456Z';
    for (const [requestStartedAt, fresh] of [
      ['2026-10-11T12:00:00.100000Z', false],
      ['2026-10-11T12:00:00.123455Z', false],
      [reservation, true],
      ['2026-10-11T12:00:00.123457Z', true],
    ] as const) {
      const result = read({ ...row, reserved_at: representation === 'Date' ? new Date(reservation) : reservation,
        population_after_reservation: fresh,
        population_evidence: { ...row.population_evidence, provenance: { ...row.provenance, requestStartedAt } },
        qualification: fresh ? row.qualification : unprovedQualification(row) });
      expect(result).toMatchObject({ status: 'available', capture: { expectedTeamCount: fresh ? 1 : null },
        coverage: { population: fresh ? 'proven' : 'unproved', entitySet: fresh ? 'full' : 'unknown' } });
    }
  });
  it.each([undefined, null])('retains unproved coverage for a database-false missing population timestamp: %s', requestStartedAt => {
    const row = unwitnessedFixture();
    expect(read({ ...row, population_after_reservation: false,
      population_evidence: { ...row.population_evidence, provenance: { ...row.provenance, requestStartedAt } },
      qualification: unprovedQualification(row) })).toMatchObject({ status: 'available',
      capture: { expectedTeamCount: null }, coverage: { population: 'unproved', entitySet: 'unknown' } });
  });
  it.each([undefined, null, 'true', 'false', 0, 1, {}, []])('fails closed for a nonboolean population time result: %j', populationAfterReservation => {
    for (const row of [fixture(undefined, 1).row, unwitnessedFixture()]) {
      expect(read({ ...row, population_after_reservation: populationAfterReservation }))
        .toEqual({ status: 'unavailable', reason: 'official_standings_evidence_unavailable' });
    }
  });
  it('fails closed when the population time result column is absent', () => {
    const row: Record<string, unknown> = { ...fixture(undefined, 1).row };
    delete row.population_after_reservation;
    expect(read(row)).toEqual({ status: 'unavailable', reason: 'official_standings_evidence_unavailable' });
  });
  it.each([false, true])('keeps matching witnesses independent of the temporal result: %s', populationAfterReservation => {
    const { row } = fixture(undefined, 1);
    expect(read({ ...row, population_after_reservation: populationAfterReservation,
      population_evidence: { ...row.population_evidence,
        provenance: { ...row.provenance, requestStartedAt: '2026-10-10T12:00:00.000Z' } } }))
      .toMatchObject({ status: 'available', capture: { expectedTeamCount: 1 }, coverage: { population: 'proven' } });
  });
  it.each([false, true])('still rejects a matching malformed witness with temporal result %s', populationAfterReservation => {
    const { row } = fixture(undefined, 1);
    const provenance = { ...row.provenance, acquisition: { ...witness, dispatchNonce: 'invalid' } };
    expect(read({ ...row, population_after_reservation: populationAfterReservation, provenance,
      population_evidence: { ...row.population_evidence, provenance } }))
      .toEqual({ status: 'unavailable', reason: 'official_standings_evidence_unavailable' });
  });
  it('retains partial native facts with an explicitly unknown source observation time', () => {
    const { row } = fixture(undefined, null, 'partial');
    expect(read({ ...row, provenance: { ...row.provenance, sourceObservedAt: null } })).toMatchObject({ status: 'available',
      capture: { provenance: { sourceObservedAt: null } }, freshness: 'unknown', coverage: { entitySet: 'partial', population: 'unproved' } });
  });
  it.each([false, true])('does not upgrade another acquisition with temporal result %s', populationAfterReservation => {
    const { row } = fixture(undefined, 1);
    const olderPopulation = { ...row, population_after_reservation: populationAfterReservation,
      qualification: unprovedQualification(row), population_evidence: { ...row.population_evidence,
        provenance: { ...row.provenance, acquisition: { ...witness, dispatchNonce: id(99) } } } };
    expect(read(olderPopulation)).toMatchObject({ status: 'available', capture: { expectedTeamCount: null }, coverage: { entitySet: 'unknown', population: 'unproved' } });
    expect(read({ ...olderPopulation, qualification: row.qualification })).toEqual({ status: 'unavailable', reason: 'official_standings_evidence_unavailable' });
  });
  it('selects a latest attempt with no capture as unavailable and legacy unqualified capture as missing', () => {
    expect(read({ ...fixture().row, receipt_id: null, population_after_reservation: undefined })).toEqual({ status: 'unavailable', reason: 'latest_roster_attempt_has_no_capture' });
    expect(read({ ...fixture().row, qualification: null, population_after_reservation: undefined })).toEqual({ status: 'missing', reason: 'typed_standings_not_recorded' });
    expect(readOfficialStandingsRows([], mapping, {})).toEqual({ status: 'missing', reason: 'roster_capture_missing' });
  });
  it.each([null, [{ roster_id: 1 }, { roster_id: 1 }], Array.from({ length: 21 }, (_, i) => ({ roster_id: i + 1 }))])(
    'withholds malformed/duplicate/capacity captures instead of falling back: %j', payload => {
      const result = read(fixture(payload).row); expect(result.status).toBe('unavailable');
      expect(result).not.toHaveProperty('teams');
    });
  it('retains an empty capture without inventing zero records or full membership', () => {
    expect(read(fixture([]).row)).toMatchObject({ status: 'available', teams: [], coverage: { entitySet: 'unknown', recordCompleteness: 'unknown' } });
  });
  it.each(['source_mapping', 'content_hash', 'typed_value', 'observation_content_id', 'first_receipt_content_id', 'capture_nonce', 'write_fence'])(
    'fails closed for corrupt %s', key => {
      expect(read({ ...fixture().row, [key]: 'forged' })).toEqual({ status: 'unavailable', reason: 'official_standings_evidence_unavailable' });
    });
  it('rejects coherent wrong request/attempt markers, foreign canonical identities, forged coverage and receipt substitution', () => {
    const { row } = fixture();
    for (const patch of [
      { qualification: { ...row.qualification, intake_id: id(99) } },
      { qualification: { ...row.qualification, record_completeness: 'partial' } },
      { identities: [{ ...row.identities[0], identityLeagueSeasonId: id(99) }] },
      { provenance: { ...row.provenance, acquisition: { ...witness, attempts: { ...witness.attempts, players: { id: id(90), nonce: id(91) } } } } },
    ]) expect(read({ ...row, ...patch }).status).toBe('unavailable');
    expect(readOfficialStandingsRows([row], mapping, { rosterReceiptId: id(90) }).status).toBe('unavailable');
    expect(readOfficialStandingsRows([row, row], mapping, {}).status).toBe('unavailable');
  });
  it('returns original source order and separate receipts for a reordered correction', () => {
    const first = fixture([{ roster_id: 2, settings }, { roster_id: 1, settings }]);
    const second = fixture([{ roster_id: 1, settings }, { roster_id: 2, settings }]);
    expect(first.normalized.contentHash).not.toBe(second.normalized.contentHash);
    expect(read(first.row)).toMatchObject({ teams: [{ externalRosterId: '2' }, { externalRosterId: '1' }] });
    expect(read(second.row)).toMatchObject({ teams: [{ externalRosterId: '1' }, { externalRosterId: '2' }] });
  });
  it('uses one bounded SELECT, latest attempt before qualification, and no player acceptance', async () => {
    const query = vi.fn(() => [fixture().row]); const methods = officialStandingsMethods(database(query));
    expect((await methods.readOfficialStandings(mapping, { rosterReceiptId: id(5) })).status).toBe('available');
    expect(query).toHaveBeenCalledExactlyOnceWith(OFFICIAL_STANDINGS_SQL,
      [JSON.stringify({ scope: currentRosterScope(mapping), policy: CURRENT_ROSTER_POLICY }), id(3), 1, id(5)]);
    expect(OFFICIAL_STANDINGS_SQL).toContain('attempt.ordinal=head.latest_ordinal');
    expect(OFFICIAL_STANDINGS_SQL).toContain('public.roster_capture_population_evidence(receipt) AS population_evidence');
    expect(OFFICIAL_STANDINGS_SQL).not.toContain('receipt.configuration_content_id,receipt.population_evidence');
    expect(OFFICIAL_STANDINGS_SQL).toContain('LIMIT 2');
    expect(OFFICIAL_STANDINGS_SQL).not.toMatch(/league_roster_resource_acceptances|content.accepted|\b(?:UPDATE|INSERT|DELETE|fetch)\b/u);
    await methods.readOfficialStandings({ ...mapping, scope: { ...mapping.scope, season: 2025 } }); expect(query).toHaveBeenCalledOnce();
    expect(await officialStandingsMethods(database(() => { throw Error('offline'); })).readOfficialStandings(mapping)).toMatchObject({ status: 'unavailable' });
  });
  it('fails closed through the query error path for an evaluated malformed population timestamp', async () => {
    const query = vi.fn(() => { throw Error('invalid input syntax for type timestamp with time zone'); });
    expect(await officialStandingsMethods(database(query)).readOfficialStandings(mapping))
      .toEqual({ status: 'unavailable', reason: 'official_standings_evidence_unavailable' });
    expect(query).toHaveBeenCalledOnce();
  });
  it.each(['SQL NULL', 'unproved configuration'] as const)('preserves %s population evidence without inventing coverage', async kind => {
    const original = fixture().row;
    const row = { ...original, population_evidence: kind === 'SQL NULL' ? null : fixture(undefined, 1).row.population_evidence };
    const query = vi.fn(() => [row]);
    const result = await officialStandingsMethods(database(query)).readOfficialStandings(mapping);
    expect(result).toMatchObject({ status: 'available', capture: { configurationContentId: null, expectedTeamCount: null },
      coverage: { population: 'unproved', entitySet: 'unknown' }, teams: [{ pointsFor: { value: '512.37' } }] });
    expect(query).toHaveBeenCalledOnce();
  });
  it('preserves the latest missing-capture result when the accessor returns SQL NULL', async () => {
    const query = vi.fn(() => [{ ...fixture().row, receipt_id: null, population_evidence: null, population_after_reservation: false }]);
    expect(await officialStandingsMethods(database(query)).readOfficialStandings(mapping))
      .toEqual({ status: 'unavailable', reason: 'latest_roster_attempt_has_no_capture' });
    expect(query).toHaveBeenCalledOnce();
  });
  it('does not retry or borrow inline evidence after a shared population binding error', async () => {
    const query = vi.fn(() => { throw Error('Invalid shared roster population binding.'); });
    expect(await officialStandingsMethods(database(query)).readOfficialStandings(mapping, { rosterReceiptId: id(5) }))
      .toEqual({ status: 'unavailable', reason: 'official_standings_evidence_unavailable' });
    expect(query).toHaveBeenCalledOnce();
  });
  it('keeps disabled facade inert', async () => {
    const hostile = Object.defineProperty({}, 'scope', { get: () => { throw Error('must not inspect'); } });
    expect(await createLeagueAdministrationStore({ enabled: false, reason: 'missing-database-url' }).readOfficialStandings!(hostile as never))
      .toEqual({ status: 'disabled' });
  });
});
