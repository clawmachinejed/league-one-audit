/** Shared internal DTOs. Authority validation lives in the account composition
 * and database owner; importing a contract does not import either implementation. */
export type AcquisitionCommand =
  | { kind: 'identify'; commandId: string; username: string }
  | { kind: 'discover'; commandId: string; associationId: string; associationRevision: string }
  | { kind: 'recover'; commandId: string; associationId: string; associationRevision: string; leagueId: string };
export type AcquisitionAdmission =
  | { status: 'pending' | 'joined'; demandId: string; retryAfterSeconds: number }
  | { status: 'denied' | 'limited' | 'conflict' | 'indeterminate'; reason: string };
export type AcquisitionProgress =
  | { status: 'pending'; demandId: string; retryAfterSeconds: number }
  | { status: 'identified'; demandId: string; lookupCaptureId: string; providerAccount: Record<string, unknown> }
  | { status: 'discovery-progress'; demandId: string; scanId: string; requiredSeasons: number[]; completedSeasons: number[];
      coverage: 'pending' | 'partial' | 'complete' | 'failed' }
  | { status: 'denied' | 'unavailable' | 'indeterminate'; reason: string };
export type ProviderActivation =
  | { status: 'active' | 'already_active'; associationId: string; associationRevision: string; assurance: 'user_asserted' }
  | { status: 'conflict' | 'denied' | 'indeterminate'; reason: string };
export type StoredDiscoveryResult =
  | { status: 'available'; demandId: string; scanId: string; providerAccountId: string; nativeAccountId: string;
      displayName: string; currentSeason: number; coverage: 'pending' | 'partial' | 'complete' | 'failed';
      requiredSeasons: number[]; completedSeasons: number[];
      candidates: { id: string; name: string; season: string; avatar: string | null }[] }
  | { status: 'denied' | 'unavailable'; reason: string };
