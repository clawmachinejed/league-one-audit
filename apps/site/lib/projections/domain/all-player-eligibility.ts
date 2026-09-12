export type AllPlayerWeeklyEligibilityEvidence = Readonly<{
  kind: 'weekly-stat';
  source: 'weekly-stat-provider';
  gmsActive?: 0 | 1;
  appearances?: 0 | 1;
}>;

export type AllPlayerExplicitIneligibilityEvidence = Readonly<{
  kind: 'explicit-ineligible';
  reason: 'inactive' | 'suspended' | 'reserve' | 'bye' | 'teamless' | 'other';
  source: 'player-status-provider' | 'schedule' | 'manual-review';
  sourceRevision: string;
}>;

export type AllPlayerEligibilityEvidence =
  | AllPlayerWeeklyEligibilityEvidence
  | AllPlayerExplicitIneligibilityEvidence
  | Readonly<{
      kind: 'combined-ineligible';
      weekly: AllPlayerWeeklyEligibilityEvidence;
      ineligibility: AllPlayerExplicitIneligibilityEvidence;
    }>
  | Readonly<{
      kind: 'conflict';
      weekly: AllPlayerWeeklyEligibilityEvidence;
      ineligibility: AllPlayerExplicitIneligibilityEvidence;
    }>
  | Readonly<{
      kind: 'missing-provider-row';
      inventoryFingerprint: string;
    }>
  | Readonly<{
      kind: 'unknown-weekly-stat';
      source: 'weekly-stat-provider';
    }>;

type EligibilityCounts = Readonly<{
  eligibleGameCount: 0 | 1 | null;
  appearanceGameCount: 0 | 1 | null;
}>;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isCount(value: unknown): value is 0 | 1 {
  return value === 0 || value === 1;
}

function weeklyEligibilityCounts(value: unknown): EligibilityCounts | null {
  if (!isRecord(value) || value.kind !== 'weekly-stat'
    || value.source !== 'weekly-stat-provider') return null;
  const hasActive = Object.prototype.hasOwnProperty.call(value, 'gmsActive');
  const hasAppearance = Object.prototype.hasOwnProperty.call(value, 'appearances');
  if ((hasActive && !isCount(value.gmsActive))
    || (hasAppearance && !isCount(value.appearances))) return null;
  if (value.gmsActive === 0) return value.appearances === undefined || value.appearances === 0
    ? { eligibleGameCount: 0, appearanceGameCount: 0 } : null;
  if (value.gmsActive === 1) return {
    eligibleGameCount: 1,
    appearanceGameCount: value.appearances === 1 ? 1 : 0,
  };
  if (value.appearances === 1) return { eligibleGameCount: 1, appearanceGameCount: 1 };
  return { eligibleGameCount: null, appearanceGameCount: null };
}

function isExplicitIneligibility(value: unknown): value is AllPlayerExplicitIneligibilityEvidence {
  return isRecord(value) && value.kind === 'explicit-ineligible'
    && ['inactive', 'suspended', 'reserve', 'bye', 'teamless', 'other'].includes(String(value.reason))
    && ['player-status-provider', 'schedule', 'manual-review'].includes(String(value.source))
    && typeof value.sourceRevision === 'string' && value.sourceRevision.trim().length > 0;
}

/** Re-derives counts from the evidence instead of trusting caller-supplied flags. */
export function validateAllPlayerEligibility(entry: Readonly<{
  eligibilityEvidence: AllPlayerEligibilityEvidence;
  eligibleGameCount: 0 | 1 | null;
  appearanceGameCount: 0 | 1 | null;
}>): boolean {
  const evidence: unknown = entry.eligibilityEvidence;
  let expected: EligibilityCounts | null = null;
  if (isRecord(evidence) && evidence.kind === 'weekly-stat') {
    expected = weeklyEligibilityCounts(evidence);
  } else if (isExplicitIneligibility(evidence)) {
    expected = { eligibleGameCount: 0, appearanceGameCount: 0 };
  } else if (isRecord(evidence)
    && (evidence.kind === 'combined-ineligible' || evidence.kind === 'conflict')
    && isExplicitIneligibility(evidence.ineligibility)) {
    const weekly = weeklyEligibilityCounts(evidence.weekly);
    if (!weekly) return false;
    expected = evidence.kind === 'conflict'
      ? { eligibleGameCount: null, appearanceGameCount: null }
      : weekly.eligibleGameCount === 1 || weekly.appearanceGameCount === 1
        ? null : { eligibleGameCount: 0, appearanceGameCount: 0 };
  } else if (isRecord(evidence) && evidence.kind === 'missing-provider-row'
    && typeof evidence.inventoryFingerprint === 'string'
    && /^sha256:[0-9a-f]{64}$/u.test(evidence.inventoryFingerprint)) {
    expected = { eligibleGameCount: null, appearanceGameCount: null };
  } else if (isRecord(evidence) && evidence.kind === 'unknown-weekly-stat'
    && evidence.source === 'weekly-stat-provider') {
    expected = { eligibleGameCount: null, appearanceGameCount: null };
  }
  return expected !== null
    && expected.eligibleGameCount === entry.eligibleGameCount
    && expected.appearanceGameCount === entry.appearanceGameCount;
}
