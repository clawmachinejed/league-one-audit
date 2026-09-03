/** The exact schedule facts needed by cadence policy; no provider or website payload. */
export type PeriodCadenceTiming = Readonly<{
  isCurrentRegularPeriod: boolean;
  games: readonly Readonly<{ kickoffAt: string | null; date: string }>[];
}>;
