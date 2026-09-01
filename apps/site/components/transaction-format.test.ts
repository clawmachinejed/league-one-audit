import { describe, expect, it } from 'vitest';
import { transactionMovementClass } from './transaction-format';

describe('transaction movement presentation', () => {
  it.each(['Add', 'Added', 'League One receives', 'League One received'])('%s is an incoming movement', (label) => {
    expect(transactionMovementClass(label)).toBe('movement-add');
  });

  it.each(['Drop', 'Dropped', 'League One sends', 'League One sent'])('%s is an outgoing movement', (label) => {
    expect(transactionMovementClass(label)).toBe('movement-drop');
  });

  it('leaves informational transaction lines neutral', () => {
    expect(transactionMovementClass('FAAB transfer')).toBe('');
    expect(transactionMovementClass('Draft pick')).toBe('');
  });

  it('uses the generated movement verb rather than words inside a team name', () => {
    expect(transactionMovementClass('Always Receives sends')).toBe('movement-drop');
    expect(transactionMovementClass('Drop Everything receives')).toBe('movement-add');
  });
});
