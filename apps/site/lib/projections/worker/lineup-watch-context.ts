import type { LeagueConfiguration } from '../domain/contracts';
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
import {
  allocateLineupWatchPhases, assessLineupWatchCapacity, initialLineupCheckAt,
  LINEUP_CADENCE_POLICY_VERSION, type LineupWatchCapacity,
} from './lineup-watch-policy';

export type LineupWatchContext = Readonly<{
  kind: 'stored';
  states: readonly LineupWatchState[];
  authorities: readonly LineupPeriodAuthority[];
  skippedLeagueKeys: readonly string[];
  capacity: LineupWatchCapacity;
}> | Readonly<{ kind: 'disabled' }> | Readonly<{ kind: 'capacity-exceeded'; capacity: LineupWatchCapacity }>;

/** Both lanes synchronize the same full horizon; missing authority never means registry removal. */
export async function synchronizeLineupWatches(
  repository: Pick<LineupWatchRepositoryPort, 'synchronizeLineupWatchStates' | 'readLineupWatchSchedule'>,
  configurations: readonly LeagueConfiguration[],
  results: readonly PeriodAuthorityReadResult[],
  now: Date,
): Promise<LineupWatchContext> {
  const byKey = new Map(results.map((result) => [result.leagueKey, result]));
  const registeredKeys = configurations.map((configuration) => configuration.key);
  if (!Number.isFinite(now.getTime()) || new Set(registeredKeys).size !== registeredKeys.length
    || byKey.size !== results.length || results.some((result) => !registeredKeys.includes(result.leagueKey))) {
    throw new Error('Invalid lineup authority synchronization input.');
  }
  const targets: LineupWatchTarget[] = [];
  const authorities: LineupPeriodAuthority[] = [];
  const skippedLeagueKeys: string[] = [];
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
      planned.push({ configuration, period, shape: authority.shape, authorityGeneration: authority.authorityGeneration,
        lineupRevisionVersion: LINEUP_REVISION_VERSION, cadencePolicyVersion: LINEUP_CADENCE_POLICY_VERSION,
        watchClass: classification.watchClass, materializationLane: classification.materializationLane,
        phase: 0, initialNextCheckAt: initialLineupCheckAt(classification.watchClass, 0, now) });
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
  );
  if (capacity.status === 'capacity-exceeded') return { kind: 'capacity-exceeded', capacity };
  const futureTargets = targets.filter((target) => target.watchClass === 'future');
  const phaseInputs: { targetKey: string; stableHash: string }[] = [];
  const key = (target: LineupWatchTarget) => stableJson({ leagueKey: target.configuration.key,
    leagueRef: externalReferenceKey(target.configuration.leagueRef), period: target.period });
  // Hash bounded targets sequentially; never create one outstanding promise per configured period.
  for (const target of futureTargets) {
    const targetKey = key(target);
    phaseInputs.push({ targetKey, stableHash: await sha256(targetKey) });
  }
  for (const row of retained.filter((value) => value.watchClass === 'future')) {
    const targetKey = stableJson({ leagueKey: row.leagueKey, leagueRef: externalReferenceKey(row.leagueRef), period: row.period });
    phaseInputs.push({ targetKey, stableHash: await sha256(targetKey) });
  }
  const phases = new Map(allocateLineupWatchPhases(phaseInputs).map((value) => [value.targetKey, value.phase]));
  const balanced = targets.map((target) => {
    const phase = phases.get(key(target)) ?? 0;
    return { ...target, phase, initialNextCheckAt: initialLineupCheckAt(target.watchClass, phase, now) };
  });
  const synchronized = await repository.synchronizeLineupWatchStates({ registeredLeagueKeys: registeredKeys, targets: balanced });
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
