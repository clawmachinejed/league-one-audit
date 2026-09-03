import 'server-only';

import { unstable_cache } from 'next/cache';
import type {
  LeaguePeriod,
  ProjectionObservation,
  ProjectionSlate,
  ProjectionSlateCoverage,
} from '../../domain/contracts';
import type {
  ProjectionFeedPort,
  ProjectionFeedResult,
  ProjectionFeedUnavailableReason,
} from '../../ports/projection-feed';
import {
  externalPlayerRef,
  externalTeamDefenseRef,
  type ProviderKey,
} from '../../shared/provider-identity';
import { compatibleRevision } from '../../shared/revision-compatibility';
import { canonicalNflTeam as canonicalTeam } from '../../../nfl-teams';
import {
  fetchTank01Envelope,
  projectionPath,
  rehydrateCrosswalk,
  rehydrateProjectionSlate,
  waitForBoth,
} from './projection-client';
import {
  FAILURE_BACKOFF_MS,
  nonEmptyText,
  nullRecord,
  SUCCESS_CACHE_SECONDS,
  Tank01ProviderFailure,
  type CacheEntry,
  type NormalizedCrosswalk,
  type NormalizedProjectionSlate,
  type Tank01AvailableResult,
  type Tank01PlayerProjection,
  type Tank01ProjectionCoverage,
} from './projection-internals';
import { normalizeCrosswalk, normalizeProjectionSlate } from './projection-normalization';
import {
  assessProjectionSlate,
  hasPlausibleTank01ProjectionEnvelope,
} from './slate-validation';

type ProjectionUnavailableResult = Extract<ProjectionFeedResult, { status: 'unavailable' }>;

export type CachedTank01ProjectionFeedOptions = Readonly<{
  /** Read at call and cache-miss time so credential rotation does not require a process restart. */
  apiKey: () => string | null;
  provider: ProviderKey;
  officialProvider: ProviderKey;
  fetch: typeof fetch;
  now: () => number;
  failureBackoffMs?: number;
}>;

function warningMessages(coverage: Tank01ProjectionCoverage): string[] {
  const warnings: string[] = [];
  if (coverage.malformedPlayerListRows > 0 || coverage.ambiguousPlayerListRows > 0) {
    warnings.push('Some Tank01 player identifiers could not be safely matched to Sleeper.');
  }
  if (coverage.unmatchedPlayerProjections > 0) {
    warnings.push('Some Tank01 player projections did not have a Sleeper player identifier.');
  }
  if (coverage.malformedPlayerProjections > 0 || coverage.malformedDefenseProjections > 0) {
    warnings.push('Some malformed Tank01 projection rows were ignored.');
  }
  if (coverage.incompletePlayerProjections > 0 || coverage.incompleteDefenseProjections > 0) {
    warnings.push('Some Tank01 projection rows are missing one or more projected statistics.');
  }
  if (coverage.matchedPlayerProjections === 0) {
    warnings.push('Tank01 did not provide any player projections that could be matched to Sleeper.');
  }
  if (coverage.usableDefenseProjections === 0) {
    warnings.push('Tank01 did not provide any usable team defense projections.');
  }
  return warnings;
}

/** Converts already-normalized provider data into the single canonical slate shape. */
export function joinNormalizedProjectionSlate(
  period: LeaguePeriod,
  slate: NormalizedProjectionSlate,
  crosswalk: NormalizedCrosswalk,
  provider: ProviderKey,
  officialProvider: ProviderKey,
): ProjectionFeedResult {
  const bySleeperId = nullRecord<Tank01PlayerProjection>();
  let unmatchedPlayerProjections = 0;
  for (const [tank01PlayerId, projection] of Object.entries(slate.playersByTank01Id)) {
    const sleeperPlayerId = crosswalk.sleeperIdByTank01Id[tank01PlayerId];
    if (!sleeperPlayerId) {
      unmatchedPlayerProjections += 1;
      continue;
    }
    bySleeperId[sleeperPlayerId] = { ...projection, sleeperPlayerId };
  }

  const coverage: Tank01ProjectionCoverage = {
    playerListRows: crosswalk.playerListRows,
    crosswalkEntries: Object.keys(crosswalk.sleeperIdByTank01Id).length,
    malformedPlayerListRows: crosswalk.malformedPlayerListRows,
    ambiguousPlayerListRows: crosswalk.ambiguousPlayerListRows,
    playerProjectionRows: slate.playerProjectionRows,
    matchedPlayerProjections: Object.keys(bySleeperId).length,
    unmatchedPlayerProjections,
    malformedPlayerProjections: slate.malformedPlayerProjections,
    incompletePlayerProjections: slate.incompletePlayerProjections,
    defenseProjectionRows: slate.defenseProjectionRows,
    usableDefenseProjections: Object.keys(slate.defensesByTeam).length,
    malformedDefenseProjections: slate.malformedDefenseProjections,
    incompleteDefenseProjections: slate.incompleteDefenseProjections,
  };

  const fetchedAt = new Date(slate.fetchedAtMs).toISOString();
  const legacyResult: Tank01AvailableResult = {
    status: 'available',
    season: String(period.season),
    week: period.week,
    fetchedAt,
    projections: { bySleeperId, byDefenseTeam: slate.defensesByTeam },
    coverage,
    warnings: warningMessages(coverage),
  };

  const canonicalCoverage: ProjectionSlateCoverage = {
    crosswalkRows: coverage.playerListRows,
    crosswalkEntries: coverage.crosswalkEntries,
    malformedCrosswalkRows: coverage.malformedPlayerListRows,
    ambiguousCrosswalkRows: coverage.ambiguousPlayerListRows,
    playerRows: coverage.playerProjectionRows,
    matchedPlayers: coverage.matchedPlayerProjections,
    unmatchedPlayers: coverage.unmatchedPlayerProjections,
    malformedPlayers: coverage.malformedPlayerProjections,
    incompletePlayers: coverage.incompletePlayerProjections,
    defenseRows: coverage.defenseProjectionRows,
    usableDefenses: coverage.usableDefenseProjections,
    malformedDefenses: coverage.malformedDefenseProjections,
    incompleteDefenses: coverage.incompleteDefenseProjections,
  };
  const projections: ProjectionObservation[] = [
    ...Object.values(bySleeperId).map((projection): ProjectionObservation => ({
      identity: {
        primary: externalPlayerRef(provider, projection.tank01PlayerId),
        aliases: [externalPlayerRef(officialProvider, projection.sleeperPlayerId)],
      },
      nflTeam: canonicalTeam(projection.team),
      position: projection.position,
      stats: projection.stats,
      scoringStats: projection.scoringProjection,
      missingFields: projection.missingFields,
    })),
    ...Object.values(slate.defensesByTeam).map((projection): ProjectionObservation => ({
      identity: {
        primary: externalTeamDefenseRef(provider, projection.team),
        // Tank's player-list crosswalk does not prove the official provider's D/ST ID.
        aliases: [],
      },
      nflTeam: canonicalTeam(projection.team),
      position: 'DEF',
      stats: projection.stats,
      scoringStats: projection.scoringProjection,
      missingFields: projection.missingFields,
    })),
  ];
  const complete = hasPlausibleTank01ProjectionEnvelope(
    Object.values(slate.playersByTank01Id).map((projection) => ({
      nflTeam: projection.team,
      position: projection.position,
      scoringStats: projection.scoringProjection,
    })),
    Object.values(slate.defensesByTeam).map((projection) => ({
      nflTeam: projection.team,
      scoringStats: projection.scoringProjection,
    })),
  );
  const canonicalSlate: ProjectionSlate = {
    source: provider,
    period,
    quality: complete ? 'complete' : 'partial',
    requestStartedAt: fetchedAt,
    requestCompletedAt: fetchedAt,
    observedAt: fetchedAt,
    sourceRevision: compatibleRevision({
      season: legacyResult.season,
      week: legacyResult.week,
      fetchedAt: legacyResult.fetchedAt,
      coverage: legacyResult.coverage,
      projections: legacyResult.projections,
    }),
    projections,
    coverage: canonicalCoverage,
    warnings: legacyResult.warnings,
  };
  return { status: 'available', slate: canonicalSlate };
}

function validPeriod(value: LeaguePeriod): boolean {
  return Number.isInteger(value.season)
    && /^20\d{2}$/u.test(String(value.season))
    && value.seasonType === 'regular'
    && Number.isInteger(value.week)
    && value.week >= 1
    && value.week <= 18;
}

function unavailable(
  period: LeaguePeriod,
  reason: ProjectionFeedUnavailableReason,
  retryAtMs?: number,
): ProjectionFeedResult {
  const message = reason === 'not-configured'
    ? 'Player projections are not configured.'
    : reason === 'invalid-request'
      ? 'Player projections are unavailable for the requested season or week.'
      : 'Player projections are temporarily unavailable.';
  return {
    status: 'unavailable',
    period,
    reason,
    message,
    ...(retryAtMs === undefined ? {} : { retryAt: new Date(retryAtMs).toISOString() }),
  };
}
/** Creates the production feed while keeping credentials outside persistent-cache arguments. */
export function createCachedTank01ProjectionFeed(
  options: CachedTank01ProjectionFeedOptions,
): ProjectionFeedPort {
  const request = options.fetch;
  const now = options.now;
  const failureBackoffMs = options.failureBackoffMs ?? FAILURE_BACKOFF_MS;
  const failureCache = new Map<string, CacheEntry<ProjectionUnavailableResult>>();
  const configuredKey = (): string | null => nonEmptyText(options.apiKey());

  const sharedProjectionSlate = unstable_cache(
    async (season: string, week: number): Promise<NormalizedProjectionSlate> => {
      const apiKey = configuredKey();
      if (!apiKey) throw new Tank01ProviderFailure('provider-error');
      const envelope = await fetchTank01Envelope(request, projectionPath(season, week, now()), apiKey);
      const slate = normalizeProjectionSlate(envelope, now());
      if (!hasPlausibleTank01ProjectionEnvelope(
        Object.values(slate.playersByTank01Id).map((projection) => ({
          nflTeam: projection.team,
          position: projection.position,
          scoringStats: projection.scoringProjection,
        })),
        Object.values(slate.defensesByTeam).map((projection) => ({
          nflTeam: projection.team,
          scoringStats: projection.scoringProjection,
        })),
      )) throw new Tank01ProviderFailure('invalid-response');
      return slate;
    },
    // This exact key preserves the already-populated production cache namespace.
    ['tank01-normalized-projection-slate-v3'],
    { revalidate: SUCCESS_CACHE_SECONDS },
  );

  const sharedPlayerCrosswalk = unstable_cache(
    async (): Promise<NormalizedCrosswalk> => {
      const apiKey = configuredKey();
      if (!apiKey) throw new Tank01ProviderFailure('provider-error');
      const envelope = await fetchTank01Envelope(request, '/getNFLPlayerList', apiKey);
      return normalizeCrosswalk(envelope);
    },
    // This exact key preserves the already-populated production cache namespace.
    ['tank01-normalized-player-crosswalk-v1'],
    { revalidate: SUCCESS_CACHE_SECONDS },
  );

  const getProjectionSlate = async (period: LeaguePeriod): Promise<ProjectionFeedResult> => {
    if (!validPeriod(period)) return unavailable(period, 'invalid-request');
    const apiKey = configuredKey();
    if (!apiKey) return unavailable(period, 'not-configured');

    const season = String(period.season);
    const cacheKey = `${season}:${period.week}`;
    const timestamp = now();
    const recentFailure = failureCache.get(cacheKey);
    if (recentFailure && recentFailure.expiresAt > timestamp) return recentFailure.value;
    failureCache.delete(cacheKey);

    try {
      const [slate, crosswalk] = await waitForBoth(
        sharedProjectionSlate(season, period.week),
        sharedPlayerCrosswalk(),
      );
      return joinNormalizedProjectionSlate(
        period,
        rehydrateProjectionSlate(slate),
        rehydrateCrosswalk(crosswalk),
        options.provider,
        options.officialProvider,
      );
    } catch (error) {
      // Rejected cache loaders are not retained by Next. Keep only the short process-local backoff.
      const reason = error instanceof Tank01ProviderFailure ? error.reason : 'provider-error';
      const retryAtMs = now() + failureBackoffMs;
      const result = unavailable(period, reason, retryAtMs) as ProjectionUnavailableResult;
      failureCache.set(cacheKey, { value: result, expiresAt: retryAtMs });
      return result;
    }
  };

  return { getProjectionSlate, assessProjectionSlate };
}
