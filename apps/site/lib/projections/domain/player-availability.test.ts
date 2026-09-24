import { describe, expect, it } from 'vitest';
import { classifyPlayerAvailability } from './player-availability';

describe('canonical explicit player availability', () => {
  it.each([
    ['Out', 'OUT'], ['Inactive', 'INACTIVE'], ['Suspended', 'SUSPENDED'], ['SUS', 'SUSPENDED'],
    ['IR', 'IR'], ['Injured Reserve', 'IR'], ['PUP', 'PUP'], ['Physically Unable To Perform', 'PUP'],
    ['NFI', 'NFI'], ['Non-Football Injury', 'NFI'],
  ])('recognizes %s as nonparticipation without changing the canonical label', (value, statusLabel) => {
    expect(classifyPlayerAvailability(value)).toMatchObject({ participation: 'not-playing', statusLabel });
  });

  it.each([' / ', ',', ';', '|', '&', '+'])('deduplicates composite flags separated by %s', delimiter => {
    expect(classifyPlayerAvailability(` doubtful ${delimiter} ir ${delimiter} out `))
      .toEqual({ kind: 'ir', participation: 'not-playing', statusLabel: 'IR' });
  });

  it('keeps doubtful uncertain and does not infer unavailability from unknown text', () => {
    expect(classifyPlayerAvailability('Doubtful')).toEqual({
      kind: 'doubtful', participation: 'uncertain', statusLabel: 'DOUBTFUL',
    });
    expect(classifyPlayerAvailability('Unknown status')).toBe('unknown');
    expect(classifyPlayerAvailability('Not Out')).toBe('unknown');
  });

  it.each([null, '', '   ', 'Questionable', 'QUES', 'Probable', 'Questionable / Probable'])(
    'does not classify %s as nonparticipation', value => {
      expect(classifyPlayerAvailability(value)).toBe('clear');
    },
  );
});
