import { describe, expect, it, vi } from 'vitest';
import type { DatabaseClient, DatabaseRow } from '../../database';
import { canonicalIdentityMethods } from './canonical-identities';
import { parseRegisteredProviderKey, sleeperCanonicalStandingsPolicy } from '../canonical-standings-policy';
import type { CanonicalLeagueSeasonInput, CanonicalRegistrationAuthorization, CanonicalSourceMappingV1 } from '../canonical-source-contracts';
vi.mock('server-only', () => ({}));

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const mapping: CanonicalSourceMappingV1 = { connectionId: id(1), leagueSeasonId: id(2), revisionId: id(3), generation: 2,
  scope: { provider: 'sleeper', leagueKey: 'sleeper-club:ABC-7', externalLeagueId: 'club:ABC-7', season: 2026, nativeNamespace: 'nfl' },
  sourceNamespace: 'nfl:2026' };
const sourceLeague = { provider: parseRegisteredProviderKey('sleeper', mapping, sleeperCanonicalStandingsPolicy(mapping)),
  resourceKind: 'league', nativeNamespace: 'nfl', nativeId: mapping.scope.externalLeagueId };
const row = { connection_id: id(1), league_season_id: id(2), current_mapping_revision_id: id(3), mapping_generation: '2',
  provider: 'sleeper', native_namespace: 'nfl', external_league_id: sourceLeague.nativeId, league_key: mapping.scope.leagueKey, season: 2026,
  source_namespace: 'nfl:2026', revision_connection_id: id(1), revision_league_season_id: id(2), revision_provider: 'sleeper',
  revision_native_namespace: 'nfl', revision_external_league_id: sourceLeague.nativeId, revision_generation: '2', enrollment_provider: 'sleeper' };
function client(respond: (sql: string, args: readonly unknown[]) => readonly DatabaseRow[]): DatabaseClient {
  return { enabled: true, async query<Row extends DatabaseRow>(sql: string, args: readonly unknown[] = []) {
    return respond(sql, args) as readonly Row[];
  } };
}
const input: CanonicalLeagueSeasonInput = { mode: 'official-data', leagueKey: mapping.scope.leagueKey, leagueName: 'Official league', season: 2026, sourceLeague };
const authorization: CanonicalRegistrationAuthorization = { work: { kind: 'bootstrap', externalLeagueId: sourceLeague.nativeId },
  fence: { jobKey: 'original-job', workerId: 'worker', generation: 2, deadlineAt: '2026-10-21T12:00:00.000Z' },
  registrationCapture: { version: 'sleeper-league-registration-v1', nativeKind: 'sleeper-league', origin: 'network',
    payload: { league_id: sourceLeague.nativeId }, sourceDigest: `sha256:${'a'.repeat(64)}`,
    requestStartedAt: null, requestCompletedAt: null, acquisition: { original: 'witness' } } };

describe('canonical identity RPC and qualified read boundary', () => {
  it('uses all three source dimensions in one bounded read without provider or unqualified fallback', async () => {
    const queries: string[] = [];
    const methods = canonicalIdentityMethods(client((sql, args) => {
      queries.push(sql); expect(args).toEqual(['sleeper', 'nfl', 'club:ABC-7']);
      expect(sql).toContain('connection.provider=$1 AND connection.native_namespace=$2 AND connection.external_league_id=$3 LIMIT 2');
      return [row];
    }));
    expect(await methods.readCanonicalSourceMapping({ sourceLeague })).toEqual({ status: 'available', mapping });
    expect(queries).toHaveLength(1);
  });
  it('distinguishes absence from ambiguous, wrong-season and corrupt revision identities', async () => {
    expect(await canonicalIdentityMethods(client(() => [])).readCanonicalSourceMapping({ sourceLeague })).toMatchObject({ status: 'missing' });
    for (const rows of [[row, row], [{ ...row, revision_native_namespace: 'another-namespace' }], [{ ...row, revision_generation: '1' }],
      [{ ...row, revision_league_season_id: id(8) }], [{ ...row, enrollment_provider: null }]]) {
      expect(await canonicalIdentityMethods(client(() => rows)).readCanonicalSourceMapping({ sourceLeague })).toMatchObject({ status: 'conflict' });
    }
    expect(await canonicalIdentityMethods(client(() => [row])).readCanonicalSourceMapping({ sourceLeague, leagueSeasonId: id(9) }))
      .toMatchObject({ status: 'conflict' });
  });
  it('passes original work/fence/capture to the sole registration RPC and retains nullable profile state', async () => {
    const methods = canonicalIdentityMethods(client((sql, args) => {
      expect(sql).toContain('public.register_canonical_official_source($1::jsonb,$2::jsonb,$3::jsonb)');
      expect(args.map(value => JSON.parse(String(value)))).toEqual([
        { ...input, registrationCapture: authorization.registrationCapture }, authorization.work, authorization.fence]);
      return [{ result: { leagueId: id(4), leagueSeasonId: id(2), scoringProfileId: null, mapping } }];
    }));
    expect(await methods.registerCanonicalLeagueSeason(input, authorization)).toEqual({ leagueId: id(4), leagueSeasonId: id(2), scoringProfileId: null, mapping });
  });
  it('rejects registration readback grafted from another qualified source or with missing profile state', async () => {
    for (const result of [
      { leagueId: id(4), leagueSeasonId: id(2), scoringProfileId: null, mapping: { ...mapping, scope: { ...mapping.scope, nativeNamespace: 'other' } } },
      { leagueId: id(4), leagueSeasonId: id(2), mapping },
    ]) await expect(canonicalIdentityMethods(client(() => [{ result }])).registerCanonicalLeagueSeason(input, authorization)).rejects.toThrow();
  });
});
