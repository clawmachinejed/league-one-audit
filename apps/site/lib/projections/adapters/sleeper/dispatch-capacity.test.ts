import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { createSleeperDispatchCapacity } from './dispatch-capacity';
describe('owned local dispatch capacity', () => {
  it('reserves at most 32 simultaneous slots, rejects without queuing and never refunds quarantined capacity', async () => {
    const closers: (() => void)[] = [];
    const reserve = createSleeperDispatchCapacity(release => {
      closers.push(release); return { dispatch: vi.fn(), terminateLocal: async () => 'unconfirmed', release };
    });
    const slots = await Promise.all(Array.from({ length: 40 }, reserve));
    expect(slots.filter(Boolean)).toHaveLength(32);
    await slots[0]!.terminateLocal(); expect(await reserve()).toBeNull();
    closers[1](); closers[1](); expect(await reserve()).not.toBeNull(); expect(await reserve()).toBeNull();
  });
  it('releases construction failures before dispatch without losing pool capacity', async () => {
    const create = vi.fn(() => { throw new Error('local unavailable'); });
    const reserve = createSleeperDispatchCapacity(create);
    for (let index = 0; index < 40; index++) expect(await reserve()).toBeNull();
    expect(create).toHaveBeenCalledTimes(40);
  });
});
