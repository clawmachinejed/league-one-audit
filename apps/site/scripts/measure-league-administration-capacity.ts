import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createLeagueAdministrationMethods } from '../lib/league-administration/neon/administration';
import { normalizeAdministrationObservation } from '../lib/league-administration/normalize';
import type { AdministrationEnvelope, AdministrationFamily, AdministrationScope, JsonObject, JsonValue } from '../lib/league-administration/contracts';
import { createProjectionStore } from '../lib/projection-store';
import type { DatabaseClient, DatabaseRow } from '../lib/database';
import { createIndependentDatabase, integrationEnvironment, prepareIntegrationDatabase, cleanIntegrationDatabase,
  ownerQuery, type IndependentDatabase } from '../integration/neon-integration-harness';
import { ADMINISTRATION_TABLES, ADMINISTRATION_POSTGRES_VERSION } from './league-administration-catalog.mjs';

type Document = { scope: AdministrationScope; family: AdministrationFamily; week: number | null; payload: JsonValue };
const capturedFixture: { leagues: Record<string, JsonObject> } = JSON.parse(
  await readFile(new URL('../test-support/fixtures/dynasty-league-settings.json', import.meta.url), 'utf8'));
const capturedConfigurations = capturedFixture.leagues;
const startTime = Date.now() - 7_200_000;
let tick = 0;
const transport = { statements: 0, serializedParameterBytes: 0, decodedResultBytes: 0, statementWallTimeMs: 0 };

function envelope(document: Document): AdministrationEnvelope {
  tick += 1;
  const at = (offset: number) => new Date(startTime + tick * 1_000 + offset).toISOString();
  return { ...document, schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1',
    dialect: 'sleeper-nfl-v1', completeness: 'complete',
    provenance: { origin: 'network', requestStartedAt: at(0), requestCompletedAt: at(100), sourceObservedAt: at(100), checkedAt: at(200) } };
}

function documents(scope: AdministrationScope, capturedConfiguration: JsonObject): Document[] {
  const rosterCount = Number(capturedConfiguration.total_rosters);
  const positions = capturedConfiguration.roster_positions as string[];
  const playerCount = positions.length;
  const starterCount = positions.filter((slot) => slot !== 'BN').length;
  const players = (roster: number) => Array.from({ length: playerCount }, (_, index) => `${roster * 1000 + index}`);
  const users: JsonObject[] = Array.from({ length: rosterCount }, (_, index) => ({ user_id: `${scope.leagueKey}-manager-${index + 1}`,
    display_name: `Synthetic manager ${index + 1}`, username: `synthetic-${index + 1}`, avatar: null,
    metadata: { team_name: `Synthetic team ${index + 1}`, source: 'finite isolated capacity fixture' } }));
  const rosters: JsonObject[] = Array.from({ length: rosterCount }, (_, index) => ({ roster_id: index + 1,
    owner_id: index === rosterCount - 1 ? null : `${scope.leagueKey}-manager-${index + 1}`,
    co_owners: index === 0 ? [`${scope.leagueKey}-coowner`] : null,
    players: players(index + 1), starters: players(index + 1).slice(0, starterCount), reserve: null, taxi: [],
    settings: { wins: index % 2, losses: (index + 1) % 2, ties: 0, fpts: 100 + index, fpts_against: 110 + index },
    metadata: { source: 'synthetic' } }));
  const matchups: JsonObject[] = rosters.map((roster, index) => ({ roster_id: index + 1, matchup_id: Math.floor(index / 2) + 1,
    players: roster.players, starters: roster.starters,
    players_points: Object.fromEntries(players(index + 1).map((id, slot) => [id, slot < starterCount ? slot + 0.5 : 0])),
    starters_points: Array.from({ length: starterCount }, (_, slot) => slot + 0.5), points: starterCount * starterCount / 2, custom_points: null }));
  const retainedConfiguration = Object.fromEntries(Object.entries(capturedConfiguration).filter(([key]) => key !== 'source_url'));
  const draftId = `${scope.externalLeagueId}-draft`;
  const draft = { draft_id: draftId, league_id: scope.externalLeagueId, season: String(scope.season), sport: 'nfl',
    status: 'complete', type: 'snake', settings: { teams: rosterCount, rounds: playerCount } };
  const tradedPicks = [{ season: String(scope.season + 1), round: 1, roster_id: 1, previous_owner_id: 1, owner_id: 2 }];
  return [
    { scope, family: 'league', week: null, payload: { ...retainedConfiguration, league_id: scope.externalLeagueId,
      name: scope.leagueKey, sport: 'nfl', previous_league_id: null } },
    { scope, family: 'users', week: null, payload: users }, { scope, family: 'rosters', week: null, payload: rosters },
    { scope, family: 'matchups', week: 2, payload: matchups },
    { scope, family: 'drafts', week: null, payload: [{ catalog: draft, draft,
      picks: Array.from({ length: rosterCount * playerCount }, (_, index) => ({ draft_id: draftId,
        pick_no: index + 1, round: Math.floor(index / rosterCount) + 1, draft_slot: index % rosterCount + 1,
        roster_id: index % rosterCount + 1, player_id: `draft-player-${index + 1}`,
        picked_by: `${scope.leagueKey}-manager-${index % rosterCount + 1}` })), traded_picks: tradedPicks }] },
    { scope, family: 'traded_picks', week: null, payload: tradedPicks },
    { scope, family: 'winners_bracket', week: null, payload: [{ m: 1, r: 1, t1: 1, t2: 2, w: 1, l: 2 }] },
    { scope, family: 'losers_bracket', week: null, payload: [{ m: 1, r: 1, t1: 3, t2: 4, w: 4, l: 3 }] },
    ...[0, 1, 2].map((week): Document => ({ scope, family: 'transactions', week,
      payload: Array.from({ length: 20 }, (_, index) => ({ transaction_id: `${scope.leagueKey}-${week}-${index}`,
        type: 'waiver', status: 'complete', roster_ids: [(index % rosterCount) + 1], consenter_ids: [(index % rosterCount) + 1],
        adds: { [`new-${week}-${index}`]: (index % rosterCount) + 1 }, drops: { [`old-${week}-${index}`]: (index % rosterCount) + 1 },
        created: startTime - index * 1000, status_updated: startTime - index * 1000 + 1,
        draft_picks: [], waiver_budget: [], settings: { waiver_bid: index % 5 } })) })),
  ];
}

async function physical() {
  const relations = await ownerQuery(`SELECT relation.relname,
    pg_relation_size(relation.oid)::text AS heap_bytes,pg_indexes_size(relation.oid)::text AS index_bytes,
    CASE WHEN relation.reltoastrelid=0 THEN '0' ELSE pg_relation_size(relation.reltoastrelid)::text END AS toast_heap_bytes,
    CASE WHEN relation.reltoastrelid=0 THEN '0' ELSE pg_indexes_size(relation.reltoastrelid)::text END AS toast_index_bytes,
    pg_total_relation_size(relation.oid)::text AS total_bytes
    FROM pg_class relation WHERE relation.relnamespace='public'::regnamespace
      AND relation.relkind='r' AND relation.relname=ANY($1::text[]) ORDER BY relation.relname`, [ADMINISTRATION_TABLES]);
  const counts = await ownerQuery(`SELECT name,rows FROM (${ADMINISTRATION_TABLES.map((table) =>
    `SELECT '${table}' AS name,count(*)::integer AS rows FROM public.${table}`).join(' UNION ALL ')}) counts ORDER BY name`);
  return { relations, counts, transport: { ...transport } };
}

// Environment authority is checked before constructing clients; the existing
// harness independently validates the live database before every schema reset.
integrationEnvironment();
let prepared = false;
let connection: IndependentDatabase | undefined;
try {
  await prepareIntegrationDatabase({ throughMigration: '017_enrolled_all_player_publication.sql' });
  prepared = true;
  const version = await ownerQuery<{ version: string }>("SELECT current_setting('server_version_num') AS version");
  if (Number(version[0].version) !== ADMINISTRATION_POSTGRES_VERSION) throw new Error('Capacity evidence requires PostgreSQL 180006.');
  connection = createIndependentDatabase();
  const underlying = connection.database;
  const measured: DatabaseClient = {
    enabled: true,
    async query<Row extends DatabaseRow>(statement: string, parameters: readonly unknown[] = []): Promise<readonly Row[]> {
      transport.statements += 1;
      transport.serializedParameterBytes += Buffer.byteLength(JSON.stringify(parameters));
      const started = performance.now();
      const result = await underlying.query<Row>(statement, parameters);
      transport.statementWallTimeMs += performance.now() - started;
      transport.decodedResultBytes += Buffer.byteLength(JSON.stringify(result));
      return result;
    },
  };
  const administration = createLeagueAdministrationMethods(measured);
  const projection = createProjectionStore(underlying);
  const work: Document[] = [];
  for (const key of ['league1', 'league2', 'dynasty']) {
    const scope: AdministrationScope = { leagueKey: key, provider: 'sleeper', externalLeagueId: `capacity-${key}-2026`, season: 2026 };
    const result = await projection.registerLeagueSeason({ leagueKey: key, leagueName: `Synthetic capacity ${key}`,
      season: 2026, sleeperLeagueId: scope.externalLeagueId, scoringRules: capturedConfigurations[key].scoring_settings as Record<string, number> });
    if (result.kind !== 'stored') throw new Error('The isolated capacity store was unexpectedly disabled.');
    await ownerQuery("INSERT INTO public.league_administration_enrollments(league_id,provider,evidence) VALUES($1,'sleeper','synthetic isolated capacity fixture')", [result.value.leagueId]);
    await ownerQuery("INSERT INTO public.league_administration_enrollment_seasons(league_id,season,provider,evidence) VALUES($1,2026,'sleeper','synthetic isolated capacity fixture')", [result.value.leagueId]);
    work.push(...documents(scope, capturedConfigurations[key]));
  }
  const phases: { name: string; measurement: Awaited<ReturnType<typeof physical>> }[] = [];
  phases.push({ name: 'seeded-before-source-documents', measurement: await physical() });
  for (const document of work) {
    const result = await administration.recordObservation(normalizeAdministrationObservation(envelope(document)));
    if (result.status !== 'changed') throw new Error('Initial synthetic source was not accepted.');
  }
  const initial = await physical();
  phases.push({ name: `initial-${work.length}-source-documents`, measurement: initial });
  for (let cycle = 0; cycle < 10; cycle += 1) for (const document of work) {
    const result = await administration.recordObservation(normalizeAdministrationObservation(envelope(document)));
    if (result.status !== 'unchanged') throw new Error('Unchanged synthetic source did not reuse immutable content.');
  }
  const repeated = await physical();
  if (JSON.stringify(repeated.counts) !== JSON.stringify(initial.counts)) throw new Error('Unchanged checks grew immutable administration row counts.');
  phases.push({ name: `ten-unchanged-refreshes-${work.length * 10}-writes`, measurement: repeated });
  for (const document of work.filter((entry) => entry.family === 'league')) {
    const renamed = { ...document, payload: { ...(document.payload as JsonObject), name: 'Synthetic temporary branding' } };
    for (const source of [renamed, document]) {
      if ((await administration.recordObservation(normalizeAdministrationObservation(envelope(source)))).status !== 'changed') {
        throw new Error('Synthetic A-B-A branding did not produce a new observation.');
      }
    }
  }
  phases.push({ name: 'branding-A-B-A-for-three-leagues', measurement: await physical() });
  for (const document of work.filter((entry) => entry.family === 'rosters' || entry.family === 'matchups'
    || entry.family === 'transactions' && entry.week === 2)) {
    const payload = structuredClone(document.payload) as JsonObject[];
    payload[0] = { ...payload[0], ...(document.family === 'rosters' ? { owner_id: 'synthetic-new-owner' }
      : document.family === 'matchups' ? { custom_points: 41.5 } : { status: 'failed' }) };
    if ((await administration.recordObservation(normalizeAdministrationObservation(envelope({ ...document, payload })))).status !== 'changed') {
      throw new Error('A source correction was not preserved as changed content.');
    }
  }
  phases.push({ name: 'nine-team-score-transaction-corrections', measurement: await physical() });
  const report = {
    observedAt: new Date().toISOString(), postgresVersion: ADMINISTRATION_POSTGRES_VERSION,
    workload: { source: 'synthetic administration evidence using retained public configuration shapes; no provider calls', leagues: 3,
      configurationShapeFixture: 'test-support/fixtures/dynasty-league-settings.json', teamsPerLeague: [12, 12, 10],
      playersPerRoster: [14, 14, 20], sourceDocumentsInitially: work.length, transactionRowsPerLeagueWeek: 20,
      transactionWeeks: [0, 1, 2], matchupWeek: 2, metadataFamilies: ['drafts', 'traded_picks', 'winners_bracket', 'losers_bracket'],
      draftPicksPerLeague: [168, 168, 200], unchangedWriteAttempts: work.length * 10, brandingReversionWrites: 6, correctionWrites: 9 },
    interpretation: 'Measured relation allocations include heap, indexes and TOAST. Repeated head updates may allocate pages without growing immutable content. JSON byte counts are serialized application payloads, not measured wire transfer. This finite workload is not a production capacity or cost forecast.',
    phases,
  };
  await mkdir(new URL('../release/league-administration/', import.meta.url), { recursive: true });
  await writeFile(new URL('../release/league-administration/capacity.synthetic.integration.json', import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ outcome: 'passed', phases: phases.map((phase) => phase.name),
    statements: transport.statements, output: 'release/league-administration/capacity.synthetic.integration.json' })}\n`);
} finally {
  await connection?.close();
  if (prepared) await cleanIntegrationDatabase();
}
