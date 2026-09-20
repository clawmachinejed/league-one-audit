import { describe, expect, it, vi } from 'vitest';
import { buildManagerHistory, type ManagerHistorySeason } from './manager-history';
import type { SleeperMatchup } from './transform';
import type { Team } from './types';

vi.mock('server-only', () => ({}));

function team(id: number, managerName: string): Team {
  return { id, managerName, name: `Unrelated team ${id}`, avatar: null,
    wins: 99, losses: 99, ties: 99, pointsFor: 999, pointsAgainst: 999 };
}

function rows(ids = [1, 2], scores: Array<number | null> = [10, 5]): SleeperMatchup[] {
  return ids.map((roster_id, index) => ({ roster_id, matchup_id: Math.floor(index / 2) + 1, points: scores[index] }));
}

function season(year = 2026, fields: Partial<ManagerHistorySeason> = {}): ManagerHistorySeason {
  return { season: year, externalLeagueId: `source-${year}`, teams: [team(1, 'Alice'), team(2, 'Bob')],
    rosters: [{ roster_id: 1, owner_id: 'alice' }, { roster_id: 2, owner_id: 'bob' }],
    throughWeek: 1, rows: [rows()], ...fields };
}

describe('manager history', () => {
  it('unions stable owners across roster changes and retains former and new managers', () => {
    const old = season(2025);
    const current = season(2026, { teams: [team(7, 'Alice now'), team(2, 'Cara')],
      rosters: [{ roster_id: 7, owner_id: 'alice' }, { roster_id: 2, owner_id: 'cara' }], rows: [rows([7, 2], [2, 8])] });
    const original = structuredClone([old, current]);
    const result = buildManagerHistory([current, old], 2026);
    expect(result.warning).toBeUndefined();
    expect(result.managers).toEqual([
      { ownerId: 'alice', currentTeamId: 7, managerName: 'Alice now', avatar: null,
        wins: 1, losses: 1, ties: 0, seasons: [2025, 2026], championshipYears: [], promotionChampionshipYears: [] },
      { ownerId: 'bob', currentTeamId: null, managerName: 'Bob', avatar: null,
        wins: 0, losses: 1, ties: 0, seasons: [2025], championshipYears: [], promotionChampionshipYears: [] },
      { ownerId: 'cara', currentTeamId: 2, managerName: 'Cara', avatar: null,
        wins: 1, losses: 0, ties: 0, seasons: [2026], championshipYears: [], promotionChampionshipYears: [] },
    ]);
    expect([old, current]).toEqual(original);
  });

  it('does not merge managers with identical display names', () => {
    const result = buildManagerHistory([season(2026, { teams: [team(1, 'Same'), team(2, 'Same')] })], 2026);
    expect(result.managers.map(value => value.ownerId)).toEqual(['alice', 'bob']);
    expect(result.managers.map(value => value.wins)).toEqual([1, 0]);
  });

  it('applies the current League Two correction and honors without changing historical ownership', () => {
    const old = season(2025, { externalLeagueId: '1188632897157021696', teams: [team(1, 'eneerg'), team(2, 'Bob')],
      rosters: [{ roster_id: 1, owner_id: '95628446075863040' }, { roster_id: 2, owner_id: 'bob' }] });
    const current = season(2026, { externalLeagueId: '1378850360529014784', teams: old.teams, rosters: old.rosters });
    const result = buildManagerHistory([old, current], 2026);
    expect(result.warning).toBeUndefined();
    expect(result.managers.find(value => value.ownerId === '95628446075863040')).toMatchObject({
      managerName: 'eneerg', currentTeamId: null, wins: 1, seasons: [2025], championshipYears: [2010, 2012, 2017] });
    expect(result.managers.find(value => value.ownerId === '862177751849877504')).toMatchObject({
      managerName: 'tylerawildman', currentTeamId: 1, wins: 1, seasons: [2026], championshipYears: [], promotionChampionshipYears: [] });
  });

  it('does not assign primary-owner artwork to a corrected co-owner', () => {
    const source = season(2026, {
      teams: [{ ...team(1, 'eneerg'), avatar: 'eneerg-avatar' }, { ...team(2, 'Bob'), avatar: 'bob-avatar' }],
      rosters: [{ roster_id: 1, owner_id: '95628446075863040', co_owners: ['862177751849877504'] },
        { roster_id: 2, owner_id: 'bob' }],
    });
    const original = structuredClone(source);
    const corrected = buildManagerHistory([source], 2026, 'league2');
    expect(corrected.warning).toBeUndefined();
    expect(corrected.managers.find(value => value.ownerId === '862177751849877504'))
      .toMatchObject({ managerName: 'tylerawildman', avatar: null, wins: 1 });
    expect(corrected.managers.find(value => value.ownerId === 'bob')).toMatchObject({ avatar: 'bob-avatar' });
    expect(buildManagerHistory([source], 2026, 'league1').managers
      .find(value => value.ownerId === '95628446075863040')).toMatchObject({ avatar: 'eneerg-avatar' });
    expect(source).toEqual(original);
  });

  it('preserves both explicit trophy lists for a historical-only owner', () => {
    const old = season(2025, { rosters: [{ roster_id: 1, owner_id: '1119176673112563712' }, { roster_id: 2, owner_id: 'bob' }] });
    const result = buildManagerHistory([old, season()], 2026);
    expect(result.managers.find(value => value.ownerId === '1119176673112563712')).toMatchObject({
      currentTeamId: null, championshipYears: [2008, 2009, 2014, 2025], promotionChampionshipYears: [2020, 2022] });
  });

  it('caps every season at Week 14 and does not inspect malformed playoff rows', () => {
    const old = season(2025, { throughWeek: 18, rows: [...Array.from({ length: 14 }, () => rows()), null, null, null, null] });
    const current = season(2026, { throughWeek: 18, rows: [...Array.from({ length: 14 }, () => rows([1, 2], [0, 5])), null, null, null, null] });
    const result = buildManagerHistory([old, current], 2026);
    expect(result.warning).toBeUndefined();
    expect(result.managers[0]).toMatchObject({ wins: 14, losses: 14, ties: 0 });
  });

  it('uses official custom zero scores and ties through the shared completed-result calculator', () => {
    const overridden = rows();
    overridden[0].custom_points = 0;
    const result = buildManagerHistory([season(2026, { throughWeek: 2, rows: [overridden, rows([1, 2], [-1, -1])] })], 2026);
    expect(result.managers[0]).toMatchObject({ wins: 0, losses: 1, ties: 1 });
    expect(result.managers[1]).toMatchObject({ wins: 1, losses: 0, ties: 1 });
  });

  it('uses a verified zero-game baseline without borrowing current aggregate records', () => {
    const result = buildManagerHistory([season(2026, { throughWeek: 0, rows: [rows()] })], 2026);
    expect(result.warning).toBeUndefined();
    expect(result.managers.map(value => [value.wins, value.losses, value.ties])).toEqual([[0, 0, 0], [0, 0, 0]]);
  });

  it.each([
    ['missing week', { throughWeek: 2, rows: [rows()] }],
    ['null week', { rows: [null] }],
    ['missing score', { rows: [rows([1, 2], [null, 5])] }],
    ['duplicate matchup roster', { rows: [rows([1, 1])] }],
    ['unknown completed week', { throughWeek: null }],
    ['negative completed week', { throughWeek: -1 }],
    ['fractional completed week', { throughWeek: 1.5 }],
  ] satisfies Array<[string, Partial<ManagerHistorySeason>]>)('retains identities but withholds every aggregate for %s', (_reason, fields) => {
    const result = buildManagerHistory([season(2025, fields), season()], 2026);
    expect(result.managers.map(value => value.ownerId)).toEqual(['alice', 'bob']);
    expect(result.managers.every(value => value.wins === null && value.losses === null && value.ties === null)).toBe(true);
    expect(result.warning).toContain('2025 history:');
  });

  it('does not silently omit a completely unavailable season', () => {
    const result = buildManagerHistory([season(2025, { teams: [], rosters: [], rows: [], throughWeek: null,
      unavailableReason: 'The saved 2025 season is unavailable.' }), season()], 2026);
    expect(result.managers).toHaveLength(2);
    expect(result.managers.every(value => value.wins === null)).toBe(true);
    expect(result.warning).toContain('The saved 2025 season is unavailable.');
  });

  it('keeps a duplicated owner once, with unavailable results and no ambiguous profile link', () => {
    const result = buildManagerHistory([season(2026, { rosters: [{ roster_id: 1, owner_id: 'alice' }, { roster_id: 2, owner_id: 'alice' }] })], 2026);
    expect(result.managers).toHaveLength(1);
    expect(result.managers[0]).toMatchObject({ ownerId: 'alice', currentTeamId: null, wins: null });
    expect(result.warning).toContain('ownership or names are incomplete or ambiguous');
  });

  it('does not invent an account for an unassigned roster or erase a valid historical participant', () => {
    const result = buildManagerHistory([season(2025), season(2026, { rosters: [{ roster_id: 1, owner_id: 'alice' }, { roster_id: 2, owner_id: null }] })], 2026);
    expect(result.managers.map(value => value.ownerId)).toEqual(['alice', 'bob']);
    expect(result.managers.find(value => value.ownerId === 'bob')).toMatchObject({ currentTeamId: null, wins: null, seasons: [2025] });
    expect(result.warning).toContain('2026 history: manager ownership');
  });

  it('retains valid accounts with conflicting roster numbers without assigning names or links', () => {
    const result = buildManagerHistory([season(2026, { rosters: [{ roster_id: 1, owner_id: 'alice' }, { roster_id: 1, owner_id: 'bob' }] })], 2026);
    expect(result.managers.map(value => value.ownerId)).toEqual(['alice', 'bob']);
    expect(result.managers.every(value => value.managerName === 'Manager name unavailable' && value.currentTeamId === null && value.wins === null)).toBe(true);
    expect(result.warning).toContain('ambiguous');
  });

  it('rejects duplicate season inputs instead of doubling results or selecting an arbitrary current link', () => {
    const result = buildManagerHistory([season(), season()], 2026);
    expect(result.managers).toHaveLength(2);
    expect(result.managers.every(value => value.wins === null && value.currentTeamId === null)).toBe(true);
    expect(result.warning).toContain('season identity is invalid or duplicated');
  });

  it('warns when current season membership is absent rather than claiming historical-only totals are complete', () => {
    const result = buildManagerHistory([season(2025)], 2026);
    expect(result.managers.every(value => value.wins === null && value.currentTeamId === null)).toBe(true);
    expect(result.warning).toContain('Current-season membership');
    expect(buildManagerHistory([], 2026)).toMatchObject({ managers: [], warning: expect.any(String) });
  });
});
