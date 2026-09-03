import { describe, expect, it } from 'vitest';
import { externalLeagueRef } from '../../shared/provider-identity';
import { createLeagueRegistry } from './league-registry';

describe('canonical active-league registry', () => {
  it('preserves caller order and accepts provider-neutral league keys', () => {
    const first = {
      key: 'premier',
      displayName: 'Premier League',
      leagueRef: externalLeagueRef('official-source', 'opaque-1'),
    };
    const second = {
      key: 'relegation',
      displayName: 'Relegation League',
      leagueRef: externalLeagueRef('official-source', 'opaque-2'),
    };

    const registry = createLeagueRegistry([first, second]);

    expect(registry.listActiveLeagues()).toEqual([first, second]);
    expect(registry.listActiveLeagues()).toBe(registry.listActiveLeagues());
  });

  it('normalizes surrounding display configuration without touching opaque IDs', () => {
    const registry = createLeagueRegistry([{
      key: ' league-a ',
      displayName: ' League A ',
      leagueRef: externalLeagueRef('source', ' 001 '),
    }]);

    expect(registry.listActiveLeagues()[0]).toMatchObject({
      key: 'league-a',
      displayName: 'League A',
      leagueRef: { provider: 'source', externalId: '001' },
    });
  });

  it('rejects duplicate keys and duplicate provider-scoped league references', () => {
    const leagueRef = externalLeagueRef('source', 'league-1');
    expect(() => createLeagueRegistry([
      { key: 'one', displayName: 'One', leagueRef },
      { key: 'one', displayName: 'Two', leagueRef: externalLeagueRef('source', 'league-2') },
    ])).toThrow('Duplicate league key: one');
    expect(() => createLeagueRegistry([
      { key: 'one', displayName: 'One', leagueRef },
      { key: 'two', displayName: 'Two', leagueRef },
    ])).toThrow('An external league reference was configured more than once.');
  });

  it.each([
    { key: ' ', displayName: 'League' },
    { key: 'league', displayName: ' ' },
  ])('rejects blank runtime configuration: $key/$displayName', ({ key, displayName }) => {
    expect(() => createLeagueRegistry([{
      key,
      displayName,
      leagueRef: externalLeagueRef('source', 'league-1'),
    }])).toThrow(/must not be blank/u);
  });
});
