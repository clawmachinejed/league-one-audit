import 'server-only';

import { randomUUID } from 'node:crypto';
import { getDatabase, withDatabaseAbortSignal } from '../database';
import { createProjectionStore } from '../projection-store';
import { getOfficialLeagueAdministration, getOfficialMatchupObservation, getOfficialTransactionWeek,
  getOfficialAdministrationMetadata, type CapturedAdministrationDocument } from '../sleeper';
import { ADMINISTRATION_DIALECT, ADMINISTRATION_NORMALIZER_VERSION, ADMINISTRATION_SCHEMA_VERSION } from './contracts';
import type { JsonValue } from './contracts';
import { normalizeAdministrationObservation } from './normalize';
import { ADMINISTRATION_MAINTENANCE_JOB } from './maintenance';
import { recordCapturedAdministration } from './runtime';
import { createLeagueAdministrationStore } from './store';

export type AdministrationOperatorInput = Readonly<{
  mode: 'shadow' | 'write'; season: number; league: string; weeks: readonly number[];
  expectedDatabase: string; expectedRole: string;
  includeMetadata?: boolean;
}>;

export function parseAdministrationOperatorInput(args: readonly string[], env: Readonly<Record<string, string | undefined>> = process.env): AdministrationOperatorInput {
  const requiredFlags = ['--mode', '--season', '--league', '--weeks'];
  const flags = [...requiredFlags, '--metadata'];
  if (![8, 10].includes(args.length) || requiredFlags.some(flag => args.filter(value => value === flag).length !== 1)
    || args.filter(value => value === '--metadata').length > 1
    || args.some((value, index) => index % 2 === 0 && !flags.includes(value))) throw new Error('Invalid administration operator arguments.');
  const value = (flag: string) => args[args.indexOf(flag) + 1];
  const mode = value('--mode');
  const season = Number(value('--season'));
  const league = value('--league');
  const metadata = args.includes('--metadata') ? value('--metadata') : 'skip';
  if (!['include', 'skip'].includes(metadata)) throw new Error('Invalid administration metadata selection.');
  const includeMetadata = metadata === 'include';
  const weekRange = /^(\d{1,2})-(\d{1,2})$/.exec(value('--weeks'));
  if (!['shadow', 'write'].includes(mode) || !Number.isInteger(season) || season < 1920 || season > 2200
    || !/^[a-z][a-z0-9-]*$/.test(league) || !weekRange) throw new Error('Invalid administration scope.');
  const first = Number(weekRange[1]); const last = Number(weekRange[2]);
  if (first < 0 || last > 18 || first > last) throw new Error('Invalid administration week range.');
  const requireValue = (name: string) => { const result = env[name]?.trim(); if (!result) throw new Error('Administration operator identity is incomplete.'); return result; };
  const target = requireValue('LEAGUE_ADMINISTRATION_TARGET_ENVIRONMENT');
  if (!['integration', 'production'].includes(target) || env.VERCEL_ENV !== target) throw new Error('Administration target environment mismatch.');
  const url = new URL(requireValue('DATABASE_URL'));
  const expectedDatabase = requireValue('LEAGUE_ADMINISTRATION_EXPECTED_DATABASE');
  const expectedRole = requireValue('LEAGUE_ADMINISTRATION_EXPECTED_ROLE');
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['require', 'verify-ca', 'verify-full'].includes(url.searchParams.get('sslmode') ?? '')
    || url.hostname !== requireValue('LEAGUE_ADMINISTRATION_EXPECTED_HOST')
    || decodeURIComponent(url.pathname.slice(1)) !== expectedDatabase
    || decodeURIComponent(url.username) !== expectedRole || expectedRole !== 'league_one_runtime') throw new Error('Administration database target mismatch.');
  const authorization = env.LEAGUE_ADMINISTRATION_WRITE_AUTHORIZATION;
  if (mode === 'shadow' ? !!authorization : authorization !== `${season}:${league}:${first}-${last}${includeMetadata ? ':metadata' : ''}`) {
    throw new Error('Administration write authority does not match the exact operation.');
  }
  return { mode: mode as 'shadow' | 'write', season, league,
    weeks: Array.from({ length: last - first + 1 }, (_, index) => first + index), expectedDatabase, expectedRole, includeMetadata };
}

/** Bounded bootstrap/correction entry point using the same source, normalizer and writer as recurrence. */
export async function runAdministrationOperator(input: AdministrationOperatorInput) {
  const signal = AbortSignal.timeout(180_000);
  const deadlineAt = new Date(Date.now() + 180_000).toISOString();
  const database = withDatabaseAbortSignal(getDatabase(), signal);
  const store = createLeagueAdministrationStore(database);
  const jobs = createProjectionStore(database);
  if (!store.enabled || !jobs.enabled) throw new Error('Administration database is disabled.');
  const identity = await jobs.readDatabaseIdentity();
  if (identity.databaseName !== input.expectedDatabase || identity.roleName !== input.expectedRole) throw new Error('Administration session identity mismatch.');
  const enrolled = (await store.listEnrollments(input.season)).filter(league => input.league === 'all' || league.leagueKey === input.league);
  if (!enrolled.length || enrolled.some(league => league.season !== input.season)) throw new Error('Administration enrollment is unavailable for the requested season.');
  const plannedRequests = enrolled.length * (3 + input.weeks.reduce((sum, week) => sum + (week > 0 ? 2 : 1), 0)
    + (input.includeMetadata ? 4 : 0));
  if (plannedRequests > 120) throw new Error('Administration operation exceeds its 120-request bound.');
  const workerId = randomUUID();
  const jobKey = ADMINISTRATION_MAINTENANCE_JOB;
  const claim = input.mode === 'write' ? await jobs.acquireJob({ jobKey, jobType: jobKey, workerId,
    scheduledFor: new Date().toISOString(), leaseSeconds: 180, payload: { mode: 'operator', season: input.season,
      league: input.league, weeks: input.weeks, plannedRequests } }) : null;
  if (claim && claim.kind !== 'acquired') return { status: 'busy', mode: input.mode, providerRequests: 0 };
  const fence = claim?.kind === 'acquired' ? { jobKey, workerId, generation: claim.attempt, deadlineAt } : undefined;
  let documents = 0; let accepted = 0; let rejected = 0; let providerRequests = 0;
  let reservedRequests = plannedRequests;
  let reason: string | undefined;
  let requestCountComplete = true;
  try {
    for (const league of enrolled) {
      const scope = { leagueKey: league.leagueKey, provider: league.provider,
        externalLeagueId: league.externalLeagueId, season: input.season };
      let expectedRosterCount: number | undefined;
      const inspect = async (observations: readonly CapturedAdministrationDocument[]) => {
        signal.throwIfAborted();
        let incompatibleConfiguration = false;
        for (const observation of observations) {
          const normalized = normalizeAdministrationObservation({ schemaVersion: ADMINISTRATION_SCHEMA_VERSION,
            normalizerVersion: ADMINISTRATION_NORMALIZER_VERSION, dialect: ADMINISTRATION_DIALECT,
            scope, family: observation.family, week: observation.week,
            provenance: { origin: observation.origin, requestStartedAt: observation.requestStartedAt,
              requestCompletedAt: observation.requestCompletedAt, sourceObservedAt: observation.sourceObservedAt,
              checkedAt: new Date().toISOString() }, completeness: observation.completeness ?? 'complete', payload: observation.payload as JsonValue },
          { expectedRosterCount });
          if (normalized.status === 'accepted' && normalized.value?.family === 'league') {
            expectedRosterCount = normalized.value.totalRosters ?? undefined;
            const rulesHash = normalized.value.rawScoringRulesHash;
            const registered = rulesHash ? await jobs.readAllPlayerLeagueProfiles({ provider: 'sleeper', season: input.season,
              leagues: [{ leagueKey: league.leagueKey, externalLeagueId: league.externalLeagueId, rulesHash }] }) : [];
            incompatibleConfiguration = registered.length !== 1 || registered[0].scoringProfileId !== league.scoringProfileId
              || registered[0].leagueSeasonId !== league.leagueSeasonId || expectedRosterCount === undefined;
          }
          documents++; if (normalized.status === 'accepted') accepted++; else rejected++;
        }
        if (input.mode === 'write') {
          const result = await recordCapturedAdministration(scope, observations, { store, fence, signal, expectedRosterCount });
          if (result.status !== 'stored') throw new Error('Administration batch contains unaccepted evidence.');
        }
        if (incompatibleConfiguration) throw new Error('Administration configuration requires an evidenced compatibility decision.');
      };
      providerRequests += 3; reservedRequests -= 3;
      await inspect(await getOfficialLeagueAdministration(league.externalLeagueId, { revalidate: 0, signal }));
      if (input.includeMetadata) {
        reservedRequests -= 4;
        requestCountComplete = false;
        const metadata = await getOfficialAdministrationMetadata(league.externalLeagueId, input.season,
          { signal, maxRequests: 120 - providerRequests - reservedRequests });
        providerRequests += metadata.providerRequests;
        requestCountComplete = true;
        reason = metadata.reason;
        await inspect(metadata.observations);
        if (metadata.reason) throw new Error('Administration metadata coverage is incomplete.');
      }
      for (const week of input.weeks) {
        providerRequests += week > 0 ? 2 : 1; reservedRequests -= week > 0 ? 2 : 1;
        const observations = await Promise.all([
          ...(week > 0 ? [getOfficialMatchupObservation(league.externalLeagueId, week, 0, signal)] : []),
          getOfficialTransactionWeek(league.externalLeagueId, week, 0, signal),
        ]);
        await inspect(observations);
      }
    }
    if (fence && !await jobs.completeJob(jobKey, workerId)) throw new Error('Administration operation lost ownership.');
    return { status: rejected ? 'partial' : 'completed', mode: input.mode, season: input.season,
      leagues: enrolled.length, documents, accepted, rejected, providerRequests, writes: input.mode === 'write' };
  } catch {
    if (fence) {
      const cleanup = createProjectionStore(withDatabaseAbortSignal(getDatabase(), AbortSignal.timeout(2_000)));
      await cleanup.failJob(jobKey, workerId, signal.aborted ? 'administration-operator-timeout' : 'administration-operator-failed').catch(() => false);
    }
    return { status: 'failed', mode: input.mode, documents, accepted, rejected,
      providerRequests: requestCountComplete ? providerRequests : null,
      ...(!requestCountComplete ? { providerRequestLowerBound: providerRequests } : {}),
      reason: signal.aborted ? 'timeout' : reason ?? 'source-validation-or-storage-failed' };
  }
}
