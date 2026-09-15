import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { watchSiteWeekRollover, type RolloverRefreshState, type SiteWeekRollover } from './use-site-week-rollover';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const cutoff = Date.parse('2026-09-15T16:00:00.000Z');
const signal: SiteWeekRollover = { week: 1, nextRolloverAt: new Date(cutoff).toISOString(),
  evaluatedAt: '2026-09-15T15:59:00.000Z' };

describe('site calendar browser rollover', () => {
  let surface: EventTarget;
  let visible: boolean;
  let state: RolloverRefreshState;
  const cleanups: Array<() => void> = [];
  const refresh = vi.fn();
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(cutoff - 1_000);
    visible = true;
    surface = new EventTarget();
    Object.defineProperty(surface, 'visibilityState', { get: () => visible ? 'visible' : 'hidden' });
    vi.stubGlobal('document', surface);
    state = { requested: new Set(), lastVisibilityRefreshAt: 0 };
    refresh.mockReset();
  });
  afterEach(() => {
    cleanups.splice(0).forEach(cleanup => cleanup());
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  function watch(value = signal) {
    const cleanup = watchSiteWeekRollover(value, refresh, state);
    cleanups.push(cleanup);
    return cleanup;
  }
  function visibility(value: boolean) {
    visible = value;
    surface.dispatchEvent(new Event('visibilitychange'));
  }

  it('refreshes at noon, allows one authority-settling retry, and never loops on the same boundary', () => {
    const stop = watch();
    vi.advanceTimersByTime(999);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    // Route refresh returned the same week; a new prop object must not reset the budget.
    stop();
    watch({ ...signal, evaluatedAt: new Date(cutoff + 100).toISOString() });
    vi.advanceTimersByTime(64_999);
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(3_600_000);
    expect(refresh).toHaveBeenCalledTimes(2);
    visibility(false); visibility(true);
    expect(refresh).toHaveBeenCalledTimes(3);
    visibility(false); visibility(true);
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it('does no background work while hidden and refreshes once after returning beyond both deadlines', () => {
    visibility(false);
    watch();
    vi.advanceTimersByTime(180_000);
    expect(refresh).not.toHaveBeenCalled();
    visibility(true);
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(3_600_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('does not repeatedly reload a fresh held week; returning to visibility can recheck once per minute', () => {
    vi.setSystemTime(cutoff + 120_000);
    watch({ ...signal, evaluatedAt: new Date(cutoff + 119_000).toISOString() });
    vi.advanceTimersByTime(3_600_000);
    expect(refresh).not.toHaveBeenCalled();
    visibility(false); visibility(true);
    expect(refresh).toHaveBeenCalledTimes(1);
    visibility(false); visibility(true);
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    visibility(false); visibility(true);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('cancels the timer and listener when navigating away', () => {
    const stop = watch();
    stop();
    vi.advanceTimersByTime(120_000);
    visibility(false); visibility(true);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('refreshes the Week 18 lifecycle boundary even though the displayed week stays 18', () => {
    watch({ ...signal, week: 18 });
    vi.advanceTimersByTime(1_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it.each([
    { ...signal, week: 19 }, { ...signal, week: 0 },
    { ...signal, nextRolloverAt: null }, { ...signal, nextRolloverAt: 'invalid' },
    { ...signal, evaluatedAt: 'invalid' },
  ])('does not schedule invalid or terminal calendar signals: %j', value => {
    watch(value);
    vi.advanceTimersByTime(7 * 86_400_000);
    visibility(false); visibility(true);
    expect(refresh).not.toHaveBeenCalled();
  });
});
