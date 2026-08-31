import { describe, expect, it } from 'vitest';
import { compactPlayerName } from './player-name';
import { playerFromId } from './transform';

describe('compact player labels', () => {
  it.each([
    ['Jacory Croskey-Merritt', 'J. Croskey-Merritt'],
    ['Ja’Marr Chase', 'J. Chase'],
    ["D'Andre Swift", 'D. Swift'],
    ["Aidan O'Connell", "A. O'Connell"],
    ['Amon-Ra St. Brown', 'A. St. Brown'],
    ['Brian Thomas Jr.', 'B. Thomas Jr.'],
    ['Kenneth Walker III', 'K. Walker III'],
  ])('keeps the surname and suffix when shortening %s', (name, expected) => {
    expect(compactPlayerName(name, 'WR')).toBe(expected);
  });

  it('normalizes whitespace without changing one-word or empty labels', () => {
    expect(compactPlayerName(' \t Jacory   Croskey-Merritt \n')).toBe('J. Croskey-Merritt');
    expect(compactPlayerName('  Nacua  ')).toBe('Nacua');
    expect(compactPlayerName(' \n ')).toBe('');
  });

  it('does not invent initials for the actual missing-player and empty-slot fallbacks', () => {
    const empty = playerFromId('0', 'FLEX', {});
    const missing = playerFromId('12345', 'RB', {});
    expect(compactPlayerName(empty.name, empty.position)).toBe('Empty slot');
    expect(compactPlayerName(missing.name, missing.position)).toBe('Player 12345');
    expect(compactPlayerName('Unknown player')).toBe('Unknown player');
  });

  it.each([
    ['New York Jets', 'Jets'],
    ['New York Giants', 'Giants'],
    ['Washington Commanders', 'Commanders'],
    ['San Francisco 49ers', '49ers'],
    ['Los Angeles Rams Defense', 'Rams'],
    ['Green Bay Packers D/ST', 'Packers'],
  ])('uses a known defense nickname for %s', (name, expected) => {
    expect(compactPlayerName(name, 'DEF')).toBe(expected);
  });

  it('keeps defense fallbacks and ambiguous labels rather than using a person initial', () => {
    const defense = playerFromId('PIT', 'DEF', {});
    expect(compactPlayerName(defense.name, defense.position)).toBe('PIT Defense');
    expect(compactPlayerName('New York', 'DEF')).toBe('New York');
    expect(compactPlayerName('Unlisted Team', 'DEF')).toBe('Unlisted Team');
    expect(compactPlayerName('  Washington   Commanders  ', ' def ')).toBe('Commanders');
  });
});
