import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { qualificationDigest, type QualificationBinding } from './qualification-profile';
import { assertRunnerCyclesEvidence, assertCompleteRunnerCyclesEvidence, writeRunnerCyclesEvidence, RUNNER_CYCLES_EVIDENCE_FILE,
  RUNNER_CYCLES_NAMES, RUNNER_CYCLES_LIMITS, RUNNER_CYCLES_ORACLES, type RunnerCyclesEvidence } from './runner-cycles-evidence';

const directories:string[]=[];
afterEach(async()=>{for(const path of directories.splice(0))await rm(path,{recursive:true,force:true});});
async function fixture(){const directory=await mkdtemp(join(tmpdir(),'cp25-offline-evidence-'));directories.push(directory);
  const binding:QualificationBinding={directory,context:{kind:'integration-qualification-context-v1',runId:randomUUID(),nonce:randomUUID(),gitSha:'a'.repeat(40),
    profile:'data-runner-cycles-v1',profileDigest:'b'.repeat(64),modules:[{path:'integration/runner-cycles.qualification-case.ts',sourceDigest:'c'.repeat(64)}]}};
  const evidence:RunnerCyclesEvidence={kind:'data-runner-cycles-evidence-v1',contextDigest:qualificationDigest(binding.context),gitSha:binding.context.gitSha,
    serverVersion:'18.6 (offline)',serverVersionNum:'180006',actualRuntimeLogin:false,actualHttpRuntimeLogin:false,primaryBoundary:'empty-registry-rejection',
    prerequisiteGets:0,prerequisiteAdmissions:0,prerequisiteClaims:0,cleanupComplete:false,admissionSpacingVerified:false,
    cases:RUNNER_CYCLES_NAMES.map((name,index)=>({name,limitMs:RUNNER_CYCLES_LIMITS[index],state:'unserved',startedAt:null,endedAt:null,events:[]})),invocations:[],cycles:[]};
  return{binding,evidence};}
it('retains incomplete evidence in an exclusive read-back artifact without granting qualification',async()=>{
  const{binding,evidence}=await fixture();expect(()=>assertRunnerCyclesEvidence(evidence,binding)).not.toThrow();
  expect(()=>assertCompleteRunnerCyclesEvidence(evidence,binding)).toThrow();
  const digest=await writeRunnerCyclesEvidence(binding,evidence),path=join(binding.directory,RUNNER_CYCLES_EVIDENCE_FILE),bytes=await readFile(path,'utf8');
  expect(JSON.parse(bytes)).toEqual(evidence);expect(digest).toBe(qualificationDigest(evidence));
  await expect(writeRunnerCyclesEvidence(binding,evidence)).rejects.toMatchObject({code:'EEXIST'});expect(await readFile(path,'utf8')).toBe(bytes);
});
it('cannot qualify four true oracle summaries without actual invocations cycles and transitions',async()=>{
  const{binding,evidence}=await fixture();evidence.actualRuntimeLogin=true;evidence.actualHttpRuntimeLogin=true;evidence.cleanupComplete=true;evidence.admissionSpacingVerified=true;
  evidence.prerequisiteGets=2;evidence.prerequisiteAdmissions=2;evidence.prerequisiteClaims=2;
  evidence.cases=evidence.cases.map((entry,index)=>({...entry,state:'passed',startedAt:`2026-10-16T12:00:0${index}.000Z`,endedAt:`2026-10-16T12:00:0${index}.999Z`,
    events:[{at:`2026-10-16T12:00:0${index}.500Z`,data:RUNNER_CYCLES_ORACLES[index]}]}));
  expect(()=>assertRunnerCyclesEvidence(evidence,binding)).not.toThrow();expect(()=>assertCompleteRunnerCyclesEvidence(evidence,binding)).toThrow();
});
it('rejects binding drift unsafe strings malformed timestamps version conflicts and budget inflation',async()=>{
  const{binding,evidence}=await fixture();
  const mutations:((value:RunnerCyclesEvidence)=>void)[]=[value=>{value.gitSha='d'.repeat(40);},value=>{value.contextDigest='e'.repeat(64);},
    value=>{value.serverVersionNum='170006';},value=>{value.cases.reverse();},value=>{value.cases[0].limitMs++;},
    value=>{value.cases[0].startedAt='Fri Oct 16 2026 12:00:00';},value=>{value.cases[0].startedAt='2026-10-16T12:00:00.780Z';value.cases[0].endedAt='2026-10-16T12:01:00.781Z';},
    value=>{value.cases[0].startedAt='2026-10-16T12:00:00.780Z';value.cases[0].events=[{at:'2026-10-16T12:00:00.781Z',data:{detail:'postgresql://secret'}}];}];
  for(const change of mutations){const changed=structuredClone(evidence);change(changed);expect(()=>assertRunnerCyclesEvidence(changed,binding)).toThrow();}
});
it('requires original absolute worker deadlines and keeps actual busy calls in the invocation inventory',async()=>{
  const{binding,evidence}=await fixture();evidence.prerequisiteClaims=2;
  evidence.invocations=[{pid:40,invocation:1,selection:'enabled',variant:1,startedAt:'2026-10-16T12:00:00.770Z',invocationStartedAt:'2026-10-16T12:00:00.780Z',
    endedAt:'2026-10-16T12:00:00.990Z',gets:0,sqlRequests:2,signalRequests:1,claimBefore:2,claimAfter:2,facade:'registry-unavailable',paths:[],admissions:[]}];
  expect(()=>assertRunnerCyclesEvidence(evidence,binding)).not.toThrow();expect(()=>assertCompleteRunnerCyclesEvidence(evidence,binding)).toThrow();
  const row=evidence.invocations[0];row.gets=1;row.paths=['/v1/user/7001'];row.claimAfter=3;
  row.admissions=[{resource:'identity',requestId:randomUUID(),generation:3,admittedAt:'2026-10-16T12:00:00.800Z',deadlineAt:'2026-10-16T12:00:20.780Z',outcomeAt:'2026-10-16T12:00:00.900Z',outcome:'checkpoint-committed'}];
  expect(()=>assertRunnerCyclesEvidence(evidence,binding)).not.toThrow();
  for(const [key,value] of [['deadlineAt','2026-10-16T12:00:20.781Z'],['admittedAt','2026-10-16T12:00:00.950Z'],['outcomeAt','2026-10-16T12:00:20.781Z']] as const){
    const changed=structuredClone(evidence);changed.invocations[0].admissions[0][key]=value;expect(()=>assertRunnerCyclesEvidence(changed,binding)).toThrow();}
});
