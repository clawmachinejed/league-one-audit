import { describe, expect, it, vi } from 'vitest';
import type { DatabaseClient, DatabaseRow } from '../../database';
import type { AdministrationProvenance } from '../contracts';
import { normalizeAdministrationObservation } from '../normalize';
import { b1CompatibilityFixture, b1Mapping, b1Uuid } from '../../aggregator/b1-acceptance.fixtures';
import { EXACT_MATCHUPS_POLICY, exactMatchupsScope } from '../../aggregator/exact-matchups';
import { LEAGUE_SETTINGS_FIELDS, LEAGUE_SETTINGS_POLICY, leagueSettingsScope } from '../../aggregator/league-settings';
import { EXACT_PERIOD_CONTEXT_SQL, exactPeriodContextMethods } from './exact-period-context';
import { EXACT_LINEUP_APPLICABILITY_COLUMNS, readExactLineupApplicability } from './exact-lineup-applicability';
import { readNativePeriodMapping } from './period-mapping';

vi.mock('server-only', () => ({}));
const mapping = b1Mapping;
const uuid = b1Uuid;
const selection = { nativeWeek: 4, matchupsReceiptId: uuid(5) };
const provenance: AdministrationProvenance = { origin: 'network', requestStartedAt: '2026-09-29T12:00:00.000Z',
  requestCompletedAt: '2026-09-29T12:00:01.000Z', sourceObservedAt: '2026-09-29T12:00:01.000Z', checkedAt: '2026-09-29T12:00:02.000Z' };
function configuration(rec = 0.5, version = 15) {
  const payload = { ...b1CompatibilityFixture().accepted_rows[0].configuration_payload,
    scoring_settings: { rec }, settings: { leg: 18, last_scored_leg: 17, start_week: 1, playoff_week_start: 15 } };
  const normalized = normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1',
    normalizerVersion: 'sleeper-administration-v1', dialect: 'sleeper-nfl-v1', scope: mapping.scope,
    family: 'league', week: null, completeness: 'complete', provenance, payload });
  if (normalized.value?.family !== 'league') throw new Error('Invalid test source.');
  const content = { id: uuid(version === 15 ? 7 : version + 100), configuration_version_id: uuid(version),
    league_season_id: mapping.leagueSeasonId, provider: 'sleeper', external_league_id: mapping.scope.externalLeagueId,
    family: 'league', week: 0, normalizer_version: 'sleeper-administration-v1', accepted: true, completeness: 'complete',
    content_hash: normalized.contentHash, semantic_hash: normalized.semanticHash, normalized_value: normalized.value, payload };
  return { content, normalized };
}
function evidence(component: 'scoring' | 'roster' | 'competition', rec = 0.5, generation = 2, version = 15) {
  const source = configuration(rec, version);
  if (source.normalized.value?.family !== 'league') throw new Error('Invalid test component.');
  return { activation: { id: uuid(1000 + generation), league_season_id: mapping.leagueSeasonId,
    configuration_version_id: uuid(version), component, component_hash: source.normalized.value.components.find(c => c.name === component)!.hash,
    applicability: 'evidenced_period', season_type: 'regular', from_week: 1, through_week: 18,
    evidence: 'Explicit owner confirmation for the selected period', generation, recorded_at: '2026-10-10T12:00:00.123456+00:00' },
  version: { id: uuid(version), league_season_id: mapping.leagueSeasonId, dialect: 'sleeper-nfl-v1',
    normalizer_version: 'sleeper-administration-v1', semantic_hash: source.normalized.semanticHash, components: source.normalized.value.components },
  source: { configurationContentId: source.content.id, configurationVersionId: uuid(version), provider: 'sleeper',
    externalLeagueId: mapping.scope.externalLeagueId, leagueSeasonId: mapping.leagueSeasonId,
    normalizedValue: source.normalized.value, sourceMapping: mapping, content: source.content, provenance } };
}
function fixture() {
  const old = b1CompatibilityFixture().accepted_rows[0];
  const configured = configuration();
  const fence = { kind: 'public-intake', intakeId: uuid(50), workerId: uuid(51), generation: 1 };
  const scope = { id: uuid(60), connection_id: mapping.connectionId, league_season_id: mapping.leagueSeasonId,
    identity: { scope: exactMatchupsScope(mapping, 4), policy: EXACT_MATCHUPS_POLICY } };
  const settingsScope = { ...scope, id: uuid(61), identity: { scope: leagueSettingsScope(mapping), policy: LEAGUE_SETTINGS_POLICY } };
  return {
    resource_scope: scope,
    acceptance: { id: uuid(62), receipt_id: uuid(5), scope_id: scope.id, source_mapping_revision_id: mapping.revisionId, generation: 1 },
    matchup_attempt: { id: uuid(6), scope_id: scope.id, source_mapping: mapping, expected_generation: 0, ordinal: 1, write_fence: fence },
    matchup_receipt: { id: uuid(5), attempt_id: uuid(6), content_id: uuid(9), configuration_content_id: uuid(7),
      legacy_observation_id: uuid(8), population_evidence: { contentHash: configured.content.content_hash, observationId: uuid(21), provenance },
      expected_team_count: 2, provenance, coverage: old.coverage },
    matchup_content: { id: uuid(9), league_season_id: mapping.leagueSeasonId, provider: 'sleeper',
      external_league_id: mapping.scope.externalLeagueId, family: 'matchups', week: 4, accepted: true, completeness: 'complete',
      normalizer_version: 'sleeper-administration-v1', payload: old.payload,
      content_hash: old.content_hash, semantic_hash: old.semantic_hash, normalized_value: old.normalized_value },
    configuration_content: { ...configured.content, first_observed_at: '2026-01-01T00:00:00.000Z', last_observed_at: '2026-10-10T00:00:00.000Z' },
    configuration_observation: { id: uuid(21), content_id: uuid(7), league_season_id: mapping.leagueSeasonId, family: 'league', week: 0,
      request_started_at: provenance.requestStartedAt, request_completed_at: provenance.requestCompletedAt },
    calendar_evidence: old.calendar_evidence,
    applicability_evidence: { scoring: [evidence('scoring')], roster: [evidence('roster')], competition: [evidence('competition')] },
    intake_capture: {
      checkpoint: { intake_id: uuid(50), task_ordinal: 4, matchups_receipt_id: uuid(5), settings_receipt_id: uuid(52),
        league_season_id: mapping.leagueSeasonId, source_mapping: mapping, worker_id: uuid(51), generation: 1 },
      task: { intake_id: uuid(50), ordinal: 4, status: 'complete', season: 2026, external_league_id: mapping.scope.externalLeagueId, native_week: 4 },
      receipt: { id: uuid(52), attempt_id: uuid(53), content_id: uuid(7), configuration_content_id: uuid(7), legacy_observation_id: uuid(21),
        population_evidence: null, expected_team_count: null, provenance,
        coverage: { periodIds: [], interval: null, entitySet: 'full', fields: LEAGUE_SETTINGS_FIELDS,
          pagination: 'complete', nextCursor: null, completeness: 'complete', reasons: [] } },
      attempt: { id: uuid(53), scope_id: settingsScope.id, expected_generation: 0, source_mapping: mapping, write_fence: fence },
      scope: settingsScope,
      acceptance: { id: uuid(54), receipt_id: uuid(52), scope_id: settingsScope.id, source_mapping_revision_id: mapping.revisionId, generation: 1 },
    },
  };
}
function reader(rows: readonly DatabaseRow[] = [fixture()]) {
  const query = vi.fn().mockResolvedValue(rows);
  return { query, read: exactPeriodContextMethods({ enabled: true, query } as DatabaseClient).readExactPeriodContext };
}
const bound = { ...selection, intakeCapture: { intakeId: uuid(50), settingsReceiptId: uuid(52) } };

describe('receipt-bound exact-period configuration context', () => {
  it('joins immutable acceptance and all three component inventories without mutable resource heads', async () => {
    const { read, query } = reader();
    expect(await read(mapping, selection)).toMatchObject({ status: 'available' });
    expect(query).toHaveBeenCalledExactlyOnceWith(EXACT_PERIOD_CONTEXT_SQL, [uuid(5),
      JSON.stringify({ scope: exactMatchupsScope(mapping, 4), policy: EXACT_MATCHUPS_POLICY }),
      mapping.revisionId, 4, 1, mapping.leagueSeasonId, mapping.connectionId, null, null]);
    expect(EXACT_PERIOD_CONTEXT_SQL).toContain("(VALUES ('scoring'),('roster'),('competition'))");
    expect(EXACT_PERIOD_CONTEXT_SQL).toContain('activation.component=component.name');
    expect(EXACT_PERIOD_CONTEXT_SQL).not.toContain("activation.component='roster'");
    expect(EXACT_PERIOD_CONTEXT_SQL).toContain('LIMIT 1001');
    expect(EXACT_PERIOD_CONTEXT_SQL).toContain('SELECT max(latest.generation)');
    expect(EXACT_PERIOD_CONTEXT_SQL).toContain("'version',CASE WHEN activation.generation=");
    expect(EXACT_PERIOD_CONTEXT_SQL).toContain('THEN to_jsonb(version) ELSE NULL END');
    expect(EXACT_PERIOD_CONTEXT_SQL).toContain("latest.season_type='regular'");
    expect(EXACT_PERIOD_CONTEXT_SQL).toContain('to_jsonb(accepted.*) AS acceptance');
    expect(EXACT_PERIOD_CONTEXT_SQL).toContain('accepted.receipt_id=receipt.id AND accepted.scope_id=scope.id');
    expect(EXACT_PERIOD_CONTEXT_SQL).toContain('connection.current_mapping_revision_id=accepted.source_mapping_revision_id');
    expect(EXACT_PERIOD_CONTEXT_SQL).not.toContain('league_roster_resource_heads');
    expect(EXACT_LINEUP_APPLICABILITY_COLUMNS).toContain("activation.component='roster'");
    expect(EXACT_LINEUP_APPLICABILITY_COLUMNS).not.toContain("'content',to_jsonb");
  });

  it('keeps original population capture provenance separate from later owner decisions and native current leg', async () => {
    const result = await reader().read(mapping, bound);
    expect(result).toMatchObject({ status: 'available', capture: { matchupsReceiptId: uuid(5), settingsReceiptId: uuid(52), configurationContentId: uuid(7) },
      observedConfiguration: { provenance, applicability: 'observation-only' },
      configuration: { scoring: { status: 'known', basis: 'latest-evidenced-decision', binding: {
        recordedAt: '2026-10-10T12:00:00.123456+00:00', evidence: { kind: 'owner_confirmed' } } }, roster: { status: 'known' }, competition: { status: 'known' } },
      phase: { status: 'derived', value: 'regular-window', basis: 'owner-confirmed-applicable-settings', round: { status: 'unknown' }, leg: { status: 'unknown' }, end: { status: 'unknown' } },
      nativeOfficialPhase: { status: 'unknown', reason: 'native-period-phase-not-exposed' } });
  });

  it('retains captured scoring while an independently evidenced latest scoring correction applies', async () => {
    const row = fixture(); row.applicability_evidence.scoring.push(evidence('scoring', 1, 3, 16));
    const result = await reader([row]).read(mapping, selection);
    expect(result).toMatchObject({ status: 'available', observedConfiguration: { value: { scoring: { rules: { value: { rec: 0.5 } } } } },
      configuration: { scoring: { status: 'known', binding: { generation: 3 }, fields: { scoring: { rules: { value: { rec: 1 } } } } },
        roster: { status: 'known', binding: { generation: 2 } } } });
  });

  it.each([null, undefined])('keeps official observed facts but no historical applicability without calendar %s', async calendar => {
    const row: DatabaseRow = { ...fixture(), calendar_evidence: calendar };
    expect(await reader([row]).read(mapping, selection)).toMatchObject({ status: 'available',
      configuration: { scoring: { status: 'unknown', reason: 'period_mapping_unproved' }, roster: { status: 'unknown' }, competition: { status: 'unknown' } },
      phase: { status: 'unknown', reason: 'period_mapping_unproved' } });
  });

  it('returns no binding for empty or only current-observed decisions without promoting current settings', async () => {
    const row = fixture(); row.applicability_evidence.scoring = [];
    row.applicability_evidence.competition[0].activation.applicability = 'observed_current';
    expect(await reader([row]).read(mapping, selection)).toMatchObject({ status: 'available', configuration: {
      scoring: { status: 'unknown', reason: 'no_binding' }, roster: { status: 'known' }, competition: { status: 'unknown', reason: 'no_binding' } } });
  });

  it('preserves the roster wrapper result after generic lineage parsing', async () => {
    const row = fixture();
    const calendar = readNativePeriodMapping(row.calendar_evidence, mapping, uuid(7), row.configuration_content.payload, 4);
    const old = readExactLineupApplicability(row.applicability_evidence.roster, mapping, calendar);
    const result = await reader([row]).read(mapping, selection);
    expect(old).toMatchObject({ status: 'available', activationRef: uuid(1002), nativeRosterPositions: ['QB', 'RB', 'BN'] });
    expect(result).toMatchObject({ status: 'available', configuration: { roster: { status: 'known', activationRef: uuid(1002) } } });
  });

  it.each(['source', 'raw', 'component', 'version', 'mapping', 'time', 'reference', 'fork'] as const)(
    'does not fall back from a latest %s defect and isolates other components', async defect => {
      const row = fixture(); const newest = evidence('scoring', 1, 3, 16);
      if (defect === 'source') Object.assign(newest, { source: null });
      if (defect === 'raw') newest.source.content.payload.scoring_settings.rec = 2;
      if (defect === 'component') newest.activation.component_hash = 'bad';
      if (defect === 'version') newest.version.semantic_hash = 'bad';
      if (defect === 'mapping') newest.source.sourceMapping = { ...mapping, revisionId: uuid(99) };
      if (defect === 'time') newest.activation.recorded_at = '2026-02-30T12:00:00Z';
      if (defect === 'reference') newest.activation.evidence = '';
      row.applicability_evidence.scoring.push(newest);
      if (defect === 'fork') row.applicability_evidence.scoring.push(structuredClone(newest));
      expect(await reader([row]).read(mapping, selection)).toMatchObject({ status: 'available', configuration: {
        scoring: { status: 'unknown' }, roster: { status: 'known' }, competition: { status: 'known' } } });
    });

  it('detects bounded overflow independently for one component', async () => {
    const row = fixture(); row.applicability_evidence.scoring = Array.from({ length: 1001 }, () => evidence('scoring'));
    expect(await reader([row]).read(mapping, selection)).toMatchObject({ status: 'available', configuration: {
      scoring: { status: 'unknown', reason: 'applicability_inventory_overflow' }, roster: { status: 'known' } } });
  });
  it('isolates malformed optional evidence from readable captured configuration', async () => {
    expect(await reader([{ ...fixture(), applicability_evidence: false }]).read(mapping, selection)).toMatchObject({ status: 'available',
      configuration: { scoring: { status: 'unknown', reason: 'invalid_applicability_evidence' }, competition: { status: 'unknown' } } });
  });

  it.each(['coverage', 'receipt', 'acceptance', 'generation', 'attempt', 'mapping', 'scope', 'week', 'configuration', 'observation', 'population', 'raw', 'normalized', 'provenance'] as const)(
    'rejects broken immutable capture %s evidence', async defect => {
      const row = fixture();
      if (defect === 'coverage') row.matchup_receipt.coverage.fields = ['roster_id'];
      if (defect === 'receipt') row.matchup_receipt.id = uuid(90);
      if (defect === 'acceptance') row.acceptance.receipt_id = uuid(90);
      if (defect === 'generation') row.acceptance.generation = 3;
      if (defect === 'attempt') row.matchup_attempt.id = uuid(90);
      if (defect === 'mapping') row.matchup_attempt.source_mapping = { ...mapping, revisionId: uuid(90) };
      if (defect === 'scope') row.resource_scope.identity = { ...row.resource_scope.identity, scope: exactMatchupsScope(mapping, 5) };
      if (defect === 'week') row.matchup_content.week = 5;
      if (defect === 'configuration') row.matchup_receipt.configuration_content_id = uuid(90);
      if (defect === 'observation') row.configuration_observation.content_id = uuid(90);
      if (defect === 'population') row.matchup_receipt.population_evidence.contentHash = 'bad';
      if (defect === 'raw') row.configuration_content.payload.scoring_settings.rec = 2;
      if (defect === 'normalized') Object.assign(row.matchup_content, { normalized_value: {} });
      if (defect === 'provenance') row.matchup_receipt.population_evidence.provenance = { ...provenance, requestCompletedAt: '2026-09-28T12:00:00.000Z' };
      expect(await reader([row]).read(mapping, selection)).toEqual({ status: 'unavailable', reason: 'period_context_evidence_unavailable' });
    });

  it.each(['missing', 'intake', 'task', 'worker', 'fence', 'settings', 'observation', 'provenance', 'coverage', 'acceptance'] as const)(
    'rejects a fabricated intake pair: %s', async defect => {
      const row = fixture(); const pair = row.intake_capture;
      if (defect === 'missing') Object.assign(row, { intake_capture: null });
      if (defect === 'intake') pair.checkpoint.intake_id = uuid(90);
      if (defect === 'task') pair.task.native_week = 5;
      if (defect === 'worker') pair.checkpoint.worker_id = uuid(90);
      if (defect === 'fence') pair.attempt.write_fence = { ...pair.attempt.write_fence, generation: 2 };
      if (defect === 'settings') pair.receipt.content_id = uuid(90);
      if (defect === 'observation') pair.receipt.legacy_observation_id = uuid(90);
      if (defect === 'provenance') pair.receipt.provenance = { ...provenance, checkedAt: '2026-10-01T00:00:00.000Z' };
      if (defect === 'coverage') pair.receipt.coverage = { ...pair.receipt.coverage, completeness: 'partial' };
      if (defect === 'acceptance') pair.acceptance.receipt_id = uuid(90);
      expect(await reader([row]).read(mapping, bound)).toEqual({ status: 'unavailable', reason: 'period_context_evidence_unavailable' });
    });

  it.each([0, 19, 1.5])('rejects native period %s before querying', async nativeWeek => {
    const { read, query } = reader(); expect(await read(mapping, { ...selection, nativeWeek })).toMatchObject({ status: 'unavailable' });
    expect(query).not.toHaveBeenCalled();
  });
  it('distinguishes missing history from invalid or failed reads', async () => {
    expect(await reader([]).read(mapping, selection)).toEqual({ status: 'missing' });
    expect(await reader([fixture(), fixture()]).read(mapping, selection)).toMatchObject({ status: 'unavailable' });
    const { read, query } = reader(); query.mockRejectedValue(new Error('offline failure'));
    expect(await read(mapping, selection)).toMatchObject({ status: 'unavailable' });
  });
});
