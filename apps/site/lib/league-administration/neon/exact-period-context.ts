import 'server-only';
import type { DatabaseClient, DatabaseRow } from '../../database';
import { EXACT_MATCHUPS_POLICY, exactMatchupsScope } from '../../aggregator/exact-matchups';
import { LEAGUE_SETTINGS_FIELDS, LEAGUE_SETTINGS_POLICY, leagueSettingsScope } from '../../aggregator/league-settings';
import { EXACT_PERIOD_CONTEXT_VERSION, deriveExactPeriodPhase, type ExactPeriodContextRead,
  type ExactPeriodContextSelection, type PeriodConfigurationContext } from '../../aggregator/exact-period-context';
import { normalizeAdministrationObservation } from '../normalize';
import { resolveConfigurationComponent } from '../applicability';
import { ADMINISTRATION_SCHEMA_VERSION, ADMINISTRATION_NORMALIZER_VERSION, ADMINISTRATION_DIALECT,
  type AdministrationEnvelope, type AdministrationProvenance } from '../contracts';
import { compatibleRevision } from '../../projections/shared/revision-compatibility';
import { isAdministrationSourceMapping, type AdministrationSourceMapping } from '../source-mapping';
import { readNativePeriodMapping } from './period-mapping';
import { EXACT_LINEUP_APPLICABILITY_COLUMNS, readPeriodConfigurationEvidence } from './exact-lineup-applicability';

// Keep historical inventory metadata bounded without repeating historical raw/configuration bodies.
// The roster reader keeps its original query unchanged.
const latestApplicableGeneration = `(SELECT max(latest.generation) FROM public.league_configuration_activations latest
          WHERE latest.league_season_id=scope.league_season_id AND latest.component=component.name
            AND latest.applicability='evidenced_period' AND latest.season_type='regular'
            AND latest.from_week<=$4 AND latest.through_week>=$4)`;
const componentColumns = EXACT_LINEUP_APPLICABILITY_COLUMNS
  .replace("activation.component='roster'", 'activation.component=component.name')
  .replace("'version',to_jsonb(version)", `'version',CASE WHEN activation.generation=${latestApplicableGeneration}
        AND activation.season_type='regular' THEN to_jsonb(version) ELSE NULL END`)
  .replace('WHERE configuration_source.configuration_version_id=version.id', `WHERE activation.generation=${latestApplicableGeneration}
          AND activation.season_type='regular' AND configuration_source.configuration_version_id=version.id`)
  .replace("'normalizedValue',configuration_source.normalized_value", `'normalizedValue',configuration_source.normalized_value,
          'content',to_jsonb(configuration_source),'provenance',CASE WHEN source_receipt.content_id=configuration_source.id
            THEN source_receipt.provenance ELSE source_receipt.population_evidence->'provenance' END`);

export const EXACT_PERIOD_CONTEXT_SQL = `/* league-administration:read-exact-period-context */
  SELECT to_jsonb(scope) AS resource_scope,to_jsonb(accepted) AS acceptance,
    to_jsonb(receipt) AS matchup_receipt,to_jsonb(attempt) AS matchup_attempt,
    to_jsonb(content) AS matchup_content,to_jsonb(configuration) AS configuration_content,
    to_jsonb(configuration_observation) AS configuration_observation,
    (SELECT to_jsonb(calendar) FROM public.league_native_period_calendar_evidence calendar
      WHERE calendar.connection_id=scope.connection_id AND calendar.league_season_id=scope.league_season_id
        AND calendar.source_mapping_revision_id=accepted.source_mapping_revision_id
        AND calendar.configuration_content_id=receipt.configuration_content_id
        AND calendar.mapping_policy_version='sleeper-native-week-to-nfl-regular-v1'
      ORDER BY calendar.retained_at,calendar.id LIMIT 1) AS calendar_evidence,
    (SELECT jsonb_object_agg(component.name,evidence.lineup_applicability_evidence)
      FROM (VALUES ('scoring'),('roster'),('competition')) component(name)
      CROSS JOIN LATERAL (SELECT ${componentColumns}) evidence) AS applicability_evidence,
    (SELECT jsonb_build_object('checkpoint',to_jsonb(checkpoint),'task',to_jsonb(task),
      'receipt',to_jsonb(settings),'attempt',to_jsonb(settings_attempt),'scope',to_jsonb(settings_scope),
      'acceptance',to_jsonb(settings_accepted))
      FROM public.public_data_exact_period_checkpoints checkpoint
      JOIN public.public_data_exact_period_tasks task ON task.intake_id=checkpoint.intake_id AND task.ordinal=checkpoint.task_ordinal
      JOIN public.league_roster_capture_receipts settings ON settings.id=checkpoint.settings_receipt_id
      JOIN public.league_roster_resource_attempts settings_attempt ON settings_attempt.id=settings.attempt_id
      JOIN public.league_roster_resource_scopes settings_scope ON settings_scope.id=settings_attempt.scope_id
      JOIN public.league_roster_resource_acceptances settings_accepted ON settings_accepted.receipt_id=settings.id
        AND settings_accepted.scope_id=settings_scope.id
      WHERE checkpoint.intake_id=$8::uuid AND checkpoint.settings_receipt_id=$9::uuid
        AND checkpoint.matchups_receipt_id=receipt.id AND task.native_week=$4 AND task.status='complete'
      LIMIT 1) AS intake_capture
  FROM public.league_roster_capture_receipts receipt
  JOIN public.league_roster_resource_attempts attempt ON attempt.id=receipt.attempt_id
  JOIN public.league_roster_resource_scopes scope ON scope.id=attempt.scope_id
  JOIN public.league_roster_resource_acceptances accepted ON accepted.receipt_id=receipt.id AND accepted.scope_id=scope.id
  JOIN public.league_administration_contents content ON content.id=receipt.content_id
  JOIN public.league_administration_contents configuration ON configuration.id=receipt.configuration_content_id
  JOIN public.league_administration_observations configuration_observation
    ON configuration_observation.id=(receipt.population_evidence->>'observationId')::uuid
      AND configuration_observation.content_id=configuration.id
  JOIN public.league_source_connections connection ON connection.id=scope.connection_id
    AND connection.league_season_id=scope.league_season_id
    AND connection.current_mapping_revision_id=accepted.source_mapping_revision_id
  JOIN public.league_seasons season ON season.id=scope.league_season_id
  JOIN public.league_administration_enrollment_seasons enrollment ON enrollment.league_id=season.league_id
    AND enrollment.season=season.season AND enrollment.provider=connection.provider
  WHERE receipt.id=$1::uuid AND scope.identity=$2::jsonb AND accepted.source_mapping_revision_id=$3::uuid
    AND connection.mapping_generation=$5 AND scope.league_season_id=$6::uuid AND scope.connection_id=$7::uuid`;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid period context evidence.');
  return value as Record<string, unknown>;
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(value)) throw new Error('Invalid period context identity.');
  return value;
}
function equal(left: unknown, right: unknown): boolean { return compatibleRevision(left) === compatibleRevision(right); }
function positive(value: unknown): number {
  if ((typeof value !== 'number' && typeof value !== 'string') || value === '' || !Number.isSafeInteger(Number(value)) || Number(value) < 1) {
    throw new Error('Invalid period context ordinal.');
  }
  return Number(value);
}
function normalizedConfiguration(content: Record<string, unknown>, provenance: unknown, mapping: AdministrationSourceMapping) {
  const capture = object(provenance) as AdministrationProvenance;
  if (content.family !== 'league' || Number(content.week) !== 0 || content.league_season_id !== mapping.leagueSeasonId
    || content.provider !== mapping.scope.provider || content.external_league_id !== mapping.scope.externalLeagueId
    || content.normalizer_version !== ADMINISTRATION_NORMALIZER_VERSION || content.completeness !== 'complete'
    || capture.origin !== 'network' || !capture.requestStartedAt || !capture.requestCompletedAt || !capture.sourceObservedAt) {
    throw new Error('Invalid retained configuration lineage.');
  }
  const normalized = normalizeAdministrationObservation({ schemaVersion: ADMINISTRATION_SCHEMA_VERSION,
    normalizerVersion: ADMINISTRATION_NORMALIZER_VERSION, dialect: ADMINISTRATION_DIALECT, scope: mapping.scope,
    family: 'league', week: null, completeness: 'complete', provenance: capture,
    payload: content.payload as AdministrationEnvelope['payload'] });
  if (normalized.contentHash !== content.content_hash || normalized.semanticHash !== content.semantic_hash
    || !equal(normalized.value, content.normalized_value) || normalized.leagueSettings?.status !== 'complete' || !normalized.leagueSettings.value) {
    throw new Error('Retained configuration raw and typed facts disagree.');
  }
  return { normalized, provenance: capture, value: normalized.leagueSettings.value };
}
function componentContext<K extends keyof PeriodConfigurationContext>(name: K, input: unknown,
  mapping: AdministrationSourceMapping, calendar: ReturnType<typeof readNativePeriodMapping>): PeriodConfigurationContext[K] {
  if (calendar.status !== 'mapped') return { status: 'unknown', reason: 'period_mapping_unproved' };
  if (Array.isArray(input) && input.length > 1000) return { status: 'unknown', reason: 'applicability_inventory_overflow' };
  const parsed = readPeriodConfigurationEvidence(input, mapping, calendar, name);
  if (parsed.status === 'unavailable') return { status: 'unknown', reason: parsed.reason };
  const resolved = resolveConfigurationComponent({ leagueSeasonId: mapping.leagueSeasonId, component: name,
    period: { season: calendar.season, seasonType: calendar.seasonType, week: calendar.week },
    bindings: parsed.bindings, versions: parsed.versions });
  if (resolved.status === 'unknown') return resolved;
  try {
    const source = object(parsed.sources[resolved.binding.generation]);
    const content = object(source.content);
    if (content.id !== source.configurationContentId || content.configuration_version_id !== resolved.binding.configurationVersionId) {
      throw new Error('Applicable source version differs.');
    }
    const captured = normalizedConfiguration(content, source.provenance, mapping);
    if (!equal(captured.normalized.value, source.normalizedValue)) throw new Error('Applicable raw source differs.');
    const fields = name === 'scoring' ? { scoring: captured.value.scoring } : name === 'roster' ? { slots: captured.value.slots }
      : { competition: captured.value.competition, rosterRules: captured.value.rosterRules, waivers: captured.value.waivers };
    return { status: 'known', basis: 'latest-evidenced-decision', binding: resolved.binding,
      activationRef: parsed.activationRefs[resolved.binding.generation], range: parsed.ranges[resolved.binding.generation],
      source: { configurationContentId: id(content.id), rawContentHash: String(content.content_hash) }, fields } as PeriodConfigurationContext[K];
  } catch { return { status: 'unknown', reason: 'invalid_applicability_evidence' }; }
}

function readRow(row: DatabaseRow, mapping: AdministrationSourceMapping, selection: ExactPeriodContextSelection): ExactPeriodContextRead {
  const receipt = object(row.matchup_receipt), attempt = object(row.matchup_attempt), scope = object(row.resource_scope);
  const accepted = object(row.acceptance), content = object(row.matchup_content), configuration = object(row.configuration_content);
  const observation = object(row.configuration_observation), population = object(receipt.population_evidence);
  const expectedScope = { scope: exactMatchupsScope(mapping, selection.nativeWeek), policy: EXACT_MATCHUPS_POLICY };
  if (receipt.id !== selection.matchupsReceiptId || attempt.id !== receipt.attempt_id || scope.id !== attempt.scope_id
    || accepted.receipt_id !== receipt.id || accepted.scope_id !== scope.id || accepted.source_mapping_revision_id !== mapping.revisionId
    || positive(accepted.generation) !== Number(attempt.expected_generation) + 1
    || !equal(receipt.coverage, { periodIds: [expectedScope.scope.scoringPeriodId], interval: null, entitySet: 'full',
      fields: ['roster_id', 'matchup_id'], pagination: 'complete', nextCursor: null, completeness: 'complete', reasons: [] })
    || !isAdministrationSourceMapping(attempt.source_mapping) || !equal(attempt.source_mapping, mapping)
    || !equal(scope.identity, expectedScope) || scope.connection_id !== mapping.connectionId || scope.league_season_id !== mapping.leagueSeasonId
    || receipt.content_id !== content.id || receipt.configuration_content_id !== configuration.id
    || content.league_season_id !== mapping.leagueSeasonId || content.provider !== 'sleeper'
    || content.external_league_id !== mapping.scope.externalLeagueId || content.family !== 'matchups'
    || Number(content.week) !== selection.nativeWeek || content.accepted !== true || content.completeness !== 'complete'
    || content.normalizer_version !== ADMINISTRATION_NORMALIZER_VERSION || population.contentHash !== configuration.content_hash
    || observation.id !== population.observationId || observation.content_id !== configuration.id
    || observation.league_season_id !== mapping.leagueSeasonId || observation.family !== 'league' || Number(observation.week) !== 0) {
    throw new Error('Invalid exact period receipt binding.');
  }
  id(receipt.id); id(receipt.legacy_observation_id); id(attempt.id); id(content.id); id(configuration.id); id(observation.id); positive(accepted.generation); positive(attempt.ordinal);
  const expectedCount = positive(receipt.expected_team_count);
  const capture = object(receipt.provenance) as AdministrationProvenance;
  if (capture.origin !== 'network' || !capture.requestStartedAt || !capture.requestCompletedAt || !capture.sourceObservedAt) throw new Error('Missing matchup acquisition.');
  const normalized = normalizeAdministrationObservation({ schemaVersion: ADMINISTRATION_SCHEMA_VERSION,
    normalizerVersion: ADMINISTRATION_NORMALIZER_VERSION, dialect: ADMINISTRATION_DIALECT, scope: mapping.scope,
    family: 'matchups', week: selection.nativeWeek, completeness: 'complete', provenance: capture,
    payload: content.payload as AdministrationEnvelope['payload'] }, { expectedRosterCount: expectedCount });
  if (normalized.status !== 'accepted' || normalized.contentHash !== content.content_hash || normalized.semanticHash !== content.semantic_hash
    || !equal(normalized.value, content.normalized_value)) throw new Error('Invalid captured matchup evidence.');
  const observed = normalizedConfiguration(configuration, population.provenance, mapping);
  if (observed.value.teamCount.value !== expectedCount) throw new Error('Population size differs.');
  if (selection.intakeCapture) {
    const fence = object(attempt.write_fence);
    const pair = object(row.intake_capture), checkpoint = object(pair.checkpoint), task = object(pair.task);
    const settings = object(pair.receipt), settingsAttempt = object(pair.attempt), settingsScope = object(pair.scope), settingsAccepted = object(pair.acceptance);
    if (checkpoint.intake_id !== selection.intakeCapture.intakeId || checkpoint.matchups_receipt_id !== receipt.id
      || checkpoint.settings_receipt_id !== selection.intakeCapture.settingsReceiptId || settings.id !== checkpoint.settings_receipt_id
      || task.intake_id !== checkpoint.intake_id || task.ordinal !== checkpoint.task_ordinal || task.status !== 'complete'
      || task.season !== mapping.scope.season || task.external_league_id !== mapping.scope.externalLeagueId || task.native_week !== selection.nativeWeek
      || checkpoint.worker_id !== fence.workerId || Number(checkpoint.generation) !== Number(fence.generation)
      || checkpoint.league_season_id !== mapping.leagueSeasonId || !equal(checkpoint.source_mapping, mapping)
      || settings.population_evidence !== null || settings.expected_team_count !== null
      || settings.content_id !== configuration.id || settings.configuration_content_id !== configuration.id
      || settings.legacy_observation_id !== observation.id || !equal(settings.provenance, population.provenance)
      || settingsAttempt.id !== settings.attempt_id || !equal(settingsAttempt.source_mapping, mapping)
      || !equal(settingsAttempt.write_fence, attempt.write_fence) || settingsScope.id !== settingsAttempt.scope_id
      || !equal(settingsScope.identity, { scope: leagueSettingsScope(mapping), policy: LEAGUE_SETTINGS_POLICY })
      || settingsAccepted.receipt_id !== settings.id || settingsAccepted.scope_id !== settingsScope.id
      || settingsScope.connection_id !== mapping.connectionId || settingsScope.league_season_id !== mapping.leagueSeasonId
      || positive(settingsAccepted.generation) !== Number(settingsAttempt.expected_generation) + 1
      || settingsAccepted.source_mapping_revision_id !== mapping.revisionId
      || !equal(settings.coverage, { periodIds: [], interval: null, entitySet: 'full', fields: LEAGUE_SETTINGS_FIELDS,
        pagination: 'complete', nextCursor: null, completeness: 'complete', reasons: [] })) throw new Error('Invalid intake settings receipt pair.');
  }
  const calendar = readNativePeriodMapping(row.calendar_evidence, mapping, id(configuration.id), object(configuration.payload), selection.nativeWeek);
  const evidence = row.applicability_evidence && typeof row.applicability_evidence === 'object' && !Array.isArray(row.applicability_evidence)
    ? row.applicability_evidence as Record<string, unknown> : { scoring: false, roster: false, competition: false };
  const resolved: PeriodConfigurationContext = {
    scoring: componentContext('scoring', evidence.scoring, mapping, calendar),
    roster: componentContext('roster', evidence.roster, mapping, calendar),
    competition: componentContext('competition', evidence.competition, mapping, calendar),
  };
  return { status: 'available', version: EXACT_PERIOD_CONTEXT_VERSION, period: { season: 2026, nativeWeek: selection.nativeWeek },
    sourceMappingRevisionId: mapping.revisionId,
    capture: { matchupsReceiptId: selection.matchupsReceiptId, settingsReceiptId: selection.intakeCapture?.settingsReceiptId ?? null,
      configurationContentId: id(configuration.id) },
    observedConfiguration: { contentId: id(configuration.id), configurationVersionId: configuration.configuration_version_id === null
      ? null : id(configuration.configuration_version_id), rawContentHash: String(configuration.content_hash),
      provenance: observed.provenance, value: observed.value, applicability: 'observation-only' },
    calendar, configuration: resolved, nativeOfficialPhase: { status: 'unknown', reason: 'native-period-phase-not-exposed' },
    phase: deriveExactPeriodPhase(calendar, resolved.competition) };
}

export function exactPeriodContextMethods(client: DatabaseClient) {
  return { async readExactPeriodContext(mapping: AdministrationSourceMapping, selection: ExactPeriodContextSelection): Promise<ExactPeriodContextRead> {
    try {
      if (!isAdministrationSourceMapping(mapping) || mapping.scope.season !== 2026
        || !Number.isSafeInteger(selection.nativeWeek) || selection.nativeWeek < 1 || selection.nativeWeek > 18) {
        return { status: 'unavailable', reason: 'invalid_period_context_scope' };
      }
      id(selection.matchupsReceiptId);
      if (selection.intakeCapture) { id(selection.intakeCapture.intakeId); id(selection.intakeCapture.settingsReceiptId); }
      const rows = await client.query(EXACT_PERIOD_CONTEXT_SQL, [selection.matchupsReceiptId,
        JSON.stringify({ scope: exactMatchupsScope(mapping, selection.nativeWeek), policy: EXACT_MATCHUPS_POLICY }),
        mapping.revisionId, selection.nativeWeek, mapping.generation, mapping.leagueSeasonId, mapping.connectionId,
        selection.intakeCapture?.intakeId ?? null, selection.intakeCapture?.settingsReceiptId ?? null]);
      if (!rows.length) return { status: 'missing' };
      if (rows.length !== 1) throw new Error('Ambiguous period context.');
      return readRow(rows[0], mapping, selection);
    } catch { return { status: 'unavailable', reason: 'period_context_evidence_unavailable' }; }
  } };
}
