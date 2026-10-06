/** D04/D05 policy for the existing worker eligibility owner. Inputs must be
 * reread under the database authority fences; this pure policy grants no access
 * and performs no acquisition. Persist firstLossAt/zeroDemandSince separately
 * from attempts so failed recovery cannot extend either window. */
export const ACCOUNT_DEMAND_POLICY = Object.freeze({
  viewLeaseMs: 120_000,
  zeroDemandCooldownMs: 1_800_000,
  recoveryIntervalMs: 3_600_000,
  automaticRecoveryWindowMs: 604_800_000,
});

export type AccountDemandFacts = Readonly<{
  databaseNow: number;
  registryObligation: boolean;
  eligibleExplicitFollowCount: number;
  /** Already authorized, revocation-fenced view leases, never browser dates. */
  viewLeases: readonly Readonly<{ grantedAt: number; expiresAt: number }>[];
  zeroDemandSince: number | null;
}>;
export type RoutineDemandDecision =
  | { state: 'required'; zeroDemandSince: null }
  | { state: 'cooldown'; zeroDemandSince: number; stopAt: number }
  | { state: 'stopped'; zeroDemandSince: number }
  | { state: 'indeterminate' };

function timestamp(value: number): boolean { return Number.isSafeInteger(value) && value >= 0; }

export function evaluateRoutineAccountDemand(facts: AccountDemandFacts): RoutineDemandDecision {
  const { databaseNow: now, registryObligation, eligibleExplicitFollowCount: count, viewLeases, zeroDemandSince } = facts;
  if (!timestamp(now) || typeof registryObligation !== 'boolean' || !Number.isSafeInteger(count) || count < 0
    || !Array.isArray(viewLeases) || (zeroDemandSince !== null && (!timestamp(zeroDemandSince) || zeroDemandSince > now))) {
    return { state: 'indeterminate' };
  }
  if (viewLeases.some(lease => !timestamp(lease.grantedAt) || !timestamp(lease.expiresAt)
    || lease.grantedAt > now || lease.expiresAt <= lease.grantedAt
    || lease.expiresAt - lease.grantedAt > ACCOUNT_DEMAND_POLICY.viewLeaseMs)) return { state: 'indeterminate' };
  if (registryObligation || count > 0 || viewLeases.some(lease => now < lease.expiresAt)) {
    return { state: 'required', zeroDemandSince: null };
  }
  const since = zeroDemandSince ?? now;
  const stopAt = since + ACCOUNT_DEMAND_POLICY.zeroDemandCooldownMs;
  if (!Number.isSafeInteger(stopAt)) return { state: 'indeterminate' };
  return now < stopAt ? { state: 'cooldown', zeroDemandSince: since, stopAt } : { state: 'stopped', zeroDemandSince: since };
}

export type RecoveryDemandFacts = Readonly<{
  databaseNow: number;
  actorActive: boolean;
  associationActive: boolean;
  acquisitionAuthorized: boolean;
  explicitFollowIntent: boolean;
  membershipEligible: boolean;
  firstLossAt: number | null;
  lastRecoveryAdmittedAt: number | null;
  /** A separately authenticated, persisted command; not retained follow intent. */
  explicitRecoveryCommand: boolean;
}>;
export type RecoveryDemandDecision =
  | { state: 'eligible'; purpose: 'explicit-recovery' | 'automatic-recovery' }
  | { state: 'deferred'; nextEligibleAt: number }
  | { state: 'paused' | 'unneeded' | 'denied' | 'indeterminate' };

export function evaluateAccountRecoveryDemand(facts: RecoveryDemandFacts): RecoveryDemandDecision {
  const now = facts.databaseNow;
  if (!timestamp(now) || [facts.actorActive, facts.associationActive, facts.acquisitionAuthorized,
    facts.explicitFollowIntent, facts.membershipEligible, facts.explicitRecoveryCommand].some(value => typeof value !== 'boolean')
    || [facts.firstLossAt, facts.lastRecoveryAdmittedAt].some(value => value !== null && (!timestamp(value) || value > now))) {
    return { state: 'indeterminate' };
  }
  if (!facts.actorActive || !facts.associationActive || !facts.acquisitionAuthorized) return { state: 'denied' };
  // An explicit command retains its own admission budgets, lease and deadline;
  // it never becomes routine demand or resets the automatic-loss clock.
  if (facts.explicitRecoveryCommand) return { state: 'eligible', purpose: 'explicit-recovery' };
  if (facts.membershipEligible) return { state: 'unneeded' };
  if (!facts.explicitFollowIntent) return { state: 'paused' };
  if (facts.firstLossAt === null) return { state: 'indeterminate' };
  if (now - facts.firstLossAt >= ACCOUNT_DEMAND_POLICY.automaticRecoveryWindowMs) return { state: 'paused' };
  if (facts.lastRecoveryAdmittedAt !== null && now - facts.lastRecoveryAdmittedAt < ACCOUNT_DEMAND_POLICY.recoveryIntervalMs) {
    const nextEligibleAt = facts.lastRecoveryAdmittedAt + ACCOUNT_DEMAND_POLICY.recoveryIntervalMs;
    return nextEligibleAt >= facts.firstLossAt + ACCOUNT_DEMAND_POLICY.automaticRecoveryWindowMs
      ? { state: 'paused' } : { state: 'deferred', nextEligibleAt };
  }
  return { state: 'eligible', purpose: 'automatic-recovery' };
}

/** D04 retains intention on expiry/loss/disconnect. Only current entitlement
 * can make that intention effective; this function never writes preference. */
export function effectiveAccountFollow(following: boolean, membershipEligible: boolean,
  actorActive: boolean, associationActive: boolean): boolean {
  return following === true && membershipEligible === true && actorActive === true && associationActive === true;
}
