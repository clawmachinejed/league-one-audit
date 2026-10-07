import type { PublicIntakeDependencies } from '../lib/league-administration/public-intake';
import type { PublicDataRefreshStore } from '../lib/league-administration/public-refresh-contracts';
import { qualificationBinding, qualificationDigest } from './qualification-profile';
import { writeIntegrationArtifact } from './integration-artifacts';

const phases = ['case', 'case.assertion', 'case.wrong-owner-negative', 'artifact.write', 'coordinator',
  'jobs.acquireJob', 'jobs.completeJob', 'jobs.failJob', 'refresh.select', 'refresh.recordSelectionFailure',
  'intake.recover', 'intake.next', 'intake.admit', 'intake.recordIdentity', 'intake.recordLeagues',
  'intake.register', 'intake.completeCore', 'intake.fail', 'administration.readSourceMapping',
  'administration.beginRosterCapture', 'administration.beginLeagueSettingsAttempt',
  'administration.beginTeamManagerEvidenceAttempt', 'administration.recordObservation',
  'source.identity', 'source.leagues', 'source.core', 'reader.intake', 'reader.refresh', 'reader.settings', 'reader.players', 'reader.managers', 'reader.manager-evidence'] as const;
type Phase = typeof phases[number];
type Category = 'sql' | 'abort' | 'assertion' | 'unexpected' | 'incomplete';
const sqlStates = new Set(['08000','08003','08006','22001','22003','22007','22023','22P02','23502','23503','23505','23514',
  '25000','25P02','28000','28P01','40001','40P01','42501','42601','42703','42804','42883','42P01','42P10',
  '53300','53400','54000','55000','55P03','57014','57P01','P0001','P0002','P0003','XX000']);
const statuses = new Set(['acquired','busy','idle','backoff','selected','recorded','already-recorded','admitted','unbound','superseded',
  'progress','complete','partial','unavailable','changed','unchanged','replayed','stale','rejected','disabled','accepted','preserved']);
const reasons = new Set(['incomplete-source','stale-attempt','newer-attempt','mapping-changed','invalid-mapping',
  'mapping-generation-changed','source-mapping-changed','population-incomplete','source-incomplete']);
const resources = new Set(['identity','leagues','bootstrap','core','users']);
const expectedBoundaries = { 'admission-ack-loss': 'intake.admit', 'core-checkpoint-loss': 'intake.completeCore',
  'paired-cleanup-loss': 'intake.fail' } as const;
type ExpectedFault = keyof typeof expectedBoundaries;
type Failure = { phase: Phase; category: Category; sqlState: string | null; step: number; cycle: number };
type Event = { sequence: number; step: number; cycle: number; phase: Phase; event: 'start' | 'return' | 'error' | 'expected-error';
  elapsedMs: number; durationMs?: number; status?: string; resource?: string; reason?: string;
  acceptance?: Record<string, string>; category?: Category; sqlState?: string | null; fault?: ExpectedFault };
const MAX_EVENTS = 128;
const MAX_BYTES = 64 * 1024;
const artifactNames = { ordinary: 'public-data-ingestion-diagnostics.json', refresh: 'public-data-refresh-diagnostics.json' } as const;
const caseProfiles = { ordinary: 'data-core-ingestion-v1', refresh: 'data-core-refresh-v1' } as const;

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
      if (cause !== undefined) acceptance[key + 'Reason'] = typeof cause === 'string' && reasons.has(cause) ? cause : 'other';
    }
  }
  return { status: typeof status === 'string' && statuses.has(status) ? status : value === undefined ? 'void'
    : value === null ? 'missing' : value === true ? 'true' : value === false ? 'false' : 'other',
    ...(typeof resource === 'string' && resources.has(resource) ? { resource } : {}),
    ...(reason === undefined ? {} : { reason: typeof reason === 'string' && reasons.has(reason) ? reason : 'other' }),
    ...(Object.keys(acceptance).length ? { acceptance } : {}) };
}

/** Selected integration cases only. Observes maintained calls, never their arguments,
 * raw errors, SQL, identities, provider payloads or URLs. No persistence/worker behavior changes. */
export function createPublicDataDiagnostics(kind: 'ordinary' | 'refresh') {
  if (kind !== 'ordinary' && kind !== 'refresh') throw new Error('Public DATA diagnostic failure: invalid case kind.');
  const started = performance.now();
  const events: Event[] = [];
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
      && !['busy','backoff','idle'].includes(event.status ?? '')) lastCompletedBoundary = entry;
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
  return {
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
        const report = { ...this.snapshot(), caseKind: kind, contextDigest: qualificationDigest(binding.context),
          runId: binding.context.runId, gitSha: binding.context.gitSha, profile: binding.context.profile };
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
export function observePublicDataDependencies(d: Diagnostics, input: PublicIntakeDependencies & { refresh: PublicDataRefreshStore }): PublicIntakeDependencies & { refresh: PublicDataRefreshStore };
export function observePublicDataDependencies(d: Diagnostics, input: PublicIntakeDependencies): PublicIntakeDependencies;
export function observePublicDataDependencies(d: Diagnostics, input: Dependencies): Dependencies {
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
      recordObservation: (...a) => d.observe('administration.recordObservation', () => admin.recordObservation(...a)),
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
