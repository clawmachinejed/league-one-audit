import 'server-only';
import type { LineupPublicationFence } from '../../domain/lineup-publication';
import type { LeaguePeriod } from '../../domain/contracts';
import type { StoreLineupPublicationFence } from './lineup-publication-contracts';

export function storedLineupPeriod(period: LeaguePeriod) {
  return { ...period, seasonType: period.seasonType === 'preseason' ? 'pre' as const
    : period.seasonType === 'postseason' ? 'post' as const : 'reg' as const };
}

export function storedLineupPublicationFence(fence: LineupPublicationFence): StoreLineupPublicationFence {
  const common = {
    watchId: fence.watchId, watchGeneration: fence.watchGeneration,
    authorityGeneration: fence.authorityGeneration, runId: fence.runId,
  };
  return fence.ownerLane === 'current' ? { ...common, ownerLane: 'current' } : {
    ...common, ownerLane: 'future', materializationAttemptId: fence.materializationAttemptId,
    projectionProvider: fence.projectionSource, normalizerVersion: fence.normalizerVersion,
  };
}
