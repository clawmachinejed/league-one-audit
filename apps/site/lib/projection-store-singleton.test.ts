import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import type { Database } from './database';

afterEach(() => {
  vi.doUnmock('./database');
  vi.resetModules();
});

describe('projection-store singleton characterization', () => {
  it('reuses a store for one database object and refreshes when that object changes', async () => {
    let database: Database = { enabled: false, reason: 'missing-database-url' };
    vi.resetModules();
    vi.doMock('./database', () => ({ getDatabase: () => database }));

    const { getProjectionStore } = await import('./projection-store');
    const first = getProjectionStore();
    expect(getProjectionStore()).toBe(first);
    expect(first.enabled).toBe(false);

    database = { enabled: false, reason: 'invalid-database-url' };
    const second = getProjectionStore();
    expect(second).not.toBe(first);
    expect(getProjectionStore()).toBe(second);
    expect(second.enabled).toBe(false);

    database = {
      enabled: true,
      async query() {
        return [];
      },
    };
    const connected = getProjectionStore();
    expect(connected).not.toBe(second);
    expect(getProjectionStore()).toBe(connected);
    expect(connected.enabled).toBe(true);
  });
});
