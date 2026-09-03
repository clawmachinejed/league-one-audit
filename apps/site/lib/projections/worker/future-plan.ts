import type { LeagueConfiguration } from '../domain/contracts';
import { LINEUP_AUTHORITY_MAX_AGE_MS } from '../domain/period-classification';
import type { FutureRefreshPlanPeriod, FutureRefreshTarget } from '../ports/future-refresh-repository';
import type { LineupWatchState } from '../ports/lineup-watch-repository';
import type { LineupPeriodAuthority } from '../ports/period-authority-reader';
import { LIVE_PROJECTION_MODEL_VERSION } from './contracts';
import type { FutureProjectionWorkerDependencies } from './future-contracts';
import { eligibleStoredSlate, hasPendingLineup, type FutureRefreshPlan } from './future-work-policy';
import { futureProviderGroup, sameFuturePeriod } from './future-work-runtime';
import { synchronizeLineupWatches } from './lineup-watch-context';

export type FuturePreparedPlan = Readonly<{
  configurations: readonly LeagueConfiguration[];
  authorities: readonly LineupPeriodAuthority[];
  watches: readonly LineupWatchState[];
  plans: readonly FutureRefreshPlanPeriod[];
  policy: readonly FutureRefreshPlan[];
  unavailableAuthorityCount: number;
}>;

function distance(watch: LineupWatchState, authority: LineupPeriodAuthority): number {
  const anchor = authority.authority.activeScoringPeriod ?? authority.authority.defaultDisplayPeriod;
  return Math.max(1, watch.period.week - anchor.week);
}

/** Identical horizons share a query; heterogeneous leagues never receive each other's periods. */
async function readPlans(
  dependencies: FutureProjectionWorkerDependencies,
  watches: readonly LineupWatchState[],
  authorities: readonly LineupPeriodAuthority[],
  at: string,
  ensure: boolean,
): Promise<FutureRefreshPlanPeriod[]> {
  const authorityByKey = new Map(authorities.map((value) => [value.configuration.key, value]));
  const distanceByPeriod = new Map<string, number>();
  for (const watch of watches) {
    const authority = authorityByKey.get(watch.configuration.key)!;
    const key = futureProviderGroup(watch.period);
    distanceByPeriod.set(key, Math.min(distanceByPeriod.get(key) ?? Infinity, distance(watch, authority)));
  }
  const batches = new Map<string, { leagueKeys: string[]; targets: FutureRefreshTarget[] }>();
  for (const authority of authorities) {
    const targets = watches.filter((watch) => watch.configuration.key === authority.configuration.key)
      .map((watch) => ({ period: watch.period, weekDistance: distance(watch, authority),
        projectionWeekDistance: distanceByPeriod.get(futureProviderGroup(watch.period))! }))
      .sort((left, right) => left.period.week - right.period.week);
    if (targets.length === 0) continue;
    const key = JSON.stringify(targets);
    const batch = batches.get(key) ?? { leagueKeys: [], targets };
    batch.leagueKeys.push(authority.configuration.key);
    batches.set(key, batch);
  }
  const plans = new Map<string, FutureRefreshPlanPeriod>();
  for (const batch of batches.values()) {
    const input = {
      projectionSource: dependencies.projectionStorage.source,
      normalizerVersion: dependencies.projectionStorage.normalizerVersion,
      modelVersion: LIVE_PROJECTION_MODEL_VERSION,
      ...batch,
    };
    if (ensure) await dependencies.repository.ensureFutureRefreshStates({ ...input, seededAt: at });
    for (const plan of await dependencies.repository.readFutureRefreshPlan({ ...input, asOf: at })) {
      const key = futureProviderGroup(plan.period);
      const existing = plans.get(key);
      const allowed = plan.materializations.filter((state) => batch.leagueKeys.includes(state.leagueKey)
        && authorityByKey.has(state.leagueKey));
      const materializations = [...existing?.materializations ?? [], ...allowed];
      plans.set(key, {
        ...plan,
        weekDistance: Math.min(existing?.weekDistance ?? plan.weekDistance, plan.weekDistance),
        materializations,
        expectedMaterializations: materializations.length,
        successfulMaterializations: materializations.filter((state) => state.lastSucceededAt !== null).length,
      });
    }
  }
  return [...plans.values()];
}

export function futurePolicyPlans(
  plans: readonly FutureRefreshPlanPeriod[], watches: readonly LineupWatchState[], authorities: readonly LineupPeriodAuthority[],
): FutureRefreshPlan[] {
  return plans.map((state) => ({
    state,
    leagues: watches.filter((watch) => sameFuturePeriod(watch.period, state.period)).flatMap((watch) => {
      const authority = authorities.find((value) => value.configuration.key === watch.configuration.key);
      if (!authority) return [];
      const anchor = authority.authority.activeScoringPeriod ?? authority.authority.defaultDisplayPeriod;
      const canary = plans.find((plan) => plan.period.season === anchor.season
        && plan.period.seasonType === anchor.seasonType && plan.period.week === anchor.week + 1);
      return [{ watch, weekDistance: distance(watch, authority),
        defaultPeriodCadence: watch.watchClass === 'current' ? authority.defaultPeriodCadence : null,
        canaryComplete: canary?.materializations.some((materialization) => materialization.leagueKey === watch.configuration.key
          && materialization.lastSucceededAt !== null) ?? false,
      }];
    }),
  }));
}

export async function prepareFuturePlan(
  dependencies: FutureProjectionWorkerDependencies, now: Date,
): Promise<FuturePreparedPlan | 'disabled' | 'capacity-exceeded'> {
  const configurations = await dependencies.leagueRegistry.listActiveLeagues();
  const results = await dependencies.periodAuthorityReader.readAuthorities(
    configurations.map((configuration) => configuration.key), now, LINEUP_AUTHORITY_MAX_AGE_MS,
  );
  const context = await synchronizeLineupWatches(dependencies.lineupRepository, configurations, results, dependencies.clock.now());
  if (context.kind !== 'stored') return context.kind;
  const authorities = context.authorities;
  if (configurations.length > 0 && authorities.length === 0) {
    throw new Error('No configured league has usable persisted period authority.');
  }
  const watches = context.states.filter((watch) => watch.retiredAt === null && watch.materializationLane === 'future'
    && authorities.some((authority) => authority.configuration.key === watch.configuration.key
      && authority.authorityGeneration === watch.authorityGeneration));
  let plans = await readPlans(dependencies, watches, authorities, now.toISOString(), true);
  let woken = false;
  for (const watch of watches) {
    if (!hasPendingLineup(watch)) continue;
    const authority = authorities.find((value) => value.configuration.key === watch.configuration.key)!;
    const plan = plans.find((value) => sameFuturePeriod(value.period, watch.period));
    const wake = await dependencies.lineupRepository.wakeFutureProjectionAndMaterialization({
      watchId: watch.watchId, watchGeneration: watch.watchGeneration, authorityGeneration: watch.authorityGeneration,
      weekDistance: distance(watch, authority), wakeProjection: !plan || !eligibleStoredSlate(plan),
    });
    woken ||= wake.kind === 'stored';
  }
  if (woken) plans = await readPlans(dependencies, watches, authorities, now.toISOString(), false);
  return { configurations, authorities, watches, plans, unavailableAuthorityCount: configurations.length - authorities.length, policy: futurePolicyPlans(plans, watches, authorities) };
}

export async function refreshPreparedFuturePlan(
  dependencies: FutureProjectionWorkerDependencies, prepared: FuturePreparedPlan, at: string,
): Promise<FuturePreparedPlan> {
  const plans = await readPlans(dependencies, prepared.watches, prepared.authorities, at, false);
  return { ...prepared, plans, policy: futurePolicyPlans(plans, prepared.watches, prepared.authorities) };
}
