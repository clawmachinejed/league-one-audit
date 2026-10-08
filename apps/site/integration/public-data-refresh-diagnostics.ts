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
  'source.identity', 'source.leagues', 'source.core', 'reader.intake', 'reader.refresh', 'reader.settings', 'reader.players', 'reader.managers', 'reader.manager-evidence'] as const;
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
type Failure = { phase: Phase; category: Category; sqlState: string | null; step: number; cycle: number };
type Event = { sequence: number; step: number; cycle: number; phase: Phase; event: 'start' | 'return' | 'error' | 'expected-error';
  elapsedMs: number; durationMs?: number; status?: string; resource?: string; reason?: string;
  acceptance?: Record<string, string>; receipt?: ReceiptEvidence; category?: Category; sqlState?: string | null; fault?: ExpectedFault };
const MAX_EVENTS = 128;
const MAX_BYTES = 64 * 1024;
const artifactNames = { ordinary: 'public-data-ingestion-diagnostics.json', refresh: 'public-data-refresh-diagnostics.json' } as const;
const caseProfiles = { ordinary: 'data-core-ingestion-v1', refresh: 'data-core-refresh-v1' } as const;

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

/** Selected integration cases only. Serializes fixed classifications and bounded receipt predicates,
 * never arguments, raw errors, SQL, identities, provider payloads or URLs. No persistence/worker behavior changes. */
export function createPublicDataDiagnostics(kind: 'ordinary' | 'refresh') {
  if (kind !== 'ordinary' && kind !== 'refresh') throw new Error('Public DATA diagnostic failure: invalid case kind.');
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
  const append = (event: Omit<Event, 'sequence' | 'step' | 'cycle' | 'elapsedMs'>) => {
    if (events.length === MAX_EVENTS) { events.shift(); droppedEvents++; }
    const entry = { sequence: ++sequence, step, cycle, elapsedMs: Math.max(0, Math.round(performance.now() - started)), ...event };
    events.push(entry);
    if (event.event === 'return' && !event.phase.startsWith('jobs.') && event.phase !== 'refresh.select'
      && event.phase !== 'administration.receipt' && !['busy','backoff','idle'].includes(event.status ?? '')) lastCompletedBoundary = entry;
  };
  const fail = (phase: Phase, error: unknown, category?: Category): Error => {
    if (firstError) return firstError;
    if (!(phases as readonly unknown[]).includes(phase)) phase = 'case';
    if (category !== undefined && !['sql','abort','assertion','unexpected','incomplete'].includes(category)) category = 'unexpected';
    const detail = classification(error);
    firstFailure = { phase, ...detail, ...(category ? { category } : {}), step, cycle };
    firstError = new Error('Public DATA diagnostic failure: boundary=' + phase + '; category=' + firstFailure.category
      + '; sqlState=' + (firstFailure.sqlState ?? 'unknown') + '; step=' + step + '; cycle=' + cycle + '.');
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
    failure: fail,
    checkOutcome(outcome: unknown) {
      append({ phase: 'coordinator', event: 'return', ...summary(outcome) });
      if (firstError) throw firstError;
      if (read(outcome, 'status') === 'unavailable' && expectedThisStep === 0) throw fail('coordinator', undefined, 'incomplete');
    },
    snapshot() { return { kind: 'public-data-ingestion-diagnostics-v1', step, cycle, droppedEvents, lastCompletedBoundary: lastCompletedBoundary ?? null, firstFailure: firstFailure ?? null, events: [...events] }; },
    async save() {
      try {
        const binding = qualificationBinding();
        if (!binding || (binding.context.profile !== 'full' && binding.context.profile !== caseProfiles[kind])) {
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
