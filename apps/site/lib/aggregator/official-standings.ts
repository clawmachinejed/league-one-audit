import type { AdministrationProvenance, NormalizedAdministrationObservation } from '../league-administration/contracts';
import type { AdministrationSourceMapping } from '../league-administration/source-mapping';
import type { SeasonFact, SeasonPointsFact } from './season-overview-source-contracts';
import { seasonField, seasonInteger, seasonObject, seasonPoints } from './season-overview-fields';

export const OFFICIAL_STANDINGS_VERSION = 'sleeper-official-standings-v1' as const;
export const OFFICIAL_STANDINGS_TEAM_LIMIT = 20;
export const OFFICIAL_STANDINGS_BYTE_LIMIT = 1_048_576;
export type OfficialStandingsTeam = Readonly<{
  externalRosterId: string; sourceOrdinal: number;
  record: Readonly<Record<'wins' | 'losses' | 'ties', SeasonFact<number>>>;
  pointsFor: SeasonPointsFact; pointsAgainst: SeasonPointsFact;
  /** Only explicitly supplied native fields, never inferred from source order or scores. */
  providerRank: SeasonFact<number>; providerSeed: SeasonFact<number>;
}>;
export type OfficialStandingsProjection = Readonly<{
  version: typeof OFFICIAL_STANDINGS_VERSION; status: 'qualified' | 'invalid' | 'capacity';
  teams: readonly OfficialStandingsTeam[]; reasons: readonly string[];
}>;
export type OfficialStandingsSelection = Readonly<{ rosterReceiptId?: string }>;
export type OfficialStandingsCapture = Readonly<{
  rosterReceiptId: string; attemptId: string; ordinal: number; contentId: string; legacyObservationId: string;
  provenance: AdministrationProvenance; configurationContentId: string | null; expectedTeamCount: number | null;
}>;
export type OfficialStandingsRead = Readonly<{
  status: 'available'; version: typeof OFFICIAL_STANDINGS_VERSION; selection: 'current' | 'receipt';
  mapping: AdministrationSourceMapping; capture: OfficialStandingsCapture;
  temporalContext: 'season-to-date'; historicalApplicability: 'unverified'; freshness: 'unknown';
  coverage: Readonly<{
    entitySet: 'full' | 'partial' | 'unknown'; recordCompleteness: 'complete' | 'partial' | 'unknown';
    population: 'proven' | 'unproved' | 'mismatch'; reasons: readonly string[];
  }>;
  teams: readonly (OfficialStandingsTeam & Readonly<{ seasonTeamId: string }>)[];
}> | Readonly<{ status: 'missing' | 'disabled' | 'unavailable'; reason?: string }>;

/** Field qualification for one existing roster capture, independent of player/manager validity.
 * The writer validates envelope, mapping, source witness and population; this parser never
 * creates those authorities, canonical teams, an acceptance, a clock or a complete entity set.
 */
export function projectOfficialStandings(normalized: NormalizedAdministrationObservation): OfficialStandingsProjection {
  const fail = (status: 'invalid' | 'capacity', reason: string): OfficialStandingsProjection =>
    ({ version: OFFICIAL_STANDINGS_VERSION, status, teams: [], reasons: [reason] });
  const { payload } = normalized.envelope;
  if (!Array.isArray(payload)) return fail('invalid', 'invalid_roster_identity');
  if (payload.length > OFFICIAL_STANDINGS_TEAM_LIMIT) return fail('capacity', 'standings_team_limit_exceeded');
  const teams: OfficialStandingsTeam[] = [];
  const seen = new Set<string>();
  for (const [sourceOrdinal, raw] of payload.entries()) {
    const row = seasonObject(raw);
    if (!row || typeof row.roster_id !== 'number' || !Number.isSafeInteger(row.roster_id) || row.roster_id < 1
      || Object.hasOwn(row, 'league_id') && row.league_id !== normalized.envelope.scope.externalLeagueId) {
      return fail('invalid', 'invalid_roster_identity');
    }
    const externalRosterId = String(row.roster_id);
    if (seen.has(externalRosterId)) return fail('invalid', 'invalid_roster_identity');
    seen.add(externalRosterId);
    const settings = row.settings === undefined ? {} : seasonObject(row.settings);
    const count = (key: string, minimum = 0) => seasonField(settings, key, `settings.${key}`, seasonInteger(minimum));
    teams.push({ externalRosterId, sourceOrdinal,
      record: { wins: count('wins'), losses: count('losses'), ties: count('ties') },
      pointsFor: seasonPoints(settings, 'fpts', 'fpts_decimal'),
      pointsAgainst: seasonPoints(settings, 'fpts_against', 'fpts_against_decimal'),
      providerRank: count('rank', 1), providerSeed: count('seed', 1) });
  }
  const result: OfficialStandingsProjection = { version: OFFICIAL_STANDINGS_VERSION, status: 'qualified', teams, reasons: [] };
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > OFFICIAL_STANDINGS_BYTE_LIMIT) {
    return fail('capacity', 'standings_byte_limit_exceeded');
  }
  return result;
}
