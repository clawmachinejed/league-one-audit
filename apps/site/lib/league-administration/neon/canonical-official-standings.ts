import 'server-only';
import type { DatabaseClient, DatabaseRow } from '../../database';
import { CURRENT_ROSTER_POLICY, currentRosterScope } from '../../aggregator/current-roster';
import { assertCanonicalSourceMapping, type CanonicalSourceMappingV1 } from '../canonical-source-contracts';
import { assertCanonicalAttempt, assertCanonicalCoverage, assertCanonicalDelivery, assertCanonicalDigest,
  assertCanonicalFence, assertCanonicalProvenance, assertCanonicalReasons, assertCanonicalSelection, assertCanonicalStandingsValue,
  canonicalCounter, canonicalEqual, canonicalKeys, canonicalObject, canonicalStandingsScope, canonicalUuid,
  canonicalText,
  CANONICAL_HASH_VERSION, CANONICAL_STANDINGS_OUTCOMES,
  type CanonicalNativeSourceRef, type CanonicalObservationWriteResult, type CanonicalOfficialStandingsRead,
  type CanonicalResourceAttempt, type CanonicalStandingsDelivery, type CanonicalStandingsOutcome,
  type CanonicalStandingsPolicy, type CanonicalStandingsSelection } from '../canonical-standings-contracts';
import { assertCanonicalPolicyShape, canonicalStandingsVersions, legacyStandingsMapping, resolveCanonicalStandingsPolicy,
  type CanonicalStandingsPolicyResolver } from '../canonical-standings-policy';
import type { AdministrationWriteFence } from '../contracts';
import { HISTORICAL_OFFICIAL_STANDINGS_SQL, officialStandingsMethods, readOfficialStandingsRows } from './official-standings';

const field = (name: string, column: string) => `jsonb_build_object('state',team.field_states->'${name}','value',team.${column})`;
const typedTeam = `jsonb_build_object('sourceTeam',jsonb_build_object('provider',team.provider,'resourceKind','team',
  'nativeNamespace',team.native_namespace,'nativeId',team.external_team_id),'sourceOrdinal',team.source_ordinal,
  'record',jsonb_build_object('wins',${field('wins', 'wins')},'losses',${field('losses', 'losses')},'ties',${field('ties', 'ties')}),
  'pointsFor',${field('pointsFor', 'points_for_value')},'pointsAgainst',${field('pointsAgainst', 'points_against_value')},
  'providerRank',${field('providerRank', 'rank')},'providerSeed',${field('providerSeed', 'seed')})`;

/** Current selects the latest reservation first. Historical selection binds its immutable revision, never today's pointer. */
export const CANONICAL_OFFICIAL_STANDINGS_SQL = `/* league-administration:read-canonical-official-standings */
  WITH selected AS (
    SELECT scope.id AS scope_id,attempt.id AS attempt_id,receipt.id AS receipt_id
    FROM public.league_roster_resource_scopes scope
    JOIN public.league_roster_resource_heads head ON head.scope_id=scope.id
    JOIN public.league_roster_resource_attempts attempt ON attempt.scope_id=scope.id
    JOIN public.league_source_connections connection ON connection.id=scope.connection_id
    LEFT JOIN public.league_canonical_resource_receipts receipt ON receipt.attempt_id=attempt.id
    WHERE scope.identity=$1::jsonb
      AND (($4::uuid IS NULL AND attempt.ordinal=head.latest_ordinal
        AND connection.current_mapping_revision_id=$2::uuid AND connection.mapping_generation=$3)
        OR ($4::uuid IS NOT NULL AND receipt.id=$4::uuid)) LIMIT 2
  )
  SELECT to_jsonb(scope.*) AS scope_row,to_jsonb(attempt.*) AS attempt_row,to_jsonb(head.*) AS head_row,
    to_jsonb(receipt.*) AS receipt_row,to_jsonb(content.*) AS content_row,to_jsonb(accepted.*) AS acceptance_row,
    to_jsonb(revision.*) AS revision_row,to_jsonb(first_receipt.*) AS first_receipt_row,
    jsonb_build_object('schemaVersion',content.canonical_schema_version,'status',content.canonical_value->'status',
      'reasons',content.canonical_value->'reasons','teams',
      (SELECT COALESCE(jsonb_agg(${typedTeam} ORDER BY team.source_ordinal),'[]'::jsonb)
       FROM public.league_canonical_standings_teams team WHERE team.content_id=content.id)) AS typed_value,
    (SELECT COALESCE(jsonb_agg(jsonb_build_object('sourceTeam',jsonb_build_object('provider',team.provider,'resourceKind','team',
        'nativeNamespace',team.native_namespace,'nativeId',team.external_team_id),'seasonTeamId',team.season_team_id,
        'contentId',team.content_id,'leagueSeasonId',team.league_season_id,'sourceLeagueNamespace',team.source_league_namespace,
        'externalLeagueId',team.external_league_id,'identity',to_jsonb(identity.*)) ORDER BY team.source_ordinal),'[]'::jsonb)
      FROM public.league_canonical_standings_teams team
      JOIN public.league_season_teams identity ON identity.id=team.season_team_id WHERE team.content_id=content.id) AS identities,
    content.native_hash='sha256:'||encode(sha256(convert_to(jsonb_build_object('hashVersion',content.hash_version,
      'representation','native','nativeKind',content.native_kind,'adapterVersion',content.adapter_version,
      'nativePayload',content.native_payload)::text,'UTF8')),'hex') AS native_hash_matches,
    content.canonical_hash='sha256:'||encode(sha256(convert_to(jsonb_build_object('hashVersion',content.hash_version,
      'representation','canonical','canonicalSchemaVersion',content.canonical_schema_version,
      'canonicalValue',content.canonical_value)::text,'UTF8')),'hex') AS canonical_hash_matches,
    receipt.evidence_hash='sha256:'||encode(sha256(convert_to(jsonb_build_object(
      'hashVersion','league-one-jsonb-sha256-v1','representation','receipt',
      'attempt',jsonb_build_object('id',attempt.id,'scopeId',attempt.scope_id,'ordinal',attempt.ordinal,
        'expectedGeneration',attempt.expected_generation,'nonce',attempt.capture_nonce),
      'reservedAt',to_char(attempt.reserved_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'fence',attempt.write_fence,'canonicalReservationContext',attempt.canonical_reservation_context,
      'mapping',receipt.source_mapping,'scope',scope.identity->'scope','policy',scope.identity->'policy',
      'content',jsonb_build_object('id',content.id,'nativeHash',content.native_hash,'canonicalHash',content.canonical_hash,
        'nativeKind',content.native_kind,'canonicalSchemaVersion',content.canonical_schema_version,'adapterVersion',content.adapter_version,
        'nativeVerifierVersion',content.native_verifier_version,'canonicalNormalizerVersion',content.canonical_normalizer_version,'hashVersion',content.hash_version),
      'provenance',receipt.provenance,'nativeSourceRef',receipt.native_source_ref,'legacyRosterReceiptId',receipt.legacy_roster_receipt_id,
      'legacyEvidenceHash',native.evidence_hash,'populationEvidence',receipt.population_evidence,'coverage',receipt.coverage,
      'expectedTeamCount',receipt.expected_team_count,'population',receipt.population,'recordCompleteness',receipt.record_completeness,
      'qualification',receipt.qualification,'outcome',receipt.outcome,'reasons',receipt.reasons)::text,'UTF8')),'hex') AS evidence_hash_matches,
    attempt.reserved_at<=native_attempt.reserved_at AS bridge_reservation_precedes_native,
    CASE WHEN native.id IS NOT NULL THEN jsonb_build_object('id',native.id,'attemptId',native.attempt_id,
      'contentId',native.content_id,'provenance',public.roster_capture_provenance(native),
      'payload',native_content.payload,'mapping',native_attempt.source_mapping,'fence',native_attempt.write_fence,
      'nonce',native_attempt.capture_nonce,'reservedAt',native_attempt.reserved_at) END AS legacy_bridge
  FROM selected
  JOIN public.league_roster_resource_scopes scope ON scope.id=selected.scope_id
  JOIN public.league_roster_resource_heads head ON head.scope_id=scope.id
  JOIN public.league_roster_resource_attempts attempt ON attempt.id=selected.attempt_id
  LEFT JOIN public.league_canonical_resource_receipts receipt ON receipt.id=selected.receipt_id
  LEFT JOIN public.league_canonical_resource_contents content ON content.id=receipt.content_id
  LEFT JOIN public.league_roster_resource_acceptances accepted ON accepted.canonical_receipt_id=receipt.id
  LEFT JOIN public.league_source_mapping_revisions revision ON revision.id=(attempt.source_mapping->>'revisionId')::uuid
  LEFT JOIN public.league_canonical_resource_receipts first_receipt ON first_receipt.id=content.first_receipt_id
  LEFT JOIN public.league_roster_capture_receipts native ON native.id=receipt.legacy_roster_receipt_id
  LEFT JOIN public.league_roster_resource_attempts native_attempt ON native_attempt.id=native.attempt_id
  LEFT JOIN public.league_administration_contents native_content ON native_content.id=native.content_id`;

function unavailable(selection: CanonicalStandingsSelection, reason: string, attemptId: string | null = null,
  receiptId: string | null = null, status: 'missing' | 'unavailable' = 'unavailable'): CanonicalOfficialStandingsRead {
  return { status, representation: selection.representation, reason, attemptId, receiptId };
}
function storedCounter(value: unknown, minimum = 0): number {
  if (typeof value === 'string' && /^(?:0|[1-9][0-9]*)$/u.test(value)) return canonicalCounter(Number(value), minimum);
  return canonicalCounter(value, minimum);
}
function policyFor(mapping: CanonicalSourceMappingV1, policy: unknown, resolver: CanonicalStandingsPolicyResolver) {
  assertCanonicalSourceMapping(mapping); assertCanonicalPolicyShape(policy);
  return resolver(mapping, policy);
}

/** Canonical structural/relational readback only. Native interpretation remains in the registered writer verifier. */
export function readCanonicalOfficialStandingsRows(rows: readonly DatabaseRow[], mapping: CanonicalSourceMappingV1,
  selection: CanonicalStandingsSelection, resolver: CanonicalStandingsPolicyResolver = resolveCanonicalStandingsPolicy): CanonicalOfficialStandingsRead {
  assertCanonicalSelection(selection);
  let attemptId: string | null = null, receiptId: string | null = null;
  try {
    assertCanonicalSourceMapping(mapping); assertCanonicalSelection(selection);
    if (selection.representation !== 'canonical-v1') throw new Error('Wrong canonical reader representation.');
    if (!rows.length) return unavailable(selection, 'attempt-missing', null, null, 'missing');
    if (rows.length !== 1 || Buffer.byteLength(JSON.stringify(rows), 'utf8') > 32 * 1024 * 1024) throw new Error('Invalid canonical read bounds.');
    const row = rows[0], scope = canonicalObject(row.scope_row), identity = canonicalObject(scope.identity);
    const attempt = canonicalObject(row.attempt_row), head = canonicalObject(row.head_row), revision = canonicalObject(row.revision_row);
    const policy = policyFor(mapping, identity.policy, resolver), expectedScope = canonicalStandingsScope(mapping);
    canonicalKeys(identity, ['scope', 'policy']);
    attemptId = canonicalUuid(attempt.id);
    const scopeId = canonicalUuid(scope.id), ordinal = storedCounter(attempt.ordinal, 1), expectedGeneration = storedCounter(attempt.expected_generation);
    const reservation = { id: attemptId, scopeId, ordinal, expectedGeneration, nonce: canonicalUuid(attempt.capture_nonce) };
    assertCanonicalAttempt(reservation); assertCanonicalFence(attempt.write_fence);
    if (!canonicalEqual(identity.scope, expectedScope) || !canonicalEqual(attempt.source_mapping, mapping)
      || attempt.scope_id !== scopeId || scope.connection_id !== mapping.connectionId || scope.league_season_id !== mapping.leagueSeasonId
      || revision.id !== mapping.revisionId || revision.connection_id !== mapping.connectionId || revision.league_season_id !== mapping.leagueSeasonId
      || storedCounter(revision.generation, 1) !== mapping.generation || revision.provider !== mapping.scope.provider
      || revision.native_namespace !== mapping.scope.nativeNamespace || revision.external_league_id !== mapping.scope.externalLeagueId
      || revision.source_namespace !== mapping.sourceNamespace || head.scope_id !== scopeId
      || selection.kind === 'current' && storedCounter(head.latest_ordinal) !== ordinal) throw new Error('Invalid canonical source lineage.');
    if (row.receipt_row === null) return unavailable(selection, 'pending', attemptId);
    const receipt = canonicalObject(row.receipt_row), content = canonicalObject(row.content_row), first = canonicalObject(row.first_receipt_row);
    receiptId = canonicalUuid(receipt.id);
    const contentId = canonicalUuid(content.id);
    if (selection.kind === 'receipt' && selection.receiptId !== receiptId || receipt.attempt_id !== attemptId || receipt.scope_id !== scopeId
      || receipt.connection_id !== mapping.connectionId || receipt.league_season_id !== mapping.leagueSeasonId || receipt.content_id !== contentId
      || !canonicalEqual(receipt.source_mapping, mapping) || content.connection_id !== mapping.connectionId || content.league_season_id !== mapping.leagueSeasonId
      || content.provider !== mapping.scope.provider || content.source_league_namespace !== mapping.scope.nativeNamespace
      || content.external_league_id !== mapping.scope.externalLeagueId || content.source_namespace !== mapping.sourceNamespace
      || content.family !== 'standings' || first.id !== canonicalUuid(content.first_receipt_id) || first.content_id !== contentId
      || first.connection_id !== mapping.connectionId || first.league_season_id !== mapping.leagueSeasonId
      || String(first.capture_transaction) !== String(content.capture_transaction)) throw new Error('Invalid canonical content closure.');
    for (const [column, key] of [['native_kind', 'nativeKind'], ['canonical_schema_version', 'canonicalSchemaVersion'],
      ['adapter_version', 'adapterVersion'], ['native_verifier_version', 'nativeVerifierVersion'],
      ['canonical_normalizer_version', 'canonicalNormalizerVersion'], ['hash_version', 'hashVersion']] as const) {
      if (content[column] !== policy[key]) throw new Error('Unknown canonical content version.');
    }
    assertCanonicalDigest(content.native_hash); assertCanonicalDigest(content.canonical_hash); assertCanonicalDigest(receipt.evidence_hash);
    if (receipt.evidence_version !== CANONICAL_HASH_VERSION || row.native_hash_matches !== true || row.canonical_hash_matches !== true
      || row.evidence_hash_matches !== true) throw new Error('Invalid canonical evidence hash.');
    assertCanonicalStandingsValue(content.canonical_value, mapping, policy);
    const facts = content.canonical_value;
    assertCanonicalCoverage(receipt.coverage, facts); assertCanonicalProvenance(receipt.provenance); assertCanonicalReasons(receipt.reasons, true);
    if (!canonicalEqual(row.typed_value, facts) || receipt.qualification !== facts.status
      || !CANONICAL_STANDINGS_OUTCOMES.includes(receipt.outcome as CanonicalStandingsOutcome)) throw new Error('Invalid canonical materialization.');
    const outcome = receipt.outcome as CanonicalStandingsOutcome;
    const sourceRef = canonicalObject(receipt.native_source_ref), provenance = receipt.provenance;
    let legacyRosterReceiptId: string | null = null;
    if (sourceRef.kind === 'sleeper-roster-bridge-v1') {
      canonicalKeys(sourceRef, ['kind', 'nativeAttemptId']); canonicalUuid(sourceRef.nativeAttemptId);
      legacyRosterReceiptId = canonicalUuid(receipt.legacy_roster_receipt_id);
      const native = canonicalObject(row.legacy_bridge), witness = canonicalObject(provenance.acquisition);
      const { captureId: _captureId, normalizedAt: _normalizedAt, sourceUpdatedAt, nativeRevision, ...nativeProvenance } = provenance;
      void _captureId; void _normalizedAt;
      if (policy.originPolicy !== 'network-bridge-v1' || provenance.origin !== 'network' || native.id !== legacyRosterReceiptId
        || native.attemptId !== sourceRef.nativeAttemptId || sourceUpdatedAt !== null || nativeRevision !== null
        || !canonicalEqual(native.payload, content.native_payload) || !canonicalEqual(native.provenance, nativeProvenance)
        || !canonicalEqual(native.mapping, legacyStandingsMapping(mapping)) || !canonicalEqual(witness.mapping, native.mapping)
        || !canonicalEqual(native.fence, attempt.write_fence) || !canonicalEqual(witness.fence, attempt.write_fence)
        || canonicalObject(canonicalObject(witness.attempts).players).id !== native.attemptId
        || canonicalObject(canonicalObject(witness.attempts).players).nonce !== native.nonce
        || row.bridge_reservation_precedes_native !== true
        || attempt.canonical_reservation_context !== null) throw new Error('Invalid retained canonical bridge.');
    } else if (sourceRef.kind === 'fixture-standalone-v1') {
      canonicalKeys(sourceRef, ['kind', 'fixtureId', 'fixtureRevision', 'sourceDigest']); assertCanonicalDigest(sourceRef.sourceDigest);
      canonicalText(sourceRef.fixtureId); canonicalText(sourceRef.fixtureRevision);
      const acquisition = canonicalObject(provenance.acquisition), context = canonicalObject(attempt.canonical_reservation_context);
      canonicalKeys(context, ['version', 'jobType', 'fixturePolicyVersion', 'policy', 'sourceLeague', 'intendedLeagueKey', 'season', 'registrationDigest', 'standingsDigest']);
      canonicalText(context.fixturePolicyVersion); assertCanonicalDigest(context.registrationDigest);
      if (policy.originPolicy !== 'fixture-v1' || provenance.origin !== 'fixture' || receipt.legacy_roster_receipt_id !== null
        || row.legacy_bridge !== null || receipt.population_evidence !== null || acquisition.attemptId !== attemptId
        || acquisition.nonce !== reservation.nonce || acquisition.jobKey !== attempt.write_fence.jobKey
        || acquisition.generation !== attempt.write_fence.generation || acquisition.sourceDigest !== sourceRef.sourceDigest
        || context.version !== 'canonical-fixture-reservation-v1' || context.jobType !== 'canonical-fixture-standings-v1'
        || context.standingsDigest !== sourceRef.sourceDigest
        || !canonicalEqual(context.policy, policy) || context.intendedLeagueKey !== mapping.scope.leagueKey
        || context.season !== mapping.scope.season || !canonicalEqual(context.sourceLeague, { provider: mapping.scope.provider,
          resourceKind: 'league', nativeNamespace: mapping.scope.nativeNamespace, nativeId: mapping.scope.externalLeagueId })) throw new Error('Invalid retained fixture lineage.');
    } else throw new Error('Unknown canonical source representation.');
    let acceptedGeneration: number | null = null;
    if (row.acceptance_row !== null) {
      const accepted = canonicalObject(row.acceptance_row);
      acceptedGeneration = storedCounter(accepted.generation, 1); canonicalUuid(accepted.id);
      if (accepted.scope_id !== scopeId || accepted.canonical_receipt_id !== receiptId || accepted.receipt_id !== null
        || accepted.source_mapping_revision_id !== mapping.revisionId || acceptedGeneration !== expectedGeneration + 1
        || outcome !== 'accepted' || facts.status !== 'qualified'
        || selection.kind === 'current' && (head.accepted_id !== accepted.id || storedCounter(head.generation) !== acceptedGeneration)) throw new Error('Invalid canonical acceptance.');
    } else if (outcome === 'accepted') throw new Error('Missing canonical acceptance.');
    const expectedTeamCount = receipt.expected_team_count === null ? null : storedCounter(receipt.expected_team_count, 1);
    if (expectedTeamCount !== null && expectedTeamCount > 2_147_483_647) throw new Error('Invalid canonical population bound.');
    // A matching declared count alone is not independent population proof. The verified receipt retains that distinction.
    const population = expectedTeamCount === null ? 'unproved' : facts.status !== 'qualified' || expectedTeamCount !== facts.teams.length
      ? 'mismatch' : receipt.population === 'proven' ? 'proven' : 'unproved';
    const recordCompleteness = facts.status !== 'qualified' || facts.teams.length === 0 ? 'unknown' : facts.teams.every(team => Object.values(team.record).every(fact => fact.state === 'known')
      && team.pointsFor.state === 'known' && team.pointsAgainst.state === 'known') ? 'complete' : 'partial';
    const captureComplete = receipt.coverage.pagination === 'complete';
    const entitySet = facts.status !== 'qualified' ? 'unknown' : captureComplete && population === 'proven' ? 'full'
      : population === 'mismatch' || !captureComplete ? 'subset' : 'unknown';
    const coverageReasons = [...new Set([...facts.reasons, ...(population === 'proven' ? [] : [`standings_population_${population}`]),
      ...(captureComplete ? [] : ['standings_capture_partial']), ...(recordCompleteness === 'complete' ? [] : ['standings_record_fields_incomplete'])])].sort();
    const outcomeReason = outcome === 'preserved-stale' ? ['source-time-stale'] : outcome === 'preserved-conflict' ? ['source-time-conflict']
      : outcome === 'preserved-generation' ? ['generation-or-ordinal-preserved'] : [];
    if (receipt.population !== population || receipt.record_completeness !== recordCompleteness
      || receipt.coverage.entitySet !== entitySet || !canonicalEqual(receipt.coverage.reasons, coverageReasons)
      || !canonicalEqual(receipt.reasons, [...coverageReasons, ...outcomeReason].sort())
      || !Array.isArray(row.identities) || row.identities.length !== facts.teams.length) throw new Error('Invalid canonical population or identities.');
    if (facts.status !== 'qualified') {
      if (outcome !== facts.status || acceptedGeneration !== null) throw new Error('Invalid rejected canonical outcome.');
      return unavailable(selection, facts.reasons[0] ?? facts.status, attemptId, receiptId);
    }
    if (outcome === 'invalid' || outcome === 'capacity') throw new Error('Invalid qualified canonical outcome.');
    if (selection.kind === 'current' && outcome !== 'accepted') return unavailable(selection,
      outcome === 'preserved-conflict' ? 'source-time-conflict' : outcome === 'preserved-stale' ? 'source-time-stale' : 'generation-or-ordinal-preserved', attemptId, receiptId);
    const seen = new Set<string>();
    const teams = facts.teams.map((team, index) => {
      const value = canonicalObject((row.identities as unknown[])[index]), identity = canonicalObject(value.identity);
      const seasonTeamId = canonicalUuid(value.seasonTeamId);
      if (seen.has(seasonTeamId) || !canonicalEqual(value.sourceTeam, team.sourceTeam) || value.contentId !== contentId
        || value.leagueSeasonId !== mapping.leagueSeasonId || value.sourceLeagueNamespace !== mapping.scope.nativeNamespace
        || value.externalLeagueId !== mapping.scope.externalLeagueId || identity.id !== seasonTeamId
        || identity.league_season_id !== mapping.leagueSeasonId || identity.provider !== mapping.scope.provider
        || identity.source_league_namespace !== mapping.scope.nativeNamespace || identity.external_league_id !== mapping.scope.externalLeagueId
        || identity.native_namespace !== team.sourceTeam.nativeNamespace || identity.external_roster_id !== team.sourceTeam.nativeId) throw new Error('Foreign canonical team.');
      seen.add(seasonTeamId); return { ...team, seasonTeamId };
    });
    return { status: 'available', representation: 'canonical-v1', mapping, scope: expectedScope, selection, facts, teams,
      receipt: { id: receiptId, contentId, attemptId, ordinal, acceptedGeneration, provenance,
        nativeSourceRef: sourceRef as unknown as CanonicalNativeSourceRef, legacyRosterReceiptId, outcome, reasons: receipt.reasons },
      coverage: receipt.coverage, expectedTeamCount, population, recordCompleteness,
      versions: canonicalStandingsVersions(policy), freshness: 'unknown', historicalApplicability: 'unverified' };
  } catch { return unavailable(selection, 'canonical-standings-evidence-unavailable', attemptId, receiptId); }
}

export function canonicalStandingsMethods(client: DatabaseClient,
  resolver: CanonicalStandingsPolicyResolver = resolveCanonicalStandingsPolicy) {
  return {
    async beginCanonicalResourceAttempt(mapping: CanonicalSourceMappingV1, id: string,
      policy: CanonicalStandingsPolicy, fence: AdministrationWriteFence): Promise<CanonicalResourceAttempt> {
      const selected = policyFor(mapping, policy, resolver); canonicalUuid(id); assertCanonicalFence(fence);
      const rows = await client.query(`/* league-administration:begin-canonical-resource-attempt */
        SELECT public.begin_canonical_resource_attempt($1::jsonb,$2::uuid,$3::jsonb,$4::jsonb,$5::jsonb) AS result`,
      [JSON.stringify(mapping), id, JSON.stringify(canonicalStandingsScope(mapping)), JSON.stringify(selected), JSON.stringify(fence)]);
      if (rows.length !== 1) throw new Error('Missing canonical reservation.');
      const attempt = rows[0].result; assertCanonicalAttempt(attempt);
      if (attempt.id !== id) throw new Error('Wrong canonical reservation.');
      return attempt;
    },
    async recordCanonicalObservation(delivery: CanonicalStandingsDelivery, mapping: CanonicalSourceMappingV1,
      attempt: CanonicalResourceAttempt, fence: AdministrationWriteFence): Promise<CanonicalObservationWriteResult> {
      const policy = policyFor(mapping, delivery.policy, resolver); assertCanonicalDelivery(delivery, policy);
      if (!canonicalEqual(delivery.mapping, mapping) || !canonicalEqual(delivery.attempt, attempt)
        || !canonicalEqual(delivery.fence, fence)) throw new Error('Canonical delivery context mismatch.');
      const rows = await client.query(`/* league-administration:record-canonical-observation */
        SELECT public.record_league_administration_observation($1::jsonb) AS result`, [JSON.stringify(delivery)]);
      if (rows.length !== 1) throw new Error('Missing canonical writer result.');
      const result = canonicalObject(rows[0].result);
      canonicalKeys(result, ['status', 'receiptId', 'contentId', 'attemptId', 'acceptanceId', 'acceptedGeneration', 'outcome',
        ...(delivery.legacyInput ? ['legacyResult'] : [])]);
      canonicalUuid(result.receiptId); canonicalUuid(result.contentId);
      if (!['recorded', 'replayed'].includes(String(result.status)) || result.attemptId !== attempt.id
        || !CANONICAL_STANDINGS_OUTCOMES.includes(result.outcome as CanonicalStandingsOutcome)) throw new Error('Invalid canonical writer result.');
      if (result.acceptanceId === null) {
        if (result.acceptedGeneration !== null || result.outcome === 'accepted') throw new Error('Invalid canonical preservation.');
      } else {
        canonicalUuid(result.acceptanceId); canonicalCounter(result.acceptedGeneration, 1);
        if (result.outcome !== 'accepted' || result.acceptedGeneration !== attempt.expectedGeneration + 1) throw new Error('Invalid canonical acceptance result.');
      }
      if (delivery.legacyInput && !['changed', 'unchanged', 'replayed', 'stale', 'rejected'].includes(String(canonicalObject(result.legacyResult).status))) throw new Error('Missing unchanged legacy result.');
      return result as CanonicalObservationWriteResult;
    },
    async readCanonicalOfficialStandings(mapping: CanonicalSourceMappingV1,
      selection: CanonicalStandingsSelection): Promise<CanonicalOfficialStandingsRead> {
      assertCanonicalSelection(selection);
      try {
        assertCanonicalSourceMapping(mapping); assertCanonicalSelection(selection);
        if (selection.representation === 'legacy-sleeper-v1') {
          const legacyMapping = legacyStandingsMapping(mapping);
          const legacy = selection.kind === 'current' ? await officialStandingsMethods(client).readOfficialStandings(legacyMapping)
            : readOfficialStandingsRows(await client.query(HISTORICAL_OFFICIAL_STANDINGS_SQL,
              [JSON.stringify({ scope: currentRosterScope(legacyMapping), policy: CURRENT_ROSTER_POLICY }), mapping.revisionId,
                mapping.generation, selection.receiptId]), legacyMapping, { rosterReceiptId: selection.receiptId });
          return legacy.status === 'available' ? { status: 'available', representation: 'legacy-sleeper-v1', legacy }
            : { status: legacy.status, representation: selection.representation, reason: legacy.reason ?? 'legacy-standings-unavailable',
              attemptId: null, receiptId: selection.kind === 'receipt' ? selection.receiptId : null };
        }
        // Resolver selects code-owned policy independently of a caller's delivery or stored facts.
        const policy = resolver(mapping);
        const rows = await client.query(CANONICAL_OFFICIAL_STANDINGS_SQL,
          [JSON.stringify({ scope: canonicalStandingsScope(mapping), policy }), mapping.revisionId, mapping.generation,
            selection.kind === 'receipt' ? selection.receiptId : null]);
        return readCanonicalOfficialStandingsRows(rows, mapping, selection, resolver);
      } catch { return unavailable(selection, 'canonical-standings-evidence-unavailable'); }
    },
  };
}
