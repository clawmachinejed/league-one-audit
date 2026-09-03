import 'server-only';

import { isMatchupsData } from './matchups-response';
import { selectStoredMatchups } from './projection-freshness';
import {
  getProjectionStore,
  InvalidStoredProjectionSnapshotError,
  type ProjectionStore,
  type StoredProjectionSnapshot,
} from './projection-store';
import type { MatchupsData } from './types';

export type StoredMatchupsReadResult = Readonly<{
  kind: 'usable';
  payload: MatchupsData;
  historical: boolean;
}> | Readonly<{
  kind: 'missing' | 'stale' | 'disabled' | 'malformed' | 'database-error';
}>;

function validSnapshot(
  snapshot: StoredProjectionSnapshot,
  expectedWeek?: number,
): boolean {
  return Number.isInteger(snapshot.week)
    && (expectedWeek === undefined || snapshot.week === expectedWeek)
    && isMatchupsData(snapshot.payload)
    && snapshot.payload.week === snapshot.week;
}

/**
 * Reads and validates the selected projection snapshot and the latest league
 * snapshot through one database operation. Both the server-rendered page and
 * the polling API use this boundary so freshness and failure handling cannot
 * drift apart.
 */
export async function readStoredMatchups(
  sleeperLeagueId: string,
  requestedWeek?: number,
  options: Readonly<{
    store?: ProjectionStore;
    now?: Date;
  }> = {},
): Promise<StoredMatchupsReadResult> {
  const store = options.store ?? getProjectionStore();
  if (!store.enabled) return { kind: 'disabled' };

  try {
    const { selected, latest } = await store.readSnapshotSelectionBySleeperLeagueId(
      sleeperLeagueId,
      requestedWeek,
    );
    if (!selected) return { kind: 'missing' };
    if (!latest || !validSnapshot(selected, requestedWeek) || !validSnapshot(latest)) {
      return { kind: 'malformed' };
    }

    const selection = selectStoredMatchups(
      selected,
      latest,
      requestedWeek,
      options.now ?? new Date(),
    );
    if (selection.kind === 'stale') return selection;
    if (selection.kind === 'missing') return { kind: 'malformed' };
    return selection;
  } catch (error) {
    return error instanceof InvalidStoredProjectionSnapshotError
      ? { kind: 'malformed' }
      : { kind: 'database-error' };
  }
}
