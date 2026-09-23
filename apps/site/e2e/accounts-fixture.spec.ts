import { expect, test, type Page } from '@playwright/test';
import type { AccountView } from '../lib/accounts/contracts';

test.skip(process.env.L1_ACCOUNT_BROWSER_FIXTURE !== 'true', 'Synthetic account UI runs only through playwright.accounts.config.ts.');

const userId = '11111111-1111-4111-8111-111111111111';
const otherUserId = '22222222-2222-4222-8222-222222222222';
const leagueOneId = '33333333-3333-4333-8333-333333333333';
const leagueTwoId = '44444444-4444-4444-8444-444444444444';
const dynastyId = '55555555-5555-4555-8555-555555555555';
const providerId = '66666666-6666-4666-8666-666666666666';
const teamId = '77777777-7777-4777-8777-777777777777';
const providerLinkId = '88888888-8888-4888-8888-888888888888';

function accountFixture(): AccountView {
  return { profile: { id: userId, displayName: 'Fixture Member', revision: 1 }, links: [], library: {
    availableProviderAccounts: [{ id: providerId, provider: 'sleeper', externalId: '999999999', displayName: 'Fixture Sleeper', username: 'fixture-sleeper' }],
    leagues: [
      { id: leagueOneId, key: 'league1', name: 'League One', season: 2026, url: '/matchups', logo: '',
        saved: { favorite: false, sortPosition: 0, preferredSeasonTeamId: teamId, revision: 1 },
        teams: [{ id: teamId, rosterId: '1', roles: ['owner'], sourceManagerAccountIds: [providerId], assurance: 'user_asserted', freshness: 'current', observedAt: '2026-09-22T12:00:00Z' }],
        affiliations: [{ id: 'pair', name: 'League One / League Two' }], linkedFromLeagueIds: [], sourceState: 'current', sourceObservedAt: '2026-09-22T12:00:00Z' },
      { id: leagueTwoId, key: 'league2', name: 'League Two', season: 2026, url: '/league2/matchups', logo: '', saved: null, teams: [],
        affiliations: [{ id: 'pair', name: 'League One / League Two' }, { id: 'unrelated', name: 'Unrelated group' }], linkedFromLeagueIds: [leagueOneId], sourceState: 'stale', sourceObservedAt: '2026-09-21T12:00:00Z' },
      { id: dynastyId, key: 'dynasty', name: 'Dynasty League', season: 2026, url: '/dynasty/matchups', logo: '', saved: null, teams: [],
        affiliations: [], linkedFromLeagueIds: [], sourceState: 'unavailable', sourceObservedAt: null },
    ],
  } };
}

async function installFixture(page: Page, baseURL: string) {
  const origin = new URL(baseURL).origin;
  expect(new URL(origin).hostname).toBe('localhost');
  const fixture = {
    current: accountFixture() as AccountView | null,
    reads: 0, writes: [] as { path: string; expectedAccount: string | undefined; body: Record<string, unknown> }[],
    authPaths: [] as string[], unexpected: [] as string[], nextStatus: 0, readStatus: 0, resetError: false, resetStatus: 0,
    signInError: null as { status: number; code: string } | null,
    holdNextRead: null as Promise<void> | null,
  };
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) { fixture.unexpected.push(url.origin); await route.abort('blockedbyclient'); return; }
    const path = url.pathname;
    const method = route.request().method();
    if (path === '/api/me' && method === 'GET') {
      fixture.reads += 1;
      if (fixture.readStatus) { await route.fulfill({ status: fixture.readStatus, json: { error: 'account_unavailable' } }); return; }
      const captured = fixture.current ? structuredClone(fixture.current) : null;
      const held = fixture.holdNextRead;
      fixture.holdNextRead = null;
      if (held) await held;
      await route.fulfill({ status: captured ? 200 : 401, json: captured ?? { error: 'unauthenticated' }, headers: { 'Cache-Control': 'private, no-store' } }).catch(() => undefined);
      return;
    }
    if (path.startsWith('/api/me/') && method !== 'GET') {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      const expectedAccount = route.request().headers()['x-expected-account-id'];
      fixture.writes.push({ path, expectedAccount, body });
      if (!fixture.current) { await route.fulfill({ status: 401, json: { error: 'unauthenticated' } }); return; }
      if (expectedAccount !== fixture.current.profile.id) { await route.fulfill({ status: 409, json: { error: 'account_changed' } }); return; }
      if (fixture.nextStatus) {
        const status = fixture.nextStatus; fixture.nextStatus = 0;
        await route.fulfill({ status, json: { error: status === 429 ? 'rate_limited' : 'conflict' }, headers: { 'Retry-After': '60' } }); return;
      }
      if (path === '/api/me/profile') {
        fixture.current.profile.displayName = String(body.displayName); fixture.current.profile.revision += 1;
      } else if (path.startsWith('/api/me/leagues/')) {
        const league = fixture.current.library.leagues.find(candidate => path.endsWith(candidate.id));
        if (!league) throw new Error('Unexpected fixture league');
        league.saved = method === 'DELETE' ? null : { favorite: body.favorite === true, sortPosition: Number(body.sortPosition), preferredSeasonTeamId: body.preferredSeasonTeamId as string | null, revision: (league.saved?.revision ?? 0) + 1 };
      } else if (path === '/api/me/provider-links') {
        fixture.current.links = [{ id: providerLinkId, sourceManagerAccountId: providerId, displayName: 'Fixture Sleeper', provider: 'sleeper', assurance: 'user_asserted', revision: 1 }];
      } else if (path === `/api/me/provider-links/${providerLinkId}`) fixture.current.links = [];
      else { fixture.unexpected.push(path); await route.abort('blockedbyclient'); return; }
      await route.fulfill({ json: { status: 'ok' }, headers: { 'Cache-Control': 'private, no-store' } }); return;
    }
    if (path.startsWith('/api/auth/')) {
      fixture.authPaths.push(path);
      if (path.endsWith('/reset-password') && fixture.resetStatus) {
        await route.fulfill({ status: fixture.resetStatus, json: { message: 'Synthetic temporary provider failure' } }); return;
      }
      if (path.endsWith('/reset-password') && fixture.resetError) {
        await route.fulfill({ status: 400, json: { code: 'INVALID_TOKEN', message: 'Synthetic expired or used token' } }); return;
      }
      if (path.endsWith('/get-session')) { await route.fulfill({ json: null }); return; }
      if (path.endsWith('/sign-in/email') && fixture.signInError) {
        await route.fulfill({ status: fixture.signInError.status, json: { code: fixture.signInError.code, message: 'Synthetic sign-in failure' } }); return;
      }
      if (path.endsWith('/sign-out')) fixture.current = null;
      if (path.endsWith('/sign-in/email')) fixture.current = accountFixture();
      await route.fulfill({ json: { success: true, user: { id: userId, email: 'invited@example.test', emailVerified: true, name: 'Fixture Member' }, token: null } }); return;
    }
    if (path.startsWith('/api/')) { fixture.unexpected.push(path); await route.abort('blockedbyclient'); return; }
    await route.continue();
  });
  return fixture;
}

test('library cards distinguish participation and affiliation and fit phone and desktop', async ({ page, baseURL }, info) => {
  const fixture = await installFixture(page, baseURL!);
  for (const width of [360, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/my-leagues');
    await expect(page.getByText('Signed in as Fixture Member')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Your leagues', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Linked leagues', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Available leagues', exact: true })).toBeVisible();
    await expect(page.getByText('This does not mean you manage a team here.', { exact: false })).toBeVisible();
    await expect(page.getByText('Unrelated group')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: info.outputPath(`library-${width}.png`), fullPage: true });
  }
  expect(fixture.unexpected).toEqual([]);
  expect(fixture.authPaths).toEqual([]);
});

test('profile and favorite writes include an account precondition and preserve team preference', async ({ page, baseURL }) => {
  const fixture = await installFixture(page, baseURL!);
  await page.goto('/account');
  await page.getByLabel('Website display name').fill('Updated Fixture');
  await page.getByRole('button', { name: 'Save name' }).click();
  await expect(page.getByText('Signed in as Updated Fixture')).toBeVisible();
  await page.getByRole('link', { name: 'My leagues', exact: true }).click();
  const league = page.locator('article').filter({ has: page.getByRole('heading', { name: 'League One', exact: true }) });
  await league.getByRole('button', { name: 'Favorite', exact: true }).click();
  await expect(league.getByRole('button', { name: 'Remove favorite' })).toBeVisible();
  expect(fixture.writes).toHaveLength(2);
  expect(fixture.writes.every(write => write.expectedAccount === userId)).toBe(true);
  expect(fixture.writes[0].body).toEqual({ displayName: 'Updated Fixture', revision: 1 });
  expect(fixture.writes[1].body).toMatchObject({ preferredSeasonTeamId: teamId, favorite: true, revision: 1 });
  expect(fixture.unexpected).toEqual([]);
});

test('a public Sleeper association requires an explicit choice and confirmation', async ({ page, baseURL }) => {
  const fixture = await installFixture(page, baseURL!);
  await page.goto('/account');
  const add = page.getByRole('button', { name: 'Associate profile' });
  await expect(add).toBeDisabled();
  await page.getByLabel('Choose a Sleeper profile').selectOption(providerId);
  await expect(add).toBeDisabled();
  await page.getByLabel('I want this public Sleeper profile to personalize my account.').check();
  await add.click();
  await expect(page.getByText('Sleeper · User supplied')).toBeVisible();
  expect(fixture.writes[0].body).toEqual({ sourceManagerAccountId: providerId });
  await page.getByRole('button', { name: 'Remove association' }).click();
  await expect(page.getByText('No Sleeper profile is associated with this website account.')).toBeVisible();
  expect(fixture.writes[1].body).toEqual({ revision: 1 });
  expect(fixture.unexpected).toEqual([]);
});

test('sign-up and email verification use the SDK without contacting an external provider', async ({ page, baseURL }, info) => {
  const fixture = await installFixture(page, baseURL!);
  fixture.current = null;
  await page.setViewportSize({ width: 360, height: 900 });
  await page.goto('/sign-in');
  await page.getByRole('button', { name: 'Create an account', exact: true }).click();
  await page.getByLabel('Website display name').fill('Fixture Member');
  await page.getByLabel('Email', { exact: true }).fill('invited@example.test');
  await page.getByLabel('Website password').fill('synthetic-browser-password');
  await page.screenshot({ path: info.outputPath('signup-360.png'), fullPage: true });
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Verify your email' })).toBeVisible();
  await page.getByRole('button', { name: 'Send verification email' }).click();
  await page.getByLabel('Verification code').fill('123456');
  await page.getByRole('button', { name: 'Verify code' }).click();
  await expect(page.getByText('Email verified. Sign in to continue.')).toBeVisible();
  await page.getByLabel('Website password').fill('synthetic-browser-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/my-leagues$/);
  await expect(page.getByText('Signed in as Fixture Member')).toBeVisible();
  expect(fixture.authPaths).toEqual(expect.arrayContaining(['/api/auth/sign-up/email', '/api/auth/send-verification-email', '/api/auth/email-otp/verify-email', '/api/auth/sign-in/email']));
  expect(fixture.unexpected).toEqual([]);
});

test('unverified sign-in opens the code step without resending and other failures stay on sign-in', async ({ page, baseURL }) => {
  const fixture = await installFixture(page, baseURL!);
  fixture.current = null;
  fixture.signInError = { status: 403, code: 'EMAIL_NOT_VERIFIED' };
  await page.goto('/sign-in');
  await page.getByLabel('Email', { exact: true }).fill('invited@example.test');
  await page.getByLabel('Website password').fill('synthetic-browser-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Verify your email' })).toBeVisible();
  await expect(page.getByLabel('Verification code')).toBeVisible();
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue('invited@example.test');
  expect(fixture.authPaths.filter(path => path !== '/api/auth/get-session')).toEqual(['/api/auth/sign-in/email']);

  await page.getByRole('button', { name: 'Return to sign in' }).click();
  await expect(page.getByLabel('Website password')).toHaveValue('');
  fixture.signInError = { status: 401, code: 'INVALID_EMAIL_OR_PASSWORD' };
  await page.getByLabel('Website password').fill('synthetic-incorrect-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'We could not sign you in.' })).toBeVisible();
  await expect(page.getByLabel('Verification code')).toHaveCount(0);
  await expect(page.getByLabel('Website password')).toHaveValue('');

  const beforeCodeAction = [...fixture.authPaths];
  await page.getByRole('button', { name: 'I have a verification code' }).click();
  await expect(page.getByRole('heading', { name: 'Verify your email' })).toBeVisible();
  await expect(page.getByLabel('Verification code')).toBeVisible();
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue('invited@example.test');
  expect(fixture.authPaths).toEqual(beforeCodeAction);
  expect(fixture.unexpected).toEqual([]);
});
test('late private responses cannot restore a session that became unauthenticated', async ({ page, baseURL }) => {
  const fixture = await installFixture(page, baseURL!);
  await page.goto('/account');
  await expect(page.getByText('Signed in as Fixture Member')).toBeVisible();
  let release!: () => void;
  fixture.holdNextRead = new Promise<void>(resolve => { release = resolve; });
  const before = fixture.reads;
  await page.evaluate(() => window.dispatchEvent(new Event('league-one:account-session-change')));
  await expect.poll(() => fixture.reads).toBe(before + 1);
  fixture.current = null;
  await page.evaluate(() => window.dispatchEvent(new Event('league-one:account-session-change')));
  await expect(page.getByText('Sign in to save your leagues and account preferences across devices.')).toBeVisible();
  release();
  await page.waitForTimeout(100);
  await expect(page.getByText('Signed in as Fixture Member')).toHaveCount(0);
  await expect(page.getByLabel('Website display name')).toHaveCount(0);
  expect(fixture.unexpected).toEqual([]);
});

test('password recovery requests the fixed callback without exposing email eligibility', async ({ page, baseURL }) => {
  const fixture = await installFixture(page, baseURL!);
  fixture.current = null;
  const response = await page.goto('/sign-in');
  expect(response?.headers()['referrer-policy']).toBe('no-referrer');
  expect(response?.headers()['cache-control']).toContain('no-store');
  await page.getByRole('button', { name: 'Forgot password?' }).click();
  await page.getByLabel('Email', { exact: true }).fill('invited@example.test');
  const request = page.waitForRequest(candidate => new URL(candidate.url()).pathname === '/api/auth/request-password-reset');
  await page.getByRole('button', { name: 'Send reset link' }).click();
  expect((await request).postDataJSON()).toEqual({ email: 'invited@example.test', redirectTo: `${new URL(baseURL!).origin}/sign-in` });
  await expect(page.getByText('If this email can recover an account, check your inbox for a reset link.')).toBeVisible();
  expect(fixture.unexpected).toEqual([]);
});

test('password reset strips the one-time token from history and submits through the SDK', async ({ page, baseURL }) => {
  const fixture = await installFixture(page, baseURL!);
  fixture.current = null;
  const response = await page.goto('/sign-in?token=synthetic-reset-token');
  expect(response?.headers()['referrer-policy']).toBe('no-referrer');
  expect(response?.headers()['cache-control']).toContain('no-store');
  await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible();
  await expect(page).toHaveURL(`${new URL(baseURL!).origin}/sign-in`);
  await page.getByLabel('New website password', { exact: true }).fill('synthetic-new-password');
  await page.getByLabel('Confirm new password', { exact: true }).fill('synthetic-wrong-password');
  await page.getByRole('button', { name: 'Reset password', exact: true }).click();
  await expect(page.getByText('The new passwords do not match.')).toBeVisible();
  expect(fixture.authPaths).not.toContain('/api/auth/reset-password');
  await page.getByLabel('Confirm new password', { exact: true }).fill('synthetic-new-password');
  const request = page.waitForRequest(candidate => new URL(candidate.url()).pathname === '/api/auth/reset-password');
  await page.getByRole('button', { name: 'Reset password', exact: true }).click();
  expect((await request).postDataJSON()).toEqual({ newPassword: 'synthetic-new-password', token: 'synthetic-reset-token' });
  await expect(page.getByText('Your password was reset. Sign in with your new password.')).toBeVisible();
  await expect(page.getByLabel('Website password', { exact: true })).toHaveValue('');
  expect(await page.evaluate(() => `${JSON.stringify(localStorage)}${JSON.stringify(sessionStorage)}${JSON.stringify(window.history.state)}`)).not.toContain('synthetic-reset-token');
  expect(fixture.unexpected).toEqual([]);
});

test('invalid or expired recovery callbacks offer a fresh link without displaying provider details', async ({ page, baseURL }) => {
  const fixture = await installFixture(page, baseURL!);
  fixture.current = null;
  await page.goto('/sign-in?error=INVALID_TOKEN');
  await expect(page).toHaveURL(`${new URL(baseURL!).origin}/sign-in`);
  await expect(page.getByText('This reset link is invalid or expired. Request a new one.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send reset link' })).toBeVisible();
  fixture.resetError = true;
  await page.goto('/sign-in?token=synthetic-used-token');
  await page.getByLabel('New website password', { exact: true }).fill('synthetic-new-password');
  await page.getByLabel('Confirm new password', { exact: true }).fill('synthetic-new-password');
  await page.getByRole('button', { name: 'Reset password', exact: true }).click();
  await expect(page.getByText('This reset link could not be used. It may be invalid or expired. Request a new one.')).toBeVisible();
  await expect(page.getByText('Synthetic expired or used token')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Send reset link' })).toBeVisible();
  expect(fixture.unexpected).toEqual([]);
});

test('a temporary reset outage retains the one-time token for an explicit successful retry', async ({ page, baseURL }) => {
  const fixture = await installFixture(page, baseURL!);
  fixture.current = null;
  fixture.resetStatus = 503;
  await page.goto('/sign-in?token=synthetic-retry-token');
  await page.getByLabel('New website password', { exact: true }).fill('synthetic-new-password');
  await page.getByLabel('Confirm new password', { exact: true }).fill('synthetic-new-password');
  const first = page.waitForRequest(candidate => new URL(candidate.url()).pathname === '/api/auth/reset-password');
  await page.getByRole('button', { name: 'Reset password', exact: true }).click();
  expect((await first).postDataJSON()).toMatchObject({ token: 'synthetic-retry-token' });
  await expect(page.getByText('Account access is temporarily unavailable. Please try again.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible();
  await expect(page.getByLabel('New website password', { exact: true })).toHaveValue('');
  expect(fixture.authPaths.filter(path => path === '/api/auth/reset-password')).toHaveLength(1);
  fixture.resetStatus = 0;
  await page.getByLabel('New website password', { exact: true }).fill('synthetic-new-password');
  await page.getByLabel('Confirm new password', { exact: true }).fill('synthetic-new-password');
  const retry = page.waitForRequest(candidate => new URL(candidate.url()).pathname === '/api/auth/reset-password');
  await page.getByRole('button', { name: 'Reset password', exact: true }).click();
  expect((await retry).postDataJSON()).toEqual({ newPassword: 'synthetic-new-password', token: 'synthetic-retry-token' });
  await expect(page.getByText('Your password was reset. Sign in with your new password.')).toBeVisible();
  expect(fixture.authPaths.filter(path => path === '/api/auth/reset-password')).toHaveLength(2);
  expect(fixture.unexpected).toEqual([]);
});

test('sign out removes private content and uses a full navigation to sign in', async ({ page, baseURL }) => {
  const fixture = await installFixture(page, baseURL!);
  await page.goto('/account');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByText('Signed in as Fixture Member')).toHaveCount(0);
  await page.goto('/account');
  await expect(page.getByText('Sign in to save your leagues and account preferences across devices.')).toBeVisible();
  expect(fixture.authPaths).toContain('/api/auth/sign-out');
  expect(fixture.unexpected).toEqual([]);
});

test('a private account-store outage does not prevent signing out', async ({ page, baseURL }) => {
  const fixture = await installFixture(page, baseURL!);
  fixture.readStatus = 503;
  await page.goto('/account');
  await expect(page.getByText('Accounts are temporarily unavailable. Your league pages are still available.')).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  expect(fixture.authPaths).toContain('/api/auth/sign-out');
  expect(fixture.unexpected).toEqual([]);
});

test('rate limits do not retry mutations and an account switch rejects the old form', async ({ page, baseURL }) => {
  const fixture = await installFixture(page, baseURL!);
  await page.goto('/account');
  await page.getByLabel('Website display name').fill('Attempted change');
  fixture.nextStatus = 429;
  await page.getByRole('button', { name: 'Save name' }).click();
  await expect(page.getByText('Too many changes. Wait a minute before trying again.')).toBeVisible();
  expect(fixture.writes).toHaveLength(1);
  fixture.current = { ...accountFixture(), profile: { id: otherUserId, displayName: 'Second Fixture', revision: 1 } };
  await page.getByRole('button', { name: 'Save name' }).click();
  await expect(page.getByText('The signed-in account changed. We reloaded it; review your settings before trying again.')).toBeVisible();
  await expect(page.getByText('Signed in as Second Fixture')).toBeVisible();
  await expect(page.getByLabel('Website display name')).toHaveValue('Second Fixture');
  expect(fixture.writes[1].expectedAccount).toBe(userId);
  expect(fixture.current.profile.displayName).toBe('Second Fixture');
  expect(fixture.unexpected).toEqual([]);
});
