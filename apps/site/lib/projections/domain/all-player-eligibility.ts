export type AllPlayerEffectivePeriod = Readonly<{
  season: number;
  seasonType: 'reg';
  week: number;
}>;

export type AllPlayerWeeklyEligibilityEvidence = Readonly<{
  kind: 'weekly-stat';
  source: 'weekly-stat-provider';
  gmsActive?: 0 | 1;
  appearances?: 0 | 1;
  /** Malformed flags are retained verbatim, never coerced or discarded. */
  rawFlags?: Readonly<Record<string, unknown>>;
}>;

export type AllPlayerExplicitIneligibilityEvidence = Readonly<{
  kind: 'explicit-ineligible';
  reason: 'inactive' | 'suspended' | 'reserve' | 'bye' | 'teamless' | 'other';
  source: 'player-status-provider' | 'schedule' | 'manual-review';
  sourceRevision: string;
  observedAt?: string;
  effectivePeriod?: AllPlayerEffectivePeriod;
}>;

/** Reviewed requested-game evidence, never a current catalog activity label. */
export type AllPlayerPeriodParticipationEvidence = Readonly<{
  kind: 'period-participation';
  decision: 'appearance' | 'dressed-unused' | 'ineligible' | 'ambiguous';
  source: 'gamebook' | 'official-period-roster' | 'manual-review';
  sourceRevision: string;
  observedAt: string;
  effectivePeriod: AllPlayerEffectivePeriod;
  reason: string;
  weekly?: AllPlayerWeeklyEligibilityEvidence;
}>;

export type AllPlayerEligibilityEvidence =
  | AllPlayerWeeklyEligibilityEvidence
  | AllPlayerExplicitIneligibilityEvidence
  | AllPlayerPeriodParticipationEvidence
  | Readonly<{
      kind: 'combined-ineligible' | 'conflict';
      weekly: AllPlayerWeeklyEligibilityEvidence;
      ineligibility: AllPlayerExplicitIneligibilityEvidence;
    }>
  | Readonly<{ kind: 'missing-provider-row'; inventoryFingerprint: string }>
  | Readonly<{ kind: 'unknown-weekly-stat'; source: 'weekly-stat-provider' }>;

export type AllPlayerEligibilityCounts = Readonly<{
  eligibleGameCount: 0 | 1 | null;
  appearanceGameCount: 0 | 1 | null;
}>;

const unknownCounts: AllPlayerEligibilityCounts = {
  eligibleGameCount: null, appearanceGameCount: null,
};

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isCount(value: unknown): value is 0 | 1 {
  return value === 0 || value === 1;
}

function onlyKeys(value: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function isJsonValue(value: unknown): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isRecord(value) && Object.getPrototypeOf(value) === Object.prototype
    && Object.values(value).every(isJsonValue);
}

export function isAllPlayerEffectivePeriod(value: unknown): value is AllPlayerEffectivePeriod {
  return isRecord(value) && onlyKeys(value, ['season', 'seasonType', 'week']) && Number.isInteger(value.season)
    && Number(value.season) >= 2026 && Number(value.season) <= 2200
    && value.seasonType === 'reg' && Number.isInteger(value.week)
    && Number(value.week) >= 1 && Number(value.week) <= 18;
}

export function hasAllPlayerPeriodProvenance(value: unknown): boolean {
  return isRecord(value) && typeof value.sourceRevision === 'string'
    && value.sourceRevision.trim().length > 0
    && typeof value.observedAt === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value.observedAt)
    && Number.isFinite(Date.parse(value.observedAt))
    && new Date(value.observedAt).toISOString() === value.observedAt
    && isAllPlayerEffectivePeriod(value.effectivePeriod);
}

export function allPlayerEvidenceMatchesPeriod(
  value: unknown, period: AllPlayerEffectivePeriod,
): boolean {
  if (!isRecord(value) || !hasAllPlayerPeriodProvenance(value)
    || !isAllPlayerEffectivePeriod(value.effectivePeriod)) return false;
  return value.effectivePeriod.season === period.season
    && value.effectivePeriod.seasonType === period.seasonType
    && value.effectivePeriod.week === period.week;
}

function weeklyEligibilityCounts(value: unknown): AllPlayerEligibilityCounts | null {
  if (!isRecord(value) || value.kind !== 'weekly-stat'
    || value.source !== 'weekly-stat-provider'
    || !onlyKeys(value, ['kind', 'source', 'gmsActive', 'appearances', 'rawFlags'])) return null;
  const hasActive = Object.prototype.hasOwnProperty.call(value, 'gmsActive');
  const hasAppearance = Object.prototype.hasOwnProperty.call(value, 'appearances');
  if ((hasActive && !isCount(value.gmsActive))
    || (hasAppearance && !isCount(value.appearances))) return null;
  if (value.rawFlags !== undefined) {
    if (!isRecord(value.rawFlags) || Object.keys(value.rawFlags).length === 0
      || Object.keys(value.rawFlags).some((key) => !['gms_active', 'gp'].includes(key))) return null;
    if (Object.values(value.rawFlags).some((flag) => isCount(flag) || !isJsonValue(flag))) return null;
    return unknownCounts;
  }
  if (value.gmsActive === 0) return value.appearances === 1
    ? unknownCounts : { eligibleGameCount: 0, appearanceGameCount: 0 };
  if (value.appearances === 1) return { eligibleGameCount: 1, appearanceGameCount: 1 };
  if (value.gmsActive === 1 && value.appearances === 0) {
    return { eligibleGameCount: 1, appearanceGameCount: 0 };
  }
  // Rank-only activity and absent gp do not prove that the player dressed.
  return unknownCounts;
}

function isExplicitIneligibility(value: unknown): value is AllPlayerExplicitIneligibilityEvidence {
  return isRecord(value) && value.kind === 'explicit-ineligible'
    && onlyKeys(value, ['kind', 'reason', 'source', 'sourceRevision', 'observedAt', 'effectivePeriod'])
    && ['inactive', 'suspended', 'reserve', 'bye', 'teamless', 'other'].includes(String(value.reason))
    && ['player-status-provider', 'schedule', 'manual-review'].includes(String(value.source))
    && hasAllPlayerPeriodProvenance(value);
}

export function isAllPlayerPeriodParticipation(
  value: unknown,
): value is AllPlayerPeriodParticipationEvidence {
  return isRecord(value) && value.kind === 'period-participation'
    && onlyKeys(value, ['kind', 'decision', 'source', 'sourceRevision', 'observedAt', 'effectivePeriod', 'reason', 'weekly'])
    && ['appearance', 'dressed-unused', 'ineligible', 'ambiguous'].includes(String(value.decision))
    && ['gamebook', 'official-period-roster', 'manual-review'].includes(String(value.source))
    && typeof value.reason === 'string' && value.reason.trim().length > 0
    && hasAllPlayerPeriodProvenance(value)
    && (value.weekly === undefined || weeklyEligibilityCounts(value.weekly) !== null);
}

/** Shared adapter/writer derivation. Contradictions remain valid raw history. */
export function allPlayerEligibilityCounts(value: unknown): AllPlayerEligibilityCounts | null {
  if (isRecord(value) && value.kind === 'weekly-stat') return weeklyEligibilityCounts(value);
  if (isExplicitIneligibility(value)) return { eligibleGameCount: 0, appearanceGameCount: 0 };
  if (isAllPlayerPeriodParticipation(value)) {
    if (value.decision === 'ambiguous') return unknownCounts;
    const expected = value.decision === 'appearance'
      ? { eligibleGameCount: 1 as const, appearanceGameCount: 1 as const }
      : value.decision === 'dressed-unused'
        ? { eligibleGameCount: 1 as const, appearanceGameCount: 0 as const }
        : { eligibleGameCount: 0 as const, appearanceGameCount: 0 as const };
    if (!value.weekly) return expected;
    const weekly = weeklyEligibilityCounts(value.weekly);
    if (value.weekly.rawFlags || (value.weekly.gmsActive === 0 && value.weekly.appearances === 1)) {
      return unknownCounts;
    }
    if (weekly && weekly.eligibleGameCount !== null
      && (weekly.eligibleGameCount !== expected.eligibleGameCount
        || weekly.appearanceGameCount !== expected.appearanceGameCount)) return unknownCounts;
    return expected;
  }
  if (isRecord(value) && (value.kind === 'combined-ineligible' || value.kind === 'conflict')
    && onlyKeys(value, ['kind', 'weekly', 'ineligibility'])
    && isExplicitIneligibility(value.ineligibility)) {
    const weekly = weeklyEligibilityCounts(value.weekly);
    if (!weekly) return null;
    const hasConflict = weekly.eligibleGameCount === 1 || weekly.appearanceGameCount === 1
      || (isRecord(value.weekly) && (value.weekly.rawFlags !== undefined
        || (value.weekly.gmsActive === 0 && value.weekly.appearances === 1)));
    return value.kind === 'conflict'
      ? hasConflict ? unknownCounts : null
      : hasConflict ? null : { eligibleGameCount: 0, appearanceGameCount: 0 };
  }
  if (isRecord(value) && value.kind === 'missing-provider-row'
    && onlyKeys(value, ['kind', 'inventoryFingerprint'])
    && typeof value.inventoryFingerprint === 'string'
    && /^sha256:[0-9a-f]{64}$/u.test(value.inventoryFingerprint)) return unknownCounts;
  if (isRecord(value) && value.kind === 'unknown-weekly-stat'
    && onlyKeys(value, ['kind', 'source'])
    && value.source === 'weekly-stat-provider') return unknownCounts;
  return null;
}

/** Re-derives counts rather than trusting caller-supplied flags. */
export function validateAllPlayerEligibility(entry: Readonly<{
  eligibilityEvidence: AllPlayerEligibilityEvidence;
  eligibleGameCount: 0 | 1 | null;
  appearanceGameCount: 0 | 1 | null;
}>): boolean {
  const expected = allPlayerEligibilityCounts(entry.eligibilityEvidence);
  return expected !== null
    && expected.eligibleGameCount === entry.eligibleGameCount
    && expected.appearanceGameCount === entry.appearanceGameCount;
}
