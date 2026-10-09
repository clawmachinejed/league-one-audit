import { ReceiptDiagnosticReadError, type ReceiptDiagnosticReader, type ReceiptDiagnosticParameters } from './neon-integration-harness';
import { CURRENT_ROSTER_POLICY, currentRosterScope } from '../lib/aggregator/current-roster';
import { LEAGUE_SETTINGS_POLICY, leagueSettingsScope } from '../lib/aggregator/league-settings';
import { TEAM_MANAGERS_POLICY, TEAM_MANAGER_EVIDENCE_POLICY, teamManagersScope, teamManagerEvidenceScope } from '../lib/aggregator/team-managers';
import { isAdministrationSourceMapping } from '../lib/league-administration/source-mapping';
import type { PublicIntakeDependencies } from '../lib/league-administration/public-intake';
import type { PublicDataRefreshStore } from '../lib/league-administration/public-refresh-contracts';
import { qualificationBinding, qualificationDigest } from './qualification-profile';
import { writeIntegrationArtifact } from './integration-artifacts';

const phases = ['case', 'case.assertion', 'case.wrong-owner-negative', 'artifact.write', 'coordinator',
  'jobs.acquireJob', 'jobs.completeJob', 'jobs.failJob', 'refresh.select', 'refresh.recordSelectionFailure',
  'intake.recover', 'intake.next', 'intake.admit', 'intake.recordIdentity', 'intake.recordLeagues',
  'intake.register', 'intake.completeCore', 'intake.fail', 'administration.readSourceMapping',
  'administration.beginRosterCapture', 'administration.beginLeagueSettingsAttempt',
  'administration.beginTeamManagerEvidenceAttempt', 'administration.recordObservation', 'administration.receipt',
  'source.identity', 'source.leagues', 'source.core', 'reader.intake', 'reader.refresh', 'reader.directory', 'reader.settings', 'reader.players', 'reader.managers', 'reader.manager-evidence'] as const;
type Phase = typeof phases[number];
type Category = 'sql' | 'abort' | 'assertion' | 'unexpected' | 'incomplete';
const sqlStates = new Set(['08000','08003','08006','22001','22003','22007','22023','22P02','23502','23503','23505','23514',
  '25000','25P02','28000','28P01','40001','40P01','42501','42601','42703','42804','42883','42P01','42P10',
  '53300','53400','54000','55000','55P03','57014','57P01','P0001','P0002','P0003','XX000']);
const statuses = new Set(['acquired','busy','idle','backoff','selected','recorded','already-recorded','admitted','unbound','superseded',
  'progress','complete','partial','unavailable','changed','unchanged','replayed','stale','rejected','disabled','accepted','preserved']);
const reasons = new Set(['exact_receipt_replay','newer_network_attempt_reserved','accepted_generation_changed',
  'complete_league_identity_unproved','complete_players_population_unproved',
  'complete_primary_owner_population_unproved','complete_manager_evidence_population_unproved']);
const resources = new Set(['identity','leagues','bootstrap','core','users']);
const expectedBoundaries = { 'admission-ack-loss': 'intake.admit', 'core-checkpoint-loss': 'intake.completeCore',
  'paired-cleanup-loss': 'intake.fail' } as const;
type ExpectedFault = keyof typeof expectedBoundaries;
const assertionCheckpoints = ['runtime-role', 'capture-witness', 'step-progress', 'journey-complete', 'intake-readback',
  'canonical-identity', 'canonical-ids', 'settings-value', 'team-counts', 'players-value', 'managers-value',
  'manager-receipts', 'manager-parity', 'team-identities', 'provider-manager-identities', 'candidate',
  'receipt-identities', 'lineage-count', 'receipt-provenance', 'receipt-witness', 'population-witness',
  'dispatch-order', 'dispatch-witness', 'discovery-count', 'discovery-times', 'stored-resources',
  'directory-lineage', 'directory-times', 'journey-next', 'fixture-requests', 'intake-population',
  'enrollment-inventory', 'final-profile', 'final-dispatch-order', 'live-core'] as const;
type AssertionCheckpoint = typeof assertionCheckpoints[number];
// Closed identifiers describe existing matchers; Vitest alone decides whether they pass.
const comparisons = {
  // One fixed identifier for every former plain matcher in the opt-in live journey.
  'journey.admission.work': 'toMatchObject',
  'journey.refresh.selection': 'toMatchObject',
  'journey.refresh.same-request': 'toBe',
  'journey.refresh.fresh-request': 'not.toBe',
  'journey.capture.count': 'toHaveLength',
  'journey.intake.summary': 'toMatchObject',
  'journey.intake.league-order': 'toEqual',
  'journey.intake.list-count': 'toHaveLength',
  'journey.discovery.row-count': 'toHaveLength',
  'journey.discovery.started': 'toBe',
  'journey.discovery.completed': 'toBe',
  'journey.roster.bound': 'toBeLessThanOrEqual',
  'journey.canonical.fields': 'toMatchObject',
  'journey.canonical.profile-present': 'toBe',
  'journey.canonical.profile-uuid': 'toMatch',
  'journey.canonical.profile-binding': 'toBe',
  'journey.canonical.profile-hash': 'toBe',
  'journey.canonical.profile-empty': 'toEqual',
  'journey.canonical.uuid': 'toMatch',
  'journey.canonical.stable': 'toEqual',
  'journey.writer.count': 'toHaveLength',
  'journey.teams.distinct': 'toBe',
  'journey.team.uuid': 'toMatch',
  'journey.team.stable': 'toBe',
  'journey.manager.uuid': 'toMatch',
  'journey.manager.reverse': 'toBe',
  'journey.manager.stable': 'toBe',
  'journey.candidate.fields': 'toMatchObject',
  'journey.bootstrap.started': 'toBe',
  'journey.bootstrap.completed': 'toBe',
  'journey.receipts.distinct': 'toBe',
  'journey.receipts.fresh': 'toBe',
  'journey.lineage.count': 'toHaveLength',
  'journey.attempts.distinct': 'toBe',
  'journey.receipt.generation': 'toBe',
  'journey.receipt.legacy': 'toBe',
  'journey.receipt.writer': 'toBe',
  'journey.receipt.observation-ids': 'toEqual',
  'journey.receipt.provenance': 'toMatchObject',
  'journey.lineage.witness': 'toMatchObject',
  'journey.receipt.mapping': 'toBe',
  'journey.population.witness': 'toMatchObject',
  'journey.directory.lineage': 'toMatchObject',
  'journey.directory.started': 'toBe',
  'journey.directory.completed': 'toBe',
  'journey.directory.observed': 'toBe',
  'journey.directory.fresh': 'not.toBe',
  'journey.intake.composed': 'toMatchObject',
  'journey.leagues.distinct': 'toBe',
  'journey.teams.all-distinct': 'toBe',
  'journey.managers.accounts': 'toEqual',
  'journey.dispatch.count': 'toHaveLength',
  'journey.dispatch.flags': 'toMatchObject',
  'journey.dispatch.capture': 'toEqual',
  'journey.dispatch.work': 'toEqual',
  'journey.history.intake-populated': 'toBeGreaterThan',
  'journey.history.receipt-count': 'toHaveLength',
  'journey.history.content-populated': 'toBeGreaterThan',
  'journey.history.dispatch-count': 'toHaveLength',
  'journey.history.unchanged': 'toEqual',
  'journey.step.progress': 'toMatchObject',
  'journey.step.admissions': 'toBe',
  'journey.step.claims': 'toBe',
  'journey.settlement.outcome': 'toEqual',
  'journey.refresh.readback': 'toMatchObject',
  'journey.refresh.cycle-count': 'toEqual',
  'journey.refresh.disposition': 'toEqual',
  'journey.settlement.spacing': 'toEqual',
  'journey.settlement.claims': 'toBe',
  'journey.settlement.admissions': 'toBe',
  'journey.settlement.unfinished': 'toEqual',
  'journey.capture.unchanged': 'toBe',

  'live.writer.input': 'toEqual',
  'live.identity.distinct-teams': 'toEqual', 'live.identity.reference': 'toEqual', 'live.identity.manager': 'toEqual',
  'live.json.type': 'toEqual', 'live.json.length': 'toEqual', 'live.json.key': 'toEqual', 'live.json.value': 'toEqual',
  'live.roles': 'toEqual', 'live.registration': 'toEqual', 'live.mapping': 'toEqual', 'live.metadata': 'toEqual',
  'live.normalized': 'toEqual', 'live.write': 'toEqual', 'live.availability': 'toEqual', 'live.capture-count': 'toEqual',
  'live.settings.canonical': 'toEqual', 'live.settings.identity': 'toEqual', 'live.settings.scoring-keys': 'toEqual',
  'live.settings.scoring-value': 'toEqual', 'live.settings.slots': 'toEqual', 'live.players.roster-ids': 'toEqual',
  'live.players.ids': 'toEqual', 'live.managers.roster-ids': 'toEqual', 'live.managers.primary': 'toEqual',
  'live.managers.coowners': 'toEqual', 'live.manager-evidence.canonical': 'toEqual', 'live.directory.ids': 'toEqual', 'live.directory.capture': 'toEqual',
  'live.receipt.provenance': 'toEqual', 'live.receipt.hash': 'toEqual', 'live.receipt.mapping': 'toEqual',
  'live.receipt.population': 'toEqual', 'live.payload.unchanged': 'toEqual', 'live.enrollment.inactive': 'toEqual',

  'runtime.roles': 'toEqual', 'capture.version': 'toBe', 'step.progress': 'toMatchObject',
  'journey.stage-count': 'toBe', 'journey.next': 'toBe', 'fixture.urls': 'toEqual', 'fixture.capture-count': 'toHaveLength',
  'intake.readback': 'toMatchObject', 'intake.league-count': 'toHaveLength', 'intake.list-count': 'toHaveLength',
  'canonical.identity': 'toMatchObject', 'uuid.shape': 'toEqual', 'canonical.distinct-ids': 'toBe',
  'enrollment.inactive': 'toBe', 'settings.value': 'toMatchObject', 'players.team-count': 'toHaveLength',
  'managers.team-count': 'toHaveLength', 'manager-evidence.team-count': 'toHaveLength', 'players.value': 'toMatchObject',
  'managers.value': 'toMatchObject', 'managers.receipt-refs': 'toEqual', 'manager-evidence.receipt-refs': 'toEqual',
  'manager-evidence.completeness': 'toBe', 'manager-evidence.parity': 'toMatchObject', 'teams.identity-parity': 'toEqual',
  'co-managers.count': 'toHaveLength', 'managers.distinct-ids': 'toBe', 'candidate.fields': 'toMatchObject',
  'receipts.distinct-ids': 'toBe', 'lineage.count': 'toHaveLength', 'receipt.provenance': 'toMatchObject',
  'receipt.acquisition': 'toEqual', 'lineage.witness': 'toMatchObject', 'population.acquisition': 'toEqual',
  'dispatch.resources': 'toEqual', 'dispatch.flags': 'toMatchObject', 'dispatch.acquisition': 'toEqual',
  'discovery.count': 'toHaveLength', 'discovery.started': 'toBe', 'discovery.completed': 'toBe',
  'stored-resources.composition': 'toMatchObject', 'directory.lineage': 'toMatchObject',
  'directory.time-order': 'toBeLessThanOrEqual', 'directory.time-equality': 'toBe',
  'directory.started': 'toBe', 'directory.completed': 'toBe', 'final.profile': 'toBeNull', 'final.dispatch-order': 'toEqual',
} as const;
type ComparisonId = keyof typeof comparisons;
type SafeValue = null | boolean | number | string | SafeValue[] | { [key: string]: SafeValue };
type ComparisonEvidence = { id: ComparisonId; matcher: typeof comparisons[ComparisonId]; occurrence: number;
  actual: SafeValue; expected: SafeValue; truncated: boolean; redacted: boolean; readback?: SafeValue };
// Field names come from the ordinary fixture, typed readers and retained capture contracts.
// Unknown keys/strings never become output. Aliases are shared across both operands of one comparison.
const comparisonFields = new Set(('resources target targetId configurationRevision cycleConfigurationRevision intake cycle number disposition cadenceSeconds outcome bounded exact_nonce attempt_id users_observation_id role effective_role status resource providerRequests request requested_username external_manager_id username seasons terminal failure_count lists rejected leagues externalLeagueId season collection league_id league_season_id connection_id current_mapping_revision_id scoring_profile_id profile_id rules_hash profile_rules active evidence sourceLeague provider nativeId scoring rules state value nativeSettings fields divisions slots nativeCode count externalRosterId players sourceEntity sourceTeam primaryOwner manager sourceManager coManagers completeness managers sourceRefs seasonTeamId providerManagerId stage external_league_id settings_receipt_id players_receipt_id managers_receipt_id league_observation_id roster_observation_id acquisition requestStartedAt requestCompletedAt sourceObservedAt intake_id source_mapping provenance exact_witness server_window current_head version work fence dispatchNonce mapping attempts requestId revision kind userId jobKey workerId generation deadlineAt connectionId leagueSeasonId revisionId scope leagueKey settings managersV2 id nonce receipt heldRoster teamManagers teamManagerEvidence captureBinding directory observationId legacyObservationId sourceMapping legacy_observation_id request_started_at request_completed_at source_observed_at recordedAt observedAt origin family week policy canonicalNormalizerVersion sourceAdapterVersion sport period ordinal scopeId attemptId acceptedGeneration normalizerVersion source sourceUpdatedAt rawContentHash configurationVersionId configurationSemanticHash configurationContentId expectedTeamCount checkedAt resourceKind nativeNamespace name artwork predecessor lifecycle seasonType visibility sourceAccess native grantsPrivateAccess teamCount dialect format statCatalog competition startPeriod playoffStartPeriod playoffTeamCount playoffFormat playoffRoundFormat playoffSeeding additionalMatch bestBall divisionCount leagueType rosterRules reserveSlotCount taxiSlotCount taxiYears taxiVeterans taxiDeadline reserveOut reserveSuspended reserveDoubtful maxSubstitutions substitutionLockWhenStarterActive substitutionStartTimeEligibility waivers budget type clearDays dailyEnabled dailyHour dailyDays tradeDeadline periods nflWeekMappings interpretation unsupportedScoringRules unknownSlots reasons sourcePath raw ordinal semantics externalManagerId externalManagerIds teams owner coOwners reason ids observationIds contentId contentHash envelope payload schemaVersion dialect completeness path length semanticHash').split(' '));
const comparisonLiterals = new Set(('pending backoff checkpoint-committed league_one_runtime public-network-capture-v1 progress complete available missing known unknown empty owned unowned sleeper nfl QB BN identity leagues bootstrap core users settings players managers managers-v1 managers-v2 league rosters network public-data-intake-v1 latest-for-current-source-mapping league-administration-public-intake sleeper-league-settings-v1 sleeper-current-players-v1 sleeper-current-team-managers-v1 sleeper-current-team-manager-evidence-v2 accepted preserved rejected stored unavailable changed unchanged replayed stale disabled scoring_profile_change_requires_explicit_compatibility_and_period_review team manager account scoring-entity absent null invalid partial co_managers_null co_managers_absent co_managers_invalid primary_owner_absent primary_owner_invalid ordered-occurrence public-endpoint flat-weights unverified limited regular in_season DEF RB WR TE FLEX SUPER_FLEX').split(' '));
function comparisonEvidence(id: ComparisonId, occurrence: number, actual: unknown, expected: unknown): ComparisonEvidence {
  const aliases = new Map<string, number>();
  let truncated = false, redacted = false;
  const hidden = (reason: string): SafeValue => { redacted = true; return { redacted: reason }; };
  const limit = (): SafeValue => { truncated = true; return { truncated: true }; };
  const project = (root: unknown, shape?: unknown): SafeValue => {
    let nodes = 0;
    const visit = (value: unknown, depth: number, subset?: unknown): SafeValue => {
      if (++nodes > 1_024 || depth > 16) return limit();
      if (value === null || typeof value === 'boolean') return value;
      if (value === undefined) return { state: 'undefined' };
      if (typeof value === 'number') return Number.isFinite(value) && Math.abs(value) <= 10 ** 13 ? value : hidden('number-out-of-range');
      if (typeof value === 'string') {
        if (comparisonLiterals.has(value) || (id.startsWith('live.json.') && comparisonFields.has(value))) return value;
        if (value.length <= 40 && /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}(?::\d{2})?)$/u.test(value)
          && Number.isFinite(Date.parse(value))) return { timestamp: value };
        if (value.length > 512) return hidden('string-over-limit');
        if (!aliases.has(value)) aliases.set(value, aliases.size + 1);
        redacted = true;
        return { alias: aliases.get(value)!, kind: /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(value) ? 'uuid'
          : /^[0-9]{1,32}$/u.test(value) ? 'native-id' : 'string' };
      }
      if (typeof value !== 'object') return hidden(typeof value);
      try {
        // Built-in brand check cannot invoke an operand's toJSON/valueOf/getters.
        let time: number | undefined;
        try { time = Date.prototype.getTime.call(value); } catch { /* Ordinary object. */ }
        if (time !== undefined) return Number.isFinite(time) ? { timestamp: new Date(time).toISOString(), kind: 'Date' } : hidden('invalid-date');
        const fields = Object.getOwnPropertyDescriptors(value);
        if (Array.isArray(value)) {
          const length = fields.length?.value;
          if (!Number.isSafeInteger(length) || length < 0) return hidden('invalid-array');
          if (length > 16) truncated = true;
          const subsetFields = subset && typeof subset === 'object' ? Object.getOwnPropertyDescriptors(subset) : undefined;
          const items: SafeValue[] = [];
          for (let i = 0; i < Math.min(length, 16); i++) {
            const field = fields[String(i)], hint = subsetFields?.[String(i)];
            items.push(!field ? { state: 'missing' } : !Object.hasOwn(field, 'value') ? hidden('accessor')
              : visit(field.value, depth + 1, hint && Object.hasOwn(hint, 'value') ? hint.value : undefined));
          }
          const extraFields = Reflect.ownKeys(fields).filter(key => key !== 'length'
            && (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/u.test(key) || Number(key) >= length)).length;
          if (extraFields) redacted = true;
          return { length, items, ...(length > 16 ? { truncated: true } : {}), ...(extraFields ? { $redactedFieldCount: extraFields } : {}) };
        }
        const keys = Reflect.ownKeys(fields);
        const unknownFields = keys.filter(key => typeof key !== 'string' || !comparisonFields.has(key)).length;
        const hint = subset && typeof subset === 'object' && !Array.isArray(subset) ? Object.getOwnPropertyDescriptors(subset) : undefined;
        const selected = (hint ? Object.keys(hint) : Object.keys(fields)).filter(key => comparisonFields.has(key)).sort();
        const result: { [key: string]: SafeValue } = {};
        for (const key of selected) {
          const field = fields[key], childHint = hint?.[key];
          result[key] = !field ? { state: 'missing' } : !Object.hasOwn(field, 'value') ? hidden('accessor')
            : visit(field.value, depth + 1, childHint && Object.hasOwn(childHint, 'value') ? childHint.value : undefined);
        }
        if (unknownFields) { redacted = true; result.$redactedFieldCount = unknownFields; }
        if (hint) result.$omittedFieldCount = Object.keys(fields).filter(key => comparisonFields.has(key) && !selected.includes(key)).length;
        return result;
      } catch { return hidden('uninspectable'); }
    };
    return visit(root, 0, shape);
  };
  const matcher = comparisons[id];
  // A length assertion needs the observed length, not the entire population.
  const length = (value: unknown): SafeValue => {
    try {
      if (typeof value === 'string') return { length: value.length };
      if (value && typeof value === 'object') {
        const field = Object.getOwnPropertyDescriptor(value, 'length');
        if (field && Object.hasOwn(field, 'value')) return { length: project(field.value) };
        return field ? hidden('accessor') : { length: { state: 'missing' } };
      }
    } catch { return hidden('uninspectable'); }
    return hidden('no-length');
  };
  // Only this fixed live-summary assertion gets supplemental resource statuses. Never
  // traverse provider envelopes, payloads, retained resources or exception text.
  const readbackSummary = (): SafeValue => {
    const unreadable = Symbol('unreadable');
    const own = (value: unknown, key: string): unknown => {
      try {
        if (!value || typeof value !== 'object') return undefined;
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (descriptor && !Object.hasOwn(descriptor, 'value')) { redacted = true; return unreadable; }
        return descriptor?.value;
      } catch { redacted = true; return unreadable; }
    };
    const fixedStatuses = new Set(['available', 'unavailable', 'partial', 'pending', 'missing', 'disabled', 'complete', 'capacity', 'bootstrap', 'core', 'users']);
    const fixedReasons = new Set(['intake-capture-not-current-head', 'settings-read-failed', 'team-managers-read-failed',
      'held-roster-read-failed', 'directory-read-failed', 'team-manager-evidence-read-failed',
      'team-manager-evidence-unsupported', 'stored-source-unavailable', 'persistence_disabled']);
    const token = (value: unknown, allowed: Set<string>): SafeValue => {
      if (value === undefined || value === null) return null;
      if (typeof value === 'string' && allowed.has(value)) return value;
      redacted = true; return 'other';
    };
    const leagues = own(actual, 'leagues'), length = own(leagues, 'length');
    if (!Array.isArray(leagues) || !Number.isSafeInteger(length) || Number(length) < 0) return { state: 'unavailable', redacted: true };
    const total = Number(length), items: SafeValue[] = [];
    if (total > 4) truncated = true;
    for (let index = 0; index < Math.min(total, 4); index++) {
      const league = own(leagues, String(index)), resources = own(league, 'resources');
      const native = own(league, 'externalLeagueId');
      const item: Record<string, SafeValue> = { ordinal: index + 1, externalLeagueId: typeof native === 'string' && /^[0-9]{1,32}$/u.test(native)
        ? project(native) : hidden('invalid-native-id'), ...(league === unreadable || resources === unreadable ? { redacted: true } : {}),
        collection: token(own(league, 'collection'), fixedStatuses), reason: token(own(league, 'reason'), fixedReasons) };
      const summary: Record<string, SafeValue> = {};
      for (const resource of ['settings', 'teamManagers', 'heldRoster', 'directory', 'teamManagerEvidence']) {
        const value = own(resources, resource);
        summary[resource] = { status: token(own(value, 'status'), fixedStatuses), reason: token(own(value, 'reason'), fixedReasons),
          ...(value === unreadable ? { redacted: true } : {}) };
      }
      item.resources = summary; items.push(item);
    }
    return { length: total, items, omitted: Math.max(0, total - 4), truncated: total > 4 };
  };
  let readback: SafeValue | undefined;
  if (id === 'journey.intake.summary') {
    try { readback = readbackSummary(); }
    catch { redacted = true; readback = { state: 'unavailable', redacted: true }; }
  }
  const evidence: ComparisonEvidence = { id, matcher, occurrence,
    actual: matcher === 'toHaveLength' ? length(actual) : project(actual, matcher === 'toMatchObject' ? expected : undefined),
    expected: id === 'uuid.shape' || (id.startsWith('journey.') && matcher === 'toMatch') ? { pattern: 'uuid' } : project(expected), truncated, redacted, ...(readback ? { readback } : {}) };
  // Preserve explicit incompleteness rather than silently dropping fields to satisfy the artifact bound.
  if (Buffer.byteLength(JSON.stringify(evidence, null, 2), 'utf8') > 48 * 1_024) {
    return { id, matcher, occurrence, actual: { truncated: true }, expected: { truncated: true }, truncated: true, redacted, ...(readback ? { readback } : {}) };
  }
  return evidence;
}

type DatabaseVersion = Readonly<{ serverVersion: string; serverVersionNum: number }>;
type Failure = { phase: Phase; category: Category; sqlState: string | null; step: number; cycle: number;
  /** The owned synchronous assertion group, never an exception-derived label or source line. */
  assertionCheckpoint?: AssertionCheckpoint; comparison?: ComparisonEvidence;
  readbackComparison?: { assertionCheckpoint: AssertionCheckpoint; comparison: ComparisonEvidence } };
type Event = { sequence: number; step: number; cycle: number; phase: Phase; event: 'start' | 'return' | 'error' | 'expected-error';
  elapsedMs: number; durationMs?: number; status?: string; resource?: string; reason?: string;
  acceptance?: Record<string, string>; receipt?: ReceiptEvidence; category?: Category; sqlState?: string | null; fault?: ExpectedFault };
const MAX_EVENTS = 128;
const MAX_BYTES = 64 * 1024;
const artifactNames = { journey: 'public-data-live-diagnostics.json', live: 'live-league-two-diagnostics.json', ordinary: 'public-data-ingestion-diagnostics.json', refresh: 'public-data-refresh-diagnostics.json' } as const;
const caseProfiles = { journey: 'data-live-public-intake-v1', live: 'data-live-league-two-v1', ordinary: 'data-core-ingestion-v1', refresh: 'data-core-refresh-v1' } as const;

const receiptResources = [
  { key: 'leagueSettingsAcceptance', argument: 5, resource: 'settings', family: 'league', policy: LEAGUE_SETTINGS_POLICY, scope: leagueSettingsScope },
  { key: 'rosterAcceptance', argument: 3, resource: 'players', family: 'rosters', policy: CURRENT_ROSTER_POLICY, scope: currentRosterScope },
  { key: 'teamManagerAcceptance', argument: 4, resource: 'managers-v1', family: 'rosters', policy: TEAM_MANAGERS_POLICY, scope: teamManagersScope },
  { key: 'teamManagerEvidenceAcceptance', argument: 10, resource: 'managers-v2', family: 'rosters', policy: TEAM_MANAGER_EVIDENCE_POLICY, scope: teamManagerEvidenceScope },
] as const;
type ReceiptResource = typeof receiptResources[number];
type ObservationArguments = Parameters<PublicIntakeDependencies['administration']['recordObservation']>;
type ReceiptEvidence = { state: 'available' | 'invalid-binding' | 'invalid-result' | 'error' | 'timeout';
  boundary?: 'transaction' | 'result-validation';
  requestStartedAfterReservation?: boolean | null; requestStartMinusReservationMs?: number | null;
  requestStartMinusReservationClamped?: boolean | null };
type PendingReceipt = { resource: ReceiptResource['resource']; reader: ReceiptDiagnosticReader; parameters: ReceiptDiagnosticParameters };
const RECEIPT_DEADLINE_MS = 5_000;
const RECEIPT_DIFFERENCE_BOUND_MS = 60_000;
function receiptBinding(args: ObservationArguments, result: unknown, spec: ReceiptResource): ReceiptDiagnosticParameters | undefined {
  const uuid = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.test(value);
  const input = read(args[0], 'envelope'), rawMapping = args[2], rawScope = read(rawMapping, 'scope');
  // Copy only checked scalar fields; never pass caller toJSON, payloads or URLs to this read.
  const mapping = { connectionId: read(rawMapping, 'connectionId'), leagueSeasonId: read(rawMapping, 'leagueSeasonId'),
    revisionId: read(rawMapping, 'revisionId'), generation: read(rawMapping, 'generation'),
    scope: { leagueKey: read(rawScope, 'leagueKey'), externalLeagueId: read(rawScope, 'externalLeagueId'),
      provider: read(rawScope, 'provider'), season: read(rawScope, 'season') } };
  const attempt = read(args[spec.argument], 'attempt'), receiptId = read(read(result, spec.key), 'receiptId');
  const attemptId = read(attempt, 'id'), scopeId = read(attempt, 'scopeId');
  const ordinal = read(attempt, 'ordinal'), expectedGeneration = read(attempt, 'expectedGeneration');
  if (!isAdministrationSourceMapping(mapping) || !uuid(mapping.connectionId) || !uuid(mapping.leagueSeasonId)
    || !uuid(mapping.revisionId) || mapping.scope.leagueKey.length > 256 || mapping.scope.externalLeagueId.length > 256
    || !uuid(receiptId) || !uuid(attemptId) || !uuid(scopeId)
    || !Number.isSafeInteger(ordinal) || Number(ordinal) < 1
    || !Number.isSafeInteger(expectedGeneration) || Number(expectedGeneration) < 0
    || read(input, 'family') !== spec.family || read(input, 'week') !== null
    || Object.entries(mapping.scope).some(([key, value]) => read(read(input, 'scope'), key) !== value)) return undefined;
  return [receiptId as string, attemptId as string, scopeId as string, JSON.stringify(mapping),
    JSON.stringify({ scope: spec.scope(mapping), policy: spec.policy }), ordinal as number, expectedGeneration as number];
}
function receiptEvidence(rows: unknown): ReceiptEvidence {
  if (!Array.isArray(rows) || rows.length !== 1) return { state: 'invalid-result' };
  const row = rows[0], after = read(row, 'request_started_after_reservation');
  const difference = read(row, 'request_start_minus_reservation_ms'), clamped = read(row, 'request_start_minus_reservation_clamped');
  if (!row || typeof row !== 'object' || Object.keys(row).sort().join(',') !==
    'request_start_minus_reservation_clamped,request_start_minus_reservation_ms,request_started_after_reservation'
    || !((after === null && difference === null && clamped === null)
      || (typeof after === 'boolean' && typeof difference === 'number' && Number.isFinite(difference)
        && Math.abs(difference) <= RECEIPT_DIFFERENCE_BOUND_MS && typeof clamped === 'boolean'
        && after === (difference >= 0) && (!clamped || Math.abs(difference) === RECEIPT_DIFFERENCE_BOUND_MS)))) return { state: 'invalid-result' };
  return { state: 'available', requestStartedAfterReservation: after as boolean | null,
    requestStartMinusReservationMs: difference as number | null, requestStartMinusReservationClamped: clamped as boolean | null };
}

function read(value: unknown, key: string): unknown {
  try { return value && (typeof value === 'object' || typeof value === 'function') ? Reflect.get(value, key) : undefined; }
  catch { return undefined; }
}
function classification(error: unknown): Pick<Failure, 'category' | 'sqlState'> {
  const code = read(error, 'code'), name = read(error, 'name');
  const sqlState = typeof code === 'string' && sqlStates.has(code) ? code : null;
  return { sqlState, category: sqlState ? 'sql' : name === 'AbortError' || name === 'TimeoutError' ? 'abort'
    : name === 'AssertionError' ? 'assertion' : 'unexpected' };
}
function summary(value: unknown): Pick<Event, 'status' | 'resource' | 'reason' | 'acceptance'> {
  const status = typeof value === 'string' ? value : read(value, 'status') ?? read(value, 'kind');
  const reason = read(value, 'reason'), resource = read(value, 'resource') ?? read(value, 'kind');
  const acceptance: Record<string, string> = {};
  for (const key of ['leagueSettingsAcceptance','rosterAcceptance','teamManagerAcceptance','teamManagerEvidenceAcceptance']) {
    const accepted = read(value, key), state = read(accepted, 'status'), cause = read(accepted, 'reason');
    if (accepted !== undefined) {
      acceptance[key] = typeof state === 'string' && statuses.has(state) ? state : 'other';
      if (cause !== undefined && cause !== null) acceptance[key + 'Reason'] = typeof cause === 'string' && reasons.has(cause) ? cause : 'other';
    }
  }
  return { status: typeof status === 'string' && statuses.has(status) ? status : value === undefined ? 'void'
    : value === null ? 'missing' : value === true ? 'true' : value === false ? 'false' : 'other',
    ...(typeof resource === 'string' && resources.has(resource) ? { resource } : {}),
    ...(reason === undefined || reason === null ? {} : { reason: typeof reason === 'string' && reasons.has(reason) ? reason : 'other' }),
    ...(Object.keys(acceptance).length ? { acceptance } : {}) };
}

/** Selected integration cases only. Serializes fixed classifications, bounded receipt predicates and
 * owned comparison projections; no raw errors, identities, SQL, provider payloads or URLs. */
export function createPublicDataDiagnostics(kind: 'ordinary' | 'refresh' | 'live' | 'journey') {
  if (kind !== 'ordinary' && kind !== 'refresh' && kind !== 'live' && kind !== 'journey') throw new Error('Public DATA diagnostic failure: invalid case kind.');
  const started = performance.now();
  const events: Event[] = [];
  const pendingReceipts = new Map<ReceiptResource['resource'], PendingReceipt>();
  const expected = new WeakMap<object, { fault: ExpectedFault; used: boolean }>();
  const sanitized = new WeakMap<object, Error>();
  const issued = new Set<ExpectedFault>();
  let sequence = 0, step = 0, cycle = 0, expectedThisStep = 0, droppedEvents = 0;
  let lastCompletedBoundary: Event | undefined;
  let firstFailure: Failure | undefined;
  let firstError: Error | undefined;
  let databaseVersion: DatabaseVersion | undefined;
  let activeCheckpoint: AssertionCheckpoint | undefined;
  const comparisonCounts = new Map<ComparisonId, number>();
  const append = (event: Omit<Event, 'sequence' | 'step' | 'cycle' | 'elapsedMs'>) => {
    if (events.length === MAX_EVENTS) { events.shift(); droppedEvents++; }
    const entry = { sequence: ++sequence, step, cycle, elapsedMs: Math.max(0, Math.round(performance.now() - started)), ...event };
    events.push(entry);
    if (event.event === 'return' && !event.phase.startsWith('jobs.') && event.phase !== 'refresh.select'
      && event.phase !== 'administration.receipt' && !['busy','backoff','idle'].includes(event.status ?? '')) lastCompletedBoundary = entry;
  };
  const fail = (phase: Phase, error: unknown, category?: Category, checkpoint?: AssertionCheckpoint, comparison?: ComparisonEvidence): Error => {
    if (firstError) return firstError;
    if (!(phases as readonly unknown[]).includes(phase)) phase = 'case';
    if (category !== undefined && !['sql','abort','assertion','unexpected','incomplete'].includes(category)) category = 'unexpected';
    const detail = classification(error);
    const assertionCheckpoint = phase === 'case.assertion' && detail.category === 'assertion'
      && typeof checkpoint === 'string' && (assertionCheckpoints as readonly string[]).includes(checkpoint) ? checkpoint : undefined;
    firstFailure = { phase, ...detail, ...(category ? { category } : {}), step, cycle,
      ...(assertionCheckpoint ? { assertionCheckpoint, ...(comparison ? { comparison } : {}) } : {}) };
    firstError = new Error('Public DATA diagnostic failure: boundary=' + phase + '; category=' + firstFailure.category
      + '; sqlState=' + (firstFailure.sqlState ?? 'unknown') + '; step=' + step + '; cycle=' + cycle
      + (assertionCheckpoint ? '; assertionCheckpoint=' + assertionCheckpoint : '')
      + (comparison && assertionCheckpoint ? '; comparison=' + comparison.id + '; matcher=' + comparison.matcher : '') + '.');
    sanitized.set(firstError, firstError);
    return firstError;
  };
  const observe = async <T>(phase: Phase, action: () => Promise<T>): Promise<T> => {
    if (!(phases as readonly unknown[]).includes(phase)) throw fail('case', undefined);
    append({ phase, event: 'start' });
    const began = performance.now();
    try {
      const result = await action();
      append({ phase, event: 'return', durationMs: Math.max(0, Math.round(performance.now() - began)), ...summary(result) });
      return result;
    } catch (error) {
      const identity = error !== null && (typeof error === 'object' || typeof error === 'function') ? error : undefined;
      const injection = identity ? expected.get(identity) : undefined;
      if (injection && !injection.used && expectedBoundaries[injection.fault] === phase) {
        injection.used = true; expectedThisStep++;
        append({ phase, event: 'expected-error', fault: injection.fault });
        throw error; // Only our own fixed-message, exact-identity injected object.
      }
      append({ phase, event: 'error', ...classification(error) });
      throw identity && sanitized.has(identity) ? sanitized.get(identity)! : fail(phase, error);
    }
  };
  const captureReceipts = async () => {
    const pending = [...pendingReceipts.values()]; pendingReceipts.clear();
    if (!firstError || !pending.length) return;
    const controller = new AbortController();
    const deadlineAt = performance.now() + RECEIPT_DEADLINE_MS;
    const timedOut = Symbol('receipt-read-timeout');
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<typeof timedOut>(resolve => {
      timer = setTimeout(() => { controller.abort(); resolve(timedOut); }, RECEIPT_DEADLINE_MS);
    });
    try {
      // At most one pending binding per fixed resource, one deadline for the entire drain.
      for (const item of pending) {
        if (performance.now() >= deadlineAt) controller.abort();
        if (controller.signal.aborted) {
          append({ phase: 'administration.receipt', event: 'return', resource: item.resource, receipt: { state: 'timeout' } });
          continue;
        }
        try {
          const rows = await Promise.race([item.reader(item.parameters, controller.signal), deadline]);
          const receipt = rows === timedOut || controller.signal.aborted ? { state: 'timeout' as const } : receiptEvidence(rows);
          append({ phase: 'administration.receipt', event: 'return', resource: item.resource, receipt });
        } catch (error) {
          let boundary: ReceiptEvidence['boundary'];
          try {
            const candidate = error instanceof ReceiptDiagnosticReadError ? read(error, 'receiptBoundary') : undefined;
            if (candidate === 'transaction' || candidate === 'result-validation') boundary = candidate;
          } catch { /* Reject hostile prototype/property access without losing the primary failure. */ }
          append({ phase: 'administration.receipt', event: 'error', resource: item.resource,
            receipt: { state: controller.signal.aborted ? 'timeout' : 'error', ...(boundary ? { boundary } : {}) }, ...classification(error) });
        }
      }
    } finally { clearTimeout(timer); }
  };
  return {
    queueReceipts(reader: ReceiptDiagnosticReader | undefined, args: ObservationArguments, result: unknown) {
      if (!reader) return;
      for (const spec of receiptResources) {
        const status = read(read(result, spec.key), 'status');
        if (status === 'accepted') pendingReceipts.delete(spec.resource);
        if (status !== 'preserved') continue;
        pendingReceipts.delete(spec.resource);
        const parameters = receiptBinding(args, result, spec);
        if (parameters) pendingReceipts.set(spec.resource, { reader, resource: spec.resource, parameters });
        else append({ phase: 'administration.receipt', event: 'return', resource: spec.resource, receipt: { state: 'invalid-binding' } });
      }
    },
    beginStep(value: number) { step++; cycle = Number.isSafeInteger(value) && value >= 0 && value <= 2 ? value : 0; expectedThisStep = 0; },
    expectedFault(fault: ExpectedFault): Error {
      if (typeof fault !== 'string' || !Object.hasOwn(expectedBoundaries, fault) || issued.has(fault)) throw fail('case', undefined);
      issued.add(fault);
      const error = new Error('Intentional diagnostic fixture fault: ' + fault);
      expected.set(error, { fault, used: false }); return error;
    },
    observe,
    assertion<T>(checkpoint: AssertionCheckpoint, action: () => T): T {
      if (typeof checkpoint !== 'string' || !(assertionCheckpoints as readonly string[]).includes(checkpoint)) throw fail('case', undefined);
      const previous = activeCheckpoint; activeCheckpoint = checkpoint;
      try { return action(); }
      catch (error) { throw fail('case.assertion', error, undefined, checkpoint); }
      finally { activeCheckpoint = previous; }
    },
    comparison<A, E>(id: ComparisonId, actual: A, expected: E, assertion: (actual: A, expected: E) => void): void {
      if ((kind !== 'ordinary' && kind !== 'live' && kind !== 'journey') || !activeCheckpoint || typeof id !== 'string' || !Object.hasOwn(comparisons, id)) throw fail('case', undefined);
      const occurrence = (comparisonCounts.get(id) ?? 0) + 1; comparisonCounts.set(id, occurrence);
      try { assertion(actual, expected); }
      catch (error) {
        const evidence = classification(error).category === 'assertion' ? comparisonEvidence(id, occurrence, actual, expected) : undefined;
        if (firstError) {
          if (kind === 'journey' && id === 'journey.intake.summary' && evidence && firstFailure
            && !firstFailure.comparison && !firstFailure.readbackComparison) {
            firstFailure.readbackComparison = { assertionCheckpoint: activeCheckpoint, comparison: evidence };
          }
          throw firstError;
        }
        throw fail('case.assertion', error, undefined, activeCheckpoint, evidence);
      }
    },
    recordDatabaseVersion(row: unknown) {
      // Inspect own data descriptors only: no getters, prototype methods, raw errors or serialization hooks.
      // This is the version from the case's existing restricted-role identity query, not another connection.
      try {
        if (!row || typeof row !== 'object' || Array.isArray(row) || databaseVersion) throw new Error();
        const fields = Object.getOwnPropertyDescriptors(row);
        if (Reflect.ownKeys(fields).sort().join(',') !== 'effective_role,role,server_version,server_version_num'
          || Object.values(fields).some(field => !Object.hasOwn(field, 'value'))) throw new Error();
        const text = fields.server_version.value, number = fields.server_version_num.value;
        if (fields.role.value !== 'league_one_runtime' || fields.effective_role.value !== 'league_one_runtime'
          || typeof text !== 'string' || text.length > 64 || typeof number !== 'string' || !/^[1-9][0-9]{5}$/u.test(number)) throw new Error();
        const parts = /^([1-9][0-9])\.([0-9]{1,4})(?: \([0-9a-f]{7,40}\))?$/u.exec(text);
        if (!parts || Number(parts[1]) * 10_000 + Number(parts[2]) !== Number(number)) throw new Error();
        databaseVersion = Object.freeze({ serverVersion: text, serverVersionNum: Number(number) });
      } catch { throw fail('case', undefined); }
    },
    failure: (phase: Phase, error: unknown, category?: Category) => fail(phase, error, category),
    checkOutcome(outcome: unknown) {
      append({ phase: 'coordinator', event: 'return', ...summary(outcome) });
      if (firstError) throw firstError;
      if (read(outcome, 'status') === 'unavailable' && expectedThisStep === 0) throw fail('coordinator', undefined, 'incomplete');
    },
    snapshot() { return { kind: 'public-data-ingestion-diagnostics-v1', step, cycle, droppedEvents,
      ...(databaseVersion ? { databaseVersion: { ...databaseVersion } } : {}), lastCompletedBoundary: lastCompletedBoundary ?? null, firstFailure: firstFailure ? JSON.parse(JSON.stringify(firstFailure)) as Failure : null, events: [...events] }; },
    async save() {
      try {
        const binding = qualificationBinding();
        if (!binding || ((kind === 'live' || kind === 'journey') && binding.context.profile !== caseProfiles[kind]) || (binding.context.profile !== 'full' && binding.context.profile !== caseProfiles[kind])) {
          throw new Error('Matching bound qualification context required.');
        }
        await captureReceipts();
        const report = { ...this.snapshot(), caseKind: kind, contextDigest: qualificationDigest(binding.context),
          runId: binding.context.runId, gitSha: binding.context.gitSha, profile: binding.context.profile };
        // Enforce the actual pretty-JSON budget even for maximum fixed reason summaries.
        while (Buffer.byteLength(JSON.stringify(report, null, 2) + '\n', 'utf8') > MAX_BYTES && report.events.length) {
          report.events.shift(); report.droppedEvents++;
        }
        if (Buffer.byteLength(JSON.stringify(report, null, 2) + '\n', 'utf8') > MAX_BYTES) throw new Error('Bounded diagnostic evidence exceeded.');
        await writeIntegrationArtifact(artifactNames[kind], report);
      } catch {
        // Preserve an existing sanitized test failure. A missing artifact cannot
        // turn a previously successful case into a claimed diagnostic success.
        if (!firstError) throw fail('artifact.write', undefined);
        try { process.stderr.write('PUBLIC_DATA_DIAGNOSTIC_ARTIFACT_WRITE_FAILED\n'); } catch { /* Cleanup must still run. */ }
      }
    },
  };
}

type Diagnostics = ReturnType<typeof createPublicDataDiagnostics>;
type Dependencies = PublicIntakeDependencies & { refresh?: PublicDataRefreshStore };
/** Explicit maintained boundaries used by these two tests; no SQL interception. */
export function observePublicDataDependencies(d: Diagnostics, input: PublicIntakeDependencies & { refresh: PublicDataRefreshStore }, reader?: ReceiptDiagnosticReader): PublicIntakeDependencies & { refresh: PublicDataRefreshStore };
export function observePublicDataDependencies(d: Diagnostics, input: PublicIntakeDependencies, reader?: ReceiptDiagnosticReader): PublicIntakeDependencies;
export function observePublicDataDependencies(d: Diagnostics, input: Dependencies, reader?: ReceiptDiagnosticReader): Dependencies {
  const { jobs, intake, administration: admin, source, refresh } = input;
  return { ...input,
    jobs: { ...jobs, acquireJob: (...a) => d.observe('jobs.acquireJob', () => jobs.acquireJob(...a)),
      completeJob: (...a) => d.observe('jobs.completeJob', () => jobs.completeJob(...a)),
      failJob: (...a) => d.observe('jobs.failJob', () => jobs.failJob(...a)) },
    intake: { ...intake, recover: (...a) => d.observe('intake.recover', () => intake.recover(...a)),
      next: (...a) => d.observe('intake.next', () => intake.next(...a)),
      admit: (...a) => d.observe('intake.admit', () => intake.admit(...a)),
      recordIdentity: (...a) => d.observe('intake.recordIdentity', () => intake.recordIdentity(...a)),
      recordLeagues: (...a) => d.observe('intake.recordLeagues', () => intake.recordLeagues(...a)),
      register: (...a) => d.observe('intake.register', () => intake.register(...a)),
      completeCore: (...a) => d.observe('intake.completeCore', () => intake.completeCore(...a)),
      fail: (...a) => d.observe('intake.fail', () => intake.fail(...a)) },
    administration: { ...admin,
      readSourceMapping: (...a) => d.observe('administration.readSourceMapping', () => admin.readSourceMapping(...a)),
      beginRosterCapture: (...a) => d.observe('administration.beginRosterCapture', () => admin.beginRosterCapture(...a)),
      beginLeagueSettingsAttempt: (...a) => d.observe('administration.beginLeagueSettingsAttempt', () => admin.beginLeagueSettingsAttempt(...a)),
      recordObservation: async (...a) => {
        const result = await d.observe('administration.recordObservation', () => admin.recordObservation(...a));
        d.queueReceipts(reader, a, result); return result;
      },
      ...(admin.beginTeamManagerEvidenceAttempt ? { beginTeamManagerEvidenceAttempt: (...a: Parameters<NonNullable<typeof admin.beginTeamManagerEvidenceAttempt>>) =>
        d.observe('administration.beginTeamManagerEvidenceAttempt', () => admin.beginTeamManagerEvidenceAttempt!(...a)) } : {}) },
    ...(source ? { source: { ...source,
      identity: (...a: Parameters<typeof source.identity>) => d.observe('source.identity', () => source.identity(...a)),
      leagues: (...a: Parameters<typeof source.leagues>) => d.observe('source.leagues', () => source.leagues(...a)),
      core: (...a: Parameters<typeof source.core>) => d.observe('source.core', () => source.core(...a)) } } : {}),
    ...(refresh ? { refresh: { ...refresh,
      select: (...a: Parameters<typeof refresh.select>) => d.observe('refresh.select', () => refresh.select(...a)),
      recordSelectionFailure: (...a: Parameters<typeof refresh.recordSelectionFailure>) =>
        d.observe('refresh.recordSelectionFailure', () => refresh.recordSelectionFailure(...a)) } } : {}),
  };
}
