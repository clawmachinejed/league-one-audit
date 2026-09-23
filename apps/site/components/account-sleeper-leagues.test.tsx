import type { ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AccountLink, SleeperLeagueDiscovery } from '@/lib/accounts/contracts';
import type { LeagueCapabilityReport } from '@/lib/league-capability-contracts';

vi.mock('next/link', () => ({ default: ({ children, prefetch, ...props }: ComponentProps<'a'> & { prefetch?: boolean }) => {
  void prefetch; return <a {...props}>{children}</a>;
} }));

import { AccountSleeperLeagues, SleeperLeagueResults } from './account-sleeper-leagues';

const links: AccountLink[] = [{ id: 'link-a', sourceManagerAccountId: 'source-a', displayName: 'Member A', provider: 'sleeper',
  assurance: 'user_asserted', revision: 1 }];
const data: SleeperLeagueDiscovery = { accountId: 'user-a', season: '2026', status: 'complete',
  profiles: [{ sourceManagerAccountId: 'source-a', displayName: 'Member A', status: 'complete' }],
  leagues: [{ id: '1234567890123456789', name: 'External league', season: '2026', url: 'https://sleeper.com/leagues/1234567890123456789',
    sourceManagerAccountIds: ['source-a'] }] };
const capabilities: LeagueCapabilityReport = { version: 'league-capabilities-v1', configurationRevision: 'a'.repeat(64),
  scoringRulesHash: 'b'.repeat(64), assessedAt: '2026-09-24T12:00:00.000Z', status: 'unsupported', features: [
    { id: 'roster', label: 'Roster', status: 'supported', reasons: ['These roster slots are supported.'] },
    { id: 'actual_scoring', label: 'Official scores', status: 'supported', reasons: ['Official points come from Sleeper.'] },
    { id: 'projections', label: 'Projections', status: 'unsupported', reasons: ['These scoring settings are not supported.'], ruleKeys: ['pass_rush_yd'] },
    { id: 'standings', label: 'Standings', status: 'limited', reasons: ['Projected standings do not include median games.'] },
    { id: 'schedule_history', label: 'Schedule and history', status: 'supported', reasons: ['This schedule format is supported.'] },
    { id: 'substitutions', label: 'Substitutions', status: 'unverified', reasons: ['Substitution settings were not supplied.'] },
  ] };

describe('Sleeper discovery presentation', () => {
  it('offers account association before any discovery work when no profile is linked', () => {
    const html = renderToStaticMarkup(<AccountSleeperLeagues accountId="user-a" links={[]} />);
    expect(html).toContain('aria-labelledby="sleeper-leagues-heading"');
    expect(html).toContain('Associate a Sleeper account');
    expect(html).toContain('href="/account"');
    expect(html).not.toContain('Loading Sleeper leagues');
  });

  it('shows independent loading before results arrive', () => {
    const html = renderToStaticMarkup(<AccountSleeperLeagues accountId="user-a" links={links} />);
    expect(html).toContain('Loading Sleeper leagues');
    expect(html).not.toContain('Open in Sleeper');
  });

  it('labels the season and associated profile, using only the fixed Sleeper league destination', () => {
    const html = renderToStaticMarkup(<SleeperLeagueResults data={{ ...data, leagues: [{ ...data.leagues[0], url: 'https://untrusted.example' }] }} />);
    expect(html).toContain('2026 NFL season');
    expect(html).toContain('Member A');
    expect(html).toContain('External league');
    expect(html).toContain('href="https://sleeper.com/leagues/1234567890123456789"');
    expect(html).toContain('Open in Sleeper');
    expect(html).not.toContain('untrusted.example');
    expect(html).not.toContain('Save league');
    expect(html).not.toContain('Participating');
  });

  it('keeps successful leagues visible and identifies an unavailable associated profile', () => {
    const html = renderToStaticMarkup(<SleeperLeagueResults data={{ ...data, status: 'partial', profiles: [...data.profiles,
      { sourceManagerAccountId: 'source-b', displayName: 'Member B', status: 'unavailable' }] }} />);
    expect(html).toContain('Could not load leagues for Member B');
    expect(html).toContain('External league');
    expect(html).not.toContain('No NFL leagues found');
  });

  it('distinguishes an empty current season from an unavailable response', () => {
    const empty = renderToStaticMarkup(<SleeperLeagueResults data={{ ...data, leagues: [] }} />);
    expect(empty).toContain('No NFL leagues found for your associated Sleeper account in 2026.');
    const unavailable = renderToStaticMarkup(<SleeperLeagueResults data={{ ...data, season: null, status: 'unavailable', leagues: [] }} />);
    expect(unavailable).toContain('Sleeper leagues are temporarily unavailable.');
    expect(unavailable).not.toContain('No NFL leagues found');
    expect(unavailable).not.toContain('null');
  });

  it('offers a collapsed report with each feature status and reason without implying website enrollment', () => {
    const html = renderToStaticMarkup(<SleeperLeagueResults data={{ ...data, leagues: [{ ...data.leagues[0], capabilities }] }} />);
    expect(html).toContain('<summary>Website compatibility');
    expect(html).not.toContain('<details open');
    expect(html).toContain('Feature compatibility');
    for (const feature of capabilities.features) {
      expect(html).toContain(feature.label);
      expect(html).toContain(`data-status="${feature.status}"`);
      expect(html).toContain(feature.reasons[0]);
    }
    expect(html).toContain('Settings: pass_rush_yd');
    expect(html).toContain('Settings check only. This does not enable website pages for additional leagues.');
    expect(html).toContain('Open in Sleeper');
    expect(html).not.toContain(capabilities.configurationRevision);
    expect(html).not.toContain(capabilities.scoringRulesHash);
  });

  it('marks missing reports unverified while leaving the Sleeper league link available', () => {
    const html = renderToStaticMarkup(<SleeperLeagueResults data={data} />);
    expect(html).toContain('Website compatibility');
    expect(html).toContain('data-status="unverified"');
    expect(html).toContain('We could not check these league settings.');
    expect(html).toContain('Open in Sleeper');
    expect(html).not.toContain('Feature compatibility');
  });
});
