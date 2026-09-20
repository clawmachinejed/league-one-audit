import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ unstable_cache: <Value,>(value: Value) => value }));

import { createLiveProjectionWorker } from '../../live-projection-worker';
import { fakeStore, gameState, gameStates, workerDependencies } from '../../live-projection-worker.fixtures';
import { gameStatePersistenceDiagnostics } from './persistence-diagnostics';

describe('current provider persistence diagnostics', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each(['game-identities', 'game-states', 'scoring-identities', 'projection-slate'] as const)(
    'identifies the failed %s boundary and preserves the failed league count', async stage => {
      const dependencies = workerDependencies(fakeStore());
      dependencies.loggerMock.mockImplementation(() => undefined);
      const failure = Object.assign(new Error('game-state regression: regulation clock increased'), { code: 'P0001' });
      if (stage === 'game-identities') vi.spyOn(dependencies.identityCrosswalk, 'resolveNflGames').mockRejectedValueOnce(failure);
      if (stage === 'game-states') vi.spyOn(dependencies.repository, 'recordGameStates').mockRejectedValueOnce(failure);
      if (stage === 'scoring-identities') vi.spyOn(dependencies.identityCrosswalk, 'resolveScoringEntities').mockRejectedValueOnce(failure);
      if (stage === 'projection-slate') vi.spyOn(dependencies.repository, 'recordProjectionSlate').mockRejectedValueOnce(failure);
      const publish = vi.spyOn(dependencies.repository, 'publishSnapshot');

      await expect(createLiveProjectionWorker(dependencies).run()).resolves.toEqual({ status: 'failed' });
      const entries = dependencies.loggerMock.mock.calls.map(([, entry]) => entry);
      expect(entries).toContainEqual(expect.objectContaining({ stage: 'provider-persist', outcome: 'failed',
        persistenceStage: stage, persistenceFailureReason: 'game-clock-increased', databaseErrorCode: 'P0001', failedLeagues: 2 }));
      expect(entries.at(-1)).toMatchObject({ stage: 'league-publish', outcome: 'failed', failedLeagues: 2 });
      const diagnostic = entries.find(entry => entry.stage === 'provider-persist' && entry.outcome === 'failed');
      if (stage === 'game-states') {
        expect(diagnostic).toMatchObject({ gameStateCount: 1, gameStateSummaryTruncated: false,
          gameStateSummary: [{ homeTeam: 'KC', awayTeam: 'LAC', statusCode: 1, sourcePeriod: 'HALFTIME',
            gameClock: null, observedAt: '2026-09-13T18:00:02.000Z', requestCompletedAt: '2026-09-13T18:00:02.000Z' }] });
        expect(dependencies.repository.recordGameStates).toHaveBeenCalledTimes(1);
      } else {
        expect(diagnostic).not.toHaveProperty('gameStateSummary');
      }
      expect(dependencies.projectionMock).toHaveBeenCalledTimes(1);
      expect(dependencies.gamesMock).toHaveBeenCalledTimes(1);
      expect(publish).not.toHaveBeenCalled();
    },
  );

  it('adds a source-load failure to the remaining provider-group failures without double counting', async () => {
    const dependencies = workerDependencies(fakeStore());
    dependencies.loggerMock.mockImplementation(() => undefined);
    dependencies.sourceMock.mockRejectedValueOnce(new Error('Source unavailable'));
    vi.spyOn(dependencies.repository, 'recordGameStates').mockRejectedValueOnce(
      new Error('game-state regression: final game became non-final'),
    );

    await expect(createLiveProjectionWorker(dependencies).run()).resolves.toEqual({ status: 'failed' });
    const entries = dependencies.loggerMock.mock.calls.map(([, entry]) => entry);
    expect(entries).toContainEqual(expect.objectContaining({ stage: 'provider-persist', outcome: 'failed',
      persistenceStage: 'game-states', persistenceFailureReason: 'game-finality-regressed', failedLeagues: 1 }));
    expect(entries.at(-1)).toMatchObject({ stage: 'league-publish', outcome: 'failed', failedLeagues: 2 });
  });

  it('does not expose arbitrary messages, SQL fields, payloads, or secret-shaped error codes', async () => {
    const dependencies = workerDependencies(fakeStore());
    dependencies.loggerMock.mockImplementation(() => undefined);
    const secret = 'postgresql://runtime:private-password@database.invalid/production';
    const failure = Object.assign(new Error(`game-state regression: regulation clock increased ${secret}`), {
      code: 'TOKEN', constraint: secret, detail: secret, query: secret, cause: new Error(secret),
    });
    vi.spyOn(dependencies.repository, 'recordGameStates').mockRejectedValueOnce(failure);

    await expect(createLiveProjectionWorker(dependencies).run()).resolves.toEqual({ status: 'failed' });
    const entries = dependencies.loggerMock.mock.calls.map(([, entry]) => entry);
    const diagnostic = entries.find(entry => entry.stage === 'provider-persist' && entry.outcome === 'failed');
    expect(diagnostic).toMatchObject({ persistenceStage: 'game-states', persistenceFailureReason: 'unclassified' });
    expect(diagnostic).not.toHaveProperty('databaseErrorCode');
    const serialized = JSON.stringify(entries);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain('TOKEN');
    expect(serialized).not.toContain(failure.message);
  });

  it('reads untrusted error fields once so a changing getter cannot bypass the code allowlist', async () => {
    const dependencies = workerDependencies(fakeStore());
    dependencies.loggerMock.mockImplementation(() => undefined);
    const secret = 'Bearer private-changing-getter';
    let codeReads = 0;
    const failure = Object.defineProperty(new Error('game-state regression: regulation clock increased'), 'code', {
      get() { codeReads += 1; return codeReads <= 2 ? 'P0001' : secret; },
    });
    vi.spyOn(dependencies.repository, 'recordGameStates').mockRejectedValueOnce(failure);

    await expect(createLiveProjectionWorker(dependencies).run()).resolves.toEqual({ status: 'failed' });
    const entries = dependencies.loggerMock.mock.calls.map(([, entry]) => entry);
    expect(JSON.stringify(entries)).not.toContain(secret);
    expect(codeReads).toBe(1);
    expect(entries).toContainEqual(expect.objectContaining({ stage: 'provider-persist',
      persistenceFailureReason: 'game-clock-increased', databaseErrorCode: 'P0001' }));
  });

  it('bounds game summaries and omits identifiers, revisions, payloads, and invalid scalar fields', () => {
    const secret = 'Bearer private-provider-data';
    const original = gameState();
    const malformed = {
      ...original, homeTeam: secret, awayTeam: secret, statusCode: secret, sourcePeriod: secret,
      gameClock: secret, observedAt: '2026-02-30T18:00:02.000Z', requestCompletedAt: secret,
      gameRef: { ...original.gameRef, externalId: secret }, sourceRevision: secret, statusText: secret,
    } as unknown as typeof original;
    const slate = { ...gameStates(), games: [malformed, ...Array.from({ length: 32 }, () => ({
      ...original, sourcePeriod: 'Q3', gameClock: '09:42',
    }))] };
    const result = gameStatePersistenceDiagnostics(slate);
    expect(result).toMatchObject({ gameStateCount: 33, gameStateSummaryTruncated: true });
    expect(result.gameStateSummary).toHaveLength(32);
    expect(result.gameStateSummary?.[0]).toEqual({ homeTeam: null, awayTeam: null, statusCode: null,
      sourcePeriod: null, gameClock: null, observedAt: null, requestCompletedAt: null });
    expect(result.gameStateSummary?.[1]).toMatchObject({ homeTeam: 'KC', awayTeam: 'LAC', statusCode: 1,
      sourcePeriod: 'Q3', gameClock: '09:42' });
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(result)).not.toContain(original.sourceRevision);
    expect(slate.games).toHaveLength(33);
    expect(slate.games[0]).toBe(malformed);
  });

  it('captures game fields once and contains throwing getters without replacing the original failure', () => {
    let reads = 0;
    const game = Object.defineProperty({ ...gameState() }, 'homeTeam', {
      get() { reads += 1; return reads === 1 ? 'KC' : 'private-getter-data'; },
    });
    expect(gameStatePersistenceDiagnostics(gameStates(game)).gameStateSummary?.[0].homeTeam).toBe('KC');
    expect(reads).toBe(1);
    const throwing = Object.defineProperty({ ...gameState() }, 'sourcePeriod', {
      get() { throw new Error('private-getter-data'); },
    });
    expect(gameStatePersistenceDiagnostics(gameStates(throwing)).gameStateSummary?.[0]).toEqual({
      homeTeam: null, awayTeam: null, statusCode: null, sourcePeriod: null, gameClock: null,
      observedAt: null, requestCompletedAt: null,
    });
  });

  it('validates array counts and never invokes provider-controlled array methods', () => {
    const secret = 'private-array-data';
    const invalidLength = new Proxy([gameState()], {
      get(target, key, receiver) { return key === 'length' ? secret : Reflect.get(target, key, receiver); },
    });
    expect(gameStatePersistenceDiagnostics({ ...gameStates(), games: invalidLength })).toEqual({});
    const games = [gameState()];
    const slice = vi.fn(() => [secret]);
    const map = vi.fn(() => [secret]);
    Object.defineProperties(games, { slice: { value: slice }, map: { value: map } });
    const result = gameStatePersistenceDiagnostics({ ...gameStates(), games });
    expect(result).toMatchObject({ gameStateCount: 1, gameStateSummaryTruncated: false,
      gameStateSummary: [{ homeTeam: 'KC', awayTeam: 'LAC' }] });
    expect(slice).not.toHaveBeenCalled();
    expect(map).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(secret);
  });
});
