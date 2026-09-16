import type { AllPlayerEffectivePeriod } from './all-player-eligibility';

/** Prior accepted context can prove disagreement, never a historical team fact. */
export type AllPlayerHistoricalTeamContext = Readonly<{
  providerExternalId: string;
  nflTeam: string;
  sourceObservationId: string;
  observedAt: string;
  effectivePeriod: AllPlayerEffectivePeriod;
  /** A subsequent catalog change cannot silently clear retained uncertainty. */
  hasUnresolvedConflict: boolean;
}>;

export type AllPlayerTeamContextConflict = Readonly<{
  source: 'stored-all-player-observations';
  role: 'conflict-only';
  currentTeam: string | null;
  retainedContexts: readonly AllPlayerHistoricalTeamContext[];
}>;
