import 'server-only';
import { performance } from 'node:perf_hooks';
import { withDatabaseAbortSignal, type Database } from '../../database';
import { createSleeperDiscoveryScan, type DiscoveryScanPort, type DiscoveryScanProgress } from '../../accounts/discovery-scan';
import { createNeonDiscoveryScanPort, createNeonSleeperPermitPort, createNeonAcquisitionSourcePort } from '../../accounts/store';
import { normalizeSleeperAccountIdentity, normalizeSleeperDiscoverySeason } from '../../sleeper';
import { createAcquisitionJobMethods } from '../adapters/neon/jobs';
import { createAcquisitionDatabase } from '../../accounts/database';
import { createNeonAcquisitionJobRepository } from '../adapters/neon/job-repository';
import { createSleeperPermitTransport, type SleeperDispatchSlot, type SleeperPermitRequest } from '../adapters/sleeper/permit-transport';
import { reserveSleeperDispatchCapacity } from '../adapters/sleeper/dispatch-capacity';

export type AccountAcquisitionStep =
  | { status: 'idle' | 'limited'; retryAfterSeconds: number }
  | { status: 'discovery'; progress: DiscoveryScanProgress }
  | { status: 'captured'; kind: 'identify' | 'calendar-state' }
  | { status: 'unavailable'; reason: 'persistence' | 'claim' | 'authority' | 'transport' | 'source' | 'capture' };

/** One bounded invocation from the existing worker owner. The default is real
 * Neon ports and the existing owned HTTPS transport; no alternate provider
 * fetch, transaction-held HTTP, polling loop or second scheduler exists here.
 * Exporting this internal entrypoint does not enable a public route or cron.
 * Interrupted claims expire/reconcile in projection_jobs; capture and progress
 * are committed by the source owner, never by a separate generic completeJob. */
export async function runAccountAcquisitionStep(workerId: string, options: {
  database?: Database;
  signal?: AbortSignal;
  reserveLocalCapacity?: () => Promise<SleeperDispatchSlot | null>;
  monotonicNow?: () => number;
} = {}): Promise<AccountAcquisitionStep> {
  options.signal?.throwIfAborted();
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(25_000)]) : AbortSignal.timeout(25_000);
  const database = withDatabaseAbortSignal(options.database ?? createAcquisitionDatabase(process.env), signal);
  if (!database.enabled) return { status: 'unavailable', reason: 'persistence' };
  const repository = createNeonAcquisitionJobRepository(createAcquisitionJobMethods(database));
  let claim: Awaited<ReturnType<typeof repository.claimAccountAcquisition>>;
  try { claim = await repository.claimAccountAcquisition(workerId); }
  catch { options.signal?.throwIfAborted(); return { status: 'unavailable', reason: 'claim' }; }
  signal.throwIfAborted();
  if (claim.status !== 'claimed') return claim;
  const claimed = claim;
  const transport = createSleeperPermitTransport({ permits: createNeonSleeperPermitPort(database),
    wallClockNow: () => new Date().toISOString(),
    reserveLocalCapacity: options.reserveLocalCapacity ?? reserveSleeperDispatchCapacity,
    monotonicNow: options.monotonicNow ?? (() => performance.now()) });
  const source = createNeonAcquisitionSourcePort(database, claim.fence);
  const fail = async (reason: 'invalid_source' | 'transport') => {
    try { await source.fail(claimed.demandId, reason); } catch { /* Unknown outcome stays unavailable; no retry. */ }
  };
  const boundRequest = (request: SleeperPermitRequest | null) => request?.kind === 'target'
    && request.demandId === claimed.demandId && request.source.kind === 'pre-enrollment'
    && request.fence.jobKey === claimed.fence.jobKey && request.fence.workerId === claimed.fence.workerId
    && request.fence.attemptCount === claimed.fence.attemptCount && request.fence.leaseUntil === claimed.fence.leaseUntil;
  if (claim.work.kind === 'discover') {
    const work = claim.work;
    const source = createNeonDiscoveryScanPort(database, claim.fence);
    const scans: DiscoveryScanPort = {
      async load(scanId) {
        const loaded = await source.load(scanId);
        return loaded && loaded.nativeAccountId === work.nativeAccountId
          && JSON.stringify(loaded.requiredSeasons) === JSON.stringify(work.requiredSeasons) ? loaded : null;
      },
      async reserve(scope) { const request = await source.reserve(scope); return boundRequest(request) ? request : null; },
      recordCapture: input => source.recordCapture(input),
    };
    const progress = await createSleeperDiscoveryScan({ scans, transport })(work.scanId, signal);
    if (progress.status !== 'unavailable' && progress.reason === 'invalid_source') {
      await fail(progress.reason);
    }
    return { status: 'discovery', progress };
  }
  try {
    const request = await source.reserve(claim.demandId);
    signal.throwIfAborted();
    if (!boundRequest(request) || !request || (claim.work.kind === 'identify'
      ? request.endpoint.family !== 'identity' || request.endpoint.username !== claim.work.username
      : request.endpoint.family !== 'nfl-state')) return { status: 'unavailable', reason: 'authority' };
    const received = await transport(request);
    signal.throwIfAborted();
    if (received.status !== 'received' || received.httpStatus < 200 || received.httpStatus >= 300) {
      // Admission/cooldown/capacity and uncertain transport outcomes do not
      // erase accepted durable intent. The existing job lease and persisted
      // policy/expiry govern a later owner invocation; never retry here.
      return { status: 'unavailable', reason: 'transport' };
    }
    let rawValue: unknown;
    try { rawValue = JSON.parse(received.body); }
    catch { await fail('invalid_source'); return { status: 'unavailable', reason: 'source' }; }
    let captured: { commit: 'confirmed' | 'unknown' };
    const chronology = { requestStartedAt: received.requestStartedAt, requestCompletedAt: received.requestCompletedAt };
    if (claim.work.kind === 'identify') {
      let normalizedValue: ReturnType<typeof normalizeSleeperAccountIdentity>;
      try { normalizedValue = normalizeSleeperAccountIdentity(rawValue, claim.work.username); }
      catch { await fail('invalid_source'); return { status: 'unavailable', reason: 'source' }; }
      captured = await source.recordIdentity({ request, permitId: received.permitId, rawValue, normalizedValue, ...chronology });
    } else {
      let leagueSeason: number;
      try { leagueSeason = Number(normalizeSleeperDiscoverySeason(rawValue)); if (leagueSeason < 1002) throw new Error('Invalid season'); }
      catch { await fail('invalid_source'); return { status: 'unavailable', reason: 'source' }; }
      captured = await source.recordCalendar({ request, permitId: received.permitId, rawValue, normalizedValue: { leagueSeason }, ...chronology });
    }
    signal.throwIfAborted();
    return captured.commit === 'confirmed' ? { status: 'captured', kind: claim.work.kind }
      : { status: 'unavailable', reason: 'capture' };
  } catch { options.signal?.throwIfAborted(); return { status: 'unavailable', reason: 'capture' }; }
}
