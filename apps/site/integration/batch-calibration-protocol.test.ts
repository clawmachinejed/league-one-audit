import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { randomUUID } from 'node:crypto';
import { describe,expect,it,vi } from 'vitest';
import { neonConfig } from '@neondatabase/serverless';
import { BATCH_SQL,BATCH_VERSION,batchFixture,batchFetch,batchHash,batchEnvironment,parseBatchConfig,parseBatchCommand,assertBatchSpan,type BatchConfig,type BatchAttempt,type BatchOwner } from './batch-calibration-protocol';
const config=():BatchConfig=>({nonce:randomUUID(),fixtureId:randomUUID(),requestId:randomUUID(),contextNonce:randomUUID(),gitSha:'a'.repeat(40),profileDigest:'b'.repeat(64),expectedDatabase:'calibration_test',expectedBranch:'br-test'});
const runtimeUrl='postgresql://league_one_runtime:synthetic@ep-example.us-east-2.aws.neon.tech/calibration_test?sslmode=require';
const endpoint=()=>typeof neonConfig.fetchEndpoint==='function'?neonConfig.fetchEndpoint(new URL(runtimeUrl).hostname,5432,{jwtAuth:false}):neonConfig.fetchEndpoint;
describe('closed CP26 native fixture protocol',()=>{
  it('binds each SQL observation hash to a literal in the maintained store',async()=>{
    const source=await readFile(new URL('../lib/league-administration/neon/public-intake.ts',import.meta.url),'utf8');
    const tree=ts.createSourceFile('public-intake.ts',source,ts.ScriptTarget.Latest,true),literals:string[]=[];
    const visit=(node:ts.Node)=>{if(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node))literals.push(node.text);ts.forEachChild(node,visit);};visit(tree);
    for(const statement of Object.values(BATCH_SQL))expect(literals).toContain(statement);
  });
  it('freezes four distinct source leagues and exact method/path/body inventory',()=>{
    const id=randomUUID(),fixture=batchFixture(id);expect(batchFixture(id)).toEqual(fixture);expect(fixture.leagues).toHaveLength(4);
    expect(new Set(fixture.leagues.map(row=>row.external)).size).toBe(4);expect(fixture.payloads.size).toBe(18);
    expect(fixture.leagues.map(row=>row.league.settings.type)).toEqual([1,1,2,0]);
  });
  it('serves raw native JSON through fetch and measures every exact response',async()=>{
    const id=randomUUID(),fixture=batchFixture(id),attempts:BatchAttempt[]=[],original=vi.fn();
    const fetcher=batchFetch({runtimeUrl,fixtureId:id,originalFetch:original,attempt:row=>attempts.push(row),owner:()=>undefined});
    for(const [path,payload] of fixture.payloads){const response=await fetcher('https://api.sleeper.app'+path,{signal:AbortSignal.timeout(1_000)});
      expect(await response.text()).toBe(JSON.stringify(payload));expect(attempts.at(-1)).toMatchObject({kind:'source',method:'GET',key:path,bodySha256:batchHash(JSON.stringify(payload)),sourceVersion:BATCH_VERSION,status:'ok',signal:true});}
    expect(original).not.toHaveBeenCalled();expect(attempts).toHaveLength(18);
  });
  it('preserves exact SQL fetch input and signal while observing returned owner data',async()=>{
    const now=Date.now(),owner:BatchOwner={kind:'acquired',fence:{jobKey:'league-administration-public-intake',workerId:randomUUID(),generation:1,deadlineAt:new Date(now+20_000).toISOString()},
      admissionDeadlineAt:new Date(now+10_000).toISOString(),cleanupDeadlineAt:new Date(now+22_000).toISOString(),leaseUntil:new Date(now+25_000).toISOString()};
    const original=vi.fn(async()=>new Response(JSON.stringify({fields:[{name:'result',dataTypeID:3802}],rows:[[JSON.stringify(owner)]],command:'SELECT',rowCount:1})));
    const attempts:BatchAttempt[]=[],owners:BatchOwner[]=[],fetcher=batchFetch({runtimeUrl,fixtureId:randomUUID(),originalFetch:original,attempt:row=>attempts.push(row),owner:row=>owners.push(row)});
    const init={method:'POST',headers:{'Neon-Connection-String':runtimeUrl},body:JSON.stringify({query:'/* public-data-intake:begin-batch */ SELECT example()',params:[]}),signal:AbortSignal.timeout(1_000)};
    expect((await fetcher(endpoint(),init)).ok).toBe(true);expect(original).toHaveBeenCalledExactlyOnceWith(endpoint(),init);expect(owners).toEqual([owner]);
    expect(attempts[0]).toMatchObject({kind:'sql',method:'POST',signal:true,status:'ok',bodySha256:null,sourceVersion:null});
    expect(JSON.stringify(attempts)).not.toContain('synthetic');expect(JSON.stringify(attempts)).not.toContain('SELECT');
  });
  it('retains failed aborted attempts and rejects foreign paths methods and database identities',async()=>{
    const id=randomUUID(),fixture=batchFixture(id),attempts:BatchAttempt[]=[],original=vi.fn(async()=>{throw new Error('private database detail');});
    const fetcher=batchFetch({runtimeUrl,fixtureId:id,originalFetch:original,attempt:row=>attempts.push(row),owner:()=>undefined});
    const path='https://api.sleeper.app/v1/user/'+fixture.username;
    await expect(fetcher(path,{signal:AbortSignal.abort()})).rejects.toThrow();expect(attempts[0].status).toBe('failed');
    for(const [url,init] of [[path,{method:'POST'}],[path+'?extra=1',{}],['https://foreign.example/v1/user/'+fixture.username,{}],
      [endpoint(),{method:'POST',headers:{'Neon-Connection-String':runtimeUrl.replace('calibration_test','other')}}]] as const)await expect(fetcher(url,init)).rejects.toThrow('nonfixture');
    await expect(fetcher(endpoint(),{method:'POST',headers:{'Neon-Connection-String':runtimeUrl},body:JSON.stringify({query:'SELECT 1',params:[]})})).rejects.toThrow();
    expect(attempts.at(-1)?.status).toBe('failed');expect(JSON.stringify(attempts)).not.toContain('private');
  });
  it('requires exact command identities and strips owner URLs and arbitrary inherited secrets',()=>{
    const cfg=config();expect(parseBatchConfig(cfg)).toEqual(cfg);const env=batchEnvironment({PATH:'runtime',OWNER_DATABASE_URL:'secret',NODE_OPTIONS:'danger',PROVIDER_KEY:'secret'},runtimeUrl,cfg);
    expect(env).not.toHaveProperty('OWNER_DATABASE_URL');expect(env).not.toHaveProperty('NODE_OPTIONS');expect(env).not.toHaveProperty('PROVIDER_KEY');
    const command={version:BATCH_VERSION,nonce:cfg.nonce,sequence:1,action:'enabled'};expect(parseBatchCommand(command,cfg,1)).toEqual(command);
    for(const bad of [{...command,sequence:2},{...command,nonce:randomUUID()},{...command,extra:true},{...command,action:'retry'}])expect(()=>parseBatchCommand(bad,cfg,1)).toThrow();
    expect(()=>batchEnvironment({},runtimeUrl.replace('league_one_runtime','owner'),cfg)).toThrow();expect(()=>parseBatchConfig({...cfg,extra:'secret'})).toThrow();
  });
  it('rejects invalid and backward monotonic or wall timestamps',()=>{
    const span={startedAt:'2026-10-16T00:00:00.000Z',endedAt:'2026-10-16T00:00:00.010Z',monotonicStartMs:1,monotonicEndMs:11};
    expect(()=>assertBatchSpan(span)).not.toThrow();for(const bad of [{...span,monotonicEndMs:0},{...span,monotonicStartMs:NaN},{...span,endedAt:'bad'},
      {...span,endedAt:'2026-10-15T00:00:00.000Z'}])expect(()=>assertBatchSpan(bad)).toThrow();
  });
});
