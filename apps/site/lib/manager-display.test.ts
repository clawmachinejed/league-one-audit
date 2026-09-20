import { describe, expect, it } from 'vitest';
import { displayedManagerOwnerId, displayedManagerTeams } from './manager-display';
import type { Team } from './types';

const tyler = '862177751849877504';
const eneerg = '95628446075863040';
const team: Team = { id: 7, name: 'Original team', managerName: 'eneerg', avatar: null,
  wins: 8, losses: 6, ties: 0, pointsFor: 1000, pointsAgainst: 900 };

describe('League Two owner-confirmed co-owner attribution', () => {
  it.each(['1188632897157021696', '1378850360529014784', 'future-annual-connection'])(
    'uses stable co-owner evidence for %s without depending on a roster slot or year', leagueId => {
      const roster = { roster_id: 7, owner_id: eneerg, co_owners: [tyler] };
      const before = JSON.stringify({ roster, team });
      expect(displayedManagerOwnerId(leagueId, 7, eneerg, roster.co_owners, 'league2')).toBe(tyler);
      expect(displayedManagerTeams(leagueId, [team], [roster], 'league2')).toEqual([{ ...team, managerName: 'tylerawildman' }]);
      expect(JSON.stringify({ roster, team })).toBe(before);
    });
  it.each(['league1', 'dynasty'])('never moves %s ownership even for the same account pair', leagueKey => {
    expect(displayedManagerOwnerId('annual-source', 7, eneerg, [tyler], leagueKey)).toBe(eneerg);
    expect(displayedManagerTeams('annual-source', [team],
      [{ roster_id: 7, owner_id: eneerg, co_owners: [tyler] }], leagueKey)).toEqual([team]);
  });
  it.each([undefined, null, [], ['tylerawildman'], ['another-user']])('does not infer an old or renewed connection from missing/mismatched co-owner evidence: %j', coOwners => {
    expect(displayedManagerOwnerId('annual-source', 7, eneerg, coOwners, 'league2')).toBe(eneerg);
  });
  it('allows the proved co-owner when the primary owner is absent', () => {
    expect(displayedManagerOwnerId('annual-source', 7, null, [tyler], 'league2')).toBe(tyler);
  });
  it('retains the exact previously approved legacy correction only in its existing scope', () => {
    expect(displayedManagerOwnerId('1378850360529014784', 1, eneerg)).toBe(tyler);
    expect(displayedManagerOwnerId('1188632897157021696', 1, eneerg)).toBe(eneerg);
    expect(displayedManagerOwnerId('1378850360529014784', 2, eneerg)).toBe(eneerg);
    expect(displayedManagerOwnerId('1378850360529014784', 1, 'someone-else')).toBe('someone-else');
  });
});
