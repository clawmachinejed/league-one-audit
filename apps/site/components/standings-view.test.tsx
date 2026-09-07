import { describe, expect, it } from 'vitest';
import { formatWaiverBalance } from './standings-view';

describe('Standings waiver balance presentation', () => {
  it('shows valid zero as $0', () => {
    expect(formatWaiverBalance(0)).toBe('$0');
  });

  it('shows unavailable balances as an em dash instead of $0', () => {
    expect(formatWaiverBalance(null)).toBe('—');
  });

  it('does not clamp transferred or adjusted balances', () => {
    expect(formatWaiverBalance(125)).toBe('$125');
  });
});
