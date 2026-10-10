import 'server-only';
import type { DatabaseClient, DatabaseRow } from '../../database';
import { PUBLIC_PERIOD_INVENTORY, type PublicPeriodInventoryPage } from '../public-intake-contracts';
import { normalizeAdministrationObservation } from '../normalize';
import { ADMINISTRATION_SCHEMA_VERSION, ADMINISTRATION_NORMALIZER_VERSION, ADMINISTRATION_DIALECT, type JsonValue } from '../contracts';
import { parsePublicCaptureWitness } from '../public-capture-witness';

const fields = ['leg', 'last_scored_leg', 'start_week', 'playoff_week_start'] as const;
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const key = (row: DatabaseRow) => String(row.season) + ':' + String(row.external_league_id);
const timestamp = (value: unknown) => {
  const result = value instanceof Date ? value.toISOString() : typeof value === 'string' ? value : '';
  if (!Number.isFinite(Date.parse(result))) throw new Error('Invalid period inventory capture timestamp.');
  return new Date(result).toISOString();
};

/** One bounded metadata read; rich typed resource verification remains in the existing reader. */
export async function readPublicPeriodTaskRows(client: DatabaseClient, requestId: string, inventory = false) {
  const rows = await client.query(`/* public-data-intake:read-exact-periods */
    SELECT task.ordinal,task.season,task.external_league_id,task.native_week,task.status,task.failure_count,task.reason,
      checkpoint.worker_id,checkpoint.generation,checkpoint.league_season_id,checkpoint.source_mapping,
      checkpoint.settings_receipt_id,checkpoint.matchups_receipt_id,checkpoint.recorded_at,
      settings.content_id AS configuration_content_id,settings.provenance AS settings_provenance
    FROM public.public_data_exact_period_tasks task
    LEFT JOIN public.public_data_exact_period_checkpoints checkpoint
      ON checkpoint.intake_id=task.intake_id AND checkpoint.task_ordinal=task.ordinal
    LEFT JOIN public.league_roster_capture_receipts settings ON settings.id=checkpoint.settings_receipt_id
    WHERE task.intake_id=$1::uuid ORDER BY task.ordinal LIMIT ${inventory ? 361 : 21}`, [requestId]);
  if (rows.length > (inventory ? 360 : 20)) throw new Error('Stored exact-period capacity exceeded.');
  return rows;
}

function sourceReferences(row: DatabaseRow, requestId: string) {
  const native = row.native_fields;
  if (!object(native) || typeof native.settingsPresent !== 'boolean'
    || Object.keys(native).sort().join('|') !== (native.settingsPresent ? 'settings|settingsPresent' : 'settingsPresent')
    || object(native.settings) && Object.keys(native.settings).some(field => !fields.includes(field as typeof fields[number]))) {
    throw new Error('Invalid stored native-period source fields.');
  }
  const startedAt = timestamp(row.request_started_at), completedAt = timestamp(row.request_completed_at);
  if (Date.parse(startedAt) > Date.parse(completedAt)) throw new Error('Invalid period inventory capture interval.');
  const acquisition = parsePublicCaptureWitness(row.acquisition);
  if (acquisition.work.requestId !== requestId || acquisition.work.kind !== row.source_kind
    || !('season' in acquisition.work) || acquisition.work.season !== row.season
    || acquisition.fence.workerId !== row.worker_id || acquisition.fence.generation !== Number(row.generation)
    || 'externalLeagueId' in acquisition.work && acquisition.work.externalLeagueId !== row.external_league_id) {
    throw new Error('Invalid period inventory capture binding.');
  }
  // Reuse the sole typed settings normalizer on the retained field projection.
  // This creates no observation, historical settings claim, or source availability.
  const normalized = normalizeAdministrationObservation({ schemaVersion: ADMINISTRATION_SCHEMA_VERSION,
    normalizerVersion: ADMINISTRATION_NORMALIZER_VERSION, dialect: ADMINISTRATION_DIALECT,
    scope: { provider: 'sleeper', leagueKey: 'sleeper-' + row.external_league_id,
      externalLeagueId: String(row.external_league_id), season: 2026 }, family: 'league', week: null, completeness: 'complete',
    provenance: { origin: 'network', requestStartedAt: startedAt, requestCompletedAt: completedAt,
      sourceObservedAt: completedAt, checkedAt: completedAt },
    payload: { league_id: String(row.external_league_id), season: '2026', sport: 'nfl',
      ...(native.settingsPresent ? { settings: native.settings as JsonValue } : {}) } });
  const value = normalized.leagueSettings?.value;
  if (!value) throw new Error('Invalid period inventory field projection.');
  const references = [...value.periods, value.competition.startPeriod, value.competition.playoffStartPeriod].map(field => {
    const nativeValue = field.value && typeof field.value === 'object' && 'source' in field.value
      ? Number((field.value as { source: { nativeId: string } }).source.nativeId) : field.value;
    const raw = 'raw' in field ? field.raw : undefined;
    return { sourcePath: field.sourcePath, state: field.state, value: nativeValue,
      ...(raw === undefined ? {} : JSON.stringify(raw).length <= 1024 ? { raw } : { rawRetained: true }) };
  });
  return { provider: 'sleeper' as const, season: 2026, externalLeagueId: String(row.external_league_id),
    sourceKind: row.source_kind as 'leagues' | 'bootstrap', sourceOrdinal: Number(row.source_ordinal), workerId: String(row.worker_id), generation: Number(row.generation),
    requestStartedAt: startedAt, requestCompletedAt: completedAt, acquisition, references };
}

export async function readPublicPeriodInventory(client: DatabaseClient, requestId: string,
  candidates: readonly DatabaseRow[], lists: readonly DatabaseRow[], page: PublicPeriodInventoryPage = {}, terminal = false) {
  const afterOrdinal = page.afterOrdinal ?? 0, limit = page.limit ?? 20;
  if (!Number.isInteger(afterOrdinal) || afterOrdinal < 0 || afterOrdinal > 360
    || !Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('Invalid native-period inventory page.');
  const plans = await client.query(`/* public-data-intake:read-period-inventory-plans */
    SELECT season,external_league_id,policy,admitted,worker_id,generation
    FROM public.public_data_period_inventory_plans WHERE intake_id=$1::uuid ORDER BY season,external_league_id LIMIT 1001`, [requestId]);
  const evidence = await client.query(`/* public-data-intake:read-period-inventory-list-evidence */
    SELECT list.season,list.request_started_at,list.request_completed_at,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('sourceOrdinal',entry.ordinal,'externalLeagueId',entry.raw->>'league_id') ORDER BY entry.ordinal)
        FROM jsonb_array_elements(list.payload) WITH ORDINALITY entry(raw,ordinal)),'[]'::jsonb) AS members,
      COALESCE((SELECT jsonb_agg(candidate.external_league_id ORDER BY candidate.external_league_id)
        FROM public.public_data_league_candidates candidate WHERE candidate.intake_id=list.intake_id
          AND candidate.season=list.season AND candidate.bootstrap_payload IS NOT NULL),'[]'::jsonb) AS bootstraps
    FROM public.public_data_league_lists list WHERE list.intake_id=$1::uuid`, [requestId]);
  const sourceRows = await client.query(`/* public-data-intake:read-period-inventory-sources */
    SELECT source.season,source.external_league_id,source.source_kind,source.source_ordinal,source.native_fields,
      source.worker_id,source.generation,source.request_started_at,source.request_completed_at,source.acquisition,
      (raw.value->>'league_id'=source.external_league_id
        AND source.request_started_at IS NOT DISTINCT FROM CASE WHEN source.source_kind='leagues' THEN list.request_started_at ELSE candidate.bootstrap_started_at END
        AND source.request_completed_at IS NOT DISTINCT FROM CASE WHEN source.source_kind='leagues' THEN list.request_completed_at ELSE candidate.bootstrap_completed_at END
        AND source.acquisition IS NOT DISTINCT FROM outcome.capture_acquisition
        AND source.native_fields IS NOT DISTINCT FROM CASE WHEN NOT(raw.value ? 'settings') THEN jsonb_build_object('settingsPresent',false)
          ELSE jsonb_build_object('settingsPresent',true,'settings',CASE WHEN jsonb_typeof(raw.value->'settings')='object'
            THEN (SELECT COALESCE(jsonb_object_agg(field.key,field.value),'{}'::jsonb) FROM jsonb_each(raw.value->'settings') field
              WHERE field.key IN ('leg','last_scored_leg','start_week','playoff_week_start'))
            ELSE raw.value->'settings' END) END) AS source_evidence_equal
    FROM public.public_data_period_inventory_sources source
    LEFT JOIN public.public_data_league_lists list ON list.intake_id=source.intake_id AND list.season=source.season
    LEFT JOIN public.public_data_league_candidates candidate ON candidate.intake_id=source.intake_id
      AND candidate.season=source.season AND candidate.external_league_id=source.external_league_id
    LEFT JOIN public.public_data_dispatch_outcomes outcome ON outcome.worker_id=source.worker_id AND outcome.generation=source.generation
      AND outcome.outcome='checkpoint-committed'
    CROSS JOIN LATERAL (SELECT CASE WHEN source.source_kind='leagues' THEN list.payload->(source.source_ordinal-1)
      ELSE candidate.bootstrap_payload END AS value) raw
    WHERE source.intake_id=$1::uuid
    ORDER BY source.season,source.external_league_id,source.source_kind,source.source_ordinal LIMIT 1021`, [requestId]);
  const rows = await readPublicPeriodTaskRows(client, requestId, true);
  if (lists.length > 1 || lists.length === 1 && lists[0].season !== 2026
    || new Set(candidates.map(key)).size !== candidates.length) throw new Error('Invalid stored period inventory discovery keys.');
  const discovered = lists.length === 1;
  if (evidence.length !== lists.length || evidence.some(row => row.season !== 2026 || !Array.isArray(row.members)
    || row.members.length > 1000 || timestamp(row.request_started_at) !== timestamp(lists[0].request_started_at)
    || timestamp(row.request_completed_at) !== timestamp(lists[0].request_completed_at))) throw new Error('Invalid stored inventory list evidence.');
  const expectedBootstraps = evidence[0]?.bootstraps ?? [];
  if (!Array.isArray(expectedBootstraps) || expectedBootstraps.length > 20
    || new Set(expectedBootstraps).size !== expectedBootstraps.length
    || expectedBootstraps.some(native => typeof native !== 'string' || !/^[1-9][0-9]{0,31}$/u.test(native))) {
    throw new Error('Invalid stored inventory bootstrap manifest.');
  }
  const expectedSources = (evidence[0]?.members ?? []) as readonly { sourceOrdinal: number; externalLeagueId: string }[];
  if (expectedSources.some((member, index) => !object(member) || member.sourceOrdinal !== index + 1
    || typeof member.externalLeagueId !== 'string' || !/^[1-9][0-9]{0,31}$/u.test(member.externalLeagueId))) {
    throw new Error('Invalid stored inventory source manifest.');
  }
  if (candidates.length > 1000 || plans.length !== candidates.length || plans.length > 1000 || sourceRows.length > 1020
    || !discovered && (plans.length > 0 || rows.length > 0 || sourceRows.length > 0)) throw new Error('Invalid stored period inventory discovery.');
  const planKeys = new Set<string>(); let admitted = 0;
  for (const plan of plans) {
    if (plan.season !== 2026 || !/^[1-9][0-9]{0,31}$/u.test(String(plan.external_league_id))
      || plan.policy !== PUBLIC_PERIOD_INVENTORY || typeof plan.admitted !== 'boolean' || planKeys.has(key(plan))
      || !candidates.some(candidate => key(candidate) === key(plan))) {
      throw new Error('Invalid stored period inventory plan.');
    }
    planKeys.add(key(plan)); if (plan.admitted) admitted++;
  }
  const admittedPlans = plans.filter(plan => plan.admitted);
  if (admitted > 20 || admitted !== Math.min(plans.length, 20)) throw new Error('Invalid stored period admission count.');
  if (rows.length !== admitted * 18) throw new Error('Incomplete stored period inventory task matrix.');
  const tasks = rows.map((row, index) => {
    const plan = admittedPlans[Math.floor(index / 18)], nativeWeek = index % 18 + 1;
    if (row.ordinal !== index + 1 || key(row) !== key(plan) || row.native_week !== nativeWeek
      || !['pending', 'complete', 'unavailable'].includes(String(row.status))
      || !Number.isInteger(row.failure_count) || Number(row.failure_count) < 0 || Number(row.failure_count) > 5
      || row.status === 'pending' && Number(row.failure_count) >= 5
      || (row.status === 'unavailable') !== (row.reason !== null)
      || row.reason !== null && (typeof row.reason !== 'string' || !row.reason.trim())
      || row.status === 'complete' && (!row.settings_receipt_id || !row.matchups_receipt_id || !row.configuration_content_id
        || !row.source_mapping || !row.league_season_id || !row.worker_id || !row.generation || !row.recorded_at)
      || row.status !== 'complete' && row.matchups_receipt_id != null) throw new Error('Invalid stored period inventory task.');
    return { provider: 'sleeper' as const, season: 2026, externalLeagueId: String(row.external_league_id), nativeWeek,
      ordinal: index + 1, collection: String(row.status), failureCount: Number(row.failure_count), reason: row.reason,
      phase: { status: 'unknown' as const, reason: 'native-period-phase-not-evidenced' as const } };
  });
  const sourceKeys = new Set<string>(); const discoveryOrdinals = new Set<number>();
  const sources = sourceRows.map(row => {
    const plan = plans.find(candidate => key(candidate) === key(row)), sourceKey = key(row) + ':' + row.source_kind + ':' + row.source_ordinal;
    if (row.source_evidence_equal !== true || !plan || sourceKeys.has(sourceKey) || !['leagues', 'bootstrap'].includes(String(row.source_kind))
      || !Number.isInteger(row.source_ordinal) || Number(row.source_ordinal) < 1 || Number(row.source_ordinal) > 1000
      || row.source_kind === 'bootstrap' && row.source_ordinal !== 1
      || row.source_kind === 'leagues' && discoveryOrdinals.has(Number(row.source_ordinal))
      || row.source_kind === 'bootstrap' && (!plan.admitted || !expectedBootstraps.includes(row.external_league_id))
      || row.source_kind === 'leagues' && (plan.worker_id !== row.worker_id || Number(plan.generation) !== Number(row.generation))) {
      throw new Error('Invalid stored period inventory source.');
    }
    sourceKeys.add(sourceKey); if (row.source_kind === 'leagues') discoveryOrdinals.add(Number(row.source_ordinal));
    return sourceReferences(row, requestId);
  });
  if (plans.some(plan => !sourceRows.some(row => row.source_kind === 'leagues' && key(row) === key(plan)))
    || discoveryOrdinals.size !== expectedSources.length
    || expectedSources.some(member => !sourceKeys.has('2026:' + member.externalLeagueId + ':leagues:' + member.sourceOrdinal))
    || expectedBootstraps.some(native => !sourceKeys.has('2026:' + native + ':bootstrap:1'))) throw new Error('Missing stored period inventory source.');
  const gaps = sources.flatMap(source => source.references.flatMap(reference =>
    reference.state === 'known' && typeof reference.value === 'number' && reference.value > 18
      ? [{ externalLeagueId: source.externalLeagueId, season: 2026, sourceKind: source.sourceKind, sourceOrdinal: source.sourceOrdinal,
        sourcePath: reference.sourcePath, nativePeriod: reference.value, reason: 'native-period-outside-supported-range' as const }] : []));
  const pendingPeriods = tasks.filter(task => task.collection === 'pending').length;
  const completePeriods = tasks.filter(task => task.collection === 'complete').length;
  const unavailablePeriods = tasks.filter(task => task.collection === 'unavailable').length;
  const capacityLeagues = plans.length - admitted;
  const coverage = !discovered ? terminal ? 'limited' as const : 'pending' as const : capacityLeagues || gaps.length ? 'limited' as const : 'complete' as const;
  const collection = !discovered ? terminal ? 'unavailable' as const : 'pending' as const : pendingPeriods ? 'pending' as const
    : !capacityLeagues && !gaps.length && !unavailablePeriods ? 'complete' as const
      : completePeriods || capacityLeagues || gaps.length ? 'partial' as const : 'unavailable' as const;
  const selectedRows = rows.filter(row => Number(row.ordinal) > afterOrdinal).slice(0, limit);
  const lastOrdinal = Number(selectedRows.at(-1)?.ordinal ?? afterOrdinal);
  const nextAfterOrdinal = rows.some(row => Number(row.ordinal) > lastOrdinal) ? lastOrdinal : null;
  const readCoverage = selectedRows.length === rows.length ? 'complete' as const : 'page' as const;
  return { selectedRows, inventory: { policy: PUBLIC_PERIOD_INVENTORY, discovery: discovered ? 'complete' as const : terminal ? 'unavailable' as const : 'pending' as const,
    coverage, collection, readCoverage, summary: { observedLeagues: plans.length, admittedLeagues: admitted, capacityLeagues,
      requestedPeriods: plans.length * 18, admittedPeriods: rows.length, capacityPeriods: capacityLeagues * 18,
      pendingPeriods, completePeriods, unavailablePeriods }, tasks, sources, gaps,
    page: { afterOrdinal, limit, nextAfterOrdinal },
    meaning: 'Weeks 1–18 are requested coverage, not discovered source availability. Collection counts retained checkpoints; page resources verify current acceptance. Native references do not establish phase or historical settings.' } };
}
