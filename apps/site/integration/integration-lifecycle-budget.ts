/** One monotonic local budget. Cloud deletion and billing are not clock guarantees. */
export const INTEGRATION_LIFECYCLE_MS = 40 * 60_000;
export const INTEGRATION_TEARDOWN_RESERVE_MS = 10 * 60_000;
export const INTEGRATION_FINALIZATION_RESERVE_MS = 10_000;

export class IntegrationDeadlineError extends Error {
  readonly code = 'INTEGRATION_DEADLINE';
  constructor() { super('The disposable integration phase exceeded its remaining local budget.'); }
}

export class IntegrationLifecycleBudget {
  readonly started = performance.now();
  readonly deadline = this.started + INTEGRATION_LIFECYCLE_MS;
  readonly workDeadline = this.deadline - INTEGRATION_TEARDOWN_RESERVE_MS;

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
