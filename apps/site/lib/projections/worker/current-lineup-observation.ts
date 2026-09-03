import type { LineupWatchState } from '../ports/lineup-watch-repository';
import { emptyLineupObservationCounts } from './lineup-contracts';
import { LINEUP_OBSERVATION_CONCURRENCY, observeLineupClaims, type ObserveLineupDependencies } from './lineup-observation-stage';
import { LINEUP_MATCHUP_REQUEST_LIMIT } from './lineup-watch-policy';

/** Full loads reserve their calls first; thin current work consumes the remaining bounded batches. */
export async function observeCurrentLineups(
  dependencies: ObserveLineupDependencies,
  states: readonly LineupWatchState[],
  runId: string,
  fullRequestsReserved: number,
) {
  if (!Number.isInteger(fullRequestsReserved) || fullRequestsReserved < 0
    || fullRequestsReserved > LINEUP_MATCHUP_REQUEST_LIMIT) throw new Error('Invalid current request reservation.');
  const remainingKeys = new Set(states.map((state) => state.configuration.key));
  if (remainingKeys.size !== states.length || states.some((state) => state.watchClass !== 'current'
    || state.materializationLane !== 'current' || state.retiredAt !== null)) throw new Error('Invalid current observation targets.');
  let remainingRequests = LINEUP_MATCHUP_REQUEST_LIMIT - fullRequestsReserved;
  const counts = emptyLineupObservationCounts();
  while (remainingKeys.size > 0 && remainingRequests > 0) {
    const limit = Math.min(LINEUP_OBSERVATION_CONCURRENCY, remainingKeys.size, remainingRequests);
    const claims = await dependencies.lineupRepository.claimDueLineupObservations({
      leagueKeys: [...remainingKeys], materializationLane: 'current', workerId: runId,
      leaseSeconds: 120, limit, futureLimit: 0, catchUp: true,
    });
    if (claims.length === 0) break;
    if (claims.length > limit || new Set(claims.map((claim) => claim.configuration.key)).size !== claims.length
      || claims.some((claim) => !remainingKeys.has(claim.configuration.key))) throw new Error('Current observation claim exceeded its targets.');
    // Never observe a league twice if processing crosses a minute boundary.
    for (const claim of claims) remainingKeys.delete(claim.configuration.key);
    remainingRequests -= claims.length;
    const batch = await observeLineupClaims(dependencies, claims, runId, { periodAnchorWeeks: new Map() });
    for (const key of ['checked', 'changed', 'unchanged', 'notReady', 'skipped', 'failed', 'pending'] as const) counts[key] += batch[key];
  }
  counts.skipped += remainingKeys.size;
  return counts;
}
