import { createHash } from 'node:crypto';
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
  'prune-snapshots',
  'publish-snapshot',
  'read-current-snapshot',
  'read-frozen-baselines',
  'read-job-state',
  'read-latest-candidates',
  'read-league-season-profile',
  'read-snapshot-selection-by-sleeper-id',
  'record-game-states',
  'record-league-week-observation',
  'record-projection-candidates',
  'register-league-season',
  'resolve-nfl-games',
  'resolve-scoring-entities',
  'upsert-nfl-games',
  'upsert-scoring-entities',
] as const;

export type ProjectionStoreSqlMarker = typeof projectionStoreSqlMarkers[number];

export const projectionStoreSqlHashBaseline = {
  'acquire-job': 'e4f1cfc9126479e4d219057ff90200d2f4b0ad484b6fa6f6151bdd6c3b62e0be',
  'clean-orphan-nfl-games': '8377625b9cbbecc16eb9f293a770c9a9d3fbc9d5018ca67226e836a10a17ec37',
  'clean-orphan-scoring-entities': 'd70241fc057a51ff0be307bd0031e4bf1e2ef6fad59e0302f2992cbe285faa6d',
  'complete-job': '7d9d6761e32cbce6ec53ab3ed86c832eed92f2c9710d6453e809f252423c840d',
  'fail-job': '102ed15ca57da01b204f9deb0b420d430e8aa360ab30b1c5564a6cd06413fe55',
  'freeze-latest-baselines': '7a305fc677159706bd0ad19c3829de7f037ef240bc9009a92d84cb3d1f97185d',
  'prune-game-observations': '70cb82dc605ee9818d089c015252240c4d239a8613067a5048406668fb44e047',
  'prune-jobs': '55c05dbd645ab5fabb8bc6f88ebdba9733b725a422712eec82afc2bbb8aa9dc2',
  'prune-league-observations': 'fae1921fcb220f7256a55c5acc0e12efd9a3e48ce6062ddeea073a9cb10de181',
  'prune-projection-runs': '34bb015d5e002fc5abea71a4b17003f09adc3e1b9794b923b119e863ba5adbb2',
  'prune-snapshots': '097901ee96c908887b281f578bfcf33aeda99b179842016ab4f0d5e2d1c2389e',
  'publish-snapshot': 'bed3a0e4ca77c131cf01dfdcac58f43470fec5a92c883d989b25e178d41e93ca',
  'read-current-snapshot': 'b5560a60b7a3d054d9f95878a834e81396d849fd1d7a7ae7880bbc94e7d58cb3',
  'read-frozen-baselines': '4948871823e671a1a83670d490f19a7b95b3da64c4acd00f39fd43990cef8b25',
  'read-job-state': '3a3b0b1e4e6a289d646bd0c010e0d84f29a654741f25a8a6ecab5bfe4c422971',
  'read-latest-candidates': '2b02a63787c598af012900fcebe97098e05c5165c3338223741dfe4ea0c414ad',
  'read-league-season-profile': '76a4650db6621309e7e4cb57b9b2986094e64ceedf77753f306ce4e4755ac0a5',
  'read-snapshot-selection-by-sleeper-id': 'd59e5290600ecf7ed2d05c6e6ea87c342cf2d10a77e428e4418a8d87e8be00f8',
  'record-game-states': '7bde3dc5b5193eb6f98b518095e02f60e3b62497c07e76364b492d21a2b26e5c',
  'record-league-week-observation': '7494985d906025911f33c1f0d97938d884835a13a6563e27935498ce15b04894',
  'record-projection-candidates': '18372a4b36ae81d1e3eb5b76445491150f06c17c039bb6452664d727c5a58aee',
  'register-league-season': '8cf4cd65dc74ffc41344b75af33ee4b520dd5bc3aa65ce5b4a25410e427eda9a',
  'resolve-nfl-games': '79aa37807bc7674d7c2a5fb210658ce2c814de58faf9632fe71853fc5848ef1a',
  'resolve-scoring-entities': 'd68f675934371be3dc75536b8ff8c915b8fee14ee0b55fb1c66da90407dae799',
  'upsert-nfl-games': '4dd161f2e301a3f75acf60427eb8ca3e6e86efff8b4d103436f523d7d6b5b4e5',
  'upsert-scoring-entities': '9bdbe2e182d8ad143e13db22ee7eaff93892323a76e6d22593192404021fe380',
} as const satisfies Readonly<Record<ProjectionStoreSqlMarker, string>>;

export type ProjectionStoreSqlOperation = Readonly<{
  marker: string | null;
  markerCount: number;
  normalizedSql: string;
  sha256: string;
  source: string;
}>;

export type ProjectionStoreSqlExtraction = Readonly<{
  operations: readonly ProjectionStoreSqlOperation[];
  queryCallCount: number;
  sourceFiles: readonly string[];
}>;

function normalizedSql(sql: string): string {
  return sql
    .replace(/\r\n?/gu, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
}

async function projectionStoreModuleUrls(): Promise<readonly URL[]> {
  const root = new URL('./projection-store/', import.meta.url);

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
 * Extracts every store-owned database call from both today's monolith and the planned module folder.
 * Keeping source discovery here lets the SQL contract survive file moves during the split.
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
      const normalized = normalizedSql(sql);
      operations.push({
        marker: markers.length === 1 ? markers[0][1] : null,
        markerCount: markers.length,
        normalizedSql: normalized,
        sha256: createHash('sha256').update(normalized).digest('hex'),
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
