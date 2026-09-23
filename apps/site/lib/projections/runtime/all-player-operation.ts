import 'server-only';

import { createHash } from 'node:crypto';
import type { PlayerCatalog, SleeperMatchup } from '../../transform';
import {
  buildSleeperAllPlayerInventory,
  sleeperOfficialRosteredPoints,
  type SleeperAllPlayerStatRequest,
  type SleeperAllPlayerStatResult,
  type SleeperAllPlayerStatResponseEvidence,
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
  AllPlayerJobFence,
  SleeperWeeklyStatReceipt,
  AllPlayerIdentityLookup,
  ProjectionStore,
  StoredAllPlayerIdentityMapping,
} from '../adapters/neon/contracts';
import { prepareAllPlayerBatch } from '../adapters/neon/all-player-statistics';
import { prepareLeagueWeekObservation } from '../adapters/neon/observations';
import {
  buildAllPlayerScoreContent,
  validateLeagueAllPlayerParity,
  validateAllPlayerObservationEvidence,
  type AllPlayerScoreSet,
  type AllPlayerScoringProfile,
  type AllPlayerStatEntry,
  type AllPlayerStatObservation,
  type AllPlayerPeriodParticipationEvidence,
} from '../domain/all-player-statistics';
import { scoreSparseStatistics } from '../domain/scoring';
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
import { NFL_TEAM_CODES } from '../domain/contracts';
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
import { mapWithConcurrency } from '../worker/worker-operations';
import { officialPlayerIdentityInventory } from '../shared/official-catalog-identity';
import { validateAllPlayerPublicationCoverage } from '../domain/all-player-publication-coverage';
import { prepareAllPlayerDiagnostics } from './all-player-diagnostics';
import { sleeperAllPlayerCatalogContext } from '../adapters/sleeper/all-player-catalog-context';
import { ALL_PLAYER_REFRESH_INTERVAL_MS } from '../../all-player-refresh-schedule';

export const ALL_PLAYER_SCORER_VERSION = 'sleeper-actual-v1';
const ALL_PLAYER_PARITY_TOLERANCE = 0.000_001;
export const ALL_PLAYER_CADENCE_MS = ALL_PLAYER_REFRESH_INTERVAL_MS;
export const ALL_PLAYER_CADENCE_HOURS = ALL_PLAYER_CADENCE_MS / 3_600_000;
const ALL_PLAYER_LEASE_SECONDS = 55;
export const ALL_PLAYER_EXECUTION_MS = 50_000;
const SQL_FAILURE_REASONS = {
  '23503': 'persistence-reference-rejected', '23514': 'persistence-constraint-rejected',
  '23505': 'persistence-conflict', '40001': 'persistence-transaction-conflict',
  '40P01': 'persistence-transaction-conflict', '57014': 'persistence-cancelled',
  P0001: 'persistence-validation-rejected',
} as const;

export type AllPlayerIngestionMode = 'shadow' | 'backfill' | 'recurring';

type AllPlayerPregameEvidence = Readonly<{
  policy: 'exact-period-shared-pregame-v1';
  verifiedAt: string;
  firstKickoffAt: string;
  scheduledGameCount: number;
  scheduleRevision: string;
}>;

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
  | 'readAllPlayerHistoricalTeamContexts'
  | 'upsertScoringEntities'
  | 'recordLeagueWeekObservation'
  | 'recordAllPlayerBatch'
  | 'recordAllPlayerScoreContent'
  | 'acceptAllPlayerLeagueScore'
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
  /** The existing official NFL schedule boundary, independent of fantasy leagues. */
  loadSchedule: (period: LeaguePeriod) => Promise<NflWeekSchedule>;
  loadLeagueWeek: (
    configuration: LeagueConfiguration,
    period: LeaguePeriod,
  ) => Promise<AllPlayerLeagueLoad>;
  loadCatalog: () => Promise<Readonly<{
    catalog: PlayerCatalog;
    complete: boolean;
    sourceRevision: string | null;
    observedAt?: string;
    identityRevision?: string;
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
  sharedCaptureReceipt?: (period: LeaguePeriod) => SleeperWeeklyStatReceipt | undefined;
  deadlineAt?: string;
  cleanupStore?: Pick<AllPlayerStore, 'finishAllPlayerJob' | 'recordAllPlayerPreclaimOutcome'>;
}>;

export type AllPlayerIngestionResult =
  | Readonly<{ status: 'disabled'; mode: AllPlayerIngestionMode }>
  | Readonly<{
      /** Accepted current/correction evidence, never complete score publication. */
      status: 'partial';
      mode: 'recurring';
      period: LeaguePeriod;
      reason: 'provider-coverage-incomplete';
      sourceRevision: string;
      projectionCoverage: FullSlateProjectionCoverage;
      persistedObservation: true;
      statObservationId: string;
      entryCount: number;
      scoringProfileCount: 0;
      eligibleGameCount: number;
      appearanceGameCount: number;
      warnings: readonly string[];
      diagnostics: readonly string[];
      diagnosticCount: number;
    }>
  | Readonly<{
      status: 'skipped';
      mode: AllPlayerIngestionMode;
      reason: 'busy' | 'completed' | 'not-due';
      period?: LeaguePeriod;
    }>
  | Readonly<{
      status: 'skipped'; mode: 'recurring'; reason: 'no-statistics-yet';
      period: LeaguePeriod;
      responseEvidence: SleeperAllPlayerStatResponseEvidence;
      pregameEvidence: AllPlayerPregameEvidence;
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
      responseEvidence?: SleeperAllPlayerStatResponseEvidence;
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
      acceptedLeagues: number;
      failedLeagues: number;
      leagueOutcomes: readonly AllPlayerLeagueOutcome[];
    }>;

type AllPlayerProgress = { statObservationId: string | null; entryCount: number; outcomes: AllPlayerLeagueOutcome[] };

export type AllPlayerLeagueOutcome = Readonly<{
  leagueKey: string;
  status: 'accepted' | 'failed' | 'deferred';
  reason?: string;
  acceptanceId?: string;
  leagueSeasonId?: string;
  scoringProfileId?: string;
  pointerOutcome?: string;
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
    responseEvidence?: SleeperAllPlayerStatResponseEvidence;
    confirmedPublication?: Extract<AllPlayerIngestionResult, { status: 'unavailable' }>['confirmedPublication'];
  }> = {},
): AllPlayerIngestionResult {
  return { status: 'unavailable', mode, period, reason, ...evidence,
    ...(evidence.diagnostics ? prepareAllPlayerDiagnostics(evidence.diagnostics) : {}),
  };
}

/** Copy only a bounded, typed envelope. Even injected/replayed adapters cannot
 * forward arbitrary response payload, headers or exception text to diagnostics. */
function safeResponseEvidence(value: SleeperAllPlayerStatResponseEvidence | undefined): SleeperAllPlayerStatResponseEvidence | undefined {
  if (!value || (value.httpStatus !== null && (!Number.isInteger(value.httpStatus)
    || value.httpStatus < 100 || value.httpStatus > 599))
    || !['object', 'array', 'null', 'string', 'number', 'boolean', 'invalid-json', 'unreadable', 'not-read'].includes(value.bodyShape)
    || (value.topLevelCount !== null && (!Number.isSafeInteger(value.topLevelCount) || value.topLevelCount < 0))
    || (value.bodyHash !== null && !/^sha256:[a-f0-9]{64}$/u.test(value.bodyHash))
    || !Number.isFinite(Date.parse(value.requestStartedAt))
    || !Number.isFinite(Date.parse(value.requestCompletedAt))
    || new Date(value.requestStartedAt).toISOString() !== value.requestStartedAt
    || new Date(value.requestCompletedAt).toISOString() !== value.requestCompletedAt
    || Date.parse(value.requestCompletedAt) < Date.parse(value.requestStartedAt)) return undefined;
  return { httpStatus: value.httpStatus, bodyShape: value.bodyShape,
    topLevelCount: value.topLevelCount, bodyHash: value.bodyHash,
    requestStartedAt: value.requestStartedAt, requestCompletedAt: value.requestCompletedAt };
}

function responseDiagnostics(evidence: SleeperAllPlayerStatResponseEvidence | undefined): string[] {
  return evidence ? [
    `weekly-response:http-status:${evidence.httpStatus ?? 'unavailable'}`,
    `weekly-response:body-shape:${evidence.bodyShape}`,
    `weekly-response:top-level-count:${evidence.topLevelCount ?? 'unavailable'}`,
    `weekly-response:body-hash:${evidence.bodyHash ?? 'unavailable'}`,
    `weekly-response:started-at:${evidence.requestStartedAt}`,
    `weekly-response:completed-at:${evidence.requestCompletedAt}`,
  ] : [];
}

/** A complete canonical pregame schedule is independent of missing stat rows.
 * Unknown game phase alone never proves that the requested week has not begun. */
function pregameEvidence(
  schedule: NflWeekSchedule,
  games: Awaited<ReturnType<AllPlayerStore['readAllPlayerGameContext']>>,
  response: SleeperAllPlayerStatResponseEvidence,
  now: Date,
): AllPlayerPregameEvidence | null {
  const checkedAt = now.getTime();
  if (!Number.isFinite(checkedAt) || Date.parse(response.requestCompletedAt) > checkedAt
    || Object.keys(schedule).length !== NFL_TEAM_CODES.length
    || NFL_TEAM_CODES.some((team) => !schedule[team])) return null;
  const expectedGames = new Map<string, { homeTeam: string; awayTeam: string; kickoff: number }>();
  for (const team of NFL_TEAM_CODES) {
    const game = schedule[team]!;
    if (game.kind === 'bye') continue;
    const opponent = schedule[game.opponent];
    const kickoff = Date.parse(game.kickoffAt ?? '');
    if (!NFL_TEAM_CODES.includes(game.opponent) || team === game.opponent
      || !opponent || opponent.kind !== 'scheduled' || opponent.opponent !== team
      || !['home', 'away'].includes(game.location)
      || opponent.location === game.location
      || !Number.isFinite(kickoff) || kickoff <= checkedAt
      || Date.parse(opponent.kickoffAt ?? '') !== kickoff) return null;
    const homeTeam = game.location === 'home' ? team : game.opponent;
    const awayTeam = game.location === 'away' ? team : game.opponent;
    expectedGames.set(`${homeTeam}:${awayTeam}`, { homeTeam, awayTeam, kickoff });
  }
  if (expectedGames.size === 0 || games.length !== expectedGames.size
    || new Set(games.map((game) => game.nflGameId)).size !== games.length) return null;
  const matched = new Set<string>();
  for (const game of games) {
    const key = `${game.homeTeam}:${game.awayTeam}`;
    const expected = expectedGames.get(key);
    if (!expected || matched.has(key) || !game.nflGameId.trim()
      || game.phase !== 'unknown' || Date.parse(game.kickoffAt ?? '') !== expected.kickoff) return null;
    matched.add(key);
  }
  return { policy: 'exact-period-shared-pregame-v1', verifiedAt: now.toISOString(),
    firstKickoffAt: new Date(Math.min(...[...expectedGames.values()].map((game) => game.kickoff))).toISOString(),
    scheduledGameCount: expectedGames.size, scheduleRevision: fingerprint(schedule) };
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

/** A product assumption cannot replace contradictory observed score material. */
function reconcileNonParticipationAssumptions(
  observation: AllPlayerStatObservation,
  leagues: readonly LoadedLeague[],
): Readonly<{ observation: AllPlayerStatObservation; diagnostics: readonly string[]; failures: readonly string[] }> {
  const profiles = new Map<string, Readonly<Record<string, unknown>>>();
  const officialPoints = new Map<string, Array<Readonly<{ leagueKey: string; profileId: string; points: number }>>>();
  for (const league of leagues) {
    const previous = profiles.get(league.scoringProfileId);
    if (previous && stableJson(previous) !== stableJson(league.rawRules)) {
      throw new Error('One scoring profile has conflicting source rules.');
    }
    profiles.set(league.scoringProfileId, league.rawRules);
    for (const point of league.official.points) {
      const observations = officialPoints.get(point.providerExternalId) ?? [];
      observations.push({ leagueKey: league.configuration.key, profileId: league.scoringProfileId, points: point.points });
      officialPoints.set(point.providerExternalId, observations);
    }
  }
  const diagnostics = new Set<string>();
  const failures = new Set<string>();
  const entries = observation.entries.map((entry): AllPlayerStatEntry => {
    const evidence = entry.eligibilityEvidence;
    if (evidence.kind !== 'assumed-nonparticipation') return entry;
    let conflict = false;
    for (const point of officialPoints.get(entry.providerExternalId) ?? []) {
      if (Number.isFinite(point.points) && Math.abs(point.points) > ALL_PLAYER_PARITY_TOLERANCE) {
        conflict = true;
        diagnostics.add(`official-nonzero-assumption-conflict:${entry.providerExternalId}:${point.leagueKey}:${point.profileId}`);
      }
    }
    // A missing row is not an observed sparse-stat record to score.
    for (const [profileId, rawRules] of evidence.basis.kind === 'weekly-stat' ? profiles : []) {
      const score = scoreSparseStatistics(entry.stats, rawRules, SLEEPER_ALL_PLAYER_SCORING_RULE_KEYS);
      if (!score.available || score.points === null) {
        for (const key of score.invalidRuleKeys) failures.add(`invalid:${key}`);
        for (const key of score.unsupportedRuleKeys) failures.add(`unsupported:${key}`);
        for (const key of score.invalidStatKeys) failures.add(`invalid-stat:${entry.providerExternalId}:${key}`);
      } else if (!Number.isFinite(score.points)) {
        failures.add(`invalid-score:${entry.providerExternalId}:${profileId}`);
      } else if (Math.abs(score.points) > ALL_PLAYER_PARITY_TOLERANCE) {
        conflict = true;
        diagnostics.add(`nonzero-assumption-conflict:${entry.providerExternalId}:${profileId}`);
      }
    }
    return conflict ? {
      ...entry, eligibilityEvidence: evidence.basis, eligibleGameCount: null, appearanceGameCount: null,
    } : entry;
  });
  if (diagnostics.size === 0) return { observation, diagnostics: [], failures: [...failures].sort() };
  const unknownEligibilityIds = entries.filter((entry) => entry.eligibleGameCount === null)
    .map((entry) => entry.providerExternalId).sort();
  const unmappedGameCount = entries.filter((entry) => entry.eligibleGameCount === 1 && !entry.nflGameId).length;
  const nonFinalEligibleCount = observation.coverage.mode === 'completed-backfill'
    ? entries.filter((entry) => entry.eligibleGameCount === 1 && entry.gamePhase !== 'final').length : 0;
  const conflicts = [...diagnostics].sort();
  const warnings = observation.warnings.filter((warning) => !/^(?:unknown-eligibility|unmapped-games|non-final-games):/u.test(warning));
  if (unknownEligibilityIds.length) warnings.push(`unknown-eligibility:${unknownEligibilityIds.length}`);
  if (unmappedGameCount) warnings.push(`unmapped-games:${unmappedGameCount}`);
  if (nonFinalEligibleCount) warnings.push(`non-final-games:${nonFinalEligibleCount}`);
  return {
    observation: {
      ...observation, entries, quality: 'partial',
      coverage: {
        ...observation.coverage, complete: false,
        unknownEligibilityCount: unknownEligibilityIds.length, unknownEligibilityIds,
        unknownAppearanceCount: entries.filter((entry) => entry.appearanceGameCount === null).length,
        assumedNonParticipationCount: entries.filter((entry) => entry.eligibilityEvidence.kind === 'assumed-nonparticipation').length,
        unmappedGameCount, nonFinalEligibleCount, nonParticipationAssumptionConflicts: conflicts,
      },
      warnings: [...new Set([...warnings, ...conflicts])].sort(),
    },
    diagnostics: conflicts, failures: [...failures].sort(),
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
    if (!Array.isArray(row.starters) || row.starters.length !== league.starterSlots.length) {
      throw new Error('Official starter assignments are unavailable.');
    }
    const starters = row.starters;
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

/** League source waits are bounded independently; late reads cannot publish. */
async function loadValidatedLeague(
  dependencies: AllPlayerIngestionDependencies,
  configuration: LeagueConfiguration,
  period: LeaguePeriod,
  schedule: NflWeekSchedule,
): Promise<LoadedLeague> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const load = async (): Promise<LoadedLeague> => {
    const league = await dependencies.loadLeagueWeek(configuration, period);
    if (!samePeriod(league.state.period, period)) throw new Error('league-period-mismatch');
    if (configuration.key !== league.state.configuration.key
      || externalReferenceKey(configuration.leagueRef) !== externalReferenceKey(league.state.configuration.leagueRef)) {
      throw new Error('league-identity-mismatch');
    }
    if (stableJson(league.state.schedule) !== stableJson(schedule)) throw new Error('league-schedule-mismatch');
    if (league.rawMatchups.some((row) => !Array.isArray(row.starters)
      || row.starters.length !== league.starterSlots.length)) throw new Error('official-starters-unavailable');
    const normalized = dependencies.normalizeScoringProfile(league.state.scoringSettings);
    if (normalized.status !== 'available') throw new Error('unsupported-scoring');
    const rawRules = normalized.profile.provenance.rawRules;
    if (Object.entries(rawRules).some(([key, weight]) => typeof weight !== 'number'
      || !Number.isFinite(weight) || weight !== 0 && !SLEEPER_ALL_PLAYER_SCORING_RULE_KEYS.has(key))) {
      throw new Error('unsupported-active-scoring-rule');
    }
    const profiles = await dependencies.store.readAllPlayerLeagueProfiles({ season: period.season,
      provider: String(dependencies.officialProvider), leagues: [{ leagueKey: configuration.key,
        externalLeagueId: String(configuration.leagueRef.externalId), rulesHash: rulesHash(rawRules) }] });
    const profile = profiles[0];
    if (profiles.length !== 1 || !profile || profile.leagueKey !== configuration.key
      || profile.rulesHash !== rulesHash(rawRules) || stableJson(profile.rules) !== stableJson(rawRules)) {
      throw new Error('scoring-profile-inventory');
    }
    const official = sleeperOfficialRosteredPoints(league.rawMatchups, league.expectedRosterIds);
    if (official.status !== 'available') throw new Error('official-parity-incomplete');
    return { ...league, configuration, scoringProfileId: profile.scoringProfileId,
      leagueSeasonId: profile.leagueSeasonId, rawRules, official };
  };
  try {
    return await Promise.race([load(), new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new Error('league-source-timeout')), 8_000);
    })]);
  } finally { if (timeout) clearTimeout(timeout); }
}

async function execute(
  dependencies: AllPlayerIngestionDependencies,
  input: Readonly<{
    mode: AllPlayerIngestionMode;
    period: LeaguePeriod;
    requireFinalCoverage?: boolean;
    cadenceDiagnostics?: readonly string[];
    fence?: AllPlayerJobFence;
    eligibleLeagueKeys?: readonly string[];
    unavailableLeagueKeys?: readonly string[];
    progress: AllPlayerProgress;
    checkpoint: (stage: string, write?: boolean) => Promise<void>;
  }>,
): Promise<AllPlayerIngestionResult> {
  const { mode, period } = input;
  await input.checkpoint('source-context');
  const allConfigurations = dependencies.leagueRegistry.listActiveLeagues();
  const configurations = input.eligibleLeagueKeys
    ? allConfigurations.filter((league) => input.eligibleLeagueKeys!.includes(league.key)) : allConfigurations;
  if (configurations.length === 0
    || configurations.some(({ key, leagueRef }) => !key.trim() || key !== key.trim()
      || leagueRef.resource !== 'league' || leagueRef.provider !== dependencies.officialProvider
      || !leagueRef.externalId.trim() || leagueRef.externalId !== leagueRef.externalId.trim())
    || new Set(configurations.map(({ key }) => key)).size !== configurations.length
    || new Set(configurations.map(({ leagueRef }) => externalReferenceKey(leagueRef))).size !== configurations.length) {
    return unavailable(mode, period, 'league-inventory');
  }
  const [schedule, catalog, projectionSlate, gameContext, reviewedEvidence, historicalTeamContexts] = await Promise.all([
    dependencies.loadSchedule(period),
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
    dependencies.store.readAllPlayerHistoricalTeamContexts({ provider: String(dependencies.officialProvider),
      season: period.season, seasonType: 'reg', week: period.week }),
  ]);
  if (!catalog.complete || !catalog.sourceRevision) {
    return unavailable(mode, period, 'catalog-incomplete');
  }
  if (!projectionSlate || projectionSlate.slate.quality !== 'complete'
    || !samePeriod(projectionSlate.slate.period, period)) {
    return unavailable(mode, period, 'projection-slate-incomplete');
  }
  await input.checkpoint('inventory');
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
    historicalTeamContexts,
    ...(reviewedEvidence?.scheduleRevision === scheduleRevision && reviewedEvidence.scheduleObservedAt
      ? { scheduleObservedAt: reviewedEvidence.scheduleObservedAt } : {}),
    catalog: catalog.catalog,
    catalogComplete: catalog.complete,
    catalogRevision: catalog.identityRevision ?? catalog.sourceRevision,
    // Shared statistics describe the official player inventory, not membership
    // in any fantasy league. A missing roster identity is validated for that league.
    rosteredPlayerIds: [],
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
  await input.checkpoint('weekly-stat-request');
  if (mode !== 'shadow' && (!input.fence || !await dependencies.store.markAllPlayerRequest({
    fence: input.fence, period: { ...period, seasonType: 'reg' },
  }))) return unavailable(mode, period, 'request-budget-unavailable');
  // A slow reservation may consume the remaining invocation time. A reserved
  // attempt stays budgeted even when it is too late to begin the provider GET.
  await input.checkpoint('weekly-stat-request');
  const providerResult = await dependencies.allPlayerSource.load({
    season: period.season,
    week: period.week,
    inventory: inventoryResult.inventory,
    gamesByTeam: games,
    requireFinalCoverage: input.requireFinalCoverage ?? mode !== 'recurring',
    signal: dependencies.signal,
  });
  if (providerResult.status !== 'available') {
    const responseEvidence = safeResponseEvidence(providerResult.responseEvidence);
    const diagnostics = responseDiagnostics(responseEvidence);
    if (providerResult.status === 'empty' && mode === 'recurring'
      && !(input.requireFinalCoverage ?? false) && responseEvidence?.bodyShape === 'object'
      && responseEvidence.topLevelCount === 0 && responseEvidence.bodyHash !== null
      && responseEvidence.httpStatus !== null && responseEvidence.httpStatus >= 200
      && responseEvidence.httpStatus < 300) {
      await input.checkpoint('empty-period-preflight');
      // Recheck canonical game state after the request. No league is published
      // from an empty response, so a peer's registration cannot block this proof.
      // A fetch that crosses kickoff cannot turn absent rows into a pregame skip.
      const currentGames = await dependencies.store.readAllPlayerGameContext({ season: period.season,
        seasonType: 'reg', week: period.week, gameStateProvider: String(dependencies.gameStateProvider) });
      await input.checkpoint('empty-period-preflight');
      const proof = pregameEvidence(schedule, currentGames, responseEvidence, dependencies.clock.now());
      if (proof) {
        await input.checkpoint('no-statistics-yet', true);
        // The final ownership check can itself cross kickoff.
        if (dependencies.clock.now().getTime() < Date.parse(proof.firstKickoffAt)) {
          return { status: 'skipped', mode, reason: 'no-statistics-yet', period,
            responseEvidence, pregameEvidence: proof };
        }
      }
      diagnostics.push('empty-response:pregame-period-unproven');
    }
    return unavailable(mode, period, `provider-${providerResult.reason}`, {
      projectionCoverage, ...(responseEvidence ? { responseEvidence } : {}),
      ...(diagnostics.length ? { diagnostics } : {}),
    });
  }
  const sourceObservation = providerResult.observation;
  let observation = addProjectionEvidence({
    ...sourceObservation,
    // Replays retain their original context. Never date old labels as newly observed.
    ...(dependencies.allPlayerSource.access !== 'replay' && catalog.observedAt ? {
      providerContext: sleeperAllPlayerCatalogContext({
        catalog: catalog.catalog, sourceRevision: catalog.sourceRevision,
        observedAt: catalog.observedAt, entries: sourceObservation.entries,
      }),
    } : {}),
  }, projectionCoverage, [...new Set(identityDiagnostics)].sort());
  if (input.cadenceDiagnostics?.length) observation = {
    ...observation,
    warnings: [...new Set([...observation.warnings, ...input.cadenceDiagnostics])].sort(),
  };
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
    ...(sourceEvidence.historicalTeamContextFingerprint !== undefined ? {
      historicalTeamContextFingerprint: sourceEvidence.historicalTeamContextFingerprint,
      periodTeamContextConflicts: sourceEvidence.periodTeamContextConflicts ?? {},
    } : {}),
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
    const missingRow = evidence.kind === 'missing-provider-row' ? evidence
      : evidence.kind === 'assumed-nonparticipation' && evidence.basis?.kind === 'missing-provider-row'
        ? evidence.basis : null;
    return stableJson(actualIneligibility) !== stableJson(expected.absentIneligibilityEvidence)
      || missingRow !== null && missingRow.inventoryFingerprint !== inventoryResult.inventory.fingerprint;
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
  const evidenceFailures = validateAllPlayerObservationEvidence(observation);
  if (evidenceFailures.length) return unavailable(mode, period, 'observation-evidence-invalid', {
    projectionCoverage, diagnostics: evidenceFailures,
  });
  const participation = { diagnostics: [...(input.cadenceDiagnostics ?? [])] };
  const invalidStats = observation.entries.flatMap((entry) => Object.entries(entry.stats)
    .filter(([, value]) => !Number.isFinite(value))
    .map(([key]) => `invalid-stat:${entry.providerExternalId}:${key}`));
  if (invalidStats.length) return unavailable(mode, period, 'score-unsupported-scoring', {
    projectionCoverage, diagnostics: invalidStats,
  });
  // Reject malformed shared payloads before any storage or league work.
  prepareAllPlayerBatch({ observation, scoreSets: [], verifiedAt: dependencies.clock.now().toISOString() });
  if (observation.quality !== 'complete' || observation.coverage.complete !== true) {
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
          diagnostics: participation.diagnostics,
        });
      }
      input.progress.statObservationId = stored.value.statObservationId;
      input.progress.entryCount = stored.value.entryCount;
      if (mode === 'recurring') return {
        status: 'partial', mode, period, reason: 'provider-coverage-incomplete',
        sourceRevision: observation.sourceRevision, projectionCoverage,
        persistedObservation: true, statObservationId: stored.value.statObservationId,
        entryCount: observation.entries.length, scoringProfileCount: 0,
        eligibleGameCount: observation.entries.reduce((total, entry) => total + (entry.eligibleGameCount ?? 0), 0),
        appearanceGameCount: observation.entries.reduce((total, entry) => total + (entry.appearanceGameCount ?? 0), 0),
        warnings: observation.warnings,
        ...prepareAllPlayerDiagnostics(participation.diagnostics),
      };
      return unavailable(mode, period, 'provider-coverage-incomplete', {
        sourceRevision: observation.sourceRevision,
        projectionCoverage,
        persistedObservation: true,
        statObservationId: stored.value.statObservationId,
        diagnostics: participation.diagnostics,
      });
    }
    return unavailable(mode, period, 'provider-coverage-incomplete', {
      sourceRevision: observation.sourceRevision,
      projectionCoverage,
      diagnostics: participation.diagnostics,
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
  // Save the shared evidence before loading or validating a fantasy league.
  let storedCaptureId: string | null = null;
  if (mode !== 'shadow') {
    await input.checkpoint('shared-capture-persistence', true);
    const stored = await dependencies.store.recordAllPlayerBatch({
      fence: input.fence, observation, scoreSets: [],
      verifiedAt: dependencies.clock.now().toISOString(),
    });
    if (stored.kind !== 'stored' || stored.value.entryCount !== observation.entries.length
      || stored.value.scoreSets.length !== 0) {
      return unavailable(mode, period, 'shared-capture-persistence-incomplete', { projectionCoverage });
    }
    storedCaptureId = stored.value.statObservationId;
    input.progress.statObservationId = storedCaptureId;
    input.progress.entryCount = stored.value.entryCount;
  }

  if (mode !== 'shadow') {
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
  }
  const scoreContents = new Map<string, Promise<Awaited<ReturnType<typeof buildAllPlayerScoreContent>>>>();
  const persistedContents = new Map<string, ReturnType<AllPlayerStore['recordAllPlayerScoreContent']>>();
  const acceptedSets = new Map<string, AllPlayerScoreSet>();
  let parityComparisonCount = 0;
  const outcomes = await mapWithConcurrency(configurations, 8, async (configuration): Promise<AllPlayerLeagueOutcome> => {
    try {
      await input.checkpoint('league-validation');
      const league = await loadValidatedLeague(dependencies, configuration, period, schedule);
      // A league's official points may invalidate an assumed nonparticipation
      // result for that league. They never rewrite a capture used by its peers.
      const participation = reconcileNonParticipationAssumptions(observation, [league]);
      if (participation.failures.length || participation.diagnostics.length) {
        throw new Error('league-participation-conflict');
      }
      const key = `${league.scoringProfileId}:${hash(league.rawRules)}`;
      let content = scoreContents.get(key);
      if (!content) {
        content = buildAllPlayerScoreContent({ observation,
          profile: { scoringProfileId: league.scoringProfileId, rawRules: league.rawRules },
          scorerVersion: ALL_PLAYER_SCORER_VERSION, supportedRuleKeys: SLEEPER_ALL_PLAYER_SCORING_RULE_KEYS,
          resolveIdentity: (entry) => ({ scoringEntityId: entryIds.get(entry.providerExternalId) ?? null, conflict: false }),
        }).then((built) => {
          if (built.status === 'available') prepareAllPlayerBatch({ observation, scoreSets: [built.scoreSet],
            verifiedAt: dependencies.clock.now().toISOString() }, true);
          return built;
        });
        scoreContents.set(key, content);
      }
      const built = await content;
      if (built.status !== 'available') throw new Error(`score-${built.reason}`);
      const plannedId = shadowObservationId(configuration.key, league.state.sourceRevision, observation.sourceRevision);
      const parity = await validateLeagueAllPlayerParity({ scoreSet: built.scoreSet,
        profile: scoringProfiles([league], new Map([[configuration.key, plannedId]]))[0] });
      if (parity.status !== 'available') throw new Error(`score-${parity.reason}`);
      const officialInput = officialObservationInput(league, observation);
      prepareLeagueWeekObservation(officialInput);
      if (mode === 'shadow') {
        acceptedSets.set(key, built.scoreSet);
        parityComparisonCount += league.official.entityCount;
        return { leagueKey: configuration.key, leagueSeasonId: league.leagueSeasonId, status: 'accepted' };
      }
      await input.checkpoint('league-score-content', true);
      let persistence = persistedContents.get(key);
      if (!persistence) {
        persistence = dependencies.store.recordAllPlayerScoreContent({ fence: input.fence!, observation,
          scoreSet: built.scoreSet, verifiedAt: dependencies.clock.now().toISOString() });
        persistedContents.set(key, persistence);
      }
      const stored = await persistence;
      if (stored.kind !== 'stored' || stored.value.statObservationId !== storedCaptureId) {
        throw new Error('score-content-persistence-incomplete');
      }
      await input.checkpoint('league-official-observation', true);
      const official = await dependencies.store.recordLeagueWeekObservation(officialInput);
      if (official.kind !== 'stored' || official.value.playerPointsStored !== officialInput.playerPoints.length
        || official.value.rosterPointsStored !== officialInput.rosterPoints.length
        || official.value.unmappedSleeperPlayerIds.length > 0) throw new Error('official-observation-incomplete');
      await input.checkpoint('league-publication', true);
      const accepted = await dependencies.store.acceptAllPlayerLeagueScore({ fence: input.fence!,
        statObservationId: storedCaptureId!, scoreSetId: stored.value.scoreSetId,
        leagueSeasonId: league.leagueSeasonId, officialObservationId: official.value.observationId,
        verifiedAt: dependencies.clock.now().toISOString() });
      if (accepted.kind !== 'stored') throw new Error('league-publication-incomplete');
      if (accepted.value.pointerOutcome === 'superseded') throw new Error('old-observation-rejected');
      acceptedSets.set(key, built.scoreSet);
      parityComparisonCount += league.official.entityCount;
      const outcome: AllPlayerLeagueOutcome = { leagueKey: configuration.key, leagueSeasonId: league.leagueSeasonId, scoringProfileId: league.scoringProfileId, status: 'accepted',
        acceptanceId: accepted.value.acceptanceId, pointerOutcome: accepted.value.pointerOutcome };
      input.progress.outcomes.push(outcome);
      return outcome;
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      const reason = /^[a-z][a-z0-9-]{1,95}$/u.test(message) ? message : 'league-processing-failed';
      const outcome: AllPlayerLeagueOutcome = { leagueKey: configuration.key, status: 'failed', reason };
      input.progress.outcomes.push(outcome);
      return outcome;
    }
  });
  const existingKeys = new Set(outcomes.map((outcome) => outcome.leagueKey));
  for (const failure of dependencies.leagueRegistry.registration?.failures ?? []) {
    if (!existingKeys.has(failure.leagueKey)) {
      outcomes.push({ leagueKey: failure.leagueKey, status: 'failed', reason: `registration-${failure.reason}` });
      existingKeys.add(failure.leagueKey);
    }
  }
  for (const leagueKey of input.unavailableLeagueKeys ?? []) {
    if (!existingKeys.has(leagueKey)) {
      outcomes.push({ leagueKey, status: 'failed', reason: 'league-authority-unavailable' });
      existingKeys.add(leagueKey);
    }
  }
  for (const configuration of allConfigurations) {
    if (!existingKeys.has(configuration.key)) outcomes.push({ leagueKey: configuration.key, status: 'deferred', reason: 'different-period' });
  }
  return {
    ...completedEvidence(mode, period, observation, [...acceptedSets.values()], projectionCoverage),
    parityComparisonCount,
    persisted: mode !== 'shadow', statObservationId: storedCaptureId,
    pointerOutcomes: outcomes.flatMap((outcome) => outcome.pointerOutcome ? [outcome.pointerOutcome] : []),
    acceptedLeagues: outcomes.filter((outcome) => outcome.status === 'accepted').length,
    failedLeagues: outcomes.filter((outcome) => outcome.status === 'failed').length,
    leagueOutcomes: outcomes,
  };

}

export async function runAllPlayerIngestion(
  dependencies: AllPlayerIngestionDependencies,
  input: Readonly<{
    mode: AllPlayerIngestionMode;
    period: LeaguePeriod;
    requireFinalCoverage?: boolean;
    cadenceDiagnostics?: readonly string[];
    eligibleLeagueKeys?: readonly string[];
    unavailableLeagueKeys?: readonly string[];
  }>,
): Promise<AllPlayerIngestionResult> {
  const { mode, period } = input;
  assertPeriod(period);
  if (input.cadenceDiagnostics?.some((value) => !/^(?:final-capture-overdue|correction-window-(?:period|schedule)-unavailable):\d{4}:regular:(?:[1-9]|1[0-8])$/u.test(value))) {
    throw new Error('All-player cadence diagnostics are invalid.');
  }
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
  const progress: AllPlayerProgress = { statObservationId: null, entryCount: 0, outcomes: [] };
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
          ...(mode === 'recurring' && dependencies.sharedCaptureReceipt?.(period)
            ? { captureReceipt: dependencies.sharedCaptureReceipt(period) } : {}),
        });
        if (claim.kind === 'disabled') return { status: 'disabled', mode };
        if (claim.kind !== 'acquired') {
          claimRetryAt = claim.nextRequestAt;
          return { status: 'skipped', mode, period, reason: claim.kind };
        }
        fence = claim.fence;
      }
      return execute({ ...dependencies, signal }, { ...input, fence, checkpoint, progress });
    };
    const remainingMs = Math.max(1, Date.parse(deadlineAt) - dependencies.clock.now().getTime());
    result = await Promise.race([operation(), new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        stopped = true;
        controller.abort();
        reject(new Error('deadline-exceeded'));
      }, remainingMs);
    })]);
    if (result.status === 'unavailable') result = { ...result, stage: result.stage ?? stage,
      ...(progress.statObservationId ? { persistedObservation: true, statObservationId: progress.statObservationId } : {}) };
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const code = error !== null && typeof error === 'object' && 'code' in error
      && typeof error.code === 'string' && Object.prototype.hasOwnProperty.call(SQL_FAILURE_REASONS, error.code)
      ? error.code as keyof typeof SQL_FAILURE_REASONS : null;
    const reason = message === 'deadline-exceeded' || signal.aborted ? 'timeout'
      : message === 'lease-lost' ? 'lease-lost'
      : code ? SQL_FAILURE_REASONS[code]
      : error !== null && typeof error === 'object' && 'code' in error ? 'stage-failed'
      : /^[a-z][a-z0-9-]{1,95}$/u.test(message) ? message : 'stage-failed';
    const diagnostics = [
      ...(error instanceof AllPlayerPreflightError ? error.diagnostics : []),
      ...(code ? [`database-sqlstate:${code}`] : []),
    ];
    result = unavailable(mode, period, reason, { stage,
      ...(progress.statObservationId ? { persistedObservation: true, statObservationId: progress.statObservationId } : {}),
      ...(progress.outcomes.some((outcome) => outcome.status === 'accepted') ? { confirmedPublication: {
        statObservationId: progress.statObservationId, entryCount: progress.entryCount,
        scoringProfileCount: new Set(progress.outcomes.filter((outcome) => outcome.status === 'accepted')
          .map((outcome) => outcome.scoringProfileId)).size,
        pointerOutcomes: progress.outcomes.flatMap((outcome) => outcome.pointerOutcome ? [outcome.pointerOutcome] : []),
      } } : {}),
      ...(diagnostics.length ? { diagnostics } : {}),
    });
  } finally {
    if (timeout) clearTimeout(timeout);
    stopped = true;
    controller.abort();
  }
  if (fence && mode !== 'shadow') {
    const retainedEvidence = result.status === 'completed' && result.persisted && result.statObservationId ? {
      persistedObservation: true, statObservationId: result.statObservationId,
      ...(result.acceptedLeagues > 0 && result.pointerOutcomes.length > 0 ? { confirmedPublication: {
        statObservationId: result.statObservationId, pointerOutcomes: result.pointerOutcomes,
        entryCount: result.entryCount, scoringProfileCount: result.scoringProfileCount,
      } } : {}),
    } : result.status === 'unavailable' && result.confirmedPublication ? {
      confirmedPublication: result.confirmedPublication,
      persistedObservation: result.persistedObservation, statObservationId: result.statObservationId,
    } : (result.status === 'unavailable' || result.status === 'partial') && result.persistedObservation ? {
      persistedObservation: true, statObservationId: result.statObservationId,
    } : {};
    const noStatisticsYet = result.status === 'skipped' && result.reason === 'no-statistics-yet' ? result : null;
    const outcome = result.status === 'completed' ? 'published'
      : noStatisticsYet ? 'no-statistics-yet'
      : result.status === 'unavailable' && ['old-observation-rejected', 'profile-publication-inconsistent'].includes(result.reason)
        ? 'validation-failed'
      : result.status === 'partial' || result.status === 'unavailable' && result.persistedObservation ? 'partial'
      : result.status === 'unavailable' && result.reason === 'timeout' ? 'timeout'
      : result.status === 'unavailable' && result.reason === 'lease-lost' ? 'lease-lost'
      : stage === 'weekly-stat-request' ? 'provider-failed' : 'validation-failed';
    const cleanup = dependencies.cleanupStore ?? dependencies.store;
    const resultDiagnostics = result.status === 'unavailable' || result.status === 'partial'
      ? result.diagnostics ?? [] : noStatisticsYet ? responseDiagnostics(noStatisticsYet.responseEvidence) : [];
    const extraDiagnostics = (input.cadenceDiagnostics ?? []).filter((value) => !resultDiagnostics.includes(value));
    const outcomeDiagnostics = prepareAllPlayerDiagnostics([...extraDiagnostics, ...resultDiagnostics]);
    const diagnosticCount = (result.status === 'unavailable' || result.status === 'partial'
      ? result.diagnosticCount ?? resultDiagnostics.length : resultDiagnostics.length) + extraDiagnostics.length;
    let cleanupTimeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const finished = await Promise.race([
        cleanup.finishAllPlayerJob({ fence, outcome,
          ...(noStatisticsYet ? { sharedPregame: true } : {}),
          ...(progress.statObservationId ? { scopedCapture: { statObservationId: progress.statObservationId } } : {}),
          diagnostic: {
          stage, period, reason: result.status === 'unavailable' || result.status === 'partial'
            || result.status === 'skipped' ? result.reason : result.status,
          ...(diagnosticCount ? {
            diagnostics: outcomeDiagnostics.diagnostics, diagnosticCount,
          } : {}),
          retryDisposition: 'global-budget',
          ...(result.status === 'completed' ? { acceptedLeagueCount: result.acceptedLeagues, failedLeagueCount: result.failedLeagues,
            leagueFailures: prepareAllPlayerDiagnostics(result.leagueOutcomes.filter((outcome) => outcome.status !== 'accepted')
              .map((outcome) => `${outcome.leagueKey}:${outcome.status}:${outcome.reason}`)).diagnostics } : {}),
          finalCoverage: result.status === 'completed'
            && (input.requireFinalCoverage ?? mode !== 'recurring'),
          ...(result.status === 'unavailable' && result.responseEvidence
            ? { responseEvidence: result.responseEvidence } : {}),
          ...(noStatisticsYet ? { responseEvidence: noStatisticsYet.responseEvidence,
            pregameEvidence: noStatisticsYet.pregameEvidence,
            entryCount: 0, scoringProfileCount: 0 } : {}),
          ...(result.status === 'completed' || result.status === 'partial' ? { entryCount: result.entryCount,
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
  dependencies.logger.write(result.status === 'completed' && result.failedLeagues === 0 || result.status === 'partial'
    || result.status === 'skipped' && result.reason === 'no-statistics-yet' ? 'info' : 'warn', {
    stage: 'all-player-ingestion', lane: 'all-player',
    outcome: result.status === 'completed' || result.status === 'partial' ? 'completed'
      : result.status === 'skipped' ? 'skipped' : 'failed',
    runId, period, cadence: mode,
    stageDurationMs: Math.max(0, dependencies.clock.monotonicNow() - startedAt),
    ...(result.status === 'completed' ? { publishedLeagues: result.acceptedLeagues, failedLeagues: result.failedLeagues,
      allPlayerDiagnostics: prepareAllPlayerDiagnostics(result.leagueOutcomes.filter((outcome) => outcome.status !== 'accepted')
        .map((outcome) => `${outcome.leagueKey}:${outcome.status}:${outcome.reason}`)).diagnostics } : {}),
    ...(result.status === 'unavailable' ? {
      allPlayerFailureStage: result.stage ?? stage,
      allPlayerReason: result.reason,
      allPlayerDiagnosticCount: result.diagnosticCount ?? result.diagnostics?.length ?? 0,
      allPlayerDiagnostics: result.diagnostics ?? [],
      allPlayerPersistedObservation: result.persistedObservation === true,
      allPlayerConfirmedPublication: result.confirmedPublication !== undefined,
      allPlayerRetryDisposition: result.confirmedPublication ? 'inspect-before-retry' as const : 'global-budget' as const,
    } : result.status === 'partial' ? {
      allPlayerReason: 'partial-observation-retained',
      allPlayerDiagnosticCount: result.diagnosticCount,
      allPlayerDiagnostics: result.diagnostics,
      allPlayerPersistedObservation: true, allPlayerConfirmedPublication: false,
      allPlayerEntryCount: result.entryCount, allPlayerScoringProfileCount: 0,
      allPlayerEligibleGameCount: result.eligibleGameCount,
      allPlayerRetryDisposition: 'global-budget' as const,
      fullSlateWarnings: result.warnings,
      allPlayerRankUnavailablePositions: result.projectionCoverage.rankUnavailablePositions,
    } : result.status === 'skipped' ? { allPlayerReason: result.reason,
      ...(result.reason === 'no-statistics-yet' ? {
        allPlayerDiagnostics: responseDiagnostics(result.responseEvidence),
        allPlayerDiagnosticCount: responseDiagnostics(result.responseEvidence).length,
        allPlayerPersistedObservation: false, allPlayerConfirmedPublication: false,
        allPlayerEntryCount: 0, allPlayerScoringProfileCount: 0,
        allPlayerRetryDisposition: 'global-budget' as const,
      } : {}),
    } : {}),
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
      fullSlateWarnings: result.warnings,
    } : {}),
  });
  return result;
}

export function allPlayerIdentityInput(entry: AllPlayerStatEntry): AllPlayerIdentityLookup {
  return { provider: 'sleeper', entityKind: entry.entityKind, externalId: entry.providerExternalId };
}
