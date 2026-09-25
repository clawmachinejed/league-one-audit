import 'server-only';

import { cache } from 'react';
import { LEAGUE_IDS } from './config';
import { isLeagueRouteKey, LEAGUE_SITES } from './leagues';
import { getLeagueAdministrationStore } from './league-administration/store';
import type { AdministrationEnvelope, AdministrationFamily, AdministrationScope } from './league-administration/contracts';
import { ADMINISTRATION_DIALECT, ADMINISTRATION_NORMALIZER_VERSION, ADMINISTRATION_SCHEMA_VERSION } from './league-administration/contracts';
import type { LeagueAdministrationStore, LeagueAdministrationStoreRead } from './league-administration/store-contracts';

export type { AdministrationFamily } from './league-administration/contracts';

type SourceRead = LeagueAdministrationStoreRead;
export type PageAdministrationStore = Pick<LeagueAdministrationStore, 'readSourceByConnection' | 'readSource'>;

export class AdministrationSourceConflictError extends Error {}

export type PageAdministrationRead = Readonly<{
  status: 'available'; payload: unknown; requestStartedAt: string; requestCompletedAt: string;
  sourceObservedAt: string | null; origin: AdministrationEnvelope['provenance']['origin'];
}> | Readonly<{ status: 'fallback'; reason: 'missing' | 'disabled' | 'unavailable' | 'stale' }>;

export type PageAdministrationRequest = Readonly<{
  externalLeagueId: string; family: AdministrationFamily; week: number | null; season?: number; leagueKey?: string;
  maxAgeSeconds?: number;
  /** Accepted completed prior-season evidence retains its original provenance without a current-source TTL. */
  historicalSeason?: boolean;
}>;

function isFresh(read: Extract<SourceRead, { status: 'available' }>, maxAgeSeconds: number, now: number) {
  // checkedAt can advance for unknown-age cache evidence. Only a proven fresh
  // upstream verification can satisfy the caller's existing source TTL.
  if (!Number.isFinite(maxAgeSeconds) || maxAgeSeconds <= 0 || !Number.isFinite(now)
    || typeof read.verifiedAt !== 'string') return false;
  return [read.checkedAt, read.verifiedAt].every(value => {
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) && timestamp <= now && now - timestamp <= maxAgeSeconds * 1000;
  });
}

function assertHistoricalRequest(request: PageAdministrationRequest, now: number) {
  if (!Number.isFinite(now) || typeof request.externalLeagueId !== 'string' || !request.externalLeagueId
    || request.externalLeagueId.trim() !== request.externalLeagueId
    || request.season === undefined || !Number.isInteger(request.season) || request.season < 1920
    || request.season > 2200 || request.season >= new Date(now).getUTCFullYear()
    || request.leagueKey === undefined || !Object.prototype.hasOwnProperty.call(LEAGUE_SITES, request.leagueKey)
    || !['league', 'users', 'rosters', 'matchups'].includes(request.family)
    || (request.family === 'matchups'
      ? request.week === null || !Number.isInteger(request.week) || request.week < 1 || request.week > 14
      : request.week !== null)) {
    throw new AdministrationSourceConflictError('Historical league administration requires an explicit prior season, league identity and supported regular-season scope.');
  }
}

function assertHistoricalConfiguration(configuration: Extract<SourceRead, { status: 'available' }>, request: PageAdministrationRequest) {
  assertEnvelope(configuration.envelope, { ...request, family: 'league', week: null });
  const payload = configuration.envelope.payload;
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)
    || !('league_id' in payload) || payload.league_id !== request.externalLeagueId
    || !('season' in payload) || payload.season !== String(request.season)
    || !('status' in payload) || payload.status !== 'complete') {
    throw new AdministrationSourceConflictError('Stored historical league configuration does not prove the requested completed season.');
  }
}

function hasRetainedObservationTimes(read: Extract<SourceRead, { status: 'available' }>, now: number) {
  // Age is irrelevant for accepted completed seasons. Invalid or future-dated
  // evidence is not made usable by that exception. A recorded network
  // verification is still required; a recent cache check is not that proof.
  const observedNoLaterThanNow = (value: string) => Number.isFinite(Date.parse(value)) && Date.parse(value) <= now;
  return Number.isFinite(now) && typeof read.checkedAt === 'string' && observedNoLaterThanNow(read.checkedAt)
    && typeof read.verifiedAt === 'string' && observedNoLaterThanNow(read.verifiedAt)
    && [read.envelope.provenance.checkedAt, read.envelope.provenance.requestStartedAt,
      read.envelope.provenance.requestCompletedAt, read.envelope.provenance.sourceObservedAt]
      .every(value => value === null || observedNoLaterThanNow(value));
}

function hasCompletedSeasonVerification(configuration: Extract<SourceRead, { status: 'available' }>,
  read: Extract<SourceRead, { status: 'available' }>, now: number) {
  if (!hasRetainedObservationTimes(configuration, now) || !hasRetainedObservationTimes(read, now)) return false;
  const completionObservedAt = configuration.envelope.provenance.requestCompletedAt
    ?? configuration.envelope.provenance.checkedAt;
  // A separately completed configuration cannot finalize an older pre-final
  // document. Its accepted content must have been verified against the provider
  // at or after that completed configuration was observed. Retain every clock.
  return Date.parse(read.verifiedAt!) >= Date.parse(completionObservedAt);
}

function assertEnvelope(envelope: AdministrationEnvelope, request: PageAdministrationRequest, scope?: AdministrationScope) {
  // The store verifies annual connection ownership. Bootstrap IDs only add a
  // consistency check; they are not the inventory of valid annual source IDs.
  const bootstrapKey = Object.entries(LEAGUE_IDS).find(([, id]) => id === request.externalLeagueId)?.[0];
  const expectedKey = request.leagueKey ?? bootstrapKey;
  if (!envelope || envelope.scope?.provider !== 'sleeper'
    || !isLeagueRouteKey(envelope.scope.leagueKey)
    || envelope.schemaVersion !== ADMINISTRATION_SCHEMA_VERSION || envelope.normalizerVersion !== ADMINISTRATION_NORMALIZER_VERSION
    || envelope.dialect !== ADMINISTRATION_DIALECT
    || envelope.scope.externalLeagueId !== request.externalLeagueId
    || (expectedKey !== undefined && envelope.scope.leagueKey !== expectedKey)
    || !Number.isInteger(envelope.scope.season) || envelope.scope.season < 1920 || envelope.scope.season > 2200
    || (request.season !== undefined && envelope.scope.season !== request.season)
    || (scope && (envelope.scope.season !== scope.season || envelope.scope.leagueKey !== scope.leagueKey))
    || envelope.family !== request.family || envelope.week !== request.week || envelope.completeness !== 'complete') {
    throw new AdministrationSourceConflictError('Stored league administration does not match the requested source identity.');
  }
  const times = [envelope.provenance?.checkedAt, envelope.provenance?.requestStartedAt,
    envelope.provenance?.requestCompletedAt, envelope.provenance?.sourceObservedAt];
  if (typeof times[0] !== 'string' || times.some(value => value !== null
    && (typeof value !== 'string' || !Number.isFinite(Date.parse(value))))) {
    throw new AdministrationSourceConflictError('Stored league administration has invalid observation times.');
  }
  if (!['network', 'cache', 'bootstrap'].includes(envelope.provenance.origin)
    || (envelope.provenance.requestStartedAt !== null && envelope.provenance.requestCompletedAt !== null
      && Date.parse(envelope.provenance.requestStartedAt) > Date.parse(envelope.provenance.requestCompletedAt))) {
    throw new AdministrationSourceConflictError('Stored league administration has inconsistent observation provenance.');
  }
}

async function readSafely(read: () => Promise<SourceRead>): Promise<SourceRead> {
  try { return await read(); }
  catch (error) {
    if (error instanceof AdministrationSourceConflictError) throw error;
    return { status: 'unavailable' };
  }
}

function checkConflict(read: SourceRead): void {
  if (read.status === 'conflict') throw new AdministrationSourceConflictError('Stored league administration identity is conflicting.');
}

/** Injection remains read-only: page misses cannot enqueue collection or write acceptance. */
export function createPageAdministrationReader(getStore: () => PageAdministrationStore) {
  const readConfiguration = cache(async (externalLeagueId: string) => {
    const read = await readSafely(() => getStore().readSourceByConnection({ externalLeagueId,
      provider: 'sleeper', family: 'league', week: null }));
    checkConflict(read);
    if (read.status === 'available') assertEnvelope(read.envelope, { externalLeagueId, family: 'league', week: null });
    return read;
  });
  return async (request: PageAdministrationRequest): Promise<PageAdministrationRead> => {
    if (request.historicalSeason === true) assertHistoricalRequest(request, Date.now());
    const configuration = await readConfiguration(request.externalLeagueId);
    if (configuration.status !== 'available') {
      if (configuration.status === 'conflict') throw new AdministrationSourceConflictError('Stored league administration identity is conflicting.');
      return { status: 'fallback', reason: configuration.status };
    }
    if (request.season !== undefined && configuration.envelope.scope.season !== request.season) {
      throw new AdministrationSourceConflictError('Stored league administration season changed during the page read.');
    }
    if (request.historicalSeason === true) assertHistoricalConfiguration(configuration, request);
    const read = request.family === 'league' ? configuration
      : await readSafely(() => getStore().readSource({ ...configuration.envelope.scope, family: request.family, week: request.week }));
    checkConflict(read);
    if (read.status !== 'available') {
      if (read.status === 'conflict') throw new AdministrationSourceConflictError('Stored league administration identity is conflicting.');
      return { status: 'fallback', reason: read.status };
    }
    assertEnvelope(read.envelope, request, configuration.envelope.scope);
    const now = Date.now();
    const maxAgeSeconds = request.maxAgeSeconds ?? 60;
    const usableTimes = request.historicalSeason === true
      ? hasCompletedSeasonVerification(configuration, read, now)
      : isFresh(configuration, maxAgeSeconds, now) && isFresh(read, maxAgeSeconds, now);
    if (!usableTimes) {
      return { status: 'fallback', reason: 'stale' };
    }
    const provenance = read.envelope.provenance;
    // A retained document keeps its own observation/check times; never restamp it as a fresh fetch.
    return { status: 'available', payload: read.envelope.payload, origin: provenance.origin,
      requestStartedAt: provenance.requestStartedAt ?? provenance.checkedAt,
      requestCompletedAt: provenance.requestCompletedAt ?? provenance.checkedAt,
      sourceObservedAt: provenance.sourceObservedAt };
  };
}

export const readPageAdministrationSource = createPageAdministrationReader(getLeagueAdministrationStore);
