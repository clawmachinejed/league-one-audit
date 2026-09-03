import { vi } from 'vitest';
import type { LeagueConfiguration, LeaguePeriodAuthority } from '../domain/contracts';
import type { LineupWatchState, LineupWatchTarget } from '../ports/lineup-watch-repository';
import type { LineupPeriodAuthority, PeriodAuthorityReadResult } from '../ports/period-authority-reader';
import { externalLeagueRef, externalLineupEntryRef, externalMatchupRef, externalRosterRef } from '../shared/provider-identity';
import type { LineupObservationWorkerDependencies } from './lineup-contracts';

export const lineupNow = new Date('2026-09-03T12:00:00.000Z');
export function lineupConfiguration(key = 'example'): LeagueConfiguration {
  return { key, displayName: key, leagueRef: externalLeagueRef('official-source', `league-${key}`),
    matchupWeekRange: { firstWeek: 1, lastWeek: 18 } };
}
export function lineupAuthority(configuration = lineupConfiguration(), lifecycle: LeaguePeriodAuthority['lifecycle'] = 'active'): LineupPeriodAuthority {
  const period = { season: 2026, seasonType: 'regular' as const, week: 1 };
  return { configuration, authorityGeneration: 1,
    shape: { expectedRosterCount: 2, expectedStarterSlotCount: 1,
      expectedRosterRefs: ['1', '2'].map((id) => externalRosterRef(configuration.leagueRef, id)) },
    defaultPeriodCadence: { games: [], isCurrentRegularPeriod: true },
    authority: { configuration, defaultDisplayPeriod: period, activeScoringPeriod: lifecycle === 'active' ? period : null,
      lifecycle, nflPhase: lifecycle === 'preseason' ? 'preseason' : 'regular', source: configuration.leagueRef.provider,
      sourceRevision: 'authority-revision', observedAt: lineupNow.toISOString(), verifiedAt: lineupNow.toISOString() } };
}
export function lineupAuthorityResult(value = lineupAuthority()): PeriodAuthorityReadResult {
  return { kind: 'present', leagueKey: value.configuration.key, value };
}
export function lineupState(target: LineupWatchTarget, overrides: Partial<LineupWatchState> = {}): LineupWatchState {
  const { initialNextCheckAt, ...base } = target;
  return { ...base, watchId: `${target.configuration.key}-${target.period.week}`, watchGeneration: 1,
    nextCheckAt: initialNextCheckAt, observedVersion: 0, latestLineupRevision: null,
    acceptedRequestStartedAt: null, acceptedRequestCompletedAt: null, lastCheckedAt: null, lastCompleteObservationAt: null,
    lastMaterializedLineupRevision: null, lastMaterializedSnapshotRevision: null, lastMaterializedVerifiedAt: null,
    pendingSince: null, activeAttemptId: null, claimGeneration: 0, leaseOwner: null, attemptStartedAt: null,
    leaseExpiresAt: null, attemptCount: 0, consecutiveFailures: 0, lastFailureCode: null, retiredAt: null, retirementReason: null,
    ...overrides };
}
export function lineupHarness(configurations = [lineupConfiguration('one'), lineupConfiguration('two')]) {
  let watches: LineupWatchState[] = [];
  let monotonic = 0;
  const repository = {
    acquireJob: vi.fn(async () => ({ kind: 'acquired' as const, attempt: 1, leaseUntil: '2026-09-03T12:02:00.000Z' })),
    completeJob: vi.fn(async () => true), failJob: vi.fn(async () => true),
  };
  const lineupRepository = {
    enabled: true,
    readLineupWatchSchedule: vi.fn(async () => watches.filter((row) => row.watchClass !== 'completed').map((row) => ({
      leagueKey: row.configuration.key, leagueRef: row.configuration.leagueRef, period: row.period,
      watchClass: row.watchClass as 'current' | 'future', phase: row.phase,
    }))),
    synchronizeLineupWatchStates: vi.fn(async ({ targets }: { targets: readonly LineupWatchTarget[] }) => {
      watches = targets.map((target) => lineupState(target));
      return { kind: 'stored' as const, states: watches };
    }),
    claimDueLineupObservations: vi.fn(async (input: { limit: number; futureLimit: number; materializationLane: string }) => {
      let future = 0;
      const selected = watches.filter((state) => state.materializationLane === input.materializationLane
        && state.activeAttemptId === null && state.lastCheckedAt === null)
        .filter((state) => state.watchClass !== 'future' || future++ < input.futureLimit).slice(0, input.limit);
      return selected.map((state) => {
        const claim = { ...state, activeAttemptId: `attempt-${state.watchId}`, claimGeneration: state.claimGeneration + 1, leaseOwner: 'run-1' };
        watches[watches.findIndex((row) => row.watchId === state.watchId)] = claim;
        return claim;
      });
    }),
    completeLineupObservation: vi.fn(async (input: { claim: { watchId: string }; actualLineup: { lineupRevision: string } }) => {
      const index = watches.findIndex((row) => row.watchId === input.claim.watchId);
      const state = { ...watches[index], latestLineupRevision: input.actualLineup.lineupRevision,
        observedVersion: 1, lastCheckedAt: lineupNow.toISOString(), pendingSince: lineupNow.toISOString(), activeAttemptId: null };
      watches[index] = state;
      return { kind: 'stored' as const, state };
    }),
    recordLineupObservationNotReady: vi.fn(async () => ({ kind: 'stored' as const })),
    failLineupObservation: vi.fn(async () => ({ kind: 'stored' as const })),
    wakeFutureProjectionAndMaterialization: vi.fn(async (input: Parameters<LineupObservationWorkerDependencies['lineupRepository']['wakeFutureProjectionAndMaterialization']>[0]) => {
      if (input.weekDistance < 1) throw new Error('Invalid stored distance.');
      return { kind: 'stored' as const };
    }),
    readPendingFutureLineups: vi.fn(async () => watches.filter((state) => state.pendingSince !== null)),
  };
  const periodAuthorityReader = { readAuthorities: vi.fn(async () => configurations.map((configuration) => lineupAuthorityResult(lineupAuthority(configuration)))) };
  const lineupSource = { getLineup: vi.fn(async ({ configuration, period, shape }: Parameters<LineupObservationWorkerDependencies['lineupSource']['getLineup']>[0]) => ({ status: 'complete' as const,
    observation: { leagueRef: configuration.leagueRef, period, shape,
      rows: shape.expectedRosterRefs.map((rosterRef, index) => ({ rosterRef,
        matchupRef: externalMatchupRef(configuration.leagueRef, period, '1'),
        starters: [externalLineupEntryRef(configuration.leagueRef, `player-${index}`)] })) },
    requestStartedAt: lineupNow.toISOString(), requestCompletedAt: lineupNow.toISOString() })) } satisfies LineupObservationWorkerDependencies['lineupSource'];
  const dependencies: LineupObservationWorkerDependencies = { repository, lineupRepository, periodAuthorityReader, lineupSource,
    leagueRegistry: { listActiveLeagues: vi.fn(() => configurations) }, clock: { now: () => lineupNow, monotonicNow: () => monotonic },
    idGenerator: { generate: () => 'run-1' }, logger: { write: vi.fn() },
    persistence: { scope: () => ({ repository, lineupRepository, periodAuthorityReader }) } };
  return { dependencies, repository, lineupRepository, periodAuthorityReader, lineupSource, configurations,
    setElapsed: (ms: number) => { monotonic = ms; }, states: () => watches };
}
