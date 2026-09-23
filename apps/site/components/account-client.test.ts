import { describe, expect, it, vi } from 'vitest';
import type { LeagueCapabilityReport } from '@/lib/league-capability-contracts';
import { accountResponseState, readAccount, readSleeperLeagues } from './account-client';

describe('private account browser transport', () => {
  it('uses an abortable same-origin no-store request and returns only the current response', async () => {
    const data = { profile: { id: 'user-a', displayName: 'Member', revision: 1 }, links: [], library: { leagues: [], availableProviderAccounts: [] } };
    const request = vi.fn<typeof fetch>(async () => Response.json(data));
    const controller = new AbortController();
    expect(await readAccount(controller.signal, request)).toEqual({ status: 'ready', data });
    expect(request).toHaveBeenCalledWith('/api/me', {
      signal: controller.signal, cache: 'no-store', credentials: 'same-origin', headers: { Accept: 'application/json' },
    });
  });

  it.each([
    [401, 'unauthenticated', 'guest'],
    [403, 'admission_denied', 'denied'],
    [503, 'accounts_disabled', 'disabled'],
    [503, 'account_unavailable', 'unavailable'],
    [500, 'unexpected', 'unavailable'],
  ] as const)('drops private data for HTTP %i / %s', async (status, error, expected) => {
    const request = vi.fn<typeof fetch>(async () => Response.json({ error }, { status }));
    expect(await readAccount(new AbortController().signal, request)).toEqual({ status: expected });
  });

  it('does not accept an incomplete private response as a signed-in profile', async () => {
    const request = vi.fn<typeof fetch>(async () => Response.json({ profile: { id: 'user-a' } }));
    expect(await readAccount(new AbortController().signal, request)).toEqual({ status: 'unavailable' });
  });

  it('does not retry aborted requests or fall back to a cached account', async () => {
    const request = vi.fn<typeof fetch>(async () => { throw new DOMException('Aborted', 'AbortError'); });
    await expect(readAccount(new AbortController().signal, request)).rejects.toMatchObject({ name: 'AbortError' });
    expect(request).toHaveBeenCalledOnce();
  });

  it('classifies an unavailable non-JSON response safely', async () => {
    expect(await accountResponseState(new Response('unavailable', { status: 503 }))).toBe('unavailable');
  });
});

describe('private Sleeper league browser transport', () => {
  const capabilities: LeagueCapabilityReport = { version: 'league-capabilities-v1', configurationRevision: 'a'.repeat(64),
    scoringRulesHash: 'b'.repeat(64), assessedAt: '2026-09-24T12:00:00.000Z', status: 'unsupported', features: [
      { id: 'roster', label: 'Roster', status: 'supported', reasons: ['These roster slots are supported.'] },
      { id: 'actual_scoring', label: 'Official scores', status: 'supported', reasons: ['Official points come from Sleeper.'] },
      { id: 'projections', label: 'Projections', status: 'unsupported', reasons: ['These scoring settings are not supported.'], ruleKeys: ['pass_rush_yd'] },
      { id: 'standings', label: 'Standings', status: 'limited', reasons: ['Projected standings do not include median games.'] },
      { id: 'schedule_history', label: 'Schedule and history', status: 'supported', reasons: ['This schedule format is supported.'] },
      { id: 'substitutions', label: 'Substitutions', status: 'unverified', reasons: ['Substitution settings were not supplied.'] },
    ] };
  const data = { accountId: 'user-a', season: '2026', status: 'complete',
    profiles: [{ sourceManagerAccountId: 'source-a', displayName: 'Member', status: 'complete' }],
    leagues: [{ id: '1234567890123456789', name: 'A Sleeper league', season: '2026',
      url: 'https://sleeper.com/leagues/1234567890123456789', sourceManagerAccountIds: ['source-a'] }] };

  it('binds an abortable private request to the displayed account without accepting a provider identity from the browser', async () => {
    const request = vi.fn<typeof fetch>(async () => Response.json(data));
    const controller = new AbortController();
    expect(await readSleeperLeagues('user-a', controller.signal, request)).toEqual({ status: 'ready', data });
    expect(request).toHaveBeenCalledWith('/api/me/sleeper-leagues', {
      signal: controller.signal, cache: 'no-store', credentials: 'same-origin',
      headers: { Accept: 'application/json', 'X-Expected-Account-ID': 'user-a' },
    });
  });

  it.each([401, 403, 409, 503])('drops discovery data when access fails with %i', async status => {
    const request = vi.fn<typeof fetch>(async () => Response.json(data, { status }));
    expect(await readSleeperLeagues('user-a', new AbortController().signal, request)).toEqual({ status: 'unavailable' });
  });

  it.each([
    { ...data, accountId: 'user-b' },
    { ...data, leagues: [{ ...data.leagues[0], url: 'https://untrusted.example' }] },
    { ...data, leagues: [{ ...data.leagues[0], id: 1234567890123456789 }] },
    { ...data, leagues: [{ ...data.leagues[0], sourceManagerAccountIds: ['source-b'] }] },
    { ...data, leagues: [{ ...data.leagues[0], season: '2025' }] },
    { ...data, profiles: null },
  ])('rejects a response from another account or outside the validated league contract', async body => {
    const request = vi.fn<typeof fetch>(async () => Response.json(body));
    expect(await readSleeperLeagues('user-a', new AbortController().signal, request)).toEqual({ status: 'unavailable' });
  });

  it('does not retry an aborted discovery request', async () => {
    const request = vi.fn<typeof fetch>(async () => { throw new DOMException('Aborted', 'AbortError'); });
    await expect(readSleeperLeagues('user-a', new AbortController().signal, request)).rejects.toMatchObject({ name: 'AbortError' });
    expect(request).toHaveBeenCalledOnce();
  });

  it('accepts a complete report alongside the existing private league response', async () => {
    const response = { ...data, leagues: [{ ...data.leagues[0], capabilities }] };
    const request = vi.fn<typeof fetch>(async () => Response.json(response));
    expect(await readSleeperLeagues('user-a', new AbortController().signal, request)).toEqual({ status: 'ready', data: response });
  });

  it.each([
    null,
    { ...capabilities, version: 'unknown' },
    { ...capabilities, status: 'supported' },
    { ...capabilities, configurationRevision: 'invalid' },
    { ...capabilities, assessedAt: 'not a date' },
    { ...capabilities, assessedAt: '2026-02-30T12:00:00.000Z' },
    { ...capabilities, features: capabilities.features.slice(1) },
    { ...capabilities, features: capabilities.features.map(() => capabilities.features[0]) },
    { ...capabilities, features: capabilities.features.map(feature => ({ ...feature, status: 'unknown' })) },
    { ...capabilities, features: capabilities.features.map(feature => ({ ...feature, reasons: ['x'.repeat(401)] })) },
    { ...capabilities, features: capabilities.features.map(feature => ({ ...feature, ruleKeys: ['x'.repeat(81)] })) },
  ])('degrades an invalid report without hiding its valid league or Sleeper link', async invalid => {
    const request = vi.fn<typeof fetch>(async () => Response.json({ ...data, leagues: [{ ...data.leagues[0], capabilities: invalid }] }));
    const result = await readSleeperLeagues('user-a', new AbortController().signal, request);
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') throw new Error('Expected the private league to remain available');
    expect(result.data.leagues[0].name).toBe(data.leagues[0].name);
    expect(result.data.leagues[0].url).toBe(data.leagues[0].url);
    expect(result.data.leagues[0].capabilities).toBeUndefined();
  });
});
