/** Ordinary backend operator calibration, not the projection runner facade. */
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { getDatabase } from '../lib/database';
import { submitPublicSleeperIntake, runSelectedPublicIntakeBatch } from '../lib/league-administration/public-intake-runtime';
import { PUBLIC_DATA_BATCH_POLICY } from '../lib/league-administration/public-intake-contracts';
import { createIndependentPinnedDatabase } from './neon-integration-harness';
import { assertBatchCalibrationSupportSources } from './qualification-profile';
import { BATCH_CONFIG,BATCH_VERSION,parseBatchConfig,parseBatchCommand,batchEnvironment,batchFetch,batchFixture,batchStart,batchEnd,
  type BatchCommand,type BatchMessage,type BatchAttempt,type BatchOwner } from './batch-calibration-protocol';

async function main(){
  const config=parseBatchConfig(JSON.parse(process.env[BATCH_CONFIG]??'null')),url=process.env.DATABASE_URL;
  if(!url||!process.send||process.env.NODE_OPTIONS)throw new Error('CP26 launch incomplete.');
  batchEnvironment({},url,config);await assertBatchCalibrationSupportSources(fileURLToPath(new URL('..',import.meta.url)));
  const connection=await createIndependentPinnedDatabase(url),commands:BatchCommand[]=[];
  let sequence=0,invalid=false,disconnected=false;
  process.on('message',value=>{try{commands.push(parseBatchCommand(value,config,++sequence));}catch{invalid=true;}});
  process.once('disconnect',()=>{disconnected=true;});const expires=Date.now()+300_000;
  try{
    const identity=`SELECT current_user,session_user,current_database() AS database,current_setting('neon.branch_id',true) AS branch,
      pg_backend_pid() AS pid,(SELECT backend_start::text FROM pg_stat_activity WHERE pid=pg_backend_pid()) AS backend_start,
      (SELECT rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolinherit OR rolbypassrls FROM pg_roles WHERE rolname=current_user) AS elevated`;
    const [session]=await connection.database.query(identity),http=getDatabase();if(!http.enabled)throw new Error('CP26 HTTP database disabled.');
    const [httpIdentity]=await http.query(identity);
    for(const row of [session,httpIdentity])if(row.current_user!=='league_one_runtime'||row.session_user!=='league_one_runtime'
      ||row.database!==config.expectedDatabase||row.branch!==config.expectedBranch||row.elevated!==false)throw new Error('CP26 restricted LOGIN mismatch.');
    let attempts:BatchAttempt[]=[],owners:BatchOwner[]=[];
    globalThis.fetch=batchFetch({runtimeUrl:url,fixtureId:config.fixtureId,originalFetch:globalThis.fetch,
      attempt:attempt=>attempts.push(attempt),owner:owner=>owners.push(owner)});
    const send=async(message:Pick<BatchMessage,'type'|'sequence'|'action'|'span'|'result'|'error'>)=>{
      const [live]=await connection.database.query('SELECT pg_backend_pid() AS pid');if(live.pid!==session.pid)throw new Error('CP26 pinned backend changed.');
      const value:BatchMessage={version:BATCH_VERSION,nonce:config.nonce,contextNonce:config.contextNonce,gitSha:config.gitSha,profileDigest:config.profileDigest,
        pid:process.pid,backendPid:Number(session.pid),backendStart:String(session.backend_start),database:String(session.database),branch:String(session.branch),
        sessionUser:String(session.session_user),currentUser:String(session.current_user),httpSessionUser:String(httpIdentity.session_user),httpCurrentUser:String(httpIdentity.current_user),
        attempts,owners,...message};await new Promise<void>((resolve,reject)=>process.send!(value,error=>error?reject(new Error('CP26 evidence unavailable.')):resolve()));
    };
    await send({type:'ready',sequence:0,action:null,span:batchEnd(batchStart()),result:null,error:false});
    const expected=['omitted','false','submit','enabled','stop'];let served=0;
    while(Date.now()<expires){
      while(!commands.length){if(invalid||disconnected||Date.now()>=expires)throw new Error('CP26 control closed.');await delay(10);}
      const command=commands.shift()!;if(invalid||command.action!==expected[served++])throw new Error('CP26 command order changed.');
      if(command.action==='stop')return;attempts=[];owners=[];const start=batchStart();let result:Record<string,unknown>|null=null,error=false;
      const selection={enabled:true as const,requestId:config.requestId,managerEvidenceVersion:'v2' as const,batchPolicy:PUBLIC_DATA_BATCH_POLICY};
      try{
        if(command.action==='submit'){const fixture=batchFixture(config.fixtureId);
          result=await submitPublicSleeperIntake({id:config.requestId,username:fixture.username,seasons:[2026],exactPeriods:[{season:2026,nativeWeek:1}]},selection);
        }else result=await runSelectedPublicIntakeBatch(command.action==='omitted'?undefined as never
          :command.action==='false'?{...selection,enabled:false} as never:selection,Date.parse(start.startedAt));
      }catch{error=true;}
      await send({type:'result',sequence:command.sequence,action:command.action,span:batchEnd(start),result,error});
      // Failure evidence is retained. The remaining commands cannot retry an enabled invocation.
    }
    throw new Error('CP26 worker lifetime exceeded.');
  }finally{await connection.close();}
}
// No raw database errors, SQL parameters, URLs or inherited secrets leave this process.
main().then(()=>process.disconnect?.(),()=>{process.exitCode=1;process.disconnect?.();});
