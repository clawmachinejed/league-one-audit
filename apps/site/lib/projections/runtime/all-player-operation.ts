import 'server-only';

import { createHash } from 'node:crypto';
import type { PlayerCatalog, SleeperMatchup } from '../../transform';
import {
  buildSleeperAllPlayerInventory,
  sleeperOfficialRosteredPoints,
  type SleeperAllPlayerStatRequest,
  type SleeperAllPlayerStatResult,
  type SleeperPeriodInventoryEvidence,
} from '../adapters/sleeper/all-player-stats';
import {
  SLEEPER_ALL_PLAYER_SCORING_RULE_KEYS,
  type SleeperScoringProfileNormalization,
} from '../adapters/sleeper/scoring-profile';
import {
  deterministicUuid,
  rulesHash,
} from '../adapters/neon/database-values';
import type {
  AllPlayerBatchInput,
  AllPlayerJobFence,
  AllPlayerIdentityLookup,
  ProjectionStore,
  StoredAllPlayerIdentityMapping,
} from '../adapters/neon/contracts';
import { prepareAllPlayerBatch } from '../adapters/neon/all-player-statistics';
import { prepareLeagueWeekObservation } from '../adapters/neon/observations';
import {
  buildAllPlayerScoreSets,
  type AllPlayerIdentity,
  type AllPlayerScoreSet,
  type AllPlayerScoringProfile,
  type AllPlayerStatEntry,
  type AllPlayerStatObservation,
  type AllPlayerPeriodParticipationEvidence,
} from '../domain/all-player-statistics';
import type {
  LeagueConfiguration,
  LeaguePeriod,
  LeagueWeekState,
  NflTeam,
  NflWeekSchedule,
  ProjectionSlate,
  ScoringEntity,
  SourceScoringSettings,
} from '../domain/contracts';
import type { ClockPort } from '../ports/clock';
import type { IdGeneratorPort } from '../ports/id-generator';
import type { LeagueRegistryPort } from '../ports/league-registry';
import type { ProjectionLoggerPort } from '../ports/logger';
import type { ProjectionRepositoryPort } from '../ports/projection-repository';
import {
  externalPlayerRef,
  externalReferenceKey,
  externalTeamDefenseRef,
  providerKey,
  type ProviderKey,
} from '../shared/provider-identity';
import { stableJson } from '../shared/stable-json';
import type { FullSlateProjectionCoverage } from '../worker/contracts';
import { analyzeFullSlateProjectionCoverage } from '../worker/provider-stage';
import { projectionEntities, projectionEntityForObservation } from '../worker/roster-context';
import { officialPlayerIdentityInventory } from '../shared/official-catalog-identity';
import { validateAllPlayerPublicationCoverage } from '../domain/all-player-publication-coverage';
import { prepareAllPlayerDiagnostics } from './all-player-diagnostics';

export const ALL_PLAYER_SCORER_VERSION = 'sleeper-actual-v1';
export const ALL_PLAYER_CADENCE_HOURS = 12;
export const ALL_PLAYER_CADENCE_MS = ALL_PLAYER_CADENCE_HOURS * 60 * 60 * 1_000;
const ALL_PLAYER_LEASE_SECONDS = 55;
export const ALL_PLAYER_EXECUTION_MS = 50_000;

export type AllPlayerIngestionMode = 'shadow' | 'backfill' | 'recurring';

export type AllPlayerLeagueLoad = Readonly<{
  state: LeagueWeekState;
  rawMatchups: readonly SleeperMatchup[];
  expectedRosterIds: readonly (string | number)[];
  starterSlots: readonly string[];
}>;

type AllPlayerStore = Pick<ProjectionStore,
  | 'enabled'
  | 'readLeagueLineupAuthorities'
  | 'readAllPlayerLeagueProfiles'
  | 'readAllPlayerIdentityMappings'
  | 'readAllPlayerGameContext'
  | 'upsertScoringEntities'
  | 'recordLeagueWeekObservation'
  | 'recordAllPlayerBatch'
  | 'acquireAllPlayerJob'
  | 'markAllPlayerRequest'
  | 'finishAllPlayerJob'
  | 'recordAllPlayerPreclaimOutcome'
  | 'readAllPlayerJobState'
  | 'validateAllPlayerJobFence'
>;

export type AllPlayerIngestionDependencies = Readonly<{
  store: AllPlayerStore;
  projectionRepository: Pick<ProjectionRepositoryPort, 'readCurrentProjectionSlate'>;
  leagueRegistry: LeagueRegistryPort;
  loadLeagueWeek: (
    configuration: LeagueConfiguration,
    period: LeaguePeriod,
  ) => Promise<AllPlayerLeagueLoad>;
  loadCatalog: () => Promise<Readonly<{
    catalog: PlayerCatalog;
    complete: boolean;
    sourceRevision: string | null;
  }>>;
  loadReviewedPeriodEvidence?: (period: LeaguePeriod) => Promise<Readonly<{
    inventory: SleeperPeriodInventoryEvidence;
    eligibilityByPlayerId?: Readonly<Record<string, AllPlayerPeriodParticipationEvidence>>;
    scheduleRevision?: string;
    scheduleObservedAt?: string;
  }> | null>;
  allPlayerSource: Readonly<{
    /** Replay adapters never issue an upstream request. Missing means live. */
    access?: 'live' | 'replay';
    load: (input: SleeperAllPlayerStatRequest) => Promise<SleeperAllPlayerStatResult>;
  }>;
  normalizeScoringProfile: (
    source: SourceScoringSettings,
  ) => SleeperScoringProfileNormalization;
  officialProvider: ProviderKey;
  projectionProvider: ProviderKey;
  gameStateProvider: ProviderKey;
  clock: ClockPort;
  idGenerator: IdGeneratorPort;
  logger: ProjectionLoggerPort;
  signal?: AbortSignal;
  deadlineAt?: string;
  cleanupStore?: Pick<AllPlayerStore, 'finishAllPlayerJob' | 'recordAllPlayerPreclaimOutcome'>;
}>;

export type AllPlayerIngestionResult =
  | Readonly<{ status: 'disabled'; mode: AllPlayerIngestionMode }>
  | Readonly<{
      status: 'skipped';
      mode: AllPlayerIngestionMode;
      reason: 'busy' | 'completed' | 'not-due';
      period?: LeaguePeriod;
    }>
  | Readonly<{
      status: 'unavailable';
      mode: AllPlayerIngestionMode;
      reason: string;
      period?: LeaguePeriod;
      sourceRevision?: string;
      projectionCoverage?: FullSlateProjectionCoverage;
      persistedObservation?: boolean;
      statObservationId?: string;
      stage?: string;
      diagnostics?: readonly string[];
      diagnosticCount?: number;
      confirmedPublication?: Readonly<{
        statObservationId: string | null;
        pointerOutcomes: readonly string[];
        entryCount: number;
        scoringProfileCount: number;
      }>;
    }>
  | Readonly<{
      status: 'completed';
      mode: AllPlayerIngestionMode;
      period: LeaguePeriod;
      sourceRevision: string;
      entryCount: number;
      scoringProfileCount: number;
      parityComparisonCount: number;
      parityMismatchCount: 0;
      eligibleGameCount: number;
      activeZeroCount: number;
      projectionCoverage: FullSlateProjectionCoverage;
      warnings: readonly string[];
      persisted: boolean;
      statObservationId: string | null;
      pointerOutcomes: readonly string[];
    }>;

type LoadedLeague = AllPlayerLeagueLoad & Readonly<{
  configuration: LeagueConfiguration;
  scoringProfileId: string;
  leagueSeasonId: string;
  rawRules: Readonly<Record<string, unknown>>;
  official: Extract<ReturnType<typeof sleeperOfficialRosteredPoints>, { status: 'available' }>;
}>;

function hash(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

function fingerprint(value: unknown): string {
  return `sha256:${hash(value)}`;
}

function samePeriod(left: LeaguePeriod, right: LeaguePeriod): boolean {
  return left.season === right.season
    && left.seasonType === right.seasonType
    && left.week === right.week;
}

function assertPeriod(period: LeaguePeriod): void {
  if (!Number.isInteger(period.season) || period.season < 2026 || period.season > 2200
    || period.seasonType !== 'regular'
    || !Number.isInteger(period.week) || period.week < 1 || period.week > 18) {
    throw new Error('All-player ingestion requires a 2026+ regular-season week.');
  }
}

export function allPlayerCadenceSlot(now: Date): string {
  const timestamp = now.getTime();
  if (!Number.isFinite(timestamp)) throw new Error('All-player cadence time is invalid.');
  return new Date(Math.floor(timestamp / ALL_PLAYER_CADENCE_MS) * ALL_PLAYER_CADENCE_MS)
    .toISOString();
}

function unavailable(
  mode: AllPlayerIngestionMode,
  period: LeaguePeriod,
  reason: string,
  evidence: Readonly<{
    sourceRevision?: string;
    projectionCoverage?: FullSlateProjectionCoverage;
    persistedObservation?: boolean;
    statObservationId?: string;
    stage?: string;
    diagnostics?: readonly string[];
    confirmedPublication?: Extract<AllPlayerIngestionResult, { status: 'unavailable' }>['confirmedPublication'];
  }> = {},
): AllPlayerIngestionResult {
  return { status: 'unavailable', mode, period, reason, ...evidence,
    ...(evidence.diagnostics ? prepareAllPlayerDiagnostics(evidence.diagnostics) : {}),
  };
}

function scheduleFor(leagues: readonly AllPlayerLeagueLoad[]): NflWeekSchedule {
  const first = leagues[0]?.state.schedule;
  if (!first || leagues.some((league) => stableJson(league.state.schedule) !== stableJson(first))) {
    throw new Error('Canonical leagues did not provide one shared NFL schedule.');
  }
  return first;
}

function rosteredPlayerIds(leagues: readonly AllPlayerLeagueLoad[]): string[] {
  return [...new Set(leagues.flatMap((league) => [
    ...projectionEntities(league.state).map((entity) => String(entity.externalRef.externalId)),
    ...league.rawMatchups.flatMap((row) => [
      ...(Array.isArray(row.players) ? row.players : []),
      ...(Array.isArray(row.starters) ? row.starters.filter((id) => id !== '0') : []),
    ]),
  ]))].sort();
}

function identityLookupKey(input: AllPlayerIdentityLookup): string {
  return `${input.provider.trim().toLowerCase()}\0${input.entityKind}\0${input.externalId.trim()}`;
}

function providerIdentityKey(input: AllPlayerIdentityLookup): string {
  const provider = providerKey(input.provider);
  const reference = input.entityKind === 'team_defense'
    ? externalTeamDefenseRef(provider, input.externalId)
    : externalPlayerRef(provider, input.externalId);
  return externalReferenceKey(reference);
}

function proposedEntityId(input: AllPlayerIdentityLookup): string {
  return deterministicUuid(
    `scoring-entity:${input.entityKind}`,
    `${input.entityKind}:${input.externalId}`,
  );
}

type IdentityLookup = AllPlayerIdentityLookup & Readonly<{
  requirement: 'required-official' | 'catalog-inventory' | 'optional-projection';
}>;

class AllPlayerPreflightError extends Error {
  constructor(reason: string, readonly diagnostics: readonly string[]) { super(reason); }
}

function plannedIdentities(
  inputs: readonly IdentityLookup[],
  mappings: readonly StoredAllPlayerIdentityMapping[],
  officialProvider: ProviderKey,
  now: Date,
): Readonly<{
  byReference: ReadonlyMap<string, string>;
  unusableOfficialIdentities: readonly string[];
  unusableReferenceKeys: ReadonlySet<string>;
  diagnostics: readonly string[];
}> {
  const mappingByKey = new Map(mappings.map((mapping) => [identityLookupKey(mapping), mapping]));
  if (mappingByKey.size !== mappings.length || mappingByKey.size !== inputs.length) {
    throw new Error('identity-mapping-inspection-invalid');
  }
  const planned = new Map<string, string>();
  const unusableOfficialIdentities: string[] = [];
  const unusableReferenceKeys = new Set<string>();
  const diagnostics: string[] = [];
  const officialByCanonical = new Map<string, string>();
  for (const input of inputs) {
    const mapping = mappingByKey.get(identityLookupKey(input));
    if (!mapping) throw new Error('Identity mapping inspection was incomplete.');
    const storedMappingExists = mapping.scoringEntityId !== null
      || mapping.mappedEntityKind !== null
      || mapping.mappingStatus != null || mapping.validTo != null || mapping.validFrom != null;
    const validFrom = mapping.validFrom == null ? -Infinity : Date.parse(mapping.validFrom);
    const validTo = mapping.validTo === null ? Infinity : Date.parse(mapping.validTo);
    const storedMappingUsable = mapping.scoringEntityId !== null
      && mapping.mappedEntityKind === input.entityKind
      && mapping.mappingStatus === 'verified'
      && validFrom <= now.getTime() && validTo > now.getTime();
    if (storedMappingExists && !storedMappingUsable
      || !storedMappingExists && input.requirement === 'optional-projection') {
      if (input.requirement === 'required-official') {
        unusableOfficialIdentities.push(input.externalId);
      }
      unusableReferenceKeys.add(providerIdentityKey(input));
      diagnostics.push(`${input.provider}/${input.externalId}:${input.requirement}:mapping-unusable`);
      continue;
    }
    const scoringEntityId = mapping.scoringEntityId
      ?? (input.provider === String(officialProvider) && input.requirement !== 'optional-projection'
        ? proposedEntityId(input) : null);
    if (scoringEntityId && input.provider === String(officialProvider)
      && input.requirement !== 'optional-projection') {
      const previous = officialByCanonical.get(scoringEntityId);
      if (previous && previous !== identityLookupKey(input)) {
        throw new AllPlayerPreflightError('distinct-official-identities-collapse', [
          `${previous.replace(/\0/gu, '/')}:canonical-conflict`,
          `${input.provider}/${input.entityKind}/${input.externalId}:${input.requirement}:canonical-conflict`,
        ]);
      }
      officialByCanonical.set(scoringEntityId, identityLookupKey(input));
    }
    if (scoringEntityId) planned.set(providerIdentityKey(input), scoringEntityId);
  }
  return {
    byReference: planned,
    unusableOfficialIdentities: [...new Set(unusableOfficialIdentities)].sort(),
    unusableReferenceKeys,
    diagnostics: diagnostics.sort(),
  };
}

function identityLookups(
  inventory: Extract<ReturnType<typeof buildSleeperAllPlayerInventory>, { status: 'available' }>['inventory'],
  projectionSlate: ProjectionSlate,
  officialProvider: ProviderKey,
): IdentityLookup[] {
  const values = new Map<string, IdentityLookup>();
  const add = (value: IdentityLookup) => {
    const previous = values.get(identityLookupKey(value));
    if (!previous || previous.requirement === 'optional-projection') values.set(identityLookupKey(value), value);
  };
  for (const entity of inventory.entities) {
    add({
      provider: String(officialProvider),
      entityKind: entity.entityKind,
      externalId: entity.providerExternalId,
      requirement: entity.requirement ?? 'catalog-inventory',
    });
  }
  for (const projection of projectionSlate.projections) {
    for (const reference of [projection.identity.primary, ...projection.identity.aliases]) {
      add({
        provider: String(reference.provider),
        entityKind: reference.entityKind === 'team-defense' ? 'team_defense' : 'player',
        externalId: String(reference.externalId),
        requirement: 'optional-projection',
      });
    }
  }
  return [...values.values()].sort((left, right) => (
    identityLookupKey(left).localeCompare(identityLookupKey(right))
  ));
}

function projectionPlayerIds(
  slate: ProjectionSlate,
  officialProvider: ProviderKey,
  officialInventory: readonly ScoringEntity[],
): string[] {
  return [...new Set(slate.projections.flatMap((projection) => {
    const entity = projectionEntityForObservation(projection, officialProvider, officialInventory);
    return entity?.kind === 'player' ? [String(entity.externalRef.externalId)] : [];
  }))].sort();
}

function gamesByTeam(
  schedule: NflWeekSchedule,
  games: Awaited<ReturnType<AllPlayerStore['readAllPlayerGameContext']>>,
): Readonly<Record<string, Readonly<{ nflGameId: string; phase: 'live' | 'final' | 'unknown' }>>> {
  const result: Record<string, { nflGameId: string; phase: 'live' | 'final' | 'unknown' }> = {};
  for (const [teamValue, week] of Object.entries(schedule)) {
    if (week?.kind !== 'scheduled') continue;
    const team = teamValue as NflTeam;
    const matches = games.filter((game) => (
      (game.homeTeam === team && game.awayTeam === week.opponent)
      || (game.awayTeam === team && game.homeTeam === week.opponent)
    ));
    if (matches.length !== 1) throw new Error('A scheduled team lacks one canonical NFL game.');
    result[team] = { nflGameId: matches[0].nflGameId, phase: matches[0].phase };
  }
  return result;
}

function addProjectionEvidence(
  observation: AllPlayerStatObservation,
  coverage: FullSlateProjectionCoverage,
  diagnostics: readonly string[],
): AllPlayerStatObservation {
  return {
    ...observation,
    coverage: {
      ...observation.coverage,
      allPlayerProjectionSetComplete: coverage.identityComplete,
      projectionIdentityComplete: coverage.identityComplete,
      projectionRankEligibleEntityCount: coverage.rankEligibleProjectionCount,
      projectionResolvedIdentityCount: coverage.resolvedIdentityCount,
      projectionSkippedIdentityCount: coverage.skippedIdentityCount,
      rankUnavailablePositions: coverage.rankUnavailablePositions,
      identityDiagnostics: diagnostics,
    },
    warnings: [...new Set([...observation.warnings, ...coverage.warnings])].sort(),
  };
}

function officialPlayerInputs(
  league: LoadedLeague,
  observation: AllPlayerStatObservation,
) {
  const entityByExternalId = new Map(observation.entries.map((entry) => [
    entry.providerExternalId,
    entry,
  ]));
  const playerPoints = league.rawMatchups.flatMap((row) => {
    if (!Array.isArray(row.players) || !row.players_points) {
      throw new Error('Official roster point rows are incomplete.');
    }
    const starters = Array.isArray(row.starters) ? row.starters : [];
    return row.players.map((externalId) => {
      const entry = entityByExternalId.get(externalId);
      const points = row.players_points?.[externalId];
      if (!entry || typeof points !== 'number' || !Number.isFinite(points)) {
        throw new Error('Official roster point identity or value is unavailable.');
      }
      const starterIndex = starters.indexOf(externalId);
      return {
        sleeperPlayerId: externalId,
        entityKind: entry.entityKind,
        externalRosterId: String(row.roster_id),
        points,
        isStarter: starterIndex >= 0,
        lineupSlot: starterIndex >= 0 ? league.starterSlots[starterIndex] ?? null : null,
      };
    });
  });
  const rosterPoints = league.rawMatchups.map((row) => {
    const points = typeof row.custom_points === 'number' ? row.custom_points : row.points;
    if (typeof points !== 'number' || !Number.isFinite(points)) {
      throw new Error('Official roster total is unavailable.');
    }
    return { externalRosterId: String(row.roster_id), points };
  });
  if (new Set(playerPoints.map((row) => row.sleeperPlayerId)).size !== playerPoints.length
    || new Set(rosterPoints.map((row) => row.externalRosterId)).size !== rosterPoints.length) {
    throw new Error('official-observation-duplicate-identity');
  }
  return { playerPoints, rosterPoints };
}

function shadowObservationId(
  leagueKey: string,
  leagueSourceRevision: string,
  allPlayerSourceRevision: string,
): string {
  return deterministicUuid(
    'all-player-shadow-parity-observation',
    `${leagueKey}\0${leagueSourceRevision}\0${allPlayerSourceRevision}`,
  );
}

function scoringProfiles(
  leagues: readonly LoadedLeague[],
  observationIds: ReadonlyMap<string, string>,
): AllPlayerScoringProfile[] {
  const grouped = new Map<string, AllPlayerScoringProfile>();
  for (const league of leagues) {
    const observationId = observationIds.get(league.configuration.key);
    if (!observationId) throw new Error('Official parity observation identity is unavailable.');
    const batch = {
      observationId,
      rosterCount: league.official.rosterCount,
      rosterIds: league.official.rosterIds,
      entityCount: league.official.entityCount,
      fingerprint: league.official.fingerprint,
      points: league.official.points,
    };
    const current = grouped.get(league.scoringProfileId);
    if (current && stableJson(current.rawRules) !== stableJson(league.rawRules)) {
      throw new Error('One scoring profile has conflicting source rules.');
    }
    grouped.set(league.scoringProfileId, {
      scoringProfileId: league.scoringProfileId,
      rawRules: league.rawRules,
      officialBatches: [...(current?.officialBatches ?? []), batch],
    });
  }
  return [...grouped.values()].sort((left, right) => (
    left.scoringProfileId.localeCompare(right.scoringProfileId)
  ));
}

function completedEvidence(
  mode: AllPlayerIngestionMode,
  period: LeaguePeriod,
  observation: AllPlayerStatObservation,
  scoreSets: readonly AllPlayerScoreSet[],
  projectionCoverage: FullSlateProjectionCoverage,
) {
  return {
    status: 'completed' as const,
    mode,
    period,
    sourceRevision: observation.sourceRevision,
    entryCount: observation.entries.length,
    scoringProfileCount: scoreSets.length,
    parityComparisonCount: scoreSets.reduce(
      (total, scoreSet) => total + scoreSet.parityComparisonCount,
      0,
    ),
    parityMismatchCount: 0 as const,
    eligibleGameCount: scoreSets[0]?.eligibleGameCount ?? 0,
    activeZeroCount: observation.entries.filter((entry) => (
      entry.eligibleGameCount === 1 && entry.appearanceGameCount === 0
    )).length,
    projectionCoverage,
    warnings: observation.warnings,
  };
}

function officialObservationInput(league: LoadedLeague, observation: AllPlayerStatObservation): Parameters<AllPlayerStore['recordLeagueWeekObservation']>[0] {
  const officialInputs = officialPlayerInputs(league, observation);
  const sourceRevision = `sha256:${hash({
    kind: 'all-player-parity-v1',
    leagueSourceRevision: league.state.sourceRevision,
    allPlayerSourceRevision: observation.sourceRevision,
    officialFingerprint: league.official.fingerprint,
  })}`;
  return {
    leagueSeasonId: league.leagueSeasonId,
    week: observation.week,
    sourceRevision,
    lineupRevisionVersion: league.state.lineup.revisionVersion,
    lineupRevision: league.state.lineup.lineupRevision,
    requestStartedAt: league.state.requestStartedAt,
    requestCompletedAt: league.state.requestCompletedAt,
    observedAt: league.state.observedAt,
    quality: 'complete',
    sourceData: {
      source: 'sleeper-matchups-players-points',
      complete: true,
      allPlayerSourceRevision: observation.sourceRevision,
      officialPlayersPointsEvidence: {
        version: 'players-points-v1',
        expectedEntityCount: league.official.entityCount,
        expectedRosterCount: league.official.rosterCount,
        expectedRosterIds: league.official.rosterIds,
        fingerprint: league.official.fingerprint,
      },
    },
    expectedTank01GameIds: [],
    ...officialInputs,
  };
}

async function persistOfficialObservations(
  store: AllPlayerStore,
  leagues: readonly LoadedLeague[],
  observation: AllPlayerStatObservation,
  checkpoint: (stage: string, write?: boolean) => Promise<void>,
): Promise<ReadonlyMap<string, string>> {
  const results = new Map<string, string>();
  for (const league of leagues) {
    await checkpoint(`official-observation-${league.configuration.key}`, true);
    const result = await store.recordLeagueWeekObservation(officialObservationInput(league, observation));
    if (result.kind !== 'stored'
      || result.value.playerPointsStored !== league.official.entityCount
      || result.value.rosterPointsStored !== league.official.rosterCount
      || result.value.unmappedSleeperPlayerIds.length > 0
      || result.value.unmappedTank01GameIds.length > 0) {
      throw new Error('Official all-player parity observation was not stored completely.');
    }
    results.set(league.configuration.key, result.value.observationId);
  }
  return results;
}

async function execute(
  dependencies: AllPlayerIngestionDependencies,
  input: Readonly<{
    mode: AllPlayerIngestionMode;
    period: LeaguePeriod;
    requireFinalCoverage?: boolean;
    fence?: AllPlayerJobFence;
    checkpoint: (stage: string, write?: boolean) => Promise<void>;
  }>,
): Promise<AllPlayerIngestionResult> {
  const { mode, period } = input;
  await input.checkpoint('source-context');
  const configurations = dependencies.leagueRegistry.listActiveLeagues();
  if (configurations.length !== 2) return unavailable(mode, period, 'league-inventory');
  const [leagueLoads, catalog, projectionSlate, gameContext, reviewedEvidence] = await Promise.all([
    Promise.all(configurations.map(async (configuration) => ({
      configuration,
      ...await dependencies.loadLeagueWeek(configuration, period),
    }))),
    dependencies.loadCatalog(),
    dependencies.projectionRepository.readCurrentProjectionSlate(
      dependencies.projectionProvider,
      period,
    ),
    dependencies.store.readAllPlayerGameContext({
      season: period.season,
      seasonType: 'reg',
      week: period.week,
      gameStateProvider: String(dependencies.gameStateProvider),
    }),
    dependencies.loadReviewedPeriodEvidence?.(period) ?? Promise.resolve(null),
  ]);
  if (!catalog.complete || !catalog.sourceRevision) {
    return unavailable(mode, period, 'catalog-incomplete');
  }
  if (!projectionSlate || projectionSlate.slate.quality !== 'complete'
    || !samePeriod(projectionSlate.slate.period, period)) {
    return unavailable(mode, period, 'projection-slate-incomplete');
  }
  if (leagueLoads.some((league) => !samePeriod(league.state.period, period))) {
    return unavailable(mode, period, 'league-period-mismatch');
  }
  await input.checkpoint('inventory');
  const schedule = scheduleFor(leagueLoads);
  const scheduleRevision = fingerprint(schedule);
  if (reviewedEvidence?.scheduleRevision && reviewedEvidence.scheduleRevision !== scheduleRevision) {
    return unavailable(mode, period, 'reviewed-schedule-evidence-conflict');
  }
  const games = gamesByTeam(schedule, gameContext);
  const officialInventory = officialPlayerIdentityInventory(catalog.catalog, dependencies.officialProvider);
  const projectionIds = projectionPlayerIds(projectionSlate.slate, dependencies.officialProvider, officialInventory);
  const inventoryResult = buildSleeperAllPlayerInventory({
    period: { ...period, seasonType: 'reg' },
    observedAt: dependencies.clock.now().toISOString(),
    periodInventoryEvidence: reviewedEvidence?.inventory,
    periodEligibilityEvidenceByPlayerId: reviewedEvidence?.eligibilityByPlayerId,
    ...(reviewedEvidence?.scheduleRevision === scheduleRevision && reviewedEvidence.scheduleObservedAt
      ? { scheduleObservedAt: reviewedEvidence.scheduleObservedAt } : {}),
    catalog: catalog.catalog,
    catalogComplete: catalog.complete,
    catalogRevision: catalog.sourceRevision,
    rosteredPlayerIds: rosteredPlayerIds(leagueLoads),
    projectionPlayerIds: projectionIds,
    gamesByTeam: games,
    byeTeamIds: Object.entries(schedule).flatMap(([team, value]) => (
      value?.kind === 'bye' ? [team] : []
    )),
    scheduleRevision,
  });
  if (inventoryResult.status !== 'available') {
    return unavailable(mode, period, `inventory-${inventoryResult.reason}`, {
      ...(inventoryResult.diagnostics ? { diagnostics: inventoryResult.diagnostics } : {}),
    });
  }
  const lookups = identityLookups(
    inventoryResult.inventory,
    projectionSlate.slate,
    dependencies.officialProvider,
  );
  const mappingRows = await dependencies.store.readAllPlayerIdentityMappings(lookups);
  const identityPlan = plannedIdentities(
    lookups,
    mappingRows,
    dependencies.officialProvider,
    dependencies.clock.now(),
  );
  const identityDiagnostics = [...identityPlan.diagnostics];
  const unusableReferences = new Set(identityPlan.unusableReferenceKeys);
  for (const projection of projectionSlate.slate.projections) {
    const official = projectionEntityForObservation(projection, dependencies.officialProvider, officialInventory);
    const target = official && identityPlan.byReference.get(externalReferenceKey(official.externalRef));
    for (const reference of [projection.identity.primary, ...projection.identity.aliases]) {
      const key = externalReferenceKey(reference);
      const mapped = identityPlan.byReference.get(key);
      if (!official || target && mapped && target !== mapped) {
        unusableReferences.add(key);
        identityDiagnostics.push(`${reference.provider}/${reference.externalId}:optional-projection:${official
          ? 'canonical-conflict' : 'official-identity-unresolved'}`);
      }
    }
  }
  const projectionCoverage = analyzeFullSlateProjectionCoverage(
    projectionSlate.slate,
    dependencies.officialProvider,
    identityPlan.byReference,
    officialInventory,
    unusableReferences,
  );
  if (identityPlan.unusableOfficialIdentities.length > 0) {
    return unavailable(mode, period, 'identity-mapping-unusable', {
      projectionCoverage, diagnostics: identityDiagnostics.sort(),
    });
  }
  const normalized = leagueLoads.map((league) => ({
    ...league,
    normalization: dependencies.normalizeScoringProfile(league.state.scoringSettings),
  }));
  await input.checkpoint('profiles-and-official-points');
  if (normalized.some((league) => league.normalization.status !== 'available')) {
    return unavailable(mode, period, 'unsupported-scoring', {
      projectionCoverage,
    });
  }
  const profileInputs = normalized.map((league) => {
    const value = league.normalization as Extract<SleeperScoringProfileNormalization, { status: 'available' }>;
    const supported = new Set<string>(SLEEPER_ALL_PLAYER_SCORING_RULE_KEYS);
    if (Object.entries(value.profile.provenance.rawRules).some(([key, weight]) => (
      typeof weight !== 'number' || !Number.isFinite(weight) || (weight !== 0 && !supported.has(key))
    ))) throw new Error('unsupported-active-scoring-rule');
    return {
      leagueKey: league.configuration.key,
      externalLeagueId: String(league.configuration.leagueRef.externalId),
      rulesHash: rulesHash(value.profile.provenance.rawRules),
    };
  });
  const storedProfiles = await dependencies.store.readAllPlayerLeagueProfiles({
    season: period.season,
    provider: String(dependencies.officialProvider),
    leagues: profileInputs,
  });
  if (storedProfiles.length !== normalized.length) {
    return unavailable(mode, period, 'scoring-profile-inventory', {
      projectionCoverage,
    });
  }
  const profileByLeague = new Map(storedProfiles.map((profile) => [profile.leagueKey, profile]));
  const loaded: LoadedLeague[] = [];
  for (const league of normalized) {
    const profile = profileByLeague.get(league.configuration.key);
    const value = league.normalization as Extract<SleeperScoringProfileNormalization, { status: 'available' }>;
    const official = sleeperOfficialRosteredPoints(
      league.rawMatchups,
      league.expectedRosterIds,
    );
    if (!profile || profile.rulesHash !== rulesHash(value.profile.provenance.rawRules)
      || stableJson(profile.rules) !== stableJson(value.profile.provenance.rawRules)
      || official.status !== 'available') {
      return unavailable(mode, period, 'official-parity-incomplete', {
          projectionCoverage,
      });
    }
    loaded.push({
      ...league,
      scoringProfileId: profile.scoringProfileId,
      leagueSeasonId: profile.leagueSeasonId,
      rawRules: value.profile.provenance.rawRules,
      official,
    });
  }

  await input.checkpoint('weekly-stat-request');
  if (mode !== 'shadow' && (!input.fence || !await dependencies.store.markAllPlayerRequest({
    fence: input.fence, period: { ...period, seasonType: 'reg' },
  }))) return unavailable(mode, period, 'request-budget-unavailable');
  const providerResult = await dependencies.allPlayerSource.load({
    season: period.season,
    week: period.week,
    inventory: inventoryResult.inventory,
    gamesByTeam: games,
    requireFinalCoverage: input.requireFinalCoverage ?? mode !== 'recurring',
    signal: dependencies.signal,
  });
  if (providerResult.status !== 'available') {
    return unavailable(mode, period, `provider-${providerResult.reason}`, { projectionCoverage });
  }
  const observation = addProjectionEvidence(providerResult.observation, projectionCoverage, [...new Set(identityDiagnostics)].sort());
  await input.checkpoint('loaded-preflight');
  if (observation.provider !== String(dependencies.officialProvider)
    || observation.season !== period.season || observation.seasonType !== 'reg' || observation.week !== period.week) {
    return unavailable(mode, period, 'observation-period-mismatch', { projectionCoverage });
  }
  const expectedEntries = new Map(inventoryResult.inventory.entities.map((entry) => [entry.providerExternalId, entry]));
  const mismatchedEntries = observation.entries.filter((entry) => {
    const expected = expectedEntries.get(entry.providerExternalId);
    return !expected || expected.entityKind !== entry.entityKind || expected.position !== entry.position
      || expected.nflTeam !== entry.nflTeam
      || (entry.nflTeam ? games[entry.nflTeam]?.nflGameId ?? null : null) !== entry.nflGameId
      || (entry.nflTeam && games[entry.nflTeam] && games[entry.nflTeam].phase !== entry.gamePhase);
  }).map((entry) => entry.providerExternalId);
  const observedIds = new Set(observation.entries.map((entry) => entry.providerExternalId));
  const missingEntries = [...expectedEntries.keys()].filter((id) => !observedIds.has(id));
  const sourceEvidence = inventoryResult.inventory.sourceEvidence;
  const expectedProvenance: Readonly<Record<string, unknown>> = {
    catalogRevision: sourceEvidence.catalogRevision,
    scheduleRevision: sourceEvidence.scheduleRevision,
    periodInventoryEvidence: sourceEvidence.periodInventoryEvidence ?? null,
    rosterInventoryFingerprint: fingerprint(sourceEvidence.rosteredPlayerIds),
    projectionInventoryFingerprint: fingerprint(sourceEvidence.projectionPlayerIds),
    byeInventoryFingerprint: fingerprint(sourceEvidence.byeTeamIds),
    catalogRoleDiagnostics: sourceEvidence.catalogRoleDiagnostics ?? {},
    unresolvedOptionalProjectionIds: sourceEvidence.unresolvedOptionalProjectionIds ?? [],
    mode: (input.requireFinalCoverage ?? mode !== 'recurring') ? 'completed-backfill' : 'recurring-current-week',
  };
  const provenanceConflicts = Object.entries(expectedProvenance).filter(([key, expected]) => (
    stableJson(observation.coverage[key] ?? null) !== stableJson(expected)
  )).map(([key]) => key);
  const eligibilityProvenanceConflicts = observation.entries.filter((entry) => {
    const expected = expectedEntries.get(entry.providerExternalId);
    if (!expected) return false;
    const evidence = entry.eligibilityEvidence;
    if (expected.periodEligibilityEvidence || evidence.kind === 'period-participation') {
      if (!expected.periodEligibilityEvidence || evidence.kind !== 'period-participation') return true;
      const { weekly: _loadedWeekly, ...loadedPeriod } = evidence;
      const { weekly: _expectedWeekly, ...expectedPeriod } = expected.periodEligibilityEvidence;
      void _loadedWeekly;
      void _expectedWeekly;
      return stableJson(loadedPeriod) !== stableJson(expectedPeriod);
    }
    const actualIneligibility = evidence.kind === 'explicit-ineligible' ? evidence
      : evidence.kind === 'combined-ineligible' || evidence.kind === 'conflict' ? evidence.ineligibility : null;
    return stableJson(actualIneligibility) !== stableJson(expected.absentIneligibilityEvidence)
      || evidence.kind === 'missing-provider-row' && evidence.inventoryFingerprint !== inventoryResult.inventory.fingerprint;
  }).map((entry) => entry.providerExternalId);
  if (mismatchedEntries.length || missingEntries.length
    || observation.coverage.expectedInventoryFingerprint !== inventoryResult.inventory.fingerprint
    || observation.coverage.periodInventoryComplete !== Boolean(reviewedEvidence)) {
    return unavailable(mode, period, 'observation-inventory-mismatch', { projectionCoverage,
      diagnostics: [...mismatchedEntries.map((id) => `sleeper/${id}:inventory-context-conflict`),
        ...missingEntries.map((id) => `sleeper/${id}:inventory-row-missing`)],
    });
  }
  if (provenanceConflicts.length || eligibilityProvenanceConflicts.length) {
    return unavailable(mode, period, 'observation-provenance-mismatch', {
      projectionCoverage, diagnostics: [
        ...provenanceConflicts.map((key) => `coverage/${key}:source-provenance-conflict`),
        ...eligibilityProvenanceConflicts.map((id) => `sleeper/${id}:eligibility-provenance-conflict`),
      ],
    });
  }
  const coverageFailures = validateAllPlayerPublicationCoverage(observation, {
    requireFinalCoverage: input.requireFinalCoverage ?? mode !== 'recurring',
  });
  if (coverageFailures.length) return unavailable(mode, period, 'observation-coverage-invalid', {
    projectionCoverage, diagnostics: coverageFailures,
  });
  if (observation.quality !== 'complete' || observation.coverage.complete !== true) {
    prepareAllPlayerBatch({ observation, scoreSets: [], verifiedAt: dependencies.clock.now().toISOString() });
    if (mode !== 'shadow'
      && observation.quality === 'partial'
      && observation.coverage.complete === false) {
      await input.checkpoint('partial-persistence', true);
      const stored = await dependencies.store.recordAllPlayerBatch({
        fence: input.fence,
        observation,
        scoreSets: [],
        verifiedAt: dependencies.clock.now().toISOString(),
      });
      if (stored.kind !== 'stored'
        || stored.value.entryCount !== observation.entries.length
        || stored.value.scoreSets.length !== 0) {
        return unavailable(mode, period, 'partial-observation-persistence-incomplete', {
          sourceRevision: observation.sourceRevision,
          projectionCoverage,
        });
      }
      return unavailable(mode, period, 'provider-coverage-incomplete', {
        sourceRevision: observation.sourceRevision,
        projectionCoverage,
        persistedObservation: true,
        statObservationId: stored.value.statObservationId,
      });
    }
    return unavailable(mode, period, 'provider-coverage-incomplete', {
      sourceRevision: observation.sourceRevision,
      projectionCoverage,
    });
  }

  const entryIds = new Map(observation.entries.map((entry) => {
    const lookup: AllPlayerIdentityLookup = {
      provider: String(dependencies.officialProvider),
      entityKind: entry.entityKind,
      externalId: entry.providerExternalId,
    };
    return [entry.providerExternalId, identityPlan.byReference.get(providerIdentityKey(lookup)) ?? null];
  }));
  const preliminaryObservationIds = new Map(loaded.map((league) => [
    league.configuration.key,
    shadowObservationId(
      league.configuration.key,
      league.state.sourceRevision,
      observation.sourceRevision,
    ),
  ]));
  const expectedProfileIds = [...new Set(loaded.map((league) => league.scoringProfileId))].sort();
  const shadow = await buildAllPlayerScoreSets({
      observation,
      profiles: scoringProfiles(loaded, preliminaryObservationIds),
      expectedScoringProfileIds: expectedProfileIds,
      scorerVersion: ALL_PLAYER_SCORER_VERSION,
      supportedRuleKeys: SLEEPER_ALL_PLAYER_SCORING_RULE_KEYS,
      resolveIdentity: (entry): AllPlayerIdentity => ({
        scoringEntityId: entryIds.get(entry.providerExternalId) ?? null,
        conflict: false,
      }),
  });
  if (shadow.status !== 'available') {
      return unavailable(mode, period, `score-${shadow.reason}`, {
        sourceRevision: observation.sourceRevision,
        projectionCoverage,
        diagnostics: shadow.details,
      });
  }
  // Official observation UUIDs are database-assigned. Validate their complete
  // planned shape and every arithmetic/serializer input before creating them.
  for (const league of loaded) prepareLeagueWeekObservation(officialObservationInput(league, observation));
  prepareAllPlayerBatch({
    observation, scoreSets: shadow.scoreSets, verifiedAt: dependencies.clock.now().toISOString(),
  });
  if (mode === 'shadow') {
    return {
      ...completedEvidence(mode, period, observation, shadow.scoreSets, projectionCoverage),
      persisted: false,
      statObservationId: null,
      pointerOutcomes: [],
    };
  }

  await input.checkpoint('identity-persistence', true);
  const identityWrites = await dependencies.store.upsertScoringEntities(
    observation.entries.map((entry) => {
      const catalogPlayer = catalog.catalog[entry.providerExternalId];
      const displayName = entry.entityKind === 'team_defense'
        ? `${entry.providerExternalId} D/ST`
        : catalogPlayer?.full_name?.trim()
          || [catalogPlayer?.first_name, catalogPlayer?.last_name].filter(Boolean).join(' ').trim()
          || entry.providerExternalId;
      return {
        key: `${entry.entityKind}:${entry.providerExternalId}`,
        kind: entry.entityKind,
        displayName,
        nflTeam: entry.nflTeam,
        preserveExistingMetadata: true,
        providerIds: [{
          provider: String(dependencies.officialProvider),
          externalId: entry.providerExternalId,
        }],
      };
    }),
  );
  if (identityWrites.kind !== 'stored' || identityWrites.value.length !== observation.entries.length
    || identityWrites.value.some((identity) => identity.conflict || !identity.entityId)) {
    return unavailable(mode, period, 'identity-write-incomplete', {
      sourceRevision: observation.sourceRevision,
      projectionCoverage,
    });
  }
  const actualEntityIds = new Map(identityWrites.value.map((identity) => [
    identity.key.replace(/^(?:player|team_defense):/u, ''),
    identity.entityId,
  ]));
  if (observation.entries.some((entry) => (
    actualEntityIds.get(entry.providerExternalId) !== entryIds.get(entry.providerExternalId)
  ))) {
    return unavailable(mode, period, 'identity-plan-conflict', {
      sourceRevision: observation.sourceRevision,
      projectionCoverage,
    });
  }
  await input.checkpoint('official-observation-persistence', true);
  const officialObservationIds = await persistOfficialObservations(
    dependencies.store,
    loaded,
    observation,
    input.checkpoint,
  );
  const built = await buildAllPlayerScoreSets({
    observation,
    profiles: scoringProfiles(loaded, officialObservationIds),
    expectedScoringProfileIds: expectedProfileIds,
    scorerVersion: ALL_PLAYER_SCORER_VERSION,
    supportedRuleKeys: SLEEPER_ALL_PLAYER_SCORING_RULE_KEYS,
    resolveIdentity: (entry) => ({
      scoringEntityId: actualEntityIds.get(entry.providerExternalId) ?? null,
      conflict: false,
    }),
  });
  if (built.status !== 'available') {
    return unavailable(mode, period, `final-${built.reason}`, {
      sourceRevision: observation.sourceRevision,
      projectionCoverage,
    });
  }
  const batch: AllPlayerBatchInput = {
    fence: input.fence,
    observation,
    scoreSets: built.scoreSets,
    verifiedAt: dependencies.clock.now().toISOString(),
  };
  await input.checkpoint('publication', true);
  const stored = await dependencies.store.recordAllPlayerBatch(batch);
  if (stored.kind !== 'stored'
    || stored.value.entryCount !== observation.entries.length
    || stored.value.scoreSets.length !== built.scoreSets.length) {
    return unavailable(mode, period, 'batch-persistence-incomplete', {
      sourceRevision: observation.sourceRevision,
      projectionCoverage,
    });
  }
  if (stored.value.scoreSets.some((scoreSet) => scoreSet.pointerOutcome === 'superseded')) {
    const rejectedGroup = stored.value.scoreSets.every((scoreSet) => scoreSet.pointerOutcome === 'superseded');
    return unavailable(mode, period, rejectedGroup ? 'old-observation-rejected' : 'profile-publication-inconsistent', {
      sourceRevision: observation.sourceRevision, projectionCoverage,
      persistedObservation: true, statObservationId: stored.value.statObservationId,
      ...(!rejectedGroup ? { confirmedPublication: {
        statObservationId: stored.value.statObservationId,
        pointerOutcomes: stored.value.scoreSets.map((scoreSet) => scoreSet.pointerOutcome),
        entryCount: stored.value.entryCount, scoringProfileCount: stored.value.scoreSets.length,
      } } : {}),
    });
  }
  return {
    ...completedEvidence(mode, period, observation, built.scoreSets, projectionCoverage),
    persisted: true,
    statObservationId: stored.value.statObservationId,
    pointerOutcomes: stored.value.scoreSets.map((scoreSet) => scoreSet.pointerOutcome),
  };
}

export async function runAllPlayerIngestion(
  dependencies: AllPlayerIngestionDependencies,
  input: Readonly<{
    mode: AllPlayerIngestionMode;
    period: LeaguePeriod;
    requireFinalCoverage?: boolean;
  }>,
): Promise<AllPlayerIngestionResult> {
  const { mode, period } = input;
  assertPeriod(period);
  if (!dependencies.store.enabled) return { status: 'disabled', mode };
  const runId = dependencies.idGenerator.generate();
  const startedAt = dependencies.clock.monotonicNow();
  const deadlineAt = new Date(Math.min(
    dependencies.clock.now().getTime() + ALL_PLAYER_EXECUTION_MS,
    dependencies.deadlineAt ? Date.parse(dependencies.deadlineAt) : Infinity,
  )).toISOString();
  const controller = new AbortController();
  const signal = dependencies.signal
    ? AbortSignal.any([dependencies.signal, controller.signal]) : controller.signal;
  let fence: AllPlayerJobFence | undefined;
  let claimRetryAt: string | null | undefined;
  let preclaimDurability: Awaited<ReturnType<AllPlayerStore['recordAllPlayerPreclaimOutcome']>>
    | 'deadline-unavailable' | 'persistence-failed' | undefined;
  let stage = 'job-claim';
  let stopped = false;
  const checkpoint = async (nextStage: string, write = false): Promise<void> => {
    stage = nextStage;
    if (stopped || signal.aborted || dependencies.clock.now().getTime() >= Date.parse(deadlineAt)) {
      throw new Error('deadline-exceeded');
    }
    if (fence && dependencies.clock.now().getTime() >= Date.parse(fence.leaseUntil)) {
      throw new Error('lease-lost');
    }
    if (write && (!fence || !await dependencies.store.validateAllPlayerJobFence(fence))) {
      throw new Error('lease-lost');
    }
  };
  dependencies.logger.write('info', {
    stage: 'all-player-ingestion', lane: 'all-player', outcome: 'started',
    runId, period, cadence: mode,
  });
  let result: AllPlayerIngestionResult;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const operation = async (): Promise<AllPlayerIngestionResult> => {
      await checkpoint('job-claim');
      if (mode === 'shadow') {
        // A reusable read-only reservation cannot consume a global budget.
        // Until a reviewed live capture procedure exists, only replay can be
        // strictly read-only while preserving the provider request limit.
        if (dependencies.allPlayerSource.access !== 'replay') {
          return unavailable(mode, period, 'shadow-source-policy-required');
        }
      } else {
        const claim = await dependencies.store.acquireAllPlayerJob({
          mode, period: { ...period, seasonType: 'reg' }, workerId: runId,
          leaseSeconds: ALL_PLAYER_LEASE_SECONDS, deadlineAt,
        });
        if (claim.kind === 'disabled') return { status: 'disabled', mode };
        if (claim.kind !== 'acquired') {
          claimRetryAt = claim.nextRequestAt;
          return { status: 'skipped', mode, period, reason: claim.kind };
        }
        fence = claim.fence;
      }
      return execute({ ...dependencies, signal }, { ...input, fence, checkpoint });
    };
    const remainingMs = Math.max(1, Date.parse(deadlineAt) - dependencies.clock.now().getTime());
    result = await Promise.race([operation(), new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        stopped = true;
        controller.abort();
        reject(new Error('deadline-exceeded'));
      }, remainingMs);
    })]);
    if (result.status === 'unavailable' && !result.stage) result = { ...result, stage };
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const reason = message === 'deadline-exceeded' || signal.aborted ? 'timeout'
      : message === 'lease-lost' ? 'lease-lost'
      : /^[a-z][a-z0-9-]{1,95}$/u.test(message) ? message : 'stage-failed';
    result = unavailable(mode, period, reason, { stage,
      ...(error instanceof AllPlayerPreflightError ? { diagnostics: error.diagnostics } : {}),
    });
  } finally {
    if (timeout) clearTimeout(timeout);
    stopped = true;
    controller.abort();
  }
  if (fence && mode !== 'shadow') {
    const retainedEvidence = result.status === 'completed' && result.persisted ? {
      confirmedPublication: {
        statObservationId: result.statObservationId, pointerOutcomes: result.pointerOutcomes,
        entryCount: result.entryCount, scoringProfileCount: result.scoringProfileCount,
      },
    } : result.status === 'unavailable' && result.confirmedPublication ? {
      confirmedPublication: result.confirmedPublication,
      persistedObservation: result.persistedObservation, statObservationId: result.statObservationId,
    } : result.status === 'unavailable' && result.persistedObservation ? {
      persistedObservation: true, statObservationId: result.statObservationId,
    } : {};
    const outcome = result.status === 'completed' ? 'published'
      : result.status === 'unavailable' && ['old-observation-rejected', 'profile-publication-inconsistent'].includes(result.reason)
        ? 'validation-failed'
      : result.status === 'unavailable' && result.persistedObservation ? 'partial'
      : result.status === 'unavailable' && result.reason === 'timeout' ? 'timeout'
      : result.status === 'unavailable' && result.reason === 'lease-lost' ? 'lease-lost'
      : stage === 'weekly-stat-request' ? 'provider-failed' : 'validation-failed';
    const cleanup = dependencies.cleanupStore ?? dependencies.store;
    let cleanupTimeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const finished = await Promise.race([
        cleanup.finishAllPlayerJob({ fence, outcome, diagnostic: {
          stage, period, reason: result.status === 'unavailable' ? result.reason : result.status,
          ...(result.status === 'unavailable' && result.diagnostics ? {
            diagnostics: result.diagnostics, diagnosticCount: result.diagnosticCount ?? result.diagnostics.length,
          } : {}),
          retryDisposition: 'global-budget',
          finalCoverage: result.status === 'completed'
            && (input.requireFinalCoverage ?? mode !== 'recurring'),
          ...(result.status === 'completed' ? { entryCount: result.entryCount,
            scoringProfileCount: result.scoringProfileCount } : {}),
        } }),
        new Promise<false>((resolve) => { cleanupTimeout = setTimeout(() => resolve(false), 4_000); }),
      ]);
      if (!finished) result = unavailable(mode, period, 'lease-lost', { stage: 'durable-outcome', ...retainedEvidence });
    } catch {
      result = unavailable(mode, period, 'outcome-persistence-failed', { stage: 'durable-outcome', ...retainedEvidence });
    } finally {
      if (cleanupTimeout) clearTimeout(cleanupTimeout);
    }
  }
  if (!fence && mode !== 'shadow' && (result.status === 'skipped' || result.status === 'unavailable')) {
    // Claim races and failures have no owner to finish. Record only a bounded
    // diagnostic through the existing global job; never change its live lease
    // or provider reservation, and retain the original result on cleanup failure.
    const cleanupMs = Math.min(4_000, Date.parse(deadlineAt) + 4_000 - dependencies.clock.now().getTime());
    if (!Number.isFinite(cleanupMs) || cleanupMs < 1) preclaimDurability = 'deadline-unavailable';
    else {
      const cleanup = dependencies.cleanupStore ?? dependencies.store;
      let cleanupTimeout: ReturnType<typeof setTimeout> | undefined;
      try {
        preclaimDurability = await Promise.race([
          cleanup.recordAllPlayerPreclaimOutcome({
            outcome: result.status === 'skipped' ? result.reason === 'busy' ? 'busy' : 'not-due'
              : result.reason === 'timeout' ? 'timeout' : 'validation-failed',
            stage, reason: result.reason,
            period: { ...period, seasonType: 'reg' },
            retryDisposition: result.status === 'skipped' ? 'after-cooldown' : 'next-poll',
            ...(claimRetryAt && Number.isFinite(Date.parse(claimRetryAt))
              ? { retryAt: new Date(claimRetryAt).toISOString() } : {}),
          }),
          new Promise<'persistence-failed'>((resolve) => {
            cleanupTimeout = setTimeout(() => resolve('persistence-failed'), cleanupMs);
          }),
        ]);
      } catch { preclaimDurability = 'persistence-failed'; }
      finally { if (cleanupTimeout) clearTimeout(cleanupTimeout); }
    }
  }
  dependencies.logger.write(result.status === 'completed' ? 'info' : 'warn', {
    stage: 'all-player-ingestion', lane: 'all-player',
    outcome: result.status === 'completed' ? 'completed'
      : result.status === 'skipped' ? 'skipped' : 'failed',
    runId, period, cadence: mode,
    stageDurationMs: Math.max(0, dependencies.clock.monotonicNow() - startedAt),
    ...(result.status === 'unavailable' ? {
      allPlayerFailureStage: result.stage ?? stage,
      allPlayerReason: result.reason,
      allPlayerDiagnosticCount: result.diagnosticCount ?? result.diagnostics?.length ?? 0,
      allPlayerDiagnostics: result.diagnostics ?? [],
      allPlayerPersistedObservation: result.persistedObservation === true,
      allPlayerConfirmedPublication: result.confirmedPublication !== undefined,
      allPlayerRetryDisposition: result.confirmedPublication ? 'inspect-before-retry' as const : 'global-budget' as const,
    } : result.status === 'skipped' ? { allPlayerReason: result.reason } : {}),
    ...(preclaimDurability ? {
      allPlayerFailureStage: stage,
      allPlayerDiagnostics: prepareAllPlayerDiagnostics([
        `preclaim-durability:${preclaimDurability}`,
        ...(result.status === 'unavailable' ? result.diagnostics ?? [] : []),
      ]).diagnostics,
      allPlayerDiagnosticCount: 1 + (result.status === 'unavailable'
        ? result.diagnosticCount ?? result.diagnostics?.length ?? 0 : 0),
      allPlayerPersistedObservation: false, allPlayerConfirmedPublication: false,
    } : {}),
    ...(result.status === 'completed' ? {
      allPlayerEntryCount: result.entryCount,
      allPlayerScoringProfileCount: result.scoringProfileCount,
      allPlayerParityComparisonCount: result.parityComparisonCount,
      allPlayerParityMismatchCount: result.parityMismatchCount,
      allPlayerEligibleGameCount: result.eligibleGameCount,
      allPlayerActiveZeroCount: result.activeZeroCount,
      fullSlateProjectionIdentityComplete: result.projectionCoverage.identityComplete,
      fullSlateSkippedIdentityCount: result.projectionCoverage.skippedIdentityCount,
      allPlayerRankUnavailablePositions: result.projectionCoverage.rankUnavailablePositions,
    } : {}),
  });
  return result;
}

export function allPlayerIdentityInput(entry: AllPlayerStatEntry): AllPlayerIdentityLookup {
  return { provider: 'sleeper', entityKind: entry.entityKind, externalId: entry.providerExternalId };
}
