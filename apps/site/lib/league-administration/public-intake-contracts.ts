import type { AdministrationSourceMapping } from './source-mapping';
import type { AdministrationWriteFence } from './store-contracts';
import type { CapturedAdministrationDocument } from './contracts';

export const PUBLIC_INTAKE_JOB = 'league-administration-public-intake';
export const PUBLIC_INTAKE_VERSION = 'sleeper-public-intake-v1';
export type PublicIntakeInput = Readonly<{ id: string; username: string; seasons: readonly number[] }>;
export type PublicIdentity = Readonly<{ userId: string; username: string; displayName: string; avatarUrl: string | null }>;
export type PublicLeague = Readonly<{ id: string; name: string; season: string }>;
export type PublicCapture<T> = Readonly<{ payload: unknown; requestStartedAt: string; requestCompletedAt: string }>
  & (Readonly<{ value: T; diagnostic?: never }> | Readonly<{ value: null; diagnostic: 'invalid-source' }>);
export type PublicIntakeWork = Readonly<{ requestId: string; revision: number }> & (
  | Readonly<{ kind: 'identity'; username: string }>
  | Readonly<{ kind: 'leagues'; userId: string; season: number }>
  | Readonly<{ kind: 'bootstrap' | 'core' | 'users'; externalLeagueId: string; season: number }>
);
export type PublicIntakeDisposition = 'complete' | 'partial' | 'unavailable' | 'backoff';
export type PublicIntakeOutcome = Readonly<{ status: 'progress' | 'busy' | PublicIntakeDisposition;
  resource?: PublicIntakeWork['kind']; providerRequests: number }>;
export type PublicCoreCheckpoint = Readonly<{
  observations: Readonly<{ league?: string; rosters?: string; users?: string }>;
  /** Fresh source request alongside its immutable, potentially deduplicated directory observation. */
  directoryCapture?: CapturedAdministrationDocument;
  receipts?: Readonly<{ settings: string; players: string; managers: string }>;
}>;
export type PublicIntakeStore = Readonly<{
  submit: (input: PublicIntakeInput) => Promise<void>;
  recover: (requestId: string, fence: AdministrationWriteFence) => Promise<void>;
  next: (requestId: string) => Promise<PublicIntakeWork | PublicIntakeDisposition>;
  admit: (work: PublicIntakeWork, fence: AdministrationWriteFence) => Promise<boolean>;
  recordIdentity: (work: Extract<PublicIntakeWork, { kind: 'identity' }>, capture: PublicCapture<PublicIdentity>, fence: AdministrationWriteFence) => Promise<void>;
  recordLeagues: (work: Extract<PublicIntakeWork, { kind: 'leagues' }>, capture: PublicCapture<readonly PublicLeague[]>, fence: AdministrationWriteFence) => Promise<void>;
  register: (work: Extract<PublicIntakeWork, { kind: 'bootstrap' | 'core' | 'users' }>, capture: CapturedAdministrationDocument,
    fence: AdministrationWriteFence) => Promise<void>;
  completeCore: (work: Extract<PublicIntakeWork, { kind: 'bootstrap' | 'core' | 'users' }>, mapping: AdministrationSourceMapping,
    checkpoint: PublicCoreCheckpoint, fence: AdministrationWriteFence) => Promise<void>;
  fail: (work: PublicIntakeWork, fence: AdministrationWriteFence) => Promise<void>;
}>;

export function validatePublicIntake(input: PublicIntakeInput): PublicIntakeInput {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(input.id)
    || !/^[a-zA-Z0-9_]{1,100}$/u.test(input.username)
    || !Array.isArray(input.seasons) || input.seasons.length < 1 || input.seasons.length > 3
    || input.seasons.some(season => !Number.isInteger(season) || season < 1920 || season > 2200)
    || new Set(input.seasons).size !== input.seasons.length) throw new Error('Invalid public intake scope.');
  return { id: input.id.toLowerCase(), username: input.username, seasons: [...input.seasons].sort((a, b) => a - b) };
}
