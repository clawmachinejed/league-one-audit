import 'server-only';

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { foundationFixture } from './all-player-foundation-fixture';
import { loadFoundationWeeklyIdentityCatalog } from './all-player-weekly-identity-fixture';
import type { AllPlayerIdentityLookup } from '../lib/projections/adapters/neon/contracts';
import { createProductionAllPlayerDependencies } from '../lib/projections/runtime/all-player-composition';
import { parseAllPlayerOperatorInput } from '../lib/projections/runtime/all-player-operator-guards';
import { runAllPlayerIngestion, type AllPlayerIngestionDependencies } from '../lib/projections/runtime/all-player-operation';
import type { AllPlayerStatObservation } from '../lib/projections/domain/all-player-statistics';
import type { NflTeam, ProjectionSlate } from '../lib/projections/domain/contracts';
import type { ProjectionSlateContentId, ProjectionSlateObservationId } from '../lib/projections/ports/projection-repository';
import { externalPlayerRef, externalTeamDefenseRef, providerKey } from '../lib/projections/shared/provider-identity';

function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(new URL(`./fixtures/all-player-foundation/${name}`, import.meta.url), 'utf8')) as T;
}

// The real operator's safeguards run outside Next. These are invented, inert
// integration identities: all database ports below reject mutations.
const input = parseAllPlayerOperatorInput([
  '--mode', 'shadow', '--season', '2026', '--season-type', 'regular', '--week', '1',
], {
  ALL_PLAYER_OPERATION_MODE: 'shadow', ALL_PLAYER_TARGET_ENVIRONMENT: 'integration', VERCEL_ENV: 'integration',
  DATABASE_URL: 'postgresql://fixture:fixture@fixture.invalid/fixture?sslmode=verify-full',
  ALL_PLAYER_EXPECTED_DATABASE_HOST: 'fixture.invalid',
  ALL_PLAYER_EXPECTED_DATABASE_NAME: 'fixture', ALL_PLAYER_EXPECTED_DATABASE_ROLE: 'fixture',
});
const requests: string[] = [];
const unexpectedRequests: string[] = [];
const databaseWrites: string[] = [];
const fixtureFailures: string[] = [];
const weeklyIdentitySupplement = loadFoundationWeeklyIdentityCatalog();
const catalog = weeklyIdentitySupplement.catalog;
type RuntimeSourceSupplement = {
  observedAt: string;
  provenance: { rosterAndMatchupFieldsMatched: boolean; noWeeklyStatRequest: boolean; noTank01Request: boolean };
  leagues: Record<'league1' | 'league2', {
    league: { name: string; total_rosters: number };
    rosters: Record<string, { settings: Record<string, number> }>;
    matchups: Record<string, { matchup_id: number }>;
  }>;
};
const supplement = fixture<RuntimeSourceSupplement>('runtime-source-supplement.json');
const supplementCanonicalSha256 = createHash('sha256').update(JSON.stringify(supplement)).digest('hex');
const provenance = fixture<{ runtimeSourceSupplement: { canonicalJsonSha256: string } }>('provenance.json');
if (!supplement.provenance.rosterAndMatchupFieldsMatched || !supplement.provenance.noWeeklyStatRequest
  || !supplement.provenance.noTank01Request
  || supplementCanonicalSha256 !== provenance.runtimeSourceSupplement.canonicalJsonSha256) {
  throw new Error('The runtime supplement is not the reviewed exact-field-matched capture.');
}
function supplementMissing<T extends object, U extends object>(original: T, extra: U, allowed: string[]): T & U {
  if (Object.keys(extra).some((key) => !allowed.includes(key) || Object.prototype.hasOwnProperty.call(original, key))) {
    throw new Error('Runtime supplementation must never replace retained evidence.');
  }
  return { ...original, ...extra };
}
const leaguesById = new Map(foundationFixture.leagues.map((league) => {
  const extra = supplement.leagues[league.key];
  const keys = (rows: readonly { roster_id: number }[]) => rows.map((row) => String(row.roster_id)).sort();
  if (JSON.stringify(keys(league.rosters)) !== JSON.stringify(Object.keys(extra.rosters).sort())
    || JSON.stringify(keys(league.matchups)) !== JSON.stringify(Object.keys(extra.matchups).sort())) {
    throw new Error('Runtime supplement roster identities do not match retained evidence.');
  }
  return [league.settings.league_id, {
    ...league,
    settings: supplementMissing(league.settings, extra.league, ['name', 'total_rosters']),
    rosters: league.rosters.map((row) => supplementMissing(row, extra.rosters[String(row.roster_id)], ['settings'])),
    matchups: league.matchups.map((row) => supplementMissing(row, extra.matchups[String(row.roster_id)], ['matchup_id'])),
  }];
}));

// Replay only retained source data. Users were deliberately not retained;
// presentation receives an empty list, not invented manager identities.
globalThis.fetch = async (request: string | URL | Request) => {
  const url = new URL(request instanceof Request ? request.url : String(request));
  requests.push(url.href);
  if (url.hostname !== 'api.sleeper.app' && url.hostname !== 'api.sleeper.com') {
    unexpectedRequests.push(url.href);
    throw new Error('The fixture prohibits every unrecognized provider request.');
  }
  if (url.pathname === '/v1/players/nfl' && url.search === '') return Response.json(catalog);
  if (url.pathname === '/v1/stats/nfl/regular/2026/1' && url.search === '') {
    return Response.json(foundationFixture.weekly, { headers: { etag: '"retained-audit-week-1"' } });
  }
  if (url.pathname === '/v1/state/nfl') {
    return Response.json({ season: '2026', season_type: 'regular', leg: 1, week: 1, display_week: 1 });
  }
  // Stored exact-period game context is translated into the existing schedule
  // source shape solely for local replay. This is not newly retrieved evidence.
  if (url.pathname === '/scores/nfl/regular/2026/1') {
    return Response.json(foundationFixture.games.map((game) => ({
      status: game.phase === 'final' ? 'complete' : 'scheduled', date: game.kickoffAt.slice(0, 10),
      metadata: { home_team: game.homeTeam, away_team: game.awayTeam, canceled: false },
      start_time: Date.parse(game.kickoffAt), week: 1, season_type: 'regular', season: '2026',
    })));
  }
  // No full-season schedule was retained; never fabricate one to infer byes.
  if (url.pathname === '/schedule/nfl/regular/2026') return Response.json([]);
  const match = /^\/v1\/league\/([^/]+)(?:\/(rosters|users|matchups\/1))?$/u.exec(url.pathname);
  if (match && leaguesById.has(match[1])) {
    const league = leaguesById.get(match[1])!;
    if (!match[2]) return Response.json(league.settings);
    if (match[2] === 'rosters') return Response.json(league.rosters);
    if (match[2] === 'users') return Response.json([]);
    return Response.json(league.matchups);
  }
  unexpectedRequests.push(url.href);
  throw new Error('The fixture prohibits every unrecognized source request.');
};

const capturedMappings = fixture<{ mappings: readonly {
  provider: string; externalId: string; entityKind: 'player' | 'team_defense';
  scoringEntityId: string; mappedKind: 'player' | 'team_defense'; mappingStatus: 'verified'; validTo: string | null;
}[] }>('mapping-evidence.json').mappings;
const mappingByKey = new Map(capturedMappings.map((mapping) => [
  `${mapping.provider}:${mapping.entityKind}:${mapping.externalId}`, mapping,
]));
const capturedProfiles = fixture<{ profiles: Awaited<ReturnType<AllPlayerIngestionDependencies['store']['readAllPlayerLeagueProfiles']>> }>('game-context.json').profiles;
const projectionIdentities = fixture<{ entries: readonly {
  entityKind: 'player' | 'team_defense'; providerExternalId: string;
  aliases: readonly { provider: string; externalId: string }[]; position: string; nflTeam: NflTeam;
}[] }>('projection-identities.json').entries;
const projectionProvider = providerKey('tank01');
const projections: ProjectionSlate['projections'] = projectionIdentities.map((entry) => {
  const reference = entry.entityKind === 'team_defense' ? externalTeamDefenseRef : externalPlayerRef;
  return {
    identity: {
      primary: reference(projectionProvider, entry.providerExternalId),
      aliases: entry.aliases.map((alias) => reference(providerKey(alias.provider), alias.externalId)),
    },
    nflTeam: entry.nflTeam, position: entry.position,
    // Only identity metadata was retained in the audit; these empty statistics
    // are scaffolding and are not used as projection or scoring evidence.
    stats: {}, scoringStats: { kind: entry.entityKind === 'team_defense' ? 'defense' : 'offense' }, missingFields: [],
  };
});
const production = createProductionAllPlayerDependencies();
let observation: AllPlayerStatObservation | null = null;
const writeTrap = (name: string) => async () => {
  databaseWrites.push(name);
  throw new Error('The fixture shadow prohibits database writes.');
};
const dependencies: AllPlayerIngestionDependencies = {
  ...production,
  clock: { now: () => new Date(), monotonicNow: () => performance.now() },
  logger: { write: () => undefined },
  loadLeagueWeek: async (...arguments_) => {
    try { return await production.loadLeagueWeek(...arguments_); }
    catch (error) {
      fixtureFailures.push(`league-loader:${error instanceof Error ? error.message : 'unknown'}`);
      throw error;
    }
  },
  store: {
    enabled: true,
    readLeagueLineupAuthorities: async () => [],
    readAllPlayerLeagueProfiles: async () => capturedProfiles,
    readAllPlayerIdentityMappings: async (lookups: readonly AllPlayerIdentityLookup[]) => lookups.map((lookup) => {
      const mapping = mappingByKey.get(`${lookup.provider}:${lookup.entityKind}:${lookup.externalId}`);
      return { ...lookup, scoringEntityId: mapping?.scoringEntityId ?? null,
        mappedEntityKind: mapping?.mappedKind ?? null, mappingStatus: mapping?.mappingStatus ?? null,
        validFrom: null, validTo: mapping?.validTo ?? null };
    }),
    readAllPlayerGameContext: async () => foundationFixture.games,
    acquireAllPlayerJob: writeTrap('acquireAllPlayerJob'),
    markAllPlayerRequest: writeTrap('markAllPlayerRequest'),
    finishAllPlayerJob: writeTrap('finishAllPlayerJob'),
    recordAllPlayerPreclaimOutcome: writeTrap('recordAllPlayerPreclaimOutcome'),
    upsertScoringEntities: writeTrap('upsertScoringEntities'),
    recordLeagueWeekObservation: writeTrap('recordLeagueWeekObservation'),
    recordAllPlayerBatch: writeTrap('recordAllPlayerBatch'),
    validateAllPlayerJobFence: async () => true,
    readAllPlayerJobState: async () => null,
  },
  projectionRepository: { readCurrentProjectionSlate: async () => ({
    observationId: 'retained-projection-observation' as ProjectionSlateObservationId,
    contentId: 'retained-projection-content' as ProjectionSlateContentId, semanticHash: 'a'.repeat(64),
    verifiedAt: foundationFixture.capturedAt, materialChangedAt: foundationFixture.capturedAt,
    slate: {
      source: projectionProvider, period: input.period, quality: 'complete',
      requestStartedAt: foundationFixture.capturedAt, requestCompletedAt: foundationFixture.capturedAt,
      observedAt: foundationFixture.capturedAt, sourceRevision: 'retained-audit-projection-identities', projections,
      coverage: {
        crosswalkRows: 456, crosswalkEntries: 456, malformedCrosswalkRows: 0, ambiguousCrosswalkRows: 0,
        playerRows: 456, matchedPlayers: 456, unmatchedPlayers: 0, malformedPlayers: 0, incompletePlayers: 0,
        defenseRows: 32, usableDefenses: 32, malformedDefenses: 0, incompleteDefenses: 0,
      }, warnings: [],
    },
  }) },
  allPlayerSource: { access: 'replay', load: async (request) => {
    try {
      const result = await production.allPlayerSource.load(request);
      if (result.status === 'available') observation = result.observation;
      return result;
    } catch (error) {
      fixtureFailures.push(`weekly-source:${error instanceof Error ? error.message : 'unknown'}`);
      throw error;
    }
  } },
};
const result = await runAllPlayerIngestion(dependencies, { mode: 'shadow', period: input.period, requireFinalCoverage: true });
const retainedObservation = observation as AllPlayerStatObservation | null;
process.stdout.write(`${JSON.stringify({
  result, requests, unexpectedRequests, databaseWrites, fixtureFailures,
  runtimeSupplement: { observedAt: supplement.observedAt, canonicalJsonSha256: supplementCanonicalSha256 },
  weeklyIdentitySupplement: {
    observedAt: weeklyIdentitySupplement.supplement.observedAt,
    canonicalJsonSha256: weeklyIdentitySupplement.canonicalJsonSha256,
    byteSha256: weeklyIdentitySupplement.byteSha256,
    addedIdentityCount: weeklyIdentitySupplement.addedIdentityIds.length,
    overlappingIdentityCount: weeklyIdentitySupplement.overlappingIdentityIds.length,
    overlapMetadataDifferences: weeklyIdentitySupplement.overlapMetadataDifferences,
  },
  observation: retainedObservation && {
    quality: retainedObservation.quality, coverage: retainedObservation.coverage,
    entryCount: retainedObservation.entries.length,
    defenseCount: retainedObservation.entries.filter((entry) => entry.entityKind === 'team_defense').length,
    cases: retainedObservation.entries.filter((entry) => ['7527', '11292', '10224', '5859', '12529'].includes(entry.providerExternalId)),
  },
  fixtureClassification: 'retained incomplete Week 1 with separately observed omitted loader fields and absent current catalog identities; original metadata preserved; schedule transformed from stored context; projection identities only; no complete-period claim',
})}\n`);
