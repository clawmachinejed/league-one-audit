import 'server-only';
import { getDatabase, withDatabaseAbortSignal } from '../database';
import { createProjectionStore } from '../projection-store';
import { createLeagueAdministrationStore, createPublicIntakeStore } from './store';
import { validatePublicIntake, type PublicIntakeInput } from './public-intake-contracts';
import { runPublicIntakeStep } from './public-intake';

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
