import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import net from 'node:net';
import { capturePublicSleeperCore, capturePublicSleeperIdentity, capturePublicSleeperLeagueList } from '../sleeper';
import { recordCapturedAdministration } from './runtime';
import { assertOriginalPublicCapture, parsePublicCaptureWitness, validateRequestedPublicCaptureWitness,
  type PublicCaptureWitness } from './public-capture-witness';
import type { CapturedAdministrationDocument } from './contracts';
import type { LeagueAdministrationStore } from './store-contracts';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }));

const uuid = (n: number) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const native = '9876543210', serverTime = Date.parse('2026-10-08T12:00:00.000Z');
const league = { league_id: native, season: '2026', sport: 'nfl', name: 'Witness fixture',
  total_rosters: 1, roster_positions: ['QB', 'BN'], scoring_settings: { pass_yd: 0.04 },
  settings: { divisions: 3 } };
function coreWitness() {
  return {
    version: 'public-network-capture-v1' as const,
    work: { requestId: uuid(1), revision: 3, kind: 'core' as const, externalLeagueId: native, season: 2026 },
    fence: { jobKey: 'league-administration-public-intake', workerId: uuid(2), generation: 4,
      deadlineAt: new Date(serverTime + 20_000).toISOString() },
    dispatchNonce: uuid(3),
    mapping: { connectionId: uuid(4), leagueSeasonId: uuid(5), revisionId: uuid(6), generation: 1,
      scope: { leagueKey: 'witness-fixture', provider: 'sleeper' as const, externalLeagueId: native, season: 2026 } },
    attempts: {
      settings: { id: uuid(10), nonce: uuid(20) }, players: { id: uuid(11), nonce: uuid(21) },
      managers: { id: uuid(12), nonce: uuid(22) }, managersV2: { id: uuid(13), nonce: uuid(23) },
    },
  } satisfies PublicCaptureWitness;
}
function dispatchWitness(kind: 'identity' | 'leagues' | 'bootstrap' | 'users' | 'exact-matchups'): PublicCaptureWitness {
  const witness = coreWitness(), common = { requestId: witness.work.requestId, revision: 3 };
  if (kind === 'identity') return { ...witness, mapping: null, attempts: {},
    work: { ...common, kind, username: 'manager_55' } };
  if (kind === 'leagues') return { ...witness, mapping: null, attempts: {},
    work: { ...common, kind, userId: '55', season: 2026 } };
  if (kind === 'exact-matchups') return { ...witness, work: { ...witness.work, kind, nativeWeek: 4 },
    attempts: { settings: witness.attempts.settings, matchups: { id: uuid(14), nonce: uuid(24) } } };
  return { ...witness, work: { ...witness.work, kind }, mapping: kind === 'bootstrap' ? null : witness.mapping, attempts: {} };
}
function recorder() {
  const recordObservation = vi.fn<LeagueAdministrationStore['recordObservation']>(async () =>
    ({ status: 'changed', observationId: uuid(40) }));
  // Only the retained writer boundary is substituted; transport, seal and normalization run normally.
  const store = { enabled: true, recordObservation } as unknown as LeagueAdministrationStore;
  return { store, recordObservation };
}
function fixtureFetch(payload: unknown = league) {
  const fetch = vi.fn(async () => new Response(JSON.stringify(payload)));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
const signal = () => new AbortController().signal;
const captureLeague = (witness?: PublicCaptureWitness) =>
  capturePublicSleeperCore(native, 'league', signal(), undefined, witness);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(serverTime);
  vi.spyOn(net.Socket.prototype, 'connect').mockImplementation(() => { throw new Error('Unexpected outbound connection.'); });
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Unexpected fixture HTTP request.'); }));
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('public capture witnesses through the maintained transport and writer', () => {
  it.each([-500, 500])('keeps raw %d ms application-clock provenance through capture, seal and normalization', async offset => {
    const witness = coreWitness(), { store, recordObservation } = recorder();
    vi.setSystemTime(serverTime + offset);
    const fetch = vi.fn(async () => {
      vi.setSystemTime(serverTime + offset + 17);
      return new Response(JSON.stringify(league));
    });
    vi.stubGlobal('fetch', fetch);
    const capture = await captureLeague(witness);
    expect(capture.requestStartedAt).toBe(new Date(serverTime + offset).toISOString());
    expect(capture.requestCompletedAt).toBe(new Date(serverTime + offset + 17).toISOString());
    expect(Date.parse(witness.fence.deadlineAt)).toBeGreaterThan(Date.now());
    expect(() => assertOriginalPublicCapture(capture, witness)).not.toThrow();
    const original = JSON.stringify(capture);
    const attempt = { id: witness.attempts.settings.id, scopeId: uuid(30), ordinal: 1, expectedGeneration: 0 };
    await recordCapturedAdministration(witness.mapping.scope, [capture], { store, mapping: witness.mapping,
      fence: witness.fence, leagueSettingsAttempt: attempt, expectedAcquisition: witness });
    const normalized = recordObservation.mock.calls[0][0];
    expect(normalized.status).toBe('accepted');
    expect(normalized.envelope.provenance).toEqual({ origin: 'network',
      requestStartedAt: capture.requestStartedAt, requestCompletedAt: capture.requestCompletedAt,
      sourceObservedAt: capture.requestCompletedAt, checkedAt: capture.requestCompletedAt, acquisition: witness });
    expect(recordObservation.mock.calls[0][5]).toEqual({ attempt });
    expect(JSON.stringify(capture)).toBe(original);
    expect(fetch).toHaveBeenCalledOnce();

    const legacy = await captureLeague();
    await recordCapturedAdministration(witness.mapping.scope, [legacy], { store, mapping: witness.mapping });
    const plain = recordObservation.mock.calls[1][0];
    expect(plain.envelope.provenance).not.toHaveProperty('acquisition');
    expect(normalized.contentHash).toBe(plain.contentHash);
    expect(normalized.semanticHash).toBe(plain.semanticHash);
  });

  it('seals identity, list, bootstrap, directory and exact-period responses at their real transport entries', async () => {
    fixtureFetch({ user_id: '55', username: 'manager_55', display_name: 'Manager' });
    const identity = dispatchWitness('identity');
    expect(() => parsePublicCaptureWitness(identity)).not.toThrow();
    const user = await capturePublicSleeperIdentity('manager_55', signal(), identity);
    expect(user.value?.userId).toBe('55');
    expect(() => assertOriginalPublicCapture(user, identity)).not.toThrow();
    expect(Object.isFrozen(user.value)).toBe(true);

    fixtureFetch([league]);
    const list = dispatchWitness('leagues');
    const leagues = await capturePublicSleeperLeagueList('55', 2026, signal(), list);
    expect(leagues.value).toHaveLength(1);
    expect(() => assertOriginalPublicCapture(leagues, list)).not.toThrow();
    expect(Object.isFrozen(leagues.value?.[0])).toBe(true);

    fixtureFetch();
    const bootstrap = dispatchWitness('bootstrap');
    expect(() => parsePublicCaptureWitness(bootstrap)).not.toThrow();
    const boot = await captureLeague(bootstrap);
    expect(() => assertOriginalPublicCapture(boot, bootstrap)).not.toThrow();

    fixtureFetch([{ user_id: '55', display_name: 'Manager' }]);
    const users = dispatchWitness('users');
    const directory = await capturePublicSleeperCore(native, 'users', signal(), undefined, users);
    const { store, recordObservation } = recorder();
    await recordCapturedAdministration(coreWitness().mapping.scope, [directory],
      { store, mapping: users.mapping, fence: users.fence, expectedAcquisition: users });
    expect(recordObservation.mock.calls[0][0].envelope.provenance.acquisition).toEqual(users);
    // The legacy users writer does not accept top-level sourceMapping; witness mapping is separate.
    expect(recordObservation.mock.calls[0][2]).toBeUndefined();

    fixtureFetch([{ roster_id: 1, matchup_id: 1, players: [], starters: [], points: 0 }]);
    const exact = dispatchWitness('exact-matchups');
    const matchup = await capturePublicSleeperCore(native, 'matchups', signal(), 4, exact);
    expect(matchup.week).toBe(4);
    expect(() => assertOriginalPublicCapture(matchup, exact)).not.toThrow();
  });

  it('rejects wrong request identity, family and native period before fixture HTTP', async () => {
    const fetch = fixtureFetch();
    await expect(capturePublicSleeperCore(native, 'rosters', signal(), undefined, dispatchWitness('users'))).rejects.toThrow(/scope mismatch/);
    await expect(capturePublicSleeperCore('123', 'league', signal(), undefined, coreWitness())).rejects.toThrow(/scope mismatch/);
    await expect(capturePublicSleeperCore(native, 'matchups', signal(), 5, dispatchWitness('exact-matchups'))).rejects.toThrow(/scope mismatch/);
    await expect(capturePublicSleeperIdentity('other_manager', signal(), dispatchWitness('identity'))).rejects.toThrow(/scope mismatch/);
    await expect(capturePublicSleeperLeagueList('55', 2025, signal(), dispatchWitness('leagues'))).rejects.toThrow(/scope mismatch/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('copies the witness before awaiting HTTP and prevents deep payload, value and witness mutation', async () => {
    const witness = coreWitness(), expected = structuredClone(witness);
    const pending = Promise.withResolvers<Response>();
    const fetch = vi.fn(() => pending.promise);
    vi.stubGlobal('fetch', fetch);
    const result = captureLeague(witness);
    expect(fetch).toHaveBeenCalledOnce();
    witness.mapping.scope.season = 2025;
    witness.attempts.settings.nonce = uuid(99);
    pending.resolve(new Response(JSON.stringify(league)));
    const capture: CapturedAdministrationDocument = await result;
    expect(capture.acquisition).toEqual(expected);
    const payload = capture.payload as typeof league;
    expect(() => { payload.settings.divisions = 99; }).toThrow(TypeError);
    expect(() => { payload.roster_positions.push('RB'); }).toThrow(TypeError);
    expect(() => Object.assign(capture.acquisition!.attempts.settings, { nonce: uuid(98) })).toThrow(TypeError);
    expect(() => assertOriginalPublicCapture(capture, expected)).not.toThrow();
    expect(payload).toEqual(league);
  });

  it('accepts only the original capture object and rejects spread, serialization and witness retags before writing', async () => {
    fixtureFetch();
    const witness = coreWitness(), capture = await captureLeague(witness);
    const { store, recordObservation } = recorder();
    const options = { store, mapping: witness.mapping, fence: witness.fence, expectedAcquisition: witness };
    await recordCapturedAdministration(witness.mapping.scope, [capture], options);
    expect(recordObservation).toHaveBeenCalledOnce();
    const changed = { ...witness, dispatchNonce: uuid(98) };
    for (const copy of [{ ...capture }, JSON.parse(JSON.stringify(capture)) as CapturedAdministrationDocument,
      { ...capture, acquisition: changed }]) {
      await expect(recordCapturedAdministration(witness.mapping.scope, [copy], options)).rejects.toThrow(/Original public transport|acquisition mismatch/);
    }
    await expect(recordCapturedAdministration(witness.mapping.scope, [capture], { ...options, expectedAcquisition: changed }))
      .rejects.toThrow(/acquisition mismatch/);
    expect(recordObservation).toHaveBeenCalledOnce();
  });

  it.each([null, false, 0, ''])('fails closed for present falsy acquisition %j without legacy downgrade', async acquisition => {
    fixtureFetch();
    const capture = await captureLeague(), { store, recordObservation } = recorder(), witness = coreWitness();
    const invalid = { ...capture, acquisition } as unknown as CapturedAdministrationDocument;
    await expect(recordCapturedAdministration(witness.mapping.scope, [invalid], { store })).rejects.toThrow(/original acquisition context/);
    await expect(recordCapturedAdministration(witness.mapping.scope, [invalid], { store, expectedAcquisition: witness })).rejects.toThrow();
    expect(recordObservation).not.toHaveBeenCalled();
  });

  it('keeps omitted legacy acquisition compatible and refuses a retrofitted witness on old transport bytes', async () => {
    fixtureFetch();
    const capture = await captureLeague(), witness = coreWitness(), { store, recordObservation } = recorder();
    expect(capture).not.toHaveProperty('acquisition');
    expect(Object.isFrozen(capture)).toBe(false);
    await recordCapturedAdministration(witness.mapping.scope, [capture], { store });
    expect(recordObservation).toHaveBeenCalledOnce();
    await expect(recordCapturedAdministration(witness.mapping.scope, [{ ...capture, acquisition: witness }],
      { store, expectedAcquisition: witness })).rejects.toThrow(/Original public transport/);
    expect(recordObservation).toHaveBeenCalledOnce();
  });

  it('rejects malformed, extra, missing and duplicate witness/group fields', () => {
    const w = coreWitness();
    const invalid = [null, false, [], { ...w, unexpected: true }, { ...w, dispatchNonce: 'nonce' },
      { ...w, work: { ...w.work, unexpected: true } }, { ...w, fence: { ...w.fence, generation: 0 } },
      { ...w, fence: { ...w.fence, deadlineAt: 'unknown' } }, { ...w, fence: { ...w.fence, extra: true } },
      { ...w, mapping: { ...w.mapping, scope: { ...w.mapping.scope, externalLeagueId: '123' } } },
      { ...w, attempts: { players: w.attempts.players, managers: w.attempts.managers } },
      { ...w, attempts: { ...w.attempts, matchups: { id: uuid(14), nonce: uuid(24) } } },
      { ...w, attempts: { ...w.attempts, settings: { ...w.attempts.settings, extra: true } } },
      { ...w, attempts: { ...w.attempts, managers: { ...w.attempts.managers, id: w.attempts.players.id } } },
      { ...w, attempts: { ...w.attempts, managers: { ...w.attempts.managers, nonce: w.attempts.players.nonce } } }];
    for (const value of invalid) expect(() => parsePublicCaptureWitness(value)).toThrow();
  });

  it('matches the complete expected work, mapping, fence and role-to-attempt group', () => {
    const w = coreWitness(), ids = Object.fromEntries(Object.entries(w.attempts).map(([role, attempt]) => [role, attempt.id]));
    expect(validateRequestedPublicCaptureWitness(w, w.work, w.mapping, w.fence, ids)).toEqual(w);
    expect(() => validateRequestedPublicCaptureWitness(w, { ...w.work, revision: 4 }, w.mapping, w.fence, ids)).toThrow();
    expect(() => validateRequestedPublicCaptureWitness(w, w.work, { ...w.mapping, revisionId: uuid(97) }, w.fence, ids)).toThrow();
    expect(() => validateRequestedPublicCaptureWitness(w, w.work, w.mapping, { ...w.fence, generation: 5 }, ids)).toThrow();
    expect(() => validateRequestedPublicCaptureWitness(w, w.work, w.mapping, w.fence, { ...ids, settings: uuid(96) })).toThrow();
    const missingV2 = { settings: ids.settings, players: ids.players, managers: ids.managers };
    expect(() => validateRequestedPublicCaptureWitness(w, w.work, w.mapping, w.fence, missingV2)).toThrow();
  });
});

