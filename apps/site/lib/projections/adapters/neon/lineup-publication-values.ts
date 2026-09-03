import 'server-only';
import { json, provider, requiredText } from './database-values';
import { futureRefreshUuid } from './future-refresh-values';
import type { StoreLineupPublicationFence, StoreLineupMaterializationTarget } from './lineup-publication-contracts';

export function lineupRevision(value: string, label = 'Lineup revision'): string {
  if (!/^[0-9a-f]{64}$/u.test(value)) throw new Error(`${label} must be a lowercase SHA-256 digest.`);
  return value;
}

export function observationLineupValues(version?: string | null, revision?: string | null): readonly [string | null, string | null] {
  if (version == null && revision == null) return [null, null];
  if (version == null || revision == null) throw new Error('Official lineup revision and version must be supplied together.');
  return [requiredText(version, 'Lineup revision version'), lineupRevision(revision)];
}

export function positiveGeneration(value: number, label: string, allowZero = false): number {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) throw new Error(`${label} is invalid.`);
  return value;
}

export function materializationTargetValue(target: StoreLineupMaterializationTarget) {
  if (!target) throw new Error('Materialization lineup target is required.');
  return {
    watchId: futureRefreshUuid(target.watchId, 'Lineup watch ID'),
    watchGeneration: positiveGeneration(target.watchGeneration, 'Watch generation'),
    authorityGeneration: positiveGeneration(target.authorityGeneration, 'Authority generation'),
    observedVersion: positiveGeneration(target.observedVersion, 'Observed version', true),
    lineupRevision: target.lineupRevision === null ? null : lineupRevision(target.lineupRevision),
  };
}

export function publicationFenceJson(fence: StoreLineupPublicationFence): string {
  if (!fence) throw new Error('Publication ownership fence is required.');
  const base = {
    watchId: futureRefreshUuid(fence.watchId, 'Lineup watch ID'),
    watchGeneration: positiveGeneration(fence.watchGeneration, 'Watch generation'),
    authorityGeneration: positiveGeneration(fence.authorityGeneration, 'Authority generation'),
    ownerLane: fence.ownerLane,
    runId: requiredText(fence.runId, 'Publication run ID'),
  };
  if (fence.ownerLane === 'current') return json(base);
  if (fence.ownerLane !== 'future') throw new Error('Publication owner lane is invalid.');
  return json({
    ...base,
    materializationAttemptId: futureRefreshUuid(fence.materializationAttemptId, 'Materialization attempt ID'),
    projectionProvider: provider(fence.projectionProvider),
    normalizerVersion: requiredText(fence.normalizerVersion, 'Projection normalizer version'),
  });
}
