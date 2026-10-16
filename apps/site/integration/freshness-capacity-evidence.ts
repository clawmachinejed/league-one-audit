import assert from 'node:assert/strict';
import { assertCapacityManifest, CAPACITY_EXTERNAL_GAPS, CAPACITY_LIMITS, capacityDigest, capacityTime,
  type CapacityManifest, type ReaderExpectation } from './freshness-capacity-manifest';

/** Infinity is serialized explicitly; JSON.stringify(Infinity) would silently turn failure into null. */
export type MeasuredMs = number | 'infinity';
export function summarizeCapacity(values: readonly MeasuredMs[]) {
  assert(values.length > 0, 'empty denominator');
  const ordered = values.map(value => value === 'infinity' ? Infinity : capacityTime(value)).sort((a, b) => a - b);
  const encode = (value: number): MeasuredMs => Number.isFinite(value) ? value : 'infinity';
  const rank = (percent: number) => encode(ordered[Math.ceil(percent * ordered.length) - 1]);
  return { scheduled: values.length, observed: values.filter(value => value !== 'infinity').length,
    failures: values.filter(value => value === 'infinity').length,
    p50Ms: rank(0.5), p95Ms: rank(0.95), p99Ms: rank(0.99), maxMs: encode(ordered.at(-1)!) };
}
function meets(value: MeasuredMs, ceiling: number) { return value !== 'infinity' && value <= ceiling; }
function indexed<T>(rows: readonly T[], key: (row: T) => string, allowed?: readonly string[]): Map<string, T> {
  const map = new Map<string, T>(); const allowedIds = allowed ? new Set(allowed) : null;
  for (const row of rows) { const id = key(row); assert(!map.has(id), `duplicate evidence: ${id}`);
    if (allowedIds) assert(allowedIds.has(id), `undeclared evidence: ${id}`); map.set(id, row); }
  return map;
}
export type GetAttempt = { id: string; owner: string; path: string; sequence: number; at: number; endedAt: number;
  purpose: 'intake' | 'refresh' | 'retry' | 'redirect' | 'independent-measurement' | 'other';
  outcome: 'success' | 'failed' | 'timeout'; responseSha256: string | null };
export type RequestAccounting = { coverageStartedAt: number; coverageEndedAt: number;
  ownerTotals: { owner: string; attempts: number }[]; attempts: GetAttempt[] };
export function evaluateRequestEnvelope(owners: readonly string[], ledger: RequestAccounting, start: number, end: number) {
  capacityTime(start); capacityTime(end); assert(end >= start); capacityTime(ledger.coverageStartedAt); capacityTime(ledger.coverageEndedAt);
  const totals = indexed(ledger.ownerTotals, row => row.owner, owners);
  const attempts = indexed(ledger.attempts, row => row.id);
  const errors: string[] = [];
  if (ledger.coverageStartedAt > start - 3_600_000 || ledger.coverageEndedAt < end) errors.push('incomplete rolling-window transport coverage');
  for (const owner of owners) {
    const rows = ledger.attempts.filter(row => row.owner === owner).sort((a, b) => a.sequence - b.sequence);
    const total = totals.get(owner); if (!total || !Number.isSafeInteger(total.attempts) || total.attempts !== rows.length) errors.push(`missing transport attempts: ${owner}`);
    if (rows.some((row, index) => row.sequence !== index + 1)) errors.push(`missing transport sequence: ${owner}`);
  }
  for (const row of attempts.values()) {
    assert(owners.includes(row.owner), 'unaccounted request owner'); assert(typeof row.path === 'string' && row.path.startsWith('/v1/')); assert(typeof row.id === 'string' && row.id.length > 0);
    capacityTime(row.at); capacityTime(row.endedAt); assert(row.endedAt >= row.at);
    assert(row.at >= ledger.coverageStartedAt && row.endedAt <= ledger.coverageEndedAt);
    assert(['intake', 'refresh', 'retry', 'redirect', 'independent-measurement', 'other'].includes(row.purpose));
    assert(['success', 'failed', 'timeout'].includes(row.outcome));
    if (row.responseSha256 !== null) assert.match(row.responseSha256, /^[a-f0-9]{64}$/u);
    if (row.outcome === 'success') assert(row.responseSha256, 'successful source response needs a hash');
  }
  const ordered = [...attempts.values()].sort((a, b) => a.at - b.at);
  const peak = (span: number) => {
    let left = 0, maximum = 0;
    for (let right = 0; right < ordered.length; right++) {
      // Rolling interval (t-span,t]; attempts exactly one interval apart do not overlap.
      while (ordered[left].at <= ordered[right].at - span) left++;
      if (ordered[right].at >= start && ordered[right].at <= end) maximum = Math.max(maximum, right - left + 1);
    }
    // Include lookback demand at the start even if no new request occurs then.
    return Math.max(maximum, ordered.filter(row => row.at > start - span && row.at <= start).length);
  };
  const minutePeak = peak(60_000), hourPeak = peak(3_600_000);
  return { totalAttempts: attempts.size, byPurpose: Object.fromEntries(['intake', 'refresh', 'retry', 'redirect', 'independent-measurement', 'other']
    .map(purpose => [purpose, ledger.attempts.filter(row => row.purpose === purpose).length])), minutePeak, hourPeak, errors,
    pass: errors.length === 0 && minutePeak <= CAPACITY_LIMITS.minuteGets && hourPeak <= CAPACITY_LIMITS.hourGets };
}
export type OriginObservation = { id: string; pairId: string; version: string; payloadSha256: string;
  observedAt: number; attemptId: string; kind: 'successful-provider-observation' };
export type ResourceRead = { at: number; committed: boolean; storedOnly: boolean; version: string; payloadSha256: string;
  originObservationId: string };
/** at is actual observer dispatch; the scheduled instant is always derived from the manifest. */
export type SampleEvidence = { id: string; at: number; status: 'available' | 'unavailable' | 'timeout'; read: ResourceRead | null };
export type EventEvidence = { id: string; publishedAt: number; read: ResourceRead | null;
  reader: ReaderExpectation | null; retainedHistory: ReaderExpectation[] };
export type IntakeEvidence = { cohort: 'intake-a' | 'intake-b'; submittedAt: number; receiptAt: number | null;
  acceptedAt: number | null; completeAt: number | null; coverage: 'complete' | 'incomplete' };
export type OutageEvidence = { startedAt: number; dependencyRestoredAt: number; runnerRestoredAt: number;
  recovered: { pairId: string; read: ResourceRead }[];
  lastGood: { pairId: string; before: { read: ResourceRead; reader: ReaderExpectation }; during: { read: ResourceRead; reader: ReaderExpectation } }[];
  backlog: { id: string; queuedAt: number; read: ResourceRead | null; reader: ReaderExpectation | null }[] };
export type CapacityEvidence = { manifestDigest: string; startedAt: number; endedAt: number;
  firstAcceptances: { pairId: string; at: number; read: ResourceRead; reader: ReaderExpectation }[]; intakes: IntakeEvidence[];
  requests: RequestAccounting; origins: OriginObservation[]; samples: SampleEvidence[]; events: EventEvidence[];
  outage: OutageEvidence | null };

/** Offline reconciliation only. It cannot attest SQL, clock truth, completeness of external journals or authority. */
export function evaluateCapacityEvidence(manifest: CapacityManifest, evidence: CapacityEvidence) {
  assertCapacityManifest(manifest); assert.equal(evidence.manifestDigest, manifest.digest, 'source/manifest drift');
  const { plan } = manifest; const start = capacityTime(evidence.startedAt), end = capacityTime(evidence.endedAt); assert(end >= start);
  const pairIds = plan.pairs.map(row => row.id);
  const acceptances = indexed(evidence.firstAcceptances, row => row.pairId, pairIds);
  const intakeRows = indexed(evidence.intakes, row => row.cohort, ['intake-a', 'intake-b']);
  const samples = indexed(evidence.samples, row => row.id, plan.samples.map(row => row.id));
  const events = indexed(evidence.events, row => row.id, plan.events.map(row => row.id));
  const origins = indexed(evidence.origins, row => row.id);
  const attempts = indexed(evidence.requests.attempts, row => row.id);
  const errors: string[] = [];
  const requestEnvelope = evaluateRequestEnvelope(manifest.source.requestOwners, evidence.requests, start, end);
  const knownVersions = new Map<string, Set<string>>();
  const boundEvents = indexed(manifest.events, row => row.id);
  for (const event of plan.events) {
    const bound = boundEvents.get(event.id)!; const versions = knownVersions.get(event.pairId) ?? new Set<string>();
    for (const payload of [bound.before, bound.after]) versions.add(`${payload.version}/${payload.sha256}`);
    knownVersions.set(event.pairId, versions);
  }
  for (const origin of origins.values()) {
    assert(pairIds.includes(origin.pairId)); capacityTime(origin.observedAt);
    assert.equal(origin.kind, 'successful-provider-observation', 'cache/read/retry cannot reset source age');
    assert(knownVersions.get(origin.pairId)!.has(`${origin.version}/${origin.payloadSha256}`), 'unbound source version');
    const attempt = attempts.get(origin.attemptId); assert(attempt && attempt.outcome === 'success', 'origin needs successful GET attempt');
    assert.equal(origin.observedAt, attempt.endedAt, 'origin clock must be the completed provider observation');
    assert.equal(origin.payloadSha256, attempt.responseSha256, 'origin response hash mismatch');
    const pair = plan.pairs.find(row => row.id === origin.pairId)!;
    const league = manifest.source.leagues.find(row => row.key === pair.leagueKey)!;
    const cohort = plan.leagues.find(row => row.key === pair.leagueKey)!.cohort;
    const acceptedAt = cohort === 'accepted' ? null : intakeRows.get(cohort)?.acceptedAt;
    if (cohort !== 'accepted' && acceptedAt !== null && acceptedAt !== undefined)
      assert(attempt.at >= acceptedAt, 'fresh-cohort acquisition predates accepted intake');
    const resource = pair.family === 'rosters' ? 'rosters' : pair.family === 'transactions' ? `transactions/${encodeURIComponent(league.nativePeriod)}` : `matchups/${encodeURIComponent(league.nativePeriod)}`;
    assert.equal(attempt.path, `/v1/league/${encodeURIComponent(league.nativeLeagueId)}/${resource}`, 'unrelated source endpoint');
  }
  function age(pairId: string, read: ResourceRead | null, at: number): MeasuredMs {
    capacityTime(at); if (!read) return 'infinity'; capacityTime(read.at);
    const origin = origins.get(read.originObservationId);
    if (read.committed !== true || read.storedOnly !== true || read.at !== at || !origin || origin.pairId !== pairId
      || origin.version !== read.version || origin.payloadSha256 !== read.payloadSha256
      || origin.observedAt > at || at > end) return 'infinity';
    return at - origin.observedAt;
  }
  const intakes = (['intake-a', 'intake-b'] as const).map(cohort => {
    const row = intakeRows.get(cohort);
    if (!row) return { cohort, receiptMs: 'infinity' as MeasuredMs, importMs: 'infinity' as MeasuredMs, pass: false };
    capacityTime(row.submittedAt); for (const at of [row.receiptAt, row.acceptedAt, row.completeAt]) if (at !== null) capacityTime(at);
    const ordered = row.submittedAt === start + plan.intakeStartOffsetMs && row.receiptAt !== null
      && row.receiptAt >= row.submittedAt && row.acceptedAt !== null && row.acceptedAt >= row.submittedAt
      && row.acceptedAt <= row.receiptAt && row.completeAt !== null && row.completeAt >= row.acceptedAt && row.completeAt <= end;
    const receiptMs: MeasuredMs = ordered ? row.receiptAt! - row.submittedAt : 'infinity';
    const importMs: MeasuredMs = ordered && row.coverage === 'complete' ? row.completeAt! - row.acceptedAt! : 'infinity';
    return { cohort, receiptMs, importMs, pass: meets(receiptMs, CAPACITY_LIMITS.receiptMs) && meets(importMs, CAPACITY_LIMITS.importMs) };
  });
  const anchors = new Map<string, number>();
  for (const pair of plan.pairs) {
    const first = acceptances.get(pair.id); if (!first) { errors.push(`missing first acceptance: ${pair.id}`); continue; }
    capacityTime(first.at); const cohort = plan.leagues.find(row => row.key === pair.leagueKey)!.cohort;
    const intake = cohort === 'accepted' ? null : intakeRows.get(cohort);
    if (cohort === 'accepted' ? first.at > start : !intake?.acceptedAt || first.at < intake.acceptedAt || !intake.completeAt || first.at > intake.completeAt) {
      errors.push(`invalid first acceptance: ${pair.id}`); continue;
    }
    const expected = manifest.source.initialReaders.find(row => row.pairId === pair.id)!.reader;
    const firstEvent = boundEvents.get(plan.events.find(row => row.pairId === pair.id)!.id)!;
    if (first.read.at !== first.at || age(pair.id, first.read, first.at) === 'infinity'
      || capacityDigest(first.reader) !== capacityDigest(expected) || first.read.version !== expected.version
      || first.read.payloadSha256 !== firstEvent.before.sha256) {
      errors.push(`unproved first acceptance: ${pair.id}`); continue;
    }
    const anchor = cohort === 'accepted' ? start : first.at; anchors.set(pair.id, anchor);
    if (end < anchor + plan.observationHorizonMs) errors.push(`truncated fixed horizon: ${pair.id}`);
  }
  for (const origin of origins.values()) {
    const anchor = anchors.get(origin.pairId); if (anchor === undefined) continue;
    const available = plan.events.filter(event => event.pairId === origin.pairId
      && anchor + event.offsetMs <= attempts.get(origin.attemptId)!.at).at(-1);
    const expected = available ? boundEvents.get(available.id)!.after
      : boundEvents.get(plan.events.find(event => event.pairId === origin.pairId)!.id)!.before;
    assert.equal(origin.version, expected.version, 'GET must return controlled payload available at request start');
    assert.equal(origin.payloadSha256, expected.sha256, 'controlled payload does not match request-start publication');
    const publication = available;
    if (publication) {
      assert(origin.observedAt >= anchor + publication.offsetMs, 'unpublished source version');
      assert(attempts.get(origin.attemptId)!.at >= anchor + publication.offsetMs, 'GET predates controlled publication');
    }
  }
  // Sample times and event times are derived only from frozen offsets and original acceptance.
  const regressedPairs = new Set<string>();
  const pairs = plan.pairs.map(pair => {
    const anchor = anchors.get(pair.id);
    const sourceAges = plan.samples.filter(slot => slot.pairId === pair.id).map(slot => {
      const row = samples.get(slot.id); if (anchor === undefined || !row) return 'infinity' as const;
      capacityTime(row.at); assert(['available', 'unavailable', 'timeout'].includes(row.status));
      const scheduledAt = anchor + slot.offsetMs;
      if (row.at < scheduledAt || row.at > scheduledAt + plan.sampleDispatchLatenessMs || row.status !== 'available'
        || !row.read || row.read.at < row.at || row.read.at > scheduledAt + plan.sampleTimeoutMs) return 'infinity' as const;
      return age(pair.id, row.read, row.read.at);
    });
    const incorrectEvents: string[] = [];
    const latencies = plan.events.filter(event => event.pairId === pair.id).map(event => {
      const expected = boundEvents.get(event.id)!, row = events.get(event.id);
      if (anchor === undefined || !row) { incorrectEvents.push(event.id); return 'infinity' as const; }
      capacityTime(row.publishedAt); if (row.read) capacityTime(row.read.at);
      const correct = row.publishedAt === anchor + event.offsetMs && row.read !== null
        && row.read.at >= row.publishedAt && row.read.at <= anchor + plan.observationHorizonMs
        && age(pair.id, row.read, row.read.at) !== 'infinity'
        && origins.get(row.read.originObservationId)!.observedAt >= row.publishedAt
        && attempts.get(origins.get(row.read.originObservationId)!.attemptId)!.at >= row.publishedAt
        && row.read.version === expected.after.version && row.read.payloadSha256 === expected.after.sha256
        && capacityDigest(row.reader) === capacityDigest(expected.expectedReader)
        && capacityDigest(row.retainedHistory) === capacityDigest(expected.retainedHistory);
      if (!correct) { incorrectEvents.push(event.id); return 'infinity' as const; }
      return row.read!.at - row.publishedAt;
    });
    const versionOrder = new Map([[manifest.source.initialReaders.find(row => row.pairId === pair.id)!.reader.version, 0],
      ...plan.events.filter(row => row.pairId === pair.id).map(row => [boundEvents.get(row.id)!.after.version, row.ordinal] as [string, number])]);
    const headSelector = manifest.source.initialReaders.find(row => row.pairId === pair.id)!.reader.selector;
    const outageHeadReads = evidence.outage ? [
      ...evidence.outage.lastGood.filter(row => row.pairId === pair.id).flatMap(row => [row.before.read, row.during.read]),
      ...evidence.outage.recovered.filter(row => row.pairId === pair.id).map(row => row.read),
      ...evidence.outage.backlog.filter(row => manifest.lane.kind === 'outage' && manifest.lane.backlog.some(expected =>
        expected.id === row.id && expected.pairId === pair.id && expected.reader.selector === headSelector)).map(row => row.read),
    ] : [];
    const headReads = [acceptances.get(pair.id)?.read, ...outageHeadReads,
      ...plan.samples.filter(row => row.pairId === pair.id).map(row => samples.get(row.id)?.read),
      ...plan.events.filter(row => row.pairId === pair.id).map(row => events.get(row.id)?.read)]
      .filter((read): read is ResourceRead => !!read && age(pair.id, read, read.at) !== 'infinity').sort((a, b) => a.at - b.at);
    let latestVersion = -1;
    for (const read of headReads) { const order = versionOrder.get(read.version)!;
      if (order < latestVersion) { errors.push(`accepted head regression: ${pair.id}`); regressedPairs.add(pair.id); break; } latestVersion = order; }
    const sourceAge = summarizeCapacity(sourceAges), visibility = summarizeCapacity(latencies);
    const sampleTiming = plan.samples.filter(row => row.pairId === pair.id).map(slot => {
      const actual = samples.get(slot.id), scheduledAt = anchor === undefined ? null : anchor + slot.offsetMs;
      return { id: slot.id, scheduledAt, startedAt: actual?.at ?? null, endedAt: actual?.read?.at ?? null,
        dispatchLatenessMs: actual && scheduledAt !== null ? actual.at - scheduledAt : null, status: actual?.status ?? 'missing' };
    });
    return { pairId: pair.id, sourceAge, visibility, sampleTiming, incorrectEvents, correctnessPass: incorrectEvents.length === 0,
      healthyFreshnessPass: meets(sourceAge.p95Ms, CAPACITY_LIMITS.sourceAgeP95Ms) && meets(sourceAge.p99Ms, CAPACITY_LIMITS.sourceAgeP99Ms),
      visibilityPass: meets(visibility.p95Ms, CAPACITY_LIMITS.changeP95Ms) };
  });
  let outage: null | { recoveryMs: MeasuredMs; backlogMs: MeasuredMs; lastGoodPreserved: boolean; pass: boolean } = null;
  if (manifest.lane.kind === 'healthy') assert.equal(evidence.outage, null, 'undeclared outage cannot be excluded from healthy samples');
  else {
    const row = evidence.outage;
    if (!row) outage = { recoveryMs: 'infinity', backlogMs: 'infinity', lastGoodPreserved: false, pass: false };
    else {
      [row.startedAt, row.dependencyRestoredAt, row.runnerRestoredAt].forEach(capacityTime);
      assert.equal(row.startedAt, start + manifest.lane.startOffsetMs);
      // Recovery starts only after both the dependency and existing runner are available.
      const restoredAt = Math.max(row.dependencyRestoredAt, row.runnerRestoredAt);
      assert.equal(row.dependencyRestoredAt - row.startedAt, manifest.lane.durationMs, 'dependency outage must be the frozen thirty minutes');
      assert(row.runnerRestoredAt >= row.startedAt);
      const during = (at: number) => at >= row.startedAt && at < row.dependencyRestoredAt;
      assert(!evidence.requests.attempts.some(attempt => attempt.outcome === 'success' && during(attempt.endedAt)), 'successful provider GET during declared outage');
      const recovered = indexed(row.recovered, item => item.pairId, pairIds);
      const recoveryTimes = pairIds.map(pairId => {
        const read = recovered.get(pairId)?.read; if (!read) return 'infinity' as const;
        const origin = origins.get(read.originObservationId);
        const fresh = read.at >= restoredAt && origin && origin.observedAt >= restoredAt && meets(age(pairId, read, read.at), CAPACITY_LIMITS.sourceAgeP95Ms);
        return fresh ? read.at - restoredAt : 'infinity' as const;
      });
      const history = indexed(row.lastGood, item => item.pairId, pairIds);
      const lastGoodPreserved = manifest.lane.lastGood.every(expected => {
        const item = history.get(expected.pairId); if (!item || regressedPairs.has(expected.pairId)) return false;
        return item.before.read.at < row.startedAt && item.during.read.at >= row.startedAt && item.during.read.at < restoredAt
          && [item.before, item.during].every(witness => age(expected.pairId, witness.read, witness.read.at) !== 'infinity'
            && witness.read.version === expected.reader.version && witness.read.payloadSha256 === expected.payloadSha256
            && capacityDigest(witness.reader) === capacityDigest(expected.reader));
      });
      const backlog = indexed(row.backlog, item => item.id, manifest.lane.backlog.map(item => item.id));
      const backlogTimes = manifest.lane.backlog.map(expected => {
        const item = backlog.get(expected.id); if (!item) return 'infinity' as const; capacityTime(item.queuedAt);
        if (item.queuedAt > restoredAt || !item.read || item.read.at < Math.max(item.queuedAt, restoredAt)
          || age(expected.pairId, item.read, item.read.at) === 'infinity'
          || item.read.version !== expected.reader.version || capacityDigest(item.reader) !== capacityDigest(expected.reader)) return 'infinity' as const;
        return item.read.at - restoredAt;
      });
      const recoveryMs = summarizeCapacity(recoveryTimes).maxMs, backlogMs = summarizeCapacity(backlogTimes).maxMs;
      outage = { recoveryMs, backlogMs, lastGoodPreserved,
        pass: regressedPairs.size === 0 && meets(recoveryMs, CAPACITY_LIMITS.freshnessRecoveryMs) && meets(backlogMs, CAPACITY_LIMITS.backlogRecoveryMs) && lastGoodPreserved };
    }
  }
  return { kind: 'cp26-offline-analysis-v1' as const, manifestDigest: manifest.digest, evidenceDigest: capacityDigest(evidence),
    lane: manifest.lane.kind, errors, pairs, intakes, requestEnvelope, outage,
    // These are separate lanes. Outage percentiles are always reported, never claimed as a healthy result.
    healthyFreshnessPass: manifest.lane.kind === 'healthy' ? pairs.every(pair => pair.healthyFreshnessPass) : null,
    offlineChecksPass: errors.length === 0 && intakes.every(row => row.pass) && requestEnvelope.pass
      && pairs.every(pair => pair.correctnessPass) && (manifest.lane.kind === 'healthy'
        ? pairs.every(pair => pair.healthyFreshnessPass && pair.visibilityPass) : outage?.pass === true),
    checkpoint26Qualified: false as const, executionReady: false as const, externalEvidenceRequired: [...CAPACITY_EXTERNAL_GAPS] };
}
