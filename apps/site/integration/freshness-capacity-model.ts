/** Pinned CP25 legacy (unselected 60-second policy) planning baseline only. R058 batch throughput is not modeled or proven. */
export const CURRENT_DATA_CAPACITY = Object.freeze({
  sourceRevision: '15fb9b725e3bff08c70851ba075ee37cb26c166d',
  admissionSpacingSeconds: 60,
  successfulCompletionSpacingSeconds: 60,
  jobLeaseSeconds: 25,
  workFenceSeconds: 20,
  cleanupDeadlineSeconds: 22,
  harnessWorkSeconds: 1_800,
  harnessLifecycleSeconds: 2_400,
  branchExpirySeconds: 3_600,
  ciSeconds: 3_000,
  dataGetsPerMinute: 40,
  dataGetsPerHour: 1_800,
});
export const CAPACITY_PROOF_CLASS = 'source-arithmetic-only' as const;
export type CapacityLeagueScope = Readonly<{
  leagueId: string;
  exactWeeks: readonly number[];
  transactionPeriods: readonly number[];
  weeklyReports: readonly number[];
  brackets: boolean;
  /** null means unselected; zero still acquires catalog and league traded picks. */
  draftCount: number | null;
}>;
export type CapacityCycle = Readonly<{ id: string; leagues: readonly CapacityLeagueScope[] }>;
export type CapacityCost = Readonly<{ acquisitions: number; gets: number; posts: number; httpAttempts: number }>;
export type CapacityTask = 'identity' | 'discovery' | 'bootstrap' | 'core' | 'users'
  | 'exactMatchups' | 'transactions' | 'weeklyReports' | 'brackets' | 'drafts' | 'playerDirectory';
const COSTS: Readonly<Record<CapacityTask, Readonly<{ gets: number; posts: number }>>> = Object.freeze({
  identity: { gets: 1, posts: 0 }, discovery: { gets: 1, posts: 0 }, bootstrap: { gets: 1, posts: 0 },
  core: { gets: 2, posts: 0 }, users: { gets: 1, posts: 0 }, exactMatchups: { gets: 2, posts: 0 },
  transactions: { gets: 1, posts: 0 }, weeklyReports: { gets: 0, posts: 1 },
  brackets: { gets: 2, posts: 0 }, drafts: { gets: 1, posts: 0 }, playerDirectory: { gets: 1, posts: 0 },
});
function count(value: number, name: string, minimum: number, maximum: number) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`Invalid ${name}.`);
  return value;
}
function key(value: string, name: string) {
  if (typeof value !== 'string' || !value.trim() || value.length > 128) throw new Error(`Invalid ${name}.`);
  return value;
}
function periods(value: readonly number[], name: string, minimum: number) {
  if (!Array.isArray(value) || value.length > 19 || new Set(value).size !== value.length) throw new Error(`Invalid ${name}.`);
  value.forEach(period => count(period, name, minimum, 18));
  return value.length;
}
/** All selected source periods, including transaction period zero; reports are independent. */
export function fullFamilyCapacityLeague(leagueId: string, draftCount = 1, includeWeeklyReports = true): CapacityLeagueScope {
  key(leagueId, 'league ID'); count(draftCount, 'draft count', 0, 8);
  if (typeof includeWeeklyReports !== 'boolean') throw new Error('Invalid report selection.');
  return { leagueId, exactWeeks: Array.from({ length: 18 }, (_, index) => index + 1),
    transactionPeriods: Array.from({ length: 19 }, (_, index) => index),
    weeklyReports: includeWeeklyReports ? Array.from({ length: 18 }, (_, index) => index + 1) : [],
    brackets: true, draftCount };
}
/** Each actual username cycle pays identity/discovery and each associated league acquisition.
 * Canonical identity deduplication is not cross-request HTTP deduplication in current source. */
export function currentSourceCapacity(cycles: readonly CapacityCycle[], includeSharedPlayerDirectory = false) {
  if (!Array.isArray(cycles) || !cycles.length || cycles.length > 16
    || new Set(cycles.map(cycle => cycle.id)).size !== cycles.length
    || typeof includeSharedPlayerDirectory !== 'boolean') throw new Error('Invalid capacity cycles.');
  const tasks = Object.fromEntries(Object.keys(COSTS).map(kind => [kind, { acquisitions: 0, gets: 0, posts: 0, httpAttempts: 0 }])) as Record<CapacityTask, { acquisitions: number; gets: number; posts: number; httpAttempts: number }>;
  const add = (task: CapacityTask, acquisitions: number) => {
    tasks[task].acquisitions += acquisitions;
    tasks[task].gets += acquisitions * COSTS[task].gets;
    tasks[task].posts += acquisitions * COSTS[task].posts;
    tasks[task].httpAttempts += acquisitions * (COSTS[task].gets + COSTS[task].posts);
  };
  const distinct = new Set<string>();
  let leagueAssociations = 0;
  for (const cycle of cycles) {
    key(cycle.id, 'cycle ID');
    if (!Array.isArray(cycle.leagues) || cycle.leagues.length > 20
      || new Set(cycle.leagues.map((league: CapacityLeagueScope) => league.leagueId)).size !== cycle.leagues.length) throw new Error('Invalid cycle leagues.');
    add('identity', 1); add('discovery', 1);
    for (const league of cycle.leagues) {
      distinct.add(key(league.leagueId, 'league ID')); leagueAssociations++;
      add('bootstrap', 1); add('core', 1); add('users', 1);
      add('exactMatchups', periods(league.exactWeeks, 'exact weeks', 1));
      add('transactions', periods(league.transactionPeriods, 'transaction periods', 0));
      add('weeklyReports', periods(league.weeklyReports, 'weekly reports', 1));
      if (typeof league.brackets !== 'boolean') throw new Error('Invalid bracket selection.');
      add('brackets', Number(league.brackets));
      if (league.draftCount !== null) add('drafts', 2 + 3 * count(league.draftCount, 'draft count', 0, 8));
    }
  }
  add('playerDirectory', Number(includeSharedPlayerDirectory));
  const acquisitionAdmissions = Object.values(tasks).reduce((sum, task) => sum + task.acquisitions, 0);
  const getAttempts = Object.values(tasks).reduce((sum, task) => sum + task.gets, 0);
  const postAttempts = Object.values(tasks).reduce((sum, task) => sum + task.posts, 0);
  const httpAttempts = getAttempts + postAttempts;
  // A terminal request can already be read after its last checkpoint. Settlement is
  // a separate zero-GET recurring-cycle claim, not initial import availability.
  const settlementClaims = cycles.length;
  return { proofClass: CAPACITY_PROOF_CLASS, tasks, distinctLeagues: distinct.size, leagueAssociations,
    acquisitionAdmissions, getAttempts, postAttempts, httpAttempts, settlementClaims, normalSuccessfulClaims: acquisitionAdmissions + settlementClaims,
    minimumAcquisitionSpacingSeconds: Math.max(0, acquisitionAdmissions - 1) * CURRENT_DATA_CAPACITY.admissionSpacingSeconds,
    normalSuccessfulClaimSpacingSeconds: Math.max(0, acquisitionAdmissions + settlementClaims - 1)
      * CURRENT_DATA_CAPACITY.successfulCompletionSpacingSeconds,
    assumptions: ['No retries, failed acquisitions, processing time, queueing or other owners included.',
      'Settlement claim count models one completed recurring cycle per supplied cycle.',
      'Normal successful claim spacing excludes faster failed/expired-lease paths.',
      'Complete selected source availability and supported inventories are assumed.',
      'Spacing impossibility applies only to the pinned CP25 legacy policy; selected R058 batching has no measured throughput here.',
      'Weekly-report acquisitions use POST; all HTTP attempts remain counted in conservative capacity planning.'] as const };
}
/** All pairs here share ONE aligned two-hour window. Use eight for the benchmark's
 * initially accepted cohort; sixteen is a separate aligned-window scenario only. */
export function currentSourceActiveBounds(alignedActiveLeagues: number) {
  count(alignedActiveLeagues, 'aligned active league count', 1, 16);
  const samplesPerPair = 120, slotSeconds = 60, horizonSeconds = 7_200;
  const p95RequiredGoodSlots = Math.ceil(samplesPerPair * 0.95);
  const p99RequiredGoodSlots = Math.ceil(samplesPerPair * 0.99);
  // Deliberately generous: a capture precisely on a slot can cover its own slot
  // and five later slots; also credit a fresh initial capture with six slots.
  const p95SlotsPerCapture = Math.floor(300 / slotSeconds) + 1;
  const p99SlotsPerCapture = Math.floor(600 / slotSeconds) + 1;
  const p95NewCapturesPerPair = Math.ceil((p95RequiredGoodSlots - p95SlotsPerCapture) / p95SlotsPerCapture);
  const p99NewCapturesPerPair = Math.ceil((p99RequiredGoodSlots - p99SlotsPerCapture) / p99SlotsPerCapture);
  // One matchup acquisition can serve lineup AND score; rosters/transactions cannot.
  const acquisitionGroups = alignedActiveLeagues * 3;
  const maximumAdmissionsInWindow = Math.floor(horizonSeconds / CURRENT_DATA_CAPACITY.admissionSpacingSeconds) + 1;
  const p95MinimumAdmissions = acquisitionGroups * p95NewCapturesPerPair;
  const p99MinimumAdmissions = acquisitionGroups * p99NewCapturesPerPair;
  const sweepAdmissions = acquisitionGroups, sweepGets = alignedActiveLeagues * 5;
  const recoverySpacingSeconds = (sweepAdmissions - 1) * CURRENT_DATA_CAPACITY.admissionSpacingSeconds;
  return { proofClass: CAPACITY_PROOF_CLASS, alignedActiveLeagues, activeFamilyPairs: alignedActiveLeagues * 4,
    samplesPerPair, scheduledSamples: alignedActiveLeagues * 4 * samplesPerPair, horizonSeconds,
    p95RequiredGoodSlots, p99RequiredGoodSlots, p95NewCapturesPerPair, p99NewCapturesPerPair,
    p95MinimumAdmissions, p99MinimumAdmissions, maximumAdmissionsInWindow,
    p95ImpossibleUnderCurrentAdmission: p95MinimumAdmissions > maximumAdmissionsInWindow,
    p99ImpossibleUnderCurrentAdmission: p99MinimumAdmissions > maximumAdmissionsInWindow,
    sweepAdmissions, sweepGets, sweepPosts: 0, sweepHttpAttempts: sweepGets, idealFiveMinuteSweepAdmissionsPerMinute: sweepAdmissions / 5,
    idealFiveMinuteSweepGetsPerMinute: sweepGets / 5,
    minimumRecoverySpacingSeconds: recoverySpacingSeconds,
    recoveryWithinFifteenMinutesImpossible: recoverySpacingSeconds > 900,
    assumptions: ['All indicated family windows are aligned; staggered new-league windows must be analyzed separately.',
      'Every pair begins with a fresh accepted head; all subsequent work is successful and instantaneous.',
      'The recovery bound assumes all active heads are stale after the declared 30-minute outage.'] as const };
}
/** Correctness requires every controlled version, even the one a 20-event p95 can omit. */
export function controlledEventCapacity(activeLeagues = 16, lineupAndScoreEventsAligned = true) {
  count(activeLeagues, 'active league count', 1, 16);
  if (typeof lineupAndScoreEventsAligned !== 'boolean') throw new Error('Invalid event alignment.');
  const eventsPerPair = 20, matchupCapturesPerLeague = eventsPerPair * (lineupAndScoreEventsAligned ? 1 : 2);
  const acquisitions = activeLeagues * (eventsPerPair * 2 + matchupCapturesPerLeague);
  const gets = activeLeagues * (eventsPerPair * 3 + matchupCapturesPerLeague * 2);
  return { proofClass: CAPACITY_PROOF_CLASS, activeFamilyPairs: activeLeagues * 4, eventsPerPair,
    logicalEvents: activeLeagues * 4 * eventsPerPair, minimumAcquisitions: acquisitions, minimumGets: gets, minimumPosts: 0, minimumHttpAttempts: gets,
    minimumEventAndTailSecondsPerPair: (eventsPerPair - 1) * 360 + 360,
    minimumAcquisitionSpacingSeconds: (acquisitions - 1) * CURRENT_DATA_CAPACITY.admissionSpacingSeconds,
    lineupAndScoreEventsAligned };
}
export function currentSourceFeasibility(capacity: ReturnType<typeof currentSourceCapacity>) {
  return { proofClass: CAPACITY_PROOF_CLASS,
    importWithinFourHoursImpossible: capacity.minimumAcquisitionSpacingSeconds > 14_400,
    declaredBacklogWithinFourHoursImpossible: capacity.minimumAcquisitionSpacingSeconds > 14_400,
    sustainedTwoHourWindowFitsCurrentHarness: 7_200 <= CURRENT_DATA_CAPACITY.harnessWorkSeconds,
    // False means only that this lower bound did not refute the target; never proof of fit.
    possibleByArithmeticIsNotQualified: true,
    deadlineComparisonAssumption: 'Every supplied acquisition belongs to the same simultaneous intake or declared backlog deadline.' as const };
}
export type RequestDemandEstimate = Readonly<{
  /** Shared HTTP acquisition identity: repeated attribution counts once. */
  acquisitionId: string;
  provider: 'sleeper' | 'tank01';
  owner: string;
  dataAttributed: boolean;
  /** Include failed/retried/redirect/measurement attempts. null is unknown, never zero. */
  getAttempts: number | null;
  postAttempts: number | null;
}>;
/** A fixed-window planning estimate, not a rolling-window measurement or admission grant.
 * CP1's ceiling remains GET-specific. The additional all-HTTP comparison is deliberately conservative. */
export function requestDemandEstimate(windowSeconds: 60 | 3_600, demands: readonly RequestDemandEstimate[]) {
  if (![60, 3_600].includes(windowSeconds) || !Array.isArray(demands) || demands.length > 100_000) throw new Error('Invalid request estimate.');
  const acquisitions = new Map<string, { provider: 'sleeper' | 'tank01'; dataAttributed: boolean;
    getAttempts: number | null; postAttempts: number | null; owners: Set<string> }>();
  for (const demand of demands) {
    key(demand.acquisitionId, 'acquisition ID'); key(demand.owner, 'request owner');
    if (!['sleeper', 'tank01'].includes(demand.provider) || typeof demand.dataAttributed !== 'boolean'
      || demand.dataAttributed && demand.provider !== 'sleeper') throw new Error('Invalid request attribution.');
    if (demand.getAttempts !== null) count(demand.getAttempts, 'GET attempts', 0, 1_000_000);
    if (demand.postAttempts !== null) count(demand.postAttempts, 'POST attempts', 0, 1_000_000);
    const previous = acquisitions.get(demand.acquisitionId);
    if (previous && (previous.provider !== demand.provider || previous.getAttempts !== demand.getAttempts
      || previous.postAttempts !== demand.postAttempts)) throw new Error('Conflicting shared acquisition estimate.');
    if (previous) { previous.dataAttributed ||= demand.dataAttributed; previous.owners.add(demand.owner); }
    else acquisitions.set(demand.acquisitionId, { provider: demand.provider, dataAttributed: demand.dataAttributed,
      getAttempts: demand.getAttempts, postAttempts: demand.postAttempts, owners: new Set([demand.owner]) });
  }
  const sum = (select: (entry: { provider: string; dataAttributed: boolean }) => boolean) => {
    const entries = [...acquisitions.values()].filter(select);
    const knownGetAttempts = entries.reduce((total, entry) => total + (entry.getAttempts ?? 0), 0);
    const knownPostAttempts = entries.reduce((total, entry) => total + (entry.postAttempts ?? 0), 0);
    return { knownGetAttempts, knownPostAttempts, knownHttpAttempts: knownGetAttempts + knownPostAttempts,
      unknownGetAcquisitions: entries.filter(entry => entry.getAttempts === null).length,
      unknownPostAcquisitions: entries.filter(entry => entry.postAttempts === null).length,
      unknownAcquisitions: entries.filter(entry => entry.getAttempts === null || entry.postAttempts === null).length };
  };
  const dataSleeper = sum(entry => entry.dataAttributed);
  const combinedSleeper = sum(entry => entry.provider === 'sleeper');
  const tank01 = sum(entry => entry.provider === 'tank01');
  const ceiling = windowSeconds === 60 ? CURRENT_DATA_CAPACITY.dataGetsPerMinute : CURRENT_DATA_CAPACITY.dataGetsPerHour;
  const within = (known: number, unknown: number) => known > ceiling ? false : unknown ? null : true;
  return { proofClass: CAPACITY_PROOF_CLASS, windowSeconds, uniqueAcquisitions: acquisitions.size,
    sharedAcquisitions: [...acquisitions.values()].filter(entry => entry.owners.size > 1).length,
    dataSleeper, combinedSleeper, tank01, dataGetCeiling: ceiling, conservativeHttpAttemptCeiling: ceiling,
    dataKnownGetAttemptsExceedCeiling: dataSleeper.knownGetAttempts > ceiling,
    dataWithinGetCeilingEstimate: within(dataSleeper.knownGetAttempts, dataSleeper.unknownGetAcquisitions),
    dataKnownHttpAttemptsExceedConservativeCeiling: dataSleeper.knownHttpAttempts > ceiling,
    dataWithinConservativeHttpCeilingEstimate: within(dataSleeper.knownHttpAttempts, dataSleeper.unknownAcquisitions),
    combinedSleeperKnownHttpHeadroomAgainstDataCeiling: ceiling - combinedSleeper.knownHttpAttempts,
    assumptions: ['Fixed-window estimate does not establish every rolling minute/hour.',
      'CP1 GET ceilings are unchanged; comparing all HTTP attempts with those numbers is conservative planning only.',
      'Combined Sleeper comparison is planning headroom, not a changed limit on other owners.',
      'Unknown framework-cache transport is never credited as zero GETs or POSTs.',
      'Tank01 is counted separately and receives no new request allowance.'] as const };
}
