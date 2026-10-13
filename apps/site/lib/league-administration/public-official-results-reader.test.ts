import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseClient, DatabaseRow } from '../database';
import { OFFICIAL_STANDINGS_VERSION, type OfficialStandingsRead } from '../aggregator/official-standings';
import { EXACT_MATCHUP_VALUES_VERSION, type ExactMatchupValuesRead } from '../aggregator/exact-matchup-values';
import { BRACKET_VALUE_VERSION, type AcceptedBracketRead, type BracketFamily } from '../aggregator/playoff-brackets';
import { PUBLIC_PLAYOFF_BRACKETS } from './public-intake-contracts';
import type { PublicCaptureWitness } from './contracts';
import { createLeagueAdministrationStore } from './store';
import { readPublicSleeperIntake } from './public-intake-reader';
import { readPublicDataRefresh } from './public-refresh-reader';
import { PUBLIC_OFFICIAL_STANDINGS_SQL, readPublicOfficialStandings, readPublicOfficialStandingsRows } from './public-official-results-reader';
vi.mock('server-only', () => ({}));
afterEach(() => vi.unstubAllGlobals());
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = '2026-10-11T12:00:00.000Z', requestId = id(10);
const mapping = { connectionId: id(1), leagueSeasonId: id(2), revisionId: id(3), generation: 1,
  scope: { leagueKey: 'cp13-unit', provider: 'sleeper' as const, externalLeagueId: '9876543210', season: 2026 } };
function fixture() {
  const witness: PublicCaptureWitness = { version: 'public-network-capture-v1',
    work: { requestId, revision: 3, kind: 'core', externalLeagueId: mapping.scope.externalLeagueId, season: 2026 },
    fence: { jobKey: 'league-administration-public-intake', workerId: id(11), generation: 2, deadlineAt: '2026-10-11T12:00:20.000Z' },
    dispatchNonce: id(12), mapping, attempts: { players: { id: id(6), nonce: id(16) },
      settings: { id: id(17), nonce: id(18) }, managers: { id: id(19), nonce: id(20) } } };
  const provenance = { origin: 'network' as const, requestStartedAt: at, requestCompletedAt: at, sourceObservedAt: at, checkedAt: at, acquisition: witness };
  const resource: OfficialStandingsRead = { status: 'available', version: OFFICIAL_STANDINGS_VERSION, selection: 'receipt', mapping,
    capture: { rosterReceiptId: id(5), attemptId: id(6), ordinal: 3, contentId: id(8), legacyObservationId: id(7), provenance,
      configurationContentId: null, expectedTeamCount: null }, temporalContext: 'season-to-date', historicalApplicability: 'unverified', freshness: 'unknown',
    coverage: { entitySet: 'unknown', recordCompleteness: 'unknown', population: 'unproved', reasons: ['standings_population_unproved', 'standings_record_fields_incomplete'] }, teams: [] };
  const row = { intake_id: requestId, revision: 3, work: witness.work, worker_id: id(11), generation: 2,
    dispatch_nonce: id(12), attempt_id: id(6), attempt_nonce: id(16), source_mapping: mapping, write_fence: witness.fence,
    receipt_id: id(5), provenance, qualified_intake_id: requestId, qualified_worker_id: id(11), qualified_generation: 2, qualified_receipt_id: id(5) };
  const administration = { ...createLeagueAdministrationStore({ enabled: false, reason: 'missing-database-url' }), enabled: true,
    readSourceMapping: vi.fn(async () => mapping), readOfficialStandings: vi.fn(async (): Promise<OfficialStandingsRead> => resource) };
  return { witness, row, resource, administration };
}
function database(query: (sql: string, values: readonly unknown[]) => readonly DatabaseRow[]): DatabaseClient {
  return { enabled: true, async query<Row extends DatabaseRow>(sql: string, values: readonly unknown[] = []) { return query(sql, values) as readonly Row[]; } };
}
function intakeFixture() {
  const f = fixture();
  const query = vi.fn((sql: string, values: readonly unknown[]): readonly DatabaseRow[] => {
    if (sql.includes('public-data-intake:read-request')) return [{ id: requestId, seasons: [2026], terminal: true, external_manager_id: '777' }];
    if (sql.includes('public-data-intake:read-lists')) return [{ season: 2026, request_completed_at: at }];
    if (sql.includes('public-data-intake:read-candidates')) return [{ season: 2026, external_league_id: mapping.scope.externalLeagueId,
      name: 'Independent standings', stage: 'unavailable', league_season_id: mapping.leagueSeasonId }];
    if (sql.includes('public-data-intake:read-rejections')) return [];
    if (sql === PUBLIC_OFFICIAL_STANDINGS_SQL) { expect(values[0]).toBe(requestId); return [f.row]; }
    throw Error('Unexpected query');
  });
  return { ...f, query, client: database(query) };
}

describe('request-bound independent official standings', () => {
  it('reads a retained failed-core receipt using original dispatch, without a completion checkpoint', async () => {
    const f = fixture(), fetch = vi.fn(() => { throw Error('no provider reads'); }); vi.stubGlobal('fetch', fetch);
    const result = await readPublicOfficialStandingsRows([f.row], f.administration, requestId, mapping);
    expect(result).toEqual({ captureBinding: 'intake-dispatch', resource: f.resource,
      acquisition: { requestId, revision: 3, workerId: id(11), generation: 2, dispatchNonce: id(12), rosterReceiptId: id(5), attemptId: id(6) } });
    expect(f.administration.readOfficialStandings).toHaveBeenCalledExactlyOnceWith(mapping, { rosterReceiptId: id(5) });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('does not replace a missing newest capture with an earlier valid receipt', async () => {
    const f = fixture();
    expect(await readPublicOfficialStandingsRows([{ ...f.row, receipt_id: null }], f.administration, requestId, mapping))
      .toMatchObject({ resource: { status: 'unavailable', reason: 'intake-core-has-no-roster-capture' }, acquisition: null });
    expect(f.administration.readOfficialStandings).not.toHaveBeenCalled();
    expect(PUBLIC_OFFICIAL_STANDINGS_SQL.indexOf('ORDER BY dispatch.revision')).toBeLessThan(PUBLIC_OFFICIAL_STANDINGS_SQL.indexOf('LEFT JOIN public.league_roster_capture_receipts'));
    expect(PUBLIC_OFFICIAL_STANDINGS_SQL).not.toContain('core_checkpoint');
  });
  it.each(['intake_id', 'dispatch_nonce', 'attempt_nonce', 'qualified_intake_id', 'qualified_worker_id', 'qualified_receipt_id'])(
    'rejects wrong %s before invoking exact read', async key => {
      const f = fixture(); expect(await readPublicOfficialStandingsRows([{ ...f.row, [key]: id(99) }], f.administration, requestId, mapping))
        .toMatchObject({ resource: { status: 'unavailable' }, acquisition: null });
      expect(f.administration.readOfficialStandings).not.toHaveBeenCalled();
    });
  it('rejects a coherent receipt from an older dispatch despite valid receipt and native facts', async () => {
    const f = fixture();
    const older = { ...f.row, provenance: { ...f.row.provenance, acquisition: { ...f.witness,
      work: { ...f.witness.work, revision: 2 }, fence: { ...f.witness.fence, generation: 1 }, dispatchNonce: id(98) } } };
    expect(await readPublicOfficialStandingsRows([older], f.administration, requestId, mapping)).toMatchObject({ resource: { status: 'unavailable' } });
    expect(f.administration.readOfficialStandings).not.toHaveBeenCalled();
  });
  it('rejects returned current-head, foreign receipt, provenance and mapping substitutions', async () => {
    for (const mutate of [
      (r: Extract<OfficialStandingsRead, { status: 'available' }>) => ({ ...r, selection: 'current' as const }),
      (r: Extract<OfficialStandingsRead, { status: 'available' }>) => ({ ...r, capture: { ...r.capture, rosterReceiptId: id(99) } }),
      (r: Extract<OfficialStandingsRead, { status: 'available' }>) => ({ ...r, capture: { ...r.capture, provenance: { ...r.capture.provenance, sourceObservedAt: '2026-10-10T12:00:00.000Z' } } }),
      (r: Extract<OfficialStandingsRead, { status: 'available' }>) => ({ ...r, mapping: { ...mapping, revisionId: id(99) } }),
    ]) {
      const f = fixture(); f.administration.readOfficialStandings.mockResolvedValue(mutate(f.resource));
      expect(await readPublicOfficialStandingsRows([f.row], f.administration, requestId, mapping)).toMatchObject({ resource: { status: 'unavailable' }, acquisition: null });
    }
  });
  it('distinguishes legacy unqualified, no dispatch, ambiguous dispatch and storage failure', async () => {
    const f = fixture();
    expect(await readPublicOfficialStandingsRows([{ ...f.row, qualified_receipt_id: null }], f.administration, requestId, mapping))
      .toMatchObject({ resource: { status: 'missing', reason: 'typed_standings_not_recorded' } });
    expect(await readPublicOfficialStandingsRows([], f.administration, requestId, mapping)).toMatchObject({ resource: { reason: 'intake-core-not-dispatched' } });
    expect(await readPublicOfficialStandingsRows([f.row, f.row], f.administration, requestId, mapping)).toMatchObject({ resource: { status: 'unavailable' } });
    expect(await readPublicOfficialStandings(database(() => { throw Error('offline'); }), f.administration, requestId, mapping))
      .toMatchObject({ resource: { reason: 'intake-official-standings-read-failed' } });
  });
});

describe('additive DATA official-results composition', () => {
  it('makes no new queries or output when the selector is omitted', async () => {
    const f = intakeFixture(); const result = await readPublicSleeperIntake(f.client, f.administration, requestId);
    expect(result).not.toHaveProperty('officialResults');
    expect(f.administration.readOfficialStandings).not.toHaveBeenCalled();
    expect(f.query).toHaveBeenCalledTimes(4);
  });
  it('exposes independent standings after core failure without upgrading legacy completion or freshness', async () => {
    const f = intakeFixture(); const result = await readPublicSleeperIntake(f.client, f.administration, requestId, { officialResultsVersion: 'v1' });
    expect(result).toMatchObject({ status: 'partial', officialResults: [{ captureBinding: 'intake-dispatch',
      resource: { status: 'available', scope: 'selected-resources', standings: f.resource, periods: [], brackets: [] } }] });
    expect(f.administration.readOfficialStandings).toHaveBeenCalledOnce();
  });
  it('composes independently timed exact period and paired bracket receipts without inventing outcomes', async () => {
    const f = intakeFixture();
    const scoreProvenance = { ...f.row.provenance, sourceObservedAt: '2026-10-04T12:00:00.000Z' };
    const scores: ExactMatchupValuesRead = { status: 'available', version: EXACT_MATCHUP_VALUES_VERSION, selection: 'receipt',
      contentId: id(51), matchupsReceiptId: id(52), acceptanceId: id(53), acceptedGeneration: 1,
      sourceMappingRevisionId: mapping.revisionId, provenance: scoreProvenance, value: { nativeWeek: 1, season: 2026, teams: [] } };
    const bracketWitness: PublicCaptureWitness = { ...f.witness,
      work: { requestId, revision: 5, kind: 'playoff-brackets', season: 2026, externalLeagueId: mapping.scope.externalLeagueId },
      fence: { ...f.witness.fence, workerId: id(61), generation: 4 }, dispatchNonce: id(62),
      attempts: { winners_bracket: { id: id(63), nonce: id(64) }, losers_bracket: { id: id(65), nonce: id(66) } } };
    const bracketProvenance = { ...f.row.provenance, acquisition: bracketWitness, sourceObservedAt: '2026-10-10T12:00:00.000Z' };
    const readBracket = vi.fn(async (_mapping: unknown, selection: { family: BracketFamily; bracketReceiptId?: string }): Promise<AcceptedBracketRead> => ({
      status: 'available', version: BRACKET_VALUE_VERSION, selection: 'receipt', contentId: id(67), bracketReceiptId: selection.bracketReceiptId!,
      acceptanceId: id(68), acceptedGeneration: 1, sourceMappingRevisionId: mapping.revisionId, provenance: bracketProvenance,
      value: { family: selection.family, season: 2026, publication: 'unpublished', matches: [], edges: [], rounds: [], limitations: [] } }));
    const administration = { ...f.administration, readExactMatchupValues: vi.fn(async () => scores), readAcceptedBracket: readBracket };
    const query = (sql: string, values: readonly unknown[]): readonly DatabaseRow[] => {
      if (sql.includes('read-request')) return [{ id: requestId, seasons: [2026], terminal: true, external_manager_id: '777',
        selected_exact_periods: [{ season: 2026, nativeWeek: 1 }], selected_playoff_brackets: PUBLIC_PLAYOFF_BRACKETS }];
      if (sql.includes('read-exact-periods')) return [{ ordinal: 1, season: 2026, native_week: 1, external_league_id: mapping.scope.externalLeagueId,
        status: 'complete', failure_count: 0, reason: null, league_season_id: mapping.leagueSeasonId, source_mapping: mapping,
        settings_receipt_id: id(54), matchups_receipt_id: id(52), configuration_content_id: id(55) }];
      if (sql.includes('read-brackets')) return [{ ordinal: 1, season: 2026, external_league_id: mapping.scope.externalLeagueId,
        status: 'complete', failure_count: 0, reason: null, league_season_id: mapping.leagueSeasonId, source_mapping: mapping,
        worker_id: id(61), generation: 4, winners_bracket_receipt_id: id(69), losers_bracket_receipt_id: id(70), recorded_at: at }];
      return f.query(sql, values);
    };
    const result = await readPublicSleeperIntake(database(query), administration, requestId, { officialResultsVersion: 'v1' });
    expect(result).toMatchObject({ status: 'partial', officialResults: [{ resource: { status: 'available', standings: f.resource,
      periods: [{ nativeWeek: 1, values: scores, officialOutcome: { status: 'unknown' }, finality: { status: 'unknown' }, series: { status: 'unknown' } }],
      brackets: [{ family: 'winners_bracket', resource: { bracketReceiptId: id(69), provenance: bracketProvenance } },
        { family: 'losers_bracket', resource: { bracketReceiptId: id(70), provenance: bracketProvenance } }] } }],
      coverage: { requested: expect.arrayContaining(['exact-period-context', 'exact-matchup-values', 'official-results']) } });
    expect(administration.readExactMatchupValues).toHaveBeenCalledExactlyOnceWith(mapping, { nativeWeek: 1, matchupsReceiptId: id(52) });
    expect(readBracket).toHaveBeenCalledTimes(2);
  });
  it('does not label a foreign external-league mapping with the candidate identity', async () => {
    const f = intakeFixture(); f.administration.readSourceMapping.mockResolvedValue({ ...mapping,
      scope: { ...mapping.scope, externalLeagueId: '9999999' } });
    const result = await readPublicSleeperIntake(f.client, f.administration, requestId, { officialResultsVersion: 'v1' });
    expect(result).toMatchObject({ officialResults: [{ resource: { status: 'unavailable', reason: 'intake-official-results-source-unavailable' } }] });
    expect(f.administration.readOfficialStandings).not.toHaveBeenCalled();
  });
  it('fails closed if the canonical mapping changes during composition', async () => {
    const f = intakeFixture(); f.administration.readSourceMapping.mockResolvedValueOnce(mapping).mockResolvedValueOnce(mapping)
      .mockResolvedValue({ ...mapping, revisionId: id(99), generation: 2 });
    const result = await readPublicSleeperIntake(f.client, f.administration, requestId, { officialResultsVersion: 'v1' });
    expect(result).toMatchObject({ officialResults: [{ resource: { status: 'unavailable', reason: 'intake-official-results-source-unavailable' } }] });
  });
  it('rejects unsupported versions before any stored query', async () => {
    const f = intakeFixture(); await expect(readPublicSleeperIntake(f.client, f.administration, requestId, { officialResultsVersion: 'v2' } as never)).rejects.toThrow('version');
    expect(f.query).not.toHaveBeenCalled();
  });
  it('forwards selection into the exact immutable refresh-cycle request, never the newer identity request', async () => {
    const f = intakeFixture(), targetId = id(40);
    const target = { id: targetId, provider: 'sleeper', source_manager_account_id: id(41), external_manager_id: '777',
      configuration_revision: 3, current_cycle: 4, next_due_at: at, last_served_at: at, selection_failure_count: 0,
      selection_failed_at: null, selection_next_eligible_at: at, identity_request_id: id(42), seasons: [2026], cadence_seconds: 60,
      expires_at: '2026-10-12T12:00:00.000Z', paused: false, configured_at: at, cycle_configuration_revision: 2,
      intake_id: requestId, cycle_created_at: at, due_at: at, disposition: 'partial', outcome_recorded_at: at,
      outcome_next_due_at: at, cycle_seasons: [2026] };
    const query = vi.fn((sql: string, values: readonly unknown[]) => sql.includes('public-data-refresh:read') ? [target] : f.query(sql, values));
    const result = await readPublicDataRefresh(database(query), f.administration, targetId, { officialResultsVersion: 'v1' });
    expect(result).toMatchObject({ cycle: { requestId, configurationRevision: 2 }, target: { configurationRevision: 3, identityRequestId: id(42) },
      intake: { officialResults: [{ acquisition: { requestId }, resource: { standings: f.resource } }] } });
    expect(f.query.mock.calls.find(call => call[0].includes('read-request'))?.[1]).toEqual([requestId]);
  });
});

describe('current CP13 collection versus explicitly retained history', () => {
  it('keeps a pending bracket pair unavailable while an explicitly selected prior request retains its exact pair', async () => {
    const f = intakeFixture(), priorRequestId = id(80);
    const fetch = vi.fn(() => { throw Error('provider access is forbidden during stored reads'); }); vi.stubGlobal('fetch', fetch);
    const witness: PublicCaptureWitness = { ...f.witness,
      work: { requestId: priorRequestId, revision: 5, kind: 'playoff-brackets', season: 2026, externalLeagueId: mapping.scope.externalLeagueId },
      fence: { ...f.witness.fence, workerId: id(61), generation: 4 }, dispatchNonce: id(62),
      attempts: { winners_bracket: { id: id(63), nonce: id(64) }, losers_bracket: { id: id(65), nonce: id(66) } } };
    const provenance = { ...f.row.provenance, acquisition: witness, sourceObservedAt: '2026-10-10T12:00:00.000Z' };
    const readBracket = vi.fn(async (_mapping: unknown, selection: { family: BracketFamily; bracketReceiptId?: string }): Promise<AcceptedBracketRead> => ({
      status: 'available', version: BRACKET_VALUE_VERSION, selection: 'receipt', contentId: id(67), bracketReceiptId: selection.bracketReceiptId!,
      acceptanceId: id(68), acceptedGeneration: 1, sourceMappingRevisionId: mapping.revisionId, provenance,
      value: { family: selection.family, season: 2026, publication: 'unpublished', matches: [], edges: [], rounds: [], limitations: [] } }));
    const administration = { ...f.administration, readAcceptedBracket: readBracket };
    const checkpoint = { ordinal: 1, season: 2026, external_league_id: mapping.scope.externalLeagueId,
      status: 'complete', failure_count: 0, reason: null, league_season_id: mapping.leagueSeasonId, source_mapping: mapping,
      worker_id: id(61), generation: 4, winners_bracket_receipt_id: id(69), losers_bracket_receipt_id: id(70), recorded_at: at };
    const query = vi.fn((sql: string, values: readonly unknown[]): readonly DatabaseRow[] => {
      const prior = values[0] === priorRequestId;
      expect([requestId, priorRequestId]).toContain(values[0]);
      if (sql.includes('read-request')) return [{ id: values[0], seasons: [2026], terminal: prior, external_manager_id: '777',
        selected_playoff_brackets: PUBLIC_PLAYOFF_BRACKETS }];
      // A pending task has no paired checkpoint; the reader must not borrow either earlier accepted family.
      if (sql.includes('read-brackets')) return [prior ? checkpoint : { ordinal: 1, season: 2026,
        external_league_id: mapping.scope.externalLeagueId, status: 'pending', failure_count: 1, reason: 'losers-bracket-pending',
        worker_id: null, generation: null, league_season_id: null, source_mapping: null, recorded_at: null,
        winners_bracket_receipt_id: null, losers_bracket_receipt_id: null }];
      if (sql === PUBLIC_OFFICIAL_STANDINGS_SQL && prior) return [];
      return f.query(sql, values);
    });
    const client = database(query), options = { officialResultsVersion: 'v1' as const };
    const current = await readPublicSleeperIntake(client, administration, requestId, options);
    expect(current).toMatchObject({ status: 'pending', request: { id: requestId },
      brackets: [{ collection: 'pending', failureCount: 1, resource: { status: 'unavailable', reason: 'bracket-capture-not-complete' }, acquisition: null }],
      officialResults: [{ resource: { standings: f.resource, brackets: [
        { family: 'winners_bracket', resource: { status: 'unavailable', reason: 'bracket-capture-not-complete' }, reportedResults: [] },
        { family: 'losers_bracket', resource: { status: 'unavailable', reason: 'bracket-capture-not-complete' }, reportedResults: [] },
      ] } }] });
    expect(readBracket).not.toHaveBeenCalled();

    const prior = await readPublicSleeperIntake(client, administration, priorRequestId, options);
    expect(prior).toMatchObject({ request: { id: priorRequestId }, brackets: [{ collection: 'complete',
      resource: { status: 'available', winners_bracket: { bracketReceiptId: id(69), provenance },
        losers_bracket: { bracketReceiptId: id(70), provenance } },
      acquisition: { winnersBracketReceiptId: id(69), losersBracketReceiptId: id(70) } }],
    officialResults: [{ resource: { brackets: [
      { family: 'winners_bracket', resource: { bracketReceiptId: id(69), provenance } },
      { family: 'losers_bracket', resource: { bracketReceiptId: id(70), provenance } },
    ] } }] });
    expect(readBracket.mock.calls).toEqual([
      [mapping, { family: 'winners_bracket', bracketReceiptId: id(69) }],
      [mapping, { family: 'losers_bracket', bracketReceiptId: id(70) }],
    ]);
    const reread = await readPublicSleeperIntake(client, administration, requestId, options);
    expect(reread).toMatchObject({ status: 'pending', brackets: 'brackets' in current ? current.brackets : undefined });
    expect(readBracket).toHaveBeenCalledTimes(2);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    { reader: 'intake', terminal: false, status: 'pending' },
    { reader: 'intake', terminal: true, status: 'partial' },
    { reader: 'refresh', terminal: false, status: 'pending' },
    { reader: 'refresh', terminal: true, status: 'partial' },
  ] as const)('$reader exposes retained membership after a later core rejection without completing the current request (terminal=$terminal)', async ({ reader, terminal, status }) => {
    const f = intakeFixture(), priorRequestId = id(80), targetId = id(40), priorAt = '2026-10-04T12:00:00.000Z';
    const fetch = vi.fn(() => { throw Error('provider access is forbidden during stored reads'); }); vi.stubGlobal('fetch', fetch);
    const accepted = { scope: { kind: 'enrolled-resource' as const, connectionId: mapping.connectionId,
      leagueSeasonId: mapping.leagueSeasonId, family: 'teams' as const, entityId: null, scoringPeriodId: null,
      audienceId: 'public', coverageSpecId: 'sleeper-current-all-teams-primary-owners-v1' },
      canonicalNormalizerVersion: 'sleeper-current-team-managers-v1', sourceMappingRevisionId: mapping.revisionId,
      contentId: id(81), observationIds: [id(82)], validationVersion: 'latest-network-attempt-v1', acceptedGeneration: 1,
      verifiedAt: priorAt, effectiveFrom: null, effectiveTo: null, effectiveEvidence: 'observed' as const };
    const provenance = { origin: 'network' as const, requestStartedAt: priorAt, requestCompletedAt: priorAt,
      sourceObservedAt: priorAt, checkedAt: priorAt };
    const retainedMembership = { status: 'available' as const, accepted,
      receipt: { id: id(82), attemptId: id(83), ordinal: 1, provenance, configurationContentId: id(84),
        expectedTeamCount: 1, legacyObservationId: id(85) },
      teams: [{ seasonTeamId: id(86), sourceTeam: { provider: 'sleeper' as const, resourceKind: 'roster',
        nativeNamespace: mapping.scope.externalLeagueId, nativeId: '1' },
        primaryOwner: { state: 'owned' as const, manager: { providerManagerId: id(87),
          sourceManager: { provider: 'sleeper' as const, resourceKind: 'user', nativeNamespace: 'sleeper', nativeId: '777' } } },
        coManagers: { state: 'known' as const, managers: [], completeness: 'complete' as const, sourceRefs: [id(82)], observedAt: priorAt },
        assurance: 'provider-observed' as const, effectiveFrom: null, effectiveTo: null, effectiveEvidence: 'unknown' as const }] };
    const before = structuredClone(retainedMembership);
    // This simulates a stored rejection plus an existing accepted head. It does not execute a writer or prove SQL preservation.
    const readMembership = vi.fn(async () => retainedMembership), recordObservation = vi.fn();
    const administration = { ...f.administration, readAcceptedTeamManagers: readMembership, recordObservation };
    const rejection = { revision: 4, resource: 'core', source_scope: mapping.scope,
      request_started_at: at, request_completed_at: at, reason: 'roster-primary-owner-invalid' };
    const target = { id: targetId, provider: 'sleeper', source_manager_account_id: id(41), external_manager_id: '777',
      configuration_revision: 3, current_cycle: 4, next_due_at: at, last_served_at: at, selection_failure_count: 0,
      selection_failed_at: null, selection_next_eligible_at: at, identity_request_id: priorRequestId, seasons: [2026], cadence_seconds: 60,
      expires_at: '2026-10-12T12:00:00.000Z', paused: false, configured_at: at, cycle_configuration_revision: 2,
      intake_id: requestId, cycle_created_at: at, due_at: at, disposition: terminal ? 'partial' : null,
      outcome_recorded_at: terminal ? at : null, outcome_next_due_at: terminal ? at : null, cycle_seasons: [2026] };
    const query = vi.fn((sql: string, values: readonly unknown[]): readonly DatabaseRow[] => {
      if (sql.includes('public-data-refresh:read')) { expect(values).toEqual([targetId]); return [target]; }
      const prior = values[0] === priorRequestId;
      expect([requestId, priorRequestId]).toContain(values[0]);
      if (sql.includes('read-request')) return [{ id: values[0], seasons: [2026], terminal: prior || terminal, external_manager_id: '777' }];
      if (sql.includes('read-candidates')) return [{ season: 2026, external_league_id: mapping.scope.externalLeagueId,
        name: 'Independent standings', stage: prior ? 'complete' : 'unavailable', league_season_id: mapping.leagueSeasonId,
        managers_receipt_id: prior ? id(82) : null }];
      if (sql.includes('read-rejections')) return prior ? [] : [rejection];
      if (sql === PUBLIC_OFFICIAL_STANDINGS_SQL && prior) return [];
      return f.query(sql, values);
    });
    const client = database(query), options = { officialResultsVersion: 'v1' as const };
    const prior = await readPublicSleeperIntake(client, administration, priorRequestId, options);
    expect(prior).toMatchObject({ leagues: [{ resources: { teamManagers: retainedMembership } }] });
    query.mockClear();
    const refresh = reader === 'refresh' ? await readPublicDataRefresh(client, administration, targetId, options) : null;
    const current = refresh?.status === 'available' ? refresh.intake
      : await readPublicSleeperIntake(client, administration, requestId, options);
    expect(current).toMatchObject({ status, request: { id: requestId, terminal }, rejected: [rejection],
      leagues: [{ collection: 'unavailable', resources: { teamManagers: {
        status: 'unavailable', reason: 'intake-capture-not-current-head', retained: before } } }],
      officialResults: [{ acquisition: { requestId }, resource: { status: 'available', standings: f.resource } }] });
    if (refresh) expect(refresh).toMatchObject({ status: 'available', cycle: { requestId, configurationRevision: 2 },
      target: { identityRequestId: priorRequestId, configurationRevision: 3 } });
    expect(query.mock.calls.filter(([sql]) => sql.includes('read-request')).map(([, values]) => values)).toEqual([[requestId]]);
    expect(retainedMembership).toEqual(before);
    expect(readMembership).toHaveBeenCalledWith(mapping);
    expect(recordObservation).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
