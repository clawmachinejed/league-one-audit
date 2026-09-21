import 'server-only';

import { createSleeperWeeklyStatSource, validateSleeperWeeklyStatsResponse,
  type SleeperWeeklyStatCapture, type SleeperAllPlayerStatResponseEvidence,
  type ValidatedSleeperWeeklyRow } from './weekly-stat-source';

import { createHash } from 'node:crypto';
import { canonicalNflTeam } from '../../../nfl-teams';
import type { PlayerCatalog, SleeperMatchup } from '../../../transform';
import { classifySleeperCatalogIdentity } from '../../../sleeper-player-catalog';
import { NFL_TEAM_CODES } from '../../domain/contracts';
import type { AllPlayerHistoricalTeamContext, AllPlayerTeamContextConflict } from '../../domain/all-player-team-context';
import {
  allPlayerEligibilityCounts, allPlayerEvidenceMatchesPeriod,
  ALL_PLAYER_INDIVIDUAL_SNAP_KEYS, hasAllPlayerWeeklyParticipationConflict,
  isAllPlayerAssumedNonParticipation,
  isAllPlayerEffectivePeriod, isAllPlayerPeriodParticipation,
  type AllPlayerEffectivePeriod, type AllPlayerPeriodParticipationEvidence,
} from '../../domain/all-player-eligibility';
import {
  ALL_PLAYER_POSITIONS,
  type AllPlayerExplicitIneligibilityEvidence,
  type AllPlayerEligibilityEvidence,
  type AllPlayerGamePhase,
  type AllPlayerPosition,
  type AllPlayerStatEntry,
  type AllPlayerStatObservation,
} from '../../domain/all-player-statistics';

export const ALL_PLAYER_STAT_NORMALIZER_VERSION = 'sleeper-weekly-stats-v4';
const positionSet = new Set<string>(ALL_PLAYER_POSITIONS);

type TeamGame = Readonly<{
  nflGameId: string;
  phase: AllPlayerGamePhase;
}>;

export type SleeperExplicitIneligibilityEvidence = AllPlayerExplicitIneligibilityEvidence;

export type SleeperExpectedAllPlayerEntity = Readonly<{
  entityKind: 'player' | 'team_defense';
  providerExternalId: string;
  nflTeam: string | null;
  position: AllPlayerPosition;
  absentIneligibilityEvidence: SleeperExplicitIneligibilityEvidence | null;
  periodEligibilityEvidence?: AllPlayerPeriodParticipationEvidence | null;
  requirement?: 'required-official' | 'catalog-inventory';
}>;

export type SleeperPeriodInventoryEvidence = Readonly<{
  source: 'official-period-inventory' | 'manual-review';
  sourceRevision: string;
  observedAt: string;
  effectivePeriod: AllPlayerEffectivePeriod;
  /** Each excluded fantasy identity requires an exact-period scope reason. */
  excludedPlayerReasons: Readonly<Record<string, string>>;
  teamsByPlayerId: Readonly<Record<string, string | null>>;
}>;

export type SleeperAllPlayerInventory = Readonly<{
  fingerprint: string;
  entities: readonly SleeperExpectedAllPlayerEntity[];
  sourceEvidence: Readonly<{
    catalogRevision: string;
    scheduleRevision: string;
    rosteredPlayerIds: readonly string[];
    projectionPlayerIds: readonly string[];
    byeTeamIds: readonly string[];
    period?: AllPlayerEffectivePeriod;
    observedAt?: string;
    periodInventoryEvidence?: SleeperPeriodInventoryEvidence;
    catalogResponseClassifications?: Readonly<Record<string, 'fantasy' | 'out-of-scope'>>;
    unresolvedOptionalProjectionIds?: readonly string[];
    catalogRoleDiagnostics?: Readonly<Record<string, Readonly<{
      primaryPosition: string | null;
      fantasyPositions: readonly string[];
      representativePosition: AllPlayerPosition;
    }>>>;
    historicalTeamContextFingerprint?: string;
    periodTeamContextConflicts?: Readonly<Record<string, AllPlayerTeamContextConflict>>;
  }>;
}>;

export type SleeperAllPlayerInventoryResult =
  | Readonly<{ status: 'available'; inventory: SleeperAllPlayerInventory }>
  | Readonly<{ status: 'unavailable'; reason: 'catalog' | 'schedule' | 'identity'
      | 'eligibility-evidence-conflict'; diagnostics?: readonly string[] }>;

export type SleeperAllPlayerStatRequest = Readonly<{
  season: number;
  week: number;
  inventory: SleeperAllPlayerInventory;
  gamesByTeam: Readonly<Record<string, TeamGame>>;
  requireFinalCoverage?: boolean;
  /** Reuse the exact shared request; never issues a second network request. */
  capture?: SleeperWeeklyStatCapture;
  signal?: AbortSignal;
}>;

export type { SleeperAllPlayerStatResponseEvidence } from './weekly-stat-source';

export type SleeperAllPlayerStatResult =
  | Readonly<{ status: 'available'; observation: AllPlayerStatObservation }>
  | Readonly<{ status: 'empty'; reason: 'empty-object';
      responseEvidence: SleeperAllPlayerStatResponseEvidence }>
  | Readonly<{
      status: 'unavailable';
      reason: 'http' | 'malformed';
      statusCode?: number;
      responseEvidence?: SleeperAllPlayerStatResponseEvidence;
    }>;

export type SleeperOfficialRosteredPointsResult =
  | Readonly<{ status: 'available'; points: readonly Readonly<{
      providerExternalId: string;
      points: number;
    }>[]; entityCount: number; rosterCount: number; rosterIds: readonly string[];
      fingerprint: string }>
  | Readonly<{ status: 'unavailable'; reason: 'missing' | 'invalid' | 'ambiguous' }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (isRecord(value)) return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
  return JSON.stringify(value);
}

function expectedEligibility(
  row: ValidatedSleeperWeeklyRow | undefined,
  explicitIneligibility: SleeperExplicitIneligibilityEvidence | null,
  inventoryFingerprintValue: string,
  periodEvidence?: AllPlayerPeriodParticipationEvidence | null,
): Readonly<{
  eligibleGameCount: 0 | 1 | null;
  appearanceGameCount: 0 | 1 | null;
  eligibilityEvidence: AllPlayerEligibilityEvidence;
}> {
  if (periodEvidence) {
    const eligibilityEvidence = { ...periodEvidence, ...(row ? { weekly: row.weekly } : {}) };
    return { ...allPlayerEligibilityCounts(eligibilityEvidence)!, eligibilityEvidence };
  }
  if (!row) return explicitIneligibility
    ? {
        eligibleGameCount: 0, appearanceGameCount: 0,
        eligibilityEvidence: explicitIneligibility,
      }
    : {
        eligibleGameCount: null, appearanceGameCount: null,
        eligibilityEvidence: {
          kind: 'missing-provider-row', inventoryFingerprint: inventoryFingerprintValue,
        },
      };
  const weekly = allPlayerEligibilityCounts(row.weekly)!;
  if (!explicitIneligibility) return { ...weekly, eligibilityEvidence: row.weekly };
  const conflict = weekly.eligibleGameCount === 1 || weekly.appearanceGameCount === 1
    || hasAllPlayerWeeklyParticipationConflict(row.weekly);
  const eligibilityEvidence: AllPlayerEligibilityEvidence = {
    kind: conflict ? 'conflict' : 'combined-ineligible',
    weekly: row.weekly,
    ineligibility: explicitIneligibility,
  };
  if (conflict) {
    return { eligibleGameCount: null, appearanceGameCount: null, eligibilityEvidence };
  }
  return { eligibleGameCount: 0, appearanceGameCount: 0, eligibilityEvidence };
}

function evidenceFingerprint(value: unknown): string {
  return `sha256:${createHash('sha256').update(stableJson(value)).digest('hex')}`;
}

function inventoryFingerprint(
  entities: readonly SleeperExpectedAllPlayerEntity[],
  gamesByTeam: Readonly<Record<string, TeamGame>>,
  sourceEvidence: SleeperAllPlayerInventory['sourceEvidence'],
): string {
  // Inventory assembly time is retrieval provenance, not inventory material.
  // Reviewed participation/inventory source timestamps remain untouched.
  const { observedAt, ...materialSourceEvidence } = sourceEvidence;
  void observedAt;
  return `sha256:${createHash('sha256').update(stableJson({
    entities, gamesByTeam, sourceEvidence: materialSourceEvidence,
  })).digest('hex')}`;
}

/** Builds the complete target inventory from reused catalog, roster, projection,
 * schedule, and reviewed ineligibility evidence. No provider request occurs. */
export function buildSleeperAllPlayerInventory(input: Readonly<{
  catalog: PlayerCatalog;
  catalogComplete: boolean;
  catalogRevision: string;
  rosteredPlayerIds: readonly string[];
  projectionPlayerIds: readonly string[];
  gamesByTeam: Readonly<Record<string, TeamGame>>;
  byeTeamIds: readonly string[];
  scheduleRevision: string;
  ineligibilityEvidenceByPlayerId?: Readonly<Record<string, SleeperExplicitIneligibilityEvidence>>;
  periodEligibilityEvidenceByPlayerId?: Readonly<Record<string, AllPlayerPeriodParticipationEvidence>>;
  period?: AllPlayerEffectivePeriod;
  observedAt?: string;
  /** Observation time of the exact-period schedule source, when retained.
   * Reusing its revision must reuse this time, not the inventory assembly time. */
  scheduleObservedAt?: string;
  periodInventoryEvidence?: SleeperPeriodInventoryEvidence;
  /** Negative evidence only: disagreement prevents a current-team game guess. */
  historicalTeamContexts?: readonly AllPlayerHistoricalTeamContext[];
}>): SleeperAllPlayerInventoryResult {
  const catalogRevision = input.catalogRevision.trim();
  const scheduleRevision = input.scheduleRevision.trim();
  if (!input.catalogComplete || !catalogRevision) {
    return { status: 'unavailable', reason: 'catalog' };
  }
  if (!scheduleRevision) return { status: 'unavailable', reason: 'schedule' };
  if (input.period !== undefined && !isAllPlayerEffectivePeriod(input.period)) {
    return { status: 'unavailable', reason: 'schedule' };
  }
  if (input.observedAt !== undefined && !Number.isFinite(Date.parse(input.observedAt))) {
    return { status: 'unavailable', reason: 'schedule' };
  }
  const scheduleObservedAt = input.scheduleObservedAt ?? input.observedAt;
  if (scheduleObservedAt !== undefined && (!Number.isFinite(Date.parse(scheduleObservedAt))
    || (input.observedAt && Date.parse(scheduleObservedAt) > Date.parse(input.observedAt)))) {
    return { status: 'unavailable', reason: 'schedule' };
  }
  const periodEvidence = input.periodInventoryEvidence;
  if (periodEvidence && (!input.period
    || !['official-period-inventory', 'manual-review'].includes(periodEvidence.source)
    || !allPlayerEvidenceMatchesPeriod(periodEvidence, input.period)
    || !isRecord(periodEvidence.excludedPlayerReasons) || !isRecord(periodEvidence.teamsByPlayerId)
    || Object.entries(periodEvidence.excludedPlayerReasons).some(([id, reason]) => (
      !id.trim() || typeof reason !== 'string' || !reason.trim()
    )) || Object.entries(periodEvidence.teamsByPlayerId).some(([id, team]) => (
      !id.trim() || (team !== null && canonicalNflTeam(team) !== team)
    )))) return { status: 'unavailable', reason: 'identity' };
  const historicalContexts = [...(input.historicalTeamContexts ?? [])].sort((left, right) => (
    `${left.providerExternalId}\0${left.nflTeam}`.localeCompare(`${right.providerExternalId}\0${right.nflTeam}`)
  ));
  const historicalKeys = new Set<string>();
  if (historicalContexts.length > 10_000 || historicalContexts.some((context) => {
    const key = `${context.providerExternalId}\0${context.nflTeam}`;
    const invalid = !input.period || !context.providerExternalId.trim()
      || context.providerExternalId.trim() !== context.providerExternalId
      || canonicalNflTeam(context.nflTeam) !== context.nflTeam
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(context.sourceObservationId)
      || typeof context.hasUnresolvedConflict !== 'boolean'
      || !isAllPlayerEffectivePeriod(context.effectivePeriod)
      || context.effectivePeriod.season !== input.period.season
      || context.effectivePeriod.seasonType !== input.period.seasonType
      || context.effectivePeriod.week !== input.period.week
      || !Number.isFinite(Date.parse(context.observedAt))
      || new Date(context.observedAt).toISOString() !== context.observedAt
      || (input.observedAt !== undefined && Date.parse(context.observedAt) > Date.parse(input.observedAt))
      || historicalKeys.has(key);
    historicalKeys.add(key);
    return invalid;
  })) return { status: 'unavailable', reason: 'identity', diagnostics: ['invalid-historical-team-context'] };
  const historicalByPlayer = new Map<string, AllPlayerHistoricalTeamContext[]>();
  for (const context of historicalContexts) {
    const contexts = historicalByPlayer.get(context.providerExternalId) ?? [];
    contexts.push(context);
    historicalByPlayer.set(context.providerExternalId, contexts);
  }
  const periodTeamContextConflicts: Record<string, AllPlayerTeamContextConflict> = {};
  const byeTeams = new Set(input.byeTeamIds.map(canonicalNflTeam));
  if (byeTeams.has(null)) return { status: 'unavailable', reason: 'schedule' };
  if (Object.entries(input.gamesByTeam).some(([team, game]) => (
    canonicalNflTeam(team) !== team || !game.nflGameId.trim()
    || !['live', 'final', 'unknown'].includes(game.phase)
  ))) return { status: 'unavailable', reason: 'schedule' };
  if ([...byeTeams].some((team) => team !== null && input.gamesByTeam[team])) {
    return { status: 'unavailable', reason: 'schedule' };
  }
  if (NFL_TEAM_CODES.some((team) => !input.gamesByTeam[team] && !byeTeams.has(team))) {
    return { status: 'unavailable', reason: 'schedule' };
  }
  const canonicalTeamDefenseIds = new Set<string>(NFL_TEAM_CODES);
  const forcedPlayerIds = new Set([
    ...input.rosteredPlayerIds.map((id) => id.trim()),
  ].filter((id) => !canonicalTeamDefenseIds.has(id)));
  if (forcedPlayerIds.has('')) return { status: 'unavailable', reason: 'identity' };
  const requiredPlayerIds = new Set(forcedPlayerIds);
  const optionalProjectionIds = new Set(input.projectionPlayerIds.map((id) => id.trim()));
  const catalogResponseClassifications: Record<string, 'fantasy' | 'out-of-scope'> = {};
  const catalogRoleDiagnostics: Record<string, {
    primaryPosition: string | null; fantasyPositions: readonly string[]; representativePosition: AllPlayerPosition;
  }> = {};
  const entities: SleeperExpectedAllPlayerEntity[] = [];
  for (const [providerExternalId, player] of Object.entries(input.catalog)) {
    const classification = classifySleeperCatalogIdentity(input.catalog, providerExternalId);
    if (classification.status !== 'fantasy') {
      if (classification.status === 'out-of-scope') {
        if (typeof player.position === 'string' && player.position.trim()) {
          catalogResponseClassifications[providerExternalId] = 'out-of-scope';
        }
        continue;
      }
      return { status: 'unavailable', reason: 'identity' };
    }
    const position = classification.position;
    if (player.position !== position || (player.fantasy_positions?.length ?? 0) > 1) {
      catalogRoleDiagnostics[providerExternalId] = {
        primaryPosition: player.position ?? null, fantasyPositions: player.fantasy_positions ?? [],
        representativePosition: position,
      };
    }
    catalogResponseClassifications[providerExternalId] = 'fantasy';
    optionalProjectionIds.delete(providerExternalId);
    const excludedReason = periodEvidence?.excludedPlayerReasons[providerExternalId];
    if (excludedReason) {
      if (requiredPlayerIds.has(providerExternalId)) return { status: 'unavailable', reason: 'identity' };
      continue;
    }
    if (periodEvidence && !Object.prototype.hasOwnProperty.call(periodEvidence.teamsByPlayerId, providerExternalId)) {
      return { status: 'unavailable', reason: 'identity' };
    }
    const currentTeam = canonicalNflTeam(player.team);
    const retainedContexts = historicalByPlayer.get(providerExternalId) ?? [];
    const teamContextConflict = !periodEvidence && retainedContexts.some((context) => (
      context.hasUnresolvedConflict || context.nflTeam !== currentTeam
    ));
    if (teamContextConflict) periodTeamContextConflicts[providerExternalId] = {
      source: 'stored-all-player-observations', role: 'conflict-only', currentTeam, retainedContexts,
    };
    const nflTeam = periodEvidence
      ? canonicalNflTeam(periodEvidence.teamsByPlayerId[providerExternalId])
      : teamContextConflict ? null : currentTeam;
    const suppliedEvidence = input.ineligibilityEvidenceByPlayerId?.[providerExternalId];
    const participation = input.periodEligibilityEvidenceByPlayerId?.[providerExternalId];
    if ((suppliedEvidence && (!input.period || !allPlayerEvidenceMatchesPeriod(suppliedEvidence, input.period)
      || allPlayerEligibilityCounts(suppliedEvidence) === null))
      || (participation && (!input.period || !allPlayerEvidenceMatchesPeriod(participation, input.period)
        || !isAllPlayerPeriodParticipation(participation)))) {
      return { status: 'unavailable', reason: 'identity' };
    }
    const absentIneligibilityEvidence = suppliedEvidence ?? (
      periodEvidence && input.period && scheduleObservedAt && nflTeam && byeTeams.has(nflTeam)
        ? { kind: 'explicit-ineligible', reason: 'bye', source: 'schedule', sourceRevision: scheduleRevision,
          effectivePeriod: input.period, observedAt: scheduleObservedAt } as const
        : null
    );
    // Two reviewed inputs cannot assert both requested-period ineligibility and
    // participation. Keep their original manifests and reject this invalid
    // source configuration before requesting or interpreting weekly rows.
    // Contradictory provider flags remain valid partial raw observations.
    if (absentIneligibilityEvidence && participation
      && (participation.decision === 'appearance' || participation.decision === 'dressed-unused')) {
      return { status: 'unavailable', reason: 'eligibility-evidence-conflict', diagnostics: [
        `sleeper/${providerExternalId}:${requiredPlayerIds.has(providerExternalId) ? 'required-official' : 'catalog-inventory'}:reviewed-eligibility-conflict:${absentIneligibilityEvidence.reason}:${participation.decision}`,
      ] };
    }
    entities.push({
      entityKind: 'player', providerExternalId, nflTeam, position,
      absentIneligibilityEvidence,
      periodEligibilityEvidence: participation ?? null,
      requirement: requiredPlayerIds.has(providerExternalId) ? 'required-official' : 'catalog-inventory',
    });
    forcedPlayerIds.delete(providerExternalId);
  }
  if (forcedPlayerIds.size > 0) return { status: 'unavailable', reason: 'identity' };
  for (const team of NFL_TEAM_CODES) {
    entities.push({
      entityKind: 'team_defense', providerExternalId: team, nflTeam: team, position: 'DEF',
      requirement: 'required-official',
      absentIneligibilityEvidence: input.period && scheduleObservedAt && byeTeams.has(team)
        ? { kind: 'explicit-ineligible', reason: 'bye', source: 'schedule', sourceRevision: scheduleRevision,
          effectivePeriod: input.period, observedAt: scheduleObservedAt }
        : null,
    });
  }
  entities.sort((left, right) => (
    `${left.entityKind}\0${left.providerExternalId}`
      .localeCompare(`${right.entityKind}\0${right.providerExternalId}`)
  ));
  const sourceEvidence = {
    catalogRevision,
    scheduleRevision,
    rosteredPlayerIds: [...new Set(input.rosteredPlayerIds.map((id) => id.trim()))].sort(),
    projectionPlayerIds: [...new Set(input.projectionPlayerIds.map((id) => id.trim()))].sort(),
    byeTeamIds: [...byeTeams].flatMap((team) => team === null ? [] : [team]).sort(),
    ...(input.period ? { period: input.period } : {}),
    ...(input.observedAt ? { observedAt: input.observedAt } : {}),
    ...(periodEvidence ? { periodInventoryEvidence: periodEvidence } : {}),
    catalogResponseClassifications,
    catalogRoleDiagnostics,
    ...(input.historicalTeamContexts !== undefined ? {
      historicalTeamContextFingerprint: evidenceFingerprint(historicalContexts), periodTeamContextConflicts,
    } : {}),
    unresolvedOptionalProjectionIds: [...optionalProjectionIds]
      .filter((id) => !canonicalTeamDefenseIds.has(id)).sort(),
  };
  const inventory = {
    fingerprint: inventoryFingerprint(entities, input.gamesByTeam, sourceEvidence),
    entities,
    sourceEvidence,
  };
  return { status: 'available', inventory };
}

function validatedInventory(
  value: SleeperAllPlayerInventory,
  gamesByTeam: Readonly<Record<string, TeamGame>>,
): readonly SleeperExpectedAllPlayerEntity[] | null {
  if (!Array.isArray(value.entities) || value.entities.length === 0) return null;
  if (!value.sourceEvidence || !value.sourceEvidence.catalogRevision.trim()
    || !value.sourceEvidence.scheduleRevision.trim()
    || !Array.isArray(value.sourceEvidence.rosteredPlayerIds)
    || !Array.isArray(value.sourceEvidence.projectionPlayerIds)
    || !Array.isArray(value.sourceEvidence.byeTeamIds)) return null;
  const evidenceArrays = [
    value.sourceEvidence.rosteredPlayerIds,
    value.sourceEvidence.projectionPlayerIds,
    value.sourceEvidence.byeTeamIds,
  ];
  if (evidenceArrays.some((items) => items.some((item) => !item.trim())
    || new Set(items).size !== items.length
    || items.some((item, index) => index > 0 && items[index - 1].localeCompare(item) >= 0))) return null;
  if (value.sourceEvidence.byeTeamIds.some((team) => (
    canonicalNflTeam(team) !== team || gamesByTeam[team]
  ))) return null;
  if (value.sourceEvidence.historicalTeamContextFingerprint !== undefined
    && (!/^sha256:[0-9a-f]{64}$/u.test(value.sourceEvidence.historicalTeamContextFingerprint)
      || !isRecord(value.sourceEvidence.periodTeamContextConflicts))) return null;
  const keys = new Set<string>();
  const externalIds = new Set<string>();
  const defenses = new Set<string>();
  for (const entity of value.entities) {
    if (!entity.providerExternalId.trim() || !positionSet.has(entity.position)) return null;
    if (entity.absentIneligibilityEvidence) {
      const evidence = entity.absentIneligibilityEvidence;
      if (!value.sourceEvidence.period || allPlayerEligibilityCounts(evidence) === null
        || !allPlayerEvidenceMatchesPeriod(evidence, value.sourceEvidence.period)) return null;
    }
    if (entity.periodEligibilityEvidence && (!value.sourceEvidence.period
      || !isAllPlayerPeriodParticipation(entity.periodEligibilityEvidence)
      || !allPlayerEvidenceMatchesPeriod(entity.periodEligibilityEvidence, value.sourceEvidence.period))) return null;
    if (entity.entityKind === 'team_defense') {
      const team = canonicalNflTeam(entity.providerExternalId);
      if (!team || entity.position !== 'DEF' || entity.nflTeam !== team) return null;
      defenses.add(team);
    } else if (entity.position === 'DEF') return null;
    if (value.sourceEvidence.periodTeamContextConflicts?.[entity.providerExternalId]
      && (entity.entityKind !== 'player' || entity.nflTeam !== null)) return null;
    const key = `${entity.entityKind}\0${entity.providerExternalId}`;
    if (keys.has(key) || externalIds.has(entity.providerExternalId)) return null;
    keys.add(key);
    externalIds.add(entity.providerExternalId);
  }
  if (defenses.size !== NFL_TEAM_CODES.length
    || NFL_TEAM_CODES.some((team) => !defenses.has(team))) return null;
  return inventoryFingerprint(value.entities, gamesByTeam, value.sourceEvidence) === value.fingerprint
    ? value.entities : null;
}

/** Extracts the exact already-loaded players_points evidence without another request. */
export function sleeperOfficialRosteredPoints(
  matchups: readonly SleeperMatchup[],
  expectedRosterIds: readonly (number | string)[],
): SleeperOfficialRosteredPointsResult {
  const expectedRosters = expectedRosterIds.map(String).sort();
  if (expectedRosters.length === 0
    || new Set(expectedRosters).size !== expectedRosters.length
    || expectedRosters.some((id) => !id.trim())) {
    return { status: 'unavailable', reason: 'invalid' };
  }
  const points = new Map<string, number>();
  const rosters = new Set<string>();
  for (const matchup of matchups) {
    const rosterId = String(matchup.roster_id);
    if (!Number.isInteger(matchup.roster_id) || rosters.has(rosterId)
      || !Array.isArray(matchup.players) || matchup.players.some((id) => (
        typeof id !== 'string' || !id.trim()
      )) || new Set(matchup.players).size !== matchup.players.length) {
      return { status: 'unavailable', reason: 'invalid' };
    }
    rosters.add(rosterId);
    if (!isRecord(matchup.players_points)) return { status: 'unavailable', reason: 'missing' };
    const pointIds = Object.keys(matchup.players_points);
    const playerIds = [...matchup.players].sort();
    if (pointIds.length !== playerIds.length
      || pointIds.sort().some((id, index) => id !== playerIds[index])) {
      return { status: 'unavailable', reason: 'missing' };
    }
    for (const [externalId, value] of Object.entries(matchup.players_points)) {
      if (!externalId.trim() || typeof value !== 'number' || !Number.isFinite(value)) {
        return { status: 'unavailable', reason: 'invalid' };
      }
      if (points.has(externalId)) return { status: 'unavailable', reason: 'ambiguous' };
      points.set(externalId, value);
    }
  }
  const rosterIds = [...rosters].sort();
  if (rosterIds.length !== expectedRosters.length
    || rosterIds.some((id, index) => id !== expectedRosters[index])) {
    return { status: 'unavailable', reason: 'missing' };
  }
  const normalized = [...points].sort(([left], [right]) => left.localeCompare(right))
    .map(([providerExternalId, value]) => ({ providerExternalId, points: value }));
  return {
    status: 'available', points: normalized, entityCount: normalized.length,
    rosterCount: rosters.size, rosterIds,
    fingerprint: `sha256:${createHash('sha256').update(normalized
      .map((point) => `${point.providerExternalId}\u001f${String(point.points)}`).join('\n')).digest('hex')}`,
  };
}

/** One strict adapter for Sleeper's undocumented all-player weekly-stat route. */
export function createSleeperAllPlayerStatSource(dependencies: Readonly<{
  fetch: typeof fetch;
  now: () => Date;
}>) {
  const bulkSource = createSleeperWeeklyStatSource(dependencies);
  return {
    async load(input: SleeperAllPlayerStatRequest): Promise<SleeperAllPlayerStatResult> {
      if (!Number.isInteger(input.season) || input.season < 2026 || input.season > 2200
        || !Number.isInteger(input.week) || input.week < 1 || input.week > 18) {
        return { status: 'unavailable', reason: 'malformed' };
      }
      const expectedEntities = validatedInventory(input.inventory, input.gamesByTeam);
      if (!expectedEntities) return { status: 'unavailable', reason: 'malformed' };
      const period = input.inventory.sourceEvidence.period;
      if (period && (period.season !== input.season || period.week !== input.week
        || period.seasonType !== 'reg')) return { status: 'unavailable', reason: 'malformed' };
      const result = input.capture ? { status: 'available' as const, capture: input.capture }
        : await bulkSource.load({ season: input.season, seasonType: 'reg', week: input.week, signal: input.signal });
      if (result.status !== 'available') return result;
      const capture = result.capture;
      if (capture.period.season !== input.season || capture.period.seasonType !== 'reg'
        || capture.period.week !== input.week) return { status: 'unavailable', reason: 'malformed' };
      // Revalidate retained input at this boundary: replay never bypasses the
      // full inventory, participation, classification, or numeric checks.
      const validated = validateSleeperWeeklyStatsResponse(capture.raw);
      const loadedEvidence = capture.responseEvidence;
      if (!validated) return { status: 'unavailable', reason: 'malformed', responseEvidence: loadedEvidence };
      const requestStartedAt = loadedEvidence.requestStartedAt;
      const requestCompletedAt = loadedEvidence.requestCompletedAt;
      const warnings: string[] = [];
      const entries: AllPlayerStatEntry[] = [];
      const expectedIds = new Set(expectedEntities.map((entity) => entity.providerExternalId));
      const responseIds = Object.keys(validated);
      const excludedResponseIds = responseIds.filter((externalId) => {
        if (externalId.startsWith('TEAM_') && canonicalNflTeam(externalId.slice(5))) return true;
        if (expectedIds.has(externalId)) return false;
        return input.inventory.sourceEvidence.catalogResponseClassifications?.[externalId] === 'out-of-scope'
          || Boolean(input.inventory.sourceEvidence.periodInventoryEvidence?.excludedPlayerReasons[externalId]);
      });
      const unexpectedResponseIds = responseIds.filter((externalId) => (
        !expectedIds.has(externalId) && !excludedResponseIds.includes(externalId)
      )).sort();
      const unexpectedResponseEntityCount = unexpectedResponseIds.length;
      const excludedResponseEntityCount = excludedResponseIds.length;
      let providerPresentEntityCount = 0;
      for (const expected of expectedEntities) {
        const row = validated[expected.providerExternalId];
        if (expected.entityKind !== 'player' && row && (row.weekly.individualSnaps !== undefined
          || ALL_PLAYER_INDIVIDUAL_SNAP_KEYS.some((key) => row.weekly.rawFlags !== undefined
            && Object.prototype.hasOwnProperty.call(row.weekly.rawFlags, key)))) {
          return { status: 'unavailable', reason: 'malformed', responseEvidence: loadedEvidence };
        }
        if (row) providerPresentEntityCount += 1;
        const nflTeam = expected.nflTeam;
        const game = nflTeam ? input.gamesByTeam[nflTeam] : undefined;
        let evidence = expectedEligibility(
          row,
          expected.absentIneligibilityEvidence,
          input.inventory.fingerprint,
          expected.periodEligibilityEvidence,
        );
        if (expected.entityKind === 'player' && evidence.eligibleGameCount === null
          && evidence.appearanceGameCount === null
          && ['weekly-stat', 'missing-provider-row'].includes(evidence.eligibilityEvidence.kind)) {
          const assumption = {
            kind: 'assumed-nonparticipation', policy: 'missing-participation-as-zero-v1', source: 'product-policy',
            effectivePeriod: { season: input.season, seasonType: 'reg', week: input.week },
            basis: evidence.eligibilityEvidence,
          };
          if (isAllPlayerAssumedNonParticipation(assumption)) {
            evidence = { ...allPlayerEligibilityCounts(assumption)!, eligibilityEvidence: assumption };
          }
        }
        entries.push({
          entityKind: expected.entityKind,
          providerExternalId: expected.providerExternalId,
          nflGameId: game?.nflGameId ?? null,
          nflTeam,
          position: expected.position,
          stats: row?.stats ?? {},
          ...evidence,
          gamePhase: game?.phase ?? 'unknown',
        });
      }
      entries.sort((left, right) => (
        `${left.entityKind}\0${left.providerExternalId}`
          .localeCompare(`${right.entityKind}\0${right.providerExternalId}`)
      ));
      const unknownEligibilityCount = entries.filter((entry) => entry.eligibleGameCount === null).length;
      const unknownAppearanceCount = entries.filter((entry) => entry.appearanceGameCount === null).length;
      const assumedNonParticipationCount = entries.filter((entry) => entry.eligibilityEvidence.kind === 'assumed-nonparticipation').length;
      const unmappedGameCount = entries.filter((entry) => (
        entry.eligibleGameCount === 1 && entry.nflGameId === null
      )).length;
      const nonFinalEligibleCount = input.requireFinalCoverage
        ? entries.filter((entry) => (
            entry.eligibleGameCount === 1 && entry.gamePhase !== 'final'
          )).length : 0;
      const scheduledGamePhases = new Map<string, Set<AllPlayerGamePhase>>();
      for (const game of Object.values(input.gamesByTeam)) {
        const phases = scheduledGamePhases.get(game.nflGameId) ?? new Set<AllPlayerGamePhase>();
        phases.add(game.phase);
        scheduledGamePhases.set(game.nflGameId, phases);
      }
      const nonFinalScheduledGameCount = [...scheduledGamePhases.values()]
        .filter((phases) => phases.size !== 1 || !phases.has('final')).length;
      const scheduleFinalityComplete = scheduledGamePhases.size > 0
        && nonFinalScheduledGameCount === 0;
      const periodInventoryComplete = Boolean(period
        && input.inventory.sourceEvidence.periodInventoryEvidence);
      if (!periodInventoryComplete) warnings.push('period-inventory-unproven');
      if (input.requireFinalCoverage && !scheduleFinalityComplete) {
        warnings.push(`non-final-scheduled-games:${nonFinalScheduledGameCount}`);
      }
      if (unknownEligibilityCount > 0) warnings.push(`unknown-eligibility:${unknownEligibilityCount}`);
      if (unmappedGameCount > 0) warnings.push(`unmapped-games:${unmappedGameCount}`);
      for (const id of Object.keys(input.inventory.sourceEvidence.periodTeamContextConflicts ?? {}).sort()) {
        const expected = expectedEntities.find((entity) => entity.providerExternalId === id);
        warnings.push(`sleeper/${id}:${expected?.requirement ?? 'catalog-inventory'}:period-team-context-conflict`);
      }
      if (nonFinalEligibleCount > 0) warnings.push(`non-final-games:${nonFinalEligibleCount}`);
      if (unexpectedResponseEntityCount > 0) {
        warnings.push(`unexpected-response-entities:${unexpectedResponseEntityCount}`);
      }
      const complete = periodInventoryComplete && unknownEligibilityCount === 0
        && unmappedGameCount === 0 && nonFinalEligibleCount === 0
        && unexpectedResponseEntityCount === 0
        && (!input.requireFinalCoverage || scheduleFinalityComplete);
      return {
        status: 'available',
        observation: {
          provider: 'sleeper',
          season: input.season,
          seasonType: 'reg',
          week: input.week,
          normalizerVersion: ALL_PLAYER_STAT_NORMALIZER_VERSION,
          sourceRevision: capture.sourceRevision,
          requestStartedAt,
          requestCompletedAt,
          observedAt: requestCompletedAt,
          quality: complete ? 'complete' : 'partial',
          coverage: {
            complete,
            periodInventoryComplete,
            periodInventoryEvidence: input.inventory.sourceEvidence.periodInventoryEvidence ?? null,
            mode: input.requireFinalCoverage ? 'completed-backfill' : 'recurring-current-week',
            scheduledGameCount: scheduledGamePhases.size,
            nonFinalScheduledGameCount,
            scheduleFinalityComplete,
            expectedInventoryFingerprint: input.inventory.fingerprint,
            catalogRevision: input.inventory.sourceEvidence.catalogRevision,
            catalogRoleDiagnostics: input.inventory.sourceEvidence.catalogRoleDiagnostics ?? {},
            ...(input.inventory.sourceEvidence.historicalTeamContextFingerprint !== undefined ? {
              historicalTeamContextFingerprint: input.inventory.sourceEvidence.historicalTeamContextFingerprint,
              periodTeamContextConflicts: input.inventory.sourceEvidence.periodTeamContextConflicts ?? {},
            } : {}),
            scheduleRevision: input.inventory.sourceEvidence.scheduleRevision,
            rosterInventoryFingerprint: evidenceFingerprint(
              input.inventory.sourceEvidence.rosteredPlayerIds,
            ),
            projectionInventoryFingerprint: evidenceFingerprint(
              input.inventory.sourceEvidence.projectionPlayerIds,
            ),
            byeInventoryFingerprint: evidenceFingerprint(
              input.inventory.sourceEvidence.byeTeamIds,
            ),
            expectedEntityCount: expectedEntities.length,
            expectedPlayerCount: expectedEntities
              .filter((entity) => entity.entityKind === 'player').length,
            expectedTeamDefenseCount: NFL_TEAM_CODES.length,
            providerPresentEntityCount,
            providerMissingEntityCount: expectedEntities.length - providerPresentEntityCount,
            excludedResponseEntityCount,
            unexpectedResponseEntityCount,
            unexpectedResponseIds,
            unexpectedResponseEvidence: Object.fromEntries(unexpectedResponseIds.map((id) => [id, validated[id]])),
            excludedResponseIds: excludedResponseIds.sort(),
            unresolvedOptionalProjectionIds: input.inventory.sourceEvidence.unresolvedOptionalProjectionIds ?? [],
            responseEntityCount: Object.keys(validated).length,
            fantasyEntityCount: entries.length,
            unknownEligibilityCount,
            unknownAppearanceCount,
            assumedNonParticipationCount,
            participationAssumptionPolicy: 'missing-participation-as-zero-v1',
            unknownEligibilityIds: entries.filter((entry) => entry.eligibleGameCount === null)
              .map((entry) => entry.providerExternalId).sort(),
            unmappedGameCount,
            nonFinalEligibleCount,
          },
          warnings,
          entries,
        },
      };
    },
  };
}
