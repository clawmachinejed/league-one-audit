import 'server-only';

import { randomUUID } from 'node:crypto';
import { getDatabase, withDatabaseAbortSignal } from '../database';
import { createProjectionStore } from '../projection-store';
import { getOfficialLeagueAdministration, getOfficialMatchupObservation, getOfficialTransactionWeek,
  getOfficialAdministrationMetadata } from '../sleeper';
import type { LeagueRegistryPort } from '../projections/ports/league-registry';
import { recordCapturedAdministration } from './runtime';
import { createLeagueAdministrationStore } from './store';

const HOUR_MS = 3_600_000;
export const ADMINISTRATION_MAINTENANCE_JOB = 'league-administration-maintenance';

/** Rotate within a finite season. Current and previous weeks get priority over older history. */
export function administrationMaintenanceSelection(now: Date, leagueCount: number, currentWeek: number) {
  if (!Number.isFinite(now.getTime()) || !Number.isInteger(leagueCount) || leagueCount < 1
    || !Number.isInteger(currentWeek) || currentWeek < 1 || currentWeek > 18) {
    throw new Error('Invalid administration maintenance selection.');
  }
  const slot = Math.floor(now.getTime() / HOUR_MS);
  const cycle = Math.floor(slot / leagueCount);
  // Metadata turns cannot consume a weekly-history ordinal: otherwise periods
  // whose rotation aligns with every fourth turn can be skipped forever.
  const weeklyCycle = cycle - Math.floor((cycle + 1) / 4);
  const week = weeklyCycle % 3 === 0 ? currentWeek
    : weeklyCycle % 3 === 1 ? Math.max(1, currentWeek - 1)
      : Math.floor(weeklyCycle / 3) % (currentWeek + 1);
  return { leagueIndex: slot % leagueCount, week, metadata: cycle % 4 === 3 };
}

/** Bounded additional Sleeper collection on the existing current lane, after its primary work.
 * At minute 30 one global hourly claim selects one league and one period (at most five GETs),
 * or every fourth turn its finite season metadata inventory (at most 31 GETs including core).
 * No page-triggered writes, Tank01 calls, extra cron or historical-week fanout. */
export async function runAdministrationMaintenance(registry: LeagueRegistryPort, invocationStartedAt: number) {
  const now = new Date(invocationStartedAt);
  if (!Number.isFinite(now.getTime()) || now.getUTCMinutes() !== 30) return { status: 'not-due' } as const;
  const remaining = Math.min(20_000, invocationStartedAt + 48_000 - Date.now());
  if (remaining < 15_000) return { status: 'deadline' } as const;
  const baseDatabase = getDatabase();
  if (!baseDatabase.enabled) return { status: 'disabled' } as const;
  const deadlineAt = new Date(Date.now() + remaining).toISOString();
  const signal = AbortSignal.timeout(remaining);
  const database = withDatabaseAbortSignal(baseDatabase, signal);
  const jobs = createProjectionStore(database);
  const store = createLeagueAdministrationStore(database);
  const configurations = registry.listActiveLeagues();
  const initial = administrationMaintenanceSelection(now, configurations.length, 1);
  const configuration = configurations[initial.leagueIndex];
  const workerId = randomUUID();
  const jobKey = ADMINISTRATION_MAINTENANCE_JOB;
  const claim = await jobs.acquireJob({ jobKey, jobType: jobKey, workerId,
    scheduledFor: new Date(Math.floor(invocationStartedAt / HOUR_MS) * HOUR_MS).toISOString(),
    // The scheduled hour already prevents duplicate success. A completion-based
    // interval would skip the next hour whenever the previous run took time.
    leaseSeconds: Math.ceil(remaining / 1000),
    payload: { leagueKey: configuration.key, policy: 'administration-hourly-rotation-v1' } });
  if (claim.kind !== 'acquired') return { status: 'busy' } as const;
  try {
    const authority = (await jobs.readLeagueLineupAuthorities([configuration.key]))[0];
    if (authority?.kind !== 'available'
      || authority.authority.lineupShape?.sourceExternalLeagueId !== String(configuration.leagueRef.externalId)) {
      throw new Error('administration-authority-unavailable');
    }
    const period = authority.authority;
    const season = period.activeSeason ?? period.defaultSeason;
    const currentWeek = period.activeWeek ?? period.defaultWeek;
    const { week, metadata } = administrationMaintenanceSelection(now, configurations.length, currentWeek);
    const externalLeagueId = String(configuration.leagueRef.externalId);
    const core = await getOfficialLeagueAdministration(externalLeagueId, { revalidate: 0, signal });
    const extra = metadata ? await getOfficialAdministrationMetadata(externalLeagueId, season, { signal, maxRequests: 28 })
      : { observations: await Promise.all([
        ...(week > 0 ? [getOfficialMatchupObservation(externalLeagueId, week, 0, signal)] : []),
        getOfficialTransactionWeek(externalLeagueId, week, 0, signal),
      ]), providerRequests: week > 0 ? 2 : 1, reason: undefined };
    signal.throwIfAborted();
    const captured = await recordCapturedAdministration({ leagueKey: configuration.key,
      provider: 'sleeper', externalLeagueId, season }, [...core, ...extra.observations], {
      store, signal, fence: { jobKey, workerId, generation: claim.attempt, deadlineAt },
    });
    if (captured.status !== 'stored' || extra.reason) throw new Error('administration-observation-rejected');
    if (!await jobs.completeJob(jobKey, workerId)) throw new Error('administration-lease-lost');
    console.info(JSON.stringify({ service: 'league-administration', stage: 'maintenance', outcome: 'completed',
      leagueKey: configuration.key, season, week: metadata ? null : week, documents: captured.results.length,
      upstreamRequests: 3 + extra.providerRequests }));
    return { status: 'completed', leagueKey: configuration.key, week } as const;
  } catch {
    // Cleanup is independently bounded and uses the same existing job ownership check.
    const cleanup = createProjectionStore(withDatabaseAbortSignal(baseDatabase, AbortSignal.timeout(2_000)));
    await cleanup.failJob(jobKey, workerId, signal.aborted ? 'administration-timeout' : 'administration-sync-failed')
      .catch(() => false);
    console.warn(JSON.stringify({ service: 'league-administration', stage: 'maintenance', outcome: 'failed',
      leagueKey: configuration.key, reason: signal.aborted ? 'timeout' : 'source-or-validation-failed', retry: 'next-hour' }));
    return { status: 'failed' } as const;
  }
}
