import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { normalizeAdministrationObservation } from '../lib/league-administration/normalize';
import type { AdministrationEnvelope, JsonObject, JsonValue } from '../lib/league-administration/contracts';
import { projectExactMatchupValues } from '../lib/aggregator/exact-matchup-values';
import { rosterCategoryEvidence } from '../lib/aggregator/roster-player-links';
import { projectTransactionCapture } from '../lib/aggregator/transaction-activity';
import { capacityDigest, createCapacityPlan, freezeCapacityValue, type BoundEvent, type CapacityFamily,
  type PayloadVersion, type ReaderExpectation, type BoundLeague, type CapacityEndpointBinding, type CapacityEndpointVersion, type CapacityNativeResource, type CapacityFormatScenario, type CapacityFormatWitness, capacityWeeklyReportRequest, capacityPointer, assertCapacityEndpointInventory } from './freshness-capacity-manifest';

/** Native-shape simulation only. These are neither live captures nor committed readers. */
export const CAPACITY_FIXTURE_GAPS = Object.freeze([
  'Synthetic league identities do not satisfy real League One, League Two or Dynasty regression evidence.',
  'Actual mappings, canonical team identities, acquisition witnesses and immutable committed receipt IDs are unresolved.',
  'Reader field projections are exercised offline; actual restricted-role database readers and history readback are unexecuted.',
  'Weeks 1–18 and transaction periods 0–18 are declared; only current week seven has controlled resource payloads.',
  'Identity/discovery adapter, drafts, brackets, weekly reports, shared player directory and complete history transport responses are not assembled.',
  'Positive byes, official ties/finality, multiweek legs, unusual scoring, pre-draft, overlap and capacity witnesses remain incomplete.',
  'Real elapsed anchors, runtime HTTP publication, sample dispatch and complete acquisition attempt journals remain unexecuted.',
  'Existing admission and harness duration limits cannot qualify the frozen CP26 workload; no run authorization is supplied.',
]);
export const CAPACITY_NATIVE_SOURCE_MAP = Object.freeze([
  { source: 'integration/roster-player-links.integration-case.ts', proof: 'existing synthetic native category cases',
    fields: ['roster_id', 'players', 'starters', 'reserve', 'taxi'], owner: 'aggregator/roster-player-links.ts:rosterCategoryEvidence' },
  { source: 'integration/exact-matchup-values.integration-case.ts', proof: 'existing synthetic exact native value cases',
    fields: ['roster_id', 'matchup_id', 'players', 'starters', 'points', 'custom_points', 'starters_points', 'players_points'],
    owner: 'aggregator/exact-matchup-values.ts:projectExactMatchupValues' },
  { source: 'integration/transaction-history-intake.integration-case.ts', proof: 'existing synthetic native transaction cases',
    fields: ['transaction_id', 'type', 'status', 'roster_ids', 'adds', 'drops', 'settings.waiver_bid', 'created', 'status_updated'],
    owner: 'aggregator/transaction-activity.ts:projectTransactionCapture' },
  { source: 'test-support/fixtures/cp13-live-source-2026/prior-periods.json', proof: 'retained actual 2026 source, not this simulation',
    fields: ['roster_id', 'matchup_id', 'points', 'custom_points'], owner: 'aggregator/exact-matchup-values.ts:projectExactMatchupValues' },
  { source: 'test-support/fixtures/cp13-live-source-2025/source.json', proof: 'retained actual 2025 test evidence; never relabeled 2026',
    fields: ['roster_id', 'matchup_id', 'points', 'custom_points'], owner: 'aggregator/exact-matchup-values.ts:projectExactMatchupValues' },
]);
export type SimulatedCapacityLeague = Readonly<{
  key: string; nativeLeagueId: string; season: 2026; nativeWeek: 7; rosterCount: 20;
  cohort: 'accepted' | 'intake-a' | 'intake-b'; plannedRegression: 'league-one' | 'league-two' | 'dynasty' | null;
  regressionWitnessStatus: 'unqualified-simulation'; leaguePayload: JsonObject;
}>;
type Resource = 'rosters' | 'matchups' | 'transactions';
type MutableNative = { [key: string]: JsonValue };
export type CapacityReaderBinding = Readonly<{
  family: CapacityFamily; nativeLeagueId: string; season: 2026; nativeWeek: number | null;
  api: 'readRosterPlayerLinks' | 'readExactMatchupValues' | 'readAcceptedTransactions';
  fields: Readonly<Record<string, string>>;
  receiptParameter: 'rosterReceiptId' | 'matchupsReceiptId' | 'receiptId';
  receiptResolution: 'unresolved-committed-receipt-for-version-and-payload-hash';
  sourceVersion: string; sourcePayloadSha256: string;
  mappingResolution: 'unresolved-actual-mapping-and-league-season';
}>;
function uuid(label: string) {
  const h = createHash('sha256').update(label).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}
const player = (id: number) => `cp26-sim-player-${id}`;
function payloadVersion(league: SimulatedCapacityLeague, resource: Resource, ordinal: number, payload: JsonValue): PayloadVersion {
  const utf8 = JSON.stringify(payload);
  return { version: `simulation:${league.key}:${resource}:v${ordinal}`, utf8,
    sha256: createHash('sha256').update(utf8).digest('hex') };
}
export function simulatedCapacityEnvelope(league: SimulatedCapacityLeague, resource: Resource, payload: JsonValue): AdministrationEnvelope {
  return { schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1', dialect: 'sleeper-nfl-v1',
    scope: { leagueKey: `cp26-simulation-${league.key}`, provider: 'sleeper', externalLeagueId: league.nativeLeagueId, season: 2026 },
    family: resource, week: resource === 'rosters' ? null : league.nativeWeek, completeness: 'complete',
    // Bootstrap marks authored material; no network observation or elapsed proof is invented.
    provenance: { origin: 'bootstrap', requestStartedAt: null, requestCompletedAt: null, sourceObservedAt: null,
      checkedAt: '2026-10-16T00:00:00.000Z' }, payload };
}
function initialRosters(): JsonObject[] {
  return Array.from({ length: 20 }, (_, index) => ({ roster_id: index + 1, owner_id: null, co_owners: [],
    players: index ? [] : Array.from({ length: 8 }, (_, n) => player(n + 1)),
    starters: index ? [] : [1, 2, 3, 4].map(player), reserve: index ? [] : [player(5)], taxi: index ? [] : [player(6)] }));
}
function initialMatchups(): JsonObject[] {
  return Array.from({ length: 20 }, (_, index) => ({ roster_id: index + 1, matchup_id: Math.floor(index / 2) + 1,
    players: Array.from({ length: 8 }, (_, n) => player(n + 1)), starters: [1, 2, 3, 4].map(player),
    points: 40 + index, custom_points: null, starters_points: [10, 10, 10, 10],
    players_points: Object.fromEntries(Array.from({ length: 8 }, (_, n) => [player(n + 1), n < 4 ? 10 : 0])) }));
}
function transaction(league: SimulatedCapacityLeague, ordinal: number): JsonObject {
  return { transaction_id: `${league.nativeLeagueId}${String(ordinal).padStart(2, '0')}`, type: 'waiver', status: 'complete',
    roster_ids: [1], adds: { [player(ordinal + 1)]: 1 }, drops: {}, settings: { waiver_bid: ordinal },
    created: 1_792_108_800_000 + ordinal * 1_000, status_updated: 1_792_108_800_000 + ordinal * 1_000 };
}
function nextRosters(previous: JsonObject[], ordinal: number): JsonObject[] {
  const rows = structuredClone(previous) as MutableNative[], row = rows[0];
  if (ordinal <= 10) {
    const id = player(9 + Math.floor((ordinal - 1) / 2)), held = row.players as string[];
    row.players = ordinal % 2 ? [...held, id] : held.filter(value => value !== id);
  } else if (ordinal <= 16) {
    if (ordinal === 11) row.reserve = [];
    if (ordinal === 12) row.reserve = [player(5)];
    if (ordinal === 13) row.taxi = [];
    if (ordinal === 14) row.taxi = [player(6)];
    if (ordinal === 15) row.reserve = [player(7)];
    if (ordinal === 16) row.reserve = [player(5)];
  } else rows[0] = ordinal % 2 ? { ...row, players: [], starters: [], reserve: [], taxi: [] } : initialRosters()[0];
  return rows;
}
function nextMatchups(previous: JsonObject[], ordinal: number): JsonObject[] {
  const rows = structuredClone(previous) as MutableNative[], starters = rows[0].starters as string[];
  if (ordinal <= 12) {
    const index = (ordinal - 1) % 4;
    starters[index] = starters[index] === player(index + 1) ? player(index + 5) : player(index + 1);
  } else if (ordinal <= 16) starters[ordinal - 13] = '0';
  else starters[ordinal - 17] = player(ordinal - 16);
  // Same exact matchup response independently changes the score family.
  if (ordinal <= 8) rows[0].points = Number(rows[0].points) + 2.5;
  else if (ordinal <= 12) rows[0].points = Number(rows[0].points) - 1.25;
  else if (ordinal <= 16) rows[ordinal - 13].points = 0;
  else rows[ordinal - 17].custom_points = ordinal === 17 || ordinal === 20 ? 0 : ordinal === 18 ? -2.5 : 4.25;
  return rows;
}
function nextTransactions(league: SimulatedCapacityLeague, previous: JsonObject[], ordinal: number): JsonObject[] {
  const rows = structuredClone(previous) as MutableNative[];
  if (ordinal <= 8) rows.push(transaction(league, ordinal));
  else if (ordinal <= 16) {
    const row = rows.find(value => value.transaction_id === transaction(league, ordinal - 8).transaction_id)!;
    if (ordinal % 2) row.settings = { waiver_bid: 0 }; else row.status = 'failed';
    row.status_updated = Number(row.status_updated) + 60_000;
  } else return rows.filter(row => row.transaction_id !== transaction(league, ordinal - 16).transaction_id);
  return rows;
}
/** Native JSON pointers for actual differences, including disappeared array entries. */
export function capacityChangedNativeFields(before: JsonValue, after: JsonValue, path = ''): string[] {
  if (capacityDigest(before) === capacityDigest(after)) return [];
  if (before !== null && after !== null && typeof before === 'object' && typeof after === 'object'
    && Array.isArray(before) === Array.isArray(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    return [...keys].flatMap(key => {
      const next = `${path}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`;
      const a = before as Record<string, JsonValue>, b = after as Record<string, JsonValue>;
      return !Object.hasOwn(a, key) || !Object.hasOwn(b, key) ? [next] : capacityChangedNativeFields(a[key], b[key], next);
    });
  }
  return [path || '/'];
}
function readerFields(family: CapacityFamily): Record<string, string> {
  return family === 'rosters' ? { categories: 'teams[externalRosterId="1"].categories' }
    : family === 'transactions' ? { normalized: 'capture.normalizedValue' }
      : family === 'lineups' ? { starters: 'value.teams[*].{externalRosterId,starters}' }
        : { raw: 'value.teams[*].{externalRosterId,rawPoints}', custom: 'value.teams[*].{externalRosterId,customPoints}',
          effective: 'value.teams[*].{externalRosterId,effectivePoints}' };
}
export function capacityFixtureReaderBinding(league: SimulatedCapacityLeague, family: CapacityFamily, version: PayloadVersion): CapacityReaderBinding {
  const api = family === 'rosters' ? 'readRosterPlayerLinks' : family === 'transactions' ? 'readAcceptedTransactions' : 'readExactMatchupValues';

  return { family, nativeLeagueId: league.nativeLeagueId, season: 2026, nativeWeek: family === 'rosters' ? null : 7,
    api, fields: readerFields(family), receiptParameter: family === 'rosters' ? 'rosterReceiptId' : family === 'transactions' ? 'receiptId' : 'matchupsReceiptId',
    receiptResolution: 'unresolved-committed-receipt-for-version-and-payload-hash', sourceVersion: version.version, sourcePayloadSha256: version.sha256,
    mappingResolution: 'unresolved-actual-mapping-and-league-season' };
}
/** Current readers stay stable across source versions; receipt selection is resolved at sample time. */
export function capacityFixtureHeadBinding(league: SimulatedCapacityLeague, family: CapacityFamily) {
  return { family, nativeLeagueId: league.nativeLeagueId, season: 2026, nativeWeek: family === 'rosters' ? null : 7,
    mappingResolution: 'unresolved-actual-mapping-and-league-season' as const, fields: readerFields(family),
    calls: family === 'rosters'
      ? ['readAcceptedCurrentRoster(mapping)', 'readRosterPlayerLinks({rosterReceiptId:receipt.id,leagueSeasonId:mapping.leagueSeasonId})']
      : family === 'transactions' ? ['readAcceptedTransactions(mapping,7)'] : ['readExactMatchupValues(mapping,{nativeWeek:7})'],
    sourceAgeField: family === 'rosters' ? 'receipt.provenance.sourceObservedAt'
      : family === 'transactions' ? 'capture.envelope.provenance.sourceObservedAt' : 'provenance.sourceObservedAt',
    selection: 'current-accepted-head-without-historical-receipt-override' as const };
}
function headSelector(league: SimulatedCapacityLeague, family: CapacityFamily) {
  return 'cp26-simulation/' + league.key + '/' + family + '/head';
}
function historySelector(league: SimulatedCapacityLeague, family: CapacityFamily, version: PayloadVersion) {
  return 'cp26-simulation/' + league.key + '/' + family + '/history/' + version.version;
}
/** Select actual pure-projector fields that the named stored readers expose. */
export function projectCapacityFixtureValue(league: SimulatedCapacityLeague, family: CapacityFamily, version: PayloadVersion): JsonValue {
  const payload = JSON.parse(version.utf8) as JsonValue;
  const resource: Resource = family === 'lineups' || family === 'official-scores' ? 'matchups' : family;
  const envelope = simulatedCapacityEnvelope(league, resource, payload);
  const normalized = normalizeAdministrationObservation(envelope, { expectedRosterCount: 20 });
  assert.equal(normalized.status, 'accepted', JSON.stringify(normalized.diagnostics));
  if (family === 'rosters') {
    assert.equal(normalized.value?.family, 'rosters');
    const row = (payload as JsonObject[])[0];
    return { categories: Object.fromEntries((['players', 'starters', 'reserve', 'taxi'] as const)
      .map(field => [field, rosterCategoryEvidence(row, field)])) } as JsonValue;
  }
  const teams = Array.from({ length: 20 }, (_, index) => ({ externalRosterId: String(index + 1),
    seasonTeamId: uuid(`simulation:${league.key}:team:${index + 1}`) }));
  if (family !== 'transactions') {
    const exact = projectExactMatchupValues(normalized, teams);
    if (family === 'lineups') return { starters: exact.teams.map(team => ({ externalRosterId: team.externalRosterId, starters: team.starters })) } as JsonValue;
    return { raw: exact.teams.map(team => ({ externalRosterId: team.externalRosterId, rawPoints: team.rawPoints })),
      custom: exact.teams.map(team => ({ externalRosterId: team.externalRosterId, customPoints: team.customPoints })),
      effective: exact.teams.map(team => ({ externalRosterId: team.externalRosterId, effectivePoints: team.effectivePoints })) } as JsonValue;
  }
  // Pure original-observation simulation deliberately has no fabricated accepted SQL receipt/mapping.
  const id = uuid(version.version), timestamp = envelope.provenance.checkedAt;
  const projected = projectTransactionCapture({ captureId: id, captureKind: 'original-observation',
    observationId: id, contentId: uuid(`${version.version}:content`), leagueSeasonId: uuid(`${league.key}:season`),
    week: 7, envelope, contentHash: normalized.contentHash, semanticHash: normalized.semanticHash,
    normalizedValue: normalized.value as JsonValue, accepted: true, outcome: 'simulation', orderingAt: timestamp,
    recordedAt: timestamp, mapping: null, receipt: null, seasonTeams: teams });
  assert.equal(projected.status, 'available', JSON.stringify(projected));
  return { normalized: normalized.value } as JsonValue;
}
function expectation(league: SimulatedCapacityLeague, family: CapacityFamily, version: PayloadVersion): ReaderExpectation {
  return { selector: headSelector(league, family), version: version.version,
    value: JSON.parse(JSON.stringify(projectCapacityFixtureValue(league, family, version))) as ReaderExpectation['value'] };
}
export function createCapacityNativeFixturePrototype(seed = 'cp26-native-simulation-v1') {
  const plan = createCapacityPlan(seed);
  const leagues: SimulatedCapacityLeague[] = plan.leagues.map((planned, index) => ({ key: planned.key,
    nativeLeagueId: `92600000000000000${String(index + 1).padStart(2, '0')}`, season: 2026, nativeWeek: 7, rosterCount: 20,
    cohort: planned.cohort, plannedRegression: planned.regression, regressionWitnessStatus: 'unqualified-simulation',
    leaguePayload: { league_id: `92600000000000000${String(index + 1).padStart(2, '0')}`, season: '2026', sport: 'nfl', status: 'in_season',
      total_rosters: 20, roster_positions: ['QB', 'RB', 'WR', 'TE', 'BN', 'BN', 'BN', 'BN'], scoring_settings: { rec: 0.5 },
      settings: { type: planned.format === 'dynasty' ? 2 : planned.format === 'keeper' ? 1 : 0, leg: 7, reserve_slots: 1, taxi_slots: 1 } } }));
  const events: BoundEvent[] = [], initialReaders: { pairId: string; reader: ReaderExpectation }[] = [];
  const headBindings: { selector: string; binding: ReturnType<typeof capacityFixtureHeadBinding> }[] = [];
  const historyBindings: { selector: string; binding: CapacityReaderBinding }[] = [];
  for (const league of leagues) {
    const histories: Record<Resource, PayloadVersion[]> = { rosters: [], matchups: [], transactions: [] };
    let rosters = initialRosters(), matchups = initialMatchups(), transactions = [transaction(league, 0)];
    for (let ordinal = 0; ordinal <= 20; ordinal++) {
      if (ordinal) { rosters = nextRosters(rosters, ordinal); matchups = nextMatchups(matchups, ordinal); transactions = nextTransactions(league, transactions, ordinal); }
      for (const [resource, payload] of Object.entries({ rosters, matchups, transactions }) as [Resource, JsonObject[]][]) {
        histories[resource].push(payloadVersion(league, resource, ordinal, payload));
      }
    }
    for (const pair of plan.pairs.filter(pair => pair.leagueKey === league.key)) {
      const resource: Resource = pair.family === 'lineups' || pair.family === 'official-scores' ? 'matchups' : pair.family;
      const versions = histories[resource], initial = expectation(league, pair.family, versions[0]);
      initialReaders.push({ pairId: pair.id, reader: initial });
      headBindings.push({ selector: initial.selector, binding: capacityFixtureHeadBinding(league, pair.family) });
      for (const version of versions) historyBindings.push({ selector: historySelector(league, pair.family, version),
        binding: capacityFixtureReaderBinding(league, pair.family, version) });
      const retained: ReaderExpectation[] = [{ ...initial, selector: historySelector(league, pair.family, versions[0]) }];
      for (const planned of plan.events.filter(event => event.pairId === pair.id)) {
        const before = versions[planned.ordinal - 1], after = versions[planned.ordinal];
        let changedFields = capacityChangedNativeFields(JSON.parse(before.utf8), JSON.parse(after.utf8));
        if (pair.family === 'lineups') changedFields = changedFields.filter(path => path.includes('/starters/'));
        if (pair.family === 'official-scores') changedFields = changedFields.filter(path => /\/(?:points|custom_points)$/u.test(path));
        assert(changedFields.length > 0, 'family did not meaningfully change');
        const expectedReader = expectation(league, pair.family, after);
        assert.notEqual(capacityDigest(expectedReader.value), capacityDigest(retained.at(-1)!.value), 'no projected family change');
        events.push({ id: planned.id, before, after, changedFields, expectedReader, retainedHistory: [...retained] });
        retained.push({ ...expectedReader, selector: historySelector(league, pair.family, after) });
      }
    }
  }
  const body = { kind: 'cp26-native-binding-prototype-v1' as const, provenance: 'authored-synthetic-2026-not-live' as const,
    executionReady: false as const, sourceBindingsComplete: false as const, checkpoint26Qualified: false as const,
    plan, leagues, events, initialReaders, readerBindings: { head: headBindings, history: historyBindings }, sourceMap: CAPACITY_NATIVE_SOURCE_MAP, gaps: CAPACITY_FIXTURE_GAPS,
    inventory: { logicalEvents: events.length, activeFamilyPairs: plan.pairs.length, scheduledSamples: plan.samples.length,
      distinctChangedAcquisitions: new Set(events.map(event => event.after.version)).size,
      completeTransportResponseInventory: false as const } };
  return freezeCapacityValue({ ...body, digest: capacityDigest(body) });
}
export type CapacityNativeFixturePrototype = ReturnType<typeof createCapacityNativeFixturePrototype>;
/** Planning slots remain first-acceptance relative; this does not invent run anchors. */
export function capacityPrototypeSampleBindings(prototype: CapacityNativeFixturePrototype) {
  return prototype.plan.samples.map(sample => ({ ...sample, clockAnchor: 'unresolved-real-first-acceptance' as const,
    selectorTemplate: prototype.initialReaders.find(row => row.pairId === sample.pairId)!.reader.selector,
    binding: prototype.readerBindings.head.find(row => row.selector === prototype.initialReaders.find(initial => initial.pairId === sample.pairId)!.reader.selector)!.binding,
    currentReceiptResolution: 'resolve-current-accepted-receipt-at-real-sample-time' as const }));
}
/** Small JSON-safe report for ignored diagnostics; full bytes and history stay in the prototype. */
export function capacityNativeFixtureReport(prototype: CapacityNativeFixturePrototype) {
  return { kind: prototype.kind, digest: prototype.digest, planDigest: prototype.plan.digest,
    provenance: prototype.provenance, executionReady: prototype.executionReady,
    sourceBindingsComplete: prototype.sourceBindingsComplete, checkpoint26Qualified: prototype.checkpoint26Qualified,
    inventory: prototype.inventory, leagues: prototype.leagues.map(({ leaguePayload, ...league }) =>
      ({ ...league, nativeFormatType: (leaguePayload.settings as JsonObject).type })),
    readerBindingCounts: { head: prototype.readerBindings.head.length, history: prototype.readerBindings.history.length },
    eventKinds: Object.fromEntries([...new Set(prototype.plan.events.map(event => event.kind))]
      .map(kind => [kind, prototype.plan.events.filter(event => event.kind === kind).length])),
    sourceMap: prototype.sourceMap, gaps: prototype.gaps };
}
export function assertCapacityNativeFixturePrototype(prototype: CapacityNativeFixturePrototype) {
  assert.deepEqual(prototype, createCapacityNativeFixturePrototype(prototype.plan.seed), 'native prototype drift');
}
export type CapacityFixtureUser = { cohort: 'accepted' | 'intake-a' | 'intake-b' | 'auxiliary'; username: string; nativeManagerId: string; leagueKeys: string[] };
/** Full authored provider inventory; actual mappings, clocks and SQL acceptance are still external. */
export function createCapacityFleetFixture(seed = 'cp26-fleet-simulation-v1') {
  const prototype = structuredClone(createCapacityNativeFixturePrototype(seed));
  const users: CapacityFixtureUser[] = (['accepted', 'intake-a', 'intake-b'] as const).map((cohort, index) => ({
    cohort, username: `cp26_fleet_${cohort.replaceAll('-', '_')}`, nativeManagerId: `927000000000000000${index + 1}`,
    leagueKeys: prototype.plan.leagues.filter(league => league.cohort === cohort).map(league => league.key) }));
  const sourceLeagues: BoundLeague[] = prototype.leagues.map((league, index) => ({ key: league.key, nativeLeagueId: league.nativeLeagueId,
    season: 2026, nativePeriod: '7', nativePeriods: Array.from({ length: 18 }, (_, week) => String(week + 1)), extraPeriodCoverageGaps: [],
    rosterCount: 20, inSeason: true, initiallyPopulated: league.cohort === 'accepted', format: prototype.plan.leagues[index].format,
    regression: league.plannedRegression, sourceEvidenceRef: 'authored-2026-simulation; named-regression-unqualified' }));
  prototype.leagues = prototype.leagues.map(league => ({ ...league, leaguePayload: { ...league.leaguePayload, name: `CP26 authored ${league.key}`, season_type: 'regular',
    scoring_settings: { ...(league.leaguePayload.scoring_settings as JsonObject), pass_int: -3.25, rec: 0.75 },
    settings: { ...(league.leaguePayload.settings as JsonObject), last_scored_leg: 6, playoff_week_start: 15, playoff_teams: 6, playoff_round_type: 1 } } }));
  const patched = new Map<string, PayloadVersion>();
  for (const league of prototype.leagues) {
    const manager = users.find(user => user.cohort === league.cohort)!;
    for (const event of prototype.events.filter(event => event.id.startsWith(league.key + '/rosters/'))) for (const value of [event.before, event.after]) {
      if (patched.has(value.version)) continue;
      const rows = (JSON.parse(value.utf8) as JsonObject[]).map((row, index) => ({ ...row, owner_id: index === 0 ? manager.nativeManagerId : null,
        settings: { wins: 0, losses: 0, ties: 0, fpts: 0, fpts_decimal: 0, waiver_budget_used: 0 } }));
      const utf8 = JSON.stringify(rows); patched.set(value.version, { version: value.version, utf8, sha256: createHash('sha256').update(utf8).digest('hex') });
    }
  }
  for (const event of prototype.events) { event.before = patched.get(event.before.version) ?? event.before; event.after = patched.get(event.after.version) ?? event.after; }
  prototype.readerBindings.history = prototype.readerBindings.history.map(history => ({ ...history, binding: { ...history.binding, sourcePayloadSha256: patched.get(history.binding.sourceVersion)?.sha256 ?? history.binding.sourcePayloadSha256 } }));
  const endpointInventory: CapacityEndpointBinding[] = [];
  const emptyScope: CapacityEndpointBinding['scope'] = { leagueKey: null, nativeLeagueId: null, nativeWeek: null, nativeDraftId: null, nativeManagerId: null, nativePosition: null };
  function add(id: string, resource: CapacityNativeResource, url: string, payload: JsonValue,
    scope: Partial<CapacityEndpointBinding['scope']> = {}, pairIds: string[] = []) {
    const boundScope = { ...emptyScope, ...scope }, requestUtf8 = resource === 'weekly-report'
      ? capacityWeeklyReportRequest(boundScope.nativeLeagueId!, boundScope.nativeWeek!) : null;
    const utf8 = JSON.stringify(payload);
    let versions: CapacityEndpointVersion[] = [{ version: `transport:${id}:v0`, utf8, sha256: createHash('sha256').update(utf8).digest('hex'), eventIds: [], publication: { kind: 'initial' } }];
    if (pairIds.length) {
      const first = prototype.events.find(event => event.id === pairIds[0] + '/event-1')!;
      versions = [{ ...first.before, eventIds: [], publication: { kind: 'initial' } }, ...Array.from({ length: 20 }, (_, ordinal) => {
        const eventIds = pairIds.map(pairId => pairId + '/event-' + (ordinal + 1));
        const event = prototype.events.find(event => event.id === eventIds[0])!;
        return { ...event.after, eventIds, publication: { kind: 'pair-anchor' as const, offsetMs: prototype.plan.events.find(planned => planned.id === event.id)!.offsetMs } };
      })];
    }
    const endpoint: CapacityEndpointBinding = { id, resource, method: resource === 'weekly-report' ? 'POST' : 'GET', url,
      requestUtf8, requestSha256: requestUtf8 === null ? null : createHash('sha256').update(requestUtf8).digest('hex'), scope: boundScope, pairIds, versions };
    endpointInventory.push(endpoint); return endpoint;
  }
  for (const user of users) {
    const identity = { user_id: user.nativeManagerId, username: user.username, display_name: user.username };
    add(`identity:${user.cohort}`, 'identity', 'https://api.sleeper.app/v1/user/' + user.username, identity, { nativeManagerId: user.nativeManagerId });
    add(`identity-native:${user.cohort}`, 'identity', 'https://api.sleeper.app/v1/user/' + user.nativeManagerId, identity, { nativeManagerId: user.nativeManagerId });
    add(`discovery:${user.cohort}`, 'league-list', 'https://api.sleeper.app/v1/user/' + user.nativeManagerId + '/leagues/nfl/2026',
      prototype.leagues.filter(league => user.leagueKeys.includes(league.key)).map(league => league.leaguePayload), { nativeManagerId: user.nativeManagerId });
  }
  for (const league of prototype.leagues) {
    const manager = users.find(user => user.cohort === league.cohort)!, base = 'https://api.sleeper.app/v1/league/' + league.nativeLeagueId;
    const scope = { leagueKey: league.key, nativeLeagueId: league.nativeLeagueId };
    add(league.key + ':league', 'league', base, league.leaguePayload, scope);
    const rosters = JSON.parse(prototype.events.find(event => event.id === league.key + '/rosters/event-1')!.before.utf8) as JsonValue;
    add(league.key + ':rosters', 'rosters', base + '/rosters', rosters, scope, [league.key + '/rosters']);
    add(league.key + ':users', 'users', base + '/users', [{ user_id: manager.nativeManagerId, display_name: manager.username }], scope);
    for (let week = 1; week <= 18; week++) {
      const rows = initialMatchups();
      if (week === 6) { rows[18] = { ...rows[18], matchup_id: null }; rows[19] = { ...rows[19], matchup_id: null };
        rows[1] = { ...rows[1], points: rows[0].points }; rows[0] = { ...rows[0], custom_points: 0 }; }
      add(`${league.key}:matchups:${week}`, 'matchups', base + '/matchups/' + week, rows, { ...scope, nativeWeek: week },
        week === 7 ? [league.key + '/lineups', league.key + '/official-scores'] : []);
      const report = { data: { metadata: { key: league.nativeLeagueId + '_' + week, type: 'league_report', created: 1792108800000,
        last_updated: 1792108800000, data: { week, standings: Array.from({ length: 20 }, (_, index) => ({ roster_id: index + 1,
          round: week, rank: index + 1, wins: 0, losses: 0, ties: 0, points: 40 + index, points_against: 40, record: '', streak: '' })) } } } };
      add(`${league.key}:report:${week}`, 'weekly-report', 'https://sleeper.com/graphql', report, { ...scope, nativeWeek: week });
    }
    for (let week = 0; week <= 18; week++) add(`${league.key}:transactions:${week}`, 'transactions', base + '/transactions/' + week,
      [transaction(league, 0)], { ...scope, nativeWeek: week }, week === 7 ? [league.key + '/transactions'] : []);
    add(league.key + ':winners', 'winners-bracket', base + '/winners_bracket', [{ r: 1, m: 1, t1: 1, t2: 2, w: 1, l: 2 }], scope);
    add(league.key + ':losers', 'losers-bracket', base + '/losers_bracket', [], scope);
    const draftId = league.nativeLeagueId + '01', draft = { draft_id: draftId, league_id: league.nativeLeagueId, season: '2026', sport: 'nfl',
      type: 'snake', status: 'complete', settings: { teams: 20, rounds: 1 }, draft_order: { [manager.nativeManagerId]: 1 },
      slot_to_roster_id: Object.fromEntries(Array.from({ length: 20 }, (_, index) => [String(index + 1), index + 1])) };
    add(league.key + ':drafts', 'draft-catalog', base + '/drafts', [draft], scope);
    add(league.key + ':league-trades', 'league-trades', base + '/traded_picks', [{ season: '2027', round: 1, roster_id: 1, owner_id: 2, previous_owner_id: 1 }], scope);
    const draftBase = 'https://api.sleeper.app/v1/draft/' + draftId, draftScope = { ...scope, nativeDraftId: draftId };
    add(league.key + ':draft-detail', 'draft-detail', draftBase, draft, draftScope);
    add(league.key + ':draft-picks', 'draft-selections', draftBase + '/picks', Array.from({ length: 20 }, (_, index) => ({
      pick_no: index + 1, round: 1, draft_slot: index + 1, roster_id: index + 1, player_id: player(index + 1), picked_by: manager.nativeManagerId,
      is_keeper: index === 0, metadata: null })), draftScope);
    add(league.key + ':draft-trades', 'draft-trades', draftBase + '/traded_picks', [], draftScope);
  }
  const catalog = add('shared:players', 'player-catalog', 'https://api.sleeper.app/v1/players/nfl', Object.fromEntries(Array.from({ length: 22 }, (_, index) => [player(index + 1),
    { player_id: player(index + 1), first_name: 'Authored', last_name: 'Player ' + (index + 1), full_name: 'Authored Player ' + (index + 1),
      position: index < 20 ? ['QB', 'RB', 'WR', 'TE'][index % 4] : index === 20 ? 'K' : 'DEF',
      fantasy_positions: [index < 20 ? ['QB', 'RB', 'WR', 'TE'][index % 4] : index === 20 ? 'K' : 'DEF'], team: 'ARI', status: 'Active', active: true }])));
  const sharedPlayers = JSON.parse(catalog.versions[0].utf8) as Record<string, JsonObject>;
  for (const position of ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'] as const) {
    const subset = Object.fromEntries(Object.entries(sharedPlayers).filter(([, value]) => value.position === position));
    assert(Object.keys(subset).length > 0, 'shared catalog has no source row for position');
    add('shared:players:' + position, 'player-position-catalog', 'https://api.sleeper.app/v1/players/nfl?position=' + position, subset, { nativePosition: position });
  }
  const auxiliary = { ...prototype.leagues[0].leaguePayload, league_id: '9260000000000090001', name: 'CP26 auxiliary predraft', status: 'pre_draft' };
  const predraft = add('auxiliary:predraft', 'league', 'https://api.sleeper.app/v1/league/' + auxiliary.league_id, auxiliary, { nativeLeagueId: String(auxiliary.league_id) });
  const excessive = { ...auxiliary, league_id: '9260000000000090002', status: 'in_season', total_rosters: 21 };
  const capacity = add('auxiliary:excess', 'league', 'https://api.sleeper.app/v1/league/' + excessive.league_id, excessive, { nativeLeagueId: excessive.league_id });
  const overlap: CapacityFixtureUser = { cohort: 'auxiliary', username: 'cp26_fleet_overlap', nativeManagerId: '9270000000000090001', leagueKeys: ['league-01', 'league-02'] };
  users.push(overlap);
  add('identity:overlap', 'identity', 'https://api.sleeper.app/v1/user/' + overlap.username, { user_id: overlap.nativeManagerId, username: overlap.username }, { nativeManagerId: overlap.nativeManagerId });
  const discovery = add('discovery:overlap', 'league-list', 'https://api.sleeper.app/v1/user/' + overlap.nativeManagerId + '/leagues/nfl/2026',
    prototype.leagues.slice(0, 2).map(league => league.leaguePayload), { nativeManagerId: overlap.nativeManagerId });
  const basisPath = 'lib/league-administration/normalize.ts';
  const basis = { path: basisPath, sha256: createHash('sha256').update(readFileSync(new URL('../' + basisPath, import.meta.url))).digest('hex') };
  const witness = (scenario: CapacityFormatScenario, rows: { endpoint: CapacityEndpointBinding; pointers: string[] }[], unsupported: string[] = [], scope: 'fleet' | 'auxiliary' = 'fleet'): CapacityFormatWitness => ({
    kind: 'cp26-format-source-witness-v1', scenario, provenance: { kind: 'authored-synthetic-2026', basis: [basis] }, scope,
    coverage: unsupported.length ? 'native-shape-with-derived-gap' : 'explicit-native-fields', bindings: rows.map(({ endpoint, pointers }) => {
      const value = endpoint.versions[0], fields = pointers.map(pointer => ({ pointer, value: capacityPointer(JSON.parse(value.utf8), pointer) }));
      return { endpointId: endpoint.id, version: value.version, payloadSha256: value.sha256, fields,
        expectedReader: capacityFormatReaderExpectation(endpoint), unsupported };
    }) });
  const week6 = endpointInventory.find(row => row.id === 'league-01:matchups:6')!, leagueEndpoint = endpointInventory.find(row => row.id === 'league-01:league')!;
  const formatWitnesses: Record<CapacityFormatScenario, CapacityFormatWitness> = {
    byes: witness('byes', [{ endpoint: week6, pointers: ['/18/matchup_id', '/19/matchup_id'] }], ['Unpaired source rows do not establish an official bye.']),
    ties: witness('ties', [{ endpoint: week6, pointers: ['/0/points', '/1/points'] }], ['Equal native totals do not establish an official tie or finality.']),
    'custom-zero': witness('custom-zero', [{ endpoint: week6, pointers: ['/0/custom_points', '/0/points'] }]),
    'unusual-scoring': witness('unusual-scoring', [{ endpoint: leagueEndpoint, pointers: ['/scoring_settings/rec', '/scoring_settings/pass_int'] }], ['Fixture source preservation is not derived scorer coverage.']),
    'pre-draft-incomplete': witness('pre-draft-incomplete', [{ endpoint: predraft, pointers: ['/status', '/total_rosters'] }], ['Auxiliary predraft source is outside the sixteen active pairs and has no accepted runtime witness.'], 'auxiliary'),
    'multiweek-legs': witness('multiweek-legs', [{ endpoint: leagueEndpoint, pointers: ['/settings/playoff_round_type', '/settings/playoff_week_start'] }], ['Native round settings do not establish an aggregate multiweek winner.']),
    'overlap-deduplication': witness('overlap-deduplication', [{ endpoint: discovery, pointers: ['/0/league_id', '/1/league_id'] }, { endpoint: endpointInventory.find(row => row.id === 'discovery:accepted')!, pointers: ['/0/league_id', '/1/league_id'] }], ['Shared native IDs require actual SQL identity/deduplication proof.'], 'auxiliary'),
    'excess-capacity': witness('excess-capacity', [{ endpoint: capacity, pointers: ['/total_rosters'] }], ['Twenty-one-roster admission rejection remains an actual runtime proof obligation.'], 'auxiliary'),
  };
  prototype.digest = capacityDigest(Object.fromEntries(Object.entries(prototype).filter(([key]) => key !== 'digest')));
  assertCapacityEndpointInventory(prototype.plan, sourceLeagues, prototype.events, endpointInventory, formatWitnesses);
  const body = { kind: 'cp26-fleet-native-inventory-v1' as const, provenance: 'authored-synthetic-2026-not-live' as const,
    prototype, sourceLeagues, users, endpointInventory, formatWitnesses, executionReady: false as const, checkpoint26Qualified: false as const,
    gaps: ['Named League One/Two/Dynasty regressions remain unqualified.', 'Synthetic format fields are not actual SQL/elapsed/native-source qualification.',
      'Current source mappings, accepted receipts and real observation clocks must be resolved by the stored observer.', 'Shared-owner coexistence, daily/15-minute cadence and full elapsed fleet qualification remain open.'] };
  return freezeCapacityValue({ ...body, digest: capacityDigest(body) });
}
export type CapacityFleetFixture = ReturnType<typeof createCapacityFleetFixture>;

/** Exact existing normalizer output, with unsupported aggregate-reader bindings kept explicit. */
export function capacityFormatReaderExpectation(endpoint: CapacityEndpointBinding): CapacityFormatWitness['bindings'][number]['expectedReader'] {
  if (endpoint.resource !== 'league' && endpoint.resource !== 'matchups') return { api: 'readPublicSleeperIntake', status: 'not-executed', value: null };
  const result = normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1', dialect: 'sleeper-nfl-v1',
    scope: { leagueKey: 'cp26-format-simulation', provider: 'sleeper', externalLeagueId: endpoint.scope.nativeLeagueId!, season: 2026 },
    family: endpoint.resource, week: endpoint.scope.nativeWeek, completeness: 'complete',
    provenance: { origin: 'bootstrap', requestStartedAt: null, requestCompletedAt: null, sourceObservedAt: null, checkedAt: '2026-10-16T00:00:00.000Z' },
    payload: JSON.parse(endpoint.versions[0].utf8) });
  return { api: 'normalizeAdministrationObservation', status: 'offline-normalized', value: JSON.parse(JSON.stringify(result)) };
}

export type CapacityNamedCapture = { family: 'league' | 'rosters' | 'matchups' | 'winners_bracket' | 'losers_bracket'; week: number | null;
  payload: JsonValue; requestStartedAt: string; requestCompletedAt: string; sourceObservedAt: string; origin: 'network' };
export type CapacityNamedSourceFixture = { kind: 'cp26-retained-named-source-slices-v1'; provenance: 'retained-provider-2026-not-current-observation'; season: 2026;
  extraction: { algorithm: string; fields: Record<'league' | 'rosters' | 'matchups', string[]>; brackets: 'unchanged'; documentMetadata: 'unchanged'; namedKeys: string[] };
  collections: { source: { relativeManifest: string; manifestSha256: string; kind: string; sourceGitSha: string; season: 2026; startedAt: string };
    samples: { key: 'league1' | 'league2' | 'dynasty'; nativeLeagueId: string; resources: { original: { relativeFile: string; rawFileSha256: string;
      rawFileBytes: number; serializedDocumentSha256: string; payloadSha256: string; manifestResource: { family: string; week: number | null;
        serializedDocumentSha256: string; serializedDocumentBytes: number; requestStartedAt: string; requestCompletedAt: string; sourceObservedAt: string } };
      document: CapacityNamedCapture; sliceSha256: string; slicePayloadSha256: string }[] }[] }[];
  executionReady: false; checkpoint26Qualified: false; gaps: string[] };
export const CAPACITY_NAMED_SOURCE_SHA256 = '6d816511eb669004ca9e5afc6a5d7ea15c07881ee2c0d34d2452bfbdfa560d2b';
/** Original CP13 provider observations, kept separate from authored fleet identities and replay clocks. */
export function loadCapacityNamedSourceFixture(): CapacityNamedSourceFixture {
  const bytes = readFileSync(new URL('../test-support/fixtures/cp26-named-source-2026.json', import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), CAPACITY_NAMED_SOURCE_SHA256, 'retained named source file drift');
  const fixture = JSON.parse(bytes.toString('utf8')) as CapacityNamedSourceFixture;
  assert.equal(fixture.kind, 'cp26-retained-named-source-slices-v1'); assert.equal(fixture.season, 2026);
  assert.equal(fixture.provenance, 'retained-provider-2026-not-current-observation'); assert.equal(fixture.executionReady, false); assert.equal(fixture.checkpoint26Qualified, false);
  assert.equal(fixture.collections.length, 2);
  const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  for (const collection of fixture.collections) {
    assert.equal(collection.source.season, 2026); assert.match(collection.source.sourceGitSha, /^[a-f0-9]{40}$/u);
    assert.match(collection.source.manifestSha256, /^[a-f0-9]{64}$/u);
    assert.deepEqual(collection.samples.map(sample => sample.key).sort(), ['dynasty', 'league1', 'league2']);
    for (const sample of collection.samples) {
      assert.match(sample.nativeLeagueId, /^[1-9][0-9]{0,31}$/u); assert.equal(sample.resources.length, 5);
      for (const resource of sample.resources) {
        const { document, original } = resource;
        assert.equal(digest(document), resource.sliceSha256); assert.equal(digest(document.payload), resource.slicePayloadSha256);
        assert.equal(original.rawFileSha256, original.manifestResource.serializedDocumentSha256);
        assert.equal(original.rawFileBytes, original.manifestResource.serializedDocumentBytes);
        assert.equal(document.family, original.manifestResource.family); assert.equal(document.week, original.manifestResource.week);
        assert.equal(document.origin, 'network');
        for (const field of ['requestStartedAt', 'requestCompletedAt', 'sourceObservedAt'] as const) {
          assert.equal(document[field], original.manifestResource[field]); assert(Number.isFinite(Date.parse(document[field])));
        }
        assert(Date.parse(document.requestStartedAt) <= Date.parse(document.sourceObservedAt));
        assert.equal(document.requestCompletedAt, document.sourceObservedAt);
        if (document.family === 'league') { const raw = document.payload as JsonObject;
          assert.equal(raw.league_id, sample.nativeLeagueId); assert.equal(raw.season, '2026');
          assert(Object.keys(raw).every(key => fixture.extraction.fields.league.includes(key))); }
        if (document.family === 'rosters' || document.family === 'matchups') {
          assert(Array.isArray(document.payload));
          for (const row of document.payload as JsonObject[]) assert(Object.keys(row).every(key => fixture.extraction.fields[document.family as 'rosters' | 'matchups'].includes(key)));
        }
        if (document.family === 'winners_bracket' || document.family === 'losers_bracket') assert.equal(resource.slicePayloadSha256, original.payloadSha256, 'bracket body changed');
      }
    }
  }
  return freezeCapacityValue(fixture);
}
