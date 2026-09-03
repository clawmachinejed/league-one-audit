import 'server-only';

import type { ProjectionStore } from './contracts';
import type { ProjectionRepositoryPort } from '../../ports/projection-repository';

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
