/** Metadata needed by the shared full-payload and compact revision reader policy. */
export type SnapshotFreshnessMetadata = Readonly<{
  week: number;
  payloadWeek: number;
  payloadLeagueWeek: number;
  payloadSeason: string;
  payloadUpdatedAt: string;
  verifiedAt: string;
  activityWindows: readonly Readonly<{ startsAt: string; endsAt: string }>[];
  matchupStatuses: readonly unknown[];
  scheduledKickoffs: readonly string[];
  scheduledDatesWithoutKickoff: readonly string[];
}>;
export const SNAPSHOT_REVISION_HEADER = 'X-Projection-Snapshot-Revision';
export const SNAPSHOT_VERIFIED_AT_HEADER = 'X-Projection-Verified-At';

export function validSnapshotRevision(value: string): boolean {
  return /^[0-9a-f]{64}$/u.test(value);
}
