import 'server-only';

import { createHash } from 'node:crypto';
import { canonicalNflTeam } from '../../../nfl-teams';
import { startProviderHttp } from '../../../provider-request-telemetry';
import type { PlayerCatalog, SleeperMatchup } from '../../../transform';
import { NFL_TEAM_CODES } from '../../domain/contracts';
import {
  ALL_PLAYER_POSITIONS,
  type AllPlayerExplicitIneligibilityEvidence,
  type AllPlayerEligibilityEvidence,
  type AllPlayerWeeklyEligibilityEvidence,
  type AllPlayerGamePhase,
  type AllPlayerPosition,
  type AllPlayerStatEntry,
  type AllPlayerStatObservation,
} from '../../domain/all-player-statistics';

const API = 'https://api.sleeper.app/v1';
export const ALL_PLAYER_STAT_NORMALIZER_VERSION = 'sleeper-weekly-stats-v1';
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
  }>;
}>;

export type SleeperAllPlayerInventoryResult =
  | Readonly<{ status: 'available'; inventory: SleeperAllPlayerInventory }>
  | Readonly<{ status: 'unavailable'; reason: 'catalog' | 'schedule' | 'identity' }>;

export type SleeperAllPlayerStatRequest = Readonly<{
  season: number;
  week: number;
  inventory: SleeperAllPlayerInventory;
  gamesByTeam: Readonly<Record<string, TeamGame>>;
  requireFinalCoverage?: boolean;
}>;

export type SleeperAllPlayerStatResult =
  | Readonly<{ status: 'available'; observation: AllPlayerStatObservation }>
  | Readonly<{
      status: 'unavailable';
      reason: 'http' | 'malformed';
      statusCode?: number;
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

function validateStatsResponse(value: unknown): Readonly<Record<string, Readonly<Record<string, number>>>> | null {
  if (!isRecord(value) || Object.keys(value).length === 0) return null;
  const result: Record<string, Readonly<Record<string, number>>> = {};
  for (const [externalId, rawStats] of Object.entries(value)) {
    if (!externalId.trim() || !isRecord(rawStats)) return null;
    const stats: Record<string, number> = {};
    for (const [key, rawValue] of Object.entries(rawStats)) {
      if (!key.trim() || typeof rawValue !== 'number' || !Number.isFinite(rawValue)) return null;
      stats[key] = rawValue;
    }
    result[externalId] = stats;
  }
  return result;
}

function count(value: number | undefined): 0 | 1 | null {
  return value === 0 || value === 1 ? value : null;
}

function eligibility(stats: Readonly<Record<string, number>>): Readonly<{
  eligibleGameCount: 0 | 1 | null;
  appearanceGameCount: 0 | 1 | null;
  eligibilityEvidence: AllPlayerWeeklyEligibilityEvidence
    | Readonly<{ kind: 'unknown-weekly-stat'; source: 'weekly-stat-provider' }>;
}> {
  const hasActive = Object.prototype.hasOwnProperty.call(stats, 'gms_active');
  const hasAppearance = Object.prototype.hasOwnProperty.call(stats, 'gp');
  const active = count(stats.gms_active);
  const appearance = count(stats.gp);
  const eligibilityEvidence: AllPlayerWeeklyEligibilityEvidence = {
    kind: 'weekly-stat',
    source: 'weekly-stat-provider',
    ...(hasActive && active !== null ? { gmsActive: active } : {}),
    ...(hasAppearance && appearance !== null ? { appearances: appearance } : {}),
  };
  if ((hasActive && active === null) || (hasAppearance && appearance === null)) {
    return {
      eligibleGameCount: null, appearanceGameCount: null,
      eligibilityEvidence: { kind: 'unknown-weekly-stat', source: 'weekly-stat-provider' },
    };
  }
  if (active === 0) return appearance === null || appearance === 0
    ? { eligibleGameCount: 0, appearanceGameCount: 0, eligibilityEvidence }
    : { eligibleGameCount: null, appearanceGameCount: null, eligibilityEvidence };
  if (active === 1) return {
    eligibleGameCount: 1,
    appearanceGameCount: appearance ?? 0,
    eligibilityEvidence,
  };
  if (appearance === 1) return {
    eligibleGameCount: 1, appearanceGameCount: 1, eligibilityEvidence,
  };
  return { eligibleGameCount: null, appearanceGameCount: null, eligibilityEvidence };
}

function expectedEligibility(
  stats: Readonly<Record<string, number>> | undefined,
  explicitIneligibility: SleeperExplicitIneligibilityEvidence | null,
  inventoryFingerprintValue: string,
): Readonly<{
  eligibleGameCount: 0 | 1 | null;
  appearanceGameCount: 0 | 1 | null;
  eligibilityEvidence: AllPlayerEligibilityEvidence;
}> {
  if (!stats) return explicitIneligibility
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
  const weekly = eligibility(stats);
  if (!explicitIneligibility) return weekly;
  if (weekly.eligibilityEvidence.kind !== 'weekly-stat') return weekly;
  const conflict = weekly.eligibleGameCount === 1 || weekly.appearanceGameCount === 1;
  const eligibilityEvidence: AllPlayerEligibilityEvidence = {
    kind: conflict ? 'conflict' : 'combined-ineligible',
    weekly: weekly.eligibilityEvidence,
    ineligibility: explicitIneligibility,
  };
  if (conflict) {
    return { eligibleGameCount: null, appearanceGameCount: null, eligibilityEvidence };
  }
  return { eligibleGameCount: 0, appearanceGameCount: 0, eligibilityEvidence };
}

function sourceRevision(response: Response, raw: unknown): string {
  const etag = response.headers.get('etag')?.trim();
  return etag ? `etag:${etag}`
    : `sha256:${createHash('sha256').update(stableJson(raw)).digest('hex')}`;
}

function evidenceFingerprint(value: unknown): string {
  return `sha256:${createHash('sha256').update(stableJson(value)).digest('hex')}`;
}

function normalizedPosition(value: unknown): AllPlayerPosition | null {
  if (typeof value !== 'string') return null;
  const position = value.trim().toUpperCase();
  return positionSet.has(position) ? position as AllPlayerPosition : null;
}

function catalogFantasyPosition(player: PlayerCatalog[string]): AllPlayerPosition | null {
  const primary = normalizedPosition(player.position);
  if (primary && primary !== 'DEF') return primary;
  const fantasyPositions = [...new Set((player.fantasy_positions ?? [])
    .map(normalizedPosition).filter((position): position is AllPlayerPosition => (
      position !== null && position !== 'DEF'
    )))];
  return fantasyPositions.length === 1 ? fantasyPositions[0] : null;
}

function inventoryFingerprint(
  entities: readonly SleeperExpectedAllPlayerEntity[],
  gamesByTeam: Readonly<Record<string, TeamGame>>,
  sourceEvidence: SleeperAllPlayerInventory['sourceEvidence'],
): string {
  return `sha256:${createHash('sha256').update(stableJson({
    entities, gamesByTeam, sourceEvidence,
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
}>): SleeperAllPlayerInventoryResult {
  const catalogRevision = input.catalogRevision.trim();
  const scheduleRevision = input.scheduleRevision.trim();
  if (!input.catalogComplete || !catalogRevision) {
    return { status: 'unavailable', reason: 'catalog' };
  }
  if (!scheduleRevision) return { status: 'unavailable', reason: 'schedule' };
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
    ...input.projectionPlayerIds.map((id) => id.trim()),
  ].filter((id) => !canonicalTeamDefenseIds.has(id)));
  if (forcedPlayerIds.has('')) return { status: 'unavailable', reason: 'identity' };
  const entities: SleeperExpectedAllPlayerEntity[] = [];
  for (const [providerExternalId, player] of Object.entries(input.catalog)) {
    const position = catalogFantasyPosition(player);
    if (!position) continue;
    const nflTeam = canonicalNflTeam(player.team);
    if (!nflTeam && !forcedPlayerIds.has(providerExternalId)) continue;
    const suppliedEvidence = input.ineligibilityEvidenceByPlayerId?.[providerExternalId];
    const normalizedStatus = player.status?.trim().toLowerCase();
    const statusReason = normalizedStatus === 'suspended' ? 'suspended'
      : normalizedStatus && ['ir', 'pup', 'nfi', 'reserve'].includes(normalizedStatus)
        ? 'reserve'
        : player.active === false || normalizedStatus === 'inactive'
          ? 'inactive'
          : null;
    const absentIneligibilityEvidence = suppliedEvidence ?? (nflTeam && byeTeams.has(nflTeam)
      ? { kind: 'explicit-ineligible', reason: 'bye', source: 'schedule', sourceRevision: scheduleRevision } as const
      : statusReason
        ? { kind: 'explicit-ineligible', reason: statusReason, source: 'player-status-provider', sourceRevision: catalogRevision } as const
      : !nflTeam
        ? { kind: 'explicit-ineligible', reason: 'teamless', source: 'player-status-provider', sourceRevision: catalogRevision } as const
        : null);
    entities.push({
      entityKind: 'player', providerExternalId, nflTeam, position,
      absentIneligibilityEvidence,
    });
    forcedPlayerIds.delete(providerExternalId);
  }
  if (forcedPlayerIds.size > 0) return { status: 'unavailable', reason: 'identity' };
  for (const team of NFL_TEAM_CODES) {
    entities.push({
      entityKind: 'team_defense', providerExternalId: team, nflTeam: team, position: 'DEF',
      absentIneligibilityEvidence: byeTeams.has(team)
        ? { kind: 'explicit-ineligible', reason: 'bye', source: 'schedule', sourceRevision: scheduleRevision }
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
  const keys = new Set<string>();
  const externalIds = new Set<string>();
  const defenses = new Set<string>();
  for (const entity of value.entities) {
    if (!entity.providerExternalId.trim() || !positionSet.has(entity.position)) return null;
    if (entity.absentIneligibilityEvidence) {
      const evidence = entity.absentIneligibilityEvidence;
      if (evidence.kind !== 'explicit-ineligible'
        || !['inactive', 'suspended', 'reserve', 'bye', 'teamless', 'other'].includes(evidence.reason)
        || !['player-status-provider', 'schedule', 'manual-review'].includes(evidence.source)
        || !evidence.sourceRevision.trim()) return null;
    }
    if (entity.entityKind === 'team_defense') {
      const team = canonicalNflTeam(entity.providerExternalId);
      if (!team || entity.position !== 'DEF' || entity.nflTeam !== team) return null;
      defenses.add(team);
    } else if (entity.position === 'DEF') return null;
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
  const fetcher = dependencies.fetch;
  const now = dependencies.now;
  return {
    async load(input: SleeperAllPlayerStatRequest): Promise<SleeperAllPlayerStatResult> {
      if (!Number.isInteger(input.season) || input.season < 2026 || input.season > 2200
        || !Number.isInteger(input.week) || input.week < 1 || input.week > 18) {
        return { status: 'unavailable', reason: 'malformed' };
      }
      const expectedEntities = validatedInventory(input.inventory, input.gamesByTeam);
      if (!expectedEntities) return { status: 'unavailable', reason: 'malformed' };
      const requestStartedAt = now().toISOString();
      const finished = startProviderHttp('sleeper', 'all-player-stats', 'bypass');
      let response: Response;
      try {
        response = await fetcher(
          `${API}/stats/nfl/regular/${input.season}/${input.week}`,
          {
            cache: 'no-store',
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(20_000),
          },
        );
      } catch {
        finished('unavailable');
        return { status: 'unavailable', reason: 'http' };
      }
      if (!response.ok) {
        finished('unavailable');
        return { status: 'unavailable', reason: 'http', statusCode: response.status };
      }
      let raw: unknown;
      try {
        raw = await response.json();
      } catch {
        finished('invalid');
        return { status: 'unavailable', reason: 'malformed' };
      }
      const validated = validateStatsResponse(raw);
      if (!validated) {
        finished('invalid');
        return { status: 'unavailable', reason: 'malformed' };
      }
      const requestCompletedAt = now().toISOString();
      const warnings: string[] = [];
      const entries: AllPlayerStatEntry[] = [];
      const expectedIds = new Set(expectedEntities.map((entity) => entity.providerExternalId));
      const idpKeys = new Set([
        'gms_active', 'gp', 'tackle_solo', 'tackle_ast', 'tackle_combined', 'tackle_loss',
        'qb_hit', 'def_pass_def', 'idp_sack', 'idp_int', 'idp_fum_rec', 'idp_def_td',
      ]);
      const responseIds = Object.keys(validated);
      const excludedResponseIds = responseIds.filter((externalId) => {
        if (externalId.startsWith('TEAM_')) return true;
        if (expectedIds.has(externalId)) return false;
        const keys = Object.keys(validated[externalId]);
        return keys.includes('tackle_solo') && keys.every((key) => idpKeys.has(key));
      });
      const unexpectedResponseEntityCount = responseIds.filter((externalId) => (
        !expectedIds.has(externalId) && !excludedResponseIds.includes(externalId)
      )).length;
      const excludedResponseEntityCount = excludedResponseIds.length;
      let providerPresentEntityCount = 0;
      for (const expected of expectedEntities) {
        const stats = validated[expected.providerExternalId];
        if (stats) providerPresentEntityCount += 1;
        const nflTeam = expected.nflTeam;
        const game = nflTeam ? input.gamesByTeam[nflTeam] : undefined;
        const evidence = expectedEligibility(
          stats,
          expected.absentIneligibilityEvidence,
          input.inventory.fingerprint,
        );
        entries.push({
          entityKind: expected.entityKind,
          providerExternalId: expected.providerExternalId,
          nflGameId: game?.nflGameId ?? null,
          nflTeam,
          position: expected.position,
          stats: stats ?? {},
          ...evidence,
          gamePhase: game?.phase ?? 'unknown',
        });
      }
      entries.sort((left, right) => (
        `${left.entityKind}\0${left.providerExternalId}`
          .localeCompare(`${right.entityKind}\0${right.providerExternalId}`)
      ));
      const unknownEligibilityCount = entries.filter((entry) => entry.eligibleGameCount === null).length;
      const unmappedGameCount = entries.filter((entry) => (
        entry.eligibleGameCount === 1 && entry.nflGameId === null
      )).length;
      const nonFinalEligibleCount = input.requireFinalCoverage
        ? entries.filter((entry) => (
            entry.eligibleGameCount === 1 && entry.gamePhase !== 'final'
          )).length : 0;
      if (unknownEligibilityCount > 0) warnings.push(`unknown-eligibility:${unknownEligibilityCount}`);
      if (unmappedGameCount > 0) warnings.push(`unmapped-games:${unmappedGameCount}`);
      if (nonFinalEligibleCount > 0) warnings.push(`non-final-games:${nonFinalEligibleCount}`);
      if (unexpectedResponseEntityCount > 0) {
        warnings.push(`unexpected-response-entities:${unexpectedResponseEntityCount}`);
      }
      const complete = unknownEligibilityCount === 0
        && unmappedGameCount === 0 && nonFinalEligibleCount === 0
        && unexpectedResponseEntityCount === 0;
      finished('available');
      return {
        status: 'available',
        observation: {
          provider: 'sleeper',
          season: input.season,
          seasonType: 'reg',
          week: input.week,
          normalizerVersion: ALL_PLAYER_STAT_NORMALIZER_VERSION,
          sourceRevision: sourceRevision(response, raw),
          requestStartedAt,
          requestCompletedAt,
          observedAt: requestCompletedAt,
          quality: complete ? 'complete' : 'partial',
          coverage: {
            complete,
            expectedInventoryFingerprint: input.inventory.fingerprint,
            catalogRevision: input.inventory.sourceEvidence.catalogRevision,
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
            responseEntityCount: Object.keys(validated).length,
            fantasyEntityCount: entries.length,
            unknownEligibilityCount,
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
