import type { JsonValue } from './contracts';

export const PLAYER_DIRECTORY_SCHEMA = 'sleeper-player-directory-v1' as const;
export const PLAYER_DIRECTORY_NAMESPACE = 'nfl:players' as const;
export const PLAYER_DIRECTORY_MAX_ROWS = 100_000;
export const PLAYER_DIRECTORY_PAGE_LIMIT = 200;
export const PLAYER_DIRECTORY_FIELDS = ['player_id', 'full_name', 'first_name', 'last_name', 'position',
  'team', 'active', 'status', 'fantasy_positions', 'injury_status'] as const;
export type PlayerDirectoryField = typeof PLAYER_DIRECTORY_FIELDS[number];
export type PlayerDirectoryFieldState = 'missing' | 'null' | 'supplied' | 'invalid';

/** This shared namespace is independent of league/season membership and cross-provider links. */
export type PlayerDirectoryRow = Readonly<{
  externalPlayerId: string; providerPlayerId: string | null;
  fullName: string | null; firstName: string | null; lastName: string | null;
  position: string | null; team: string | null; active: boolean | null;
  status: string | null; fantasyPositions: readonly string[] | null; injuryStatus: string | null;
  fieldStates: Readonly<Record<PlayerDirectoryField, PlayerDirectoryFieldState>>;
  identityStatus: 'valid' | 'invalid' | 'conflict'; reasons: readonly string[];
  /** Exact parsed native row, including unknown fields and invalid values. */
  source: JsonValue;
}>;
export type PlayerDirectoryAttempt = Readonly<{
  id: string; nonce: string; ordinal: number; expectedGeneration: number; reservedAt: string;
}>;
export type PlayerDirectoryReservation = Readonly<{ status: 'reserved'; attempt: PlayerDirectoryAttempt }>
  | Readonly<{ status: 'backoff'; retryAt: string }>;
export type PlayerDirectorySourceSlice = Readonly<{
  scope: 'all'; endpoint: '/players/nfl'; status: 'available' | 'invalid' | 'unavailable';
  sourceRevision: string | null; observedAt: string | null; complete: boolean;
  rowCount: number; validRowCount: number; invalidRowCount: number; conflictRowCount: number;
}>;
export type PlayerDirectoryCapture = Readonly<{
  schemaVersion: typeof PLAYER_DIRECTORY_SCHEMA; normalizerVersion: typeof PLAYER_DIRECTORY_SCHEMA;
  provider: 'sleeper'; sport: 'nfl'; namespace: typeof PLAYER_DIRECTORY_NAMESPACE;
  attemptId: string; attemptNonce: string; origin: 'network';
  requestStartedAt: string | null; requestCompletedAt: string | null; sourceObservedAt: string | null;
  /** Retains duplicate JSON members and original source spelling; never reconstructed from rows. */
  rawJson: string | null; sourceRevision: string | null;
  duplicateMemberCount: number; duplicateMemberPaths: readonly string[]; duplicateMemberPathsTruncated: boolean;
  status: 'complete' | 'partial' | 'invalid' | 'unavailable'; reasons: readonly string[];
  sourceSlices: readonly PlayerDirectorySourceSlice[]; rows: readonly PlayerDirectoryRow[];
  /** Actual fetch invocations, including failed HTTP; no redirects or automatic retry. */
  providerRequests: 0 | 1;
}>;
export type PlayerDirectoryWriteResult = Readonly<{
  status: 'accepted' | 'preserved' | 'replayed'; reason: string;
  receiptId: string; contentId: string | null; acceptedVersionId: string | null; generation: number;
}>;
export type PlayerDirectoryReadSelection = Readonly<{
  /** Immutable acceptance identity: pins both content and its original capture evidence. */
  versionId?: string;
  /** Continuation pages require versionId from the first page to preserve immutable capture evidence. */
  afterPlayerId?: string; limit?: number; playerIds?: readonly string[];
}>;
export type PlayerDirectoryVersion = Readonly<{
  versionId: string; contentId: string; receiptId: string; attemptId: string; generation: number;
  sourceRevision: string; requestStartedAt: string; requestCompletedAt: string; sourceObservedAt: string;
  acceptedAt: string; rowCount: number; sourceSlices: readonly PlayerDirectorySourceSlice[];
}>;
export type PlayerDirectoryLatestAttempt = Readonly<{
  attemptId: string; ordinal: number; reservedAt: string; status: 'pending' | PlayerDirectoryCapture['status'];
  receiptId: string | null; reasons: readonly string[]; retryAt: string;
}>;
export type PlayerDirectoryRead = Readonly<{
  status: 'available'; provider: 'sleeper'; sport: 'nfl'; namespace: typeof PLAYER_DIRECTORY_NAMESPACE;
  version: PlayerDirectoryVersion; latestAttempt: PlayerDirectoryLatestAttempt | null;
  rows: readonly PlayerDirectoryRow[]; nextCursor: string | null;
}> | Readonly<{ status: 'missing'; latestAttempt?: PlayerDirectoryLatestAttempt | null }>
  | Readonly<{ status: 'disabled' | 'unavailable'; reason?: string }>;

export type PlayerDirectoryOutcome = Readonly<{
  status: 'progress' | 'busy' | 'backoff' | 'unavailable' | 'disabled' | 'deadline';
  resource?: 'player-directory'; providerRequests: number; result?: PlayerDirectoryWriteResult;
}>;
