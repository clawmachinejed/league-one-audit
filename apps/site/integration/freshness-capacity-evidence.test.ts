import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { bindCapacityManifest, type CapacitySource, type CapacityLane } from './freshness-capacity-manifest';
import { assertCapacityHttpEndpoint, evaluateCapacityEvidence, evaluateRequestEnvelope, summarizeCapacity, type CapacityEvidence,
  type HttpAttempt, type OriginObservation, type ResourceRead } from './freshness-capacity-evidence';

import { createCapacityFleetFixture } from './freshness-capacity-fixtures';

const start = 1_000_000_000;
// Synthetic witnesses test the offline arithmetic only. They are never SQL or elapsed-run evidence.
function fixture() {
  const fleet = createCapacityFleetFixture('synthetic-evaluator'), plan = fleet.prototype.plan;
  const bindings = fleet.prototype.events;
  const payload = (pairId: string, ordinal: number) => ordinal === 0
    ? bindings.find(row => row.id === pairId + '/event-1')!.before
    : bindings.find(row => row.id === pairId + '/event-' + ordinal)!.after;
  const source: CapacitySource = { readinessContractSha256: 'e'.repeat(64), acceptanceContractSha256: 'f'.repeat(64), plannedPostgresqlVersion: '18.6',
    gitSha: 'a'.repeat(40), appTreeSha: 'b'.repeat(40), fixtureSha256: fleet.digest, readerQueryMixSha256: 'd'.repeat(64),
    clockRefs: { wall: 'synthetic-wall', monotonic: 'synthetic-monotonic' }, cleanupPlanRef: 'synthetic-cleanup',
    requestOwners: ['ordinary-runner', 'independent-measurement'], unrelatedUsernames: [fleet.users[1].username, fleet.users[2].username],
    endpointInventory: fleet.endpointInventory, formatWitnesses: fleet.formatWitnesses,
    leagues: fleet.sourceLeagues, initialReaders: fleet.prototype.initialReaders };
  const manifest = bindCapacityManifest(plan, source, bindings, { kind: 'healthy' });
  const anchor = (pairId: string) => { const index = plan.pairs.findIndex(pair => pair.id === pairId);
    return start + (index < 32 ? 0 : 120_000 + index * 2_000 + 2); };
  const end = start + 246_002 + plan.observationHorizonMs;
  const attempts: HttpAttempt[] = [], origins: OriginObservation[] = [];
  for (const [index, pair] of plan.pairs.entries()) {
    const league = source.leagues.find(row => row.key === pair.leagueKey)!;
    const resource = pair.family === 'rosters' ? 'rosters' : pair.family === 'transactions' ? 'transactions/7' : 'matchups/7';
    for (let at = start - 240_000 + index * 2_000; at <= end - 1; at += 180_000) {
      if (index >= 32 && at < start + 60_010) continue;
      const ordinal = Math.max(0, Math.min(20, Math.floor((at - anchor(pair.id) - 60_000) / 360_000) + 1));
      const native = payload(pair.id, ordinal), id = `get-${attempts.length + 1}`;
      attempts.push({ id, method: 'GET', owner: 'ordinary-runner', sequence: attempts.length + 1, path: `/v1/league/${league.nativeLeagueId}/${resource}`,
        at, endedAt: at + 1, purpose: 'refresh', outcome: 'success', responseSha256: native.sha256 });
      origins.push({ id: `origin-${id}`, pairId: pair.id, version: native.version, payloadSha256: native.sha256,
        observedAt: at + 1, attemptId: id, kind: 'successful-provider-observation' });
    }
  }
  const read = (origin: OriginObservation, at: number): ResourceRead => ({ at, committed: true, storedOnly: true,
    version: origin.version, payloadSha256: origin.payloadSha256, originObservationId: origin.id });
  const evidence: CapacityEvidence = { manifestDigest: manifest.digest, startedAt: start, endedAt: end,
    intakes: (['intake-a', 'intake-b'] as const).map(cohort => ({ cohort, submittedAt: start + 60_000, acceptedAt: start + 60_010,
      receiptAt: start + 60_020, completeAt: start + 246_002, coverage: 'complete' })),
    firstAcceptances: plan.pairs.map(pair => ({ pairId: pair.id, at: anchor(pair.id),
      read: read(origins.find(origin => origin.pairId === pair.id && origin.version === payload(pair.id, 0).version)!, anchor(pair.id)),
      reader: source.initialReaders.find(row => row.pairId === pair.id)!.reader })),
    requests: { coverageStartedAt: start - 3_600_000, coverageEndedAt: end,
      ownerTotals: [{ owner: 'ordinary-runner', attempts: attempts.length }, { owner: 'independent-measurement', attempts: 0 }], attempts },
    origins, samples: plan.samples.map(slot => { const at = anchor(slot.pairId) + slot.offsetMs;
      const origin = origins.filter(origin => origin.pairId === slot.pairId && origin.observedAt <= at).at(-1)!;
      return { id: slot.id, at, status: 'available', read: read(origin, at + 10) }; }),
    events: plan.events.map(event => { const bound = bindings.find(row => row.id === event.id)!;
      const origin = origins.find(origin => origin.pairId === event.pairId && origin.version === bound.after.version)!;
      return { id: event.id, publishedAt: anchor(event.pairId) + event.offsetMs, read: read(origin, origin.observedAt + 10),
        reader: bound.expectedReader, retainedHistory: bound.retainedHistory }; }), outage: null };
  return { manifest, evidence, source, bindings, read };
}
const base = fixture();
function fresh() { return { manifest: base.manifest, evidence: structuredClone(base.evidence) }; }
function reportPost(attempt: HttpAttempt): HttpAttempt {
  const externalLeagueId = '123456789012345678', nativeWeek = 6;
  const body = JSON.stringify({ operationName: 'metadata', variables: {},
    query: `query metadata { metadata(type: "league_report", key: "${externalLeagueId}_${nativeWeek}") { key type data last_updated created } }` });
  return { ...attempt, method: 'POST', path: '/graphql', report: { family: 'weekly_report', externalLeagueId, nativeWeek,
    bodySha256: createHash('sha256').update(body).digest('hex') } };
}

describe('CP26 planned intake dispatch and actual SLA clocks', () => {
  it.each([-1, 0, 1, 1_000, 1_001])('retains planned dispatch and measures actual lateness of %i ms', offset => {
    const { manifest, evidence } = fresh(); const intake = evidence.intakes[0];
    intake.submittedAt += offset; intake.receiptAt! += offset; intake.acceptedAt! += offset; intake.completeAt! += offset;
    const report = evaluateCapacityEvidence(manifest, evidence);
    expect(report.intakes[0]).toMatchObject({ scheduledAt: start + 60_000, submittedAt: start + 60_000 + offset,
      dispatchLatenessMs: offset, dispatchPass: offset >= 0 && offset <= 1_000,
      receiptMs: 20, importMs: 185_992, pass: offset >= 0 && offset <= 1_000 });
    expect(report.pairs[0].sampleTiming[0].scheduledAt).toBe(start + 60_000);
  });
  it.each([2_000, 2_001])('measures the receipt gate from actual submission with %i ms duration', elapsed => {
    const { manifest, evidence } = fresh(); const intake = evidence.intakes[0];
    intake.submittedAt += 1_000; intake.acceptedAt = intake.submittedAt + 10; intake.receiptAt = intake.submittedAt + elapsed;
    expect(evaluateCapacityEvidence(manifest, evidence).intakes[0]).toMatchObject({
      dispatchPass: true, dispatchLatenessMs: 1_000, receiptMs: elapsed, pass: elapsed <= 2_000 });
  });
  it.each([14_400_000, 14_400_001])('measures the import gate from actual acceptance with %i ms duration', elapsed => {
    const { manifest, evidence } = fresh(); const intake = evidence.intakes[0];
    intake.submittedAt += 1_000; intake.acceptedAt = intake.submittedAt + 10; intake.receiptAt = intake.submittedAt + 20;
    intake.completeAt = intake.acceptedAt + elapsed; evidence.endedAt = intake.completeAt + 1;
    evidence.requests.coverageEndedAt = evidence.endedAt;
    expect(evaluateCapacityEvidence(manifest, evidence).intakes[0]).toMatchObject({
      dispatchPass: true, receiptMs: 20, importMs: elapsed, pass: elapsed <= 14_400_000 });
  });
  it('retains a missing intake as a failed planned dispatch', () => {
    const { manifest, evidence } = fresh(); evidence.intakes.shift();
    expect(evaluateCapacityEvidence(manifest, evidence).intakes[0]).toMatchObject({
      scheduledAt: start + 60_000, submittedAt: null, dispatchLatenessMs: null, dispatchPass: false,
      receiptMs: 'infinity', importMs: 'infinity', pass: false });
  });
  it.each([undefined, NaN, Infinity])('rejects a missing or nonfinite actual dispatch clock: %s', submittedAt => {
    const { manifest, evidence } = fresh(); Object.assign(evidence.intakes[0], { submittedAt });
    expect(() => evaluateCapacityEvidence(manifest, evidence)).toThrow();
  });
});

describe('CP26 denominator and correctness reconciliation', () => {
  it('passes the bounded synthetic arithmetic without claiming actual CP26 qualification', () => {
    const report = evaluateCapacityEvidence(base.manifest, base.evidence);
    expect(report.offlineChecksPass).toBe(true); expect(report.pairs).toHaveLength(64);
    expect(report.pairs.every(row => row.sourceAge.scheduled === 121 && row.visibility.scheduled === 20)).toBe(true);
    expect(report.pairs[0].sampleTiming[0]).toMatchObject({ scheduledAt: start + 60_000, startedAt: start + 60_000, endedAt: start + 60_010, dispatchLatenessMs: 0 });
    expect(report.requestEnvelope.getEnvelope.minutePeak).toBeLessThanOrEqual(40);
    expect(report.checkpoint26Qualified).toBe(false); expect(report.executionReady).toBe(false);
    expect(report.externalEvidenceRequired.join(' ')).toMatch(/Real elapsed/);
  });
  it('keeps one missing intended version in the denominator and fails correctness even though p95 passes', () => {
    const { manifest, evidence } = fresh(); evidence.events.splice(19, 1);
    const report = evaluateCapacityEvidence(manifest, evidence), pair = report.pairs[0];
    expect(pair.visibility).toMatchObject({ scheduled: 20, observed: 19, failures: 1, p99Ms: 'infinity', maxMs: 'infinity' });
    expect(pair.visibilityPass).toBe(true); expect(pair.correctnessPass).toBe(false); expect(report.offlineChecksPass).toBe(false);
    expect(JSON.parse(JSON.stringify(report)).pairs[0].visibility.maxMs).toBe('infinity');
  });
  it.each(['missing', 'timeout', 'unavailable', 'late-dispatch', 'read-timeout', 'read-after-end'] as const)('preserves failed sample denominator: %s', failure => {
    const { manifest, evidence } = fresh();
    const sample = evidence.samples[0];
    if (failure === 'missing') evidence.samples.shift();
    if (failure === 'timeout' || failure === 'unavailable') sample.status = failure;
    if (failure === 'late-dispatch') { sample.at += 1_001; sample.read!.at = sample.at + 10; }
    if (failure === 'read-timeout') sample.read!.at = sample.at + 60_001;
    if (failure === 'read-after-end') sample.read!.at = evidence.endedAt + 1;
    const result = evaluateCapacityEvidence(manifest, evidence).pairs[0];
    expect(result.sourceAge).toMatchObject({ scheduled: 121, observed: 120, failures: 1, maxMs: 'infinity' });
  });
  it('uses actual read completion for source age and accepts dispatch within the frozen tolerance', () => {
    const { manifest, evidence } = fresh(); const sample = evidence.samples[0];
    sample.at += 1_000; sample.read!.at += 59_990;
    const origin = evidence.origins.find(row => row.id === sample.read!.originObservationId)!;
    const result = evaluateCapacityEvidence(manifest, evidence).pairs[0];
    expect(result.sourceAge.maxMs).toBeGreaterThanOrEqual(sample.read!.at - origin.observedAt);
    expect(result.sourceAge.failures).toBe(0);
  });
  it('cannot pool away one stale pair or remove healthy incidental failures', () => {
    const { manifest, evidence } = fresh(); const initial = evidence.firstAcceptances[0].read;
    for (const sample of evidence.samples.filter(row => row.id.startsWith('league-01/rosters/'))) sample.read = { ...initial, at: sample.at + 10 };
    const report = evaluateCapacityEvidence(manifest, evidence);
    expect(report.pairs[0].healthyFreshnessPass).toBe(false);
    expect(report.pairs.slice(1).every(pair => pair.healthyFreshnessPass)).toBe(true);
    expect(report.offlineChecksPass).toBe(false);
  });
  it.each(['later-head', 'wrong-value', 'wrong-history', 'not-committed', 'provider-reader', 'string-false', 'numeric-true', 'wrong-publication'] as const)('rejects incorrect intended-version evidence: %s', failure => {
    const { manifest, evidence } = fresh(), event = evidence.events[0];
    if (failure === 'later-head') event.read = evidence.events[1].read;
    if (failure === 'wrong-value') event.reader!.value = { raw: 0, custom: 0, effective: 0 };
    if (failure === 'wrong-history') event.retainedHistory[0].value = 999;
    if (failure === 'not-committed') event.read!.committed = false;
    if (failure === 'provider-reader') event.read!.storedOnly = false;
    if (failure === 'string-false') Object.assign(event.read!, { committed: 'false', storedOnly: 'false' });
    if (failure === 'numeric-true') Object.assign(event.read!, { committed: 1, storedOnly: 1 });
    if (failure === 'wrong-publication') event.publishedAt++;
    expect(evaluateCapacityEvidence(manifest, evidence).pairs[0].incorrectEvents).toContain(event.id);
  });
  it.each(['duplicate-sample', 'unknown-sample', 'duplicate-event', 'wrong-manifest', 'cache-reset', 'wrong-origin-time', 'wrong-endpoint', 'future-version', 'stale-new-observation', 'prefetched-intake', 'nan'] as const)('rejects malformed/drifting evidence: %s', failure => {
    const { manifest, evidence } = fresh();
    if (failure === 'duplicate-sample') evidence.samples.push(evidence.samples[0]);
    if (failure === 'unknown-sample') evidence.samples[0].id = 'rescheduled-success';
    if (failure === 'duplicate-event') evidence.events.push(evidence.events[0]);
    if (failure === 'wrong-manifest') evidence.manifestDigest = '0'.repeat(64);
    if (failure === 'cache-reset') Object.assign(evidence.origins[0], { kind: 'cache-hit' });
    if (failure === 'wrong-origin-time') evidence.origins[0].observedAt++;
    if (failure === 'wrong-endpoint') evidence.requests.attempts[0].path = '/v1/league/unrelated/rosters';
    if (failure === 'future-version') {
      const origin = evidence.origins.find(row => row.version === manifest.events[0].after.version)!;
      const attempt = evidence.requests.attempts.find(row => row.id === origin.attemptId)!;
      origin.observedAt = start; attempt.endedAt = start; attempt.at = start - 1;
    }
    if (failure === 'stale-new-observation') {
      const origin = evidence.origins[1], attempt = evidence.requests.attempts.find(row => row.id === origin.attemptId)!;
      origin.observedAt = evidence.endedAt - 1; attempt.at = evidence.endedAt - 2; attempt.endedAt = origin.observedAt;
    }
    if (failure === 'prefetched-intake') {
      const origin = evidence.origins.find(row => row.pairId === 'league-09/rosters')!;
      const attempt = evidence.requests.attempts.find(row => row.id === origin.attemptId)!;
      attempt.at = start; attempt.endedAt = start + 1; origin.observedAt = start + 1;
    }
    if (failure === 'nan') evidence.samples[0].at = NaN;
    expect(() => evaluateCapacityEvidence(manifest, evidence)).toThrow();
  });
  it('fails accepted-head regression independently of complete intended-version evidence', () => {
    const { manifest, evidence } = fresh();
    const sample = evidence.samples.find(row => row.id === 'league-01/rosters/sample-4')!;
    sample.read = { ...evidence.firstAcceptances[0].read, at: sample.at + 10 };
    const report = evaluateCapacityEvidence(manifest, evidence);
    expect(report.pairs[0].correctnessPass).toBe(true);
    expect(report.errors).toContain('accepted head regression: league-01/rosters'); expect(report.offlineChecksPass).toBe(false);
  });
  it('does not allow a successful report POST to reset active resource freshness', () => {
    const { manifest, evidence } = fresh(); evidence.requests.attempts[0] = reportPost(evidence.requests.attempts[0]);
    expect(() => evaluateCapacityEvidence(manifest, evidence)).toThrow('origin needs successful GET attempt');
  });
  it('does not hide import failure behind new-cohort freshness', () => {
    const { manifest, evidence } = fresh(); evidence.intakes[0].coverage = 'incomplete';
    expect(evaluateCapacityEvidence(manifest, evidence).intakes[0].pass).toBe(false);
  });
  it('does not accept a shifted first-acceptance anchor', () => {
    const { manifest, evidence } = fresh(); evidence.firstAcceptances[32].at--;
    expect(evaluateCapacityEvidence(manifest, evidence).errors).toContain('unproved first acceptance: league-09/rosters');
  });
  it('records missing acceptance, missing intake and a truncated horizon as failures', () => {
    const { manifest, evidence } = fresh(); evidence.firstAcceptances.pop(); evidence.intakes.pop(); evidence.endedAt--;
    const report = evaluateCapacityEvidence(manifest, evidence);
    expect(report.errors.length).toBeGreaterThan(0); expect(report.intakes[1].pass).toBe(false); expect(report.offlineChecksPass).toBe(false);
  });
});

describe('nearest-rank and method-aware shared rolling HTTP envelopes', () => {
  it('orders explicit infinity and rejects empty/negative/nonfinite data', () => {
    expect(summarizeCapacity([...Array<number>(19).fill(10), 'infinity'])).toMatchObject({ p50Ms: 10, p95Ms: 10, p99Ms: 'infinity' });
    for (const values of [[], [-1], [NaN], [Infinity]]) expect(() => summarizeCapacity(values)).toThrow();
  });
  function ledger(times: number[]) {
    const attempts: HttpAttempt[] = times.map((offset, index) => ({ id: `attempt-${index}`, method: 'GET', owner: index % 2 ? 'other-owner' : 'independent-measurement',
      sequence: Math.floor(index / 2) + 1, path: '/v1/league/shared/rosters', at: start + offset, endedAt: start + offset,
      purpose: index % 3 === 0 ? 'retry' : index % 3 === 1 ? 'redirect' : 'independent-measurement', outcome: 'failed', responseSha256: null }));
    return { coverageStartedAt: start - 3_600_000, coverageEndedAt: start + 7_200_000,
      ownerTotals: [{ owner: 'independent-measurement', attempts: Math.ceil(times.length / 2) }, { owner: 'other-owner', attempts: Math.floor(times.length / 2) }], attempts };
  }
  const owners = ['independent-measurement', 'other-owner'];
  it('counts failures, retries, redirects and independent GETs across owners and exact rolling boundaries', () => {
    const times = [...Array<number>(40).fill(0), 59_999];
    expect(evaluateRequestEnvelope(owners, ledger(times), start, start + 7_200_000)).toMatchObject({ totalAttempts: 41, getEnvelope: { minutePeak: 41, pass: false }, allHttpEnvelope: { minutePeak: 41, pass: false }, pass: false });
    times[40] = 60_000;
    expect(evaluateRequestEnvelope(owners, ledger(times), start, start + 7_200_000).pass).toBe(true);
  });
  it('rejects hourly overflow even when each minute fits', () => {
    const times = Array.from({ length: 1_801 }, (_, index) => index * 1_999);
    const report = evaluateRequestEnvelope(owners, ledger(times), start, start + 7_200_000);
    expect(report.getEnvelope.minutePeak).toBeLessThanOrEqual(40); expect(report.getEnvelope.hourPeak).toBe(1_801); expect(report.pass).toBe(false);
  });
  it('detects missing attempts/owners/lookback rather than trusting a successful subset', () => {
    const rows = ledger([0, 1, 2]); rows.attempts.splice(0, 1); rows.ownerTotals.pop(); rows.coverageStartedAt = start;
    const result = evaluateRequestEnvelope(owners, rows, start, start + 7_200_000);
    expect(result.errors).toHaveLength(4); expect(result.pass).toBe(false);
  });
  it('counts a shared HTTP attempt once and rejects duplicate IDs', () => {
    const rows = ledger([0]); expect(evaluateRequestEnvelope(owners, rows, start, start + 7_200_000).totalAttempts).toBe(1);
    rows.attempts.push(rows.attempts[0]); expect(() => evaluateRequestEnvelope(owners, rows, start, start + 7_200_000)).toThrow();
  });
  it('preserves the CP1 GET result while a mixed GET/POST burst exceeds the candidate all-HTTP limit', () => {
    const rows = ledger(Array<number>(41).fill(0));
    rows.attempts = rows.attempts.map((attempt, index) => index < 30 ? attempt : reportPost(attempt));
    const result = evaluateRequestEnvelope(owners, rows, start, start + 7_200_000);
    expect(result).toMatchObject({ totalAttempts: 41, byMethod: { GET: { totalAttempts: 30 }, POST: { totalAttempts: 11 } },
      getEnvelope: { policy: 'cp1-get-envelope', minutePeak: 30, pass: true },
      allHttpEnvelope: { policy: 'candidate-all-http-envelope', minutePeak: 41, pass: false }, pass: false });
    expect(Object.values(result.byPurpose).reduce((sum, count) => sum + count, 0)).toBe(41);
  });
  it('charges failed POSTs, timeouts and retries in hourly and exact-boundary demand', () => {
    const rows = ledger(Array.from({ length: 1_801 }, (_, index) => index * 1_999));
    rows.attempts = rows.attempts.map((attempt, index) => index % 2 ? { ...reportPost(attempt), outcome: 'timeout' } : attempt);
    const result = evaluateRequestEnvelope(owners, rows, start, start + 7_200_000);
    expect(result.getEnvelope).toMatchObject({ totalAttempts: 901, pass: true });
    expect(result.byMethod.POST).toMatchObject({ totalAttempts: 900 });
    expect(result.allHttpEnvelope).toMatchObject({ hourPeak: 1_801, pass: false });
    const edge = ledger([...Array<number>(40).fill(0), 60_000]);
    edge.attempts[40] = reportPost(edge.attempts[40]);
    expect(evaluateRequestEnvelope(owners, edge, start, start + 7_200_000).allHttpEnvelope).toMatchObject({ minutePeak: 40, pass: true });
    edge.attempts[40].at--; edge.attempts[40].endedAt--;
    expect(evaluateRequestEnvelope(owners, edge, start, start + 7_200_000).allHttpEnvelope).toMatchObject({ minutePeak: 41, pass: false });
  });
  it.each(['missing-method', 'unknown-method', 'get-report', 'post-get-path', 'post-missing-binding', 'post-wrong-family',
    'post-wrong-league', 'post-wrong-week', 'post-invalid-week', 'post-wrong-body'] as const)('rejects incomplete method/resource evidence: %s', failure => {
    const rows = ledger([0]);
    if (failure.startsWith('post-')) rows.attempts[0] = reportPost(rows.attempts[0]);
    const row = rows.attempts[0];
    if (failure === 'missing-method') Reflect.deleteProperty(row, 'method');
    if (failure === 'unknown-method') Object.assign(row, { method: 'HEAD' });
    if (failure === 'get-report') Object.assign(row, { report: null });
    if (failure === 'post-get-path') row.path = '/v1/league/123/rosters';
    if (failure === 'post-missing-binding') Reflect.deleteProperty(row, 'report');
    if (row.method === 'POST') {
      if (failure === 'post-wrong-family') Object.assign(row.report, { family: 'rosters' });
      if (failure === 'post-wrong-league') row.report.externalLeagueId = '987654321';
      if (failure === 'post-wrong-week') row.report.nativeWeek++;
      if (failure === 'post-invalid-week') row.report.nativeWeek = 0;
      if (failure === 'post-wrong-body') row.report.bodySha256 = 'f'.repeat(64);
    }
    expect(() => evaluateRequestEnvelope(owners, rows, start, start + 7_200_000)).toThrow();
  });
  it('does not treat missing POST accounting as a complete GET-only ledger', () => {
    const rows = ledger([0, 1, 2]); rows.attempts[1] = reportPost(rows.attempts[1]); rows.attempts.splice(1, 1);
    const result = evaluateRequestEnvelope(owners, rows, start, start + 7_200_000);
    expect(result.errors).toContain('missing transport attempts: other-owner');
    expect(result.getEnvelope.pass).toBe(false); expect(result.allHttpEnvelope.pass).toBe(false);
  });
});

describe('declared outage and complete backlog recovery', () => {
  function buildOutageFixture() {
    const { source, bindings, read } = base;
    const lane: CapacityLane = { kind: 'outage', startOffsetMs: 1_800_000, durationMs: 1_800_000, dependency: 'provider',
      backlog: [{ id: 'queued-first', pairId: base.manifest.plan.pairs[0].id, reader: bindings[10].expectedReader }],
      lastGood: base.manifest.plan.pairs.map(pair => { const event = base.evidence.events.filter(row => row.id.startsWith(`${pair.id}/`)
        && row.read!.at < start + 1_800_000).at(-1)!;
        return { pairId: pair.id, reader: event.reader!, payloadSha256: event.read!.payloadSha256 }; }) };
    const manifest = bindCapacityManifest(base.manifest.plan, source, bindings, lane);
    const evidence = structuredClone(base.evidence); evidence.manifestDigest = manifest.digest;
    const restoredAt = start + 3_600_000;
    // Missing intermediate versions during outage stay missing. Recovery alone cannot qualify this healthy event inventory.
    evidence.events = evidence.events.filter(row => row.read!.at < start + 1_800_000 || row.read!.at >= restoredAt);
    const during = (at: number) => at >= start + 1_800_000 && at < restoredAt;
    evidence.requests.attempts = evidence.requests.attempts.filter(row => !during(row.endedAt));
    evidence.requests.attempts.forEach((row, index) => { row.sequence = index + 1; });
    evidence.requests.ownerTotals[0].attempts = evidence.requests.attempts.length;
    evidence.origins = evidence.origins.filter(row => !during(row.observedAt));
    evidence.outage = { startedAt: start + 1_800_000, dependencyRestoredAt: restoredAt, runnerRestoredAt: restoredAt,
      recovered: manifest.plan.pairs.map(pair => { const origin = evidence.origins.find(origin => origin.pairId === pair.id && origin.observedAt >= restoredAt)!;
        return { pairId: pair.id, read: read(origin, origin.observedAt + 10) }; }),
      lastGood: lane.lastGood.map(expected => { const origin = evidence.origins.find(origin => origin.pairId === expected.pairId && origin.version === expected.reader.version)!;
        return { pairId: expected.pairId, before: { read: read(origin, start + 1_800_000 - 1), reader: expected.reader },
          during: { read: read(origin, start + 1_800_000 + 1), reader: expected.reader } }; }),
      backlog: [{ id: 'queued-first', queuedAt: start + 1_800_000, read: evidence.events.find(row => row.id === bindings[10].id)!.read,
        reader: bindings[10].expectedReader }] };
    return { manifest, evidence: structuredClone(evidence) };
  }
  // Build the immutable full-source variants once; each assertion gets independent mutable evidence.
  const outageBase = buildOutageFixture();
  function outageFixture() { return { manifest: outageBase.manifest, evidence: structuredClone(outageBase.evidence) }; }
  if (outageBase.manifest.lane.kind !== 'outage') throw new Error('expected outage fixture');
  const staleLane = structuredClone(outageBase.manifest.lane), initialWitness = outageBase.evidence.firstAcceptances[0];
  staleLane.lastGood[0] = { pairId: initialWitness.pairId, reader: structuredClone(initialWitness.reader), payloadSha256: initialWitness.read.payloadSha256 };
  const staleInitialManifest = bindCapacityManifest(outageBase.manifest.plan, outageBase.manifest.source, outageBase.manifest.events, staleLane);
  const backlogLane = structuredClone(outageBase.manifest.lane), recoveredVersion = outageBase.evidence.outage!.recovered[0].read.version;
  backlogLane.backlog[0].reader = structuredClone(outageBase.manifest.events.find(row => row.after.version === recoveredVersion && row.id.startsWith('league-01/rosters/'))!.expectedReader);
  const staleBacklogManifest = bindCapacityManifest(outageBase.manifest.plan, outageBase.manifest.source, outageBase.manifest.events, backlogLane);
  it('separates outage-inclusive lag from healthy targets and requires fresh reads plus all queued results', () => {
    const { manifest, evidence } = outageFixture();
    const report = evaluateCapacityEvidence(manifest, evidence);
    expect(report.healthyFreshnessPass).toBeNull(); expect(report.outage?.pass).toBe(true);
    expect(report.offlineChecksPass).toBe(false); expect(report.pairs[0].incorrectEvents.length).toBeGreaterThan(0);
  });
  it.each(['stale-recovery', 'missing-pair', 'missing-backlog', 'wrong-backlog-value', 'uncommitted-backlog', 'wrong-last-good', 'history-outside-outage'] as const)('fails incomplete recovery: %s', failure => {
    const { manifest, evidence } = outageFixture(), outage = evidence.outage!;
    if (failure === 'stale-recovery') outage.recovered[0].read = { ...evidence.firstAcceptances[0].read, at: start + 3_600_010 };
    if (failure === 'missing-pair') outage.recovered.pop();
    if (failure === 'missing-backlog') outage.backlog.pop();
    if (failure === 'wrong-backlog-value') outage.backlog[0].reader!.value = 999;
    if (failure === 'uncommitted-backlog') outage.backlog[0].read!.committed = false;
    if (failure === 'wrong-last-good') outage.lastGood[0].during.reader.value = 999;
    if (failure === 'history-outside-outage') outage.lastGood[0].during.read.at = start;
    expect(evaluateCapacityEvidence(manifest, evidence).outage?.pass).toBe(false);
  });
  it('rejects a frozen v0 last-good witness after committed v5 was already observed', () => {
    const { manifest, evidence } = outageFixture();
    if (manifest.lane.kind !== 'outage') throw new Error('expected outage fixture');
    const lane = structuredClone(manifest.lane), initial = evidence.firstAcceptances[0];
    lane.lastGood[0] = { pairId: initial.pairId, reader: structuredClone(initial.reader), payloadSha256: initial.read.payloadSha256 };
    const rebound = staleInitialManifest;
    expect(lane).toEqual(rebound.lane);
    evidence.manifestDigest = rebound.digest;
    const witness = evidence.outage!.lastGood[0];
    for (const snapshot of [witness.before, witness.during]) {
      snapshot.read = { ...initial.read, at: snapshot.read.at }; snapshot.reader = structuredClone(initial.reader);
    }
    const report = evaluateCapacityEvidence(rebound, evidence);
    expect(report.errors).toContain('accepted head regression: league-01/rosters');
    expect(report.outage).toMatchObject({ lastGoodPreserved: false, pass: false });
  });
  it.each(['recovered-head', 'backlog-head'] as const)('rejects a stale %s after a newer accepted head', failure => {
    const { manifest, evidence } = outageFixture(), row = evidence.outage!;
    const current = row.recovered[0].read;
    // The next controlled version is already committed, yet this witness claims the old head within five minutes.
    const next = evidence.events.find(event => event.id.startsWith('league-01/rosters/')
      && event.read!.at > current.at && event.read!.version !== current.version)!;
    const late = { ...current, at: next.read!.at + 1 };
    if (failure === 'recovered-head') row.recovered[0].read = late;
    else {
      if (manifest.lane.kind !== 'outage') throw new Error('expected outage fixture');
      const lane = structuredClone(manifest.lane);
      const expected = manifest.events.find(event => event.after.version === current.version && event.id.startsWith('league-01/rosters/'))!.expectedReader;
      lane.backlog[0].reader = structuredClone(expected);
      const rebound = staleBacklogManifest;
      expect(lane).toEqual(rebound.lane);
      row.backlog[0].reader = structuredClone(expected); row.backlog[0].read = late;
      evidence.manifestDigest = rebound.digest;
      const report = evaluateCapacityEvidence(rebound, evidence);
      expect(report.errors).toContain('accepted head regression: league-01/rosters'); expect(report.outage?.pass).toBe(false); return;
    }
    const report = evaluateCapacityEvidence(manifest, evidence);
    expect(report.errors).toContain('accepted head regression: league-01/rosters'); expect(report.outage?.pass).toBe(false);
  });
  it('starts recovery only when the dependency and runner are both available', () => {
    const { manifest, evidence } = outageFixture(); evidence.outage!.runnerRestoredAt += 600_000;
    expect(evaluateCapacityEvidence(manifest, evidence).outage?.recoveryMs).toBe('infinity');
  });
  it('rejects a fake provider outage with successful GETs', () => {
    const { manifest, evidence } = outageFixture();
    const provider = manifest; // The prebound lane already declares this exact provider outage.
    evidence.manifestDigest = provider.digest;
    const successful = structuredClone(base.evidence.requests.attempts.find(row => row.endedAt >= start + 1_800_000 && row.endedAt < start + 3_600_000)!);
    successful.sequence = evidence.requests.attempts.length + 1; evidence.requests.attempts.push(successful); evidence.requests.ownerTotals[0].attempts++;
    expect(() => evaluateCapacityEvidence(provider, evidence)).toThrow(/successful provider HTTP attempt/);
  });
  it('rejects an undeclared healthy exclusion with successful GETs', () => {
    const { evidence } = outageFixture();
    const successful = structuredClone(base.evidence.requests.attempts.find(row => row.endedAt >= start + 1_800_000 && row.endedAt < start + 3_600_000)!);
    successful.sequence = evidence.requests.attempts.length + 1; evidence.requests.attempts.push(successful); evidence.requests.ownerTotals[0].attempts++;
    evidence.manifestDigest = base.manifest.digest;
    expect(() => evaluateCapacityEvidence(base.manifest, evidence)).toThrow(/undeclared outage/);
  });
});

describe('explicit Sleeper provider origins and maintained native routes', () => {
  const attempt = (origin: string | undefined, path: string): HttpAttempt => ({ id: 'native-request', owner: 'primary', sequence: 1,
    method: 'GET', ...(origin === undefined ? {} : { origin }), path, at: start, endedAt: start, purpose: 'other',
    outcome: 'failed', responseSha256: null });
  it.each([
    ['https://api.sleeper.app', '/v1/state/nfl'],
    ['https://api.sleeper.app', '/v1/user/cp26_manager'],
    ['https://api.sleeper.app', '/v1/user/123/leagues/nfl/2026'],
    ['https://api.sleeper.app', '/v1/league/123'],
    ['https://api.sleeper.app', '/v1/league/123/rosters'],
    ['https://api.sleeper.app', '/v1/league/123/users'],
    ['https://api.sleeper.app', '/v1/league/123/matchups/18'],
    ['https://api.sleeper.app', '/v1/league/123/transactions/0'],
    ['https://api.sleeper.app', '/v1/league/123/winners_bracket'],
    ['https://api.sleeper.app', '/v1/league/123/losers_bracket'],
    ['https://api.sleeper.app', '/v1/league/123/traded_picks'],
    ['https://api.sleeper.app', '/v1/league/123/drafts'],
    ['https://api.sleeper.app', '/v1/draft/native-draft_1'],
    ['https://api.sleeper.app', '/v1/draft/native-draft_1/picks'],
    ['https://api.sleeper.app', '/v1/draft/native-draft_1/traded_picks'],
    ['https://api.sleeper.app', '/v1/players/nfl'],
    ...['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].map(position => ['https://api.sleeper.app', '/v1/players/nfl?position=' + position]),
    ['https://api.sleeper.app', '/v1/stats/nfl/regular/2026/6'],
    ['https://api.sleeper.com', '/schedule/nfl/regular/2026'],
    ['https://api.sleeper.com', '/scores/nfl/regular/2026/6'],
  ])('binds the maintained %s%s request', (origin, path) => {
    expect(() => assertCapacityHttpEndpoint(attempt(origin, path), true)).not.toThrow();
  });
  it.each([
    ['https://evil.example', '/v1/state/nfl'], ['http://api.sleeper.app', '/v1/state/nfl'],
    ['https://api.sleeper.app:443', '/v1/state/nfl'], ['https://user@api.sleeper.app', '/v1/state/nfl'],
    ['https://api.sleeper.app', '//evil.example/v1/state/nfl'], ['https://api.sleeper.app', '/v1/league/123/../123'],
    ['https://api.sleeper.app', '/v1/league/%31%32%33'], ['https://api.sleeper.app', '/v1/league/123#fragment'],
    ['https://api.sleeper.app', '/v1/league/123?unused=1'], ['https://api.sleeper.app', '/v1/players/nfl?position=QB&position=RB'],
    ['https://api.sleeper.app', '/v1/players/nfl?position=qb'], ['https://api.sleeper.app', '/v1/players/nfl?position=QB&extra=1'],
    ['https://api.sleeper.app', '/v1/league/123/matchups/0'], ['https://api.sleeper.app', '/v1/league/123/transactions/19'],
    ['https://api.sleeper.app', '/v1/user/123/leagues/nfl/2025'], ['https://api.sleeper.app', '/v1/not-maintained'],
    ['https://api.sleeper.com', '/v1/state/nfl'], ['https://api.sleeper.app', '/schedule/nfl/regular/2026'],
    ['https://api.sleeper.com', '/schedule/nfl/regular/2026?x=1'], ['https://api.sleeper.com', '/scores/nfl/regular/2026/19'],
    ['https://sleeper.com', '/v1/state/nfl'], ['https://api.sleeper.app', '/graphql'],
  ])('rejects unbound provider or route %s%s', (origin, path) => {
    expect(() => assertCapacityHttpEndpoint(attempt(origin, path), true)).toThrow();
  });
  it('preserves legacy path-only arithmetic while making its missing origin explicit', () => {
    const row = attempt(undefined, '/v1/league/legacy-label/rosters');
    expect(() => assertCapacityHttpEndpoint(row)).not.toThrow();
    expect(() => assertCapacityHttpEndpoint(row, true)).toThrow('explicit provider origin');
    const result = evaluateRequestEnvelope(['primary'], { coverageStartedAt: start - 3_600_000, coverageEndedAt: start,
      ownerTotals: [{ owner: 'primary', attempts: 1 }], attempts: [row] }, start, start);
    expect(result).toMatchObject({ pass: true, originBinding: { boundAttempts: 0, unboundAttempts: 1, complete: false } });
  });
  it('charges calendar, score, catalog and failed requests in the same unchanged envelope', () => {
    const rows = Array.from({ length: 41 }, (_, index) => ({ ...attempt(index % 2 ? 'https://api.sleeper.app' : 'https://api.sleeper.com',
      index % 2 ? '/v1/players/nfl?position=QB' : '/scores/nfl/regular/2026/6'), id: 'physical-' + index, sequence: index + 1 }));
    const result = evaluateRequestEnvelope(['primary'], { coverageStartedAt: start - 3_600_000, coverageEndedAt: start,
      ownerTotals: [{ owner: 'primary', attempts: rows.length }], attempts: rows }, start, start);
    expect(result).toMatchObject({ totalAttempts: 41, originBinding: { boundAttempts: 41, unboundAttempts: 0, complete: true },
      getEnvelope: { minutePeak: 41, pass: false }, allHttpEnvelope: { minutePeak: 41, pass: false }, pass: false });
  });
  it('requires the exact report origin as well as its existing native body binding', () => {
    const row = { ...reportPost(attempt(undefined, '/v1/state/nfl')), origin: 'https://sleeper.com' };
    expect(() => assertCapacityHttpEndpoint(row, true)).not.toThrow();
    expect(() => assertCapacityHttpEndpoint({ ...row, origin: 'https://api.sleeper.app' }, true)).toThrow('report provider binding');
  });
});
describe('reviewed DATA budget with separately reported existing owners', () => {
  const policy = 'cp1-data-with-separate-existing-owners-v1' as const;
  const owners = ['data-refresh', 'primary-projection', 'administration-maintenance', 'independent-measurement'];
  function ledger(groups: { owner: string; count: number; offset?: (index: number) => number; post?: boolean }[]) {
    const attempts: HttpAttempt[] = [];
    for (const group of groups) for (let index = 0; index < group.count; index++) {
      const at = start + (group.offset?.(index) ?? 0);
      const row: HttpAttempt = { id: 'budget-' + attempts.length, owner: group.owner,
        sequence: attempts.filter(item => item.owner === group.owner).length + 1, method: 'GET',
        origin: 'https://api.sleeper.app', path: '/v1/state/nfl', at, endedAt: at,
        purpose: 'other', outcome: index % 2 ? 'timeout' : 'failed', responseSha256: null };
      attempts.push(group.post ? { ...reportPost(row), origin: 'https://sleeper.com' } : row);
    }
    return { coverageStartedAt: start - 3_600_000, coverageEndedAt: start + 7_200_000,
      ownerTotals: owners.map(owner => ({ owner, attempts: attempts.filter(row => row.owner === owner).length })), attempts };
  }
  const evaluate = (rows: ReturnType<typeof ledger>) => evaluateRequestEnvelope(owners, rows, start, start + 7_200_000, policy);
  it('retains all physical traffic while gating DATA and measurement at the unchanged ceilings', () => {
    const rows = ledger([{ owner: 'data-refresh', count: 39 }, { owner: 'independent-measurement', count: 1 },
      { owner: 'primary-projection', count: 60 }, { owner: 'administration-maintenance', count: 31 }]);
    const result = evaluate(rows);
    expect(result).toMatchObject({ totalAttempts: 131, budgetPolicy: policy, gatedOwners: ['data-refresh', 'independent-measurement'],
      getEnvelope: { totalAttempts: 40, minutePeak: 40, pass: true }, allHttpEnvelope: { totalAttempts: 40, pass: true },
      combined: { GET: { totalAttempts: 131, minutePeak: 131 }, POST: { totalAttempts: 0 }, allHTTP: { totalAttempts: 131, minutePeak: 131 } }, pass: true });
    expect(result.byOwner.map(row => [row.owner, row.allHTTP.totalAttempts, row.allHTTP.minutePeak])).toEqual([
      ['data-refresh', 39, 39], ['primary-projection', 60, 60], ['administration-maintenance', 31, 31], ['independent-measurement', 1, 1]]);
    expect(evaluateRequestEnvelope(owners, rows, start, start + 7_200_000)).toMatchObject({ budgetPolicy: 'legacy-combined-candidate', pass: false });
  });
  it('charges measurement, failed requests and arbitrary purposes to DATA without subtracting existing owners', () => {
    const rows = ledger([{ owner: 'data-refresh', count: 40 }, { owner: 'independent-measurement', count: 1 },
      { owner: 'primary-projection', count: 2 }]);
    rows.attempts.forEach((row, index) => { row.purpose = index % 2 ? 'redirect' : 'retry'; });
    expect(evaluate(rows)).toMatchObject({ getEnvelope: { minutePeak: 41, pass: false }, allHttpEnvelope: { minutePeak: 41, pass: false }, pass: false });
  });
  it('keeps POSTs separate in the DATA GET metric and charged to the conservative DATA all-HTTP ceiling', () => {
    const rows = ledger([{ owner: 'data-refresh', count: 30 }, { owner: 'data-refresh', count: 11, post: true },
      { owner: 'administration-maintenance', count: 50, post: true }]);
    const result = evaluate(rows);
    expect(result).toMatchObject({ getEnvelope: { minutePeak: 30, pass: true }, allHttpEnvelope: { minutePeak: 41, pass: false },
      combined: { POST: { totalAttempts: 61 }, allHTTP: { totalAttempts: 91 } }, pass: false });
    expect(result.byOwner.find(row => row.owner === 'administration-maintenance')?.POST.totalAttempts).toBe(50);
  });
  it('retains exact rolling-minute boundaries and the full genuine lookback', () => {
    const rows = ledger([{ owner: 'data-refresh', count: 40, offset: () => -60_000 }, { owner: 'independent-measurement', count: 1 }]);
    expect(evaluate(rows).allHttpEnvelope.minutePeak).toBe(1);
    rows.attempts[0].at++; rows.attempts[0].endedAt++;
    expect(evaluate(rows).allHttpEnvelope.minutePeak).toBe(2);
    rows.coverageStartedAt++;
    expect(evaluate(rows).pass).toBe(false);
  });
  it('enforces the unchanged hourly DATA ceiling while reporting unrelated hourly traffic', () => {
    const rows = ledger([{ owner: 'data-refresh', count: 1_800, offset: index => index * 1_999 },
      { owner: 'independent-measurement', count: 1, offset: () => 3_598_001 },
      { owner: 'primary-projection', count: 2_000, offset: index => index * 1_700 }]);
    expect(evaluate(rows)).toMatchObject({ getEnvelope: { hourPeak: 1_801, pass: false },
      allHttpEnvelope: { hourPeak: 1_801, pass: false }, combined: { allHTTP: { hourPeak: 3_801 } }, pass: false });
  });
  it.each(['missing-owner', 'unknown-owner', 'sequence-gap', 'owner-total', 'missing-origin', 'unknown-policy'] as const)('rejects incomplete accounting under the new policy: %s', mutation => {
    const rows = ledger([{ owner: 'data-refresh', count: 1 }, { owner: 'primary-projection', count: 1 }]);
    if (mutation === 'missing-owner') rows.ownerTotals.pop();
    if (mutation === 'unknown-owner') rows.attempts[0].owner = 'guessed-owner';
    if (mutation === 'sequence-gap') rows.attempts[1].sequence = 2;
    if (mutation === 'owner-total') rows.ownerTotals[1].attempts++;
    if (mutation === 'missing-origin') delete rows.attempts[1].origin;
    if (mutation === 'unknown-owner' || mutation === 'missing-origin') expect(() => evaluate(rows)).toThrow();
    else if (mutation === 'unknown-policy') expect(() => evaluateRequestEnvelope(owners, rows, start, start + 7_200_000,
      'after-the-run-choice' as typeof policy)).toThrow('unknown request budget policy');
    else expect(evaluate(rows).pass).toBe(false);
  });
  const policyManifest = bindCapacityManifest(base.manifest.plan,
    { ...base.source, requestOwners: owners, requestBudgetPolicy: policy }, base.bindings, { kind: 'healthy' });
  it('uses the frozen manifest policy throughout the full evidence evaluator', () => {
    const evidence = structuredClone(base.evidence); evidence.manifestDigest = policyManifest.digest;
    evidence.requests.attempts.forEach(row => { row.owner = 'data-refresh'; row.origin = 'https://api.sleeper.app'; });
    const others = ledger([{ owner: 'primary-projection', count: 60 }, { owner: 'administration-maintenance', count: 31 }]);
    evidence.requests.attempts.push(...others.attempts);
    evidence.requests.ownerTotals = owners.map(owner => ({ owner, attempts: evidence.requests.attempts.filter(row => row.owner === owner).length }));
    const result = evaluateCapacityEvidence(policyManifest, evidence);
    expect(result.requestEnvelope.budgetPolicy).toBe(policy);
    expect(result.requestEnvelope.combined.allHTTP.minutePeak).toBeGreaterThan(40);
    expect(result.requestEnvelope.pass).toBe(true); expect(result.offlineChecksPass).toBe(true);
  });
  it('requires all four declared owners even when an owner has zero requests', () => {
    const rows = ledger([]);
    expect(evaluate(rows).pass).toBe(true);
    expect(() => evaluateRequestEnvelope(owners.slice(1), rows, start, start + 7_200_000, policy)).toThrow('complete closed owner inventory');
  });
});