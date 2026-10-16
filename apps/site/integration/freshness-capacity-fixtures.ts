import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { normalizeAdministrationObservation } from '../lib/league-administration/normalize';
import type { AdministrationEnvelope, JsonObject, JsonValue } from '../lib/league-administration/contracts';
import { projectExactMatchupValues } from '../lib/aggregator/exact-matchup-values';
import { rosterCategoryEvidence } from '../lib/aggregator/roster-player-links';
import { projectTransactionCapture } from '../lib/aggregator/transaction-activity';
import { capacityDigest, createCapacityPlan, freezeCapacityValue, type BoundEvent, type CapacityFamily,
  type PayloadVersion, type ReaderExpectation } from './freshness-capacity-manifest';

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