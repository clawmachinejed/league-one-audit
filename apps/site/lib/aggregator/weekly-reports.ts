import type { SourceScope } from './contracts';
import type { NormalizedAdministrationObservation } from '../league-administration/contracts';
import { normalizeAdministrationObservation } from '../league-administration/normalize';
import { isAdministrationSourceMapping, type AdministrationSourceMapping } from '../league-administration/source-mapping';
import { compatibleRevision } from '../projections/shared/revision-compatibility';
import { WEEKLY_REPORT_VERSION, WEEKLY_REPORT_POLICY, type WeeklyReportNormalization } from './weekly-report-normalization';
export * from './weekly-report-normalization';

export function weeklyReportScope(mapping: AdministrationSourceMapping, nativeWeek: number): SourceScope {
  if (!isAdministrationSourceMapping(mapping) || mapping.scope.season !== 2026
    || !Number.isSafeInteger(nativeWeek) || nativeWeek < 1 || nativeWeek > 18) throw new Error('Invalid weekly report scope.');
  return { kind: 'enrolled-resource', connectionId: mapping.connectionId, leagueSeasonId: mapping.leagueSeasonId,
    family: 'weekly-reports', entityId: 'league_report', scoringPeriodId: `sleeper:report-week:${nativeWeek}`,
    audienceId: WEEKLY_REPORT_POLICY.audienceId, coverageSpecId: WEEKLY_REPORT_POLICY.coverageSpecId };
}
const reject = (code: string, path: string): WeeklyReportNormalization =>
  ({ status: 'rejected', version: WEEKLY_REPORT_VERSION, value: null, diagnostics: [{ code, path }] });

/** Revalidate the raw/normalized pair. Source facts do not create a weekly result or finality. */
export function projectWeeklyReport(normalized: NormalizedAdministrationObservation): WeeklyReportNormalization {
  try {
    const checked = normalizeAdministrationObservation(normalized.envelope);
    if (checked.status !== 'accepted' || checked.value?.family !== 'weekly_report') {
      return reject('invalid_weekly_report_observation', 'envelope');
    }
    if (normalized.status !== 'accepted' || normalized.contentHash !== checked.contentHash
      || normalized.semanticHash !== checked.semanticHash || compatibleRevision(normalized.value) !== compatibleRevision(checked.value)) {
      return reject('weekly_report_native_normalized_mismatch', 'value');
    }
    return { status: 'accepted', version: WEEKLY_REPORT_VERSION, value: structuredClone(checked.value.report), diagnostics: [] };
  } catch { return reject('invalid_weekly_report_observation', 'envelope'); }
}
