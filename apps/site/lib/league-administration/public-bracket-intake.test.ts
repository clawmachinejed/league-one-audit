import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseClient } from '../database';
import { capturePublicSleeperCore } from '../sleeper';
import { BRACKET_VALUE_VERSION, type AcceptedBracketRead, type BracketFamily } from '../aggregator/playoff-brackets';
import { createLeagueAdministrationStore } from './store';
import { createPublicDataRefreshStore, createPublicIntakeStore } from './neon/public-intake';
import { runPublicIntakeStep, type PublicIntakeDependencies } from './public-intake';
import { PUBLIC_PLAYOFF_BRACKETS, PUBLIC_PERIOD_INVENTORY, validatePublicIntake, type PublicIntakeStore } from './public-intake-contracts';
import { validatePublicDataRefresh } from './public-refresh-contracts';
import { readPublicBrackets } from './public-bracket-reader';
import { readPublicSleeperIntake } from './public-intake-reader';
import type { PublicCaptureWitness } from './contracts';
import type { LeagueAdministrationStore } from './store-contracts';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const id = randomUUID(), native = '9876543210987654', time = '2026-10-11T12:00:00.000Z';
const mapping = { connectionId: randomUUID(), leagueSeasonId: randomUUID(), revisionId: randomUUID(), generation: 1,
  scope: { leagueKey: 'cp12-unit', provider: 'sleeper' as const, externalLeagueId: native, season: 2026 } };
const input = { id, username: 'cp12_manager', seasons: [2026] };
const work = { requestId: id, revision: 3, kind: 'playoff-brackets' as const, externalLeagueId: native, season: 2026 as const };
const configuration = { id: randomUUID(), expectedRevision: 0, identityRequestId: id, seasons: [2026], cadenceSeconds: 60,
  expiresAt: new Date(Date.now() + 86_400_000).toISOString(), paused: false };
function fixture() {
  const events: string[] = [], reservations = new Map<BracketFamily, string>();
  const fetch = vi.fn(async (url: string) => { events.push(url.endsWith('winners_bracket') ? 'get-winners' : 'get-losers');
    return new Response(url.endsWith('winners_bracket') ? 'null' : '[]'); });
  vi.stubGlobal('fetch', fetch);
  const intake: PublicIntakeStore = { submit: vi.fn(async () => undefined), recover: vi.fn(async () => undefined), next: vi.fn(async () => work), admit: vi.fn(async () => true),
    recordIdentity: vi.fn(async () => undefined), recordLeagues: vi.fn(async () => undefined), register: vi.fn(async () => undefined), completeCore: vi.fn(async () => undefined), completeExactPeriod: vi.fn(async () => undefined),
    completeBrackets: vi.fn(async () => undefined), fail: vi.fn(async () => undefined),
    captureWitness: vi.fn(async (selected, selectedMapping, fence): Promise<PublicCaptureWitness> => {
      events.push('witness');
      return { version: 'public-network-capture-v1', work: selected, mapping: selectedMapping, fence, dispatchNonce: randomUUID(),
        attempts: { winners_bracket: { id: reservations.get('winners_bracket')!, nonce: randomUUID() },
          losers_bracket: { id: reservations.get('losers_bracket')!, nonce: randomUUID() } } };
    }) };
  const administration = { ...createLeagueAdministrationStore({ enabled: false, reason: 'missing-database-url' }), enabled: true,
    readSourceMapping: vi.fn(async () => mapping),
    beginBracketAttempt: vi.fn<NonNullable<LeagueAdministrationStore['beginBracketAttempt']>>(async (_mapping, family, attemptId) => {
      events.push('reserve-' + family); reservations.set(family, attemptId);
      return { id: attemptId, scopeId: randomUUID(), ordinal: 1, expectedGeneration: 0 };
    }),
    recordObservation: vi.fn<LeagueAdministrationStore['recordObservation']>(async normalized => {
      events.push('write-' + normalized.envelope.family);
      return { status: 'changed', observationId: randomUUID(), bracketAcceptance: { status: 'accepted', receiptId: randomUUID(), acceptedGeneration: 1 } };
    }) } satisfies LeagueAdministrationStore;
  const jobs = { acquireJob: vi.fn(async () => ({ kind: 'acquired' as const, attempt: 1, leaseUntil: new Date(Date.now() + 25_000).toISOString() })),
    completeJob: vi.fn(async () => true), failJob: vi.fn(async () => true) };
  const dependencies = { intake, administration, jobs } as PublicIntakeDependencies;
  return { events, fetch, intake, administration, dependencies, run: () => runPublicIntakeStep(id, dependencies, new AbortController().signal) };
}

describe('explicit current-season bracket selection', () => {
  it('keeps the omitted wire shape and permits either existing period selector alongside bracket scope', () => {
    expect(validatePublicIntake(input)).toEqual(input);
    expect(validatePublicDataRefresh(configuration)).not.toHaveProperty('playoffBrackets');
    for (const periods of [{}, { exactPeriods: [{ season: 2026, nativeWeek: 2 }] }, { periodInventory: PUBLIC_PERIOD_INVENTORY }]) {
      expect(validatePublicIntake({ ...input, ...periods, playoffBrackets: PUBLIC_PLAYOFF_BRACKETS })).toMatchObject({ playoffBrackets: PUBLIC_PLAYOFF_BRACKETS });
      expect(validatePublicDataRefresh({ ...configuration, ...periods, playoffBrackets: PUBLIC_PLAYOFF_BRACKETS })).toMatchObject({ playoffBrackets: PUBLIC_PLAYOFF_BRACKETS });
    }
  });
  it.each([null, false, true, '', 'sleeper-2025-playoff-brackets-v1', {}, []])('rejects a malformed bracket selector before storage: %j', playoffBrackets => {
    expect(() => validatePublicIntake({ ...input, playoffBrackets } as never)).toThrow();
    expect(() => validatePublicDataRefresh({ ...configuration, playoffBrackets } as never)).toThrow();
  });
  it.each([[2025], [2026, 2027], [2025, 2026]].map(seasons => ({ seasons })))('does not broaden the bracket season scope: $seasons', ({ seasons }) => {
    expect(() => validatePublicIntake({ ...input, seasons, playoffBrackets: PUBLIC_PLAYOFF_BRACKETS })).toThrow();
    expect(() => validatePublicDataRefresh({ ...configuration, seasons, playoffBrackets: PUBLIC_PLAYOFF_BRACKETS })).toThrow();
  });
  it('fails before submission or configuration when R047 is absent', async () => {
    const query = vi.fn(async (_statement: string) => { void _statement; return [{ supported: false }]; });
    const client = { enabled: true, query } as unknown as DatabaseClient;
    await expect(createPublicIntakeStore(client).submit({ ...input, playoffBrackets: PUBLIC_PLAYOFF_BRACKETS })).rejects.toThrow('R047');
    await expect(createPublicDataRefreshStore(client).configure({ ...configuration, playoffBrackets: PUBLIC_PLAYOFF_BRACKETS })).rejects.toThrow('R047');
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls.every(call => String(call[0]).includes('bracket-capability'))).toBe(true);
  });
});

describe('ordinary paired bracket work', () => {
  it('reserves both families before the witness and HTTP, then checkpoints both exact receipts', async () => {
    const f = fixture();
    expect(await f.run()).toEqual({ status: 'progress', resource: 'playoff-brackets', providerRequests: 2 });
    expect(f.events.slice(0, 3)).toEqual(['reserve-winners_bracket', 'reserve-losers_bracket', 'witness']);
    expect(f.fetch).toHaveBeenCalledTimes(2);
    expect(f.administration.recordObservation).toHaveBeenCalledTimes(2);
    const calls = f.administration.recordObservation.mock.calls;
    expect(calls[0][0].envelope.provenance.acquisition).toEqual(calls[1][0].envelope.provenance.acquisition);
    for (const args of calls) {
      expect(args[2]).toEqual(mapping);
      expect(args[11]?.attempt.id).toBe(args[0].envelope.provenance.acquisition?.attempts[args[0].envelope.family].id);
    }
    expect(f.intake.completeBrackets).toHaveBeenCalledOnce();
    expect(f.intake.fail).not.toHaveBeenCalled();
  });
  it.each(['captureWitness', 'completeBrackets'] as const)('makes no provider request without required intake capability %s', async capability => {
    const f = fixture(); f.dependencies = { ...f.dependencies, intake: { ...f.intake, [capability]: undefined } };
    const result = await runPublicIntakeStep(id, f.dependencies, new AbortController().signal);
    expect(result).toMatchObject({ status: 'unavailable', providerRequests: 0 }); expect(f.fetch).not.toHaveBeenCalled();
  });
  it('retains the valid loser family when the winners transport rejects', async () => {
    const f = fixture();
    f.fetch.mockImplementation(async url => { if (url.endsWith('winners_bracket')) throw new Error('synthetic transport failure'); return new Response('[]'); });
    expect(await f.run()).toMatchObject({ status: 'unavailable', providerRequests: 2 });
    expect(f.administration.recordObservation).toHaveBeenCalledOnce();
    expect(f.administration.recordObservation.mock.calls[0][0].envelope.family).toBe('losers_bracket');
    expect(f.intake.completeBrackets).not.toHaveBeenCalled(); expect(f.intake.fail).toHaveBeenCalledOnce();
  });
  it('retains the valid second family when the first write throws', async () => {
    const f = fixture(), original = f.administration.recordObservation.getMockImplementation()!;
    f.administration.recordObservation.mockImplementation(async (...args) => {
      if (args[0].envelope.family === 'winners_bracket') throw new Error('synthetic database failure');
      return original(...args);
    });
    expect(await f.run()).toMatchObject({ status: 'unavailable', providerRequests: 2 });
    expect(f.administration.recordObservation).toHaveBeenCalledTimes(2);
    expect(f.events).toContain('write-losers_bracket'); expect(f.intake.completeBrackets).not.toHaveBeenCalled();
  });
  it('does not let a fulfilled wrong-family response hide the valid sibling', async () => {
    const f = fixture();
    const unused = async () => { throw new Error('Unexpected non-bracket source call'); };
    const source = { identity: unused, leagues: unused, core: unused,
      bracket: async (leagueId: string, family: BracketFamily, signal: AbortSignal, witness: PublicCaptureWitness) => {
        const capture = await capturePublicSleeperCore(leagueId, family, signal, undefined, witness);
        return family === 'winners_bracket' ? { ...capture, family: 'league' as const } : capture;
      } };
    expect(await runPublicIntakeStep(id, { ...f.dependencies, source }, new AbortController().signal)).toMatchObject({ status: 'unavailable', providerRequests: 2 });
    expect(f.administration.recordObservation).toHaveBeenCalledOnce();
    expect(f.administration.recordObservation.mock.calls[0][0].envelope.family).toBe('losers_bracket');
    expect(f.intake.completeBrackets).not.toHaveBeenCalled();
  });
  it('cannot complete the pair by borrowing a preserved earlier family', async () => {
    const f = fixture(), original = f.administration.recordObservation.getMockImplementation()!;
    f.administration.recordObservation.mockImplementation(async (...args) => args[0].envelope.family === 'winners_bracket'
      ? { status: 'unchanged', observationId: randomUUID() } : original(...args));
    expect(await f.run()).toMatchObject({ status: 'unavailable' }); expect(f.intake.completeBrackets).not.toHaveBeenCalled();
  });
});

function readerFixture() {
  const workerId = randomUUID(), winnerId = randomUUID(), loserId = randomUUID();
  const witness: PublicCaptureWitness = { version: 'public-network-capture-v1', work, mapping,
    fence: { jobKey: 'league-administration-public-intake', workerId, generation: 1, deadlineAt: time }, dispatchNonce: randomUUID(),
    attempts: { winners_bracket: { id: randomUUID(), nonce: randomUUID() }, losers_bracket: { id: randomUUID(), nonce: randomUUID() } } };
  const rows = [{ ordinal: 1, season: 2026, external_league_id: native, status: 'complete', failure_count: 0, reason: null,
    worker_id: workerId, generation: 1, league_season_id: mapping.leagueSeasonId, source_mapping: mapping,
    winners_bracket_receipt_id: winnerId, losers_bracket_receipt_id: loserId, recorded_at: time }];
  const candidates = [{ season: 2026, external_league_id: native, stage: 'complete' }];
  const query = vi.fn(async () => rows);
  const administration = { ...createLeagueAdministrationStore({ enabled: false, reason: 'missing-database-url' }), enabled: true,
    readSourceMapping: vi.fn(async () => mapping),
    readAcceptedBracket: vi.fn<NonNullable<LeagueAdministrationStore['readAcceptedBracket']>>(async (_mapping, selection): Promise<AcceptedBracketRead> => ({
      status: 'available', version: BRACKET_VALUE_VERSION, selection: 'receipt', contentId: randomUUID(),
      bracketReceiptId: selection.bracketReceiptId!, acceptanceId: randomUUID(), acceptedGeneration: 1, sourceMappingRevisionId: mapping.revisionId,
      provenance: { origin: 'network', requestStartedAt: time, requestCompletedAt: time, sourceObservedAt: time, checkedAt: time, acquisition: witness },
      value: { family: selection.family, season: 2026, publication: 'published', rounds: [], matches: [], edges: [], limitations: [] } })) };
  const client = { enabled: true, query } as unknown as DatabaseClient;
  return { rows, candidates, administration, client, query, witness, run: () => readPublicBrackets(client, administration, id, candidates) };
}

describe('stored bracket intake composition', () => {
  it('reads exact historical receipts and never asks for newer current heads or provider data', async () => {
    const f = readerFixture(), fetch = vi.fn(() => { throw new Error('provider forbidden'); }); vi.stubGlobal('fetch', fetch);
    const result = await f.run(); expect(result[0].resource.status).toBe('available');
    expect(f.administration.readAcceptedBracket.mock.calls.map(call => call[1])).toEqual([
      { family: 'winners_bracket', bracketReceiptId: f.rows[0].winners_bracket_receipt_id },
      { family: 'losers_bracket', bracketReceiptId: f.rows[0].losers_bracket_receipt_id }]);
    expect(fetch).not.toHaveBeenCalled(); expect(f.query).toHaveBeenCalledOnce();
  });
  it('rejects source remapping before reading receipt data', async () => {
    const f = readerFixture(); f.administration.readSourceMapping.mockResolvedValue({ ...mapping, revisionId: randomUUID() });
    expect((await f.run())[0].resource.status).toBe('unavailable'); expect(f.administration.readAcceptedBracket).not.toHaveBeenCalled();
  });
  it('rejects mismatched checkpoint acquisition even if the native receipt value is valid', async () => {
    const f = readerFixture(); Object.assign(f.witness, { work: { ...work, requestId: randomUUID() } });
    expect((await f.run())[0].resource.status).toBe('unavailable');
  });
  it('does not call accepted readers for incomplete tasks or invent resources for empty discovery', async () => {
    const f = readerFixture(); f.rows[0].status = 'pending';
    expect((await f.run())[0].resource).toEqual({ status: 'unavailable', reason: 'bracket-capture-not-complete' });
    expect(f.administration.readAcceptedBracket).not.toHaveBeenCalled(); f.rows.length = 0; f.candidates.length = 0;
    expect(await f.run()).toEqual([]);
  });
  it('reports bootstrap capacity as an unavailable admitted task rather than rejecting the stored request', async () => {
    const f = readerFixture(); f.rows[0].status = 'unavailable';
    Object.assign(f.rows[0], { reason: 'bootstrap-capacity' }); f.candidates[0].stage = 'capacity';
    expect((await f.run())[0]).toMatchObject({ collection: 'unavailable', reason: 'bootstrap-capacity', resource: { status: 'unavailable' } });
    expect(f.administration.readAcceptedBracket).not.toHaveBeenCalled();
  });
  it('preserves sibling evidence when one stored family read fails', async () => {
    const f = readerFixture(), original = f.administration.readAcceptedBracket.getMockImplementation()!;
    f.administration.readAcceptedBracket.mockImplementation(async (...args) => {
      if (args[1].family === 'winners_bracket') throw new Error('synthetic reader failure'); return original(...args);
    });
    const result = await f.run(); expect(result[0].resource).toMatchObject({ status: 'unavailable', losers_bracket: { status: 'available' } });
  });
  it('does not query new bracket tables for a request that omitted the selector', async () => {
    const query = vi.fn(async (statement: string) => statement.includes('read-request') ? [{ id, seasons: [2026], terminal: false,
      selected_exact_periods: null, selected_period_inventory: null, selected_playoff_brackets: null }] : []);
    const client = { enabled: true, query } as unknown as DatabaseClient;
    const result = await readPublicSleeperIntake(client, createLeagueAdministrationStore({ enabled: false, reason: 'missing-database-url' }), id);
    expect(result).not.toHaveProperty('brackets');
    if (result.status === 'missing') throw new Error('Expected retained request');
    expect(result.coverage.notRequested).toContain('playoff-brackets');
    expect(query.mock.calls.some(call => call[0].includes('read-brackets'))).toBe(false);
  });
});