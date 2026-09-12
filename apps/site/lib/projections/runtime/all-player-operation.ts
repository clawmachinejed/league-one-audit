import 'server-only';

import { createHash } from 'node:crypto';
import type { PlayerCatalog, SleeperMatchup } from '../../transform';
import {
  buildSleeperAllPlayerInventory,
  sleeperOfficialRosteredPoints,
  type SleeperAllPlayerStatRequest,
  type SleeperAllPlayerStatResult,
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
  AllPlayerIdentityLookup,
  ProjectionStore,
  StoredAllPlayerIdentityMapping,
} from '../adapters/neon/contracts';
import {
  buildAllPlayerScoreSets,
  type AllPlayerIdentity,
  type AllPlayerScoreSet,
  type AllPlayerScoringProfile,
  type AllPlayerStatEntry,
  type AllPlayerStatObservation,
} from '../domain/all-player-statistics';
import type {
  LeagueConfiguration,
  LeaguePeriod,
  LeagueWeekState,
  NflTeam,
  NflWeekSchedule,
  ProjectionSlate,
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
import { projectionEntityForObservation } from '../worker/roster-context';

export const ALL_PLAYER_SCORER_VERSION = 'sleeper-actual-v1';
export const ALL_PLAYER_CADENCE_HOURS = 12;
export const ALL_PLAYER_CADENCE_MS = ALL_PLAYER_CADENCE_HOURS * 60 * 60 * 1_000;
const ALL_PLAYER_LEASE_SECONDS = ALL_PLAYER_CADENCE_HOURS * 60 * 60 + 5 * 60;

export type AllPlayerIngestionMode = 'shadow' | 'backfill' | 'recurring';

export type AllPlayerLeagueLoad = Readonly<{
  state: LeagueWeekState;
  rawMatchups: readonly SleeperMatchup[];
  expectedRosterIds: readonly (string | number)[];
  starterSlots: readonly string[];
}>;

type AllPlayerStore = Pick<ProjectionStore,
  | 'enabled'
  | 'readAllPlayerLeagueProfiles'
  | 'readAllPlayerIdentityMappings'
  | 'readAllPlayerGameContext'
  | 'upsertScoringEntities'
  | 'recordLeagueWeekObservation'
  | 'recordAllPlayerBatch'
  | 'acquireJob'
  | 'completeJob'
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
  allPlayerSource: Readonly<{
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
}>;

export type AllPlayerIngestionResult =
  | Readonly<{ status: 'disabled'; mode: AllPlayerIngestionMode }>
  | Readonly<{
      status: 'skipped';
      mode: AllPlayerIngestionMode;
      reason: 'busy' | 'completed';
      period: LeaguePeriod;
    }>
  | Readonly<{
      status: 'unavailable';
      mode: AllPlayerIngestionMode;
      reason: string;
      period: LeaguePeriod;
      sourceRevision?: string;
      projectionCoverage?: FullSlateProjectionCoverage;
      persistedObservation?: boolean;
      statObservationId?: string;
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

function jobKey(period: LeaguePeriod): string {
  return `all-player-ingestion:sleeper:${period.season}:reg:${period.week}`;
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
  }> = {},
): AllPlayerIngestionResult {
  return { status: 'unavailable', mode, period, reason, ...evidence };
}

function scheduleFor(leagues: readonly AllPlayerLeagueLoad[]): NflWeekSchedule {
  const first = leagues[0]?.state.schedule;
  if (!first || leagues.some((league) => stableJson(league.state.schedule) !== stableJson(first))) {
    throw new Error('Canonical leagues did not provide one shared NFL schedule.');
  }
  return first;
}

function rosteredPlayerIds(leagues: readonly AllPlayerLeagueLoad[]): string[] {
  return [...new Set(leagues.flatMap((league) => league.rawMatchups.flatMap((row) => (
    Array.isArray(row.players) ? row.players : []
  ))))].sort();
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

function plannedIdentities(
  inputs: readonly AllPlayerIdentityLookup[],
  mappings: readonly StoredAllPlayerIdentityMapping[],
  officialProvider: ProviderKey,
): Readonly<{
  byReference: ReadonlyMap<string, string>;
  unusableOfficialIdentities: readonly string[];
}> {
  const mappingByKey = new Map(mappings.map((mapping) => [identityLookupKey(mapping), mapping]));
  const planned = new Map<string, string>();
  const unusableOfficialIdentities: string[] = [];
  for (const input of inputs) {
    const mapping = mappingByKey.get(identityLookupKey(input));
    if (!mapping) throw new Error('Identity mapping inspection was incomplete.');
    const storedMappingExists = mapping.scoringEntityId !== null
      || mapping.mappedEntityKind !== null
      || mapping.mappingStatus != null || mapping.validTo != null;
    const storedMappingUsable = mapping.scoringEntityId !== null
      && mapping.mappedEntityKind === input.entityKind
      && mapping.mappingStatus === 'verified'
      && mapping.validTo === null;
    if (storedMappingExists && !storedMappingUsable) {
      if (input.provider === String(officialProvider)) {
        unusableOfficialIdentities.push(input.externalId);
      }
      continue;
    }
    const scoringEntityId = mapping.scoringEntityId
      ?? (input.provider === String(officialProvider) ? proposedEntityId(input) : null);
    if (scoringEntityId) planned.set(providerIdentityKey(input), scoringEntityId);
  }
  return {
    byReference: planned,
    unusableOfficialIdentities: [...new Set(unusableOfficialIdentities)].sort(),
  };
}

function identityLookups(
  inventory: Extract<ReturnType<typeof buildSleeperAllPlayerInventory>, { status: 'available' }>['inventory'],
  projectionSlate: ProjectionSlate,
  officialProvider: ProviderKey,
): AllPlayerIdentityLookup[] {
  const values = new Map<string, AllPlayerIdentityLookup>();
  const add = (value: AllPlayerIdentityLookup) => values.set(identityLookupKey(value), value);
  for (const entity of inventory.entities) {
    add({
      provider: String(officialProvider),
      entityKind: entity.entityKind,
      externalId: entity.providerExternalId,
    });
  }
  for (const projection of projectionSlate.projections) {
    for (const reference of [projection.identity.primary, ...projection.identity.aliases]) {
      add({
        provider: String(reference.provider),
        entityKind: reference.entityKind === 'team-defense' ? 'team_defense' : 'player',
        externalId: String(reference.externalId),
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
): string[] {
  return [...new Set(slate.projections.flatMap((projection) => {
    const entity = projectionEntityForObservation(projection, officialProvider);
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

async function persistOfficialObservations(
  store: AllPlayerStore,
  leagues: readonly LoadedLeague[],
  observation: AllPlayerStatObservation,
): Promise<ReadonlyMap<string, string>> {
  const results = new Map<string, string>();
  for (const league of leagues) {
    const officialInputs = officialPlayerInputs(league, observation);
    const sourceRevision = `sha256:${hash({
      kind: 'all-player-parity-v1',
      leagueSourceRevision: league.state.sourceRevision,
      allPlayerSourceRevision: observation.sourceRevision,
      officialFingerprint: league.official.fingerprint,
    })}`;
    const result = await store.recordLeagueWeekObservation({
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
    });
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
  }>,
): Promise<AllPlayerIngestionResult> {
  const { mode, period } = input;
  const configurations = dependencies.leagueRegistry.listActiveLeagues();
  if (configurations.length !== 2) return unavailable(mode, period, 'league-inventory');
  const [leagueLoads, catalog, projectionSlate, gameContext] = await Promise.all([
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
  const schedule = scheduleFor(leagueLoads);
  const games = gamesByTeam(schedule, gameContext);
  const projectionIds = projectionPlayerIds(projectionSlate.slate, dependencies.officialProvider);
  const inventoryResult = buildSleeperAllPlayerInventory({
    catalog: catalog.catalog,
    catalogComplete: catalog.complete,
    catalogRevision: catalog.sourceRevision,
    rosteredPlayerIds: rosteredPlayerIds(leagueLoads),
    projectionPlayerIds: projectionIds,
    gamesByTeam: games,
    byeTeamIds: Object.entries(schedule).flatMap(([team, value]) => (
      value?.kind === 'bye' ? [team] : []
    )),
    scheduleRevision: fingerprint(schedule),
  });
  if (inventoryResult.status !== 'available') {
    return unavailable(mode, period, `inventory-${inventoryResult.reason}`);
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
  );
  const projectionCoverage = analyzeFullSlateProjectionCoverage(
    projectionSlate.slate,
    dependencies.officialProvider,
    identityPlan.byReference,
  );
  if (identityPlan.unusableOfficialIdentities.length > 0) {
    return unavailable(mode, period, 'identity-mapping-unusable', { projectionCoverage });
  }
  const providerResult = await dependencies.allPlayerSource.load({
    season: period.season,
    week: period.week,
    inventory: inventoryResult.inventory,
    gamesByTeam: games,
    requireFinalCoverage: input.requireFinalCoverage ?? mode !== 'recurring',
  });
  if (providerResult.status !== 'available') {
    return unavailable(mode, period, `provider-${providerResult.reason}`, { projectionCoverage });
  }
  const observation = addProjectionEvidence(providerResult.observation, projectionCoverage);
  if (observation.quality !== 'complete' || observation.coverage.complete !== true) {
    if (mode !== 'shadow'
      && observation.quality === 'partial'
      && observation.coverage.complete === false) {
      const stored = await dependencies.store.recordAllPlayerBatch({
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

  const normalized = leagueLoads.map((league) => ({
    ...league,
    normalization: dependencies.normalizeScoringProfile(league.state.scoringSettings),
  }));
  if (normalized.some((league) => league.normalization.status !== 'available')) {
    return unavailable(mode, period, 'unsupported-scoring', {
      sourceRevision: observation.sourceRevision,
      projectionCoverage,
    });
  }
  const profileInputs = normalized.map((league) => {
    const value = league.normalization as Extract<SleeperScoringProfileNormalization, { status: 'available' }>;
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
      sourceRevision: observation.sourceRevision,
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
        sourceRevision: observation.sourceRevision,
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
  if (mode === 'shadow') {
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
      });
    }
    return {
      ...completedEvidence(mode, period, observation, shadow.scoreSets, projectionCoverage),
      persisted: false,
      statObservationId: null,
      pointerOutcomes: [],
    };
  }

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
  const officialObservationIds = await persistOfficialObservations(
    dependencies.store,
    loaded,
    observation,
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
    observation,
    scoreSets: built.scoreSets,
    verifiedAt: dependencies.clock.now().toISOString(),
  };
  const stored = await dependencies.store.recordAllPlayerBatch(batch);
  if (stored.kind !== 'stored'
    || stored.value.entryCount !== observation.entries.length
    || stored.value.scoreSets.length !== built.scoreSets.length) {
    return unavailable(mode, period, 'batch-persistence-incomplete', {
      sourceRevision: observation.sourceRevision,
      projectionCoverage,
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
  let claimed = false;
  const key = jobKey(period);
  if (mode !== 'shadow') {
    const claim = await dependencies.store.acquireJob({
      jobKey: key,
      jobType: 'all-player-ingestion',
      scheduledFor: allPlayerCadenceSlot(dependencies.clock.now()),
      payload: {
        cadenceVersion: 'all-player-12h-v1',
        mode,
        season: period.season,
        seasonType: period.seasonType,
        week: period.week,
      },
      workerId: runId,
      leaseSeconds: ALL_PLAYER_LEASE_SECONDS,
      minimumIntervalSeconds: ALL_PLAYER_CADENCE_MS / 1_000,
    });
    if (claim.kind === 'disabled') return { status: 'disabled', mode };
    if (claim.kind !== 'acquired') {
      return {
        status: 'skipped', mode, period,
        reason: claim.kind === 'completed' ? 'completed' : 'busy',
      };
    }
    claimed = true;
  }
  dependencies.logger.write('info', {
    stage: 'all-player-ingestion', lane: 'all-player', outcome: 'started',
    runId, period, cadence: mode,
  });
  let result: AllPlayerIngestionResult;
  try {
    result = await execute(dependencies, input);
  } catch {
    result = unavailable(mode, period, 'unexpected');
  }
  if (claimed && !await dependencies.store.completeJob(key, runId)) {
    result = unavailable(mode, period, 'lease-lost', result.status === 'completed'
      ? { sourceRevision: result.sourceRevision, projectionCoverage: result.projectionCoverage }
      : {});
  }
  dependencies.logger.write(result.status === 'completed' ? 'info' : 'warn', {
    stage: 'all-player-ingestion', lane: 'all-player',
    outcome: result.status === 'completed' ? 'completed'
      : result.status === 'skipped' ? 'skipped' : 'failed',
    runId, period, cadence: mode,
    stageDurationMs: Math.max(0, dependencies.clock.monotonicNow() - startedAt),
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
