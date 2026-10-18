import assert from 'node:assert/strict';
/** One monotonic local budget. Cloud deletion and billing are not clock guarantees. */
export const INTEGRATION_LIFECYCLE_MS = 40 * 60_000;
export const INTEGRATION_TEARDOWN_RESERVE_MS = 10 * 60_000;
export const INTEGRATION_FINALIZATION_RESERVE_MS = 10_000;

export const INTEGRATION_WORK_DEADLINE_ENV = 'INTEGRATION_SUPERVISED_WORK_DEADLINE_AT';
export const HEALTHY_FLEET_LIFECYCLE_PROFILE = 'data-freshness-capacity-healthy-v1';
export const RECOVERY_FLEET_LIFECYCLE_PROFILE = 'data-freshness-capacity-recovery-v1';
export const DAILY_FLEET_LIFECYCLE_PROFILE = 'data-freshness-capacity-daily-v1';
export type IntegrationLifecycleProfile = 'default' | typeof HEALTHY_FLEET_LIFECYCLE_PROFILE | typeof RECOVERY_FLEET_LIFECYCLE_PROFILE | typeof DAILY_FLEET_LIFECYCLE_PROFILE;
export function integrationLifecycleForQualification(profile:unknown):IntegrationLifecycleProfile {
  return profile===HEALTHY_FLEET_LIFECYCLE_PROFILE||profile===RECOVERY_FLEET_LIFECYCLE_PROFILE||profile===DAILY_FLEET_LIFECYCLE_PROFILE?profile:'default';
}
export function integrationLifecycleEnvelope(profile: IntegrationLifecycleProfile = 'default') {
  assert(profile === 'default' || profile === HEALTHY_FLEET_LIFECYCLE_PROFILE || profile === RECOVERY_FLEET_LIFECYCLE_PROFILE || profile === DAILY_FLEET_LIFECYCLE_PROFILE, 'Unknown integration lifecycle profile');
  return Object.freeze(profile === DAILY_FLEET_LIFECYCLE_PROFILE
    ? { profile, workMs:26*60*60_000,lifecycleMs:(26*60+10)*60_000,branchExpiryMs:27*60*60_000,ciMinutes:null }
    : profile === RECOVERY_FLEET_LIFECYCLE_PROFILE
    ? { profile, workMs:340*60_000,lifecycleMs:350*60_000,branchExpiryMs:360*60_000,ciMinutes:360 }
    : profile === HEALTHY_FLEET_LIFECYCLE_PROFILE
    ? { profile, workMs: 240 * 60_000, lifecycleMs: 250 * 60_000, branchExpiryMs: 270 * 60_000, ciMinutes: 270 }
    : { profile, workMs: 30 * 60_000, lifecycleMs: INTEGRATION_LIFECYCLE_MS, branchExpiryMs: 60 * 60_000, ciMinutes: 50 });
}
export class IntegrationDeadlineError extends Error {
  readonly code = 'INTEGRATION_DEADLINE';
  constructor() { super('The disposable integration phase exceeded its remaining local budget.'); }
}

export class IntegrationLifecycleBudget {
  readonly started = performance.now();
  readonly envelope: ReturnType<typeof integrationLifecycleEnvelope>;
  readonly deadline: number;
  readonly workDeadline: number;
  constructor(profile: IntegrationLifecycleProfile = 'default') {
    this.envelope = integrationLifecycleEnvelope(profile);
    this.deadline = this.started + this.envelope.lifecycleMs;
    this.workDeadline = this.started + this.envelope.workMs;
  }

  remaining(finalization = false): number {
    return Math.max(0, (finalization ? this.deadline : this.deadline - INTEGRATION_FINALIZATION_RESERVE_MS) - performance.now());
  }

  elapsed(): number { return Math.max(0, performance.now() - this.started); }

  /** An abandoned promise cannot extend the local wait. Every operation also
   * receives a signal and must fence subsequent side effects after each await.
   * Timeout means unknown completion, never proof of remote cancellation. */
  async run<T>(action: (signal: AbortSignal) => Promise<T>, options: {
    work?: boolean; signal?: AbortSignal; capMs?: number; finalization?: boolean;
  } = {}): Promise<T> {
    const deadline = Math.min(options.work ? this.workDeadline : Infinity,
      this.deadline - (options.finalization ? 0 : INTEGRATION_FINALIZATION_RESERVE_MS),
      performance.now() + (options.capMs ?? Infinity));
    if (performance.now() >= deadline) throw new IntegrationDeadlineError();
    options.signal?.throwIfAborted();
    const controller = new AbortController();
    let rejectWait!: (reason: unknown) => void;
    const cancelled = new Promise<never>((_, reject) => { rejectWait = reject; });
    const abort = (reason: unknown) => { controller.abort(reason); rejectWait(reason); };
    const onAbort = () => abort(options.signal?.reason);
    const timer = setTimeout(() => abort(new IntegrationDeadlineError()), Math.max(1, deadline - performance.now()));
    options.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const result = await Promise.race([cancelled, action(controller.signal)]);
      controller.signal.throwIfAborted();
      if (performance.now() >= deadline) throw new IntegrationDeadlineError();
      return result;
    } finally {
      clearTimeout(timer); options.signal?.removeEventListener('abort', onAbort);
    }
  }
}
