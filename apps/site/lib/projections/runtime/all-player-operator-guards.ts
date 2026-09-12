import type { LeaguePeriod } from '../domain/contracts';

export type AllPlayerExplicitOperatorInput = Readonly<{
  mode: 'shadow' | 'backfill';
  period: LeaguePeriod;
  expectedEnvironment: string;
  expectedHost: string;
  expectedDatabase: string;
  expectedRole: string;
}>;

function valueAfter(arguments_: readonly string[], name: string): string | null {
  const index = arguments_.indexOf(name);
  return index >= 0 && index + 1 < arguments_.length ? arguments_[index + 1] : null;
}

type OperatorEnvironment = Readonly<Record<string, string | undefined>>;

function requiredEnvironment(environment: OperatorEnvironment, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`Required ${name} safeguard is absent.`);
  return value;
}

export function parseAllPlayerOperatorInput(
  arguments_: readonly string[],
  environment: OperatorEnvironment = process.env,
): AllPlayerExplicitOperatorInput {
  const normalizedArguments = arguments_[0] === '--' ? arguments_.slice(1) : arguments_;
  const flags = ['--mode', '--season', '--season-type', '--week'];
  if (normalizedArguments.length !== flags.length * 2
    || flags.some((flag) => normalizedArguments.filter((item) => item === flag).length !== 1)
    || normalizedArguments.some((value, index) => index % 2 === 0 && !flags.includes(value))) {
    throw new Error('Exactly one mode, season, season-type and week argument is required.');
  }
  const mode = valueAfter(arguments_, '--mode');
  const seasonValue = valueAfter(arguments_, '--season');
  const seasonType = valueAfter(arguments_, '--season-type');
  const weekValue = valueAfter(arguments_, '--week');
  if ((mode !== 'shadow' && mode !== 'backfill') || seasonType !== 'regular') {
    throw new Error('Mode and regular-season target are required.');
  }
  const season = Number(seasonValue);
  const week = Number(weekValue);
  if (!Number.isInteger(season) || season < 2026 || season > 2200
    || !Number.isInteger(week) || week < 1 || week > 18) {
    throw new Error('The all-player target period is invalid.');
  }
  if (requiredEnvironment(environment, 'ALL_PLAYER_OPERATION_MODE') !== mode) {
    throw new Error('The authorized operation mode does not match the requested mode.');
  }
  const expectedEnvironment = requiredEnvironment(environment, 'ALL_PLAYER_TARGET_ENVIRONMENT');
  if (!['integration', 'production'].includes(expectedEnvironment)
    || environment.VERCEL_ENV !== expectedEnvironment) {
    throw new Error('The runtime environment does not match the authorized target.');
  }
  const writeAuthorization = environment.ALL_PLAYER_WRITE_AUTHORIZATION?.trim();
  const requiredAuthorization = `backfill:${season}:regular:${week}`;
  if (mode === 'shadow' && writeAuthorization) {
    throw new Error('Shadow mode refuses a database write authorization.');
  }
  if (mode === 'backfill' && writeAuthorization !== requiredAuthorization) {
    throw new Error('Backfill write authorization does not match the exact period.');
  }
  const databaseUrl = requiredEnvironment(environment, 'DATABASE_URL');
  const parsed = new URL(databaseUrl);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)
    || !['require', 'verify-ca', 'verify-full'].includes(
      parsed.searchParams.get('sslmode')?.toLowerCase() ?? '',
    )) {
    throw new Error('The operator requires a TLS-protected PostgreSQL target.');
  }
  const expectedHost = requiredEnvironment(
    environment,
    'ALL_PLAYER_EXPECTED_DATABASE_HOST',
  ).toLowerCase();
  const expectedDatabase = requiredEnvironment(environment, 'ALL_PLAYER_EXPECTED_DATABASE_NAME');
  const expectedRole = requiredEnvironment(environment, 'ALL_PLAYER_EXPECTED_DATABASE_ROLE');
  if (parsed.hostname.toLowerCase() !== expectedHost
    || decodeURIComponent(parsed.pathname.replace(/^\//u, '')) !== expectedDatabase) {
    throw new Error('The database URL does not match the authorized target identity.');
  }
  return {
    mode,
    period: { season, seasonType: 'regular', week },
    expectedEnvironment,
    expectedHost,
    expectedDatabase,
    expectedRole,
  };
}
