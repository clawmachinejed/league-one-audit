import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatchupBoxScores } from '../lib/matchup-box-score-types';
import type { BoxScoreActivity } from '../lib/matchup-box-score-refresh';
import { watchMatchupBoxScores } from './use-matchup-box-scores';

const live: BoxScoreActivity = { key: 'live', live: true, finalKeys: [] };
const final: BoxScoreActivity = { key: 'final', live: false, finalKeys: ['player:5859'] };
const available = (gamePhase = 'live', observedAt = '2026-09-13T17:00:00Z'): MatchupBoxScores => ({
  leagueKey: 'league1', season: '2026', week: 1, status: 'available', observedAt, revision: 'stored-observation',
  players: { 'player:5859': { stats: { rec: 3, rec_yd: 26 }, gamePhase } },
});

describe('visible matchup box-score reader', () => {
  let surface: EventTarget;
  let visible: boolean;
  const cleanups: Array<() => void> = [];
  const fetcher = vi.fn();
  const onData = vi.fn();
  const onLoading = vi.fn();
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime('2026-09-13T17:01:00Z');
    visible = true; surface = new EventTarget();
    Object.defineProperty(surface, 'visibilityState', { get: () => visible ? 'visible' : 'hidden' });
    vi.stubGlobal('document', surface); vi.stubGlobal('fetch', fetcher);
    fetcher.mockReset().mockImplementation(async () => Response.json(available()));
    onData.mockReset(); onLoading.mockReset();
  });
  afterEach(() => {
    cleanups.splice(0).forEach(cleanup => cleanup());
    vi.useRealTimers(); vi.unstubAllGlobals();
  });
  function watch(options: Partial<Parameters<typeof watchMatchupBoxScores>[0]> = {}) {
    const watcher = watchMatchupBoxScores({ leagueKey: 'league1', season: '2026', week: 1,
      refreshAutomatically: true, activity: live, initialData: null, onData, onLoading, ...options });
    cleanups.push(watcher.dispose); return watcher;
  }
  function visibility(value: boolean) {
    visible = value; surface.dispatchEvent(new Event('visibilitychange'));
  }
  const flush = () => vi.advanceTimersByTimeAsync(0);

  it('uses one shared stored-data read per minute while visible and live, without a capture-window restriction', async () => {
    const watcher = watch(); await flush();
    expect(fetcher).toHaveBeenCalledWith('/api/matchups/league1/box-scores?season=2026&week=1',
      { signal: expect.any(AbortSignal), cache: 'no-store' });
    watcher.request(); watcher.request();
    await vi.advanceTimersByTimeAsync(59_999); expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(fetcher).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(120_000); expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it.each([live, final])('keeps historical reads on demand without live polling or final retries: %j', async activity => {
    const watcher = watch({ refreshAutomatically: false, activity }); await flush();
    await vi.advanceTimersByTimeAsync(3_600_000);
    visibility(false); visibility(true); await flush();
    expect(fetcher).toHaveBeenCalledTimes(1);
    watcher.request(); await flush(); expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('preserves the hourly active-week refresh without minute polling or guessing kickoff', async () => {
    watch({ activity: { key: 'scheduled', live: false, finalKeys: [] } }); await flush();
    await vi.advanceTimersByTimeAsync(119_999); expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(fetcher).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(3_599_999); expect(fetcher).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1); expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('allows only two final-settling retries, then preserves hourly correction reads', async () => {
    const first = watch({ activity: final }); await flush();
    await vi.advanceTimersByTimeAsync(600_000); expect(fetcher).toHaveBeenCalledTimes(3);
    first.dispose(); fetcher.mockClear();
    fetcher.mockResolvedValueOnce(Response.json(available('live')))
      .mockImplementation(async () => Response.json(available('final')));
    watch({ activity: final }); await flush();
    await vi.advanceTimersByTimeAsync(600_000); expect(fetcher).toHaveBeenCalledTimes(2);
    expect(onData.mock.lastCall?.[0].players['player:5859'].gamePhase).toBe('final');
    await vi.advanceTimersByTimeAsync(42 * 60_000); expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('backs off after three failures and recovers a visible live page automatically', async () => {
    watch(); await flush();
    fetcher.mockImplementation(async () => new Response(null, { status: 503 }));
    await vi.advanceTimersByTimeAsync(180_000); expect(fetcher).toHaveBeenCalledTimes(4);
    expect(onData).toHaveBeenCalledTimes(1);
    fetcher.mockImplementation(async () => Response.json(available('live', '2026-09-13T17:05:00Z')));
    await vi.advanceTimersByTimeAsync(299_999); expect(fetcher).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(1); expect(fetcher).toHaveBeenCalledTimes(5);
    expect(onData).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60_000); expect(fetcher).toHaveBeenCalledTimes(6);
    expect(onData).toHaveBeenCalledTimes(3);
  });

  it.each(['unavailable', 'older', 'wrong-scope'] as const)('never replaces accepted statistics with %s responses', async kind => {
    const previous = available();
    const response = kind === 'unavailable' ? { ...previous, status: 'unavailable', observedAt: null, revision: null, players: {} }
      : kind === 'older' ? available('live', '2026-09-13T16:59:00Z') : { ...previous, week: 2 };
    fetcher.mockImplementation(async () => Response.json(response));
    watch({ initialData: previous }); await flush();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(fetcher).toHaveBeenCalledTimes(4); expect(onData).not.toHaveBeenCalled();
  });

  it('aborts a hidden request, makes no hidden reads, and catches up when visible without overlapping requests', async () => {
    let aborted = false;
    fetcher.mockImplementationOnce((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal!.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); });
    }));
    watch(); visibility(false); await flush();
    expect(aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(600_000); expect(fetcher).toHaveBeenCalledTimes(1);
    visibility(true); await flush(); expect(fetcher).toHaveBeenCalledTimes(2);
    expect(onData).toHaveBeenCalledTimes(1);
  });

  it('bounds hung requests to fifteen seconds and backs off after repeated timeouts', async () => {
    fetcher.mockImplementation((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal!.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    watch(); await vi.advanceTimersByTimeAsync(14_999);
    expect(onLoading.mock.lastCall?.[0]).toBe(true);
    await vi.advanceTimersByTimeAsync(1); expect(onLoading.mock.lastCall?.[0]).toBe(false);
    await vi.advanceTimersByTimeAsync(600_000); expect(fetcher).toHaveBeenCalledTimes(4);
    expect(onData).not.toHaveBeenCalled();
  });

  it('discards a late response after navigation even if the fetch implementation ignores cancellation', async () => {
    let finish!: (value: Response) => void;
    fetcher.mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }));
    const watcher = watch(); watcher.request(); expect(fetcher).toHaveBeenCalledTimes(1);
    const signal = fetcher.mock.calls[0][1].signal as AbortSignal;
    watcher.dispose(); expect(signal.aborted).toBe(true);
    finish(Response.json(available())); await flush();
    await vi.advanceTimersByTimeAsync(600_000); visibility(false); visibility(true);
    expect(fetcher).toHaveBeenCalledTimes(1); expect(onData).not.toHaveBeenCalled();
  });
});
