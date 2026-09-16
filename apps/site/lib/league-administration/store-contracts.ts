import type { AdministrationEnvelope, AdministrationFamily, AdministrationScope,
  NormalizedAdministrationObservation } from './contracts';

export type AdministrationReadInput = AdministrationScope & Readonly<{
  family: AdministrationFamily; week: number | null;
}>;
export type AdministrationConnectionReadInput = Readonly<{
  provider: 'sleeper'; externalLeagueId: string; family: AdministrationFamily; week: number | null;
}>;
export type LeagueAdministrationStoreRead =
  | Readonly<{ status: 'available'; envelope: AdministrationEnvelope;
    observationId: string; versionId: string | null; generation: number; checkedAt: string; verifiedAt: string | null }>
  | Readonly<{ status: 'missing' | 'disabled' | 'conflict' | 'unavailable'; reason?: string }>;
export type AdministrationWriteResult = Readonly<{
  status: 'changed' | 'unchanged' | 'replayed' | 'stale' | 'rejected' | 'disabled';
  observationId?: string; versionId?: string | null; generation?: number; leagueSeasonId?: string;
  reason?: string;
}>;
export type AdministrationEnrollment = Readonly<{
  leagueId: string; leagueSeasonId: string; leagueKey: string; displayName: string;
  season: number; provider: 'sleeper'; externalLeagueId: string; scoringProfileId: string;
}>;
export type AdministrationWriteFence = Readonly<{
  jobKey: string; workerId: string; generation: number; deadlineAt: string;
}>;
export type LeagueAdministrationStore = Readonly<{
  enabled: boolean;
  recordObservation: (input: NormalizedAdministrationObservation, fence?: AdministrationWriteFence) => Promise<AdministrationWriteResult>;
  readSource: (input: AdministrationReadInput) => Promise<LeagueAdministrationStoreRead>;
  readSourceByConnection: (input: AdministrationConnectionReadInput) => Promise<LeagueAdministrationStoreRead>;
  /** Empty active enrollment is an error in enabled mode, never a partial fleet. */
  listEnrollments: (season?: number) => Promise<readonly AdministrationEnrollment[]>;
}>;
