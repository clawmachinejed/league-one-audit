import 'server-only';

import type { DatabaseClient, DatabaseRow } from '../../../database';
import { EXACT_MATCHUPS_POLICY, exactMatchupsScope, type AcceptedExactMatchupsRead, type ExactPeriodMappingQualification } from '../../../aggregator/exact-matchups';
import { joinAcceptedExactMatchupDerived, type ExactMatchupCompatibilityEvidence,
  type JoinAcceptedExactMatchupDerivedInput } from '../../../aggregator/exact-matchup-compatibility';
import type { JsonValue } from '../../../league-administration/contracts';
import { isAdministrationSourceMapping, type AdministrationSourceMapping } from '../../../league-administration/source-mapping';
import type { SnapshotSourceHistoryRead } from '../../shared/source-history';
import { SNAPSHOT_SOURCE_HISTORY_READ_SQL, readSnapshotSourceHistoryRow } from './source-history';
import { snapshotFromRow } from './snapshot-codec';
import type { StoredProjectionSnapshot } from './contracts';

export type ExactMatchupCompatibilityReadInput = Pick<JoinAcceptedExactMatchupDerivedInput,
  'request' | 'expectedMapping' | 'context' | 'now'>;

/** Administration injects its exact selection and parsers through the two store facades. */
export type ExactMatchupCompatibilityDependencies = Readonly<{
  acceptedSql: string;
  readAcceptedRows: (rows: readonly DatabaseRow[], mapping: AdministrationSourceMapping, week: number) => AcceptedExactMatchupsRead;
  readNativePeriodMapping: (value: unknown, mapping: AdministrationSourceMapping, contentId: string,
    configuration: Readonly<Record<string, unknown>>, week: number) => ExactPeriodMappingQualification;
}>;

// The two existing exact readers retain their own SQL and parsers. Renumber only
// their fixed positional parameters to compose one PostgreSQL statement snapshot.
const historySql = SNAPSHOT_SOURCE_HISTORY_READ_SQL.replace(/\$(\d+)/g, (_match, ordinal: string) => `$${Number(ordinal) + 4}`);
function compatibilitySql(acceptedSql: string): string { return `
  WITH accepted_evidence AS (${acceptedSql}),
  history_evidence AS (${historySql}),
  selected_snapshot AS (
    SELECT snapshot.id AS snapshot_id,snapshot.league_season_id,snapshot.week,snapshot.model_version,
      snapshot.revision_key,snapshot.calculated_at::text,snapshot.payload,snapshot.activity_windows,
      current.published_at::text,current.verified_at::text,
      current.snapshot_id IS NOT NULL AS is_current
    FROM public.projection_snapshots snapshot
    JOIN history_evidence history ON history.snapshot_id=snapshot.id
    LEFT JOIN public.current_projection_snapshots current ON current.snapshot_id=snapshot.id
      AND current.league_season_id=snapshot.league_season_id AND current.week=snapshot.week
  ), selected_content_ids AS (
    SELECT (entry->'input'->>'content_id')::uuid AS id
    FROM history_evidence history CROSS JOIN LATERAL jsonb_array_elements(history.inputs) entry
    UNION SELECT configuration_content_id FROM accepted_evidence
  ), retained_contents AS (
    SELECT content.id,content.league_season_id,content.provider,content.external_league_id,
      content.family,content.week,content.normalizer_version,content.accepted,content.completeness,
      content.content_hash,content.configuration_version_id,content.payload,
      version.scoring_profile_id,version.league_season_id AS configuration_league_season_id,
      version.dialect AS configuration_dialect,version.normalizer_version AS configuration_normalizer_version,
      (SELECT to_jsonb(calendar) FROM public.league_native_period_calendar_evidence calendar
        WHERE calendar.connection_id=$10::uuid AND calendar.league_season_id=content.league_season_id
          AND calendar.source_mapping_revision_id=$2::uuid AND calendar.configuration_content_id=content.id
          AND calendar.mapping_policy_version='sleeper-native-week-to-nfl-regular-v1'
        ORDER BY calendar.retained_at,calendar.id LIMIT 1) AS calendar_evidence
    FROM selected_content_ids selected JOIN public.league_administration_contents content ON content.id=selected.id
    LEFT JOIN public.league_configuration_versions version ON version.id=content.configuration_version_id
  )
  SELECT
    COALESCE((SELECT jsonb_agg(to_jsonb(accepted)) FROM accepted_evidence accepted),'[]'::jsonb) AS accepted_rows,
    COALESCE((SELECT jsonb_agg(to_jsonb(history)) FROM history_evidence history),'[]'::jsonb) AS history_rows,
    COALESCE((SELECT jsonb_agg(to_jsonb(snapshot)) FROM selected_snapshot snapshot),'[]'::jsonb) AS snapshot_rows,
    COALESCE((SELECT jsonb_agg(to_jsonb(content)) FROM retained_contents content),'[]'::jsonb) AS contents,
    (SELECT jsonb_build_object('id',profile.id,'rulesHash',profile.rules_hash,'rules',profile.rules)
      FROM public.league_seasons season JOIN public.scoring_profiles profile ON profile.id=season.scoring_profile_id
      WHERE season.id=$6::uuid AND season.season=$7) AS profile,
    (SELECT jsonb_build_object('leagueWeekObservationId',original.id,'expectedGameCount',original.expected_game_count,
      'expectedGameIds',(SELECT COALESCE(jsonb_agg(expected.nfl_game_id ORDER BY expected.nfl_game_id),'[]'::jsonb)
        FROM public.league_week_expected_games expected WHERE expected.league_week_observation_id=original.id),
      'observations',(SELECT COALESCE(jsonb_agg(jsonb_build_object('id',observation.id,
        'nflGameId',observation.nfl_game_id,'provider',observation.provider,'season',game.season,
        'seasonType',game.season_type,'week',game.week,'observedAt',observation.observed_at,
        'requestStartedAt',observation.request_started_at,'requestCompletedAt',observation.request_completed_at,
        'homeTeam',game.home_team,'awayTeam',game.away_team) ORDER BY observation.id),'[]'::jsonb)
        FROM public.game_state_observations observation JOIN public.nfl_games game ON game.id=observation.nfl_game_id
        WHERE observation.id=ANY(history.game_state_observation_ids)))
      FROM history_evidence history JOIN public.league_week_observations original
        ON original.id=history.league_week_observation_id) AS games`; }

function object(value: unknown): DatabaseRow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid compatibility evidence.');
  return value as DatabaseRow;
}
function rows(value: unknown): readonly DatabaseRow[] {
  if (!Array.isArray(value)) throw new Error('Missing compatibility evidence set.');
  return value.map(object);
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error('Invalid compatibility evidence identity.');
  }
  return value;
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value || value.trim() !== value || /[\x00-\x1f\x7f]/.test(value)) {
    throw new Error('Invalid compatibility evidence text.');
  }
  return value;
}
function integer(value: unknown): number {
  if ((typeof value !== 'number' && typeof value !== 'string') || value === '' || !Number.isSafeInteger(Number(value))) {
    throw new Error('Invalid compatibility evidence number.');
  }
  return Number(value);
}
function timestamp(value: unknown): string {
  const result = text(value);
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?(?:Z|[+-]\d\d:\d\d)$/.test(result)
    || !Number.isFinite(Date.parse(result))) throw new Error('Invalid compatibility evidence time.');
  return result;
}
function contentRow(contents: readonly DatabaseRow[], contentId: string, family: 'league' | 'matchups',
  mapping: AdministrationSourceMapping, week: number): DatabaseRow {
  const matching = contents.filter(row => row.id === contentId);
  if (matching.length !== 1) throw new Error('Missing immutable compatibility content.');
  const row = matching[0];
  if (row.league_season_id !== mapping.leagueSeasonId || row.provider !== mapping.scope.provider
    || row.external_league_id !== mapping.scope.externalLeagueId || row.family !== family
    || integer(row.week) !== (family === 'league' ? 0 : week) || row.accepted !== true
    || row.completeness !== 'complete' || row.normalizer_version !== 'sleeper-administration-v1') {
    throw new Error('Wrong immutable compatibility content scope.');
  }
  text(row.content_hash);
  return row;
}
function configuration(contents: readonly DatabaseRow[], contentId: string, mapping: AdministrationSourceMapping,
  week: number, dependencies: ExactMatchupCompatibilityDependencies): ExactMatchupCompatibilityEvidence['acceptedConfiguration'] {
  const row = contentRow(contents, contentId, 'league', mapping, week);
  if (row.configuration_league_season_id !== mapping.leagueSeasonId
    || row.configuration_dialect !== 'sleeper-nfl-v1'
    || row.configuration_normalizer_version !== 'sleeper-administration-v1') {
    throw new Error('Wrong immutable configuration version.');
  }
  return { contentId, contentHash: text(row.content_hash), leagueSeasonId: mapping.leagueSeasonId,
    provider: text(row.provider), externalLeagueId: text(row.external_league_id),
    configurationVersionId: id(row.configuration_version_id), scoringProfileId: id(row.scoring_profile_id),
    payload: row.payload as JsonValue,
    periodMapping: dependencies.readNativePeriodMapping(row.calendar_evidence, mapping, contentId, object(row.payload), week) };
}
function immutableEvidence(row: DatabaseRow, input: ExactMatchupCompatibilityReadInput,
  accepted: Extract<AcceptedExactMatchupsRead, { status: 'available' }>,
  history: Extract<SnapshotSourceHistoryRead, { status: 'available' }>,
  dependencies: ExactMatchupCompatibilityDependencies): ExactMatchupCompatibilityEvidence {
  const contents = rows(row.contents);
  // At most four captured inputs plus the current acceptance's configuration.
  if (contents.length > 5) throw new Error('Unbounded compatibility content set.');
  const profile = object(row.profile);
  const rules = object(profile.rules);
  if (Object.values(rules).some(value => typeof value !== 'number' || !Number.isFinite(value))) {
    throw new Error('Invalid immutable scoring rules.');
  }
  const calculation = (source: typeof history.original.source, leagueWeekObservationId: string) => {
    if (source.status !== 'linked') throw new Error('Unlinked immutable source.');
    const matchup = contentRow(contents, source.matchupInput.contentId, 'matchups', source.mapping, input.request.week);
    return { leagueWeekObservationId, matchupContentId: id(matchup.id), matchupContentHash: text(matchup.content_hash),
      matchupPayload: matchup.payload as JsonValue,
      configuration: configuration(contents, source.leagueInput.contentId, source.mapping, input.request.week, dependencies) };
  };

  return {
    profile: { id: id(profile.id), rulesHash: text(profile.rulesHash), rules: rules as Readonly<Record<string, number>> },
    acceptedConfiguration: configuration(contents, accepted.receipt.configurationContentId, input.expectedMapping, input.request.week, dependencies),
    original: calculation(history.original.source, history.original.leagueWeekObservationId),
    verification: history.verification.source && history.verification.leagueWeekObservationId
      ? calculation(history.verification.source, history.verification.leagueWeekObservationId) : null,
    games: gameEvidence(row.games),
  };
}

function gameEvidence(value: unknown): ExactMatchupCompatibilityEvidence['games'] {
  try {
    const games = object(value);
    if (!Array.isArray(games.expectedGameIds)) throw new Error('Missing original game set.');
    return { leagueWeekObservationId: id(games.leagueWeekObservationId), expectedGameCount: integer(games.expectedGameCount),
      expectedGameIds: games.expectedGameIds.map(id), observations: rows(games.observations).map(game => ({
        id: id(game.id), nflGameId: id(game.nflGameId), provider: text(game.provider), season: integer(game.season),
        seasonType: text(game.seasonType), week: integer(game.week), observedAt: timestamp(game.observedAt),
        requestStartedAt: timestamp(game.requestStartedAt), requestCompletedAt: timestamp(game.requestCompletedAt),
        homeTeam: text(game.homeTeam), awayTeam: text(game.awayTeam),
      })) };
  } catch { return null; }
}

/** Internal read only: a single statement binds both mutable heads to the same database snapshot. */
export function createExactMatchupCompatibilityReader(client: DatabaseClient, dependencies: ExactMatchupCompatibilityDependencies) {
  return {
    async readExactMatchupCompatibility(input: ExactMatchupCompatibilityReadInput) {
      let accepted: AcceptedExactMatchupsRead = { status: 'unavailable', reason: 'invalid_request' };
      let snapshot: StoredProjectionSnapshot | null = null;
      let sourceHistory: SnapshotSourceHistoryRead = { status: 'unavailable', reason: 'invalid_request' };
      let evidence: ExactMatchupCompatibilityEvidence | null = null;
      const finish = () => joinAcceptedExactMatchupDerived({ ...input, accepted, snapshot, sourceHistory, immutableEvidence: evidence });
      try {
        const { request, expectedMapping: mapping } = input;
        if (!isAdministrationSourceMapping(mapping) || mapping.leagueSeasonId !== request.leagueSeasonId
          || mapping.scope.season !== request.season || !Number.isSafeInteger(request.season)
          || request.season < 1920 || request.season > 2200) return finish();
        id(request.snapshotId); id(request.leagueSeasonId); text(request.modelVersion);
        const scope = exactMatchupsScope(mapping, request.week);
        const result = await client.query(`/* projection-store:read-exact-matchup-compatibility */${compatibilitySql(dependencies.acceptedSql)}`,
          [JSON.stringify({ scope, policy: EXACT_MATCHUPS_POLICY }), mapping.revisionId, mapping.generation, request.week,
            request.snapshotId, request.leagueSeasonId, request.season, request.week, request.modelVersion, mapping.connectionId]);
        if (result.length !== 1) throw new Error('Ambiguous compatibility read.');
        const row = result[0];
        accepted = dependencies.readAcceptedRows(rows(row.accepted_rows), mapping, request.week);
        // Derived validation is isolated so malformed or absent derived evidence never hides official facts.
        sourceHistory = { status: 'unavailable', reason: 'source_history_unavailable' };
        try {
          const historyRows = rows(row.history_rows);
          if (historyRows.length === 0) sourceHistory = { status: 'missing' };
          else if (historyRows.length === 1) sourceHistory = readSnapshotSourceHistoryRow(historyRows[0], request);
          else throw new Error('Ambiguous snapshot source history.');
          const snapshotRows = rows(row.snapshot_rows);
          if (snapshotRows.length > 1) throw new Error('Ambiguous stored snapshot.');
          if (snapshotRows.length === 1 && snapshotRows[0].is_current === true) snapshot = snapshotFromRow(snapshotRows[0]);
          if (accepted.status === 'available' && sourceHistory.status === 'available') {
            evidence = immutableEvidence(row, input, accepted, sourceHistory, dependencies);
          }
        } catch { evidence = null; }
      } catch {
        sourceHistory = { status: 'unavailable', reason: 'source_history_unavailable' };
      }
      return finish();
    },
  };
}
