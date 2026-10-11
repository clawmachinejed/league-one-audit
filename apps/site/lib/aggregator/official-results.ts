import { isAdministrationSourceMapping, type AdministrationSourceMapping } from '../league-administration/source-mapping';
import { compatibleRevision } from '../projections/shared/revision-compatibility';
import { EXACT_MATCHUP_VALUES_VERSION, type ExactMatchupValuesRead } from './exact-matchup-values';
import { EXACT_PERIOD_CONTEXT_VERSION, type ExactPeriodContextRead } from './exact-period-context';
import { BRACKET_VALUE_VERSION, type AcceptedBracketRead, type BracketFamily, type BracketField } from './playoff-brackets';
import { OFFICIAL_STANDINGS_VERSION, type OfficialStandingsRead } from './official-standings';

export const OFFICIAL_RESULTS_VERSION = 'sleeper-official-results-v1' as const;
export type OfficialResultsPeriodInput = Readonly<{
  nativeWeek: number; values: ExactMatchupValuesRead; context?: ExactPeriodContextRead;
}>;
export type OfficialResultsBracketInput = Readonly<{ family: BracketFamily; resource: AcceptedBracketRead }>;
export type OfficialResultsInput = Readonly<{
  mapping: AdministrationSourceMapping; standings: OfficialStandingsRead;
  periods: readonly OfficialResultsPeriodInput[]; brackets: readonly OfficialResultsBracketInput[];
}>;
export type OfficialResultFinality = Readonly<{
  status: 'unknown'; reason: 'provider_finality_evidence_unproved';
}>;
export type OfficialResultsPeriod = OfficialResultsPeriodInput & Readonly<{
  identity: Readonly<{ kind: 'native-period'; season: 2026; nativeWeek: number }>;
  officialOutcome: Readonly<{ status: 'unknown'; reason: 'weekly_result_evidence_unproved' }>;
  finality: OfficialResultFinality;
  series: Readonly<{ status: 'unknown'; reason: 'series_membership_unproved' }>;
}>;
export type OfficialBracketReportedResult = Readonly<{
  identity: Readonly<{ kind: 'bracket-match'; season: 2026; family: BracketFamily; externalMatchupId: string }>;
  source: Readonly<{ bracketReceiptId: string; sourceOrdinal: number; winnerPath: 'w'; loserPath: 'l' }>;
  winner: BracketField<string>; loser: BracketField<string>; finality: OfficialResultFinality;
}>;
export type OfficialResultsRead = Readonly<{
  status: 'available'; version: typeof OFFICIAL_RESULTS_VERSION; mapping: AdministrationSourceMapping;
  /** Components retain independent observation clocks. This is not a season-completion assertion. */
  scope: 'selected-resources'; standings: OfficialStandingsRead; periods: readonly OfficialResultsPeriod[];
  brackets: readonly (OfficialResultsBracketInput & Readonly<{ reportedResults: readonly OfficialBracketReportedResult[] }>)[];
}> | Readonly<{ status: 'unavailable'; reason: string }>;

/** Compose stored native facts without acquiring data, sorting standings, comparing scores,
 * joining weekly and bracket IDs, or interpreting an unproved series/finality rule. No positive
 * provisional/final branch exists until supported provider evidence establishes its meaning.
 */
export function composeOfficialResults(input: OfficialResultsInput): OfficialResultsRead {
  try {
    const { mapping, standings, periods, brackets } = input;
    if (!isAdministrationSourceMapping(mapping) || mapping.scope.season !== 2026
      || periods.length > 18 || brackets.length > 2) throw new Error('Invalid result scope.');
    if (standings.status === 'available' && (standings.version !== OFFICIAL_STANDINGS_VERSION
      || compatibleRevision(standings.mapping) !== compatibleRevision(mapping))) throw new Error('Invalid standings scope.');
    const weeks = new Set<number>();
    const composedPeriods = periods.map((period): OfficialResultsPeriod => {
      const { nativeWeek, values, context } = period;
      if (!Number.isSafeInteger(nativeWeek) || nativeWeek < 1 || nativeWeek > 18 || weeks.has(nativeWeek)) {
        throw new Error('Invalid result period.');
      }
      weeks.add(nativeWeek);
      if (values.status === 'available' && (values.version !== EXACT_MATCHUP_VALUES_VERSION
        || values.sourceMappingRevisionId !== mapping.revisionId || values.value.season !== mapping.scope.season
        || values.value.nativeWeek !== nativeWeek)) throw new Error('Invalid score scope.');
      if (context?.status === 'available' && (context.version !== EXACT_PERIOD_CONTEXT_VERSION
        || context.sourceMappingRevisionId !== mapping.revisionId || context.period.season !== mapping.scope.season
        || context.period.nativeWeek !== nativeWeek || values.status === 'available'
        && context.capture.matchupsReceiptId !== values.matchupsReceiptId)) throw new Error('Invalid context scope.');
      return { ...period, identity: { kind: 'native-period', season: 2026, nativeWeek },
        officialOutcome: { status: 'unknown', reason: 'weekly_result_evidence_unproved' },
        finality: { status: 'unknown', reason: 'provider_finality_evidence_unproved' },
        series: { status: 'unknown', reason: 'series_membership_unproved' } };
    });
    const families = new Set<BracketFamily>();
    const composedBrackets = brackets.map(bracket => {
      const { family, resource } = bracket;
      if (family !== 'winners_bracket' && family !== 'losers_bracket' || families.has(family)) {
        throw new Error('Invalid result bracket.');
      }
      families.add(family);
      if (resource.status === 'available' && (resource.version !== BRACKET_VALUE_VERSION
        || resource.sourceMappingRevisionId !== mapping.revisionId || resource.value.season !== mapping.scope.season
        || resource.value.family !== family)) throw new Error('Invalid bracket scope.');
      const reportedResults: OfficialBracketReportedResult[] = resource.status === 'available'
        ? resource.value.matches.map(match => ({
          identity: { kind: 'bracket-match', season: 2026, family, externalMatchupId: match.externalMatchupId },
          source: { bracketReceiptId: resource.bracketReceiptId, sourceOrdinal: match.sourceOrdinal, winnerPath: 'w', loserPath: 'l' },
          winner: match.winner, loser: match.loser,
          finality: { status: 'unknown', reason: 'provider_finality_evidence_unproved' },
        })) : [];
      return { ...bracket, reportedResults };
    });
    return structuredClone({ status: 'available', version: OFFICIAL_RESULTS_VERSION, mapping,
      scope: 'selected-resources', standings, periods: composedPeriods, brackets: composedBrackets });
  } catch { return { status: 'unavailable', reason: 'official_results_scope_mismatch' }; }
}
