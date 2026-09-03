import { stableJson } from '../shared/stable-json';
import { sha256 } from '../shared/sha256';
import { externalReferenceKey } from '../shared/provider-identity';
import { validateLineupObservation, type LineupObservationInput } from './lineup-observation';
import type { LineupRevision } from './contracts';
export type { LineupRevision } from './contracts';

export const LINEUP_REVISION_VERSION = 'lineup-v1' as const;

/** Only listed semantic fields enter the hash; presentation and timestamps cannot leak in. */
export function canonicalLineupRevisionInput(input: LineupObservationInput): string {
  if (validateLineupObservation(input).status !== 'complete') {
    throw new Error('Only a complete lineup observation can produce a revision.');
  }
  const rows = input.rows.map((row) => ({
    rosterRef: externalReferenceKey(row.rosterRef),
    matchupRef: row.matchupRef === null ? null : externalReferenceKey(row.matchupRef),
    starters: row.starters.map((entry, slotIndex) => ({
      slotIndex,
      assignment: entry === null ? null : externalReferenceKey(entry),
    })),
  })).sort((left, right) => left.rosterRef < right.rosterRef ? -1 : left.rosterRef > right.rosterRef ? 1 : 0);
  return stableJson({
    revisionVersion: LINEUP_REVISION_VERSION,
    leagueRef: externalReferenceKey(input.leagueRef),
    period: { season: input.period.season, seasonType: input.period.seasonType, week: input.period.week },
    shape: {
      expectedRosterCount: input.shape.expectedRosterCount,
      expectedStarterSlotCount: input.shape.expectedStarterSlotCount,
    },
    rows,
  });
}

export async function calculateLineupRevision(
  input: LineupObservationInput,
  hash: (canonicalUtf8: string) => Promise<string> = sha256,
): Promise<LineupRevision> {
  const lineupRevision = await hash(canonicalLineupRevisionInput(input));
  if (!/^[0-9a-f]{64}$/u.test(lineupRevision)) throw new Error('Lineup revision digest is invalid.');
  return { revisionVersion: LINEUP_REVISION_VERSION, lineupRevision };
}
