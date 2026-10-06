import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ unstable_cache: <T,>(fn: T) => fn }));
import { normalizeSleeperAccountIdentity, normalizeSleeperUserIdentity, normalizeSleeperDiscoverySeason } from './sleeper';
describe('shared canonical provider identity and legacy presentation', () => {
  it('retains missing, null, invalid and empty source distinctions without inventing display identity', () => {
    expect(normalizeSleeperAccountIdentity({ user_id: '99999999999999999999', display_name: null, avatar: false }, 'name'))
      .toEqual({ kind: 'identity', nativeAccountId: '99999999999999999999', username: { state: 'absent', value: null },
        displayName: { state: 'null', value: null }, avatar: { state: 'invalid', value: null } });
    expect(normalizeSleeperAccountIdentity({ user_id: '123', username: '' }, 'name').username).toEqual({ state: 'empty', value: '' });
  });
  it('reuses canonical parsing while preserving existing trimmed labels and avatar URL presentation', () => {
    const raw = { user_id: '123', username: ' name ', display_name: ' Display ', avatar: 'avatar_01' };
    expect(normalizeSleeperAccountIdentity(raw, 'name').username).toEqual({ state: 'known', value: ' name ' });
    expect(normalizeSleeperUserIdentity(raw, 'name')).toEqual({ userId: '123', username: 'name', displayName: 'Display',
      avatarUrl: 'https://sleepercdn.com/avatars/thumbs/avatar_01' });
    expect(normalizeSleeperUserIdentity({ user_id: '123', username: ' name ', display_name: [], avatar: '../bad' }, 'name'))
      .toEqual({ userId: '123', username: 'name', displayName: 'name', avatarUrl: null });
  });
  it.each([null, {}, { user_id: 123 }, { user_id: '456' }])('rejects invalid or different stable identity %j', raw => {
    expect(() => normalizeSleeperAccountIdentity(raw, '123')).toThrow();
  });
  it.each([undefined, null, '', ' ', 'x'.repeat(101), 123])('legacy presentation still refuses invalid username %j', username => {
    expect(() => normalizeSleeperUserIdentity({ user_id: '123', username }, 'name')).toThrow();
  });
  it('uses provider league_season rather than calendar year or scoring season', () => {
    expect(normalizeSleeperDiscoverySeason({ season: '2026', league_season: '2027', season_type: 'regular', week: 10 })).toBe('2027');
  });
});
