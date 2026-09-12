import { describe, expect, it } from 'vitest';
import { parseAllPlayerOperatorInput } from './all-player-operator-guards';

const arguments_ = ['--mode', 'shadow', '--season', '2026', '--season-type', 'regular', '--week', '1'];
const environment = {
  ALL_PLAYER_OPERATION_MODE: 'shadow', ALL_PLAYER_TARGET_ENVIRONMENT: 'integration',
  VERCEL_ENV: 'integration', DATABASE_URL: 'postgresql://runtime:secret@fixture.neon.tech/neondb?sslmode=require',
  ALL_PLAYER_EXPECTED_DATABASE_HOST: 'fixture.neon.tech',
  ALL_PLAYER_EXPECTED_DATABASE_NAME: 'neondb', ALL_PLAYER_EXPECTED_DATABASE_ROLE: 'runtime',
};

describe('all-player explicit operator safeguards', () => {
  it('rejects duplicated or unknown CLI options', () => {
    expect(() => parseAllPlayerOperatorInput([...arguments_, '--week', '2'], environment)).toThrow();
    expect(() => parseAllPlayerOperatorInput([...arguments_, '--force', 'true'], environment)).toThrow();
  });
  it('accepts an exact shadow target without write authority', () => {
    expect(parseAllPlayerOperatorInput(arguments_, environment)).toMatchObject({
      mode: 'shadow', period: { season: 2026, seasonType: 'regular', week: 1 },
      expectedDatabase: 'neondb', expectedRole: 'runtime',
    });
  });

  it('requires an exact period-bound write authorization for backfill', () => {
    const args = arguments_.map((value) => value === 'shadow' ? 'backfill' : value);
    expect(() => parseAllPlayerOperatorInput(args, {
      ...environment, ALL_PLAYER_OPERATION_MODE: 'backfill',
    })).toThrow(/write authorization/u);
    expect(parseAllPlayerOperatorInput(args, {
      ...environment, ALL_PLAYER_OPERATION_MODE: 'backfill',
      ALL_PLAYER_WRITE_AUTHORIZATION: 'backfill:2026:regular:1',
    }).mode).toBe('backfill');
  });

  it.each([
    ['environment', { VERCEL_ENV: 'production' }],
    ['database host', { DATABASE_URL: 'postgresql://runtime:secret@other.neon.tech/neondb?sslmode=require' }],
    ['database name', { DATABASE_URL: 'postgresql://runtime:secret@fixture.neon.tech/other?sslmode=require' }],
    ['TLS', { DATABASE_URL: 'postgresql://runtime:secret@fixture.neon.tech/neondb' }],
  ])('rejects a mismatched %s safeguard', (_name, change) => {
    expect(() => parseAllPlayerOperatorInput(arguments_, { ...environment, ...change }))
      .toThrow();
  });
});
