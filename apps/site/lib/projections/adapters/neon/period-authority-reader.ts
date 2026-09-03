import 'server-only';
import type { ProjectionStore } from './contracts';
import type { LeaguePeriod, LeaguePeriodAuthority } from '../../domain/contracts';
import { classifyLineupWatchPeriod, LINEUP_AUTHORITY_MAX_AGE_MS } from '../../domain/period-classification';
import type { ClockPort } from '../../ports/clock';
import type { LeagueRegistryPort } from '../../ports/league-registry';
import type { PeriodAuthorityReaderPort, PeriodAuthorityReadResult } from '../../ports/period-authority-reader';
import { externalRosterRef } from '../../shared/provider-identity';

const canonicalSeasonType = (value: 'pre' | 'reg' | 'post'): LeaguePeriod['seasonType'] => (
  value === 'pre' ? 'preseason' : value === 'post' ? 'postseason' : 'regular'
);

export function createNeonPeriodAuthorityReader(
  store: Pick<ProjectionStore, 'readLeagueLineupAuthorities'>,
  registry: LeagueRegistryPort,
  clock: Pick<ClockPort, 'now'>,
): PeriodAuthorityReaderPort {
  return {
    async readAuthorities(leagueKeys, asOf, maxAgeMs) {
      const keys = [...new Set(leagueKeys)];
      const configurations = new Map(registry.listActiveLeagues().map((value) => [value.key, value]));
      if (keys.some((key) => typeof key !== 'string' || !key || key !== key.trim())
        || !Number.isFinite(asOf.getTime()) || !Number.isFinite(maxAgeMs) || maxAgeMs < 0) {
        return keys.map((leagueKey) => ({ kind: 'malformed' as const, leagueKey }));
      }
      let results;
      try { results = await store.readLeagueLineupAuthorities(keys); }
      catch { return keys.map((leagueKey) => ({ kind: 'database-error' as const, leagueKey })); }
      // The writer can verify authority while this read waits. Validate after the read,
      // not against the earlier worker calculation timestamp.
      const now = new Date(Math.max(asOf.getTime(), clock.now().getTime()));
      const byKey = new Map(results.map((result) => [result.leagueKey, result]));
      if (byKey.size !== results.length || results.some((result) => !keys.includes(result.leagueKey))) {
        return keys.map((leagueKey) => ({ kind: 'malformed' as const, leagueKey }));
      }
      return keys.map((leagueKey): PeriodAuthorityReadResult => {
        const configuration = configurations.get(leagueKey);
        const result = byKey.get(leagueKey);
        if (!configuration || !result || result.kind === 'missing') return { kind: 'missing', leagueKey };
        if (result.kind !== 'available') return { kind: 'malformed', leagueKey };
        const stored = result.authority;
        if (stored.leagueKey !== leagueKey) return { kind: 'malformed', leagueKey };
        if (stored.sourceProvider !== configuration.leagueRef.provider
          || stored.lineupShape.sourceExternalLeagueId !== configuration.leagueRef.externalId) {
          return { kind: 'provider-mismatch', leagueKey };
        }
        const authority: LeaguePeriodAuthority = {
          configuration,
          defaultDisplayPeriod: { season: stored.defaultSeason,
            seasonType: canonicalSeasonType(stored.defaultSeasonType), week: stored.defaultWeek },
          activeScoringPeriod: stored.activeSeason === null || stored.activeSeasonType === null || stored.activeWeek === null
            ? null : { season: stored.activeSeason, seasonType: canonicalSeasonType(stored.activeSeasonType), week: stored.activeWeek },
          lifecycle: stored.leagueLifecycle, nflPhase: stored.nflPhase,
          source: configuration.leagueRef.provider, sourceRevision: stored.sourceRevision,
          observedAt: stored.sourceObservedAt, verifiedAt: stored.verifiedAt,
        };
        const classification = classifyLineupWatchPeriod(authority, authority.defaultDisplayPeriod, {
          now, range: configuration.matchupWeekRange, expectedLeagueRef: configuration.leagueRef,
          maxAuthorityAgeMs: Math.min(maxAgeMs, LINEUP_AUTHORITY_MAX_AGE_MS),
        });
        if (classification.kind === 'unavailable') {
          return { kind: classification.reason === 'stale' ? 'stale' : 'malformed', leagueKey };
        }
        return { kind: 'present', leagueKey, value: {
          configuration, authority, authorityGeneration: stored.authorityGeneration,
          defaultPeriodCadence: stored.defaultPeriodCadence,
          shape: { expectedRosterCount: stored.lineupShape.expectedRosterCount,
            expectedStarterSlotCount: stored.lineupShape.expectedStarterSlotCount,
            expectedRosterRefs: stored.lineupShape.expectedRosterIds.map((id) => externalRosterRef(configuration.leagueRef, id)) },
        } };
      });
    },
  };
}
