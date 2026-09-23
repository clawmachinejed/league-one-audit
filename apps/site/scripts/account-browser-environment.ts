/** Test-runner composition only. The application never reads the fixture switch. */
export function accountBrowserEnvironment(environment: Record<string, string | undefined>, baseURL: string): Record<string, string> {
  const url = new URL(baseURL);
  if (environment.L1_ACCOUNT_BROWSER_FIXTURE !== 'true' || environment.BASE_URL?.trim() || environment.VERCEL_ENV?.trim()
    || url.protocol !== 'http:' || url.hostname !== 'localhost' || url.username || url.password) {
    throw new Error('Account UI fixtures require an explicitly enabled, managed localhost browser run.');
  }
  return {
    ACCOUNTS_ENABLED: 'true',
    ACCOUNTS_AUTH_ISSUER: 'https://account-ui-fixture.example.test/api/auth',
    ACCOUNTS_AUTH_DATABASE_URL: 'postgresql://league_one_auth:synthetic@ep-account-ui-fixture.us-east-1.aws.neon.tech/account_ui_test?sslmode=require',
    ACCOUNTS_EMAIL_API_KEY: 'synthetic-no-delivery-key',
    ACCOUNTS_EMAIL_FROM: 'accounts@example.test',
    ACCOUNTS_AUTH_SECRET: 'synthetic-browser-cookie-secret-not-a-real-credential',
    ACCOUNTS_APP_ORIGIN: 'https://account-ui-fixture.example.test',
    ACCOUNTS_INVITED_EMAILS: 'invited@example.test',
    ACCOUNT_DATABASE_URL: '', DATABASE_URL: '', MIGRATION_DATABASE_URL: '',
    TANK01_API_KEY: '', CRON_SECRET: '', ALL_PLAYER_RECURRING_ENABLED: 'false', VERCEL_ENV: '',
  };
}
