import type { Decimal } from './contracts';
import type { AdministrationEnvelope, JsonObject, JsonValue } from '../league-administration/contracts';
import type { SeasonFact } from './season-overview-source-contracts';
import { seasonField, seasonFinite, seasonInteger, seasonObject } from './season-overview-fields';
import { parsedOfficialDecimal } from './exact-matchups';

export const WEEKLY_REPORT_VERSION = 'sleeper-weekly-report-v1' as const;
export const WEEKLY_REPORT_POLICY = Object.freeze({ audienceId: 'public', coverageSpecId: WEEKLY_REPORT_VERSION,
  canonicalNormalizerVersion: WEEKLY_REPORT_VERSION, validationVersion: 'latest-network-attempt-v1' });
export const WEEKLY_REPORT_TEAM_LIMIT = 20;
export const WEEKLY_REPORT_PAYLOAD_BYTE_LIMIT = 8 * 1024 * 1024;
export const WEEKLY_REPORT_VALUE_BYTE_LIMIT = 1024 * 1024;
export type WeeklyReportTeam = Readonly<{
  externalRosterId: string; sourceOrdinal: number;
  round: SeasonFact<number>; providerRank: SeasonFact<number>;
  record: SeasonFact<string>; streak: SeasonFact<string>;
  wins: SeasonFact<number>; losses: SeasonFact<number>; ties: SeasonFact<number>;
  pointsFor: SeasonFact<Decimal>; pointsAgainst: SeasonFact<Decimal>;
}>;
export type WeeklyReportValue = Readonly<{
  family: 'weekly_report'; season: 2026; nativeWeek: number;
  /** Requested key, verified against the native key when a report is published. */
  reportKey: string; publication: 'published' | 'unpublished'; nativeReportWeek: number | null;
  metadata: Readonly<{ created: SeasonFact<number>; lastUpdated: SeasonFact<number> }>;
  teams: readonly WeeklyReportTeam[];
  limitations: readonly ('report_population_unproved' | 'record_sequence_uninterpreted' | 'report_update_semantics_unproved')[];
}>;
export type WeeklyReportNormalization = Readonly<{
  status: 'accepted'; version: typeof WEEKLY_REPORT_VERSION; value: WeeklyReportValue; diagnostics: readonly [];
}> | Readonly<{
  status: 'rejected'; version: typeof WEEKLY_REPORT_VERSION; value: null;
  diagnostics: readonly Readonly<{ code: string; path: string }>[];
}>;
export type WeeklyReportSelection = Readonly<{ nativeWeek: number; reportReceiptId?: string }>;
export type AcceptedWeeklyReportRead = Readonly<{
  status: 'available'; version: typeof WEEKLY_REPORT_VERSION; selection: 'current' | 'receipt';
  contentId: string; reportReceiptId: string; acceptanceId: string; acceptedGeneration: number;
  sourceMappingRevisionId: string; provenance: AdministrationEnvelope['provenance'];
  freshness: 'unknown'; historicalApplicability: 'report-only';
  value: Omit<WeeklyReportValue, 'teams'> & Readonly<{ teams: readonly (WeeklyReportTeam & Readonly<{ seasonTeamId: string }>)[] }>;
}> | Readonly<{ status: 'missing' | 'disabled' | 'unavailable'; reason?: string }>;

const reject = (code: string, path: string): WeeklyReportNormalization =>
  ({ status: 'rejected', version: WEEKLY_REPORT_VERSION, value: null, diagnostics: [{ code, path }] });
const opaqueString = (value: JsonValue): value is string => typeof value === 'string';
function pointField(row: JsonObject, key: string, sourcePath: string): SeasonFact<Decimal> {
  const fact = seasonField(row, key, sourcePath, seasonFinite);
  return { ...fact, value: fact.state === 'known' ? parsedOfficialDecimal(fact.value!) : null };
}

/** The sole report parser. Optional fact validity is independent of structural report identity.
 * Called by the administration normalizer; it never calls that normalizer recursively.
 */
export function normalizeWeeklyReportEnvelope(envelope: AdministrationEnvelope): WeeklyReportNormalization {
  try {
    if (envelope.family !== 'weekly_report' || envelope.scope.provider !== 'sleeper' || envelope.scope.season !== 2026
      || !/^[1-9]\d{0,31}$/u.test(envelope.scope.externalLeagueId)
      || !Number.isSafeInteger(envelope.week) || Number(envelope.week) < 1 || Number(envelope.week) > 18) {
      return reject('invalid_weekly_report_scope', 'envelope');
    }
    if (envelope.completeness !== 'complete') return reject('incomplete_weekly_report', 'envelope.completeness');
    if (new TextEncoder().encode(JSON.stringify(envelope.payload)).byteLength > WEEKLY_REPORT_PAYLOAD_BYTE_LIMIT) {
      return reject('weekly_report_payload_limit', 'payload');
    }
    const body = seasonObject(envelope.payload);
    if (!body) return reject('invalid_weekly_report_response', 'payload');
    if (Object.hasOwn(body, 'errors') && (!Array.isArray(body.errors) || body.errors.length !== 0)) {
      return reject('weekly_report_graphql_errors', 'payload.errors');
    }
    const data = seasonObject(body.data);
    if (!data || !Object.hasOwn(data, 'metadata')) return reject('missing_weekly_report_metadata', 'data.metadata');
    const nativeWeek = Number(envelope.week), reportKey = `${envelope.scope.externalLeagueId}_${nativeWeek}`;
    const limitations: WeeklyReportValue['limitations'] = ['report_population_unproved', 'record_sequence_uninterpreted', 'report_update_semantics_unproved'];
    if (data.metadata === null) return { status: 'accepted', version: WEEKLY_REPORT_VERSION, diagnostics: [],
      value: { family: 'weekly_report', season: 2026, nativeWeek, reportKey, publication: 'unpublished', nativeReportWeek: null,
        metadata: { created: seasonField({}, 'created', 'data.metadata.created', seasonInteger(0)),
          lastUpdated: seasonField({}, 'last_updated', 'data.metadata.last_updated', seasonInteger(0)) }, teams: [], limitations } };
    const metadata = seasonObject(data.metadata);
    if (!metadata || metadata.type !== 'league_report' || metadata.key !== reportKey) {
      return reject('weekly_report_identity_mismatch', 'data.metadata');
    }
    const report = seasonObject(metadata.data);
    if (!report || report.week !== nativeWeek) return reject('weekly_report_week_mismatch', 'data.metadata.data.week');
    if (!Array.isArray(report.standings)) return reject('invalid_weekly_report_standings', 'data.metadata.data.standings');
    if (report.standings.length > WEEKLY_REPORT_TEAM_LIMIT) return reject('weekly_report_team_limit', 'data.metadata.data.standings');
    const seen = new Set<string>(), teams: WeeklyReportTeam[] = [];
    for (const [sourceOrdinal, raw] of report.standings.entries()) {
      const row = seasonObject(raw), prefix = `data.metadata.data.standings[${sourceOrdinal}]`;
      if (!row || typeof row.roster_id !== 'number' || !Number.isSafeInteger(row.roster_id) || row.roster_id < 1) {
        return reject('invalid_weekly_report_roster', `${prefix}.roster_id`);
      }
      const externalRosterId = String(row.roster_id);
      if (seen.has(externalRosterId)) return reject('duplicate_weekly_report_roster', `${prefix}.roster_id`);
      seen.add(externalRosterId);
      const integer = (key: string, minimum = 0) => seasonField(row, key, `${prefix}.${key}`, seasonInteger(minimum));
      teams.push({ externalRosterId, sourceOrdinal, round: integer('round'), providerRank: integer('rank', 1),
        record: seasonField(row, 'record', `${prefix}.record`, opaqueString), streak: seasonField(row, 'streak', `${prefix}.streak`, opaqueString),
        wins: integer('wins'), losses: integer('losses'), ties: integer('ties'),
        pointsFor: pointField(row, 'points', `${prefix}.points`), pointsAgainst: pointField(row, 'points_against', `${prefix}.points_against`) });
    }
    const value: WeeklyReportValue = { family: 'weekly_report', season: 2026, nativeWeek, reportKey,
      publication: 'published', nativeReportWeek: report.week,
      metadata: { created: seasonField(metadata, 'created', 'data.metadata.created', seasonInteger(0)),
        lastUpdated: seasonField(metadata, 'last_updated', 'data.metadata.last_updated', seasonInteger(0)) }, teams, limitations };
    if (new TextEncoder().encode(JSON.stringify(value)).byteLength > WEEKLY_REPORT_VALUE_BYTE_LIMIT) {
      return reject('weekly_report_value_limit', 'value');
    }
    return { status: 'accepted', version: WEEKLY_REPORT_VERSION, value, diagnostics: [] };
  } catch { return reject('invalid_weekly_report', 'payload'); }
}
