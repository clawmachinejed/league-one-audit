import type { AdministrationProvenance, ConfigurationBinding } from '../league-administration/contracts';
import type { ExactPeriodMappingQualification } from './exact-matchups';
import type { LeagueSettingsValue } from './league-settings';

export const EXACT_PERIOD_CONTEXT_VERSION = 'sleeper-exact-period-context-v1' as const;
export const EXACT_PERIOD_PHASE_POLICY = 'sleeper-applicable-competition-boundaries-v1' as const;
export type ExactPeriodContextSelection = Readonly<{
  nativeWeek: number; matchupsReceiptId: string;
  /** A supplied pair must be the original immutable intake checkpoint. */
  intakeCapture?: Readonly<{ intakeId: string; settingsReceiptId: string }>;
}>;
export type PeriodComponentUnknownReason = 'period_mapping_unproved' | 'no_binding' | 'missing_version'
  | 'inconsistent_binding' | 'invalid_applicability_evidence' | 'applicability_inventory_overflow';
export type PeriodComponentContext<T> = Readonly<{
  status: 'known'; basis: 'latest-evidenced-decision'; binding: ConfigurationBinding;
  activationRef: string; range: Readonly<{ seasonType: string; fromWeek: number; throughWeek: number }>;
  source: Readonly<{ configurationContentId: string; rawContentHash: string }>;
  fields: T;
}> | Readonly<{ status: 'unknown'; reason: PeriodComponentUnknownReason }>;
export type PeriodConfigurationContext = Readonly<{
  scoring: PeriodComponentContext<Pick<LeagueSettingsValue, 'scoring'>>;
  roster: PeriodComponentContext<Pick<LeagueSettingsValue, 'slots'>>;
  competition: PeriodComponentContext<Pick<LeagueSettingsValue, 'competition' | 'rosterRules' | 'waivers'>>;
}>;
type BoundaryName = 'startPeriod' | 'playoffStartPeriod';
export type PeriodBoundaryGap = Readonly<{ field: BoundaryName;
  reason: 'absent' | 'null' | 'invalid' | 'empty' | 'zero' | 'out-of-range' }>;
type UnprovedCompetitionDetails = Readonly<{
  round: Readonly<{ status: 'unknown'; reason: 'round_evidence_missing' }>;
  leg: Readonly<{ status: 'unknown'; reason: 'leg_evidence_missing' }>;
  end: Readonly<{ status: 'unknown'; reason: 'competition_end_evidence_missing' }>;
}>;
export type ExactPeriodPhase = UnprovedCompetitionDetails & (
  | Readonly<{ status: 'derived'; value: 'before-start' | 'regular-window' | 'on-or-after-playoff-start';
    policyVersion: typeof EXACT_PERIOD_PHASE_POLICY;
    basis: 'owner-confirmed-applicable-settings'; activationRef: string; componentHash: string;
    generation: number; recordedAt: string; periodMappingRef: string;
    boundaries: Readonly<{ startPeriod: number; playoffStartPeriod: number }> }>
  | Readonly<{ status: 'unknown'; reason: 'period_mapping_unproved' | 'competition_applicability_unknown'
    | 'inconsistent_competition_binding' | 'competition_boundaries_unproved' | 'contradictory_competition_boundaries';
    boundaryGaps?: readonly PeriodBoundaryGap[] }>);
export type ExactPeriodContextRead = Readonly<{
  status: 'available'; version: typeof EXACT_PERIOD_CONTEXT_VERSION;
  period: Readonly<{ season: 2026; nativeWeek: number }>; sourceMappingRevisionId: string;
  capture: Readonly<{ matchupsReceiptId: string; settingsReceiptId: string | null; configurationContentId: string }>;
  /** This is an original observation, never a declaration of historical effectivity. */
  observedConfiguration: Readonly<{ contentId: string; configurationVersionId: string | null; rawContentHash: string;
    provenance: AdministrationProvenance; value: LeagueSettingsValue; applicability: 'observation-only' }>;
  calendar: ExactPeriodMappingQualification; configuration: PeriodConfigurationContext;
  nativeOfficialPhase: Readonly<{ status: 'unknown'; reason: 'native-period-phase-not-exposed' }>;
  phase: ExactPeriodPhase;
}> | Readonly<{ status: 'missing' | 'unavailable' | 'disabled'; reason?: string }>;

/** Classifies evidenced boundary relationships, not active playoffs or a bracket round.
 * Native period identity and component-specific applicability are independent prerequisites.
 */
export function deriveExactPeriodPhase(calendar: ExactPeriodMappingQualification,
  competition: PeriodConfigurationContext['competition']): ExactPeriodPhase {
  const unproved: UnprovedCompetitionDetails = {
    round: { status: 'unknown', reason: 'round_evidence_missing' },
    leg: { status: 'unknown', reason: 'leg_evidence_missing' },
    end: { status: 'unknown', reason: 'competition_end_evidence_missing' },
  };
  if (calendar.status !== 'mapped' || calendar.season !== 2026 || !Number.isSafeInteger(calendar.week)
    || calendar.week < 1 || calendar.week > 18) return { ...unproved, status: 'unknown', reason: 'period_mapping_unproved' };
  if (competition.status !== 'known') return { ...unproved, status: 'unknown', reason: 'competition_applicability_unknown' };
  const { binding, range } = competition;
  if (competition.basis !== 'latest-evidenced-decision' || binding.component !== 'competition'
    || binding.evidence.kind !== 'owner_confirmed' || !binding.evidence.reference.trim()
    || !Number.isSafeInteger(binding.generation) || binding.generation < 1
    || binding.period.season !== calendar.season || binding.period.seasonType !== calendar.seasonType
    || binding.period.week !== calendar.week || range.seasonType !== calendar.seasonType
    || !Number.isSafeInteger(range.fromWeek) || !Number.isSafeInteger(range.throughWeek)
    || range.fromWeek < 1 || range.throughWeek > 30 || range.fromWeek > calendar.week || range.throughWeek < calendar.week) {
    return { ...unproved, status: 'unknown', reason: 'inconsistent_competition_binding' };
  }
  const gaps: PeriodBoundaryGap[] = [];
  const boundaries = {} as Record<BoundaryName, number>;
  for (const field of ['startPeriod', 'playoffStartPeriod'] as const) {
    const evidence = competition.fields.competition[field];
    if (evidence.state !== 'known') { gaps.push({ field, reason: evidence.state }); continue; }
    const value = evidence.value;
    if (typeof value !== 'number' || !Number.isSafeInteger(value)) gaps.push({ field, reason: 'invalid' });
    else if (value === 0) gaps.push({ field, reason: 'zero' });
    else if (value < 1 || value > 18) gaps.push({ field, reason: 'out-of-range' });
    else boundaries[field] = value;
  }
  if (gaps.length) return { ...unproved, status: 'unknown', reason: 'competition_boundaries_unproved', boundaryGaps: gaps };
  if (boundaries.playoffStartPeriod < boundaries.startPeriod) {
    return { ...unproved, status: 'unknown', reason: 'contradictory_competition_boundaries' };
  }
  return { ...unproved, status: 'derived', policyVersion: EXACT_PERIOD_PHASE_POLICY,
    value: calendar.week < boundaries.startPeriod ? 'before-start'
      : calendar.week < boundaries.playoffStartPeriod ? 'regular-window' : 'on-or-after-playoff-start',
    basis: 'owner-confirmed-applicable-settings', activationRef: competition.activationRef,
    componentHash: binding.componentHash, generation: binding.generation, recordedAt: binding.recordedAt,
    periodMappingRef: calendar.evidenceRef, boundaries };
}
