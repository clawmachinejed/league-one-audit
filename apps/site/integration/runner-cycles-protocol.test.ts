import { randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { createDatabase } from '../lib/database';
import { capturePublicSleeperCore, capturePublicSleeperIdentity, capturePublicSleeperLeagueList } from '../lib/sleeper';
import { normalizeAdministrationObservation } from '../lib/league-administration/normalize';
import type { JsonValue } from '../lib/league-administration/contracts';
import { projectExactMatchupValues } from '../lib/aggregator/exact-matchup-values';
import { runnerFixture, runnerFetch, runnerEnvironment, parseRunnerConfig, runnerCommand, parseRunnerCommand, parseRunnerMessage,
  runnerTimestamp, runnerSnapshotQuery, RUNNER_PROTECTED_PUBLIC_TABLES, RUNNER_CONFIG, RUNNER_VERSION, type RunnerConfig, type RunnerMessage } from './runner-cycles-protocol';

vi.mock('server-only',()=>({}));
const config:RunnerConfig={nonce:randomUUID(),fixtureId:randomUUID(),contextNonce:randomUUID(),gitSha:'a'.repeat(40),profileDigest:'b'.repeat(64),
  expectedDatabase:'integration_test',expectedBranch:'br-cp25-test'};
const url='postgresql://league_one_runtime:offline-fixture@ep-cp25-test.us-east-2.aws.neon.tech/integration_test?sslmode=require';
it('batches the exact protected publication/account/auth inventory including case-sensitive auth names and empty tables',()=>{
  const auth=['account','rateLimit','session','user','verification'].map(tablename=>({schemaname:'website_auth',tablename}));
  const catalog=[...RUNNER_PROTECTED_PUBLIC_TABLES.map(tablename=>({schemaname:'public',tablename})),...auth,{schemaname:'public',tablename:'public_data_intakes'},
    {schemaname:'public',tablename:'league_configuration_versions'},{schemaname:'public',tablename:'scoring_profiles'}];
  const snapshot=runnerSnapshotQuery(catalog,true);expect(snapshot.tables).toHaveLength(RUNNER_PROTECTED_PUBLIC_TABLES.length+5);
  expect(snapshot.sql).toContain('FROM "website_auth"."rateLimit"');expect(snapshot.sql).toContain("COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb)");
  expect(snapshot.sql.match(/WHERE job_key<>\$1/gu)).toHaveLength(1);expect(snapshot.parameters).toEqual(['league-administration-public-intake']);
  expect(snapshot.tables).toContain('public.app_users');expect(snapshot.tables).toContain('public.league_week_lineup_watch_states');
  expect(snapshot.tables).not.toContain('public.league_configuration_versions');expect(runnerSnapshotQuery(catalog).tables).toHaveLength(catalog.length);
  for(const changed of [catalog.slice(1),[...catalog,{schemaname:'public',tablename:'bad";DROP'}],[...catalog,{schemaname:'foreign',tablename:'users'}],catalog.filter(row=>row.tablename!=='rateLimit')])expect(()=>runnerSnapshotQuery(changed,true)).toThrow();
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});
it('retains only the explicit restricted URL in the filtered worker environment and rejects scope or role substitutions',()=>{
  const env=runnerEnvironment({PATH:'bin',NODE_OPTIONS:'injected',DATABASE_URL:'production-secret',AUTH_DATABASE_URL:'secret',NEON_API_KEY:'secret',TANK01_API_KEY:'secret'},url,config);
  expect(env.DATABASE_URL).toBe(url);expect(JSON.parse(env[RUNNER_CONFIG]!)).toEqual(config);
  for(const key of ['NODE_OPTIONS','AUTH_DATABASE_URL','NEON_API_KEY','TANK01_API_KEY'])expect(env[key]).toBeUndefined();
  for(const changed of [url.replace('league_one_runtime','league_one_auth'),url.replace('integration_test','foreign_test'),url.replace('sslmode=require','sslmode=disable')])expect(()=>runnerEnvironment({},changed,config)).toThrow();
  expect(()=>parseRunnerConfig({...config,ownerUrl:'extra'})).toThrow();expect(()=>parseRunnerConfig({...config,gitSha:'short'})).toThrow();
});
it('binds ordered control messages and rejects work or fake time carried into a replacement process',()=>{
  const command=runnerCommand(config,1,'invoke','enabled',2,true);expect(parseRunnerCommand(command,config,1)).toEqual(command);
  for(const value of [{...command,sequence:2},{...command,nonce:randomUUID()},{...command,now:'2026-01-01'},
    {...command,action:'release'},{...command,requestId:randomUUID()}])expect(()=>parseRunnerCommand(value,config,1)).toThrow();
});
it('preserves exact Date milliseconds and raw backend microseconds while rejecting mismatched session evidence',()=>{
  expect(runnerTimestamp(new Date('2026-10-16T12:00:00.780Z'))).toBe('2026-10-16T12:00:00.780Z');
  const message:RunnerMessage={version:RUNNER_VERSION,nonce:config.nonce,contextNonce:config.contextNonce,gitSha:config.gitSha,profileDigest:config.profileDigest,
    pid:40,backendPid:45,backendStart:'2026-10-16 12:00:00.780123+00',database:config.expectedDatabase,branch:config.expectedBranch,
    sessionUser:'league_one_runtime',currentUser:'league_one_runtime',httpSessionUser:'league_one_runtime',httpCurrentUser:'league_one_runtime',
    type:'ready',invocation:0,at:'2026-10-16T12:00:00.780Z',gets:0,sqlRequests:0,signalRequests:0,facade:'not-run',paths:[],invocationStartedAt:null};
  expect(parseRunnerMessage(message,config,40).backendStart).toBe(message.backendStart);
  for(const change of [{pid:41},{httpCurrentUser:'league_one_auth'},{branch:'br-foreign'},{gets:1},{invocationStartedAt:message.at}])expect(()=>parseRunnerMessage({...message,...change},config,40)).toThrow();
});
it('forwards the installed Neon driver request with original inputs and AbortSignal and never routes another identity',async()=>{
  vi.stubEnv('VERCEL_ENV','development');const calls:Parameters<typeof fetch>[]=[],sql: boolean[]=[];
  const transport=vi.fn<typeof fetch>(async(...args)=>{calls.push(args);return Response.json({fields:[{name:'answer',dataTypeID:23}],rows:[['1']],command:'SELECT',rowCount:1});});
  const fetch=runnerFetch({runtimeUrl:url,fixtureId:config.fixtureId,variant:()=>1,originalFetch:transport,sql:signal=>{sql.push(signal);},source:()=>{throw new Error('No source expected.');}});
  const intercept=vi.spyOn(globalThis,'fetch').mockImplementation(fetch);const database=createDatabase(url);if(!database.enabled)throw new Error('offline database disabled');
  const controller=new AbortController();await expect(database.query('SELECT 1 AS answer',[],{signal:controller.signal})).resolves.toEqual([{answer:1}]);
  expect(sql).toEqual([true]);expect(calls[0][0]).toBe(intercept.mock.calls[0][0]);expect(calls[0][1]).toBe(intercept.mock.calls[0][1]);expect(calls[0][1]?.signal).toBe(controller.signal);
  const endpoint=String(calls[0][0]),init=calls[0][1]!;
  for(const [input,options] of [[endpoint,{...init,method:'GET'}],[endpoint,{...init,headers:{'Neon-Connection-String':url.replace('league_one_runtime','league_one_auth')}}],
    ['https://tank01.invalid/',{}],['https://api.sleeper.app/v1/league/foreign/rosters',{}]] as const)await expect(fetch(input,options)).rejects.toThrow('nonfixture');
  expect(transport).toHaveBeenCalledOnce();
});
it('passes both fixture variants through the actual acquisition and normalization owners with changed exact values and equal settings/users',async()=>{
  let variant:1|2=1;const paths:string[]=[],normalized:ReturnType<typeof normalizeAdministrationObservation>[]=[];
  const fixture=runnerFixture(config.fixtureId,1);
  vi.spyOn(globalThis,'fetch').mockImplementation(runnerFetch({runtimeUrl:url,fixtureId:config.fixtureId,variant:()=>variant,
    originalFetch:async()=>{throw new Error('No database expected.');},sql:()=>{throw new Error('No SQL expected.');},source:path=>{paths.push(path);}}));
  const signal=()=>AbortSignal.timeout(2_000);
  for(const version of [1,2] as const){variant=version;
    expect((await capturePublicSleeperIdentity(fixture.username,signal())).payload).toMatchObject({user_id:fixture.manager});
    expect((await capturePublicSleeperLeagueList(fixture.manager,2026,signal())).payload).toHaveLength(1);
    for(const family of ['league','rosters','users','matchups'] as const){
      const captured=family==='matchups'?await capturePublicSleeperCore(fixture.external,family,signal(),1):await capturePublicSleeperCore(fixture.external,family,signal());
      const input=normalizeAdministrationObservation({schemaVersion:'league-administration-v1',normalizerVersion:'sleeper-administration-v1',dialect:'sleeper-nfl-v1',
        scope:{leagueKey:'sleeper-'+fixture.external,provider:'sleeper',externalLeagueId:fixture.external,season:2026},family,week:family==='matchups'?1:null,
        completeness:'complete',payload:captured.payload as JsonValue,provenance:{origin:'network',requestStartedAt:captured.requestStartedAt,requestCompletedAt:captured.requestCompletedAt,
          sourceObservedAt:captured.sourceObservedAt,checkedAt:captured.requestCompletedAt}});
      expect(input.status).toBe('accepted');normalized.push(input);
      if(family==='matchups'){const exact=projectExactMatchupValues(input,[{seasonTeamId:randomUUID(),externalRosterId:'1'},{seasonTeamId:randomUUID(),externalRosterId:'2'}]);
        expect(exact.teams.find(team=>team.externalRosterId==='1')).toMatchObject({effectivePoints:{value:version===1?'0':'12.25',source:'raw'},
          players:{state:'supplied',value:[version===1?'cp25a':'cp25b']},customPoints:{state:'missing'}});}
    }
  }
  expect(normalized[0].contentHash).toBe(normalized[4].contentHash);expect(normalized[2].contentHash).toBe(normalized[6].contentHash);
  expect(normalized[1].contentHash).not.toBe(normalized[5].contentHash);expect(normalized[3].contentHash).not.toBe(normalized[7].contentHash);expect(paths).toHaveLength(12);
});
