import { describe, expect, it } from 'vitest';
import { accountBrowserEnvironment } from './account-browser-environment';

describe('isolated account UI browser environment', () => {
  it('uses only synthetic auth settings and disables all database/provider credentials', () => {
    const env = accountBrowserEnvironment({ L1_ACCOUNT_BROWSER_FIXTURE: 'true' }, 'http://localhost:3217');
    expect(env.ACCOUNTS_ENABLED).toBe('true');
    expect(env.ACCOUNTS_AUTH_DATABASE_URL).toContain('synthetic@ep-account-ui-fixture.');
    expect(env.ACCOUNTS_EMAIL_API_KEY).toBe('synthetic-no-delivery-key');
    expect(env.ACCOUNTS_AUTH_ISSUER).toBe('https://account-ui-fixture.example.test/api/auth');
    expect(env.ACCOUNT_DATABASE_URL).toBe('');
    expect(env.DATABASE_URL).toBe('');
    expect(env.MIGRATION_DATABASE_URL).toBe('');
    expect(env.TANK01_API_KEY).toBe('');
    expect(env.CRON_SECRET).toBe('');
    expect(env.ACCOUNTS_INVITED_EMAILS).toBe('invited@example.test');
  });
  it.each([
    [{}, 'http://localhost:3000'],
    [{ L1_ACCOUNT_BROWSER_FIXTURE: 'true', BASE_URL: 'http://localhost:3000' }, 'http://localhost:3000'],
    [{ L1_ACCOUNT_BROWSER_FIXTURE: 'true', VERCEL_ENV: 'production' }, 'http://localhost:3000'],
    [{ L1_ACCOUNT_BROWSER_FIXTURE: 'true', VERCEL_ENV: 'preview' }, 'http://localhost:3000'],
    [{ L1_ACCOUNT_BROWSER_FIXTURE: 'true' }, 'https://www.league1fantasy.com'],
    [{ L1_ACCOUNT_BROWSER_FIXTURE: 'true' }, 'http://localhost.evil.example'],
  ])('rejects a nonisolated fixture configuration', (env, url) => {
    expect(() => accountBrowserEnvironment(env, url)).toThrow('managed localhost');
  });
});
