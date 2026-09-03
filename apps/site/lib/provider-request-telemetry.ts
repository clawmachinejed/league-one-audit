import 'server-only';

import { AsyncLocalStorage } from 'node:async_hooks';
import type { ProjectionLogEntry, ProjectionLoggerPort } from './projections/ports/logger';

type Provider = 'sleeper' | 'tank01';
export type ProviderEndpointFamily =
  | 'lineup' | 'league-calendar' | 'league-week'
  | 'league' | 'rosters' | 'users' | 'nfl-state' | 'nfl-players' | 'weekly-matchups'
  | 'transactions' | 'weekly-scores' | 'season-schedule' | 'other'
  | 'projection-slate' | 'player-crosswalk' | 'game-states';
type Outcome = 'available' | 'unavailable' | 'invalid' | 'not-ready';
const context = new AsyncLocalStorage<ProjectionLoggerPort>();

function emit(entry: ProjectionLogEntry): void {
  try { context.getStore()?.write(entry.outcome === 'failed' ? 'warn' : 'info', entry); } catch {
    // Request metrics never change provider results, cache eligibility, or worker behavior.
  }
}

/** The context follows concurrent provider work without adding arguments to cache keys. */
export function observeProviderAdapter<T>(
  logger: ProjectionLoggerPort, provider: Provider, endpointFamily: ProviderEndpointFamily,
  run: () => Promise<T>, outcome: (result: T) => Outcome = () => 'available',
): Promise<T> {
  return context.run(logger, async () => {
    const fields = { stage: 'provider-request', requestMetric: 'adapter' as const, provider, endpointFamily };
    emit({ ...fields, outcome: 'started', providerAdapterInvocations: 1 });
    try {
      const result = await run();
      const providerOutcome = outcome(result);
      emit({ ...fields, outcome: providerOutcome === 'invalid' || providerOutcome === 'unavailable' ? 'failed' : 'completed', providerOutcome });
      return result;
    } catch (error) {
      emit({ ...fields, outcome: 'failed', providerOutcome: 'unavailable' });
      throw error;
    }
  });
}

/** Loader entry proves a miss; a backoff return proves a hit. Framework caches expose neither. */
export function recordProviderCache(
  provider: Provider, endpointFamily: ProviderEndpointFamily, cacheStatus: 'hit' | 'miss' | 'framework-managed',
): void {
  emit({ stage: 'provider-request', requestMetric: 'cache', provider, endpointFamily, outcome: 'completed', cacheStatus,
    cacheHits: cacheStatus === 'framework-managed' ? null : Number(cacheStatus === 'hit'),
    cacheMisses: cacheStatus === 'framework-managed' ? null : Number(cacheStatus === 'miss') });
}

/** Only no-store fetches prove upstream requests. Patched cached fetch invocations are not counted as network calls. */
export function startProviderHttp(
  provider: Provider, endpointFamily: ProviderEndpointFamily, cacheStatus: 'bypass' | 'framework-managed',
): (providerOutcome: Outcome) => void {
  const startedAt = performance.now();
  const fields = { stage: 'provider-request', requestMetric: 'http' as const, provider, endpointFamily, cacheStatus };
  emit({ ...fields, outcome: 'started', fetchInvocations: 1, upstreamRequests: cacheStatus === 'bypass' ? 1 : null });
  return (providerOutcome) => emit({ ...fields,
    outcome: providerOutcome === 'invalid' || providerOutcome === 'unavailable' ? 'failed' : 'completed',
    providerOutcome, providerDurationMs: Math.max(0, performance.now() - startedAt) });
}

/** Returns only a fixed family. External IDs and raw paths never enter metric payloads. */
export function sleeperEndpointFamily(path: string): ProviderEndpointFamily {
  if (path.startsWith('/players/nfl')) return 'nfl-players';
  if (path.startsWith('/state/nfl')) return 'nfl-state';
  if (/\/matchups\/[^/]+$/u.test(path)) return 'weekly-matchups';
  if (/\/transactions\/[^/]+$/u.test(path)) return 'transactions';
  if (path.endsWith('/rosters')) return 'rosters';
  if (path.endsWith('/users')) return 'users';
  return /^\/league\/[^/]+$/u.test(path) ? 'league' : 'other';
}
