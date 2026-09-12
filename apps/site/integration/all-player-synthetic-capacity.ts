import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ProjectionStore } from '../lib/projection-store';
import type { AllPlayerBatchInput, ResolvedScoringEntity } from '../lib/projections/adapters/neon/contracts';
import type { AllPlayerStatEntry, AllPlayerStatObservation } from '../lib/projections/domain/all-player-statistics';
import { allPlayerStatSemanticHash } from '../lib/projections/adapters/neon/all-player-statistics';
import { stableJson } from '../lib/projections/shared/stable-json';
import { readAllPlayerPhysicalMeasurement } from './all-player-capacity-measurement';
import { ownerQuery } from './neon-integration-harness';

export type SyntheticCompleteCapacityInput = Readonly<{
  store: ProjectionStore;
  baseObservation: AllPlayerStatObservation;
  prepareBatch: (observation: AllPlayerStatObservation) => Promise<AllPlayerBatchInput>;
  addResolvedIdentities: (references: readonly ResolvedScoringEntity[]) => void;
  /** Shared profiles use a separately registered synthetic period because
   * league-season profile identity is immutable. */
  setSharedProfile: (shared: boolean) => Promise<void>;
  transportSnapshot: () => Readonly<Record<string, number>>;
}>;

type Counts = Readonly<Record<string, number>>;
type Physical = Awaited<ReturnType<typeof readAllPlayerPhysicalMeasurement>>;

const COUNT_COLUMNS = [
  'contents', 'entries', 'observations', 'score_sets', 'scores', 'verifications',
  'entities', 'aliases', 'official_observations', 'official_player_points', 'official_roster_points',
] as const;

async function readCounts(): Promise<Counts> {
  const rows = await ownerQuery(`SELECT
    (SELECT count(*) FROM all_player_stat_contents)::text AS contents,
    (SELECT count(*) FROM all_player_stat_entries)::text AS entries,
    (SELECT count(*) FROM all_player_stat_observations)::text AS observations,
    (SELECT count(*) FROM all_player_score_sets)::text AS score_sets,
    (SELECT count(*) FROM all_player_scores)::text AS scores,
    (SELECT count(*) FROM all_player_score_verifications)::text AS verifications,
    (SELECT count(*) FROM scoring_entities)::text AS entities,
    (SELECT count(*) FROM external_scoring_entity_ids)::text AS aliases,
    (SELECT count(*) FROM league_week_observations)::text AS official_observations,
    (SELECT count(*) FROM official_player_point_observations)::text AS official_player_points,
    (SELECT count(*) FROM official_roster_point_observations)::text AS official_roster_points`);
  return Object.fromEntries(COUNT_COLUMNS.map((key) => {
    const value = Number(rows[0]?.[key]);
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid capacity count: ${key}`);
    return [key, value];
  }));
}

function numericDelta(before: Readonly<Record<string, number>>, after: Readonly<Record<string, number>>) {
  return Object.fromEntries([...new Set([...Object.keys(before), ...Object.keys(after)])]
    .map((key) => [key, (after[key] ?? 0) - (before[key] ?? 0)]));
}

function physicalDelta(before: Physical, after: Physical): ReadonlyArray<
  Readonly<{ relation: string } & Record<'heap_bytes' | 'index_bytes' | 'toast_heap_bytes' | 'toast_index_bytes' | 'total_bytes', number>>
> {
  const old = new Map(before.map((row) => [String(row.relname), row]));
  return after.map((row) => ({
    relation: String(row.relname),
    ...Object.fromEntries(['heap_bytes', 'index_bytes', 'toast_heap_bytes', 'toast_index_bytes', 'total_bytes']
      .map((key) => [key, Number(row[key]) - Number(old.get(String(row.relname))?.[key] ?? 0)])) as
      Record<'heap_bytes' | 'index_bytes' | 'toast_heap_bytes' | 'toast_index_bytes' | 'total_bytes', number>,
  }));
}

function fingerprint(value: unknown) {
  return `sha256:${createHash('sha256').update(stableJson(value)).digest('hex')}`;
}

function scopedObservation(source: AllPlayerStatObservation, entries: readonly AllPlayerStatEntry[]): AllPlayerStatObservation {
  const previous = source.coverage.periodInventoryEvidence;
  if (!previous || typeof previous !== 'object' || Array.isArray(previous)) {
    throw new Error('Synthetic capacity requires the existing explicit period inventory fixture.');
  }
  const players = entries.filter((entry) => entry.entityKind === 'player');
  const hasWeeklyRow = (entry: AllPlayerStatEntry) => entry.eligibilityEvidence.kind === 'weekly-stat';
  const present = entries.filter(hasWeeklyRow).length;
  return {
    ...source, entries,
    coverage: {
      ...source.coverage,
      expectedInventoryFingerprint: fingerprint(entries.map((entry) => ({
        entityKind: entry.entityKind, providerExternalId: entry.providerExternalId,
        nflTeam: entry.nflTeam, position: entry.position,
      }))),
      catalogRevision: 'synthetic-capacity-4385-catalog-v1',
      periodInventoryEvidence: { ...previous, source: 'manual-review',
        sourceRevision: 'synthetic-capacity-period-inventory-v1',
        teamsByPlayerId: Object.fromEntries(players.map((entry) => [entry.providerExternalId, entry.nflTeam])),
      },
      expectedEntityCount: entries.length, fantasyEntityCount: entries.length,
      expectedPlayerCount: players.length, expectedTeamDefenseCount: entries.length - players.length,
      providerPresentEntityCount: present, providerMissingEntityCount: entries.length - present,
      responseEntityCount: present, excludedResponseEntityCount: 0, unexpectedResponseEntityCount: 0,
      unknownEligibilityCount: entries.filter((entry) => entry.eligibleGameCount === null
        || entry.appearanceGameCount === null).length,
      unmappedGameCount: entries.filter((entry) => entry.eligibleGameCount === 1 && !entry.nflGameId).length,
    },
  };
}

/** Only called by the existing identity-guarded isolated integration case.
 * There is no provider fetch, new ingestion path, lease bypass, or automatic
 * test discovery in this module. All source data below is explicitly synthetic. */
export async function runSyntheticCompleteCapacity(input: SyntheticCompleteCapacityInput) {
  const overallStarted = performance.now();
  if (input.baseObservation.entries.length !== 34 || input.baseObservation.quality !== 'complete') {
    throw new Error('Synthetic capacity requires the existing complete 34-entry base fixture.');
  }
  const game = input.baseObservation.entries.find((entry) => entry.nflTeam === 'NE'
    && entry.nflGameId && entry.gamePhase === 'final');
  const quarterback = input.baseObservation.entries.find((entry) => entry.position === 'QB');
  if (!game?.nflGameId || !quarterback || !Number.isFinite(quarterback.stats.pass_td)) {
    throw new Error('Synthetic capacity requires its final NE game and quarterback arithmetic fixture.');
  }
  const epoch = Date.parse(input.baseObservation.observedAt);
  if (!Number.isFinite(epoch)) throw new Error('Synthetic capacity observation time is invalid.');
  const at = (source: AllPlayerStatObservation, label: string, halfDays: number): AllPlayerStatObservation => {
    const observedAt = new Date(epoch + halfDays * 43_200_000).toISOString();
    return { ...source, sourceRevision: `synthetic-capacity:${label}`,
      observedAt, requestStartedAt: new Date(Date.parse(observedAt) - 1_000).toISOString(),
      requestCompletedAt: observedAt };
  };
  const extra = (index: number): AllPlayerStatEntry => ({
    entityKind: 'player', providerExternalId: `synthetic-capacity-player-${String(index).padStart(5, '0')}`,
    nflGameId: game.nflGameId, nflTeam: 'NE', position: 'WR',
    stats: { gms_active: 1, gp: 0 }, eligibleGameCount: 1, appearanceGameCount: 0, gamePhase: 'final',
    eligibilityEvidence: { kind: 'weekly-stat', source: 'weekly-stat-provider', gmsActive: 1, appearances: 0 },
  });
  const extras = Array.from({ length: 4351 }, (_, index) => extra(index));
  const scenarios: Record<string, unknown>[] = [];
  const snapshot = async () => ({ physical: await readAllPlayerPhysicalMeasurement(),
    counts: await readCounts(), transport: input.transportSnapshot() });
  const initial = await snapshot();
  const register = async (entries: readonly AllPlayerStatEntry[], label: string) => {
    const before = await snapshot();
    const started = performance.now();
    const result = await input.store.upsertScoringEntities(entries.map((entry) => ({
      key: entry.providerExternalId, kind: 'player', displayName: entry.providerExternalId,
      nflTeam: 'NE', providerIds: [{ provider: 'sleeper', externalId: entry.providerExternalId }],
    })));
    if (result.kind !== 'stored' || result.value.length !== entries.length
      || result.value.some((reference) => reference.conflict || !reference.entityId)) {
      throw new Error('Synthetic capacity identity registration failed.');
    }
    input.addResolvedIdentities(result.value);
    const wallTimeMs = performance.now() - started;
    const after = await snapshot();
    scenarios.push({ scenario: label, classification: 'synthetic ancillary identity registration',
      identityCount: entries.length, before, after, wallTimeMs,
      physicalDelta: physicalDelta(before.physical, after.physical),
      countDelta: numericDelta(before.counts, after.counts),
      transportDelta: numericDelta(before.transport, after.transport) });
  };
  type Written = { batch: AllPlayerBatchInput; result: Extract<Awaited<ReturnType<ProjectionStore['recordAllPlayerBatch']>>, { kind: 'stored' }>['value']; wallTimeMs: number };
  const write = async (source: AllPlayerStatObservation): Promise<Written> => {
    const started = performance.now();
    // This is the existing full scorer/parity/writer preparation. The callback
    // may remap to the separate shared-profile synthetic season; report exactly
    // the prepared observation that the real writer receives.
    const batch = await input.prepareBatch(source);
    const result = await input.store.recordAllPlayerBatch(batch);
    if (result.kind !== 'stored') throw new Error('Synthetic capacity writer is disabled.');
    return { batch, result: result.value, wallTimeMs: performance.now() - started };
  };
  const measure = async (label: string, source: AllPlayerStatObservation, expectedProfiles: number) => {
    const before = await snapshot();
    const written = await write(source);
    const after = await snapshot();
    if (written.result.entryCount !== source.entries.length || written.result.scoreSets.length !== expectedProfiles) {
      throw new Error('Synthetic capacity writer returned an incomplete coordinated profile group.');
    }
    scenarios.push({ scenario: label, classification: 'synthetic complete inventory; never actual 2026 completion',
      period: { season: written.batch.observation.season, seasonType: written.batch.observation.seasonType,
        week: written.batch.observation.week }, observedAt: written.batch.observation.observedAt,
      entryCount: written.batch.observation.entries.length, scoringProfileCount: expectedProfiles,
      materialHash: allPlayerStatSemanticHash(written.batch.observation), before, after,
      physicalDelta: physicalDelta(before.physical, after.physical),
      countDelta: numericDelta(before.counts, after.counts),
      transportDelta: numericDelta(before.transport, after.transport),
      wallTimeMs: written.wallTimeMs, exceeds55SecondLease: written.wallTimeMs >= 55_000,
      writer: written.result });
    return { ...written, before, after };
  };
  const assertReuse = (value: Awaited<ReturnType<typeof measure>>) => {
    if (value.result.entriesStored !== 0 || value.after.counts.entries !== value.before.counts.entries
      || value.after.counts.contents !== value.before.counts.contents
      || value.after.counts.scores !== value.before.counts.scores
      || value.after.counts.score_sets !== value.before.counts.score_sets) {
      throw new Error('Unchanged synthetic retrieval copied raw entries or scores.');
    }
  };
  try {
    await input.setSharedProfile(false);
    await register(extras, 'register-4351-synthetic-identities');
    const first = at(scopedObservation(input.baseObservation, [...input.baseObservation.entries, ...extras]), '4385-divergent-first', 0);
    await measure('4385-divergent-complete-first', first, 2);
    const replay = await measure('4385-divergent-exact-replay', first, 2);
    assertReuse(replay);
    const unchanged = await measure('4385-divergent-later-unchanged', at(first, 'unchanged-1', 1), 2);
    assertReuse(unchanged);

    const repeatBefore = await snapshot();
    const repeatWrites: Record<string, unknown>[] = [];
    for (let index = 0; index < 20; index += 1) {
      const written = await write(at(first, `unchanged-amortized-${index + 1}`, index + 2));
      if (written.result.entriesStored !== 0 || written.result.scoreSets.length !== 2) {
        throw new Error('Repeated unchanged synthetic retrieval copied raw rows or lost a profile.');
      }
      repeatWrites.push({ observedAt: written.batch.observation.observedAt,
        wallTimeMs: written.wallTimeMs, exceeds55SecondLease: written.wallTimeMs >= 55_000,
        writer: written.result });
    }
    const repeatAfter = await snapshot();
    const repeatCounts = numericDelta(repeatBefore.counts, repeatAfter.counts);
    if (repeatCounts.contents !== 0 || repeatCounts.entries !== 0 || repeatCounts.score_sets !== 0
      || repeatCounts.scores !== 0 || repeatCounts.observations !== 20 || repeatCounts.verifications !== 40) {
      throw new Error('Twenty unchanged retrievals did not retain exactly twenty observations and forty verifications without row copies.');
    }
    const growth = physicalDelta(repeatBefore.physical, repeatAfter.physical);
    scenarios.push({ scenario: '4385-divergent-twenty-unchanged-retrievals',
      classification: 'synthetic amortized page growth; logical times twelve hours apart; no live polling',
      retrievalCount: 20, before: repeatBefore, after: repeatAfter, countDelta: repeatCounts,
      physicalDelta: growth, amortizedTotalPhysicalBytesPerRetrieval: growth
        .reduce((total, row) => total + Number(row.total_bytes), 0) / 20,
      transportDelta: numericDelta(repeatBefore.transport, repeatAfter.transport), writes: repeatWrites });

    const corrected = scopedObservation(first, first.entries.map((entry) => entry.providerExternalId === quarterback.providerExternalId
      ? { ...entry, stats: { ...entry.stats, pass_td: entry.stats.pass_td + 1 } } : entry));
    await measure('4385-divergent-stat-correction', at(corrected, 'stat-correction', 22), 2);
    const eligibility = scopedObservation(corrected, corrected.entries.map((entry) => entry.providerExternalId === extras[0].providerExternalId
      ? { ...entry, stats: { ...entry.stats, gp: 1 }, appearanceGameCount: 1,
        eligibilityEvidence: { kind: 'weekly-stat', source: 'weekly-stat-provider', gmsActive: 1, appearances: 1 } } : entry));
    await measure('4385-divergent-eligibility-correction', at(eligibility, 'eligibility-correction', 23), 2);

    const beforeShared = await snapshot();
    await input.setSharedProfile(true);
    const afterShared = await snapshot();
    scenarios.push({ scenario: 'register-separate-shared-profile-period',
      classification: 'synthetic structural comparison in separate period; immutable league-season profile preserved',
      before: beforeShared, after: afterShared, physicalDelta: physicalDelta(beforeShared.physical, afterShared.physical),
      countDelta: numericDelta(beforeShared.counts, afterShared.counts),
      transportDelta: numericDelta(beforeShared.transport, afterShared.transport) });
    await measure('4385-shared-profile-separate-period', at(eligibility, 'shared-profile', 24), 1);
    const added = extra(4351);
    await register([added], 'register-one-additional-synthetic-identity');
    await measure('4386-shared-profile-identity-addition',
      at(scopedObservation(eligibility, [...eligibility.entries, added]), 'identity-addition', 25), 1);
  } finally {
    await input.setSharedProfile(false);
  }
  const final = await snapshot();
  const report = {
    kind: 'synthetic-complete-capacity-measurement', generatedAt: new Date().toISOString(),
    classification: 'SYNTHETIC 4385 entries (34 base plus4351 zero-point NE WRs), then4386; not legitimate completed2026 evidence',
    liveProviderRequests: 0, providerInboundBytes: 0, initial, final, scenarios,
    wallTimeMs: performance.now() - overallStarted,
    parityScope: 'Two synthetic official player rows per league: four parity-player rows per retrieval. Actual league roster parity overhead is not measured by this benchmark.',
    transferScope: 'SQL text, parameter JSON and decoded result JSON counters supplied by guarded harness. PostgreSQL/WebSocket/TLS framing, connection startup, owner measurement queries and Neon-billed egress are excluded.',
    storageScope: 'Physical table/index/TOAST sizes and exact counts; page allocation is reported separately from twenty-retrieval amortized growth. Zero page growth in one retrieval does not imply zero marginal storage.',
    limitations: ['No actual completed-week eligibility proof', 'No production provider requests or budget simulation',
      'Separate synthetic periods compare divergent versus shared profiles', 'Synthetic parity population smaller than real league rosters',
      'No Neon compute usage measurement', 'No ordinary-workload reserve or full-season fit claim'],
  };
  const artifactPath = resolve(process.cwd(), 'release/011-capacity.synthetic.integration.json');
  await mkdir(resolve(process.cwd(), 'release'), { recursive: true });
  await writeFile(artifactPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({ kind: report.kind, artifactPath, scenarios: scenarios.length,
    syntheticEntryCount: 4385, unchangedRetrievalCount: 20, liveProviderRequests: 0,
    wallTimeMs: report.wallTimeMs })}\n`);
  return report;
}
