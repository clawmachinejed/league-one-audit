import type { ExactPeriodMappingQualification } from '../../aggregator/exact-matchups';
import type { AdministrationSourceMapping } from '../source-mapping';
import { validateSleeperCalendarEvidence } from '../period-mapping';
import { sleeperRegularSeasonPeriod } from '../../projections/adapters/sleeper/schedule';

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
function uuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/** Optional proof cannot suppress official facts or borrow a mutable current authority. */
export function readNativePeriodMapping(input: unknown, mapping: AdministrationSourceMapping,
  configurationContentId: string, configuration: Readonly<Record<string, unknown>>, week: number): ExactPeriodMappingQualification {
  if (input === null || input === undefined) return { status: 'unmapped', reason: 'calendar_evidence_missing' };
  if (configuration.sport !== 'nfl' || configuration.season_type !== 'regular') {
    return { status: 'unmapped', reason: 'league_format_unqualified' };
  }
  try {
    const row = object(input);
    if (!row || !uuid(row.id) || !uuid(row.observation_id)
      || row.connection_id !== mapping.connectionId || row.league_season_id !== mapping.leagueSeasonId
      || row.source_mapping_revision_id !== mapping.revisionId
      || row.configuration_content_id !== configurationContentId
      || configuration.league_id !== mapping.scope.externalLeagueId
      || configuration.season !== String(mapping.scope.season)) throw new Error('Mismatched calendar lineage.');
    const evidence = validateSleeperCalendarEvidence(row.evidence, String(mapping.scope.season));
    if (!evidence || row.mapping_policy_version !== evidence.mappingPolicyVersion
      || row.schedule_revision !== evidence.scheduleRevision) throw new Error('Invalid retained calendar.');
    const period = sleeperRegularSeasonPeriod(evidence.source.season, week);
    return { status: 'mapped', purpose: 'native-period-identity', evidenceRef: row.id,
      policyVersion: evidence.mappingPolicyVersion, scheduleRevision: evidence.scheduleRevision,
      evaluatedAt: evidence.evaluatedAt, retrievalStartedAt: evidence.retrievalStartedAt,
      retrievalCompletedAt: evidence.retrievalCompletedAt, sourceObservedAt: null,
      season: period.season, seasonType: 'regular', week: period.week };
  } catch { return { status: 'unmapped', reason: 'calendar_evidence_invalid' }; }
}
