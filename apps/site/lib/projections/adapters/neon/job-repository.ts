import 'server-only';

import type { ProjectionStore } from './contracts';
import type { ProjectionRepositoryPort } from '../../ports/projection-repository';
import type { createAcquisitionJobMethods } from './jobs';

/** Target discovery delegates to the same persisted job owner. It deliberately
 * has no generic completion API: capture and checkpoint close/requeue its job
 * in the same guarded transaction. */
export function createNeonAcquisitionJobRepository(store: ReturnType<typeof createAcquisitionJobMethods>) {
  return { claimAccountAcquisition: (workerId: string) => store.claimAccountAcquisition(workerId) };
}

/** Shared job delegation without importing projection, scoring or identity capabilities. */
export function createNeonJobRepository(
  store: Pick<ProjectionStore, 'acquireJob' | 'completeJob' | 'failJob'>,
): Pick<ProjectionRepositoryPort, 'acquireJob' | 'completeJob' | 'failJob'> {
  return {
    acquireJob: (input) => store.acquireJob(input),
    completeJob: (jobKey, workerId) => store.completeJob(jobKey, workerId),
    failJob: (jobKey, workerId, message) => store.failJob(jobKey, workerId, message),
  };
}
