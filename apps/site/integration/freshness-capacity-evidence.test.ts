import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { bindCapacityManifest, createCapacityPlan, type BoundEvent, type CapacitySource, type CapacityLane } from './freshness-capacity-manifest';
import { evaluateCapacityEvidence, evaluateRequestEnvelope, summarizeCapacity, type CapacityEvidence,
  type HttpAttempt, type OriginObservation, type ResourceRead } from './freshness-capacity-evidence';

const start = 1_000_000_000;
// Synthetic witnesses test the offline arithmetic only. They are never SQL or elapsed-run evidence.
function fixture() {
  const plan = createCapacityPlan('synthetic-evaluator');
  const value = (ordinal: number) => ({ raw: ordinal, custom: null, effective: ordinal });
  const payload = (pairId: string, ordinal: number) => { const utf8 = JSON.stringify({ pairId: pairId.replace('/official-scores', '/lineups'), ordinal });
    return { version: `v${ordinal}`, utf8, sha256: createHash('sha256').update(utf8).digest('hex') }; };
  const source: CapacitySource = { readinessContractSha256: 'e'.repeat(64), acceptanceContractSha256: 'f'.repeat(64), plannedPostgresqlVersion: '18.6',
    gitSha: 'a'.repeat(40), appTreeSha: 'b'.repeat(40), fixtureSha256: 'c'.repeat(64), readerQueryMixSha256: 'd'.repeat(64),
    clockRefs: { wall: 'synthetic-wall', monotonic: 'synthetic-monotonic' }, cleanupPlanRef: 'synthetic-cleanup',
    requestOwners: ['ordinary-runner', 'independent-measurement'], unrelatedUsernames: ['synthetic-a', 'synthetic-b'],
    formatWitnesses: { byes: 'fixture-byes', ties: 'fixture-ties', 'custom-zero': 'fixture-zero', 'unusual-scoring': 'fixture-scoring',
      'pre-draft-incomplete': 'fixture-predraft', 'multiweek-legs': 'fixture-legs', 'overlap-deduplication': 'fixture-overlap', 'excess-capacity': 'fixture-capacity' },
    leagues: plan.leagues.map(league => ({ key: league.key, nativeLeagueId: `synthetic-${league.key}`, season: 2026,
      format: league.format, regression: league.regression, nativePeriod: '1', nativePeriods: Array.from({ length: 18 }, (_, index) => String(index + 1)),
      extraPeriodCoverageGaps: [], rosterCount: 20, inSeason: true, initiallyPopulated: league.cohort === 'accepted', sourceEvidenceRef: 'synthetic-native-source' })),
    initialReaders: plan.pairs.map(pair => ({ pairId: pair.id, reader: { selector: `${pair.id}/head`, version: 'v0', value: value(0) } })) };
  const bindings: BoundEvent[] = plan.events.map(event => ({ id: event.id, before: payload(event.pairId, event.ordinal - 1), after: payload(event.pairId, event.ordinal),
    changedFields: ['synthetic'], expectedReader: { selector: `${event.pairId}/head`, version: `v${event.ordinal}`, value: value(event.ordinal) },
    retainedHistory: Array.from({ length: event.ordinal }, (_, ordinal) => ({ selector: `${event.pairId}/history/v${ordinal}`, version: `v${ordinal}`, value: value(ordinal) })) }));
  const manifest = bindCapacityManifest(plan, source, bindings, { kind: 'healthy' });
  const anchor = (pairId: string) => { const index = plan.pairs.findIndex(pair => pair.id === pairId);
    return start + (index < 32 ? 0 : 120_000 + index * 2_000 + 2); };
  const end = start + 246_002 + plan.observationHorizonMs;
  const attempts: HttpAttempt[] = [], origins: OriginObservation[] = [];
  for (const [index, pair] of plan.pairs.entries()) {
    const league = source.leagues.find(row => row.key === pair.leagueKey)!;
    const resource = pair.family === 'rosters' ? 'rosters' : pair.family === 'transactions' ? 'transactions/1' : 'matchups/1';
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
      read: read(origins.find(origin => origin.pairId === pair.id && origin.version === 'v0')!, anchor(pair.id)),
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
      const origin = evidence.origins.find(row => row.version === 'v1')!;
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
  it('does not hide import failure behind new-cohort freshness or a shifted acceptance anchor', () => {
    const { manifest, evidence } = fresh(); evidence.intakes[0].coverage = 'incomplete';
    expect(evaluateCapacityEvidence(manifest, evidence).intakes[0].pass).toBe(false);
    evidence.intakes[0].coverage = 'complete'; evidence.firstAcceptances[32].at--;
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
  function outageFixture() {
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
    const rebound = bindCapacityManifest(manifest.plan, manifest.source, manifest.events, lane);
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
      const rebound = bindCapacityManifest(manifest.plan, manifest.source, manifest.events, lane);
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
  it('rejects a fake provider outage with successful GETs and an undeclared healthy exclusion', () => {
    const { manifest, evidence } = outageFixture();
    const provider = bindCapacityManifest(manifest.plan, manifest.source, manifest.events, { ...manifest.lane, kind: 'outage', dependency: 'provider' } as CapacityLane);
    evidence.manifestDigest = provider.digest;
    const successful = structuredClone(base.evidence.requests.attempts.find(row => row.endedAt >= start + 1_800_000 && row.endedAt < start + 3_600_000)!);
    successful.sequence = evidence.requests.attempts.length + 1; evidence.requests.attempts.push(successful); evidence.requests.ownerTotals[0].attempts++;
    expect(() => evaluateCapacityEvidence(provider, evidence)).toThrow(/successful provider HTTP attempt/);
    evidence.manifestDigest = base.manifest.digest;
    expect(() => evaluateCapacityEvidence(base.manifest, evidence)).toThrow(/undeclared outage/);
  });
});
