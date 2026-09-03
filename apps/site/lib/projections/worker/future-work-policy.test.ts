import { describe, expect, it } from 'vitest';
import type { FutureRefreshPlanPeriod } from '../ports/future-refresh-repository';
import type { LineupWatchState } from '../ports/lineup-watch-repository';
import { externalLeagueRef, externalRosterRef } from '../shared/provider-identity';
import { futureRefreshIntervalMs, futureRetryDelayMs, futureWorkMayStart,
  selectFutureWork, type FutureRefreshPlan } from './future-work-policy';
import { nextFutureRefreshAt } from './future-work-runtime';
import { periodTimingCadence } from './cadence';

const NOW = new Date('2026-09-03T12:03:00.000Z');
const HOUR = 3_600_000;
function plan(week = 2, options: {dirty?: boolean; slate?: boolean; projectionDue?: boolean; materializationDue?: boolean;
  canary?: boolean; defaultPeriod?: boolean; projectionLease?: boolean; materializationLease?: boolean} = {}): FutureRefreshPlan {
  const configuration = { key: 'league-a', displayName: 'A', leagueRef: externalLeagueRef('sleeper', 'fixture-a'),
    matchupWeekRange: {firstWeek: 1, lastWeek: 18} };
  const period = { season: 2026, seasonType: 'regular' as const, week };
  const lineage = { observationId: 'obs', contentId: 'content' } as NonNullable<FutureRefreshPlanPeriod['projection']['currentSlate']>;
  const at = NOW.toISOString();
  const watch: LineupWatchState = {
    configuration, period, shape: { expectedRosterCount: 2, expectedStarterSlotCount: 1,
      expectedRosterRefs: ['1','2'].map((id) => externalRosterRef(configuration.leagueRef, id)) },
    authorityGeneration: 1, lineupRevisionVersion: 'lineup-v1', cadencePolicyVersion: 'lineup-cadence-v1',
    watchClass: options.defaultPeriod ? 'current' : 'future', materializationLane: 'future', phase: 0,
    watchId: 'watch', watchGeneration: 1, nextCheckAt: at, observedVersion: 1,
    latestLineupRevision: 'B', lastMaterializedLineupRevision: options.dirty ? 'A' : 'B',
    acceptedRequestStartedAt: at, acceptedRequestCompletedAt: at, lastCheckedAt: at, lastCompleteObservationAt: at,
    lastMaterializedSnapshotRevision: 'snapshot', lastMaterializedVerifiedAt: at, pendingSince: options.dirty ? at : null,
    activeAttemptId: null, claimGeneration: 0, leaseOwner: null, attemptStartedAt: null, leaseExpiresAt: null,
    attemptCount: 0, consecutiveFailures: 0, lastFailureCode: null, retiredAt: null, retirementReason: null,
  };
  return {
    state: { period, weekDistance: Math.max(1, week - 1), expectedMaterializations: 1, successfulMaterializations: 1,
      projection: { nextRefreshAt: at, lastAttemptedAt: at, lastSucceededAt: at, consecutiveFailures: 0,
        lastFailureCode: null, activeAttemptExpiresAt: options.projectionLease ? '2026-09-03T13:00:00Z' : null,
        lastSlate: lineage, currentSlate: options.slate === false ? null : lineage, due: options.projectionDue ?? true },
      materializations: [{ leagueKey: configuration.key, nextRefreshAt: at, lastAttemptedAt: null,
        lastSucceededAt: at, lastSourceRevision: 'source', lastSlate: lineage, lastSnapshotRevision: 'snapshot',
        consecutiveFailures: 0, lastFailureCode: null, activeAttemptExpiresAt: options.materializationLease ? '2026-09-03T13:00:00Z' : null,
        due: options.materializationDue ?? true }],
    },
    leagues: [{ watch, weekDistance: Math.max(1, week - 1), canaryComplete: options.canary ?? true,
      defaultPeriodCadence: options.defaultPeriod ? { isCurrentRegularPeriod: true, games: [] } : null }],
  };
}

describe('independent future action policy', () => {
  it('shares the closest projection tier without changing each league materialization interval', () => {
    const far = plan(6, { dirty: true });
    const near = { ...far.leagues[0], weekDistance: 1,
      watch: { ...far.leagues[0].watch, configuration: { ...far.leagues[0].watch.configuration, key: 'near-league' } } };
    const state = { ...far.state, weekDistance: 1, materializations: [...far.state.materializations,
      { ...far.state.materializations[0], leagueKey: 'near-league' }] };
    const selection = selectFutureWork([{ state, leagues: [...far.leagues, near] }], NOW)!;
    expect(selection.weekDistance).toBe(1);
    expect(selection.leagueRefresh.map((value) => [value.leagueKey,
      nextFutureRefreshAt(NOW.toISOString(), 'materialization', value.weekDistance, value)]))
      .toEqual([['league-a', '2026-09-10T12:03:00.000Z'], ['near-league', '2026-09-03T13:03:00.000Z']]);
    expect(nextFutureRefreshAt(NOW.toISOString(), 'projection', selection.weekDistance, selection))
      .toBe('2026-09-03T18:03:00.000Z');
  });
  it('materializes dirty lineups from an eligible stored slate even when routine ingestion is due', () => {
    expect(selectFutureWork([plan(5, { dirty: true, canary: false })], NOW)).toMatchObject({kind:'materialize',period:{week:5},dirty:true});
  });
  it('ingests the prerequisite when a dirty period has no eligible slate', () => {
    expect(selectFutureWork([plan(5, {dirty:true,slate:false,canary:false})],NOW)?.kind).toBe('projection-ingest');
  });
  it('does not re-use a slate rejected after its last successful ingestion', () => {
    const value = plan(5, {dirty:true});
    const state = {...value.state, materializations:value.state.materializations.map((entry) => ({...entry,
      lastFailureCode:'projection-slate-incomplete' as const,lastAttemptedAt:NOW.toISOString()}))};
    expect(selectFutureWork([{...value,state}], NOW)?.kind).toBe('projection-ingest');
  });
  it('does not erase provider backoff when a prerequisite is missing', () => {
    expect(selectFutureWork([plan(5,{dirty:true,slate:false,projectionDue:false,canary:false})],NOW)).toBeNull();
  });
  it('skips leased or backed-off dirty materializations without blocking later dirty weeks', () => {
    expect(selectFutureWork([plan(2,{dirty:true,projectionDue:false,materializationLease:true}),
      plan(5,{dirty:true,canary:false})],NOW)?.period.week).toBe(5);
    expect(selectFutureWork([plan(2,{dirty:true,projectionDue:false,materializationDue:false}),
      plan(6,{dirty:true,canary:false})],NOW)?.period.week).toBe(6);
  });
  it('does not claim active projection work twice', () => {
    expect(selectFutureWork([plan(5,{dirty:true,slate:false,projectionLease:true,canary:false})],NOW)).toBeNull();
  });
  it('honors source-observation retry backoff before dirty or routine full materialization', () => {
    for(const dirty of [true,false]){
      const value=plan(2,{dirty,projectionDue:false});
      const backedOff={...value,leagues:value.leagues.map((league)=>({...league,watch:{...league.watch,
        consecutiveFailures:1,nextCheckAt:'2026-09-03T12:05:00Z'}}))};
      expect(selectFutureWork([backedOff],NOW)).toBeNull();
    }
  });
  it('preserves routine projection-first ordering and canary gating', () => {
    expect(selectFutureWork([plan(2)],NOW)?.kind).toBe('projection-ingest');
    expect(selectFutureWork([plan(5,{canary:false})],NOW)).toBeNull();
    expect(selectFutureWork([plan(5,{projectionDue:false,canary:true})],NOW)?.kind).toBe('materialize');
  });
  it('prioritizes dirty changes globally over nearer routine provider work', () => {
    expect(selectFutureWork([plan(2),plan(8,{dirty:true,canary:false})],NOW)?.period.week).toBe(8);
    expect(selectFutureWork([plan(2,{dirty:true,slate:false}),plan(8,{dirty:true,canary:false})],NOW))
      .toMatchObject({kind:'materialize',period:{week:8}});
  });
  it('orders eligible dirty work by oldest pending change, then canonical period, not nearest week', () => {
    const older=plan(7,{dirty:true,canary:false});
    const far={...older,leagues:older.leagues.map((league)=>({...league,watch:{...league.watch,pendingSince:'2026-09-03T11:00:00Z'}}))};
    expect(selectFutureWork([plan(2,{dirty:true}),far],NOW)?.period.week).toBe(7);
    const busy={...far,state:{...far.state,materializations:far.state.materializations.map((state)=>({...state,due:false}))}};
    expect(selectFutureWork([plan(2,{dirty:true}),busy],NOW)?.period.week).toBe(2);
  });
  it('does not require equal horizon or roster population across leagues', () => {
    const later=plan(5,{dirty:true});
    expect(selectFutureWork([later],NOW)?.leagueKeys).toEqual(['league-a']);
  });
  it('owns preseason default as future materialization while keeping its watch current', () => {
    const value=plan(1,{defaultPeriod:true,projectionDue:false});
    expect(selectFutureWork([value],NOW)).toMatchObject({kind:'materialize',defaultPeriod:true,cadence:'hourly'});
    expect(value.leagues[0].watch.watchClass).toBe('current');
  });
  it('defers routine work crossing the hourly allowance without delaying a pending default lineup', () => {
    const due = plan(1, { defaultPeriod: true });
    const ingested = { ...due, state: { ...due.state, projection: { ...due.state.projection, due: false } } };
    expect(selectFutureWork([due], new Date('2026-09-03T12:04:00Z'))?.kind).toBe('projection-ingest');
    expect(selectFutureWork([ingested], new Date('2026-09-03T12:05:00Z'))).toBeNull();
    expect(selectFutureWork([due], new Date('2026-09-03T13:00:00Z'))?.kind).toBe('projection-ingest');
    expect(selectFutureWork([ingested], new Date('2026-09-03T13:01:00Z'))?.kind).toBe('materialize');
    const changed = { ...ingested, leagues: ingested.leagues.map((league) => ({ ...league,
      watch: { ...league.watch, lastMaterializedLineupRevision: 'previous-lineup', pendingSince: '2026-09-03T12:05:00Z' },
    })) };
    expect(selectFutureWork([changed], new Date('2026-09-03T12:05:00Z')))
      .toMatchObject({ kind: 'materialize', dirty: true, defaultPeriod: true });
  });
  it('retains seven-day preparation and lets dirty default changes bypass routine idle', () => {
    const value=plan(1,{defaultPeriod:true});
    const leagues=value.leagues.map((entry)=>({...entry,defaultPeriodCadence:{isCurrentRegularPeriod:false,games:[]}}));
    expect(selectFutureWork([{...value,leagues}],NOW)).toBeNull();
    expect(selectFutureWork([{...value,leagues:leagues.map((entry)=>({...entry,watch:{...entry.watch,lastMaterializedLineupRevision:'A'}}))}],NOW)?.kind).toBe('materialize');
  });
  it('rejects invalid clocks and retired targets', () => {
    expect(selectFutureWork([plan()],new Date('invalid'))).toBeNull();
    const value=plan(2,{dirty:true});
    expect(selectFutureWork([{...value,leagues:value.leagues.map((entry)=>({...entry,watch:{...entry.watch,retiredAt:NOW.toISOString()}}))}],NOW)).toBeNull();
  });
});

describe('unchanged future cadence and deadlines', () => {
  it('keeps distance-one six-hour ingestion, hourly materialization, daily +2..+4 and weekly later tiers', () => {
    expect(futureRefreshIntervalMs('projection',1)).toBe(6*HOUR);
    expect(futureRefreshIntervalMs('materialization',1)).toBe(HOUR);
    for(const kind of ['projection','materialization'] as const){
      expect(futureRefreshIntervalMs(kind,2)).toBe(24*HOUR);
      expect(futureRefreshIntervalMs(kind,4)).toBe(24*HOUR);
      expect(futureRefreshIntervalMs(kind,5)).toBe(168*HOUR);
    }
  });
  it('uses absolute default-period buckets rather than completion plus interval', () => {
    expect(nextFutureRefreshAt('2026-09-03T12:04:57Z','projection',1,{defaultPeriod:true,cadence:'hourly'})).toBe('2026-09-03T13:00:00.000Z');
    expect(nextFutureRefreshAt('2026-09-03T12:04:57Z','materialization',1,{defaultPeriod:true,cadence:'live-window'})).toBe('2026-09-03T12:05:00.000Z');
  });
  it('preserves live windows, hourly allowance, and unknown kickoff Eastern even-minute fallback', () => {
    const timing={isCurrentRegularPeriod:false,games:[{kickoffAt:'2026-09-06T17:00:00Z',date:'2026-09-06'}]};
    expect(periodTimingCadence(timing,NOW)).toBe('hourly');
    expect(periodTimingCadence(timing,new Date('2026-09-03T12:05:00Z'))).toBe('idle');
    expect(periodTimingCadence(timing,new Date('2026-09-06T15:00:00Z'))).toBe('live-window');
    const unknown={isCurrentRegularPeriod:false,games:[{kickoffAt:null,date:'2026-09-06'}]};
    expect(periodTimingCadence(unknown,new Date('2026-09-06T18:02:00Z'))).toBe('live-window');
    expect(periodTimingCadence(unknown,new Date('2026-09-06T18:03:00Z'))).toBe('idle');
  });
  it('keeps bounded retry delays and exact start deadline', () => {
    expect([1,2,3,4,9].map(futureRetryDelayMs)).toEqual([300_000,900_000,HOUR,6*HOUR,6*HOUR]);
    expect(futureWorkMayStart(0,44_999)).toBe(true);
    expect(futureWorkMayStart(0,45_000)).toBe(false);
    expect(()=>futureRefreshIntervalMs('projection',0)).toThrow();
    expect(()=>futureRetryDelayMs(0)).toThrow();
  });
});
