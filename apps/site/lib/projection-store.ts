import 'server-only';

import { createHash } from 'node:crypto';
import type { MatchupsData } from './types';
import { getDatabase, type Database, type DatabaseClient, type DatabaseRow } from './database';
import { isMatchupsData } from './matchups-response';

export type SeasonType = 'pre' | 'reg' | 'post';
export type ScoringEntityKind = 'player' | 'team_defense';
export type ProjectionQuality = 'complete' | 'missing' | 'invalid';
export type ObservationQuality = 'complete' | 'partial' | 'invalid';

export type PersistenceOutcome<Value> =
  | Readonly<{ kind: 'stored'; value: Value }>
  | Readonly<{ kind: 'disabled' }>;

export type LeagueSeasonReference = Readonly<{
  leagueId: string;
  leagueSeasonId: string;
  scoringProfileId: string;
}>;

export type ExternalIdentity = Readonly<{
  provider: string;
  externalId: string;
}>;

export type ScoringEntityIdentityInput = Readonly<{
  key: string;
  kind: ScoringEntityKind;
  displayName: string;
  nflTeam: string | null;
  providerIds: readonly ExternalIdentity[];
}>;

export type ResolvedScoringEntity = Readonly<{
  key: string;
  entityId: string | null;
  conflict: boolean;
}>;

export type NflGameIdentityInput = Readonly<{
  key: string;
  provider: string;
  externalGameId: string;
  season: number;
  seasonType: SeasonType;
  week: number;
  homeTeam: string;
  awayTeam: string;
  kickoffAt: string | null;
}>;

export type ResolvedNflGame = Readonly<{
  key: string;
  gameId: string;
}>;

export type ProjectionCandidateInput = Readonly<{
  gameId: string;
  entityId: string;
  scoringProfileId: string;
  projectionPoints: number;
  projectedStats: Readonly<Record<string, unknown>>;
  quality: ProjectionQuality;
}>;

export type ProjectionRunInput = Readonly<{
  provider: string;
  season: number;
  seasonType: SeasonType;
  week: number;
  modelVersion: string;
  sourceRevision: string;
  requestStartedAt: string;
  requestCompletedAt: string;
  fetchedAt: string;
  quality: ObservationQuality;
  candidates: readonly ProjectionCandidateInput[];
}>;

export type StoredProjectionRun = Readonly<{
  runId: string;
  candidatesStored: number;
  candidateCount: number;
}>;

export type PlayerProjectionRecord = Readonly<{
  sleeperPlayerId: string;
  entityId: string;
  entityKind: ScoringEntityKind;
  displayName: string;
  nflTeam: string | null;
  gameId: string;
  tank01GameId: string | null;
  projectionPoints: number;
  projectedStats: Readonly<Record<string, unknown>>;
  quality: ProjectionQuality;
  sourceProjectionRunId: string;
  projectionProvider: string;
  modelVersion: string;
  fetchedAt: string;
  frozenAt: string | null;
}>;

export type GameStateInput = Readonly<{
  externalGameId: string;
  sourceRevision: string;
  requestStartedAt: string;
  requestCompletedAt: string;
  observedAt: string;
  statusCode: 0 | 1 | 2 | 3 | 4;
  period: string | null;
  gameClock: string | null;
  homeScore: number | null;
  awayScore: number | null;
  sourceData: Readonly<Record<string, unknown>>;
}>;

export type StoredGameState = Readonly<{
  externalGameId: string;
  sourceRevision: string;
  observationId: string;
}>;

export type OfficialPlayerPointInput = Readonly<{
  sleeperPlayerId: string;
  entityKind: ScoringEntityKind;
  externalRosterId: string;
  points: number | null;
  isStarter: boolean;
  lineupSlot: string | null;
}>;

export type OfficialRosterPointInput = Readonly<{
  externalRosterId: string;
  points: number | null;
}>;

export type LeagueWeekObservationInput = Readonly<{
  leagueSeasonId: string;
  week: number;
  sourceRevision: string;
  requestStartedAt: string;
  requestCompletedAt: string;
  observedAt: string;
  quality: ObservationQuality;
  sourceData: Readonly<Record<string, unknown>>;
  /** Complete Tank01 game-ID set expected for the league's scheduled starters. */
  expectedTank01GameIds: readonly string[];
  playerPoints: readonly OfficialPlayerPointInput[];
  rosterPoints: readonly OfficialRosterPointInput[];
}>;

export type StoredLeagueWeekObservation = Readonly<{
  observationId: string;
  playerPointsStored: number;
  rosterPointsStored: number;
  unmappedSleeperPlayerIds: readonly string[];
  expectedGamesStored: number;
  unmappedTank01GameIds: readonly string[];
}>;

export type ProjectionActivityWindow = Readonly<{
  /** Two hours before one full-slate kickoff. */
  startsAt: string;
  /** Seven hours after the same full-slate kickoff. */
  endsAt: string;
}>;

export type JobClaim =
  | Readonly<{ kind: 'acquired'; attempt: number; leaseUntil: string }>
  | Readonly<{ kind: 'busy' | 'completed' | 'disabled' }>;

export type StoredProjectionSnapshot = Readonly<{
  snapshotId: string;
  leagueSeasonId: string;
  week: number;
  modelVersion: string;
  revisionKey: string;
  calculatedAt: string;
  publishedAt: string | null;
  /** Latest successful source validation, even when material content did not change. */
  verifiedAt: string;
  /** Compact kickoff-derived refresh windows for every game in the NFL week. */
  activityWindows: readonly ProjectionActivityWindow[];
  isCurrent: boolean;
  payload: MatchupsData;
}>;

export type PublishSnapshotInput = Readonly<{
  leagueSeasonId: string;
  week: number;
  modelVersion: string;
  revisionKey: string;
  leagueWeekObservationId: string;
  gameStateObservationIds: readonly string[];
  calculatedAt: string;
  payload: MatchupsData;
  /** Full NFL slate, represented as kickoff - 2h through kickoff + 7h windows. */
  activityWindows: readonly ProjectionActivityWindow[];
  /** Maximum age difference among Sleeper and Tank01 observations. Defaults to 90 seconds. */
  maxSourceSkewSeconds?: number;
}>;

export type PublishSnapshotOutcome =
  | Readonly<{ kind: 'published'; snapshot: StoredProjectionSnapshot }>
  | Readonly<{ kind: 'unchanged'; snapshot: StoredProjectionSnapshot }>
  | Readonly<{
    kind: 'rejected';
    reason: 'incomplete-or-mismatched-sources' | 'payload-context-mismatch';
  }>
  | Readonly<{ kind: 'disabled' }>;

export type HistoryRetentionResult = Readonly<{
  snapshotsDeleted: number;
  leagueObservationsDeleted: number;
  gameObservationsDeleted: number;
  projectionRunsDeleted: number;
  jobsDeleted: number;
}>;

export type ProjectionStore = Readonly<{
  enabled: boolean;
  registerLeagueSeason: (input: Readonly<{
    leagueKey: string;
    leagueName: string;
    season: number;
    sleeperLeagueId: string;
    scoringRules: Readonly<Record<string, number>>;
  }>) => Promise<PersistenceOutcome<LeagueSeasonReference>>;
  upsertScoringEntities: (
    inputs: readonly ScoringEntityIdentityInput[],
  ) => Promise<PersistenceOutcome<readonly ResolvedScoringEntity[]>>;
  upsertNflGames: (
    inputs: readonly NflGameIdentityInput[],
  ) => Promise<PersistenceOutcome<readonly ResolvedNflGame[]>>;
  recordProjectionCandidates: (
    input: ProjectionRunInput,
  ) => Promise<PersistenceOutcome<StoredProjectionRun>>;
  readLatestCandidatesBySleeperIds: (input: Readonly<{
    leagueSeasonId: string;
    season: number;
    seasonType: SeasonType;
    week: number;
    provider: string;
    modelVersion: string;
    sleeperPlayerIds: readonly string[];
  }>) => Promise<readonly PlayerProjectionRecord[]>;
  freezeLatestBaselines: (input: Readonly<{
    leagueSeasonId: string;
    season: number;
    seasonType: SeasonType;
    week: number;
    modelVersion: string;
    projectionProvider: string;
    gameProvider: string;
    externalGameIds: readonly string[];
    frozenAt: string;
  }>) => Promise<PersistenceOutcome<readonly PlayerProjectionRecord[]>>;
  readFrozenBaselinesBySleeperIds: (input: Readonly<{
    leagueSeasonId: string;
    season: number;
    seasonType: SeasonType;
    week: number;
    provider: string;
    modelVersion: string;
    sleeperPlayerIds: readonly string[];
  }>) => Promise<readonly PlayerProjectionRecord[]>;
  recordGameStates: (input: Readonly<{
    provider: string;
    states: readonly GameStateInput[];
  }>) => Promise<PersistenceOutcome<readonly StoredGameState[]>>;
  recordLeagueWeekObservation: (
    input: LeagueWeekObservationInput,
  ) => Promise<PersistenceOutcome<StoredLeagueWeekObservation>>;
  acquireJob: (input: Readonly<{
    jobKey: string;
    jobType: string;
    scheduledFor: string;
    payload: Readonly<Record<string, unknown>>;
    workerId: string;
    leaseSeconds: number;
  }>) => Promise<JobClaim>;
  completeJob: (jobKey: string, workerId: string) => Promise<boolean>;
  failJob: (jobKey: string, workerId: string, message: string) => Promise<boolean>;
  publishSnapshot: (input: PublishSnapshotInput) => Promise<PublishSnapshotOutcome>;
  pruneHistory: (input: Readonly<{
    before: string;
    /** Always retains at least one recent snapshot for each league/week/model. */
    keepRecentSnapshotsPerLeagueWeek?: number;
  }>) => Promise<PersistenceOutcome<HistoryRetentionResult>>;
  readCurrentSnapshot: (
    leagueSeasonId: string,
    week: number,
  ) => Promise<StoredProjectionSnapshot | null>;
  readCurrentSnapshotBySleeperLeagueId: (
    sleeperLeagueId: string,
    season: number,
    week: number,
  ) => Promise<StoredProjectionSnapshot | null>;
  readLatestCurrentSnapshotBySleeperLeagueId: (
    sleeperLeagueId: string,
    week?: number,
  ) => Promise<StoredProjectionSnapshot | null>;
}>;

function provider(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!normalized) throw new Error('Provider names must not be blank.');
  return normalized;
}

function requiredText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} must not be blank.`);
  return normalized;
}

const ACTIVITY_WINDOW_MS = 9 * 60 * 60 * 1_000;

function canonicalActivityWindows(
  input: readonly ProjectionActivityWindow[],
): readonly ProjectionActivityWindow[] {
  if (input.length > 32) throw new Error('A projection snapshot cannot contain more than 32 activity windows.');
  const unique = new Map<string, ProjectionActivityWindow>();
  for (const window of input) {
    const startsAtMs = Date.parse(window.startsAt);
    const endsAtMs = Date.parse(window.endsAt);
    if (!Number.isFinite(startsAtMs) || !Number.isFinite(endsAtMs)
      || endsAtMs - startsAtMs !== ACTIVITY_WINDOW_MS) {
      throw new Error('Projection activity windows must span kickoff minus two hours through kickoff plus seven hours.');
    }
    const normalized = {
      startsAt: new Date(startsAtMs).toISOString(),
      endsAt: new Date(endsAtMs).toISOString(),
    };
    unique.set(`${normalized.startsAt}\0${normalized.endsAt}`, normalized);
  }
  return [...unique.values()].sort((left, right) => left.startsAt.localeCompare(right.startsAt));
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalValue(item)]),
    );
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new Error('Database JSON cannot contain a non-finite number.');
  }
  return value;
}

function json(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function rulesHash(rules: Readonly<Record<string, number>>): string {
  return createHash('sha256').update(json(rules)).digest('hex');
}

function deterministicUuid(scope: string, key: string): string {
  const digest = createHash('sha256').update(`${scope}\0${key}`).digest('hex').slice(0, 32);
  const variant = ((Number.parseInt(digest[16], 16) & 0x3) | 0x8).toString(16);
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-${variant}${digest.slice(17, 20)}-${digest.slice(20)}`;
}

function snapshotContentHash(
  payload: MatchupsData,
  activityWindows: readonly ProjectionActivityWindow[],
): string {
  const materialPayload = Object.fromEntries(
    Object.entries(payload).filter(([key]) => key !== 'updatedAt'),
  );
  return createHash('sha256').update(json({ materialPayload, activityWindows })).digest('hex');
}

function containsScheduledGame(value: unknown, visited = new Set<object>()): boolean {
  if (!value || typeof value !== 'object' || visited.has(value)) return false;
  visited.add(value);
  if (!Array.isArray(value) && (value as Readonly<Record<string, unknown>>).kind === 'scheduled') {
    return true;
  }
  return Object.values(value).some((item) => containsScheduledGame(item, visited));
}

function rowText(row: DatabaseRow, key: string): string {
  const value = row[key];
  if (typeof value !== 'string' || !value) throw new Error(`Database did not return ${key}.`);
  return value;
}

function rowNullableText(row: DatabaseRow, key: string): string | null {
  const value = row[key];
  return typeof value === 'string' && value ? value : null;
}

function rowNumber(row: DatabaseRow, key: string): number {
  const value = row[key];
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Database did not return a numeric ${key}.`);
  return parsed;
}

function rowBoolean(row: DatabaseRow, key: string): boolean {
  const value = row[key];
  return value === true || value === 'true';
}

function rowObject(row: DatabaseRow, key: string): Readonly<Record<string, unknown>> {
  const value = row[key];
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Readonly<Record<string, unknown>>;
  }
  if (typeof value === 'string') {
    const parsed: unknown = JSON.parse(value);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Readonly<Record<string, unknown>>;
    }
  }
  throw new Error(`Database did not return an object for ${key}.`);
}

function rowMatchupsPayload(row: DatabaseRow): MatchupsData {
  const payload = rowObject(row, 'payload');
  if (!isMatchupsData(payload)) {
    throw new Error('Stored projection snapshot is not valid matchup data.');
  }
  return payload;
}

function rowActivityWindows(row: DatabaseRow): readonly ProjectionActivityWindow[] {
  const raw = typeof row.activity_windows === 'string'
    ? JSON.parse(row.activity_windows) as unknown
    : row.activity_windows;
  if (!Array.isArray(raw) || raw.some((item) => !item || typeof item !== 'object'
    || typeof (item as Record<string, unknown>).startsAt !== 'string'
    || typeof (item as Record<string, unknown>).endsAt !== 'string')) {
    throw new Error('Stored projection snapshot does not contain valid activity windows.');
  }
  return canonicalActivityWindows(raw as readonly ProjectionActivityWindow[]);
}

function normalizeIds(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function asPlayerProjection(row: DatabaseRow): PlayerProjectionRecord {
  return {
    sleeperPlayerId: rowText(row, 'sleeper_player_id'),
    entityId: rowText(row, 'entity_id'),
    entityKind: rowText(row, 'entity_kind') as ScoringEntityKind,
    displayName: rowText(row, 'display_name'),
    nflTeam: rowNullableText(row, 'nfl_team'),
    gameId: rowText(row, 'game_id'),
    tank01GameId: rowNullableText(row, 'tank01_game_id'),
    projectionPoints: rowNumber(row, 'projection_points'),
    projectedStats: rowObject(row, 'projected_stats'),
    quality: rowText(row, 'quality') as ProjectionQuality,
    sourceProjectionRunId: rowText(row, 'source_projection_run_id'),
    projectionProvider: rowText(row, 'projection_provider'),
    modelVersion: rowText(row, 'model_version'),
    fetchedAt: rowText(row, 'fetched_at'),
    frozenAt: rowNullableText(row, 'frozen_at'),
  };
}

function snapshotFromRow(row: DatabaseRow): StoredProjectionSnapshot {
  return {
    snapshotId: rowText(row, 'snapshot_id'),
    leagueSeasonId: rowText(row, 'league_season_id'),
    week: rowNumber(row, 'week'),
    modelVersion: rowText(row, 'model_version'),
    revisionKey: rowText(row, 'revision_key'),
    calculatedAt: rowText(row, 'calculated_at'),
    publishedAt: rowNullableText(row, 'published_at'),
    verifiedAt: rowText(row, 'verified_at'),
    activityWindows: rowActivityWindows(row),
    isCurrent: rowBoolean(row, 'is_current'),
    payload: rowMatchupsPayload(row),
  };
}

function disabled<Value>(): PersistenceOutcome<Value> {
  return { kind: 'disabled' };
}

function connected(database: Database): DatabaseClient | null {
  return database.enabled ? database : null;
}

export function createProjectionStore(database: Database = getDatabase()): ProjectionStore {
  const client = connected(database);

  return {
    enabled: Boolean(client),

    async registerLeagueSeason(input) {
      if (!client) return disabled();
      const scoringRulesHash = rulesHash(input.scoringRules);
      const rows = await client.query(`/* projection-store:register-league-season */
        WITH profile AS (
          INSERT INTO scoring_profiles (rules_hash, rules)
          VALUES ($1, $2::jsonb)
          ON CONFLICT (rules_hash) DO UPDATE SET rules = scoring_profiles.rules
          RETURNING id
        ), league AS (
          INSERT INTO leagues (league_key, name)
          VALUES ($3, $4)
          ON CONFLICT (league_key) DO UPDATE
          SET name = EXCLUDED.name, updated_at = now()
          RETURNING id
        ), season AS (
          INSERT INTO league_seasons (league_id, season, scoring_profile_id)
          SELECT league.id, $5, profile.id FROM league CROSS JOIN profile
          ON CONFLICT (league_id, season) DO UPDATE
          SET updated_at = now()
          WHERE league_seasons.scoring_profile_id = EXCLUDED.scoring_profile_id
          RETURNING id, league_id, scoring_profile_id
        ), connection AS (
          INSERT INTO league_source_connections
            (league_season_id, provider, external_league_id)
          SELECT season.id, 'sleeper', $6 FROM season
          ON CONFLICT (league_season_id, provider) DO UPDATE
          SET external_league_id = EXCLUDED.external_league_id, connected_at = now()
          RETURNING league_season_id
        )
        SELECT season.league_id, season.id AS league_season_id, season.scoring_profile_id
        FROM season JOIN connection ON connection.league_season_id = season.id`, [
        scoringRulesHash,
        json(input.scoringRules),
        requiredText(input.leagueKey, 'League key'),
        requiredText(input.leagueName, 'League name'),
        input.season,
        requiredText(input.sleeperLeagueId, 'Sleeper league ID'),
      ]);
      const row = rows[0];
      if (!row) {
        const existing = await client.query(`/* projection-store:read-league-season-profile */
          SELECT season.id AS league_season_id, profile.rules_hash
          FROM leagues league
          JOIN league_seasons season ON season.league_id = league.id AND season.season = $2
          JOIN scoring_profiles profile ON profile.id = season.scoring_profile_id
          WHERE league.league_key = $1`, [
          requiredText(input.leagueKey, 'League key'), input.season,
        ]);
        if (existing[0] && rowText(existing[0], 'rules_hash') !== scoringRulesHash) {
          throw new Error(
            'Scoring rules are immutable for an existing league season; register a new season for revised rules.',
          );
        }
        throw new Error('League season registration did not return a row.');
      }
      return {
        kind: 'stored',
        value: {
          leagueId: rowText(row, 'league_id'),
          leagueSeasonId: rowText(row, 'league_season_id'),
          scoringProfileId: rowText(row, 'scoring_profile_id'),
        },
      };
    },

    async upsertScoringEntities(inputs) {
      if (!client) return disabled();
      if (inputs.length === 0) return { kind: 'stored', value: [] };

      const inputKeys = new Set<string>();
      const providerKeys = new Set<string>();
      for (const input of inputs) {
        const key = requiredText(input.key, 'Scoring entity key');
        if (inputKeys.has(key)) throw new Error(`Duplicate scoring entity key: ${key}`);
        inputKeys.add(key);
        for (const identity of input.providerIds) {
          const providerKey = `${provider(identity.provider)}\0${input.kind}\0${requiredText(identity.externalId, 'External scoring entity ID')}`;
          if (providerKeys.has(providerKey)) throw new Error('A provider identifier was assigned more than once.');
          providerKeys.add(providerKey);
        }
      }

      const prepared = inputs.map((input, ordinal) => ({
        ordinal,
        proposed_id: deterministicUuid(
          `scoring-entity:${input.kind}`,
          requiredText(input.key, 'Scoring entity key'),
        ),
        input_key: requiredText(input.key, 'Scoring entity key'),
        kind: input.kind,
        display_name: requiredText(input.displayName, 'Scoring entity display name'),
        nfl_team: input.nflTeam?.trim() || null,
        provider_ids: input.providerIds.map((identity) => ({
          provider: provider(identity.provider),
          external_id: requiredText(identity.externalId, 'External scoring entity ID'),
        })),
      }));
      if (prepared.some((item) => item.provider_ids.length === 0)) {
        throw new Error('Every scoring entity needs at least one provider identifier.');
      }

      await client.query(`/* projection-store:upsert-scoring-entities */
        WITH input AS (
          SELECT * FROM jsonb_to_recordset($1::jsonb) AS value(
            ordinal integer, proposed_id uuid, input_key text, kind text,
            display_name text, nfl_team text, provider_ids jsonb
          )
        ), expanded AS (
          SELECT input.*, ids.provider, ids.external_id
          FROM input
          CROSS JOIN LATERAL jsonb_to_recordset(input.provider_ids) AS ids(
            provider text, external_id text
          )
        ), existing AS (
          SELECT expanded.ordinal,
            COALESCE(array_agg(DISTINCT mapping.scoring_entity_id)
              FILTER (WHERE mapping.scoring_entity_id IS NOT NULL), '{}'::uuid[]) AS entity_ids
          FROM expanded
          LEFT JOIN external_scoring_entity_ids mapping
            ON mapping.provider = expanded.provider
            AND mapping.entity_kind = expanded.kind
            AND mapping.external_id = expanded.external_id
          GROUP BY expanded.ordinal
        ), targets AS (
          SELECT input.*,
            CASE
              WHEN cardinality(existing.entity_ids) = 1 THEN existing.entity_ids[1]
              ELSE input.proposed_id
            END AS target_id,
            cardinality(existing.entity_ids) > 1 AS conflict
          FROM input JOIN existing USING (ordinal)
        ), upserted_entities AS (
          INSERT INTO scoring_entities (id, kind, display_name, nfl_team)
          SELECT DISTINCT ON (target_id) target_id, kind, display_name, nfl_team
          FROM targets WHERE NOT conflict
          ORDER BY target_id, ordinal
          ON CONFLICT (id) DO UPDATE SET
            display_name = EXCLUDED.display_name,
            nfl_team = EXCLUDED.nfl_team,
            updated_at = now()
          RETURNING id
        ), inserted_mappings AS (
          INSERT INTO external_scoring_entity_ids
            (provider, entity_kind, external_id, scoring_entity_id)
          SELECT expanded.provider, expanded.kind, expanded.external_id, targets.target_id
          FROM expanded
          JOIN targets USING (ordinal)
          JOIN upserted_entities ON upserted_entities.id = targets.target_id
          WHERE NOT targets.conflict
          ON CONFLICT (provider, entity_kind, external_id) DO NOTHING
          RETURNING scoring_entity_id
        )
        SELECT count(*) AS mappings_written FROM inserted_mappings`, [json(prepared)]);

      // A fresh statement obtains a post-conflict snapshot. This closes the
      // READ COMMITTED first-writer race inherent in INSERT ... DO NOTHING CTEs.
      const rows = await client.query(`/* projection-store:resolve-scoring-entities */
        WITH input AS (
          SELECT * FROM jsonb_to_recordset($1::jsonb) AS value(
            ordinal integer, proposed_id uuid, input_key text, kind text,
            display_name text, nfl_team text, provider_ids jsonb
          )
        ), expanded AS (
          SELECT input.ordinal, input.input_key, input.proposed_id,
            ids.provider, input.kind, ids.external_id
          FROM input
          CROSS JOIN LATERAL jsonb_to_recordset(input.provider_ids) AS ids(
            provider text, external_id text
          )
        ), resolved AS (
          SELECT expanded.ordinal, expanded.input_key, expanded.proposed_id,
            COALESCE(array_agg(DISTINCT mapping.scoring_entity_id)
              FILTER (WHERE mapping.scoring_entity_id IS NOT NULL), '{}'::uuid[]) AS entity_ids
          FROM expanded
          LEFT JOIN external_scoring_entity_ids mapping
            ON mapping.provider = expanded.provider
            AND mapping.entity_kind = expanded.kind
            AND mapping.external_id = expanded.external_id
          GROUP BY expanded.ordinal, expanded.input_key, expanded.proposed_id
        )
        SELECT input_key,
          CASE WHEN cardinality(entity_ids) = 1 THEN entity_ids[1] END AS entity_id,
          cardinality(entity_ids) > 1 AS conflict,
          proposed_id
        FROM resolved ORDER BY ordinal`, [json(prepared)]);

      const proposedIdsToClean = rows
        .filter((row) => rowNullableText(row, 'entity_id') !== rowText(row, 'proposed_id'))
        .map((row) => rowText(row, 'proposed_id'));
      if (proposedIdsToClean.length > 0) {
        await client.query(`/* projection-store:clean-orphan-scoring-entities */
          DELETE FROM scoring_entities entity
          WHERE entity.id = ANY($1::uuid[])
            AND NOT EXISTS (
              SELECT 1 FROM external_scoring_entity_ids mapping
              WHERE mapping.scoring_entity_id = entity.id
            )`, [proposedIdsToClean]);
      }

      return {
        kind: 'stored',
        value: rows.map((row) => ({
          key: rowText(row, 'input_key'),
          entityId: rowBoolean(row, 'conflict') ? null : rowNullableText(row, 'entity_id'),
          conflict: rowBoolean(row, 'conflict'),
        })),
      };
    },

    async upsertNflGames(inputs) {
      if (!client) return disabled();
      if (inputs.length === 0) return { kind: 'stored', value: [] };
      const providerGameKeys = new Set<string>();
      const scheduleKeys = new Set<string>();
      for (const input of inputs) {
        const providerGameKey = `${provider(input.provider)}\0${requiredText(input.externalGameId, 'External NFL game ID')}`;
        const scheduleKey = `${input.season}\0${input.seasonType}\0${input.week}\0${input.homeTeam.toUpperCase()}\0${input.awayTeam.toUpperCase()}`;
        if (providerGameKeys.has(providerGameKey) || scheduleKeys.has(scheduleKey)) {
          throw new Error('NFL game identity inputs must be unique.');
        }
        providerGameKeys.add(providerGameKey);
        scheduleKeys.add(scheduleKey);
      }
      const prepared = inputs.map((input, ordinal) => ({
        ordinal,
        proposed_id: deterministicUuid(
          'nfl-game',
          `${provider(input.provider)}:${requiredText(input.externalGameId, 'External NFL game ID')}`,
        ),
        input_key: requiredText(input.key, 'NFL game key'),
        provider: provider(input.provider),
        external_game_id: requiredText(input.externalGameId, 'External NFL game ID'),
        season: input.season,
        season_type: input.seasonType,
        week: input.week,
        home_team: requiredText(input.homeTeam, 'Home team').toUpperCase(),
        away_team: requiredText(input.awayTeam, 'Away team').toUpperCase(),
        kickoff_at: input.kickoffAt,
      }));

      await client.query(`/* projection-store:upsert-nfl-games */
        WITH input AS (
          SELECT * FROM jsonb_to_recordset($1::jsonb) AS value(
            ordinal integer, proposed_id uuid, input_key text, provider text,
            external_game_id text, season smallint, season_type text, week smallint,
            home_team text, away_team text, kickoff_at timestamptz
          )
        ), existing_mappings AS (
          SELECT input.ordinal, mapping.nfl_game_id
          FROM input
          JOIN external_game_ids mapping
            ON mapping.provider = input.provider
            AND mapping.external_game_id = input.external_game_id
        ), inserted_games AS (
          INSERT INTO nfl_games
            (id, season, season_type, week, home_team, away_team, kickoff_at)
          SELECT input.proposed_id, input.season, input.season_type, input.week,
            input.home_team, input.away_team, input.kickoff_at
          FROM input LEFT JOIN existing_mappings USING (ordinal)
          WHERE existing_mappings.nfl_game_id IS NULL
          ON CONFLICT (season, season_type, week, home_team, away_team) DO UPDATE
          SET kickoff_at = COALESCE(EXCLUDED.kickoff_at, nfl_games.kickoff_at),
              updated_at = now()
          RETURNING id, season, season_type, week, home_team, away_team
        ), targets AS (
          SELECT input.*,
            COALESCE(existing_mappings.nfl_game_id, inserted_games.id) AS target_id
          FROM input
          LEFT JOIN existing_mappings USING (ordinal)
          LEFT JOIN inserted_games
            ON inserted_games.season = input.season
            AND inserted_games.season_type = input.season_type
            AND inserted_games.week = input.week
            AND inserted_games.home_team = input.home_team
            AND inserted_games.away_team = input.away_team
        ), inserted_mappings AS (
          INSERT INTO external_game_ids (provider, external_game_id, nfl_game_id)
          SELECT provider, external_game_id, target_id FROM targets
          WHERE target_id IS NOT NULL
          ON CONFLICT (provider, external_game_id) DO NOTHING
          RETURNING nfl_game_id
        ), write_gate AS (
          SELECT count(*) FROM inserted_mappings
        )
        SELECT input_key, target_id AS game_id
        FROM targets CROSS JOIN write_gate
        WHERE target_id IS NOT NULL
        ORDER BY ordinal`, [json(prepared)]);

      const rows = await client.query(`/* projection-store:resolve-nfl-games */
        WITH input AS (
          SELECT * FROM jsonb_to_recordset($1::jsonb) AS value(
            ordinal integer, proposed_id uuid, input_key text, provider text,
            external_game_id text, season smallint, season_type text, week smallint,
            home_team text, away_team text, kickoff_at timestamptz
          )
        )
        SELECT input.input_key, input.proposed_id,
          mapping.nfl_game_id AS mapped_game_id,
          natural_game.id AS natural_game_id,
          COALESCE(mapping.nfl_game_id, natural_game.id) AS game_id,
          (
            mapped_game.id IS NOT NULL AND (
              mapped_game.season IS DISTINCT FROM input.season
              OR mapped_game.season_type IS DISTINCT FROM input.season_type
              OR mapped_game.week IS DISTINCT FROM input.week
              OR mapped_game.home_team IS DISTINCT FROM input.home_team
              OR mapped_game.away_team IS DISTINCT FROM input.away_team
            )
          ) OR (
            mapping.nfl_game_id IS NOT NULL AND natural_game.id IS NOT NULL
            AND mapping.nfl_game_id <> natural_game.id
          ) AS conflict
        FROM input
        LEFT JOIN external_game_ids mapping
          ON mapping.provider = input.provider
          AND mapping.external_game_id = input.external_game_id
        LEFT JOIN nfl_games mapped_game ON mapped_game.id = mapping.nfl_game_id
        LEFT JOIN nfl_games natural_game
          ON natural_game.season = input.season
          AND natural_game.season_type = input.season_type
          AND natural_game.week = input.week
          AND natural_game.home_team = input.home_team
          AND natural_game.away_team = input.away_team
        ORDER BY input.ordinal`, [json(prepared)]);

      const proposedIdsToClean = rows
        .filter((row) => rowNullableText(row, 'game_id') !== rowText(row, 'proposed_id'))
        .map((row) => rowText(row, 'proposed_id'));
      if (proposedIdsToClean.length > 0) {
        await client.query(`/* projection-store:clean-orphan-nfl-games */
          DELETE FROM nfl_games game
          WHERE game.id = ANY($1::uuid[])
            AND NOT EXISTS (SELECT 1 FROM external_game_ids source WHERE source.nfl_game_id = game.id)
            AND NOT EXISTS (SELECT 1 FROM game_state_observations state WHERE state.nfl_game_id = game.id)
            AND NOT EXISTS (SELECT 1 FROM pregame_projection_candidates candidate WHERE candidate.nfl_game_id = game.id)
            AND NOT EXISTS (SELECT 1 FROM pregame_projection_baselines baseline WHERE baseline.nfl_game_id = game.id)
            AND NOT EXISTS (SELECT 1 FROM league_week_expected_games expected WHERE expected.nfl_game_id = game.id)`,
        [proposedIdsToClean]);
      }
      if (rows.some((row) => rowBoolean(row, 'conflict'))) {
        throw new Error('An external NFL game ID conflicts with its scheduled game identity.');
      }
      if (rows.some((row) => !rowNullableText(row, 'game_id'))) {
        throw new Error('NFL game identity resolution did not return every game.');
      }

      return {
        kind: 'stored',
        value: rows.map((row) => ({ key: rowText(row, 'input_key'), gameId: rowText(row, 'game_id') })),
      };
    },

    async recordProjectionCandidates(input) {
      if (!client) return disabled();
      const candidates = input.candidates.map((candidate) => ({
        game_id: candidate.gameId,
        entity_id: candidate.entityId,
        scoring_profile_id: candidate.scoringProfileId,
        projection_points: candidate.projectionPoints,
        projected_stats: candidate.projectedStats,
        quality: candidate.quality,
      }));
      const rows = await client.query(`/* projection-store:record-projection-candidates */
        WITH run AS (
          INSERT INTO pregame_projection_runs (
            provider, season, season_type, week, model_version, source_revision,
            request_started_at, request_completed_at, fetched_at, quality
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          ON CONFLICT (provider, season, season_type, week, source_revision, model_version)
          DO UPDATE SET source_revision = pregame_projection_runs.source_revision
          RETURNING id
        ), input AS (
          SELECT * FROM jsonb_to_recordset($11::jsonb) AS value(
            game_id uuid, entity_id uuid, scoring_profile_id uuid,
            projection_points numeric, projected_stats jsonb, quality text
          )
        ), inserted_candidates AS (
          INSERT INTO pregame_projection_candidates (
            projection_run_id, nfl_game_id, scoring_entity_id, scoring_profile_id,
            projection_points, projected_stats, quality
          )
          SELECT run.id, input.game_id, input.entity_id, input.scoring_profile_id,
            input.projection_points, input.projected_stats, input.quality
          FROM input CROSS JOIN run
          ON CONFLICT DO NOTHING
          RETURNING projection_run_id
        )
        SELECT run.id AS run_id,
          (SELECT count(*) FROM inserted_candidates)::integer AS candidates_stored,
          (SELECT count(*) FROM input)::integer AS candidate_count
        FROM run`, [
        provider(input.provider), input.season, input.seasonType, input.week,
        requiredText(input.modelVersion, 'Projection model version'),
        requiredText(input.sourceRevision, 'Projection source revision'),
        input.requestStartedAt, input.requestCompletedAt, input.fetchedAt, input.quality,
        json(candidates),
      ]);
      const row = rows[0];
      if (!row) throw new Error('Projection run did not return a row.');
      return {
        kind: 'stored',
        value: {
          runId: rowText(row, 'run_id'),
          candidatesStored: rowNumber(row, 'candidates_stored'),
          candidateCount: rowNumber(row, 'candidate_count'),
        },
      };
    },

    async readLatestCandidatesBySleeperIds(input) {
      if (!client) return [];
      const sleeperIds = normalizeIds(input.sleeperPlayerIds);
      if (sleeperIds.length === 0) return [];
      const rows = await client.query(`/* projection-store:read-latest-candidates */
        SELECT DISTINCT ON (sleeper.external_id)
          sleeper.external_id AS sleeper_player_id,
          entity.id AS entity_id,
          entity.kind AS entity_kind,
          entity.display_name,
          entity.nfl_team,
          game.id AS game_id,
          tank_game.external_game_id AS tank01_game_id,
          candidate.projection_points,
          candidate.projected_stats,
          candidate.quality,
          run.id AS source_projection_run_id,
          run.provider AS projection_provider,
          run.model_version,
          run.fetched_at::text,
          NULL::text AS frozen_at
        FROM external_scoring_entity_ids sleeper
        JOIN scoring_entities entity ON entity.id = sleeper.scoring_entity_id
        JOIN pregame_projection_candidates candidate ON candidate.scoring_entity_id = entity.id
        JOIN pregame_projection_runs run ON run.id = candidate.projection_run_id
        JOIN nfl_games game ON game.id = candidate.nfl_game_id
        JOIN league_seasons season
          ON season.id = $1 AND season.scoring_profile_id = candidate.scoring_profile_id
        LEFT JOIN LATERAL (
          SELECT mapping.external_game_id
          FROM external_game_ids mapping
          WHERE mapping.nfl_game_id = game.id AND mapping.provider = 'tank01'
          ORDER BY mapping.mapped_at DESC, mapping.external_game_id DESC
          LIMIT 1
        ) tank_game ON true
        WHERE sleeper.provider = 'sleeper'
          AND sleeper.external_id = ANY($2::text[])
          AND run.season = $3 AND run.season_type = $4 AND run.week = $5
          AND run.model_version = $6 AND run.quality = 'complete'
          AND run.provider = $7
          AND candidate.quality <> 'invalid'
        ORDER BY sleeper.external_id, run.fetched_at DESC, run.created_at DESC`, [
        input.leagueSeasonId, sleeperIds, input.season, input.seasonType,
        input.week, input.modelVersion, provider(input.provider),
      ]);
      return rows.map(asPlayerProjection);
    },

    async freezeLatestBaselines(input) {
      if (!client) return disabled();
      const gameIds = normalizeIds(input.externalGameIds);
      if (gameIds.length === 0) return { kind: 'stored', value: [] };
      const rows = await client.query(`/* projection-store:freeze-latest-baselines */
        WITH requested_games AS (
          SELECT DISTINCT mapping.nfl_game_id
          FROM external_game_ids mapping
          WHERE mapping.provider = $1 AND mapping.external_game_id = ANY($2::text[])
        ), latest AS (
          SELECT DISTINCT ON (candidate.nfl_game_id, candidate.scoring_entity_id)
            candidate.nfl_game_id, candidate.scoring_entity_id,
            candidate.scoring_profile_id, candidate.projection_points,
            candidate.projected_stats, candidate.quality,
            run.id AS source_projection_run_id, run.provider AS projection_provider,
            run.model_version, run.fetched_at
          FROM pregame_projection_candidates candidate
          JOIN pregame_projection_runs run ON run.id = candidate.projection_run_id
          JOIN requested_games ON requested_games.nfl_game_id = candidate.nfl_game_id
          JOIN nfl_games game ON game.id = candidate.nfl_game_id
          JOIN league_seasons league_season
            ON league_season.id = $3
            AND league_season.scoring_profile_id = candidate.scoring_profile_id
          WHERE run.season = $4 AND run.season_type = $5 AND run.week = $6
            AND run.model_version = $7 AND run.quality = 'complete'
            AND run.provider = $8
            AND game.kickoff_at IS NOT NULL
            AND run.fetched_at <= game.kickoff_at
            AND candidate.quality <> 'invalid'
          ORDER BY candidate.nfl_game_id, candidate.scoring_entity_id,
            run.fetched_at DESC, run.created_at DESC
        ), inserted AS (
          INSERT INTO pregame_projection_baselines (
            nfl_game_id, scoring_entity_id, scoring_profile_id,
            projection_provider, model_version,
            source_projection_run_id, projection_points, projected_stats, quality, frozen_at
          )
          SELECT nfl_game_id, scoring_entity_id, scoring_profile_id,
            projection_provider, model_version,
            source_projection_run_id, projection_points, projected_stats, quality, $9
          FROM latest
          ON CONFLICT DO NOTHING
          RETURNING *
        ), selected AS (
          SELECT baseline.*
          FROM pregame_projection_baselines baseline
          JOIN requested_games ON requested_games.nfl_game_id = baseline.nfl_game_id
          JOIN league_seasons league_season
            ON league_season.id = $3
            AND league_season.scoring_profile_id = baseline.scoring_profile_id
          WHERE baseline.model_version = $7 AND baseline.projection_provider = $8
          UNION ALL
          SELECT inserted.* FROM inserted
          WHERE NOT EXISTS (
            SELECT 1 FROM pregame_projection_baselines baseline
            WHERE baseline.nfl_game_id = inserted.nfl_game_id
              AND baseline.scoring_entity_id = inserted.scoring_entity_id
              AND baseline.scoring_profile_id = inserted.scoring_profile_id
              AND baseline.projection_provider = inserted.projection_provider
              AND baseline.model_version = inserted.model_version
          )
        )
        SELECT sleeper.external_id AS sleeper_player_id,
          entity.id AS entity_id, entity.kind AS entity_kind,
          entity.display_name, entity.nfl_team,
          game.id AS game_id, tank_game.external_game_id AS tank01_game_id,
          selected.projection_points, selected.projected_stats, selected.quality,
          selected.source_projection_run_id,
          selected.projection_provider,
          selected.model_version,
          run.fetched_at::text,
          selected.frozen_at::text
        FROM selected
        JOIN scoring_entities entity ON entity.id = selected.scoring_entity_id
        JOIN nfl_games game ON game.id = selected.nfl_game_id
        JOIN pregame_projection_runs run ON run.id = selected.source_projection_run_id
        JOIN external_scoring_entity_ids sleeper
          ON sleeper.scoring_entity_id = entity.id AND sleeper.provider = 'sleeper'
        LEFT JOIN LATERAL (
          SELECT mapping.external_game_id
          FROM external_game_ids mapping
          WHERE mapping.nfl_game_id = game.id AND mapping.provider = 'tank01'
          ORDER BY mapping.mapped_at DESC, mapping.external_game_id DESC
          LIMIT 1
        ) tank_game ON true
        ORDER BY sleeper.external_id`, [
        provider(input.gameProvider), gameIds, input.leagueSeasonId, input.season,
        input.seasonType, input.week, input.modelVersion,
        provider(input.projectionProvider), input.frozenAt,
      ]);
      return { kind: 'stored', value: rows.map(asPlayerProjection) };
    },

    async readFrozenBaselinesBySleeperIds(input) {
      if (!client) return [];
      const sleeperIds = normalizeIds(input.sleeperPlayerIds);
      if (sleeperIds.length === 0) return [];
      const rows = await client.query(`/* projection-store:read-frozen-baselines */
        SELECT sleeper.external_id AS sleeper_player_id,
          entity.id AS entity_id, entity.kind AS entity_kind,
          entity.display_name, entity.nfl_team,
          game.id AS game_id, tank_game.external_game_id AS tank01_game_id,
          baseline.projection_points, baseline.projected_stats, baseline.quality,
          baseline.source_projection_run_id,
          baseline.projection_provider,
          baseline.model_version,
          run.fetched_at::text,
          baseline.frozen_at::text
        FROM external_scoring_entity_ids sleeper
        JOIN scoring_entities entity ON entity.id = sleeper.scoring_entity_id
        JOIN pregame_projection_baselines baseline ON baseline.scoring_entity_id = entity.id
        JOIN pregame_projection_runs run ON run.id = baseline.source_projection_run_id
        JOIN nfl_games game ON game.id = baseline.nfl_game_id
        JOIN league_seasons league_season
          ON league_season.id = $1
          AND league_season.scoring_profile_id = baseline.scoring_profile_id
        LEFT JOIN LATERAL (
          SELECT mapping.external_game_id
          FROM external_game_ids mapping
          WHERE mapping.nfl_game_id = game.id AND mapping.provider = 'tank01'
          ORDER BY mapping.mapped_at DESC, mapping.external_game_id DESC
          LIMIT 1
        ) tank_game ON true
        WHERE sleeper.provider = 'sleeper' AND sleeper.external_id = ANY($2::text[])
          AND game.season = $3 AND game.season_type = $4 AND game.week = $5
          AND baseline.model_version = $6 AND baseline.projection_provider = $7
        ORDER BY sleeper.external_id`, [
        input.leagueSeasonId, sleeperIds, input.season, input.seasonType,
        input.week, input.modelVersion, provider(input.provider),
      ]);
      return rows.map(asPlayerProjection);
    },

    async recordGameStates(input) {
      if (!client) return disabled();
      if (input.states.length === 0) return { kind: 'stored', value: [] };
      const normalizedProvider = provider(input.provider);
      const externalGameIds = input.states.map((state) =>
        requiredText(state.externalGameId, 'External game ID'));
      if (new Set(externalGameIds).size !== externalGameIds.length) {
        throw new Error('A game-state batch must contain each external game ID once.');
      }
      const states = input.states.map((state) => ({
        external_game_id: requiredText(state.externalGameId, 'External game ID'),
        source_revision: requiredText(state.sourceRevision, 'Game-state source revision'),
        request_started_at: state.requestStartedAt,
        request_completed_at: state.requestCompletedAt,
        observed_at: state.observedAt,
        status_code: state.statusCode,
        period: state.period,
        game_clock: state.gameClock,
        home_score: state.homeScore,
        away_score: state.awayScore,
        source_data: state.sourceData,
      }));
      const rows = await client.query(`/* projection-store:record-game-states */
        WITH input AS (
          SELECT * FROM jsonb_to_recordset($2::jsonb) AS value(
            external_game_id text, source_revision text,
            request_started_at timestamptz, request_completed_at timestamptz,
            observed_at timestamptz, status_code smallint, period text, game_clock text,
            home_score numeric, away_score numeric, source_data jsonb
          )
        ), mapped AS (
          SELECT input.*, mapping.nfl_game_id
          FROM input JOIN external_game_ids mapping
            ON mapping.provider = $1 AND mapping.external_game_id = input.external_game_id
        ), inserted AS (
          INSERT INTO game_state_observations (
            nfl_game_id, provider, source_revision, request_started_at,
            request_completed_at, observed_at, status_code, period, game_clock,
            home_score, away_score, source_data
          )
          SELECT nfl_game_id, $1, source_revision, request_started_at,
            request_completed_at, observed_at, status_code, period, game_clock,
            home_score, away_score, source_data
          FROM mapped
          ORDER BY nfl_game_id
          ON CONFLICT (provider, nfl_game_id, source_revision) DO UPDATE
          SET source_revision = game_state_observations.source_revision
          WHERE game_state_observations.request_started_at = EXCLUDED.request_started_at
            AND game_state_observations.request_completed_at = EXCLUDED.request_completed_at
            AND game_state_observations.observed_at = EXCLUDED.observed_at
            AND game_state_observations.status_code = EXCLUDED.status_code
            AND game_state_observations.period IS NOT DISTINCT FROM EXCLUDED.period
            AND game_state_observations.game_clock IS NOT DISTINCT FROM EXCLUDED.game_clock
            AND game_state_observations.home_score IS NOT DISTINCT FROM EXCLUDED.home_score
            AND game_state_observations.away_score IS NOT DISTINCT FROM EXCLUDED.away_score
            AND game_state_observations.source_data = EXCLUDED.source_data
          RETURNING id, nfl_game_id, source_revision
        ), resolved AS (
          SELECT id, nfl_game_id, source_revision FROM inserted
        )
        SELECT mapped.external_game_id, resolved.source_revision,
          resolved.id AS observation_id
        FROM resolved
        JOIN mapped ON mapped.nfl_game_id = resolved.nfl_game_id
          AND mapped.source_revision = resolved.source_revision
        ORDER BY mapped.external_game_id`, [normalizedProvider, json(states)]);
      return {
        kind: 'stored',
        value: rows.map((row) => ({
          externalGameId: rowText(row, 'external_game_id'),
          sourceRevision: rowText(row, 'source_revision'),
          observationId: rowText(row, 'observation_id'),
        })),
      };
    },

    async recordLeagueWeekObservation(input) {
      if (!client) return disabled();
      const expectedGameIds = normalizeIds(input.expectedTank01GameIds);
      if (containsScheduledGame(input.sourceData) && expectedGameIds.length === 0) {
        throw new Error('Scheduled games require expected Tank01 game identifiers.');
      }
      const playerPoints = input.playerPoints.map((point) => ({
        sleeper_player_id: requiredText(point.sleeperPlayerId, 'Sleeper player ID'),
        entity_kind: point.entityKind,
        external_roster_id: requiredText(point.externalRosterId, 'External roster ID'),
        points: point.points,
        is_starter: point.isStarter,
        lineup_slot: point.lineupSlot,
      }));
      const rosterPoints = input.rosterPoints.map((point) => ({
        external_roster_id: requiredText(point.externalRosterId, 'External roster ID'),
        points: point.points,
      }));
      const rows = await client.query(`/* projection-store:record-league-week-observation */
        WITH inserted_observation AS (
          INSERT INTO league_week_observations (
            league_season_id, provider, week, source_revision, request_started_at,
            request_completed_at, observed_at, quality, expected_game_count, source_data
          ) VALUES ($1, 'sleeper', $2, $3, $4, $5, $6, $7, $11, $8::jsonb)
          ON CONFLICT (league_season_id, provider, source_revision) DO NOTHING
          RETURNING id
        ), observation AS (
          SELECT id FROM inserted_observation
          UNION ALL
          SELECT id FROM league_week_observations
          WHERE league_season_id = $1 AND provider = 'sleeper' AND source_revision = $3
            AND week = $2 AND observed_at = $6::timestamptz AND quality = $7
            AND expected_game_count = $11 AND source_data = $8::jsonb
          LIMIT 1
        ), expected_input AS (
          SELECT unnest($12::text[]) AS external_game_id
        ), mapped_expected AS (
          SELECT expected_input.external_game_id, mapping.nfl_game_id
          FROM expected_input
          JOIN external_game_ids mapping
            ON mapping.provider = 'tank01'
            AND mapping.external_game_id = expected_input.external_game_id
          JOIN nfl_games game ON game.id = mapping.nfl_game_id
          JOIN league_seasons season
            ON season.id = $1 AND season.season = game.season
          WHERE game.week = $2 AND game.season_type = 'reg'
        ), inserted_expected AS (
          INSERT INTO league_week_expected_games (league_week_observation_id, nfl_game_id)
          SELECT inserted_observation.id, mapped_expected.nfl_game_id
          FROM inserted_observation CROSS JOIN mapped_expected
          ON CONFLICT DO NOTHING
          RETURNING nfl_game_id
        ), player_input AS (
          SELECT * FROM jsonb_to_recordset($9::jsonb) AS value(
            sleeper_player_id text, entity_kind text, external_roster_id text,
            points numeric, is_starter boolean, lineup_slot text
          )
        ), mapped_players AS (
          SELECT player_input.*, mapping.scoring_entity_id
          FROM player_input
          JOIN external_scoring_entity_ids mapping
            ON mapping.provider = 'sleeper'
            AND mapping.entity_kind = player_input.entity_kind
            AND mapping.external_id = player_input.sleeper_player_id
        ), inserted_players AS (
          INSERT INTO official_player_point_observations (
            league_week_observation_id, external_roster_id, scoring_entity_id,
            points, is_starter, lineup_slot
          )
          SELECT observation.id, external_roster_id, scoring_entity_id,
            points, is_starter, lineup_slot
          FROM mapped_players CROSS JOIN observation
          ON CONFLICT DO NOTHING
          RETURNING scoring_entity_id
        ), roster_input AS (
          SELECT * FROM jsonb_to_recordset($10::jsonb) AS value(
            external_roster_id text, points numeric
          )
        ), inserted_rosters AS (
          INSERT INTO official_roster_point_observations (
            league_week_observation_id, external_roster_id, points
          )
          SELECT observation.id, external_roster_id, points
          FROM roster_input CROSS JOIN observation
          ON CONFLICT DO NOTHING
          RETURNING external_roster_id
        )
        SELECT observation.id AS observation_id,
          ((SELECT count(*) FROM official_player_point_observations points
            WHERE points.league_week_observation_id = observation.id)::integer
            + (SELECT count(*) FROM inserted_players)::integer)
            AS player_points_stored,
          ((SELECT count(*) FROM official_roster_point_observations points
            WHERE points.league_week_observation_id = observation.id)::integer
            + (SELECT count(*) FROM inserted_rosters)::integer)
            AS roster_points_stored,
          COALESCE((SELECT jsonb_agg(player_input.sleeper_player_id ORDER BY player_input.sleeper_player_id)
            FROM player_input
            WHERE NOT EXISTS (
              SELECT 1 FROM mapped_players
              WHERE mapped_players.sleeper_player_id = player_input.sleeper_player_id
                AND mapped_players.entity_kind = player_input.entity_kind
            )), '[]'::jsonb) AS unmapped_ids,
          ((SELECT count(*) FROM league_week_expected_games expected
            WHERE expected.league_week_observation_id = observation.id)::integer
            + (SELECT count(*) FROM inserted_expected)::integer)
            AS expected_games_stored,
          COALESCE((SELECT jsonb_agg(expected_input.external_game_id ORDER BY expected_input.external_game_id)
            FROM expected_input
            WHERE NOT EXISTS (
              SELECT 1 FROM mapped_expected
              WHERE mapped_expected.external_game_id = expected_input.external_game_id
            )), '[]'::jsonb) AS unmapped_game_ids,
          (SELECT count(*) FROM inserted_players) AS inserted_player_count,
          (SELECT count(*) FROM inserted_rosters) AS inserted_roster_count
        FROM observation`, [
        input.leagueSeasonId, input.week,
        requiredText(input.sourceRevision, 'Sleeper source revision'),
        input.requestStartedAt, input.requestCompletedAt, input.observedAt,
        input.quality, json(input.sourceData), json(playerPoints), json(rosterPoints),
        expectedGameIds.length, expectedGameIds,
      ]);
      const row = rows[0];
      if (!row) throw new Error('League-week observation did not return a row.');
      const rawUnmapped = row.unmapped_ids;
      const unmapped = Array.isArray(rawUnmapped)
        ? rawUnmapped.filter((value): value is string => typeof value === 'string')
        : [];
      const rawUnmappedGames = row.unmapped_game_ids;
      const unmappedGames = Array.isArray(rawUnmappedGames)
        ? rawUnmappedGames.filter((value): value is string => typeof value === 'string')
        : [];
      return {
        kind: 'stored',
        value: {
          observationId: rowText(row, 'observation_id'),
          playerPointsStored: rowNumber(row, 'player_points_stored'),
          rosterPointsStored: rowNumber(row, 'roster_points_stored'),
          unmappedSleeperPlayerIds: unmapped,
          expectedGamesStored: rowNumber(row, 'expected_games_stored'),
          unmappedTank01GameIds: unmappedGames,
        },
      };
    },

    async acquireJob(input) {
      if (!client) return { kind: 'disabled' };
      if (!Number.isInteger(input.leaseSeconds) || input.leaseSeconds < 1) {
        throw new Error('Job lease must be a positive number of whole seconds.');
      }
      const rows = await client.query(`/* projection-store:acquire-job */
        INSERT INTO projection_jobs (
          job_key, job_type, scheduled_for, state, payload,
          lease_owner, lease_until, attempt_count, updated_at
        ) VALUES (
          $1, $2, $3, 'running', $4::jsonb,
          $5, now() + ($6 * interval '1 second'), 1, now()
        )
        ON CONFLICT (job_key) DO UPDATE SET
          job_type = EXCLUDED.job_type,
          scheduled_for = EXCLUDED.scheduled_for,
          state = 'running',
          payload = EXCLUDED.payload,
          lease_owner = EXCLUDED.lease_owner,
          lease_until = EXCLUDED.lease_until,
          attempt_count = projection_jobs.attempt_count + 1,
          last_error = NULL,
          completed_at = NULL,
          updated_at = now()
        WHERE (projection_jobs.state IN ('pending', 'failed')
            AND EXCLUDED.scheduled_for >= projection_jobs.scheduled_for)
          OR (projection_jobs.state = 'running' AND projection_jobs.lease_until < now()
            AND EXCLUDED.scheduled_for >= projection_jobs.scheduled_for)
          OR (projection_jobs.state = 'completed'
            AND EXCLUDED.scheduled_for > projection_jobs.scheduled_for)
        RETURNING attempt_count, lease_until::text`, [
        requiredText(input.jobKey, 'Job key'), requiredText(input.jobType, 'Job type'),
        input.scheduledFor, json(input.payload), requiredText(input.workerId, 'Worker ID'),
        input.leaseSeconds,
      ]);
      const acquired = rows[0];
      if (acquired) {
        return {
          kind: 'acquired',
          attempt: rowNumber(acquired, 'attempt_count'),
          leaseUntil: rowText(acquired, 'lease_until'),
        };
      }
      const existing = await client.query(`/* projection-store:read-job-state */
        SELECT state FROM projection_jobs WHERE job_key = $1`, [input.jobKey]);
      return { kind: existing[0]?.state === 'completed' ? 'completed' : 'busy' };
    },

    async completeJob(jobKey, workerId) {
      if (!client) return false;
      const rows = await client.query(`/* projection-store:complete-job */
        UPDATE projection_jobs SET
          state = 'completed', completed_at = now(), lease_owner = NULL,
          lease_until = NULL, updated_at = now()
        WHERE job_key = $1 AND state = 'running' AND lease_owner = $2
        RETURNING job_key`, [jobKey, workerId]);
      return rows.length === 1;
    },

    async failJob(jobKey, workerId, message) {
      if (!client) return false;
      const rows = await client.query(`/* projection-store:fail-job */
        UPDATE projection_jobs SET
          state = 'failed', last_error = left($3, 2000), lease_owner = NULL,
          lease_until = NULL, updated_at = now()
        WHERE job_key = $1 AND state = 'running' AND lease_owner = $2
        RETURNING job_key`, [jobKey, workerId, message]);
      return rows.length === 1;
    },

    async publishSnapshot(input) {
      if (!client) return { kind: 'disabled' };
      if (!isMatchupsData(input.payload)) {
        throw new Error('Only complete matchup data can be published.');
      }
      const payloadSeason = Number(input.payload.league.season);
      if (!Number.isInteger(payloadSeason)
        || input.payload.week !== input.week
        || input.payload.league.week !== input.week) {
        return { kind: 'rejected', reason: 'payload-context-mismatch' };
      }
      const sourceIds = normalizeIds(input.gameStateObservationIds);
      const activityWindows = canonicalActivityWindows(input.activityWindows);
      if (containsScheduledGame(input.payload)
        && (sourceIds.length === 0 || activityWindows.length === 0)) {
        return { kind: 'rejected', reason: 'incomplete-or-mismatched-sources' };
      }
      const maxSourceSkewSeconds = input.maxSourceSkewSeconds ?? 90;
      if (!Number.isInteger(maxSourceSkewSeconds)
        || maxSourceSkewSeconds < 1 || maxSourceSkewSeconds > 600) {
        throw new Error('Source-time skew must be between 1 and 600 whole seconds.');
      }
      const contentHash = snapshotContentHash(input.payload, activityWindows);
      const rows = await client.query(`/* projection-store:publish-snapshot */
        WITH league_source AS (
          SELECT observation.id, observation.observed_at, observation.request_completed_at,
            observation.expected_game_count, observation.source_data, season.season
          FROM league_week_observations observation
          JOIN league_seasons season ON season.id = observation.league_season_id
          WHERE observation.id = $1 AND observation.league_season_id = $2
            AND observation.provider = 'sleeper'
            AND observation.week = $3 AND observation.quality = 'complete'
            AND season.season = $11
            AND (
              observation.expected_game_count > 0
              OR NOT jsonb_path_exists(
                $8::jsonb,
                '$.** ? (@.kind == "scheduled")'::jsonpath
              )
            )
        ), expected_games AS (
          SELECT expected.nfl_game_id
          FROM league_week_expected_games expected
          JOIN league_source ON league_source.id = expected.league_week_observation_id
        ), requested_game_sources AS (
          SELECT unnest($4::uuid[]) AS id
        ), game_sources AS (
          SELECT observation.id, observation.nfl_game_id, observation.observed_at,
            observation.request_completed_at
          FROM requested_game_sources requested
          JOIN game_state_observations observation ON observation.id = requested.id
          JOIN nfl_games game ON game.id = observation.nfl_game_id
          CROSS JOIN league_source
          WHERE observation.provider = 'tank01'
            AND game.season = league_source.season
            AND game.season_type = 'reg'
            AND game.week = $3
        ), source_validation AS (
          SELECT
            EXISTS (SELECT 1 FROM league_source) AS league_ok,
            (SELECT count(*) FROM expected_games)
              = COALESCE((SELECT expected_game_count FROM league_source), -1) AS expected_set_registered,
            (SELECT count(*) FROM requested_game_sources)
              = (SELECT count(*) FROM game_sources) AS every_source_valid,
            (SELECT count(*) FROM game_sources)
              = (SELECT count(*) FROM expected_games) AS complete_count,
            (SELECT count(DISTINCT nfl_game_id) FROM game_sources)
              = (SELECT count(*) FROM expected_games) AS one_source_per_game,
            NOT EXISTS (
              SELECT nfl_game_id FROM expected_games
              EXCEPT SELECT nfl_game_id FROM game_sources
            ) AND NOT EXISTS (
              SELECT nfl_game_id FROM game_sources
              EXCEPT SELECT nfl_game_id FROM expected_games
            ) AS exact_game_set,
            CASE
              WHEN (SELECT count(*) FROM expected_games) = 0 THEN true
              ELSE EXTRACT(EPOCH FROM (
                GREATEST(
                  (SELECT max(request_completed_at) FROM game_sources),
                  (SELECT request_completed_at FROM league_source)
                ) - LEAST(
                  (SELECT min(request_completed_at) FROM game_sources),
                  (SELECT request_completed_at FROM league_source)
                )
              )) <= $10
            END AS source_times_aligned,
            ABS(EXTRACT(EPOCH FROM (
              (SELECT request_completed_at FROM league_source) - $7::timestamptz
            ))) <= $10
              AND NOT EXISTS (
                SELECT 1 FROM game_sources
                WHERE ABS(EXTRACT(EPOCH FROM (
                  game_sources.request_completed_at - $7::timestamptz
                ))) > $10
              ) AS calculation_time_aligned,
            GREATEST(
              (SELECT request_completed_at FROM league_source),
              COALESCE(
                (SELECT max(request_completed_at) FROM game_sources),
                (SELECT request_completed_at FROM league_source)
              )
            ) AS source_verified_at
        ), validated AS (
          SELECT source_verified_at FROM source_validation
          WHERE league_ok AND expected_set_registered AND every_source_valid
            AND complete_count AND one_source_per_game AND exact_game_set
            AND source_times_aligned AND calculation_time_aligned
        ), existing_revision AS (
          SELECT snapshot.* FROM projection_snapshots snapshot
          WHERE snapshot.league_season_id = $2 AND snapshot.week = $3
            AND snapshot.model_version = $5 AND snapshot.revision_key = $6
        ), exact_existing_revision AS (
          SELECT existing_revision.*, validated.source_verified_at,
            'unchanged'::text AS result_kind
          FROM existing_revision
          JOIN current_projection_snapshots current
            ON current.league_season_id = existing_revision.league_season_id
            AND current.week = existing_revision.week
            AND current.snapshot_id = existing_revision.id
          CROSS JOIN validated
          WHERE existing_revision.league_week_observation_id = $1
            AND existing_revision.calculated_at = $7::timestamptz
            AND existing_revision.content_hash = $9
            AND existing_revision.payload = $8::jsonb
            AND existing_revision.activity_windows = $12::jsonb
            AND existing_revision.game_state_observation_ids = $4::uuid[]
        ), unchanged_current AS (
          SELECT snapshot.*, validated.source_verified_at,
            'unchanged'::text AS result_kind
          FROM current_projection_snapshots current
          JOIN projection_snapshots snapshot ON snapshot.id = current.snapshot_id
          CROSS JOIN validated
          WHERE current.league_season_id = $2 AND current.week = $3
            AND snapshot.model_version = $5 AND snapshot.content_hash = $9
            AND snapshot.activity_windows = $12::jsonb
            AND NOT EXISTS (SELECT 1 FROM existing_revision)
        ), inserted AS (
          INSERT INTO projection_snapshots (
            league_season_id, week, model_version, revision_key, content_hash,
            league_week_observation_id, game_state_observation_ids,
            calculated_at, quality, payload, activity_windows
          )
          SELECT $2, $3, $5, $6, $9, $1, $4::uuid[], $7, 'complete',
            $8::jsonb, $12::jsonb
          FROM validated
          WHERE NOT EXISTS (SELECT 1 FROM existing_revision)
            AND NOT EXISTS (SELECT 1 FROM unchanged_current)
            AND NOT EXISTS (
              SELECT 1 FROM current_projection_snapshots current
              WHERE current.league_season_id = $2 AND current.week = $3
                AND current.calculated_at > $7::timestamptz
            )
          ON CONFLICT (league_season_id, week, model_version, revision_key) DO NOTHING
          RETURNING *
        ), selected AS (
          SELECT inserted.*, validated.source_verified_at, 'published'::text AS result_kind
          FROM inserted CROSS JOIN validated
          UNION ALL
          SELECT * FROM exact_existing_revision
          UNION ALL
          SELECT * FROM unchanged_current
          LIMIT 1
        ), published AS (
          INSERT INTO current_projection_snapshots (
            league_season_id, week, snapshot_id, calculated_at, published_at, verified_at
          )
          SELECT $2, $3, selected.id, selected.calculated_at, now(),
            selected.source_verified_at
          FROM selected
          WHERE selected.result_kind = 'published'
          ON CONFLICT (league_season_id, week) DO UPDATE SET
            snapshot_id = EXCLUDED.snapshot_id,
            calculated_at = EXCLUDED.calculated_at,
            published_at = EXCLUDED.published_at,
            verified_at = GREATEST(
              current_projection_snapshots.verified_at,
              EXCLUDED.verified_at
            )
          WHERE EXCLUDED.calculated_at >= current_projection_snapshots.calculated_at
          RETURNING snapshot_id, published_at, verified_at
        ), verified AS (
          UPDATE current_projection_snapshots current
          SET verified_at = GREATEST(current.verified_at, selected.source_verified_at)
          FROM selected
          WHERE selected.result_kind = 'unchanged'
            AND current.league_season_id = selected.league_season_id
            AND current.week = selected.week
            AND current.snapshot_id = selected.id
          RETURNING current.snapshot_id, current.verified_at
        )
        SELECT selected.id AS snapshot_id,
          selected.league_season_id, selected.week, selected.model_version,
          selected.revision_key, selected.calculated_at::text,
          selected.payload, selected.activity_windows,
          COALESCE(published.published_at, current.published_at)::text AS published_at,
          COALESCE(published.verified_at, verified.verified_at, current.verified_at)::text
            AS verified_at,
          COALESCE(published.snapshot_id, current.snapshot_id) = selected.id AS is_current,
          selected.result_kind
        FROM selected
        LEFT JOIN published ON published.snapshot_id = selected.id
        LEFT JOIN verified ON verified.snapshot_id = selected.id
        LEFT JOIN current_projection_snapshots current
          ON current.league_season_id = selected.league_season_id
          AND current.week = selected.week AND current.snapshot_id = selected.id`, [
        input.leagueWeekObservationId, input.leagueSeasonId, input.week, sourceIds,
        requiredText(input.modelVersion, 'Snapshot model version'),
        requiredText(input.revisionKey, 'Snapshot revision key'),
        input.calculatedAt, json(input.payload), contentHash, maxSourceSkewSeconds,
        payloadSeason, json(activityWindows),
      ]);
      const row = rows[0];
      if (!row) return { kind: 'rejected', reason: 'incomplete-or-mismatched-sources' };
      return {
        kind: rowText(row, 'result_kind') === 'unchanged' ? 'unchanged' : 'published',
        snapshot: snapshotFromRow(row),
      };
    },

    async pruneHistory(input) {
      if (!client) return disabled();
      const keep = input.keepRecentSnapshotsPerLeagueWeek ?? 3;
      if (!Number.isInteger(keep) || keep < 1 || keep > 100) {
        throw new Error('Snapshot retention count must be between 1 and 100.');
      }

      // Each deletion is independently safe and idempotent. Source observations
      // referenced by surviving immutable snapshots and all frozen baselines remain.
      const snapshots = await client.query(`/* projection-store:prune-snapshots */
        WITH ranked AS (
          SELECT snapshot.id,
            row_number() OVER (
              PARTITION BY snapshot.league_season_id, snapshot.week, snapshot.model_version
              ORDER BY snapshot.calculated_at DESC, snapshot.created_at DESC
            ) AS retention_rank
          FROM projection_snapshots snapshot
        )
        DELETE FROM projection_snapshots snapshot
        USING ranked
        WHERE snapshot.id = ranked.id
          AND snapshot.created_at < $1::timestamptz
          AND ranked.retention_rank > $2
          AND NOT EXISTS (
            SELECT 1 FROM current_projection_snapshots current
            WHERE current.snapshot_id = snapshot.id
          )
        RETURNING snapshot.id`, [input.before, keep]);
      const leagueObservations = await client.query(`/* projection-store:prune-league-observations */
        DELETE FROM league_week_observations observation
        WHERE observation.created_at < $1::timestamptz
          AND NOT EXISTS (
            SELECT 1 FROM projection_snapshots snapshot
            WHERE snapshot.league_week_observation_id = observation.id
          )
        RETURNING observation.id`, [input.before]);
      const gameObservations = await client.query(`/* projection-store:prune-game-observations */
        DELETE FROM game_state_observations observation
        WHERE observation.created_at < $1::timestamptz
          AND NOT EXISTS (
            SELECT 1 FROM projection_snapshots snapshot
            WHERE snapshot.game_state_observation_ids @> ARRAY[observation.id]::uuid[]
          )
        RETURNING observation.id`, [input.before]);
      const projectionRuns = await client.query(`/* projection-store:prune-projection-runs */
        DELETE FROM pregame_projection_runs run
        WHERE run.created_at < $1::timestamptz
          AND NOT EXISTS (
            SELECT 1 FROM pregame_projection_baselines baseline
            WHERE baseline.source_projection_run_id = run.id
          )
        RETURNING run.id`, [input.before]);
      const jobs = await client.query(`/* projection-store:prune-jobs */
        DELETE FROM projection_jobs job
        WHERE job.updated_at < $1::timestamptz AND job.state = 'completed'
        RETURNING job.job_key`, [input.before]);

      return {
        kind: 'stored',
        value: {
          snapshotsDeleted: snapshots.length,
          leagueObservationsDeleted: leagueObservations.length,
          gameObservationsDeleted: gameObservations.length,
          projectionRunsDeleted: projectionRuns.length,
          jobsDeleted: jobs.length,
        },
      };
    },

    async readCurrentSnapshot(leagueSeasonId, week) {
      if (!client) return null;
      const rows = await client.query(`/* projection-store:read-current-snapshot */
        SELECT snapshot.id AS snapshot_id,
          snapshot.league_season_id, snapshot.week, snapshot.model_version,
          snapshot.revision_key, snapshot.calculated_at::text,
          snapshot.payload, snapshot.activity_windows,
          current.published_at::text, current.verified_at::text,
          true AS is_current
        FROM current_projection_snapshots current
        JOIN projection_snapshots snapshot ON snapshot.id = current.snapshot_id
        WHERE current.league_season_id = $1 AND current.week = $2`, [leagueSeasonId, week]);
      return rows[0] ? snapshotFromRow(rows[0]) : null;
    },

    async readCurrentSnapshotBySleeperLeagueId(sleeperLeagueId, season, week) {
      if (!client) return null;
      const rows = await client.query(`/* projection-store:read-current-snapshot-by-sleeper-id */
        SELECT snapshot.id AS snapshot_id,
          snapshot.league_season_id, snapshot.week, snapshot.model_version,
          snapshot.revision_key, snapshot.calculated_at::text,
          snapshot.payload, snapshot.activity_windows,
          current.published_at::text, current.verified_at::text,
          true AS is_current
        FROM league_source_connections connection
        JOIN league_seasons season
          ON season.id = connection.league_season_id AND season.season = $2
        JOIN current_projection_snapshots current
          ON current.league_season_id = season.id AND current.week = $3
        JOIN projection_snapshots snapshot ON snapshot.id = current.snapshot_id
        WHERE connection.provider = 'sleeper' AND connection.external_league_id = $1`, [
        requiredText(sleeperLeagueId, 'Sleeper league ID'), season, week,
      ]);
      return rows[0] ? snapshotFromRow(rows[0]) : null;
    },

    async readLatestCurrentSnapshotBySleeperLeagueId(sleeperLeagueId, week) {
      if (!client) return null;
      const rows = await client.query(`/* projection-store:read-latest-current-snapshot-by-sleeper-id */
        SELECT snapshot.id AS snapshot_id,
          snapshot.league_season_id, snapshot.week, snapshot.model_version,
          snapshot.revision_key, snapshot.calculated_at::text,
          snapshot.payload, snapshot.activity_windows,
          current.published_at::text, current.verified_at::text,
          true AS is_current
        FROM league_source_connections connection
        JOIN league_seasons season ON season.id = connection.league_season_id
        JOIN current_projection_snapshots current
          ON current.league_season_id = season.id
        JOIN projection_snapshots snapshot ON snapshot.id = current.snapshot_id
        WHERE connection.provider = 'sleeper' AND connection.external_league_id = $1
          AND ($2::smallint IS NULL OR current.week = $2)
        ORDER BY season.season DESC, current.week DESC, current.calculated_at DESC
        LIMIT 1`, [requiredText(sleeperLeagueId, 'Sleeper league ID'), week ?? null]);
      return rows[0] ? snapshotFromRow(rows[0]) : null;
    },
  };
}

let cachedDatabase: Database | undefined;
let cachedStore: ProjectionStore | undefined;

export function getProjectionStore(): ProjectionStore {
  const database = getDatabase();
  if (!cachedStore || cachedDatabase !== database) {
    cachedDatabase = database;
    cachedStore = createProjectionStore(database);
  }
  return cachedStore;
}
