import { describe, expect, it } from 'vitest';
import { injuryStatusLabel, normalizeInjuryStatus } from './injury-status';

describe('Sleeper injury designations', () => {
  it.each([null, undefined, '', ' \t\n ', 0, 1, false, true, {}, ['Out']].map((value) => ({ value })))(
    'does not manufacture an injury designation from $value', ({ value }) => {
      expect(normalizeInjuryStatus(value)).toBeNull();
    },
  );

  it('trims the upstream designation without changing or reinterpreting it', () => {
    expect(normalizeInjuryStatus('  Questionable \n')).toBe('Questionable');
    expect(normalizeInjuryStatus('DNR')).toBe('DNR');
    expect(normalizeInjuryStatus('New upstream designation')).toBe('New upstream designation');
  });

  it('abbreviates Questionable and leaves absent designations blank', () => {
    expect(injuryStatusLabel('Questionable')).toBe('QUES');
    expect(injuryStatusLabel(' questionable ')).toBe('QUES');
    expect(injuryStatusLabel(null)).toBeNull();
    expect(injuryStatusLabel(undefined)).toBeNull();
    expect(injuryStatusLabel(' ')).toBeNull();
  });

  it.each(['Out', 'IR', 'PUP', 'Sus', 'DNR', 'NA', 'COV', 'Doubtful', 'Probable', 'New designation'])(
    'preserves %s rather than guessing a different status', (status) => {
      expect(injuryStatusLabel(status)).toBe(status);
    },
  );
});
