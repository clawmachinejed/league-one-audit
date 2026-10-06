import 'server-only';
import { getDatabase, withDatabaseAbortSignal } from '../database';
import { createProjectionStore } from '../projection-store';
import { createLeagueAdministrationStore, createPublicIntakeStore, createPublicDataRefreshStore } from './store';
import { validatePublicIntake, type PublicIntakeInput } from './public-intake-contracts';
import { validatePublicDataRefresh, type PublicDataRefreshConfiguration } from './public-refresh-contracts';
import { runPublicDataRefreshStep, runPublicIntakeStep } from './public-intake';

/** Operator/backend composition only. No current route supplies this selection.
 * Explicit enablement, installed 034 and its runtime grants are release prerequisites.
 * The sibling manager evidence option additionally requires installed 035. */
export type PublicIntakeSelection = Readonly<{ enabled: true; requestId: string; managerEvidenceVersion?: 'v2' }>;
export async function submitPublicSleeperIntake(input: PublicIntakeInput, selection: PublicIntakeSelection) {
  const validated = validatePublicIntake(input);
  if (selection.enabled !== true || validated.id !== selection.requestId) throw new Error('Public intake admission is not enabled.');
  const database = getDatabase();
  if (!database.enabled) return { status: 'disabled' } as const;
  const bounded = withDatabaseAbortSignal(database, AbortSignal.timeout(3_000));
  if (!bounded.enabled) return { status: 'disabled' } as const;
  await createPublicIntakeStore(bounded).submit(validated);
  return { status: 'retained', requestId: validated.id } as const;
}

export async function runSelectedPublicIntake(selection: PublicIntakeSelection, invocationStartedAt: number) {
  if (selection.enabled !== true) return { status: 'disabled' } as const;
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
export type PublicDataRefreshSelection = Readonly<{ enabled: true; managerEvidenceVersion?: 'v2' }>;
export async function configurePublicSleeperRefresh(input: PublicDataRefreshConfiguration, selection: PublicDataRefreshSelection | null | undefined) {
  if (selection?.enabled !== true || selection.managerEvidenceVersion !== undefined && selection.managerEvidenceVersion !== 'v2') {
    return { status: 'disabled' } as const;
  }
  const validated = validatePublicDataRefresh(input);
  const database = getDatabase();
  if (!database.enabled) return { status: 'disabled' } as const;
  const bounded = withDatabaseAbortSignal(database, AbortSignal.timeout(3_000));
  if (!bounded.enabled) return { status: 'disabled' } as const;
  return createPublicDataRefreshStore(bounded).configure(validated);
}

export async function runSelectedPublicDataRefresh(selection: PublicDataRefreshSelection | null | undefined, invocationStartedAt: number) {
  if (selection?.enabled !== true || selection.managerEvidenceVersion !== undefined && selection.managerEvidenceVersion !== 'v2') {
    return { status: 'disabled', providerRequests: 0 } as const;
  }
  const startedAt = Date.now();
  const workDeadline = invocationStartedAt + 20_000;
  const deadline = invocationStartedAt + 22_000;
  const remaining = workDeadline - startedAt;
  if (!Number.isFinite(remaining) || remaining < 15_000) return { status: 'deadline', providerRequests: 0 } as const;
  const database = getDatabase();
  if (!database.enabled) return { status: 'disabled', providerRequests: 0 } as const;
  // The final two seconds belong to cleanup inside the SAME absolute budget.
  // Abort-aware database calls settle before the one worker promise is drained.
  const workRemaining = workDeadline - Date.now();
  if (workRemaining <= 0) return { status: 'deadline', providerRequests: 0 } as const;
  const signal = AbortSignal.timeout(workRemaining);
  const bounded = withDatabaseAbortSignal(database, signal);
  if (!bounded.enabled) return { status: 'disabled', providerRequests: 0 } as const;
  return runPublicDataRefreshStep({ refresh: createPublicDataRefreshStore(bounded), intake: createPublicIntakeStore(bounded),
    administration: createLeagueAdministrationStore(bounded), jobs: createProjectionStore(bounded),
    deadlineAt: new Date(workDeadline).toISOString(),
    ...(selection.managerEvidenceVersion ? { managerEvidenceVersion: selection.managerEvidenceVersion } : {}),
    cleanup: () => {
      const remainingCleanup = Math.max(0, Math.min(2_000, deadline - Date.now()));
      const cleanupSignal = remainingCleanup > 0 ? AbortSignal.timeout(remainingCleanup)
        : AbortSignal.abort(new Error('Public DATA refresh budget exhausted.'));
      const cleanup = withDatabaseAbortSignal(database, cleanupSignal);
      if (!cleanup.enabled) throw new Error('Refresh cleanup storage unavailable.');
      return { refresh: createPublicDataRefreshStore(cleanup), intake: createPublicIntakeStore(cleanup), jobs: createProjectionStore(cleanup) };
    } }, signal);
}
