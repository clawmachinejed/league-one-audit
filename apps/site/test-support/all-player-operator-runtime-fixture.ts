import 'server-only';

import { LEAGUE_IDS } from '../lib/config';
import { deterministicUuid, rulesHash } from '../lib/projections/adapters/neon/database-values';
import { NFL_TEAM_CODES, type NflTeam } from '../lib/projections/domain/contracts';
import { createProductionAllPlayerDependencies } from '../lib/projections/runtime/all-player-composition';
import {
  runAllPlayerIngestion,
  type AllPlayerIngestionDependencies,
} from '../lib/projections/runtime/all-player-operation';
import type { FantasyPlayerCatalog } from '../lib/sleeper-player-catalog';

const scenario = process.argv[2];
if (scenario !== 'complete' && scenario !== 'failed-position') {
  throw new Error('A supported catalog runtime scenario is required.');
}

const positions = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'] as const;
const playerIds = Object.fromEntries(positions.map((position) => [
  position,
  `catalog-${position.toLowerCase()}`,
])) as Record<typeof positions[number], string>;
const requestUrls: string[] = [];
const rawRules = { pass_td: 4 };
const leagueNames = new Map<string, string>([
  [LEAGUE_IDS.league1, 'League One'],
  [LEAGUE_IDS.league2, 'League Two'],
]);
const schedulePairs = Array.from({ length: NFL_TEAM_CODES.length / 2 }, (_, index) => ({
  awayTeam: NFL_TEAM_CODES[index * 2],
  homeTeam: NFL_TEAM_CODES[index * 2 + 1],
}));

globalThis.fetch = async (input: string | URL | Request) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  requestUrls.push(url.href);
  if (url.pathname.endsWith('/players/nfl')) {
    const position = url.searchParams.get('position') as typeof positions[number] | null;
    if (!position || !positions.includes(position)) return new Response('unknown position', { status: 400 });
    if (scenario === 'failed-position' && position === 'TE') {
      return new Response('temporary catalog failure', { status: 503 });
    }
    return Response.json({
      [playerIds[position]]: {
        full_name: `${position} Catalog Player`,
        position,
        team: NFL_TEAM_CODES[positions.indexOf(position)],
        active: true,
        status: 'Active',
      },
    });
  }
  if (url.pathname === '/v1/stats/nfl/regular/2026/1') {
    const stats = Object.fromEntries([
      ...positions.filter((position) => position !== 'DEF').map((position) => [
        playerIds[position],
        position === 'RB' ? { gms_active: 1 } : { gms_active: 1, gp: 1 },
      ]),
      ...NFL_TEAM_CODES.map((team) => [team, { gms_active: 1, gp: 1 }]),
    ]);
    return new Response(JSON.stringify(stats), {
      status: 200,
      headers: { etag: '"week-1-runtime"', 'content-type': 'application/json' },
    });
  }
  if (url.pathname === '/v1/state/nfl') {
    return Response.json({
      season: '2026', season_type: 'regular', leg: 1, week: 1, display_week: 1,
    });
  }
  if (url.pathname === '/schedule/nfl/regular/2026') {
    return Response.json(schedulePairs.map(({ awayTeam, homeTeam }) => ({
      status: 'complete', date: '2026-09-13', away: awayTeam, home: homeTeam,
      week: 1, game_id: `1-${awayTeam}-${homeTeam}`,
    })));
  }
  if (url.pathname === '/scores/nfl/regular/2026/1') {
    return Response.json(schedulePairs.map(({ awayTeam, homeTeam }) => ({
      status: 'complete', date: '2026-09-13',
      metadata: { home_team: homeTeam, away_team: awayTeam, canceled: false },
      start_time: Date.parse('2026-09-13T17:00:00.000Z'),
      week: 1, season_type: 'regular', season: '2026',
    })));
  }
  const leagueMatch = /^\/v1\/league\/([^/]+)(?:\/(rosters|users|matchups\/1))?$/u
    .exec(url.pathname);
  if (leagueMatch && leagueNames.has(leagueMatch[1])) {
    const leagueId = leagueMatch[1];
    const resource = leagueMatch[2];
    if (!resource) {
      return Response.json({
        league_id: leagueId,
        name: leagueNames.get(leagueId),
        season: '2026',
        status: 'in_season',
        total_rosters: 2,
        roster_positions: ['QB'],
        settings: { waiver_budget: 100, leg: 1 },
        scoring_settings: rawRules,
      });
    }
    if (resource === 'rosters') {
      return Response.json([playerIds.QB, playerIds.RB].map((playerId, index) => ({
        roster_id: index + 1,
        owner_id: `manager-${index + 1}-${leagueId}`,
        players: [playerId],
        starters: [playerId],
        settings: {
          wins: 0, losses: 0, ties: 0, fpts: 0, fpts_against: 0,
          waiver_budget_used: 0, waiver_position: index + 1,
        },
      })));
    }
    if (resource === 'users') {
      return Response.json([1, 2].map((manager) => ({
        user_id: `manager-${manager}-${leagueId}`,
        display_name: `Manager ${manager} ${leagueNames.get(leagueId)}`,
      })));
    }
    return Response.json([playerIds.QB, playerIds.RB].map((playerId, index) => ({
      roster_id: index + 1,
      matchup_id: 1,
      players: [playerId],
      starters: [playerId],
      players_points: { [playerId]: 0 },
      starters_points: [0],
      points: 0,
    })));
  }
  return new Response('unexpected request', { status: 599 });
};

const gameContext: Array<Readonly<{
  nflGameId: string;
  homeTeam: NflTeam;
  awayTeam: NflTeam;
  kickoffAt: string;
  phase: 'final';
}>> = [];
for (let index = 0; index < NFL_TEAM_CODES.length; index += 2) {
  const awayTeam = NFL_TEAM_CODES[index];
  const homeTeam = NFL_TEAM_CODES[index + 1];
  const kickoffAt = '2026-09-13T17:00:00.000Z';
  gameContext.push({
    nflGameId: deterministicUuid('all-player-runtime-game', `${awayTeam}:${homeTeam}`),
    homeTeam,
    awayTeam,
    kickoffAt,
    phase: 'final',
  });
}

const period = { season: 2026, seasonType: 'regular' as const, week: 1 };
const databaseWrites: string[] = [];
const writeTrap = (name: string) => async () => {
  databaseWrites.push(name);
  throw new Error(`shadow database write attempted: ${name}`);
};
const productionDependencies = createProductionAllPlayerDependencies('cache-neutral');
let catalogEvidence: FantasyPlayerCatalog | null = null;
const dependencies = {
  ...productionDependencies,
  loadCatalog: async () => {
    catalogEvidence = await productionDependencies.loadCatalog();
    return catalogEvidence;
  },
  store: {
    enabled: true,
    readAllPlayerLeagueProfiles: async (input: Readonly<{
      leagues: readonly Readonly<{ leagueKey: string; rulesHash: string }>[];
    }>) => input.leagues.map((league, index) => ({
      leagueKey: league.leagueKey,
      leagueSeasonId: `runtime-season-${index + 1}`,
      scoringProfileId: '11111111-1111-4111-8111-111111111111',
      rulesHash: rulesHash(rawRules),
      rules: rawRules,
    })),
    readAllPlayerIdentityMappings: async (inputs: readonly Readonly<{
      provider: string;
      entityKind: 'player' | 'team_defense';
      externalId: string;
    }>[]) => inputs.map((input) => ({
      ...input,
      scoringEntityId: null,
      mappedEntityKind: null,
      mappingStatus: null,
      validTo: null,
    })),
    readAllPlayerGameContext: async () => gameContext,
    acquireJob: writeTrap('acquireJob'),
    upsertScoringEntities: writeTrap('upsertScoringEntities'),
    recordLeagueWeekObservation: writeTrap('recordLeagueWeekObservation'),
    recordAllPlayerBatch: writeTrap('recordAllPlayerBatch'),
    completeJob: writeTrap('completeJob'),
  },
  projectionRepository: {
    readCurrentProjectionSlate: async () => ({
      observationId: 'runtime-projection-observation',
      contentId: 'runtime-projection-content',
      semanticHash: 'b'.repeat(64),
      verifiedAt: '2026-09-15T00:00:00.000Z',
      materialChangedAt: '2026-09-15T00:00:00.000Z',
      slate: {
        source: productionDependencies.projectionProvider,
        period,
        quality: 'complete' as const,
        requestStartedAt: '2026-09-14T00:00:00.000Z',
        requestCompletedAt: '2026-09-14T00:00:01.000Z',
        observedAt: '2026-09-14T00:00:01.000Z',
        sourceRevision: 'runtime-projection-revision',
        projections: [],
        coverage: {
          crosswalkRows: 0,
          crosswalkEntries: 0,
          malformedCrosswalkRows: 0,
          ambiguousCrosswalkRows: 0,
          playerRows: 0,
          matchedPlayers: 0,
          unmatchedPlayers: 0,
          malformedPlayers: 0,
          incompletePlayers: 0,
          defenseRows: 0,
          usableDefenses: 0,
          malformedDefenses: 0,
          incompleteDefenses: 0,
        },
        warnings: [],
      },
    }),
  },
  clock: {
    now: () => new Date('2026-09-15T00:00:01.000Z'),
    monotonicNow: () => 1,
  },
  idGenerator: { generate: () => 'runtime-shadow-run' },
  logger: { write: () => undefined },
} as unknown as AllPlayerIngestionDependencies;

const result = await runAllPlayerIngestion(dependencies, {
  mode: 'shadow',
  period,
  requireFinalCoverage: true,
});
if (!catalogEvidence) throw new Error('The production operator did not load its catalog.');
const catalog: FantasyPlayerCatalog = catalogEvidence;
process.stdout.write(`${JSON.stringify({
  scenario,
  result,
  catalog: {
    complete: catalog.complete,
    sourceRevision: catalog.sourceRevision,
    positions: [...new Set(Object.values(catalog.catalog).map((player) => player.position))].sort(),
    playerCount: Object.keys(catalog.catalog).length,
  },
  requests: requestUrls,
  databaseWrites,
})}\n`);
