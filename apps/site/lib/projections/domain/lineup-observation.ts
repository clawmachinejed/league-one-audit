import type { LeaguePeriod } from './contracts';
import {
  externalReferenceKey,
  sameExternalReference,
  type ExternalLeagueRef,
  type ExternalLineupEntryRef,
  type ExternalMatchupRef,
  type ExternalRosterRef,
} from '../shared/provider-identity';

export type LineupShape = Readonly<{
  expectedRosterCount: number;
  expectedStarterSlotCount: number;
  /** Exact roster membership from authoritative league configuration, never inferred from row count. */
  expectedRosterRefs: readonly ExternalRosterRef[];
}>;

export type LineupObservationRow = Readonly<{
  rosterRef: ExternalRosterRef;
  matchupRef: ExternalMatchupRef | null;
  /** Order is material; null is the only canonical empty-slot marker. */
  starters: readonly (ExternalLineupEntryRef | null)[];
}>;

export type LineupObservationInput = Readonly<{
  leagueRef: ExternalLeagueRef;
  period: LeaguePeriod;
  shape: LineupShape;
  rows: readonly LineupObservationRow[];
}>;

export type LineupInvalidReason =
  | 'shape-unavailable' | 'period-invalid' | 'identity-invalid'
  | 'roster-population-incomplete' | 'duplicate-roster'
  | 'starter-shape-invalid' | 'duplicate-starter' | 'matchup-pairing-invalid';

export type LineupObservationResult =
  | Readonly<{ status: 'complete'; observation: LineupObservationInput }>
  | Readonly<{ status: 'not-ready'; reason: 'empty' | 'unpaired' }>
  | Readonly<{ status: 'invalid'; reason: LineupInvalidReason }>
  | Readonly<{ status: 'unavailable'; reason: 'source-unavailable' }>;

export type TimedLineupObservation = LineupObservationResult & Readonly<{
  requestStartedAt: string;
  requestCompletedAt: string;
}>;

export function validLineupShape(shape: LineupShape): boolean {
  return Number.isInteger(shape.expectedRosterCount) && shape.expectedRosterCount > 0
    && Number.isInteger(shape.expectedStarterSlotCount) && shape.expectedStarterSlotCount > 0
    && Array.isArray(shape.expectedRosterRefs)
    && shape.expectedRosterRefs.length === shape.expectedRosterCount
    && shape.expectedRosterRefs.every((reference) => reference?.resource === 'roster'
      && typeof reference.provider === 'string' && Boolean(reference.provider.trim())
      && typeof reference.externalId === 'string' && Boolean(reference.externalId.trim())
      && validLeague(reference.league))
    && new Set(shape.expectedRosterRefs.map(externalReferenceKey)).size === shape.expectedRosterCount;
}

function samePeriod(left: LeaguePeriod, right: LeaguePeriod): boolean {
  return left.season === right.season && left.seasonType === right.seasonType
    && left.week === right.week;
}

function validLeague(reference: ExternalLeagueRef): boolean {
  return reference?.resource === 'league'
    && typeof reference.provider === 'string' && Boolean(reference.provider.trim())
    && typeof reference.externalId === 'string' && Boolean(reference.externalId.trim());
}

function validScopedIdentity(
  reference: ExternalRosterRef | ExternalMatchupRef | ExternalLineupEntryRef,
  league: ExternalLeagueRef,
): boolean {
  return typeof reference.externalId === 'string' && Boolean(reference.externalId.trim())
    && reference.provider === league.provider
    && validLeague(reference.league) && sameExternalReference(reference.league, league);
}

/** Validates canonical assignments only; no catalog or ID-format inference is allowed. */
export function validateLineupObservation(input: LineupObservationInput): LineupObservationResult {
  const invalid = (reason: LineupInvalidReason): LineupObservationResult => ({ status: 'invalid', reason });
  if (!validLineupShape(input.shape)) return invalid('shape-unavailable');
  const { period, leagueRef } = input;
  if (!Number.isInteger(period.season) || period.season < 1920 || period.season > 2200
    || !['preseason', 'regular', 'postseason'].includes(period.seasonType)
    || !Number.isInteger(period.week) || period.week < 1 || period.week > 18) {
    return invalid('period-invalid');
  }
  if (!validLeague(leagueRef)) return invalid('identity-invalid');
  if (input.shape.expectedRosterRefs.some((reference) => !validScopedIdentity(reference, leagueRef))) {
    return invalid('identity-invalid');
  }
  const expectedRosterKeys = new Set(input.shape.expectedRosterRefs.map(externalReferenceKey));
  if (input.rows.length === 0) return { status: 'not-ready', reason: 'empty' };
  if (input.rows.length !== input.shape.expectedRosterCount) return invalid('roster-population-incomplete');
  const rosterKeys = new Set<string>();
  const occupiedKeys = new Set<string>();
  const pairedCounts = new Map<string, number>();
  let unpaired = false;
  for (const row of input.rows) {
    if (row.rosterRef.resource !== 'roster' || !validScopedIdentity(row.rosterRef, leagueRef)) {
      return invalid('identity-invalid');
    }
    const rosterKey = externalReferenceKey(row.rosterRef);
    if (!expectedRosterKeys.has(rosterKey)) return invalid('roster-population-incomplete');
    if (rosterKeys.has(rosterKey)) return invalid('duplicate-roster');
    rosterKeys.add(rosterKey);
    if (row.starters.length !== input.shape.expectedStarterSlotCount) return invalid('starter-shape-invalid');
    for (const starter of row.starters) {
      if (starter === null) continue;
      if (starter.resource !== 'lineup-entry' || !validScopedIdentity(starter, leagueRef)) {
        return invalid('identity-invalid');
      }
      const key = externalReferenceKey(starter);
      if (occupiedKeys.has(key)) return invalid('duplicate-starter');
      occupiedKeys.add(key);
    }
    if (row.matchupRef === null) { unpaired = true; continue; }
    if (row.matchupRef.resource !== 'matchup' || !validScopedIdentity(row.matchupRef, leagueRef)
      || !samePeriod(row.matchupRef.period, period)) return invalid('identity-invalid');
    const key = externalReferenceKey(row.matchupRef);
    pairedCounts.set(key, (pairedCounts.get(key) ?? 0) + 1);
  }
  if ([...pairedCounts.values()].some((count) => count !== 2)) return invalid('matchup-pairing-invalid');
  if (unpaired) return { status: 'not-ready', reason: 'unpaired' };
  return { status: 'complete', observation: input };
}
