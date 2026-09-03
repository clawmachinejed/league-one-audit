import { readdir, readFile } from 'node:fs/promises';
import type { DatabaseClient, DatabaseRow } from './database';
import type { MatchupsData, Team } from './types';

export type ProjectionStoreQueryCall = Readonly<{
  statement: string;
  parameters: readonly unknown[];
}>;

export function createFakeProjectionDatabase(
  respond: (call: ProjectionStoreQueryCall) => readonly DatabaseRow[] = () => [],
): Readonly<{ database: DatabaseClient; calls: ProjectionStoreQueryCall[] }> {
  const calls: ProjectionStoreQueryCall[] = [];
  return {
    calls,
    database: {
      enabled: true,
      async query<Row extends DatabaseRow>(statement: string, parameters: readonly unknown[] = []) {
        const call = { statement, parameters };
        calls.push(call);
        return respond(call) as readonly Row[];
      },
    },
  };
}

export const projectionStoreSnapshot: MatchupsData = {
  league: { season: '2026', rosterPositions: ['QB'], week: 1, maxWeek: 18 },
  teams: [],
  updatedAt: '2026-09-13T17:00:00.000Z',
  week: 1,
  matchups: [],
};

const projectionStoreTeamOne: Team = {
  id: 1,
  managerName: 'Alex Manager',
  name: 'First Team',
  avatar: 'avatar-one',
  wins: 1,
  losses: 0,
  ties: 0,
  pointsFor: 124.5,
  pointsAgainst: 98.25,
};

const projectionStoreTeamTwo: Team = {
  id: 2,
  managerName: 'Blake Manager',
  name: 'Second Team',
  avatar: null,
  wins: 0,
  losses: 1,
  ties: 0,
  pointsFor: 98.25,
  pointsAgainst: 124.5,
};

/** A representative, nonempty payload shaped like the matchup snapshots served in production. */
export const projectionStoreProductionSnapshot: MatchupsData = {
  league: {
    season: '2026',
    rosterPositions: ['QB', 'RB', 'WR', 'TE', 'FLEX', 'DEF'],
    week: 1,
    maxWeek: 18,
  },
  teams: [projectionStoreTeamOne, projectionStoreTeamTwo],
  updatedAt: '2026-09-13T19:30:00.000Z',
  warning: 'Live projections are estimates.',
  week: 1,
  matchups: [{
    id: '1',
    status: 'live',
    sides: [{
      team: projectionStoreTeamOne,
      points: 24.8,
      projectedPoints: 35.95,
      starters: [{
        id: '4046',
        name: 'A.J. Brown',
        position: 'WR',
        nflTeam: 'PHI',
        injuryStatus: 'Q',
        game: {
          kind: 'scheduled',
          opponent: 'DAL',
          location: 'home',
          date: 'Sun 4:25 PM',
          kickoffAt: '2026-09-13T17:00:00.000Z',
        },
        slot: 'WR',
        points: 18.2,
        projectedPoints: 24.7,
      }],
    }, {
      team: projectionStoreTeamTwo,
      points: 10,
      projectedPoints: 21.5,
      starters: [{
        id: '9999',
        name: 'Bye Week Player',
        position: 'RB',
        nflTeam: 'IND',
        injuryStatus: null,
        game: { kind: 'bye' },
        slot: 'FLEX',
        points: 0,
        projectedPoints: 0,
      }],
    }],
  }],
};

export const projectionStoreActivityWindows = [{
  startsAt: '2026-09-13T15:00:00.000Z',
  endsAt: '2026-09-14T00:00:00.000Z',
}] as const;

export function projectionStoreSnapshotRow(
  overrides: Readonly<Record<string, unknown>> = {},
): DatabaseRow {
  return {
    snapshot_id: 'snapshot-id',
    league_season_id: 'season-id',
    week: 1,
    model_version: 'clock-v1',
    revision_key: 'revision-1',
    calculated_at: projectionStoreSnapshot.updatedAt,
    published_at: '2026-09-13T17:00:01.000Z',
    verified_at: '2026-09-13T17:00:01.000Z',
    activity_windows: [],
    is_current: true,
    payload: projectionStoreSnapshot,
    latest_rank: 1,
    requested_week_rank: 1,
    ...overrides,
  };
}

export const projectionStorePlayerProjection = {
  sleeperPlayerId: '4046',
  entityId: 'entity-id',
  entityKind: 'player',
  displayName: 'A.J. Brown',
  nflTeam: 'PHI',
  gameId: 'game-id',
  tank01GameId: 'game-a',
  projectionPoints: 18.75,
  projectedStats: {
    receivingReceptions: 6.5,
    receivingTargets: 9.25,
    receivingYards: 82.5,
  },
  quality: 'complete',
  sourceProjectionRunId: 'projection-run-id',
  projectionProvider: 'tank01',
  modelVersion: 'tank01-pregame-v1',
  fetchedAt: '2026-09-13T15:00:00.000Z',
  frozenAt: null,
} as const;

export function projectionStorePlayerProjectionRow(
  overrides: Readonly<Record<string, unknown>> = {},
): DatabaseRow {
  return {
    sleeper_player_id: projectionStorePlayerProjection.sleeperPlayerId,
    entity_id: projectionStorePlayerProjection.entityId,
    entity_kind: projectionStorePlayerProjection.entityKind,
    display_name: projectionStorePlayerProjection.displayName,
    nfl_team: projectionStorePlayerProjection.nflTeam,
    game_id: projectionStorePlayerProjection.gameId,
    tank01_game_id: projectionStorePlayerProjection.tank01GameId,
    projection_points: String(projectionStorePlayerProjection.projectionPoints),
    projected_stats: JSON.stringify(projectionStorePlayerProjection.projectedStats),
    quality: projectionStorePlayerProjection.quality,
    source_projection_run_id: projectionStorePlayerProjection.sourceProjectionRunId,
    projection_provider: projectionStorePlayerProjection.projectionProvider,
    model_version: projectionStorePlayerProjection.modelVersion,
    fetched_at: projectionStorePlayerProjection.fetchedAt,
    frozen_at: projectionStorePlayerProjection.frozenAt,
    ...overrides,
  };
}

export const projectionStoreSqlMarkers = [
  'acquire-job',
  'clean-orphan-nfl-games',
  'clean-orphan-scoring-entities',
  'complete-job',
  'fail-job',
  'freeze-latest-baselines',
  'prune-game-observations',
  'prune-jobs',
  'prune-league-observations',
  'prune-projection-runs',
  'prune-projection-slate-contents',
  'prune-projection-slate-observations',
  'prune-snapshots',
  'publish-snapshot',
  'read-current-projection-slate',
  'read-current-snapshot',
  'read-frozen-baselines',
  'read-job-state',
  'read-latest-candidates',
  'read-league-season-profile',
  'read-matchup-snapshot-by-league-key',
  'read-snapshot-selection-by-sleeper-id',
  'record-game-states',
  'record-league-week-observation',
  'record-projection-candidates',
  'record-projection-slate',
  'register-league-season',
  'resolve-nfl-games',
  'resolve-scoring-entities',
  'upsert-league-period-authority',
  'upsert-nfl-games',
  'upsert-scoring-entities',
] as const;

export type ProjectionStoreSqlMarker = typeof projectionStoreSqlMarkers[number];

export type ProjectionStoreSqlOperation = Readonly<{
  marker: string | null;
  markerCount: number;
  source: string;
}>;

export type ProjectionStoreSqlExtraction = Readonly<{
  operations: readonly ProjectionStoreSqlOperation[];
  queryCallCount: number;
  sourceFiles: readonly string[];
}>;

async function projectionStoreModuleUrls(): Promise<readonly URL[]> {
  const root = new URL('./projections/adapters/neon/', import.meta.url);

  async function descendants(directory: URL): Promise<readonly URL[]> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }

    const children = await Promise.all(entries.map(async (entry) => {
      const child = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
      if (entry.isDirectory()) return descendants(child);
      if (!entry.isFile() || !entry.name.endsWith('.ts')
        || entry.name.endsWith('.test.ts') || entry.name.endsWith('.spec.ts')) return [];
      return [child];
    }));
    return children.flat();
  }

  return [
    new URL('./projection-store.ts', import.meta.url),
    ...await descendants(root),
  ].toSorted((left, right) => left.href.localeCompare(right.href));
}

/**
 * Extracts every store-owned database call from the public facade and its Neon adapter modules.
 * Source discovery remains independent of the file that owns an individual query.
 */
export async function extractProjectionStoreSql(): Promise<ProjectionStoreSqlExtraction> {
  const sourceUrls = await projectionStoreModuleUrls();
  const operations: ProjectionStoreSqlOperation[] = [];
  let queryCallCount = 0;

  for (const sourceUrl of sourceUrls) {
    const source = await readFile(sourceUrl, 'utf8');
    queryCallCount += [...source.matchAll(/\.query(?:<[^>]+>)?\s*\(/gu)].length;
    const templates = source.matchAll(/\.query(?:<[^>]+>)?\s*\(\s*`([\s\S]*?)`/gu);
    for (const template of templates) {
      const sql = template[1];
      const markers = [...sql.matchAll(/\/\*\s*projection-store:([a-z0-9-]+)\s*\*\//gu)];
      operations.push({
        marker: markers.length === 1 ? markers[0][1] : null,
        markerCount: markers.length,
        source: sourceUrl.href,
      });
    }
  }

  return {
    operations,
    queryCallCount,
    sourceFiles: sourceUrls.map((url) => url.href),
  };
}
