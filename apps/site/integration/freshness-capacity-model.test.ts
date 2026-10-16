import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { CAPACITY_PROOF_CLASS, CURRENT_DATA_CAPACITY, controlledEventCapacity, currentSourceActiveBounds,
  currentSourceCapacity, currentSourceFeasibility, fullFamilyCapacityLeague, requestDemandEstimate,
  type CapacityCycle } from './freshness-capacity-model';

const source = (path: string) => readFile(new URL(path, import.meta.url), 'utf8');
const cycle = (id: string, leagues: number, reports = true, drafts = 1): CapacityCycle => ({ id,
  leagues: Array.from({ length: leagues }, (_, index) => fullFamilyCapacityLeague(`${id}-${index}`, drafts, reports)) });

describe('current source acquisition arithmetic', () => {
  it('retains CP25 selected-scope counts without calling them full coverage', () => {
    const result = currentSourceCapacity([cycle('cp25', 1, false)]);
    expect(result).toMatchObject({ acquisitionAdmissions: 48, getAttempts: 68, postAttempts: 0, httpAttempts: 68, settlementClaims: 1,
      normalSuccessfulClaims: 49, minimumAcquisitionSpacingSeconds: 47 * 60, normalSuccessfulClaimSpacingSeconds: 48 * 60 });
    expect(result.tasks.weeklyReports).toEqual({ acquisitions: 0, gets: 0, posts: 0, httpAttempts: 0 });
    expect(result.tasks.transactions).toEqual({ acquisitions: 19, gets: 19, posts: 0, httpAttempts: 19 });
  });
  it('adds all eighteen independent reports and only one shared player catalog', () => {
    expect(currentSourceCapacity([cycle('full', 1)])).toMatchObject({ acquisitionAdmissions: 66, getAttempts: 68, postAttempts: 18, httpAttempts: 86, normalSuccessfulClaims: 67 });
    const result = currentSourceCapacity([cycle('existing', 8), cycle('fresh-a', 4), cycle('fresh-b', 4)], true);
    expect(result).toMatchObject({ distinctLeagues: 16, leagueAssociations: 16, acquisitionAdmissions: 1_031,
      getAttempts: 1_063, postAttempts: 288, httpAttempts: 1_351, settlementClaims: 3, normalSuccessfulClaims: 1_034 });
    expect(result.tasks.playerDirectory).toEqual({ acquisitions: 1, gets: 1, posts: 0, httpAttempts: 1 });
    expect(result.tasks.weeklyReports).toEqual({ acquisitions: 288, gets: 0, posts: 288, httpAttempts: 288 });
    expect(result.tasks.exactMatchups).toEqual({ acquisitions: 288, gets: 576, posts: 0, httpAttempts: 576 });
    expect(result.tasks.transactions).toEqual({ acquisitions: 304, gets: 304, posts: 0, httpAttempts: 304 });
  });
  it('refutes the concurrent fresh-import deadline even before existing refresh and processing', () => {
    const one = currentSourceCapacity([cycle('fresh-a', 4)]);
    expect(one).toMatchObject({ acquisitionAdmissions: 258, getAttempts: 266, postAttempts: 72, httpAttempts: 338, normalSuccessfulClaims: 259 });
    expect(currentSourceFeasibility(one).importWithinFourHoursImpossible).toBe(true);
    const both = currentSourceCapacity([cycle('fresh-a', 4), cycle('fresh-b', 4)]);
    expect(both).toMatchObject({ acquisitionAdmissions: 516, getAttempts: 532, postAttempts: 144, httpAttempts: 676, normalSuccessfulClaims: 518,
      minimumAcquisitionSpacingSeconds: 515 * 60, normalSuccessfulClaimSpacingSeconds: 517 * 60 });
    expect(currentSourceFeasibility(both)).toMatchObject({ importWithinFourHoursImpossible: true,
      declaredBacklogWithinFourHoursImpossible: true, sustainedTwoHourWindowFitsCurrentHarness: false });
    const lower = currentSourceCapacity([cycle('fresh-a', 4, false, 0), cycle('fresh-b', 4, false, 0)]);
    expect(lower).toMatchObject({ acquisitionAdmissions: 348, getAttempts: 508, minimumAcquisitionSpacingSeconds: 347 * 60 });
    expect(currentSourceFeasibility(lower).importWithinFourHoursImpossible).toBe(true);
  });
  it('models empty versus unselected drafts and every additional native draft', () => {
    const noDrafts = currentSourceCapacity([cycle('empty', 1, false, 0)]);
    expect(noDrafts.tasks.drafts).toEqual({ acquisitions: 2, gets: 2, posts: 0, httpAttempts: 2 });
    const unselected = fullFamilyCapacityLeague('unselected', 0, false);
    expect(currentSourceCapacity([{ id: 'none', leagues: [{ ...unselected, draftCount: null }] }]).tasks.drafts)
      .toEqual({ acquisitions: 0, gets: 0, posts: 0, httpAttempts: 0 });
    expect(currentSourceCapacity([cycle('max', 1, false, 8)]).tasks.drafts).toEqual({ acquisitions: 26, gets: 26, posts: 0, httpAttempts: 26 });
  });
  it('deduplicates identities separately from actual repeated association acquisition', () => {
    const league = fullFamilyCapacityLeague('shared', 1, false);
    const result = currentSourceCapacity([{ id: 'a', leagues: [league] }, { id: 'b', leagues: [league] }], true);
    expect(result).toMatchObject({ distinctLeagues: 1, leagueAssociations: 2, acquisitionAdmissions: 97, getAttempts: 137 });
    expect(result.tasks.bootstrap.acquisitions).toBe(2);
    expect(result.tasks.playerDirectory.acquisitions).toBe(1);
  });
  it('preserves period zero only for transactions and rejects duplicate or out-of-bound inventories', () => {
    const league = fullFamilyCapacityLeague('x');
    for (const invalid of [{ ...league, exactWeeks: [0] }, { ...league, weeklyReports: [0] },
      { ...league, transactionPeriods: [19] }, { ...league, exactWeeks: [1, 1] },
      { ...league, draftCount: 9 }, { ...league, draftCount: -1 }]) {
      expect(() => currentSourceCapacity([{ id: 'invalid', leagues: [invalid] }])).toThrow();
    }
    expect(() => currentSourceCapacity([{ id: 'duplicate', leagues: [league, league] }])).toThrow();
    expect(() => currentSourceCapacity([cycle('same', 1), cycle('same', 1)])).toThrow();
    expect(() => fullFamilyCapacityLeague('bad', Number.NaN)).toThrow();
    expect(() => currentSourceCapacity([])).toThrow();
  });
  it('keeps an arithmetic non-refutation distinct from measured readiness', () => {
    const result = currentSourceFeasibility(currentSourceCapacity([cycle('small', 1, false)]));
    expect(result.importWithinFourHoursImpossible).toBe(false);
    expect(result.possibleByArithmeticIsNotQualified).toBe(true);
    expect(result.proofClass).toBe(CAPACITY_PROOF_CLASS);
  });
});

describe('frozen observation and event lower bounds', () => {
  it('already refutes the initially accepted eight-league common window without assuming new windows align', () => {
    expect(currentSourceActiveBounds(8)).toMatchObject({ activeFamilyPairs: 32, scheduledSamples: 3_840,
      p95RequiredGoodSlots: 114, p99RequiredGoodSlots: 119, p95NewCapturesPerPair: 18, p99NewCapturesPerPair: 10,
      p95MinimumAdmissions: 432, p99MinimumAdmissions: 240, maximumAdmissionsInWindow: 121,
      p95ImpossibleUnderCurrentAdmission: true, p99ImpossibleUnderCurrentAdmission: true,
      minimumRecoverySpacingSeconds: 23 * 60, recoveryWithinFifteenMinutesImpossible: true });
  });
  it('labels the sixteen-league aligned scenario and exposes shared matchup task costs', () => {
    expect(currentSourceActiveBounds(16)).toMatchObject({ alignedActiveLeagues: 16, activeFamilyPairs: 64,
      scheduledSamples: 7_680, p95MinimumAdmissions: 864, p99MinimumAdmissions: 480,
      sweepAdmissions: 48, sweepGets: 80, sweepPosts: 0, sweepHttpAttempts: 80, idealFiveMinuteSweepAdmissionsPerMinute: 9.6,
      idealFiveMinuteSweepGetsPerMinute: 16, minimumRecoverySpacingSeconds: 47 * 60 });
  });
  it('requires all 1280 logical versions and separates their 960 shared acquisitions', () => {
    expect(controlledEventCapacity()).toMatchObject({ activeFamilyPairs: 64, logicalEvents: 1_280,
      minimumAcquisitions: 960, minimumGets: 1_600, minimumPosts: 0, minimumHttpAttempts: 1_600, minimumEventAndTailSecondsPerPair: 7_200,
      minimumAcquisitionSpacingSeconds: 959 * 60 });
    expect(controlledEventCapacity(16, false)).toMatchObject({ logicalEvents: 1_280, minimumAcquisitions: 1_280, minimumGets: 2_240 });
  });
  it('rejects bounds outside the declared fleet', () => {
    for (const invalid of [0, -1, 1.5, 17, Infinity, Number.NaN]) {
      expect(() => currentSourceActiveBounds(invalid)).toThrow();
      expect(() => controlledEventCapacity(invalid)).toThrow();
    }
  });
});

describe('shared provider demand planning', () => {
  it('counts a shared acquisition once, preserves other owners, and separates Tank01', () => {
    const result = requestDemandEstimate(60, [
      { acquisitionId: 'data-active', provider: 'sleeper', owner: 'data', dataAttributed: true, getAttempts: 16, postAttempts: 0 },
      { acquisitionId: 'maintenance', provider: 'sleeper', owner: 'maintenance', dataAttributed: false, getAttempts: 31, postAttempts: 0 },
      { acquisitionId: 'stats', provider: 'sleeper', owner: 'current', dataAttributed: false, getAttempts: 1, postAttempts: 0 },
      { acquisitionId: 'stats', provider: 'sleeper', owner: 'all-player', dataAttributed: false, getAttempts: 1, postAttempts: 0 },
      { acquisitionId: 'tank', provider: 'tank01', owner: 'projections', dataAttributed: false, getAttempts: 2, postAttempts: 0 },
    ]);
    expect(result).toMatchObject({ uniqueAcquisitions: 4, sharedAcquisitions: 1,
      dataSleeper: { knownGetAttempts: 16, knownPostAttempts: 0, knownHttpAttempts: 16, unknownAcquisitions: 0 },
      combinedSleeper: { knownGetAttempts: 48, knownPostAttempts: 0, knownHttpAttempts: 48, unknownAcquisitions: 0 },
      tank01: { knownGetAttempts: 2, knownPostAttempts: 0, knownHttpAttempts: 2, unknownAcquisitions: 0 },
      dataWithinGetCeilingEstimate: true, dataWithinConservativeHttpCeilingEstimate: true,
      combinedSleeperKnownHttpHeadroomAgainstDataCeiling: -8 });
  });
  it('does not silently convert unknown GET or POST traffic into zero requests', () => {
    const result = requestDemandEstimate(3_600, [
      { acquisitionId: 'cache', provider: 'sleeper', owner: 'website', dataAttributed: false, getAttempts: null, postAttempts: 0 },
      { acquisitionId: 'data', provider: 'sleeper', owner: 'data', dataAttributed: true, getAttempts: null, postAttempts: null },
      { acquisitionId: 'known-hit', provider: 'sleeper', owner: 'website', dataAttributed: false, getAttempts: 0, postAttempts: 0 },
    ]);
    expect(result).toMatchObject({ dataGetCeiling: 1_800, conservativeHttpAttemptCeiling: 1_800,
      dataWithinGetCeilingEstimate: null, dataWithinConservativeHttpCeilingEstimate: null,
      combinedSleeper: { knownHttpAttempts: 0, unknownGetAcquisitions: 2, unknownPostAcquisitions: 1, unknownAcquisitions: 2 },
      dataSleeper: { knownHttpAttempts: 0, unknownGetAcquisitions: 1, unknownPostAcquisitions: 1, unknownAcquisitions: 1 } });
    const unknownPost = requestDemandEstimate(60, [{ acquisitionId: 'post', provider: 'sleeper', owner: 'data', dataAttributed: true,
      getAttempts: 0, postAttempts: null }]);
    expect(unknownPost).toMatchObject({ dataWithinGetCeilingEstimate: true, dataWithinConservativeHttpCeilingEstimate: null });
  });
  it('preserves the GET target while applying an explicitly conservative all-HTTP comparison', () => {
    const shared = { acquisitionId: 'mixed', provider: 'sleeper' as const, owner: 'data', dataAttributed: true, getAttempts: 30, postAttempts: 12 };
    const result = requestDemandEstimate(60, [shared, { ...shared, owner: 'measurement' }]);
    expect(result).toMatchObject({ uniqueAcquisitions: 1, sharedAcquisitions: 1, dataGetCeiling: 40, conservativeHttpAttemptCeiling: 40,
      dataSleeper: { knownGetAttempts: 30, knownPostAttempts: 12, knownHttpAttempts: 42 },
      dataKnownGetAttemptsExceedCeiling: false, dataWithinGetCeilingEstimate: true,
      dataKnownHttpAttemptsExceedConservativeCeiling: true, dataWithinConservativeHttpCeilingEstimate: false });
  });
  it('counts failed, retry, redirect and measurement attempts in supplied totals and rejects conflicting sharing', () => {
    const demand = { acquisitionId: 'all-attempts', provider: 'sleeper' as const, owner: 'data', dataAttributed: true, getAttempts: 41, postAttempts: 0 };
    expect(requestDemandEstimate(60, [demand])).toMatchObject({ dataKnownGetAttemptsExceedCeiling: true,
      dataWithinGetCeilingEstimate: false, dataKnownHttpAttemptsExceedConservativeCeiling: true, dataWithinConservativeHttpCeilingEstimate: false });
    expect(() => requestDemandEstimate(60, [demand, { ...demand, getAttempts: 40 }])).toThrow();
    expect(() => requestDemandEstimate(60, [demand, { ...demand, postAttempts: 1 }])).toThrow();
    expect(() => requestDemandEstimate(60, [{ ...demand, getAttempts: -1 }])).toThrow();
    expect(() => requestDemandEstimate(60, [{ ...demand, postAttempts: -1 }])).toThrow();
    expect(() => requestDemandEstimate(60, [{ ...demand, postAttempts: NaN }])).toThrow();
    expect(() => requestDemandEstimate(60, [{ ...demand, provider: 'tank01' }])).toThrow();
  });
});
it('binds arithmetic to actual coordinator request increments and protected owner limits', async () => {
  const text = await source('../lib/league-administration/public-intake.ts');
  const tree = ts.createSourceFile('public-intake.ts', text, ts.ScriptTarget.Latest, true);
  const acquisitionOptions: Record<string, number>[] = [], branchCosts = new Map<string, number>();
  const walk = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'acquireJob') {
      const argument = node.arguments[0];
      if (argument && ts.isObjectLiteralExpression(argument)) {
        const values: Record<string, number> = {};
        for (const property of argument.properties) if (ts.isPropertyAssignment(property) && ts.isIdentifier(property.name)
          && ts.isNumericLiteral(property.initializer)) values[property.name.text] = Number(property.initializer.text);
        acquisitionOptions.push(values);
      }
    }
    if (ts.isIfStatement(node) && /^work\.kind === '/u.test(node.expression.getText(tree))) {
      const kind = node.expression.getText(tree).match(/^work\.kind === '([^']+)'$/u)?.[1];
      if (kind && ts.isBlock(node.thenStatement)) {
        let requests = 0;
        for (const statement of node.thenStatement.statements) if (ts.isExpressionStatement(statement)) {
          const expression = statement.expression;
          if (ts.isPostfixUnaryExpression(expression) && expression.operand.getText(tree) === 'requests') requests++;
          if (ts.isBinaryExpression(expression) && expression.left.getText(tree) === 'requests'
            && expression.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken && ts.isNumericLiteral(expression.right)) requests += Number(expression.right.text);
        }
        branchCosts.set(kind, requests);
      }
    }
    ts.forEachChild(node, walk);
  };
  walk(tree);
  expect(acquisitionOptions).toEqual([{ leaseSeconds: CURRENT_DATA_CAPACITY.jobLeaseSeconds,
    minimumIntervalSeconds: CURRENT_DATA_CAPACITY.successfulCompletionSpacingSeconds }]);
  expect(Object.fromEntries(branchCosts)).toEqual({ identity: 1, leagues: 1, bootstrap: 1, drafts: 1,
    transactions: 1, 'weekly-report': 1, 'playoff-brackets': 2, 'exact-matchups': 2, core: 2 });
  expect(text).toContain('Math.floor(now().getTime() / 60_000) * 60_000');
  expect(text).toContain('now().getTime() + 20_000');
  expect(text).toContain("source.core(work.externalLeagueId, 'users', signal, witness)");
  const admission = await source('../migrations/038_public_data_exact_periods.sql');
  expect(admission).toContain("admitted_at>clock_timestamp()-interval '60 seconds'");
  const directory = await source('../migrations/041_shared_player_directory.sql');
  expect(directory).toContain("max(dispatch.admitted_at)+interval '60 seconds'");
  expect(directory).toContain("next_network_at=admitted_at+interval '24 hours'");
  const drafts = await source('../migrations/056_public_draft_intake.sql');
  expect(drafts).toContain("CROSS JOIN (VALUES(1,'catalog'),(2,'league-trades'))");
  expect(drafts).toContain("CROSS JOIN (VALUES(0,'detail'),(1,'selections'),(2,'draft-trades'))");
  expect(drafts).toContain('native_ordinal NOT BETWEEN 1 AND 8');
  const periods = await source('../lib/league-administration/public-intake-contracts.ts');
  expect(periods).toContain('Array.from({ length: 19 }, (_, nativeWeek)');
  expect(periods).toContain('Array.from({ length: 18 }, (_, index)');
  const runtime = await source('../lib/league-administration/public-intake-runtime.ts');
  expect(runtime).toContain('const workDeadline = invocationStartedAt + 20_000');
  expect(runtime).toContain('const deadline = invocationStartedAt + 22_000');
});
it('keeps the actual lifecycle, expiry, CI and coexistence limits visible without extending them', async () => {
  const lifecycle = await source('./integration-lifecycle-budget.ts');
  expect(lifecycle).toContain('INTEGRATION_LIFECYCLE_MS = 40 * 60_000');
  expect(lifecycle).toContain('INTEGRATION_TEARDOWN_RESERVE_MS = 10 * 60_000');
  expect(lifecycle).toContain('readonly workDeadline = this.deadline - INTEGRATION_TEARDOWN_RESERVE_MS');
  expect(CURRENT_DATA_CAPACITY.harnessLifecycleSeconds - CURRENT_DATA_CAPACITY.harnessWorkSeconds).toBe(600);
  expect(await source('./disposable-neon-api.ts')).toContain('startedAt + 3_600_000');
  expect(await source('../../../.github/workflows/integration.yml')).toContain('timeout-minutes: 50');
  const maintenance = await source('../lib/league-administration/maintenance.ts');
  expect(maintenance).toContain('now.getUTCMinutes() !== 30');
  expect(maintenance).toContain('maxRequests: 28');
  expect(maintenance).toContain('upstreamRequests: 3 + extra.providerRequests');
  const transport = await source('../lib/sleeper.ts');
  expect(transport).toContain("redirect: 'error', boundedPublicCapture: true");
  // Source request counters alone cannot distinguish this GraphQL POST from REST GETs.
  expect(transport).toContain("requestPolicy?.weeklyReportKey ? 'https://sleeper.com/graphql' : `${API}${path}`");
  expect(transport).toContain("requestPolicy?.weeklyReportKey ? { method: 'POST', credentials: 'omit' as const");
  expect(transport).toContain('weeklyReportKey: `${leagueId}_${nativeWeek}`');
  const telemetry = await source('../lib/provider-request-telemetry.ts');
  expect(telemetry).toContain("upstreamRequests: cacheStatus === 'bypass' ? 1 : null");
});
