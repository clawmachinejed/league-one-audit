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
export type AdministrationEnrollmentIdentity = Readonly<{
  leagueId: string; leagueKey: string; provider: string | null; season: number | null;
}>;
export type AdministrationEnrollmentFailureCode = 'missing-intended-season' | 'unregistered-season'
  | 'missing-source-connection' | 'missing-scoring-profile' | 'invalid-registration' | 'ambiguous-registration';
export type AdministrationEnrollmentResolution =
  | Readonly<{ status: 'ready'; intended: AdministrationEnrollmentIdentity; enrollment: AdministrationEnrollment }>
  | Readonly<{ status: 'unavailable'; intended: AdministrationEnrollmentIdentity; reason: AdministrationEnrollmentFailureCode }>;
export type AdministrationEnrollmentInventory = Readonly<{ entries: readonly AdministrationEnrollmentResolution[] }>;
export type AdministrationEnrollmentSelector = Readonly<{ leagueKey: string }>
  | Readonly<{ provider: 'sleeper'; externalLeagueId: string }>;
export type AdministrationWriteFence = Readonly<{
  jobKey: string; workerId: string; generation: number; deadlineAt: string;
}>;
export type LeagueAdministrationStore = Readonly<{
  enabled: boolean;
  recordObservation: (input: NormalizedAdministrationObservation, fence?: AdministrationWriteFence) => Promise<AdministrationWriteResult>;
  readSource: (input: AdministrationReadInput) => Promise<LeagueAdministrationStoreRead>;
  readSourceByConnection: (input: AdministrationConnectionReadInput) => Promise<LeagueAdministrationStoreRead>;
  /** Every intended membership is retained, including incomplete registrations. */
  listEnrollmentInventory: (season?: number) => Promise<AdministrationEnrollmentInventory>;
  /** Filter in SQL before validation, so unrelated registration cannot block a scoped read. */
  readEnrollment: (selector: AdministrationEnrollmentSelector, season?: number) => Promise<AdministrationEnrollmentResolution | Readonly<{ status: 'missing' }>>;
  /** Strict coordinated-publication contract; never silently return a smaller group. */
  listEnrollments: (season?: number) => Promise<readonly AdministrationEnrollment[]>;
}>;
