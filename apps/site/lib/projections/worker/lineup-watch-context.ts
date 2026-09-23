import type { LeagueConfiguration } from '../domain/contracts';
import type { LeagueRegistryPort } from '../ports/league-registry';
import { validLineupShape } from '../domain/lineup-observation';
import { LINEUP_REVISION_VERSION } from '../domain/lineup-revision';
import { classifyLineupWatchPeriod } from '../domain/period-classification';
import type {
  LineupObservationClaim, LineupWatchFence, LineupWatchRepositoryPort, LineupWatchState, LineupWatchTarget,
} from '../ports/lineup-watch-repository';
import type { LineupPeriodAuthority, PeriodAuthorityReadResult } from '../ports/period-authority-reader';
import { externalReferenceKey, sameExternalReference } from '../shared/provider-identity';
import { sha256 } from '../shared/sha256';
import { stableJson } from '../shared/stable-json';
import { LEGACY_LINEUP_CADENCE_POLICY_VERSION, lineupCadencePolicy, parseLineupCadencePolicy } from '../shared/lineup-cadence';
import {
  assessLineupWatchCapacity, initialLineupCheckAt, type LineupWatchCapacity, type LineupWatchPhase,
} from './lineup-watch-policy';

export type LineupWatchContext = Readonly<{
  kind: 'stored';
  states: readonly LineupWatchState[];
  authorities: readonly LineupPeriodAuthority[];
  skippedLeagueKeys: readonly string[];
  capacity: LineupWatchCapacity;
}> | Readonly<{ kind: 'disabled' }>;

/** Both lanes synchronize the same full horizon; missing authority never means registry removal. */
export async function synchronizeLineupWatches(
  repository: Pick<LineupWatchRepositoryPort, 'synchronizeLineupWatchStates' | 'readLineupWatchSchedule'>,
  configurations: readonly LeagueConfiguration[],
  results: readonly PeriodAuthorityReadResult[],
  now: Date,
  registration?: LeagueRegistryPort['registration'],
): Promise<LineupWatchContext> {
  const byKey = new Map(results.map((result) => [result.leagueKey, result]));
  const configurationKeys = configurations.map(configuration => configuration.key);
  const registeredKeys = registration?.intendedLeagueKeys ?? configurationKeys;
  const registrationFailures = registration?.failures.map(failure => failure.leagueKey) ?? [];
  if (!Number.isFinite(now.getTime()) || new Set(registeredKeys).size !== registeredKeys.length
    || new Set(configurationKeys).size !== configurationKeys.length
    || new Set(registrationFailures).size !== registrationFailures.length
    || configurationKeys.some(key => !registeredKeys.includes(key) || registrationFailures.includes(key))
    || registrationFailures.some(key => !registeredKeys.includes(key))
    || registeredKeys.some(key => !configurationKeys.includes(key) && !registrationFailures.includes(key))
    || byKey.size !== results.length || results.some((result) => !configurationKeys.includes(result.leagueKey))) {
    throw new Error('Invalid lineup authority synchronization input.');
  }
  const targets: LineupWatchTarget[] = [];
  const authorities: LineupPeriodAuthority[] = [];
  const skippedLeagueKeys: string[] = [...registrationFailures];
  for (const configuration of configurations) {
    const result = byKey.get(configuration.key);
    if (!result || result.kind !== 'present' || result.value.configuration.key !== configuration.key
      || !sameExternalReference(result.value.configuration.leagueRef, configuration.leagueRef)
      || !Number.isSafeInteger(result.value.authorityGeneration) || result.value.authorityGeneration < 1
      || !validLineupShape(result.value.shape)
      || result.value.shape.expectedRosterRefs.some((ref) => ref.provider !== configuration.leagueRef.provider
        || !sameExternalReference(ref.league, configuration.leagueRef))) {
      skippedLeagueKeys.push(configuration.key); continue;
    }
    const authority = result.value;
    const planned: LineupWatchTarget[] = [];
    const range = configuration.matchupWeekRange;
    for (let week = range.firstWeek; week <= range.lastWeek; week += 1) {
      const period = { ...authority.authority.defaultDisplayPeriod, week };
      const classification = classifyLineupWatchPeriod(authority.authority, period, {
        now, range, expectedLeagueRef: configuration.leagueRef,
      });
      if (classification.kind !== 'classified') break;
      const targetKey = stableJson({ leagueKey: configuration.key, leagueRef: externalReferenceKey(configuration.leagueRef), period });
      const anchor = authority.authority.activeScoringPeriod ?? authority.authority.defaultDisplayPeriod;
      const cadencePolicyVersion = lineupCadencePolicy(classification.watchClass, week - anchor.week, await sha256(targetKey));
      const phase = (parseLineupCadencePolicy(cadencePolicyVersion, classification.watchClass, 0).offset % 3) as LineupWatchPhase;
      planned.push({ configuration, period, shape: authority.shape, authorityGeneration: authority.authorityGeneration,
        lineupRevisionVersion: LINEUP_REVISION_VERSION, cadencePolicyVersion,
        watchClass: classification.watchClass, materializationLane: classification.materializationLane,
        phase, initialNextCheckAt: initialLineupCheckAt(classification.watchClass, phase, now, cadencePolicyVersion) });
    }
    if (planned.length !== range.lastWeek - range.firstWeek + 1) {
      skippedLeagueKeys.push(configuration.key); continue;
    }
    authorities.push(authority); targets.push(...planned);
  }
  const retained = (await repository.readLineupWatchSchedule(registeredKeys))
    .filter((row) => skippedLeagueKeys.includes(row.leagueKey));
  const capacity = assessLineupWatchCapacity(
    targets.filter((target) => target.watchClass === 'current').length + retained.filter((row) => row.watchClass === 'current').length,
    targets.filter((target) => target.watchClass === 'future').length + retained.filter((row) => row.watchClass === 'future').length,
    [...targets.filter((target) => target.watchClass === 'future'),
      ...retained.filter((row) => row.watchClass === 'future').map((row) => ({ ...row,
        cadencePolicyVersion: 'cadencePolicyVersion' in row && typeof row.cadencePolicyVersion === 'string'
          ? row.cadencePolicyVersion : LEGACY_LINEUP_CADENCE_POLICY_VERSION }))],
    targets.filter((target) => target.watchClass === 'current' && target.materializationLane === 'future').length,
  );
  const synchronized = await repository.synchronizeLineupWatchStates({ registeredLeagueKeys: registeredKeys, targets });
  if (synchronized.kind === 'disabled') return synchronized;
  return { kind: 'stored', states: synchronized.states, authorities, skippedLeagueKeys, capacity };
}

export function lineupWatchFence(state: LineupWatchState): LineupWatchFence {
  if (state.retiredAt !== null || state.watchClass === 'completed' || state.materializationLane === null) {
    throw new Error('A retired lineup watch cannot own work.');
  }
  return { watchId: state.watchId, watchGeneration: state.watchGeneration, authorityGeneration: state.authorityGeneration,
    watchClass: state.watchClass, materializationLane: state.materializationLane };
}

export function lineupObservationClaim(state: LineupWatchState, expectedWorkerId?: string): LineupObservationClaim {
  if (!state.activeAttemptId || !state.leaseOwner || (expectedWorkerId !== undefined && state.leaseOwner !== expectedWorkerId)) {
    throw new Error('Lineup observation is not owned by this worker.');
  }
  return { ...lineupWatchFence(state), attemptId: state.activeAttemptId, claimGeneration: state.claimGeneration,
    workerId: state.leaseOwner, targetObservedVersion: state.observedVersion };
}
