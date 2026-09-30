import { isAdministrationSourceMapping, type AdministrationSourceMapping } from '../league-administration/source-mapping';
import { matchupTemporalState, type MatchupPeriodContext } from '../matchup-period';
import { stableJson } from '../projections/shared/stable-json';
import { exactMatchupsScope, type AcceptedExactMatchupsRead } from './exact-matchups';

/** Checks reference scope only; native/NFL mapping and each feature remain separately qualified. */
export function exactMatchupReferenceFailure(
  accepted: AcceptedExactMatchupsRead, mapping: AdministrationSourceMapping, context: MatchupPeriodContext,
): string | null {
  try {
    if (!isAdministrationSourceMapping(mapping)) return 'invalid_mapping';
    if (accepted.status !== 'available') return 'official_unavailable';
    const period = accepted.value.period;
    if (stableJson(accepted.accepted.scope) !== stableJson(exactMatchupsScope(mapping, period.nativeWeek))
      || accepted.accepted.sourceMappingRevisionId !== mapping.revisionId || period.season !== mapping.scope.season
      || period.source.provider !== mapping.scope.provider || period.source.nativeNamespace !== mapping.scope.externalLeagueId
      || period.source.resourceKind !== 'competition-period' || period.source.nativeId !== String(period.nativeWeek)) {
      return 'official_scope_mismatch';
    }
    if (context.defaultSeason !== period.season || !Number.isInteger(context.defaultWeek)
      || context.defaultWeek < 1 || context.defaultWeek > 18 || typeof context.refreshDue !== 'boolean'
      || !['preseason', 'active', 'complete'].includes(context.lifecycle)
      || (context.activeSeason === null) !== (context.activeWeek === null)
      || context.activeSeason !== null && (!Number.isInteger(context.activeSeason) || context.activeSeason < 1920 || context.activeSeason > 2200)
      || context.activeWeek !== null && (!Number.isInteger(context.activeWeek) || context.activeWeek < 1 || context.activeWeek > 18)
      || context.temporalState !== matchupTemporalState({ lifecycle: context.lifecycle,
        defaultDisplayPeriod: { season: context.defaultSeason, seasonType: 'regular', week: context.defaultWeek },
        activeScoringPeriod: context.activeSeason !== null && context.activeWeek !== null
          ? { season: context.activeSeason, seasonType: 'regular', week: context.activeWeek } : null }, period.nativeWeek)) {
      return 'period_context_mismatch';
    }
    return null;
  } catch { return 'reference_evidence_invalid'; }
}

export function hasExactNflMapping(accepted: Extract<AcceptedExactMatchupsRead, { status: 'available' }>): boolean {
  const mapping = accepted.periodMapping;
  return mapping.status === 'mapped' && mapping.purpose === 'native-period-identity'
    && mapping.policyVersion === 'sleeper-native-week-to-nfl-regular-v1'
    && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(mapping.evidenceRef)
    && mapping.seasonType === 'regular' && mapping.season === accepted.value.period.season
    && mapping.week === accepted.value.period.nativeWeek;
}
