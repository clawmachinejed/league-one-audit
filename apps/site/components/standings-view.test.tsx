import { readFileSync } from 'node:fs';
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

describe('Standings shared view presentation', () => {
  it('adds Rosters immediately after Transactions while keeping Standings first', () => {
    const source = readFileSync(new URL('./standings-view.tsx', import.meta.url), 'utf8');
    expect(source.indexOf("value: 'standings'")).toBeLessThan(source.indexOf("value: 'waivers'"));
    expect(source.indexOf("value: 'transactions'")).toBeLessThan(source.indexOf("value: 'rosters'"));
    expect(source).toContain("useState<StandingsViewName>('standings')");
  });

  it('uses one fixed panel gap and no transaction-specific top offset', () => {
    const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.standings-view-tabs\{[^}]*margin:0 0 14px/gu);
    expect(css).toContain('.standings-view-panel{min-width:0}');
    expect(css).toContain('.league-transactions-panel{min-width:0;margin-top:0}');
  });

  it('keeps table names accessible without rendering redundant visible headings', () => {
    const source = readFileSync(new URL('./standings-view.tsx', import.meta.url), 'utf8');
    expect(source).not.toContain('className="section-label"');
    expect(source).toContain('<caption className="sr-only">');
    expect(source).not.toContain('<h2>Standings table</h2>');
    expect(source).not.toContain('<h2>Waiver table</h2>');
  });
});
