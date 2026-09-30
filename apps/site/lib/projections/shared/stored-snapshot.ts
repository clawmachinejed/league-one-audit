import type { MatchupsData } from '../../types';

export type ProjectionActivityWindow = Readonly<{
  /** Two hours before one full-slate kickoff. */
  startsAt: string;
  /** Seven hours after the same full-slate kickoff. */
  endsAt: string;
}>;

export type StoredProjectionSnapshot = Readonly<{
  snapshotId: string;
  leagueSeasonId: string;
  week: number;
  modelVersion: string;
  revisionKey: string;
  calculatedAt: string;
  publishedAt: string | null;
  /** Latest successful source validation, even when material content did not change. */
  verifiedAt: string;
  /** Compact kickoff-derived refresh windows for every game in the NFL week. */
  activityWindows: readonly ProjectionActivityWindow[];
  isCurrent: boolean;
  payload: MatchupsData;
}>;
