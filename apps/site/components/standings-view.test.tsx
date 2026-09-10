import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { formatStandingsPoints, formatWaiverBalance } from './standings-view';

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
  it('uses League as the visible heading without renaming the internal tabs', () => {
    const source = readFileSync(new URL('./standings-view.tsx', import.meta.url), 'utf8');
    expect(source).toContain('<PageIntro title="League"');
    expect(source).toContain("{ value: 'standings', label: 'Standings' }");
    expect(source).toContain("{ value: 'waivers', label: 'Waivers' }");
    expect(source).toContain("{ value: 'transactions', label: 'Transactions' }");
    expect(source).toContain("{ value: 'rosters', label: 'Rosters' }");
  });

  it('uses the same positive-only two-decimal presentation for PF and PA', () => {
    expect([formatStandingsPoints(12.345), formatStandingsPoints(0.01)]).toEqual(['12.35', '0.01']);
    expect([0, -1, null, undefined, Number.NaN, Number.POSITIVE_INFINITY].map(formatStandingsPoints))
      .toEqual(['—', '—', '—', '—', '—', '—']);
  });

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

  it('uses normal-weight ranks and places the existing avatar beside the manager', () => {
    const source = readFileSync(new URL('./standings-view.tsx', import.meta.url), 'utf8');
    const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
    expect(source).toContain('<td className="rank-cell"><span>{team.rank}</span></td>');
    expect(source).not.toContain('rank-top');
    expect(css).not.toContain('.rank-top');
    expect(source).toMatch(/className="manager-meta"><Avatar team=\{team\} \/>/u);
    expect(css).toMatch(/\.manager-meta \.avatar\{width:14px;height:14px/gu);
  });
});
