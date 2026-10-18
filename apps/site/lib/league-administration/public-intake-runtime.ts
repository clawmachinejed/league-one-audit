import 'server-only';
import { getDatabase, withDatabaseAbortSignal } from '../database';
import { createProjectionStore } from '../projection-store';
import { createLeagueAdministrationStore, createPublicIntakeStore, createPublicDataRefreshStore } from './store';
import { validatePublicIntake, PUBLIC_DATA_BATCH_POLICY, type PublicIntakeInput } from './public-intake-contracts';
import { validatePublicDataRefresh, validatePublicDataResourceSchedule, PUBLIC_DATA_RESOURCE_SCHEDULE_POLICY, refreshUuid, type PublicDataRefreshConfiguration, type PublicDataResourceScheduleConfiguration } from './public-refresh-contracts';
import { runPublicDataBatch, runPublicDataRefreshStep, runPublicIntakeStep, runPublicPlayerDirectoryStep } from './public-intake';

/** Operator/backend composition only. No current route supplies this selection.
 * The legacy runner requires explicit enablement, installed 034 and its runtime grants.
 * Controlled submission receipts additionally require installed 057 and its runtime grant.
 * The sibling manager evidence option additionally requires installed 035. */
export type PublicIntakeSelection = Readonly<{ enabled: true; requestId: string; managerEvidenceVersion?: 'v2' }>;
export async function submitPublicSleeperIntake(input: PublicIntakeInput, selection: PublicIntakeSelection) {
  const validated = validatePublicIntake(input);
  if (selection.enabled !== true || validated.id !== selection.requestId) throw new Error('Public intake admission is not enabled.');
  const database = getDatabase();
  if (!database.enabled) return { status: 'disabled' } as const;
  const bounded = withDatabaseAbortSignal(database, AbortSignal.timeout(3_000));
  if (!bounded.enabled) return { status: 'disabled' } as const;
  return createPublicIntakeStore(bounded).submitWithReceipt(validated);
}

export async function runSelectedPublicIntake(selection: PublicIntakeSelection, invocationStartedAt: number) {
  if (selection.enabled !== true || 'playerDirectoryPolicy' in selection && selection.playerDirectoryPolicy !== undefined) return { status: 'disabled' } as const;
  const remaining = Math.min(20_000, invocationStartedAt + 48_000 - Date.now());
  if (remaining < 15_000) return { status: 'deadline' } as const;
  const database = getDatabase();
  if (!database.enabled) return { status: 'disabled' } as const;
  const signal = AbortSignal.timeout(remaining);
  const bounded = withDatabaseAbortSignal(database, signal);
  if (!bounded.enabled) return { status: 'disabled' } as const;
  return runPublicIntakeStep(selection.requestId, { intake: createPublicIntakeStore(bounded),
    administration: createLeagueAdministrationStore(bounded), jobs: createProjectionStore(bounded),
    ...(selection.managerEvidenceVersion ? { managerEvidenceVersion: selection.managerEvidenceVersion } : {}),
    cleanup: () => {
      const cleanup = withDatabaseAbortSignal(database, AbortSignal.timeout(2_000));
      if (!cleanup.enabled) throw new Error('Intake cleanup storage unavailable.');
      return { intake: createPublicIntakeStore(cleanup), jobs: createProjectionStore(cleanup) };
    } }, signal);
}

/** Explicit backend composition. Merely importing this module does not query R036. */
export type PublicDataRefreshSelection = Readonly<{ enabled: true; managerEvidenceVersion?: 'v2';
  batchPolicy?: typeof PUBLIC_DATA_BATCH_POLICY; schedulingPolicy?: typeof PUBLIC_DATA_RESOURCE_SCHEDULE_POLICY;
  playerDirectoryPolicy?: 'public-player-directory-daily-v1' }>;
export async function configurePublicSleeperRefresh(input: PublicDataRefreshConfiguration, selection: PublicDataRefreshSelection | null | undefined) {
  if (selection?.enabled !== true || selection.managerEvidenceVersion !== undefined && selection.managerEvidenceVersion !== 'v2'
    || selection.batchPolicy !== undefined && selection.batchPolicy !== PUBLIC_DATA_BATCH_POLICY
    || selection.schedulingPolicy !== undefined && (selection.schedulingPolicy !== PUBLIC_DATA_RESOURCE_SCHEDULE_POLICY
      || selection.batchPolicy !== PUBLIC_DATA_BATCH_POLICY)
    || selection.playerDirectoryPolicy !== undefined && (selection.playerDirectoryPolicy !== 'public-player-directory-daily-v1'
      || selection.batchPolicy !== PUBLIC_DATA_BATCH_POLICY || selection.schedulingPolicy !== PUBLIC_DATA_RESOURCE_SCHEDULE_POLICY)) {
    return { status: 'disabled' } as const;
  }
  const validated = validatePublicDataRefresh(input);
  const database = getDatabase();
  if (!database.enabled) return { status: 'disabled' } as const;
  const bounded = withDatabaseAbortSignal(database, AbortSignal.timeout(3_000));
  if (!bounded.enabled) return { status: 'disabled' } as const;
  return createPublicDataRefreshStore(bounded).configure(validated);
}

export async function configurePublicSleeperResourceSchedule(input: PublicDataResourceScheduleConfiguration,
  selection: PublicDataRefreshSelection | null | undefined) {
  if (selection?.enabled !== true || selection.batchPolicy !== PUBLIC_DATA_BATCH_POLICY
    || selection.schedulingPolicy !== PUBLIC_DATA_RESOURCE_SCHEDULE_POLICY
    || selection.managerEvidenceVersion !== undefined && selection.managerEvidenceVersion !== 'v2'
    || selection.playerDirectoryPolicy !== undefined && selection.playerDirectoryPolicy !== 'public-player-directory-daily-v1') return { status: 'disabled' } as const;
  const validated = validatePublicDataResourceSchedule(input);
  const database = getDatabase();
  if (!database.enabled) return { status: 'disabled' } as const;
  const bounded = withDatabaseAbortSignal(database, AbortSignal.timeout(3_000));
  if (!bounded.enabled) return { status: 'disabled' } as const;
  const store = createPublicDataRefreshStore(bounded);
  if (!store.configureResourceSchedule) throw new Error('Resource scheduling configuration unavailable.');
  return store.configureResourceSchedule(validated);
}

export async function runSelectedPublicDataRefresh(selection: PublicDataRefreshSelection | null | undefined, invocationStartedAt: number) {
  return runSelectedPublicDataWork(selection, invocationStartedAt);
}

/** Explicit awaited backend kickoff. Submission receipts and caller lifetime remain separate. */
export async function runSelectedPublicIntakeBatch(selection: PublicIntakeSelection & Readonly<{ batchPolicy: typeof PUBLIC_DATA_BATCH_POLICY }>,
  invocationStartedAt: number) {
  if (selection?.batchPolicy !== PUBLIC_DATA_BATCH_POLICY || !refreshUuid(selection.requestId)) {
    return { status: 'disabled', providerRequests: 0 } as const;
  }
  return runSelectedPublicDataWork(selection, invocationStartedAt, selection.requestId);
}

async function runSelectedPublicDataWork(selection: PublicDataRefreshSelection | null | undefined, invocationStartedAt: number,
  requestId?: string) {
  if (selection?.enabled !== true || selection.managerEvidenceVersion !== undefined && selection.managerEvidenceVersion !== 'v2'
    || selection.batchPolicy !== undefined && selection.batchPolicy !== PUBLIC_DATA_BATCH_POLICY
    || selection.schedulingPolicy !== undefined && (selection.schedulingPolicy !== PUBLIC_DATA_RESOURCE_SCHEDULE_POLICY
      || selection.batchPolicy !== PUBLIC_DATA_BATCH_POLICY)
    || selection.playerDirectoryPolicy !== undefined && (selection.playerDirectoryPolicy !== 'public-player-directory-daily-v1'
      || selection.batchPolicy !== PUBLIC_DATA_BATCH_POLICY || selection.schedulingPolicy !== PUBLIC_DATA_RESOURCE_SCHEDULE_POLICY)) {
    return { status: 'disabled', providerRequests: 0 } as const;
  }
  if (requestId !== undefined && (selection.schedulingPolicy !== undefined || selection.playerDirectoryPolicy !== undefined)) return { status: 'disabled', providerRequests: 0 } as const;
  const startedAt = Date.now();
  const workDeadline = invocationStartedAt + 20_000;
  const deadline = invocationStartedAt + 22_000;
  const remaining = workDeadline - startedAt;
  if (!Number.isFinite(remaining) || remaining < 15_000
    || selection.batchPolicy === PUBLIC_DATA_BATCH_POLICY && invocationStartedAt > startedAt) {
    return { status: 'deadline', providerRequests: 0 } as const;
  }
  const database = getDatabase();
  if (!database.enabled) return { status: 'disabled', providerRequests: 0 } as const;
  // The final two seconds belong to cleanup inside the SAME absolute budget.
  // Abort-aware database calls settle before the one worker promise is drained.
  const workRemaining = workDeadline - Date.now();
  if (workRemaining <= 0) return { status: 'deadline', providerRequests: 0 } as const;
  const signal = AbortSignal.timeout(workRemaining);
  const phaseRemaining = invocationStartedAt + 10_000 - Date.now();
  if (phaseRemaining <= 0) return { status: 'deadline', providerRequests: 0 } as const;
  const phaseSignal = AbortSignal.any([signal, AbortSignal.timeout(phaseRemaining)]);
  const bounded = withDatabaseAbortSignal(database, signal);
  const phaseDatabase = withDatabaseAbortSignal(database, phaseSignal);
  if (!bounded.enabled || !phaseDatabase.enabled) return { status: 'disabled', providerRequests: 0 } as const;
  if (selection.playerDirectoryPolicy === 'public-player-directory-daily-v1') {
    // Read bounded persisted eligibility before choosing the one shared owner.
    // SQL still enforces daily admission, cross-resource spacing and recovery.
    let directory: Awaited<ReturnType<ReturnType<typeof createLeagueAdministrationStore>['readAcceptedPlayerDirectory']>>;
    try { directory = await createLeagueAdministrationStore(phaseDatabase).readAcceptedPlayerDirectory({ limit: 1 }); }
    catch { return { status: 'unavailable', providerRequests: 0 } as const; }
    const checkedAt = Date.now();
    if (phaseSignal.aborted || signal.aborted || checkedAt < invocationStartedAt || workDeadline - checkedAt < 15_000) {
      return { status: 'deadline', providerRequests: 0 } as const;
    }
    if (directory.status !== 'available' && directory.status !== 'missing') return { status: 'unavailable', providerRequests: 0 } as const;
    const latest = directory.latestAttempt;
    if (latest === undefined || directory.status === 'available' && latest === null) return { status: 'unavailable', providerRequests: 0 } as const;
    if (latest !== null) {
      const reservedAt = Date.parse(latest.reservedAt), retryAt = Date.parse(latest.retryAt);
      if (!Number.isFinite(reservedAt) || !Number.isFinite(retryAt) || retryAt - reservedAt !== 86_400_000) {
        return { status: 'unavailable', providerRequests: 0 } as const;
      }
    }
    if (latest === null || checkedAt >= Date.parse(latest.retryAt)) {
      // A directory turn remains exclusive even on busy/backoff; falling through
      // to a batch would keep renewing the existing cross-resource quiet guard.
      return runSelectedPublicPlayerDirectory({ enabled: true }, invocationStartedAt);
    }
  }
  const cleanup = (expiresAt: number) => {
    const remainingCleanup = Math.max(0, Math.min(2_000, expiresAt - Date.now()));
    const cleanupSignal = remainingCleanup > 0 ? AbortSignal.timeout(remainingCleanup)
      : AbortSignal.abort(new Error('Public DATA refresh budget exhausted.'));
    const cleanupDatabase = withDatabaseAbortSignal(database, cleanupSignal);
    if (!cleanupDatabase.enabled) throw new Error('Refresh cleanup storage unavailable.');
    return { refresh: createPublicDataRefreshStore(cleanupDatabase), intake: createPublicIntakeStore(cleanupDatabase),
      jobs: createProjectionStore(cleanupDatabase) };
  };
  const dependencies = { refresh: createPublicDataRefreshStore(bounded), intake: createPublicIntakeStore(bounded),
    administration: createLeagueAdministrationStore(bounded), jobs: createProjectionStore(bounded),
    deadlineAt: new Date(workDeadline).toISOString(),
    ...(selection.schedulingPolicy ? { schedulingPolicy: selection.schedulingPolicy } : {}),
    ...(selection.managerEvidenceVersion ? { managerEvidenceVersion: selection.managerEvidenceVersion } : {}),
    preAdmission: { signal: phaseSignal, refresh: createPublicDataRefreshStore(phaseDatabase),
      intake: createPublicIntakeStore(phaseDatabase), jobs: createProjectionStore(phaseDatabase),
      // Reconcile only while the ORIGINAL work fence is still valid. The short
      // phase signal cannot cancel a successful later provider acquisition.
      cleanup: () => cleanup(workDeadline) },
    cleanup: () => cleanup(deadline) };
  return selection.batchPolicy === PUBLIC_DATA_BATCH_POLICY
    ? runPublicDataBatch(requestId, dependencies, signal, invocationStartedAt)
    : runPublicDataRefreshStep(dependencies, signal);
}


/** Existing shared resource owner, also chosen by the closed daily DATA policy. Production selection remains off. */
export type PublicPlayerDirectorySelection = Readonly<{ enabled: true }>;
export async function runSelectedPublicPlayerDirectory(selection: PublicPlayerDirectorySelection | null | undefined, invocationStartedAt: number) {
  if (selection?.enabled !== true) return { status: 'disabled', providerRequests: 0 } as const;
  const workDeadline = invocationStartedAt + 20_000;
  if (!Number.isFinite(workDeadline) || workDeadline - Date.now() < 15_000) return { status: 'deadline', providerRequests: 0 } as const;
  const database = getDatabase();
  if (!database.enabled) return { status: 'disabled', providerRequests: 0 } as const;
  const remaining = workDeadline - Date.now();
  if (remaining <= 0) return { status: 'deadline', providerRequests: 0 } as const;
  const signal = AbortSignal.timeout(remaining);
  const bounded = withDatabaseAbortSignal(database, signal);
  if (!bounded.enabled) return { status: 'disabled', providerRequests: 0 } as const;
  return runPublicPlayerDirectoryStep({ intake: createPublicIntakeStore(bounded), administration: createLeagueAdministrationStore(bounded),
    jobs: createProjectionStore(bounded), deadlineAt: new Date(workDeadline).toISOString(), cleanup: () => {
      const remainingCleanup = Math.max(0, Math.min(2_000, invocationStartedAt + 22_000 - Date.now()));
      const cleanupSignal = remainingCleanup > 0 ? AbortSignal.timeout(remainingCleanup)
        : AbortSignal.abort(new Error('Player directory cleanup budget exhausted.'));
      const cleanupDatabase = withDatabaseAbortSignal(database, cleanupSignal);
      if (!cleanupDatabase.enabled) throw new Error('Player directory cleanup storage unavailable.');
      return { intake: createPublicIntakeStore(cleanupDatabase), jobs: createProjectionStore(cleanupDatabase) };
    } }, signal);
}
