import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { assertSafeIntegrationDatabase, integrationEnvironment, ownerQuery } from './neon-integration-harness';
import { prepareSyntheticAccountSession } from './account-authority-fixture';
import { readAccountInfrastructureIdentity } from '../lib/accounts/infrastructure-identity';
import { readAuthReceiptV2 } from '../lib/accounts/session-authority';
import { createAccountAuthorityDatabase, type AccountAuthorityDatabase } from '../lib/accounts/neon/database';
import { createAccountStore } from '../lib/accounts/neon/store';
import { createNeonAccountAcquisitionPort } from '../lib/accounts/neon/discovery';
import { createAcquisitionDatabase } from '../lib/accounts/database';
import { runAccountAcquisitionStep } from '../lib/projections/runtime/account-acquisition-composition';
import type { DatabaseClient } from '../lib/database';

/** Synthetic owner manifest only. No provider network is reachable from this
 * fixture's dispatch seam. Actual SQL uses the existing supervisor credentials
 * only after all target/sentinel/role/ownership guards pass. */
export async function createAccountAcquisitionFixture() {
  await assertSafeIntegrationDatabase();
  const accountUrl = process.env.ACCOUNT_AUTHORITY_INTEGRATION_DATABASE_URL;
  if (!accountUrl) throw new Error('Actual account LOGIN fixture credential required.');
  const identity = readAccountInfrastructureIdentity((await ownerQuery<{identity:unknown}>(
    'SELECT website_auth.account_server_identity_v1() AS identity'))[0].identity);
  const contextId = randomUUID();
  const manifest = { reviewedSha:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',windowsHide:true,timeout:2000}).trim(),
    evidenceHash:'a'.repeat(64),infrastructure:identity,enabled:true,
    context:{id:contextId,revision:'1',authorityExpiresAt:new Date(Date.now()+3_600_000).toISOString()},
    policies:(['identity-lookup','league-list','nfl-state'] as const).map(family=>({id:randomUUID(),family,
      normalizerVersion:family==='identity-lookup'?'sleeper-account-identity-v1':family==='league-list'?'sleeper-account-leagues-v1':'sleeper-discovery-calendar-v1',
      validationVersion:'sleeper-preenrollment-v1',coverageSpecId:`sleeper:${family}:v1`,revision:'1',
      evidenceRef:'synthetic-fixture-not-qualification'})) };
  await ownerQuery('SELECT public.install_acquisition_policy_v1($1::jsonb)',[JSON.stringify(manifest)]);
  const runtime = createAcquisitionDatabase({ACCOUNTS_ENABLED:'true',DATABASE_URL:integrationEnvironment().runtimeDatabaseUrl,
    ACCOUNTS_DATABASE_IDENTITY:JSON.stringify(identity)});
  if (!runtime.enabled) throw new Error('Actual restricted acquisition runtime required.');
  const actual = await runtime.query('SELECT current_user AS actor,session_user AS login');
  if (actual[0]?.actor!=='league_one_runtime'||actual[0]?.login!=='league_one_runtime') throw new Error('Actual runtime LOGIN required.');
  const issuer='https://acquisition-fixture.example.test/api/auth';
  const actors: string[]=[];
  async function actor() {
    const subject=`acquisition-${randomUUID()}`;
    const receipt=readAuthReceiptV2(await prepareSyntheticAccountSession(issuer,subject));
    const database=createAccountAuthorityDatabase(receipt,{ACCOUNTS_ENABLED:'true',ACCOUNT_DATABASE_URL:accountUrl,
      ACCOUNTS_DATABASE_IDENTITY:JSON.stringify(identity)});
    const store=createAccountStore(database);
    const id=await store.resolve({issuer,subject,displayName:'Synthetic acquisition manager'});
    actors.push(id);
    const login=await database.transaction([{statement:'SELECT current_user AS actor,session_user AS login',parameters:[]}],{actorUserId:id,requestId:randomUUID()});
    if (login[0]?.[0]?.actor!=='league_one_account'||login[0]?.[0]?.login!=='league_one_account') throw new Error('Actual account LOGIN required.');
    return {id,subject,receipt,database,store,port:createNeonAccountAcquisitionPort(database,id,receipt),
      portWith:(transport:AccountAuthorityDatabase)=>createNeonAccountAcquisitionPort(transport,id,receipt)};
  }
  const urls:string[]=[];
  const native='99999999999999999999';
  const identities=new Map<string,string>();
  let calendar=2026;
  const response=(url:string):unknown=>{
    const parsed=new URL(url);
    if (parsed.origin!=='https://api.sleeper.app') throw new Error('Unexpected provider origin.');
    if (parsed.pathname==='/v1/state/nfl') return {season:String(calendar-1),league_season:String(calendar),season_type:'regular',week:10};
    const list=/^\/v1\/user\/([1-9]\d*)\/leagues\/nfl\/(\d{4})$/.exec(parsed.pathname);
    if (list) return [{league_id:`${list[2]}1234567890123456`,name:`Synthetic ${list[2]}`,sport:'nfl',season:list[2],avatar:null}];
    const lookup=/^\/v1\/user\/([a-zA-Z0-9_]+)$/.exec(parsed.pathname);
    if (lookup) {
      if (!identities.has(lookup[1])) identities.set(lookup[1],(BigInt(native)+BigInt(identities.size)).toString());
      return {user_id:identities.get(lookup[1]),username:lookup[1],display_name:'Synthetic retained manager',avatar:null};
    }
    throw new Error('Unexpected provider endpoint.');
  };
  async function step(options:{database?:DatabaseClient;body?:(url:string)=>unknown}={}) {
    return runAccountAcquisitionStep(`fixture-${randomUUID()}`,{database:options.database??runtime,monotonicNow:()=>performance.now(),
      reserveLocalCapacity:async()=>({
        dispatch:async(url)=>{
          // A real owner catalog observation, not merely a mock ordering flag.
          const open=await ownerQuery<{count:number}>(`SELECT count(*)::int AS count FROM pg_stat_activity
            WHERE usename='league_one_runtime' AND state='idle in transaction'`);
          if (open[0].count!==0) throw new Error('Provider dispatch crossed a database transaction.');
          urls.push(url);return Response.json(options.body?options.body(url):response(url));
        },terminateLocal:async()=> 'terminated' as const,release() {},
      })});
  }
  return {identity,manifest,contextId,runtime,actor,actors,urls,native,step,setCalendar:(year:number)=>{calendar=year;}};
}
export type AccountAcquisitionFixture=Awaited<ReturnType<typeof createAccountAcquisitionFixture>>;
export type AcquisitionActor=Awaited<ReturnType<AccountAcquisitionFixture['actor']>>;
