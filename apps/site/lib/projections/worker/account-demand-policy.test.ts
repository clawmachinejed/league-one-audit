import { describe, expect, it } from 'vitest';
import { evaluateRoutineAccountDemand, evaluateAccountRecoveryDemand, effectiveAccountFollow,
  type AccountDemandFacts, type RecoveryDemandFacts } from './account-demand-policy';

const routine: AccountDemandFacts = { databaseNow: 1_000_000, registryObligation: false,
  eligibleExplicitFollowCount: 0, viewLeases: [], zeroDemandSince: null };
const recovery: RecoveryDemandFacts = { databaseNow: 1_000_000, actorActive: true,
  associationActive: true, acquisitionAuthorized: true, explicitFollowIntent: true,
  membershipEligible: false, firstLossAt: 1_000_000, lastRecoveryAdmittedAt: null,
  explicitRecoveryCommand: false };
describe('D04/D05 eligibility policy for existing workers', () => {
  it('starts a persisted cooldown only when every routine source is absent', () => {
    expect(evaluateRoutineAccountDemand(routine)).toEqual({ state: 'cooldown', zeroDemandSince: 1_000_000, stopAt: 2_800_000 });
    for (const source of [{ registryObligation: true }, { eligibleExplicitFollowCount: 1 },
      { viewLeases: [{ grantedAt: 999_999, expiresAt: 1_119_999 }] }]) {
      expect(evaluateRoutineAccountDemand({ ...routine, ...source, zeroDemandSince: 999_000 })).toEqual({ state: 'required', zeroDemandSince: null });
    }
  });
  it.each([1_799_999, 1_800_000, 1_800_001])('stops at exact thirty-minute boundary %i', age => {
    expect(evaluateRoutineAccountDemand({ ...routine, databaseNow: 1_000_000 + age, zeroDemandSince: 1_000_000 }).state)
      .toBe(age < 1_800_000 ? 'cooldown' : 'stopped');
  });
  it('expires a view lease at its strict boundary and rejects extending its lifetime', () => {
    expect(evaluateRoutineAccountDemand({ ...routine, viewLeases: [{ grantedAt: 880_000, expiresAt: 1_000_000 }] }).state).toBe('cooldown');
    expect(evaluateRoutineAccountDemand({ ...routine, viewLeases: [{ grantedAt: 880_000, expiresAt: 1_000_001 }] }).state).toBe('indeterminate');
  });
  it('uses the union across managers; one departure cannot stop another eligible follow', () => {
    expect(evaluateRoutineAccountDemand({ ...routine, eligibleExplicitFollowCount: 2 }).state).toBe('required');
    expect(evaluateRoutineAccountDemand({ ...routine, eligibleExplicitFollowCount: 1 }).state).toBe('required');
  });
  it('does not accept future, fractional or untrusted timestamps', () => {
    for (const overrides of [{ databaseNow: NaN }, { databaseNow: 1.5 }, { zeroDemandSince: 1_000_001 },
      { eligibleExplicitFollowCount: -1 }, { viewLeases: [{ grantedAt: 1_000_001, expiresAt: 1_000_002 }] }]) {
      expect(evaluateRoutineAccountDemand({ ...routine, ...overrides }).state).toBe('indeterminate');
    }
  });
  it('keeps the first-loss clock across failure/restart and stops after seven days', () => {
    expect(evaluateAccountRecoveryDemand(recovery)).toEqual({ state: 'eligible', purpose: 'automatic-recovery' });
    const restarted = JSON.parse(JSON.stringify({ ...recovery, databaseNow: 605_800_000, lastRecoveryAdmittedAt: 602_200_000 }));
    expect(evaluateAccountRecoveryDemand(restarted)).toEqual({ state: 'paused' });
  });
  it.each([3_599_999, 3_600_000, 3_600_001])('admits automatic recovery at most hourly %i', elapsed => {
    expect(evaluateAccountRecoveryDemand({ ...recovery, databaseNow: 1_000_000 + elapsed, lastRecoveryAdmittedAt: 1_000_000 }).state)
      .toBe(elapsed < 3_600_000 ? 'deferred' : 'eligible');
  });
  it.each([604_799_999, 604_800_000, 604_800_001])('enforces the seven-day boundary %i', elapsed => {
    expect(evaluateAccountRecoveryDemand({ ...recovery, databaseNow: 1_000_000 + elapsed }).state)
      .toBe(elapsed < 604_800_000 ? 'eligible' : 'paused');
  });
  it('allows a new authenticated recovery after automatic recovery pauses, without ordinary demand', () => {
    expect(evaluateAccountRecoveryDemand({ ...recovery, databaseNow: 605_800_000, explicitRecoveryCommand: true }))
      .toEqual({ state: 'eligible', purpose: 'explicit-recovery' });
    expect(evaluateRoutineAccountDemand({ ...routine, databaseNow: 605_800_000, zeroDemandSince: 1_000_000 }).state).toBe('stopped');
  });
  it.each(['actorActive', 'associationActive', 'acquisitionAuthorized'] as const)('cannot recover without %s', field => {
    expect(evaluateAccountRecoveryDemand({ ...recovery, [field]: false, explicitRecoveryCommand: true }).state).toBe('denied');
  });
  it('does not infer recovery from unfollow or fabricated loss clock', () => {
    expect(evaluateAccountRecoveryDemand({ ...recovery, explicitFollowIntent: false }).state).toBe('paused');
    expect(evaluateAccountRecoveryDemand({ ...recovery, firstLossAt: null }).state).toBe('indeterminate');
    expect(evaluateAccountRecoveryDemand({ ...recovery, firstLossAt: 1_000_001 }).state).toBe('indeterminate');
  });
  it('suspends retained follow intent through loss/disconnect and resumes only current intent', () => {
    expect(effectiveAccountFollow(true, false, true, true)).toBe(false);
    expect(effectiveAccountFollow(true, true, true, false)).toBe(false);
    expect(effectiveAccountFollow(true, true, true, true)).toBe(true);
    expect(effectiveAccountFollow(false, true, true, true)).toBe(false);
  });
});
