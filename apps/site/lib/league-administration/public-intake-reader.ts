import 'server-only';
import type { DatabaseClient, DatabaseRow } from '../database';
import { normalizePublicExactPeriods, type PublicExactPeriod } from './public-intake-contracts';
import type { LeagueAdministrationStore } from './store-contracts';
import { isAdministrationSourceMapping } from './source-mapping';
import { compatibleRevision } from '../projections/shared/revision-compatibility';

function receiptBound<T extends { status: string }>(resource: T, expected: unknown) {
  const accepted = 'accepted' in resource ? resource.accepted as { observationIds?: readonly string[] } : undefined;
  return resource.status !== 'available' ? resource : typeof expected === 'string' && accepted?.observationIds?.includes(expected)
    ? resource : { status: 'unavailable' as const, reason: 'intake-capture-not-current-head', retained: resource };
}

async function readExactPeriods(client: DatabaseClient, administration: LeagueAdministrationStore, requestId: string,
  selection: readonly PublicExactPeriod[], candidates: readonly DatabaseRow[]) {
  const rows = await client.query(`/* public-data-intake:read-exact-periods */
    SELECT task.ordinal,task.season,task.external_league_id,task.native_week,task.status,task.failure_count,task.reason,
      checkpoint.worker_id,checkpoint.generation,checkpoint.league_season_id,checkpoint.source_mapping,
      checkpoint.settings_receipt_id,checkpoint.matchups_receipt_id,checkpoint.recorded_at,
      settings.content_id AS configuration_content_id,settings.provenance AS settings_provenance
    FROM public.public_data_exact_period_tasks task
    LEFT JOIN public.public_data_exact_period_checkpoints checkpoint
      ON checkpoint.intake_id=task.intake_id AND checkpoint.task_ordinal=task.ordinal
    LEFT JOIN public.league_roster_capture_receipts settings ON settings.id=checkpoint.settings_receipt_id
    WHERE task.intake_id=$1::uuid ORDER BY task.ordinal LIMIT 21`, [requestId]);
  if (rows.length > 20) throw new Error('Stored exact-period capacity exceeded.');
  const identities = new Set<string>(); const ordinals = new Set<number>();
  const periods = [];
  for (const row of rows) {
    const season = Number(row.season); const nativeWeek = Number(row.native_week); const ordinal = Number(row.ordinal);
    const identity = { provider: 'sleeper' as const, externalLeagueId: String(row.external_league_id), season, nativeWeek };
    const key = season + ':' + identity.externalLeagueId;
    if (!Number.isInteger(ordinal) || ordinal < 1 || ordinal > 20 || ordinals.has(ordinal) || identities.has(key)
      || !selection.some(period => period.season === season && period.nativeWeek === nativeWeek)
      || !candidates.some(candidate => candidate.season === season && candidate.external_league_id === identity.externalLeagueId)
      || !['pending', 'complete', 'unavailable'].includes(String(row.status))
      || !Number.isInteger(row.failure_count) || Number(row.failure_count) < 0 || Number(row.failure_count) > 5) {
      throw new Error('Invalid stored exact-period task.');
    }
    identities.add(key); ordinals.add(ordinal);
    const task = { ...identity, ordinal, collection: String(row.status), failureCount: Number(row.failure_count), reason: row.reason,
      phase: { status: 'unknown' as const, reason: 'native-period-phase-not-evidenced' as const } };
    if (row.status !== 'complete') {
      periods.push({ ...task, resource: { status: 'unavailable' as const, reason: 'period-capture-not-complete' }, acquisition: null });
      continue;
    }
    try {
      const mapping = await administration.readSourceMapping(identity.externalLeagueId);
      if (!mapping || mapping.scope.season !== season || mapping.scope.externalLeagueId !== identity.externalLeagueId
        || mapping.leagueSeasonId !== row.league_season_id || !isAdministrationSourceMapping(row.source_mapping)
        || compatibleRevision(mapping) !== compatibleRevision(row.source_mapping)
        || typeof row.settings_receipt_id !== 'string' || typeof row.matchups_receipt_id !== 'string'
        || typeof row.configuration_content_id !== 'string') throw new Error('Stored period mapping or checkpoint changed.');
      const exact = await administration.readAcceptedExactMatchups(mapping, nativeWeek);
      const resource = exact.status !== 'available' ? exact
        : exact.receipt.id === row.matchups_receipt_id && exact.receipt.configurationContentId === row.configuration_content_id
          ? exact : { status: 'unavailable' as const, reason: 'intake-capture-not-current-head', retained: exact };
      // The settings receipt is historical capture evidence. A later core refresh
      // need not leave that settings head current for this exact matchup to remain current.
      periods.push({ ...task, resource, acquisition: { sourceMapping: row.source_mapping, workerId: row.worker_id,
        generation: row.generation, settingsReceiptId: row.settings_receipt_id, matchupsReceiptId: row.matchups_receipt_id,
        configurationContentId: row.configuration_content_id, settingsProvenance: row.settings_provenance, recordedAt: row.recorded_at } });
    } catch {
      periods.push({ ...task, resource: { status: 'unavailable' as const, reason: 'stored-period-source-unavailable' }, acquisition: null });
    }
  }
  return periods;
}

/** Backend-only stored read. No provider call, registration, calculation or write.
 * Discovery membership is public source evidence, never an ownership entitlement. */
export async function readPublicSleeperIntake(client: DatabaseClient, administration: LeagueAdministrationStore, requestId: string,
  options: Readonly<{ managerEvidenceVersion?: 'v2' }> = {}) {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(requestId)) throw new Error('Invalid public intake identity.');
  const requests = await client.query(`/* public-data-intake:read-request */
    SELECT request.id,request.username AS requested_username,request.seasons,request.revision,request.terminal,
      to_jsonb(request)->'exact_periods' AS selected_exact_periods,
      request.failure_count,request.next_attempt_at,identity.source_manager_account_id,account.external_manager_id,
      identity.username,identity.display_name,identity.avatar_url,identity.request_started_at,identity.request_completed_at
    FROM public.public_data_intakes request
    LEFT JOIN public.public_data_identity_observations identity ON identity.intake_id=request.id
    LEFT JOIN public.league_source_manager_accounts account ON account.id=identity.source_manager_account_id AND account.provider='sleeper'
    WHERE request.id=$1::uuid`, [requestId]);
  if (requests.length !== 1) return { status: 'missing' } as const;
  const { selected_exact_periods: selectedPeriods, ...storedHeader } = requests[0];
  const selection = normalizePublicExactPeriods(selectedPeriods ?? undefined, Array.isArray(storedHeader.seasons) ? storedHeader.seasons : []);
  const header: DatabaseRow & { exactPeriods?: readonly PublicExactPeriod[] } = { ...storedHeader, ...(selection.length ? { exactPeriods: selection } : {}) };
  const lists = await client.query(`/* public-data-intake:read-lists */
    SELECT season,request_started_at,request_completed_at FROM public.public_data_league_lists WHERE intake_id=$1::uuid ORDER BY season`, [requestId]);
  const candidates = await client.query(`/* public-data-intake:read-candidates */
    SELECT candidate.season,candidate.external_league_id,candidate.name,candidate.stage,candidate.league_season_id,
      candidate.league_observation_id,candidate.roster_observation_id,candidate.users_observation_id,
      candidate.settings_receipt_id,candidate.players_receipt_id,candidate.managers_receipt_id,
      CASE WHEN capture.id IS NOT NULL THEN jsonb_build_object('id',capture.id,'contentId',capture.content_id,
        'legacyObservationId',capture.legacy_observation_id,'sourceMapping',capture.source_mapping,
        'requestStartedAt',capture.request_started_at,'requestCompletedAt',capture.request_completed_at,
        'sourceObservedAt',capture.source_observed_at) END AS directory_capture
    FROM public.public_data_league_candidates candidate
    LEFT JOIN public.public_data_directory_captures capture ON capture.id=candidate.users_capture_id
      AND capture.intake_id=candidate.intake_id AND capture.league_season_id=candidate.league_season_id
      AND capture.legacy_observation_id=candidate.users_observation_id
    WHERE candidate.intake_id=$1::uuid ORDER BY candidate.season,candidate.external_league_id`, [requestId]);
  const rejected = await client.query(`/* public-data-intake:read-rejections */
    SELECT revision,resource,source_scope,request_started_at,request_completed_at,reason
    FROM public.public_data_rejections WHERE intake_id=$1::uuid ORDER BY revision`, [requestId]);
  const leagues = [];
  // Sequential bounded reads: at most twenty collected candidates. Retained excess
  // list members remain explicit capacity entries without fan-out or silent filtering.
  for (const candidate of candidates) {
    const identity = { provider: 'sleeper' as const, externalLeagueId: String(candidate.external_league_id), season: Number(candidate.season) };
    if (!candidate.league_season_id) {
      leagues.push({ ...identity, name: String(candidate.name), collection: String(candidate.stage), resources: null });
      continue;
    }
    try {
      const mapping = await administration.readSourceMapping(identity.externalLeagueId);
      if (!mapping || mapping.leagueSeasonId !== candidate.league_season_id || mapping.scope.season !== identity.season) {
        throw new Error('Stored source mapping changed.');
      }
      const acquisition = candidate.directory_capture && typeof candidate.directory_capture === 'object'
        ? candidate.directory_capture as Record<string, unknown> : null;
      const directoryCurrent = acquisition && isAdministrationSourceMapping(acquisition.sourceMapping) && compatibleRevision(acquisition.sourceMapping) === compatibleRevision(mapping);
      const [settings, teamManagers, heldRoster, directory, teamManagerEvidence, capturedManagers] = await Promise.all([
        administration.readAcceptedLeagueSettings(mapping).catch(() => ({ status: 'unavailable' as const, reason: 'settings-read-failed' })),
        administration.readAcceptedTeamManagers(mapping).catch(() => ({ status: 'unavailable' as const, reason: 'team-managers-read-failed' })),
        administration.readAcceptedCurrentRoster(mapping, { includeSeasonOverview: true, includePlayerLinks: true }).catch(() => ({ status: 'unavailable' as const, reason: 'held-roster-read-failed' })),
        administration.readSource({ ...mapping.scope, family: 'users', week: null }).catch(() => ({ status: 'unavailable' as const, reason: 'directory-read-failed' })),
        options.managerEvidenceVersion === 'v2'
          ? administration.readAcceptedTeamManagerEvidence?.(mapping).catch(() => ({ status: 'unavailable' as const, reason: 'team-manager-evidence-read-failed' }))
            ?? { status: 'unavailable' as const, reason: 'team-manager-evidence-unsupported' } : undefined,
        administration.readManagerDirectoryCapture
          ? directoryCurrent && typeof acquisition.id === 'string'
            ? administration.readManagerDirectoryCapture(mapping, acquisition.id)
              .catch(() => ({ status: 'unavailable' as const, reason: 'manager-directory-read-failed' }))
            : { status: 'unavailable' as const, reason: 'intake-directory-capture-unavailable' } : undefined,
      ]);
      const managerDirectory = capturedManagers?.status === 'available'
        ? capturedManagers.capture.id === acquisition?.id && capturedManagers.capture.intakeId === requestId
          && capturedManagers.capture.contentId === acquisition.contentId
          && capturedManagers.capture.legacyObservationId === candidate.users_observation_id
          && capturedManagers.leagueSeasonId === mapping.leagueSeasonId
          && compatibleRevision(capturedManagers.sourceMapping) === compatibleRevision(mapping)
          ? capturedManagers : { status: 'unavailable' as const, reason: 'intake-directory-capture-mismatch' }
        : capturedManagers;
      leagues.push({ ...identity, name: String(candidate.name), leagueSeasonId: mapping.leagueSeasonId,
        leagueKey: mapping.scope.leagueKey, collection: String(candidate.stage),
        resources: { settings: receiptBound(settings, candidate.settings_receipt_id),
          teamManagers: receiptBound(teamManagers, candidate.managers_receipt_id),
          // Latest scoped provider evidence may outlive a failed intake step. It is
          // explicitly not a receipt-bound completion claim for this request.
          ...(teamManagerEvidence ? { teamManagerEvidence: { ...teamManagerEvidence,
            captureBinding: 'latest-for-current-source-mapping' as const } } : {}),
          // Exact retained directory facts remain useful after a later users head.
          // Their availability never changes the existing intake completion rule.
          ...(managerDirectory ? { managerDirectory } : {}),
          heldRoster: receiptBound(heldRoster, candidate.players_receipt_id),
          directory: directory.status === 'available'
            ? directory.observationId !== candidate.users_observation_id || !directoryCurrent
              ? { status: 'unavailable' as const, reason: 'intake-capture-not-current-head', retained: directory }
              : { ...directory, acquisition } : directory } });
    } catch {
      leagues.push({ ...identity, name: String(candidate.name), collection: String(candidate.stage),
        resources: null, reason: 'stored-source-unavailable' });
    }
  }
  const exactPeriods = selection.length ? await readExactPeriods(client, administration, requestId, selection, candidates) : undefined;
  const completePeriods = !exactPeriods || exactPeriods.every(period => period.resource.status === 'available')
    && candidates.filter(candidate => candidate.stage !== 'capacity' && selection.some(period => period.season === candidate.season))
      .every(candidate => exactPeriods.some(period => period.season === candidate.season && period.externalLeagueId === candidate.external_league_id));
  const completeResources = leagues.every(league => league.collection === 'complete' && league.resources
    && league.resources.settings.status === 'available' && league.resources.teamManagers.status === 'available'
    && league.resources.heldRoster.status === 'available' && league.resources.directory.status === 'available');
  const allSeasons = Array.isArray(header.seasons) && lists.length === header.seasons.length;
  const status = !header.external_manager_id || !allSeasons ? header.terminal ? 'unavailable' : 'pending'
    : completeResources && completePeriods ? 'available' : header.terminal ? 'partial' : 'pending';
  return { status, readAt: new Date().toISOString(), request: header, lists, leagues, rejected,
    ...(exactPeriods ? { exactPeriods } : {}),
    freshness: 'Use each resource acceptance verifiedAt and each directory acquisition sourceObservedAt and list request_completed_at; this read does not refresh them.',
    coverage: { requested: ['identity', 'season-league-lists', 'league-settings', 'team-managers', 'held-rosters', 'manager-directory',
      ...(options.managerEvidenceVersion === 'v2' ? ['team-manager-evidence-v2'] : []), ...(selection.length ? ['exact-matchups'] : [])],
      notRequested: [...(selection.length ? [] : ['exact-matchups']), 'official-results', 'transactions', 'drafts', 'playoff-brackets', 'annual-history'],
      note: 'Provider standings fields are retained with the roster; no derived rank or calculation is produced.' } } as const;
}
