import 'server-only';

import type { DatabaseClient } from '../../../database';
import type { ProjectionStore } from './contracts';
import { createMaterializationFutureRefreshMethods } from './future-refresh-materialization';
import { createFutureRefreshPlanMethods } from './future-refresh-plan';
import { createProjectionFutureRefreshMethods } from './future-refresh-projection';

export type FutureRefreshMethods = Pick<
  ProjectionStore,
  | 'ensureFutureRefreshStates'
  | 'readFutureRefreshPlan'
  | 'beginFutureProjectionRefresh'
  | 'completeFutureProjectionRefresh'
  | 'failFutureProjectionRefresh'
  | 'beginFutureMaterializationRefresh'
  | 'completeFutureMaterializationRefresh'
  | 'failFutureMaterializationRefresh'
>;

export function createFutureRefreshMethods(client: DatabaseClient): FutureRefreshMethods {
  const plan = createFutureRefreshPlanMethods(client);
  const projection = createProjectionFutureRefreshMethods(client);
  const materialization = createMaterializationFutureRefreshMethods(client);
  return {
    ensureFutureRefreshStates: plan.ensureFutureRefreshStates,
    readFutureRefreshPlan: plan.readFutureRefreshPlan,
    beginFutureProjectionRefresh: projection.beginFutureProjectionRefresh,
    completeFutureProjectionRefresh: projection.completeFutureProjectionRefresh,
    failFutureProjectionRefresh: projection.failFutureProjectionRefresh,
    beginFutureMaterializationRefresh: materialization.beginFutureMaterializationRefresh,
    completeFutureMaterializationRefresh: materialization.completeFutureMaterializationRefresh,
    failFutureMaterializationRefresh: materialization.failFutureMaterializationRefresh,
  } satisfies FutureRefreshMethods;
}
