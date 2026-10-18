import { mkdtemp, readFile, rm, writeFile, mkdir, symlink, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { FLEET_VERSION } from './freshness-capacity-protocol';
import type { QualificationBinding } from './qualification-profile';
import type { FleetMessage } from './freshness-capacity-protocol';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
vi.mock('node:child_process',()=>({execFileSync:vi.fn()}));
import { assertFleetIntakePagination, assertFleetCompanionEnvelope, validateFleetCompanion, type FleetCompanion, type FleetEvidenceInventory, FLEET_HEALTHY_TESTS, buildFleetHealthyManifest, FLEET_REQUEST_OWNERS, FLEET_RAW_EVIDENCE_STREAMS, readFleetRawEvidenceDocuments, fleetDocumentRows, reassembleFleetDocuments, readFleetEvidenceDocuments, assertFleetEvidenceInventory, assertFleetHealthyReady, fleetHealthyWindow, FLEET_EVIDENCE_LIMITS,
  FLEET_EVIDENCE_STREAMS, FLEET_HEALTHY_CLOCK, readFleetEvidenceChunks, writeFleetEvidenceChunks, type FleetEvidenceRow } from './freshness-capacity-profile';

describe('fixed healthy fleet envelope',()=>{
  it('retains a real hour of transport lookback and all122minute windows before the evidence reserve',()=>{
    const start=1_000_000, latest=start+113*60_000,window=fleetHealthyWindow(start,[start+61*60_000,latest]);
    expect(window).toMatchObject({benchmarkStartedAt:start+60*60_000,freshSubmissionAt:start+61*60_000,latestFreshAnchorAt:latest,qualifyingAnchors:true});
    expect(window.observationEndsAt.at(-1)).toBe(window.workDeadlineAt-FLEET_HEALTHY_CLOCK.evidenceReserveMs);
    expect(fleetHealthyWindow(start,[latest+1]).qualifyingAnchors).toBe(false);
    expect(fleetHealthyWindow(start,[start+60*60_000]).qualifyingAnchors).toBe(false);
    expect(FLEET_HEALTHY_CLOCK).toMatchObject({workMs:240*60_000,lifecycleMs:250*60_000,expiryMs:270*60_000,ciMinutes:270});
  });
  it('cannot claim readiness from labels without each explicit actual prerequisite',()=>{
    const ready={fullPositiveFacade:true,maintenanceCoexistence:true,allOwnerTransport:true,namedStoredRegressions:true,currentSourcePins:true,liveLoginGuard:true};
    expect(()=>assertFleetHealthyReady(ready)).not.toThrow();
    for(const key of Object.keys(ready))expect(()=>assertFleetHealthyReady({...ready,[key]:false})).toThrow('incomplete healthy profile');
    expect(()=>assertFleetHealthyReady({...ready,extra:true} as typeof ready)).toThrow();
  });
});

describe('complete bounded evidence chunks',()=>{
  async function temporary(action:(directory:string)=>Promise<void>){const directory=await mkdtemp(join(tmpdir(),'cp26-chunks-'));try{await action(directory);}finally{await rm(directory,{recursive:true,force:true});}}
  const rows=():FleetEvidenceRow[]=>FLEET_EVIDENCE_STREAMS.map(stream=>({stream,sequence:1,value:{kept:null,zero:0}}));
  it('roundtrips every stream and exact row count without widening historical artifact limits',async()=>temporary(async directory=>{
    const input=rows(),inventory=await writeFleetEvidenceChunks(directory,'a'.repeat(64),input);
    expect(inventory.coverage.every(row=>row.rows===1)).toBe(true);expect(await readFleetEvidenceChunks(directory,inventory)).toEqual(input);
    expect(inventory.totalRows).toBe(9);expect(FLEET_EVIDENCE_LIMITS).toEqual({chunkBytes:4*1024*1024,maxChunks:256,totalBytes:512*1024*1024,maxRows:2_000_000});
  }));
  it('splits on exact encoded bytes and preserves global per-stream ordering',async()=>temporary(async directory=>{
    const input: FleetEvidenceRow[]=[1,2].map(sequence=>({stream:'observer-lineage',sequence,value:'x'.repeat(2_100_000)}));
    const inventory=await writeFleetEvidenceChunks(directory,'b'.repeat(64),input);expect(inventory.chunks).toHaveLength(2);
    expect(await readFleetEvidenceChunks(directory,inventory)).toEqual(input);
  }));
  it.each(['missing','extra','truncated','hash','duplicate','order','coverage','total-cap'] as const)('rejects %s evidence',async mutation=>temporary(async directory=>{
    const inventory=await writeFleetEvidenceChunks(directory,'c'.repeat(64),rows()),path=join(directory,inventory.chunks[0].file);
    if(mutation==='missing')await rm(path);
    if(mutation==='extra')await writeFile(join(directory,'fleet-evidence-9999.json'),'[]');
    if(mutation==='truncated'){const bytes=await readFile(path);await writeFile(path,bytes.subarray(0,bytes.length-1));}
    if(mutation==='hash')inventory.chunks[0].sha256='0'.repeat(64);
    if(mutation==='duplicate')inventory.chunks.push(inventory.chunks[0]);
    if(mutation==='order')inventory.chunks[0].index=1;
    if(mutation==='coverage')inventory.coverage[0].rows++;
    if(mutation==='total-cap')inventory.totalBytes=FLEET_EVIDENCE_LIMITS.totalBytes+1;
    await expect(readFleetEvidenceChunks(directory,inventory)).rejects.toThrow();
  }));
  it('refuses oversized single rows and sequence gaps rather than truncating them',async()=>temporary(async directory=>{
    await expect(writeFleetEvidenceChunks(directory,'d'.repeat(64),[{stream:'observer-reads',sequence:1,value:'x'.repeat(FLEET_EVIDENCE_LIMITS.chunkBytes)}])).rejects.toThrow('oversized');
    await expect(writeFleetEvidenceChunks(directory,'d'.repeat(64),[{stream:'observer-reads',sequence:2,value:null}])).rejects.toThrow('missing or repeated');
    expect(()=>assertFleetEvidenceInventory({})).toThrow();
  }));
});

describe('lossless semantic evidence documents',()=>{
  const documents=()=>Object.fromEntries(FLEET_EVIDENCE_STREAMS.map(stream=>[stream,{stream,rows:[null,0,false,'native']}])) as Record<typeof FLEET_EVIDENCE_STREAMS[number],unknown>;
  const rows=(input=documents())=>FLEET_EVIDENCE_STREAMS.flatMap(stream=>fleetDocumentRows(stream,input[stream]));
  it('splits a large exact JSON document across bytes and reassembles all stream semantics',async()=>{
    const input=documents();input['capacity-evidence']={value:'界'.repeat(500_000)};
    const records=rows(input);expect(records.filter(row=>row.stream==='capacity-evidence').length).toBeGreaterThan(1);
    const directory=await mkdtemp(join(tmpdir(),'cp26-documents-'));
    try{const inventory=await writeFleetEvidenceChunks(directory,'f'.repeat(64),records);expect(await readFleetEvidenceDocuments(directory,inventory)).toEqual(input);}
    finally{await rm(directory,{recursive:true,force:true});}
  });
  it.each(['missing-stream','missing-part','duplicate-part','extra-part','altered-bytes','altered-digest','altered-total'] as const)('rejects %s before semantic use',mutation=>{
    const input=documents();input['capacity-evidence']='a'.repeat(1_100_000);const records=rows(input);
    const index=records.findIndex(row=>row.stream==='capacity-evidence'),part=records[index].value as {bytesBase64:string;documentSha256:string;documentBytes:number};
    if(mutation==='missing-stream')records.splice(0,1);
    if(mutation==='missing-part')records.splice(index,1);
    if(mutation==='duplicate-part')records.splice(index,0,records[index]);
    if(mutation==='extra-part')records.push(records[index]);
    if(mutation==='altered-bytes')part.bytesBase64=Buffer.from('changed').toString('base64');
    if(mutation==='altered-digest')part.documentSha256='0'.repeat(64);
    if(mutation==='altered-total')part.documentBytes++;
    expect(()=>reassembleFleetDocuments(records)).toThrow();
  });
  it.each([NaN,Infinity,undefined,()=>true,new Date(),{missing:undefined}])('rejects JSON-coercing values',value=>{
    expect(()=>fleetDocumentRows('capacity-evidence',value)).toThrow();
  });
});

it('keeps worker evidence separate from later parent-observed cleanup',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'cp26-raw-documents-'));
  try {const records=FLEET_RAW_EVIDENCE_STREAMS.flatMap(stream=>fleetDocumentRows(stream,{actual:stream}));
    const inventory=await writeFleetEvidenceChunks(directory,'a'.repeat(64),records);
    expect(Object.keys(await readFleetRawEvidenceDocuments(directory,inventory))).toEqual(FLEET_RAW_EVIDENCE_STREAMS);
    await expect(readFleetEvidenceDocuments(directory,inventory)).rejects.toThrow('missing semantic document stream: cleanup');
    inventory.coverage.find(row=>row.stream==='cleanup')!.rows=1;
    await expect(readFleetRawEvidenceDocuments(directory,inventory)).rejects.toThrow('worker cannot attest parent cleanup');
  } finally {await rm(directory,{recursive:true,force:true});}
});

describe('shared source-bound healthy manifest construction',()=>{
  const input={fixtureId:'11111111-1111-4111-8111-111111111111',gitSha:'a'.repeat(40),plannedPostgresqlVersion:'18.6'};
  const git=()=>vi.mocked(execFileSync).mockReset().mockReturnValueOnce(input.gitSha).mockReturnValueOnce('').mockReturnValueOnce('b'.repeat(40));
  it('derives native source contracts and query bytes identically without SQL or worker imports',async()=>{
    // Only Git identity/cleanliness is mocked; actual local contract, reader and retained fixture bytes are hashed.
    git();const first=await buildFleetHealthyManifest(input);git();const second=await buildFleetHealthyManifest(input);
    expect(second.fixture.digest).toBe(first.fixture.digest);expect(second.manifest.digest).toBe(first.manifest.digest);
    expect(first.manifest.source.requestOwners).toEqual(FLEET_REQUEST_OWNERS);expect(first.manifest.source.plannedPostgresqlVersion).toBe('18.6');
    const contract=await readFile(new URL('../../../docs/aggregator-backend/data-backend-readiness-contract.md',import.meta.url));
    expect(first.manifest.source.readinessContractSha256).toBe(createHash('sha256').update(contract).digest('hex'));
    expect(first.manifest.source.leagues).toHaveLength(16);expect(first.manifest.events).toHaveLength(1280);
    expect(first.sourceFiles.querySources.every(row=>/^[a-f0-9]{64}$/u.test(row.sha256))).toBe(true);
  },30_000);
  it('rejects a foreign or dirty repository before fixture or database work',async()=>{
    vi.mocked(execFileSync).mockReset().mockReturnValueOnce('c'.repeat(40));await expect(buildFleetHealthyManifest(input)).rejects.toThrow('HEAD mismatch');
    vi.mocked(execFileSync).mockReset().mockReturnValueOnce(input.gitSha).mockReturnValueOnce(' M source');await expect(buildFleetHealthyManifest(input)).rejects.toThrow('must be clean');
  });
});

function companionEnvelope(directory=resolve('test-results/unit-companion')){
  const start=Date.now()-100_000,nonce='11111111-1111-4111-8111-111111111111';
  const binding:QualificationBinding={directory,context:{kind:'integration-qualification-context-v1',runId:'unit-only',nonce:'22222222-2222-4222-8222-222222222222',gitSha:'a'.repeat(40),profile:'data-freshness-capacity-healthy-v1',profileDigest:'b'.repeat(64),modules:[]}};
  const inventory=(raw:boolean):FleetEvidenceInventory=>({kind:'cp26-complete-evidence-chunks-v1',manifestDigest:'c'.repeat(64),chunks:[{file:'fleet-evidence-0000.json',index:0,bytes:100,sha256:'d'.repeat(64),rows:raw?8:9}],totalBytes:100,totalRows:raw?8:9,coverage:FLEET_EVIDENCE_STREAMS.map(stream=>({stream,rows:raw&&stream==='cleanup'?0:1}))});
  const rawInventory=inventory(true),finalInventory=inventory(false),span=(begin:number,end:number)=>({startedAt:new Date(start+begin).toISOString(),endedAt:new Date(start+end).toISOString(),monotonicStartMs:begin,monotonicEndMs:end});
  const config={profile:'data-freshness-capacity-healthy-v1' as const,nonce,fixtureId:'33333333-3333-4333-8333-333333333333',contextNonce:binding.context.nonce,gitSha:binding.context.gitSha,profileDigest:binding.context.profileDigest,fixtureDigest:'e'.repeat(64),manifestDigest:rawInventory.manifestDigest,workDeadlineAt:start+240*60_000,evidenceDirectory:resolve(directory,'fleet-raw-'+nonce),plannedPostgresqlVersion:'18.6',expectedDatabase:'unit_fixture',expectedBranch:'br-unit'};
  const {fixtureId,evidenceDirectory,expectedDatabase,expectedBranch,...echo}=config;void fixtureId;void evidenceDirectory;
  const ready:FleetMessage={...echo,version:FLEET_VERSION,pid:123,backendPid:456,backendStart:new Date(start).toISOString(),database:expectedDatabase,branch:expectedBranch,sessionUser:'league_one_runtime',currentUser:'league_one_runtime',httpSessionUser:'league_one_runtime',httpCurrentUser:'league_one_runtime',type:'ready',sequence:0,action:null,span:span(0,1),inventory:null,result:null,error:false};
  const cleanup={childClosed:true,backendGone:true,locksGone:true,connectionsClosed:true};
  const calls=(['omitted','false','prepare','run-healthy','snapshot'] as const).map((action,index):FleetMessage=>({...ready,type:'result',action,sequence:index+1,span:span(10+index*10,11+index*10),inventory:index===3?rawInventory:null,result:index<2?{dataAttemptsBefore:0,dataAttemptsAfter:0}:index===4?{openInvocations:0,rejected:0,rawWritten:true}:{}}));
  const value:FleetCompanion={kind:'cp26-fleet-healthy-evidence-v1',contextDigest:createHash('sha256').update(JSON.stringify(binding.context)).digest('hex'),config,ready,calls,cases:FLEET_HEALTHY_TESTS.map((name,index)=>({name,state:'passed',span:[span(2,22),span(23,52),span(53,70)][index]})),rawDirectory:'fleet-raw-'+nonce,rawInventory,finalDirectory:'fleet-final-'+nonce,finalInventory,cleanup,cleanupAttempts:[{span:span(55,60),completed:true,facts:cleanup}],childExit:{code:0,signal:null},forcedStop:false,actualServer:{version:'18.6',versionNum:'180006'},disabledBefore:'f'.repeat(64),disabledAfter:'f'.repeat(64),enrollmentPrerequisites:['league1','league2','dynasty'].map(leagueKey=>({leagueKey}))};
  return{value,binding};
}
describe('source-bound semantic companion envelope',()=>{
  it('accepts only the complete ordered protocol envelope without treating it as semantic qualification',async()=>{
    const {value,binding}=companionEnvelope();expect(await assertFleetCompanionEnvelope(value,binding)).toEqual(value);
    await expect(validateFleetCompanion(value,binding)).rejects.toThrow(); // No chunk artifacts or source execution exists in this unit fixture.
  });
  it.each(['case-name','case-order','call-order','missing-call','foreign-pid','backend-drift','forced-stop','failed-exit','unknown-cleanup','context-drift','raw-path-escape','final-path-escape','changed-state','future-worker-result','catalog-label'] as const)('rejects %s before reading chunks',async mutation=>{
    const {value,binding}=companionEnvelope();
    if(mutation==='case-name')value.cases[0].name='generic success';
    if(mutation==='case-order')value.cases.reverse();
    if(mutation==='call-order')value.calls.reverse();
    if(mutation==='missing-call')value.calls.pop();
    if(mutation==='foreign-pid')value.calls[0].pid++;
    if(mutation==='backend-drift')value.calls[0].backendPid++;
    if(mutation==='forced-stop')value.forcedStop=true;
    if(mutation==='failed-exit')value.childExit.code=1;
    if(mutation==='unknown-cleanup')value.cleanup.backendGone=false;
    if(mutation==='context-drift')value.contextDigest='0'.repeat(64);
    if(mutation==='raw-path-escape')value.rawDirectory='../elsewhere';
    if(mutation==='final-path-escape')value.finalDirectory='../elsewhere';
    if(mutation==='changed-state')value.disabledAfter='0'.repeat(64);
    if(mutation==='future-worker-result')value.calls.at(-1)!.span.endedAt=new Date(value.config.workDeadlineAt+1).toISOString();
    if(mutation==='catalog-label')(value as unknown as Record<string,unknown>).qualified=true;
    await expect(assertFleetCompanionEnvelope(value,binding)).rejects.toThrow();
  });
});


it('rejects a canonical-looking raw directory junction before opening any chunk',async()=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'cp26-companion-root-'))),outside=await realpath(await mkdtemp(join(tmpdir(),'cp26-companion-outside-')));
  try{const {value,binding}=companionEnvelope(root);await symlink(outside,join(root,value.rawDirectory),'junction');await mkdir(join(root,value.finalDirectory));
    await expect(validateFleetCompanion(value,binding)).rejects.toThrow('symlinked evidence directory');
  }finally{const temporary=await realpath(tmpdir());expect(root.startsWith(join(temporary,'cp26-companion-root-'))).toBe(true);expect(outside.startsWith(join(temporary,'cp26-companion-outside-'))).toBe(true);await rm(root,{recursive:true,force:true});await rm(outside,{recursive:true,force:true});}
});

/** Authored producer-schema unit documents. No LOGIN, SQL execution or elapsed qualification is claimed. */
describe('current producer semantic documents',()=>{
 type Row=Record<string,unknown>;let fixture:Awaited<ReturnType<typeof semanticDocuments>>;
 async function semanticDocuments(){
  const {fleetCoexistenceFixture}=await import('./freshness-capacity-worker');
  const {normalizeAdministrationObservation}=await import('../lib/league-administration/normalize');
  const {projectCurrentRosterGroups}=await import('../lib/aggregator/current-roster-groups');
  const {capacityDigest}=await import('./freshness-capacity-manifest');const {createRequire}=await import('node:module');
  const native=await fleetCoexistenceFixture(),companion=companionEnvelope().value;
  const time=Date.now()-1000,span={startedAt:new Date(time).toISOString(),endedAt:new Date(time+10).toISOString(),monotonicStartMs:1,monotonicEndMs:11};
  const cacheNames=['next/package.json','next/dist/server/lib/incremental-cache/index.js','next/dist/server/lib/incremental-cache/file-system-cache.js','next/dist/server/lib/node-fs-methods.js','next/dist/server/web/spec-extension/unstable-cache.js'];
  const require=createRequire(new URL('../package.json',import.meta.url));
  const cache={kind:'installed-next-filesystem-cache',customHandler:false,sourceFiles:await Promise.all(cacheNames.map(async name=>({name,sha256:createHash('sha256').update(await readFile(require.resolve(name))).digest('hex')})))};
  const tankDoc=native.documents.find(row=>row.url.includes('rapidapi.com/getNFLPlayerList'))!,url=new URL(tankDoc.url),tankId='authored-tank-attempt';
  const primary={fixture:native,cache,tankCoverage:{startedAt:time,endedAt:time+10,attempts:1},calls:[{action:'enabled',span,failed:false,outcome:{status:'completed',publishedLeagues:3,failedLeagues:0}}],jobs:[{job_key:'league-administration-maintenance',state:'completed'}],tankAttempts:[{id:tankId,sequence:1,owner:'primary-projection',origin:url.origin,path:url.pathname+url.search,method:'GET',outcome:'success',responseSha256:tankDoc.sha256,at:time,endedAt:time+1}],secondaryResponses:[{attemptId:tankId,owner:'primary-projection',at:time,endedAt:time+1,monotonicStart:1,monotonicEnd:2,document:tankDoc}]};
  const reads=native.named.collections[0].samples.map((sample,index)=>{
   const scope={leagueKey:sample.key,provider:'sleeper' as const,externalLeagueId:sample.nativeLeagueId,season:2026};
   const envelope=(family:'league'|'rosters')=>({schemaVersion:'league-administration-v1' as const,normalizerVersion:'sleeper-administration-v1' as const,dialect:'sleeper-nfl-v1' as const,scope,family,week:null,completeness:'complete' as const,payload:sample.resources.find(row=>row.document.family===family)!.document.payload,provenance:{origin:'network' as const,requestStartedAt:new Date(time).toISOString(),requestCompletedAt:new Date(time+1).toISOString(),sourceObservedAt:new Date(time+1).toISOString(),checkedAt:new Date(time+2).toISOString()}});
   const league=envelope('league'),held=envelope('rosters'),settings=normalizeAdministrationObservation(league),roster=normalizeAdministrationObservation(held);expect(settings.status).toBe('accepted');expect(roster.status).toBe('accepted');if(roster.status!=='accepted'||roster.value?.family!=='rosters'||!settings.leagueSettings)throw Error('native normalization failed');
   const leagueSeasonId='unit-season-'+index,receiptId='00000000-0000-4000-8000-'+String(index).padStart(12,'0');
   const teams=roster.value.teams.map(team=>{if(!team.playerExternalIds)throw Error('held native IDs absent');const seasonTeamId='unit-team-'+team.externalRosterId,players=team.playerExternalIds.map(id=>({seasonTeamId,sourceEntity:{nativeId:id}}));return{externalRosterId:team.externalRosterId,seasonTeamId,players,currentGroups:projectCurrentRosterGroups(team,players as unknown as Parameters<typeof projectCurrentRosterGroups>[1],receiptId,held.provenance)};});
   const snapshot={snapshotId:'unit-snapshot-'+index,leagueSeasonId,modelVersion:'clock-v1',week:2,payload:{league:{season:'2026'},week:2}};
   companion.enrollmentPrerequisites[index]={leagueKey:sample.key,nativeLeagueId:sample.nativeLeagueId,season:2026,leagueSeasonId,nativeScoringDigest:capacityDigest((league.payload as Row).scoring_settings),kind:'cp26-named-regression-enrollment-prerequisite'};
   return{key:sample.key,nativeLeagueId:sample.nativeLeagueId,mapping:{leagueSeasonId,scope},current:{status:'available',envelope:league},held:{status:'available',envelope:held},settings:{status:'available',value:settings.leagueSettings.value},roster:{status:'available',receipt:{id:receiptId},teams},snapshot,context:{snapshot}};
  });
  const documents={'capacity-evidence':{evidence:{outage:null}},'transport-attempts':{attempts:[{owner:'administration-maintenance'}]},'named-regressions':{original:native.named,reads}};
  return{companion,primary,documents};
 }
 beforeAll(async()=>{fixture=await semanticDocuments();},30_000);
 it('accepts actual native fixture shapes and maintained projector values in the current producer schema',async()=>{
  const {assertFleetNamedAndCoexistence}=await import('./freshness-capacity-profile');await expect(assertFleetNamedAndCoexistence(fixture.companion,fixture.documents as unknown as Record<typeof FLEET_EVIDENCE_STREAMS[number],unknown>,fixture.primary)).resolves.toBeUndefined();
 });
 it.each(['native-settings','roster-native-id','league-isolation','snapshot-version','tank-bytes','tank-missing','tank-owner','tank-clock','tank-span','tank-sequence','tank-coverage','cache-source','no-positive-primary','no-maintenance'] as const)('rejects semantic mutation %s',async mutation=>{
  const input=structuredClone(fixture),named=input.documents['named-regressions'];
  if(mutation==='native-settings')(named.reads[0].settings.value as unknown as Row).unitMutation=true;
  if(mutation==='roster-native-id')named.reads[0].roster.teams[0].players[0].sourceEntity.nativeId='foreign';
  if(mutation==='league-isolation')named.reads[0].mapping.scope.externalLeagueId=named.reads[1].nativeLeagueId;
  if(mutation==='snapshot-version')named.reads[0].snapshot.modelVersion='clock-v2';
  if(mutation==='tank-bytes')input.primary.tankAttempts[0].responseSha256='0'.repeat(64);
  if(mutation==='tank-missing')input.primary.secondaryResponses=[];
  if(mutation==='tank-owner')input.primary.tankAttempts[0].owner='data-refresh';
  if(mutation==='tank-clock')input.primary.tankAttempts[0].endedAt=NaN;
  if(mutation==='tank-span')input.primary.tankAttempts[0].at-=1;
  if(mutation==='tank-sequence')input.primary.tankAttempts[0].sequence=2;
  if(mutation==='tank-coverage')input.primary.tankCoverage.attempts=2;
  if(mutation==='cache-source')input.primary.cache.sourceFiles[0].sha256='0'.repeat(64);
  if(mutation==='no-positive-primary')input.primary.calls[0].outcome.publishedLeagues=0;
  if(mutation==='no-maintenance')input.primary.jobs=[];
  const {assertFleetNamedAndCoexistence}=await import('./freshness-capacity-profile');await expect(assertFleetNamedAndCoexistence(input.companion,input.documents as unknown as Record<typeof FLEET_EVIDENCE_STREAMS[number],unknown>,input.primary)).rejects.toThrow();
 });
});

describe('parent reconciliation of actual producer discovery records',()=>{
 function discovery(){
  const id=(n:number)=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),start=1_700_000_000_000,iso=(at:number)=>new Date(at).toISOString();
  const work={requestId:id(1),revision:0,kind:'identity',username:'cp26_authored_unit'};
  const witness={version:'public-network-capture-v1',work,fence:{jobKey:'league-administration-public-intake',workerId:id(2),generation:1,deadlineAt:iso(start+20_000)},dispatchNonce:id(3),mapping:null,attempts:{}};
  const payload={user_id:'1234',username:'cp26_authored_unit'},rawUtf8=JSON.stringify(payload),attemptId='actual-journal-entry-shape';
  const row={proofId:id(1),kind:'identity-observation',endpointId:'identity:accepted',requestId:id(1),attemptId,readSpan:{startedAt:start+10,endedAt:start+15,monotonicStartedAt:10,monotonicEndedAt:15},record:{stored:{intake_id:id(1),payload,request_started_at:iso(start+1),request_completed_at:iso(start+5)},dispatch:{worker_id:id(2),generation:1,capture_nonce:id(3),work},outcome:{outcome:'checkpoint-committed',recorded_at:iso(start+7),capture_acquisition:witness}}};
  const response={endpointId:row.endpointId,rawUtf8,requestStartedAt:start+2,responseCompletedAt:start+4},physical={owner:'data-refresh',outcome:'success'},invocations=[{owner:'data-refresh',span:{startedAt:start,endedAt:start+8}}];
  return{row,responses:new Map([[attemptId,response as Record<string,unknown>]]),attempts:new Map([[attemptId,physical as Record<string,unknown>]]),invocations,start};
 }
 it('reconciles a complete ordinary discovery record without executing a database or claiming elapsed proof',async()=>{
  const value=discovery(),{assertFleetEndpointLineage}=await import('./freshness-capacity-profile');await expect(assertFleetEndpointLineage(value.row,value.responses,value.attempts,value.invocations)).resolves.toEqual({sourceObservedAt:value.start+5,acceptedAt:value.start+7});
 });
 it.each(['payload','request','generation','nonce','deadline','clock','uncommitted','owner'] as const)('rejects discovery lineage drift %s',async mutation=>{
  const value=discovery(),record=value.row.record;
  if(mutation==='payload')record.stored.payload.user_id='9999';
  if(mutation==='request')record.stored.intake_id='foreign';
  if(mutation==='generation')record.dispatch.generation=2;
  if(mutation==='nonce')record.dispatch.capture_nonce='00000000-0000-4000-8000-000000000099';
  if(mutation==='deadline')record.outcome.capture_acquisition.fence.deadlineAt=new Date(value.start+21_000).toISOString();
  if(mutation==='clock')record.stored.request_completed_at=new Date(value.start+3).toISOString();
  if(mutation==='uncommitted')record.outcome.outcome='failed';
  if(mutation==='owner')value.attempts.get(value.row.attemptId)!.owner='primary-projection';
  const {assertFleetEndpointLineage}=await import('./freshness-capacity-profile');await expect(assertFleetEndpointLineage(value.row,value.responses,value.attempts,value.invocations)).rejects.toThrow();
 });
});

describe('recovery producer case chronology',()=>{
 async function recovery(){const {value,binding}=companionEnvelope(),{FLEET_RECOVERY_PROFILE,FLEET_RECOVERY_TESTS}=await import('./freshness-capacity-profile');binding.context.profile=FLEET_RECOVERY_PROFILE;value.kind='cp26-fleet-recovery-evidence-v1';value.config.profile=FLEET_RECOVERY_PROFILE;value.config.workDeadlineAt=Date.parse(value.ready.backendStart)+340*60_000;value.ready.profile=FLEET_RECOVERY_PROFILE;value.ready.workDeadlineAt=value.config.workDeadlineAt;
  for(const call of value.calls){call.profile=FLEET_RECOVERY_PROFILE;call.workDeadlineAt=value.config.workDeadlineAt;if(call.action==='run-healthy')call.action='run-recovery';}value.contextDigest=createHash('sha256').update(JSON.stringify(binding.context)).digest('hex');
  const start=Date.parse(value.ready.backendStart),span=(a:number,b:number)=>({startedAt:new Date(start+a).toISOString(),endedAt:new Date(start+b).toISOString(),monotonicStartMs:a,monotonicEndMs:b});value.cases=FLEET_RECOVERY_TESTS.map((name,i)=>({name,state:'passed',span:[span(2,52),span(53,54),span(55,70)][i]}));return{value,binding};}
 it('accepts the actual recovery case-zero command sequence',async()=>{const {value,binding}=await recovery();await expect(assertFleetCompanionEnvelope(value,binding)).resolves.toEqual(value);});
 it('rejects recovery commands moved outside the owning case',async()=>{const {value,binding}=await recovery();value.cases[0].span.endedAt=value.calls[1].span.endedAt;await expect(assertFleetCompanionEnvelope(value,binding)).rejects.toThrow();});
});

/** Native wrapper evidence, not a simulated database acceptance. The surrounding lineage validator separately requires actual typed acceptance rows. */
describe('draft-specific parent normalization parity',()=>{
 async function record(kind:'catalog'|'detail'|'selections'|'draft'|'league'='detail'){
  const {normalizeAdministrationObservation}=await import('../lib/league-administration/normalize'),{DRAFT_METADATA_VERSION}=await import('../lib/aggregator/draft-metadata'),{DRAFT_SELECTIONS_VERSION}=await import('../lib/aggregator/draft-selections'),{TRADED_PICKS_VERSION}=await import('../lib/aggregator/traded-picks');
  const native={league_id:'123456789',draft_id:'987654321',season:'2026',sport:'nfl'},at='2026-10-17T00:00:00.000Z';
  const payload:import('../lib/league-administration/contracts').JsonValue=kind==='catalog'?{metadataVersion:DRAFT_METADATA_VERSION,kind,catalog:[native],details:[{externalDraftId:native.draft_id,state:'succeeded'}],reason:null}:kind==='detail'?{metadataVersion:DRAFT_METADATA_VERSION,kind,externalDraftId:native.draft_id,catalog:native,draft:native}:kind==='selections'?{selectionsVersion:DRAFT_SELECTIONS_VERSION,kind,externalDraftId:native.draft_id,catalog:native,picks:[]}:kind==='draft'?{tradedPicksVersion:TRADED_PICKS_VERSION,kind,externalDraftId:native.draft_id,catalog:native,tradedPicks:[]}:{tradedPicksVersion:TRADED_PICKS_VERSION,kind,tradedPicks:[]};
  const envelope={schemaVersion:'league-administration-v1',normalizerVersion:'sleeper-administration-v1',dialect:'sleeper-nfl-v1',scope:{leagueKey:'draft-proof-unit',provider:'sleeper',externalLeagueId:native.league_id,season:2026},family:'drafts',week:null,completeness:'complete',payload,provenance:{origin:'network',requestStartedAt:at,requestCompletedAt:at,sourceObservedAt:at,checkedAt:at}} as import('../lib/league-administration/contracts').AdministrationEnvelope;
  const normalized=normalizeAdministrationObservation(envelope);expect(normalized.status).toBe('rejected');expect(normalized.diagnostics).toMatchObject([{code:'invalid_array',path:'payload'}]);
  return{content:{family:'drafts',week:0,completeness:'complete',payload,accepted:false,content_hash:normalized.contentHash,semantic_hash:normalized.semanticHash,normalized_value:normalized.value,diagnostics:normalized.diagnostics},receipt:{provenance:envelope.provenance},attempt:{source_mapping:{scope:envelope.scope}}};
 }
 it.each(['catalog','detail','selections','draft','league'] as const)('preserves general rejection and accepts the maintained complete %s projection',async kind=>{const row=await record(kind),{normalizedFleetReceipt}=await import('./freshness-capacity-profile');await expect(normalizedFleetReceipt(row)).resolves.toMatchObject({status:'rejected',value:null});});
 it.each(['accepted','content-hash','semantic-hash','value','diagnostics','typed-projector','non-draft'] as const)('rejects altered draft proof %s',async mutation=>{const row=await record(),content=row.content as Record<string,unknown>;
  if(mutation==='accepted')content.accepted=true;if(mutation==='content-hash')content.content_hash='a'.repeat(64);if(mutation==='semantic-hash')content.semantic_hash='b'.repeat(64);if(mutation==='value')content.normalized_value={};if(mutation==='diagnostics')content.diagnostics=[];
  if(mutation==='typed-projector'){const payload=content.payload as Record<string,unknown>;payload.metadataVersion='unknown';const {normalizeAdministrationObservation}=await import('../lib/league-administration/normalize');const normalized=normalizeAdministrationObservation({schemaVersion:'league-administration-v1',normalizerVersion:'sleeper-administration-v1',dialect:'sleeper-nfl-v1',scope:row.attempt.source_mapping.scope,family:'drafts',week:null,completeness:'complete',payload:payload as import('../lib/league-administration/contracts').JsonValue,provenance:row.receipt.provenance});content.content_hash=normalized.contentHash;content.semantic_hash=normalized.semanticHash;content.normalized_value=normalized.value;content.diagnostics=normalized.diagnostics;}
  if(mutation==='non-draft')content.family='rosters';const {normalizedFleetReceipt}=await import('./freshness-capacity-profile');await expect(normalizedFleetReceipt(row)).rejects.toThrow();
 });
});


describe('independent retained intake pagination',()=>{
  const families=[['periodInventory','exactPeriods'],['transactionHistory','transactions'],['draftPicks','drafts']] as const;
  function pages(counts=[72,76,20]){
    const cursors:(number|null)[]=[0,0,0];
    return Array.from({length:Math.max(...counts.map(count=>Math.ceil(count/20)),1)},()=>{
      const value:Record<string,unknown>={status:'partial'};
      families.forEach(([inventoryName,rowsName],family)=>{
        const tasks=Array.from({length:counts[family]},(_,index)=>({ordinal:family===2?index*3+1:index+1,native:'source-'+index}));
        const after=cursors[family]??0,remaining=tasks.filter(task=>task.ordinal>after),selected=remaining.slice(0,20),next=remaining.length>20?selected.at(-1)!.ordinal:null;
        value[inventoryName]={tasks,collection:'complete',page:{afterOrdinal:after,limit:20,nextAfterOrdinal:next}};
        value[rowsName]=selected.map(task=>({...task,value:{receipt:'receipt-'+family+'-'+task.ordinal}}));
        if(cursors[family]!==null)cursors[family]=next;
      });return value;
    });
  }
  it('counts 72 periods, 76 transactions and 20 drafts across four actual-shaped pages',()=>{
    const input=pages(),before=JSON.stringify(input),active=assertFleetIntakePagination(input,false);
    expect(active).toEqual([{exactPeriods:true,transactions:true,drafts:true},...Array.from({length:3},()=>({exactPeriods:true,transactions:true,drafts:false}))]);
    expect(families.map(([,rows])=>input.reduce((count,page,index)=>count+(active[index][rows]?(page[rows] as unknown[]).length:0),0))).toEqual([72,76,20]);
    expect(JSON.stringify(input)).toBe(before);
  });
  it('accepts exact first-page replays for any exhausted family, including multi-page families',()=>{
    const input=pages([20,42,25]),active=assertFleetIntakePagination(input,false);
    expect(active).toEqual([{exactPeriods:true,transactions:true,drafts:true},{exactPeriods:false,transactions:true,drafts:true},{exactPeriods:false,transactions:true,drafts:false}]);
  });
  it.each(['changed-completed-row','reordered-completed-row','changed-completed-inventory','unfinished-replay','cursor-jump','early-end','wrong-next','wrong-limit','reordered-active','truncated-active','inventory-change','invalid-ordinal','missing-last','extra-last','missing-inventory'] as const)('rejects %s without dropping raw rows',mutation=>{
    const input=pages();const inventory=(page:number,name='periodInventory')=>input[page][name] as {tasks:{ordinal:number}[];collection:string;page:{afterOrdinal:number;limit:number;nextAfterOrdinal:number|null}};
    const rows=(page:number,name='exactPeriods')=>input[page][name] as {ordinal:number;value:{receipt:string}}[];
    if(mutation==='changed-completed-row')rows(1,'drafts')[0].value.receipt='changed';
    if(mutation==='reordered-completed-row')rows(1,'drafts').reverse();
    if(mutation==='changed-completed-inventory')inventory(1,'draftPicks').collection='changed';
    if(mutation==='unfinished-replay'){input[1].periodInventory=structuredClone(input[0].periodInventory);input[1].exactPeriods=structuredClone(input[0].exactPeriods);}
    if(mutation==='cursor-jump')inventory(1).page.afterOrdinal=40;
    if(mutation==='early-end')inventory(0).page.nextAfterOrdinal=null;
    if(mutation==='wrong-next')inventory(0).page.nextAfterOrdinal=19;
    if(mutation==='wrong-limit')inventory(0).page.limit=19;
    if(mutation==='reordered-active')rows(1).reverse();
    if(mutation==='truncated-active')rows(1).pop();
    if(mutation==='inventory-change')inventory(1).collection='changed';
    if(mutation==='invalid-ordinal')inventory(0).tasks[0].ordinal=0.5;
    if(mutation==='missing-last')input.pop();
    if(mutation==='extra-last')input.push(structuredClone(input[0]));
    if(mutation==='missing-inventory')delete input[0].draftPicks;
    expect(()=>assertFleetIntakePagination(input,false)).toThrow();
  });
  it('keeps initial selected scope separate from full inventory pagination',()=>{
    const initial={exactPeriods:[{nativeWeek:7}],transactions:[{nativeWeek:7}],brackets:[]};
    expect(assertFleetIntakePagination([initial],true)).toEqual([{exactPeriods:true,transactions:true,drafts:false}]);
    expect(()=>assertFleetIntakePagination([initial,initial],true)).toThrow('exactly one');
    expect(()=>assertFleetIntakePagination([{...initial,periodInventory:pages()[0].periodInventory}],true)).toThrow('full inventory');
    expect(()=>assertFleetIntakePagination([{...initial,drafts:[{ordinal:1}]}],true)).toThrow('draft rows');
    expect(()=>assertFleetIntakePagination([],false)).toThrow('missing');
  });
});


describe('weekly parent canonical reader parity',()=>{
  async function fixture(){
    const retained=(await import('../test-support/fixtures/cp13-live-source-2026/weekly-reports.json')).default.observations[0];
    const {normalizeAdministrationObservation}=await import('../lib/league-administration/normalize');const {projectWeeklyReport}=await import('../lib/aggregator/weekly-reports');
    const uuid=(n:number)=>n.toString(16).padStart(8,'0')+'-1111-4111-8111-111111111111';
    const native=retained.externalLeagueId,scope={provider:'sleeper' as const,leagueKey:'weekly-parent-unit',externalLeagueId:native,season:2026};
    const mapping={connectionId:uuid(1),leagueSeasonId:uuid(2),revisionId:uuid(3),generation:1,scope};
    const witness=(core:boolean)=>({version:'public-network-capture-v1',work:core?{requestId:uuid(4),revision:1,kind:'core',externalLeagueId:native,season:2026}:{requestId:uuid(4),revision:2,kind:'weekly-report',externalLeagueId:native,season:2026,nativeWeek:retained.requestedWeek},fence:{jobKey:'league-administration-public-intake',workerId:uuid(core?5:6),generation:1,deadlineAt:'2026-10-17T00:00:20.000Z'},dispatchNonce:uuid(7),mapping,attempts:core?{settings:{id:uuid(8),nonce:uuid(9)},players:{id:uuid(10),nonce:uuid(11)},managers:{id:uuid(12),nonce:uuid(13)}}:{weekly_report:{id:uuid(14),nonce:uuid(15)}}});
    const envelope={schemaVersion:'league-administration-v1',normalizerVersion:'sleeper-administration-v1',dialect:'sleeper-nfl-v1',scope,family:'weekly_report',week:retained.requestedWeek,completeness:'complete',payload:structuredClone(retained.report.document),provenance:{origin:'network',...retained.report.source,checkedAt:retained.report.source.requestCompletedAt,acquisition:witness(false)}} as unknown as import('../lib/league-administration/contracts').AdministrationEnvelope;
    const normalized=normalizeAdministrationObservation(envelope),projected=projectWeeklyReport(normalized);if(projected.status!=='accepted')throw Error('retained report not accepted');
    const teams=projected.value.teams.map((team,index)=>({externalRosterId:team.externalRosterId,seasonTeamId:uuid(index+30),players:[{seasonTeamId:uuid(index+30),sourceTeam:{provider:'sleeper',resourceKind:'team',nativeNamespace:JSON.stringify(['nfl',2026,native]),nativeId:team.externalRosterId}}]}));
    const roster={nativeLeagueId:native,read:{status:'available',receipt:{id:uuid(20)},accepted:{contentId:uuid(21),sourceMappingRevisionId:mapping.revisionId,scope:{leagueSeasonId:mapping.leagueSeasonId,connectionId:mapping.connectionId}},teams},source:{receipt:{id:uuid(20),provenance:{acquisition:witness(true)}},content:{id:uuid(21),external_league_id:native},attempt:{source_mapping:mapping}}};
    return{normalized,projected,roster};
  }
  it('preserves every projected native field and adds only same-league canonical seasonTeamId',async()=>{
    const {fleetWeeklyReportReaderValue}=await import('./freshness-capacity-profile'),f=await fixture(),value=await fleetWeeklyReportReaderValue(f.normalized,f.roster);
    expect(value).toEqual({...f.projected.value,teams:f.projected.value.teams.map((team,index)=>({...team,seasonTeamId:f.roster.read.teams[index].seasonTeamId}))});
  });
  it.each(['native-league','season','revision','namespace','duplicate-native','duplicate-canonical','missing-team','invalid-uuid','player-team','accepted-scope','missing-witness'] as const)('rejects %s identity enrichment',async mutation=>{
    const f=await fixture();
    if(mutation==='native-league')f.roster.nativeLeagueId='999';
    if(mutation==='season')f.roster.source.receipt.provenance.acquisition.mapping.scope.season=2025;
    if(mutation==='revision')f.roster.read.accepted.sourceMappingRevisionId='ffffffff-ffff-4fff-8fff-ffffffffffff';
    if(mutation==='namespace')f.roster.read.teams[0].players[0].sourceTeam.nativeNamespace='foreign';
    if(mutation==='duplicate-native')f.roster.read.teams[1].externalRosterId=f.roster.read.teams[0].externalRosterId;
    if(mutation==='duplicate-canonical')f.roster.read.teams[1].seasonTeamId=f.roster.read.teams[0].seasonTeamId;
    if(mutation==='missing-team')f.roster.read.teams.pop();
    if(mutation==='invalid-uuid')f.roster.read.teams[0].seasonTeamId='not-a-uuid';
    if(mutation==='player-team')f.roster.read.teams[0].players[0].seasonTeamId=f.roster.read.teams[1].seasonTeamId;
    if(mutation==='accepted-scope')f.roster.read.accepted.scope.leagueSeasonId=f.roster.read.accepted.scope.connectionId;
    if(mutation==='missing-witness'){f.normalized=structuredClone(f.normalized);delete (f.normalized.envelope.provenance as unknown as Record<string,unknown>).acquisition;}
    const {fleetWeeklyReportReaderValue}=await import('./freshness-capacity-profile');await expect(fleetWeeklyReportReaderValue(f.normalized,f.roster)).rejects.toThrow();
  });
});


import { assertFleetAncillaryChain, fleetSqlEvidenceTime, replayFleetAncillaryQueries } from './freshness-capacity-profile';
import { capacityDigest } from './freshness-capacity-manifest';
import type { AdministrationEnvelope, JsonValue, PublicCaptureWitness } from '../lib/league-administration/contracts';
import { CURRENT_ROSTER_POLICY, currentRosterScope } from '../lib/aggregator/current-roster';
import { OFFICIAL_STANDINGS_VERSION, projectOfficialStandings } from '../lib/aggregator/official-standings';
import { normalizeAdministrationObservation } from '../lib/league-administration/normalize';
import { OFFICIAL_STANDINGS_SQL, readOfficialStandingsRows } from '../lib/league-administration/neon/official-standings';
vi.mock('server-only',()=>({}));

describe('independent parent ancillary confirmation intervals',()=>{
  const start=1_000_000,end=start+1_800_000;
  const row=(n:number,sourceAt:number,confirmedAt=sourceAt+100)=>({receiptId:'receipt-'+n,attemptId:'attempt-'+n,sourceAt,acceptedAt:sourceAt+50,committedAt:sourceAt+60,confirmedAt});
  const valid=()=>[row(0,start-1000,start-900),row(1,start+600_000),row(2,start+1_200_000)];
  it('covers exact start, distinct successful captures and the trailing boundary',()=>{
    expect(assertFleetAncillaryChain(start,end,valid(),{requirePrior:true})).toMatchObject({distinctCaptures:3,tailMs:600_000});
  });
  it('does not count repeated current reads as new source service',()=>{
    const rows=valid();rows.push({...rows[2],confirmedAt:end});expect(assertFleetAncillaryChain(start,end,rows,{requirePrior:true}).distinctCaptures).toBe(3);
  });
  it.each(['missing-prior','stale-prior','late-commit-prior','late-confirmation','stale-read','old-head-return','receipt-mutation','attempt-reuse','stale-tail','missing-all','post-end-commit']as const)('rejects %s',mutation=>{
    const rows=valid();
    if(mutation==='missing-prior')rows.shift();
    if(mutation==='stale-prior')rows[0]=row(0,start-900_001,start-1);
    if(mutation==='late-commit-prior')rows[0].committedAt=start+1;
    if(mutation==='late-confirmation')rows[1].confirmedAt=start+900_001;
    if(mutation==='stale-read')rows[1]={...rows[1],sourceAt:start-400_000,acceptedAt:start-399_950,committedAt:start-399_940};
    if(mutation==='old-head-return')rows.push({...rows[0],confirmedAt:end-1});
    if(mutation==='receipt-mutation')rows.push({...rows[2],attemptId:'changed',confirmedAt:end-1});
    if(mutation==='attempt-reuse')rows[2].attemptId=rows[1].attemptId;
    if(mutation==='stale-tail')rows.pop();
    if(mutation==='missing-all')rows.length=0;
    if(mutation==='post-end-commit'){rows.pop();rows.push(row(3,end-100,end));rows.at(-1)!.committedAt=end+1;}
    expect(()=>assertFleetAncillaryChain(start,end,rows,{requirePrior:true})).toThrow();
  });
  it('accepts the exact fifteen-minute edge but rejects one millisecond beyond',()=>{
    const rows=[row(0,start,start),row(1,start+900_000,start+900_000)];for(const value of rows){value.acceptedAt=value.sourceAt;value.committedAt=value.sourceAt;}
    expect(assertFleetAncillaryChain(start,end,rows,{requirePrior:true}).tailMs).toBe(900_000);
    expect(()=>assertFleetAncillaryChain(start,end+1,rows,{requirePrior:true})).toThrow('trailing');
  });
  it('requires genuinely new post-restoration source and preserves a prior fresh first-read anchor',()=>{
    expect(()=>assertFleetAncillaryChain(start,start+600_000,[row(0,start-100,start+100)],{freshSource:true})).toThrow('no confirmed');
    expect(assertFleetAncillaryChain(start,start+600_000,[row(0,start-1000,start-900)]).tailMs).toBe(601_000);
  });
  it('does not round a PostgreSQL microsecond after a fixed boundary back into it',()=>{
    const at=Date.parse('2026-10-17T22:00:00Z');expect(fleetSqlEvidenceTime('2026-10-17T22:00:00.000000+00:00')).toBe(at);
    expect(fleetSqlEvidenceTime('2026-10-17T18:00:00.000001-04:00')).toBe(at+1);
    expect(fleetSqlEvidenceTime('2026-10-17T22:00:00.999999Z')).toBe(at+1000);
  });
});

describe('parent replays actual maintained ancillary query semantics',()=>{
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = '2026-10-11T12:00:00.000Z';
const mapping = { connectionId: id(1), leagueSeasonId: id(2), revisionId: id(3), generation: 1,
  scope: { leagueKey: 'cp13-unit', provider: 'sleeper' as const, externalLeagueId: '9876543210', season: 2026 } };
const witness: PublicCaptureWitness = { version: 'public-network-capture-v1',
  work: { requestId: id(10), revision: 3, kind: 'core', externalLeagueId: mapping.scope.externalLeagueId, season: 2026 },
  fence: { jobKey: 'league-administration-public-intake', workerId: id(11), generation: 2, deadlineAt: '2026-10-11T12:00:20.000Z' },
  dispatchNonce: id(12), mapping, attempts: { players: { id: id(6), nonce: id(16) },
    settings: { id: id(17), nonce: id(18) }, managers: { id: id(19), nonce: id(20) } } };
const settings = { wins: 4, losses: 1, ties: 0, fpts: 512, fpts_decimal: 37, fpts_against: 499, fpts_against_decimal: 0 };
function fixture(payload: JsonValue = [{ roster_id: 1, players: null, owner_id: { malformed: true }, settings }],
  expected: number | null = null, completeness: AdministrationEnvelope['completeness'] = 'complete') {
  const provenance = { origin: 'network' as const, requestStartedAt: at, requestCompletedAt: at, sourceObservedAt: at, checkedAt: at, acquisition: witness };
  const normalized = normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1',
    dialect: 'sleeper-nfl-v1', scope: mapping.scope, family: 'rosters', week: null, completeness, provenance, payload });
  const projection = projectOfficialStandings(normalized);
  const configuration = expected === null ? null : normalizeAdministrationObservation({ ...normalized.envelope, family: 'league', completeness: 'complete',
    payload: { league_id: mapping.scope.externalLeagueId, season: '2026', sport: 'nfl', total_rosters: expected,
      roster_positions: ['QB'], scoring_settings: {}, settings: { type: 0 } } });

  const population = expected === null ? 'unproved' : projection.status === 'qualified' && expected === projection.teams.length ? 'proven' : 'mismatch';
  const entitySet = projection.status !== 'qualified' ? 'unknown' : completeness === 'complete' && population === 'proven' ? 'full'
    : population === 'mismatch' || completeness === 'partial' ? 'partial' : 'unknown';
  const record = projection.status !== 'qualified' || !projection.teams.length ? 'unknown' : projection.teams.every(team =>
    Object.values(team.record).every(field => field.state === 'known') && team.pointsFor.state === 'known' && team.pointsAgainst.state === 'known') ? 'complete' : 'partial';
  const reasons = [...projection.reasons, ...(population === 'unproved' ? ['standings_population_unproved'] : population === 'mismatch' ? ['standings_population_mismatch'] : []),
    ...(completeness === 'partial' ? ['standings_capture_partial'] : []), ...(record !== 'complete' ? ['standings_record_fields_incomplete'] : [])];
  const row = { identity: { scope: currentRosterScope(mapping), policy: CURRENT_ROSTER_POLICY }, league_season_id: id(2),
    attempt_id: id(6), ordinal: '3', source_mapping: mapping, capture_nonce: id(16), write_fence: witness.fence, reserved_at: at,
    population_after_reservation: false,
    receipt_id: id(5), content_id: id(8), legacy_observation_id: id(7), provenance, configuration_content_id: expected === null ? null : id(9),
    population_evidence: configuration === null ? null : { provenance, contentHash: configuration.contentHash, observationId: id(21) }, expected_team_count: expected,
    configuration_content: configuration === null ? null : { id: id(9), league_season_id: mapping.leagueSeasonId, provider: 'sleeper',
      external_league_id: mapping.scope.externalLeagueId, family: 'league', week: 0, normalizer_version: 'sleeper-administration-v1',
      accepted: true, completeness: 'complete', content_hash: configuration.contentHash, payload: configuration.envelope.payload },
    population_observation: configuration === null ? null : { id: id(21), content_id: id(9), league_season_id: mapping.leagueSeasonId, family: 'league', week: 0 },
    provider: 'sleeper', external_league_id: mapping.scope.externalLeagueId, family: 'rosters', week: 0,
    content_hash: normalized.contentHash, semantic_hash: normalized.semanticHash, payload, normalizer_version: 'sleeper-administration-v1', completeness,
    observation_content_id: id(8), observation_league_season_id: id(2), first_receipt_content_id: id(8),
    qualification: { receipt_id: id(5), content_id: id(8), attempt_id: id(6), attempt_ordinal: 3, source_mapping: mapping,
      value_version: OFFICIAL_STANDINGS_VERSION, expected_team_count: expected, population_state: population, entity_set: entitySet,
      record_completeness: record, reasons, intake_id: id(10), worker_id: id(11), generation: 2 },
    value_header: { content_id: id(8), first_receipt_id: id(5), value_version: OFFICIAL_STANDINGS_VERSION,
      structural_status: projection.status, team_count: projection.teams.length, reasons: projection.reasons }, typed_value: projection,
    identities: projection.teams.map((team, index) => ({ externalRosterId: team.externalRosterId, seasonTeamId: id(30 + index),
      identityLeagueSeasonId: id(2), identityProvider: 'sleeper', identityExternalLeagueId: mapping.scope.externalLeagueId,
      identityExternalRosterId: team.externalRosterId })) };
  return { row, normalized, projection };
}

  const span={startedAt:1,endedAt:2,monotonicStartedAt:1,monotonicEndedAt:2};
  function transcript(){const f=fixture(undefined,1),rows=[f.row],ref=capacityDigest(rows),params=[JSON.stringify({scope:currentRosterScope(mapping),policy:CURRENT_ROSTER_POLICY}),mapping.revisionId,mapping.generation];
    const queries={current:[{sql:OFFICIAL_STANDINGS_SQL,params:[...params,null],rowsRef:ref,span}],retained:[{sql:OFFICIAL_STANDINGS_SQL,params:[...params,id(5)],rowsRef:ref,span}],context:[]};
    return{queries,rows:new Map<string,unknown>([[ref,rows]]),expected:{current:readOfficialStandingsRows(rows,mapping,{}),retained:readOfficialStandingsRows(rows,mapping,{rosterReceiptId:id(5)}),context:null}};}
  it('replays both actual reader selections and shares one exact immutable SQL row body',async()=>{
    const f=transcript();expect(f.expected.current.status).toBe('available');const result=await replayFleetAncillaryQueries('standings',mapping,7,id(5),f.queries,f.expected,f.rows);expect(result.current).toEqual(f.expected.current);expect(result.retained).toEqual(f.expected.retained);expect(f.rows.size).toBe(1);
  });
  it.each(['query','params','row-hash','missing-rows','extra-query','missing-query','forged-value','wrong-receipt']as const)('rejects %s without trusting the supplied availability label',async mutation=>{
    const f=transcript();
    if(mutation==='query')f.queries.current[0].sql='SELECT true';
    if(mutation==='params')f.queries.current[0].params[1]=id(99);
    if(mutation==='row-hash'){const rows=f.rows.values().next().value as Record<string,unknown>[];rows[0].typed_value={status:'qualified',teams:[]};}
    if(mutation==='missing-rows')f.rows.clear();
    if(mutation==='extra-query')f.queries.current.push(f.queries.current[0]);
    if(mutation==='missing-query')f.queries.current=[];
    if(mutation==='forged-value')f.expected.current={status:'available',teams:[]}as unknown as typeof f.expected.current;
    const receipt=mutation==='wrong-receipt'?id(999):id(5);
    await expect(replayFleetAncillaryQueries('standings',mapping,7,receipt,f.queries,f.expected,f.rows)).rejects.toThrow();
  });
});


import { assertFleetAncillarySchedule, fleetAncillaryHealthyEnd } from './freshness-capacity-profile';
describe('parent fixed ancillary inventory and boundaries',()=>{
  it('preserves the accepted benchmark horizon despite much earlier setup reads',()=>{
    const benchmark=3_600_000,reads=[100_000,101_000,102_000,103_000];expect(fleetAncillaryHealthyEnd(benchmark,'accepted',reads)).toBe(benchmark+122*60_000);
    expect(fleetAncillaryHealthyEnd(benchmark,'intake-a',[3_660_000,3_661_000,3_662_000,3_663_000])).toBe(3_663_000+122*60_000);
  });
  it('retains every absent/unchanged minute plus only the frozen non-minute end',()=>{
    const ends=[{leagueKey:'league-01',endAt:122_001}],rows=[0,60_000,120_000,122_001].map(scheduledAt=>({leagueKey:'league-01',scheduledAt}));
    expect(()=>assertFleetAncillarySchedule(0,ends,rows,true)).not.toThrow();
    for(const mutated of [rows.filter(row=>row.scheduledAt!==60_000),[...rows,rows[1]],[...rows,{leagueKey:'league-01',scheduledAt:122_002}]])expect(()=>assertFleetAncillarySchedule(0,ends,mutated,true)).toThrow();
    expect(()=>assertFleetAncillarySchedule(0,ends,rows.slice(0,-1),false)).not.toThrow();
  });
  it('does not credit a legitimate post-end receipt, and requires the earlier tail independently',()=>{
    const end=1_800_000,row=(n:number,at:number,confirmed=at)=>({receiptId:String(n),attemptId:String(n),sourceAt:at,acceptedAt:at,committedAt:at,confirmedAt:confirmed});
    const prior=[row(1,0),row(2,900_000),row(3,end-100)];const post=row(4,end+1,end+2);
    expect(assertFleetAncillaryChain(0,end,[...prior,post],{requirePrior:true}).distinctCaptures).toBe(3);
    expect(()=>assertFleetAncillaryChain(0,end+1,[row(1,0),row(2,900_000),row(4,end+2,end+3)],{requirePrior:true})).toThrow('trailing');
  });
});

describe('ancillary skip hints preserve prior current confirmation',()=>{
  it('allows only the exact previously confirmed head fingerprint',async()=>{
    const{fleetAncillaryHeadTransition:next}=await import('./freshness-capacity-profile');
    expect(next(null,{rowsRef:'a',unchanged:false,unavailable:false,confirmed:true})).toBe('a');
    expect(next('a',{rowsRef:'a',unchanged:true,unavailable:false,confirmed:false})).toBe('a');
    expect(next('a',{rowsRef:'b',unchanged:false,unavailable:true,confirmed:false})).toBe('a');
    for(const row of[{rowsRef:'b',unchanged:true,unavailable:false,confirmed:false},{rowsRef:'a',unchanged:true,unavailable:true,confirmed:false},{rowsRef:'a',unchanged:true,unavailable:false,confirmed:true}])expect(()=>next('a',row)).toThrow();
    expect(()=>next(null,{rowsRef:'a',unchanged:true,unavailable:false,confirmed:false})).toThrow();
  });
});

describe('bounded lossless ancillary body decoding',()=>{
  async function fixture(){const{deflateRawSync}=await import('node:zlib');const{capacityDigest}=await import('./freshness-capacity-manifest');const{decodeFleetAncillaryBodies,FLEET_ANCILLARY_DECODE_LIMITS}=await import('./freshness-capacity-profile');
    const encode=(value:unknown,raw=Buffer.from(JSON.stringify(value)))=>({id:capacityDigest(value),encoding:'deflate-json-v1',decodedBytes:raw.length,decodedSha256:createHash('sha256').update(raw).digest('hex'),data:deflateRawSync(raw).toString('base64')});
    return{encode,decode:decodeFleetAncillaryBodies,limits:FLEET_ANCILLARY_DECODE_LIMITS};}
  it('preserves every raw query value and complete proof body under the original IDs',async()=>{const{encode,decode}=await fixture();const query=[{a:'native',n:20}],proof={leagueKey:'league-01',current:{status:'available'},queries:{current:[]}};const q=encode(query),p=encode(proof),result=decode([q],[p]);expect(result.queryRows.get(q.id)).toEqual(query);expect(result.proofRows).toEqual([{id:p.id,...proof}]);expect(result.decodedBytes).toBe(q.decodedBytes+p.decodedBytes);});
  for(const mutation of ['encoding','id','hash','bytes','base64','trailing','truncated','extra-key','duplicate-query','duplicate-proof','noncanonical-json','invalid-utf8','body-limit','aggregate-limit','inflate-limit']as const)it('rejects '+mutation,async()=>{const{encode,decode,limits}=await fixture();const q=encode([{native:'kept'}]),p=encode({proof:'kept'});let queries:unknown[]=[q],proofs:unknown[]=[p];switch(mutation){
    case'encoding':q.encoding='other';break;case'id':q.id='a'.repeat(64);break;case'hash':q.decodedSha256='b'.repeat(64);break;case'bytes':q.decodedBytes++;break;
    case'base64':q.data+=String.fromCharCode(10);break;case'trailing':q.data=Buffer.concat([Buffer.from(q.data,'base64'),Buffer.from([0])]).toString('base64');break;case'truncated':q.data=Buffer.from(q.data,'base64').subarray(0,-1).toString('base64');break;
    case'extra-key':queries=[{...q,ignored:true}];break;case'duplicate-query':queries=[q,q];break;case'duplicate-proof':proofs=[p,p];break;
    case'noncanonical-json':queries=[encode([{native:'kept'}],Buffer.from('[ {"native":"kept"} ]'))];break;case'invalid-utf8':queries=[encode([],Buffer.from([0x5b,0x22,0xff,0x22,0x5d]))];break;
    case'body-limit':q.decodedBytes=limits.bodyBytes+1;break;case'aggregate-limit':queries=Array.from({length:129},(_,i)=>({...q,id:i.toString(16).padStart(64,'0'),decodedBytes:limits.bodyBytes}));break;case'inflate-limit':q.decodedBytes=1;break;
  }expect(()=>decode(queries,proofs)).toThrow();});
});

describe('new-fleet compressed document boundaries',()=>{
  const all=()=>FLEET_EVIDENCE_STREAMS.flatMap(stream=>fleetDocumentRows(stream,{actual:stream}));
  for(const mutation of ['kind','extra-key','rawpart-size','part-hash','noncanonical-base64','trailing','truncated','inflate-bound','invalid-utf8','noncanonical-json']as const)it('rejects '+mutation,async()=>{
    const{deflateRawSync}=await import('node:zlib');const rows=all(),part=rows[0].value as Record<string,unknown>;
    const replacement=(bytes:Buffer)=>{part.partBytes=bytes.length;part.documentBytes=bytes.length;part.partSha256=createHash('sha256').update(bytes).digest('hex');part.documentSha256=part.partSha256;part.bytesBase64=deflateRawSync(bytes).toString('base64');};
    switch(mutation){case'kind':part.kind='cp26-json-document-part-v1';break;case'extra-key':part.omitted=true;break;case'rawpart-size':part.partBytes=1024*1024+1;break;case'part-hash':part.partSha256='0'.repeat(64);break;
      case'noncanonical-base64':part.bytesBase64=String(part.bytesBase64)+String.fromCharCode(10);break;case'trailing':part.bytesBase64=Buffer.concat([Buffer.from(String(part.bytesBase64),'base64'),Buffer.from([0])]).toString('base64');break;case'truncated':part.bytesBase64=Buffer.from(String(part.bytesBase64),'base64').subarray(0,-1).toString('base64');break;
      case'inflate-bound':part.partBytes=1;part.documentBytes=1;break;case'invalid-utf8':replacement(Buffer.from([0x22,0xff,0x22]));break;case'noncanonical-json':replacement(Buffer.from('{ "actual":true }'));break;
    }expect(()=>reassembleFleetDocuments(rows)).toThrow();
  });
  it('rejects the aggregate declared decoded allocation before inflating any document',async()=>{
    const{FLEET_DOCUMENT_LIMITS}=await import('./freshness-capacity-profile');const rows=all(),index=rows.findIndex(row=>row.stream==='capacity-evidence'),part=rows[index].value as Record<string,unknown>;
    const parts=Array.from({length:512},(_,i)=>({stream:'capacity-evidence' as const,sequence:i+1,value:{...part,index:i,parts:512,documentBytes:FLEET_DOCUMENT_LIMITS.totalDecodedBytes,partBytes:FLEET_DOCUMENT_LIMITS.partBytes}}));rows.splice(index,1,...parts);
    expect(()=>reassembleFleetDocuments(rows)).toThrow('aggregate decoded document size exceeded');
  });
});

describe('pending ancillary anchor journal',()=>{
  async function fixture(){const{capacityDigest:digest}=await import('./freshness-capacity-manifest');const{assertFleetAncillaryAnchorJournal:check}=await import('./freshness-capacity-profile');const epoch=Date.parse('2026-10-17T00:00:00.000Z'),record={receipt:{id:'receipt',provenance:{requestCompletedAt:new Date(epoch-10).toISOString()}},acceptance:{accepted_at:'2026-10-17T00:00:00.000Z'},dispatch:{intake_id:'request'},outcome:{outcome:'checkpoint-committed',generation:1}};const pending={...record,outcome:null},span=(at:number)=>({startedAt:epoch+at,endedAt:epoch+at+1,monotonicStartedAt:at,monotonicEndedAt:at+1}),query=(rows:unknown,at:number)=>({sql:'exact frozen SQL',params:['request','native','winners_bracket'],rowsRef:digest(rows),span:span(at)}),first=query([pending],1),last=query([record],3),anchor={requestId:'request',receiptId:'receipt',query:last};const entry=(query:unknown,status:string)=>({operation:'anchor',span:(query as typeof last).span,outcome:{status,receiptId:'receipt',requestId:'request',acceptedAt:record.acceptance.accepted_at,query}});return{check,anchor,rows:new Map<string,unknown>([[digest([pending]),[pending]],[digest([record]),[record]]]),journal:[entry(first,'pending-checkpoint'),entry(last,'checkpoint-committed')]};}
  it('retains pending then exact committed earliest receipt',async()=>{const f=await fixture();expect(()=>f.check(f.anchor,'anchor',f.journal,f.rows)).not.toThrow();});
  for(const mutation of['receipt','time','request','query','span','missing-final','false-pending','pending-before-acceptance']as const)it('rejects '+mutation,async()=>{const f=await fixture();if(mutation==='receipt')f.journal[0].outcome.receiptId='later';if(mutation==='time')f.journal[0].outcome.acceptedAt='2026-10-17T00:01:00.000Z';if(mutation==='request')f.journal[0].outcome.requestId='other';if(mutation==='query')(f.journal[0].outcome.query as {sql:string}).sql='different';if(mutation==='span')f.journal[0].span={...f.journal[0].span,endedAt:9};if(mutation==='missing-final')f.journal.pop();if(mutation==='false-pending')f.journal[1].outcome.status='pending-checkpoint';if(mutation==='pending-before-acceptance'){f.journal[0].span.startedAt-=2000;f.journal[0].span.endedAt-=2000;}expect(()=>f.check(f.anchor,'anchor',f.journal,f.rows)).toThrow();});
});


describe('closed daily fixed window and producer envelope',()=>{
  it('retains 25 hours only when the original supervisor leaves 25 hours 30 minutes',async()=>{
    const {fleetDailyWindow}=await import('./freshness-capacity-profile'),start=1_000_000;
    await expect(fleetDailyWindow(start,start+25.5*60*60_000)).resolves.toEqual({invocationStartedAt:start,observationEndsAt:start+25*60*60_000,workDeadlineAt:start+25.5*60*60_000});
    await expect(fleetDailyWindow(start,start+25.5*60*60_000-1)).rejects.toThrow('Insufficient');
    await expect(fleetDailyWindow(start,start+26*60*60_000+1)).rejects.toThrow('rebased');
  });
  async function daily(){const {value,binding}=companionEnvelope(),{FLEET_DAILY_PROFILE,FLEET_DAILY_TESTS}=await import('./freshness-capacity-profile');binding.context.profile=FLEET_DAILY_PROFILE;value.kind='cp26-fleet-daily-evidence-v1';value.config.profile=FLEET_DAILY_PROFILE;value.config.workDeadlineAt=Date.parse(value.ready.backendStart)+26*60*60_000;value.ready.profile=FLEET_DAILY_PROFILE;value.ready.workDeadlineAt=value.config.workDeadlineAt;
    for(const call of value.calls){call.profile=FLEET_DAILY_PROFILE;call.workDeadlineAt=value.config.workDeadlineAt;if(call.action==='run-healthy')call.action='run-daily';}value.contextDigest=createHash('sha256').update(JSON.stringify(binding.context)).digest('hex');
    const start=Date.parse(value.ready.backendStart),span=(a:number,b:number)=>({startedAt:new Date(start+a).toISOString(),endedAt:new Date(start+b).toISOString(),monotonicStartMs:a,monotonicEndMs:b});value.cases=FLEET_DAILY_TESTS.map((name,i)=>({name,state:'passed',span:[span(2,52),span(53,54),span(55,70)][i]}));return{value,binding};}
  it('accepts the exact daily case-zero sequence but no claimed duration from the envelope alone',async()=>{const{value,binding}=await daily();await expect(assertFleetCompanionEnvelope(value,binding)).resolves.toEqual(value);await expect(validateFleetCompanion(value,binding)).rejects.toThrow();});
  it.each(['command','case','source-lane','deadline'] as const)('rejects daily %s drift',async fault=>{const{value,binding}=await daily();if(fault==='command')value.calls[3].action='run-recovery';if(fault==='case')value.cases[0].span.endedAt=value.calls[1].span.endedAt;if(fault==='source-lane')value.kind='cp26-fleet-recovery-evidence-v1';if(fault==='deadline')value.calls[4].span.endedAt=new Date(value.config.workDeadlineAt+1).toISOString();await expect(assertFleetCompanionEnvelope(value,binding)).rejects.toThrow();});
});


describe('daily lossless source references',()=>{
  async function fixture(){const{packCapacityDailyResponses}=await import('./freshness-capacity-transport'),body='{"native":true}',sha=createHash('sha256').update(body).digest('hex');const response={attemptId:'actual-attempt-1',endpointId:'actual-endpoint',resource:'rosters' as const,nativeLeagueId:'123',nativeWeek:null,pairIds:[],version:'v0',rawUtf8:body,rawSha256:sha,requestStartedAt:1,responseCompletedAt:2,monotonicStartedAt:1,monotonicCompletedAt:2,responseBoundary:'full-synthetic-bytes-available' as const};const rows=FLEET_REQUEST_OWNERS.map((owner,index)=>({owner,responses:index===0?[response,{...response,attemptId:'actual-attempt-2',requestStartedAt:3,responseCompletedAt:4}]:[]}));return{rows,packed:structuredClone(packCapacityDailyResponses(rows))};}
  it('reconstructs every distinct physical response while sharing exact bytes',async()=>{const{rows,packed}=await fixture(),{unpackFleetDailyResponses}=await import('./freshness-capacity-profile');expect(packed.bodies).toHaveLength(1);expect(unpackFleetDailyResponses(packed)).toEqual(rows);});
  it.each(['missing','extra','duplicate-body','hash','length','foreign-owner','duplicate-attempt','reference','inline-bytes'] as const)('rejects daily pool %s drift',async fault=>{const{packed}=await fixture(),{unpackFleetDailyResponses}=await import('./freshness-capacity-profile');if(fault==='missing')packed.bodies=[];if(fault==='extra')packed.bodies.push({sha256:createHash('sha256').update('unused').digest('hex'),utf8:'unused',byteLength:6});if(fault==='duplicate-body')packed.bodies.push(packed.bodies[0]);if(fault==='hash')packed.bodies[0].utf8='changed';if(fault==='length')packed.bodies[0].byteLength++;if(fault==='foreign-owner')packed.owners[0].owner='unknown';if(fault==='duplicate-attempt')packed.owners[0].responses[1].attemptId=packed.owners[0].responses[0].attemptId;if(fault==='reference')packed.owners[0].responses[0].bodyRef='a'.repeat(64);if(fault==='inline-bytes')Object.assign(packed.owners[0].responses[0],{rawUtf8:'spoof'});expect(()=>unpackFleetDailyResponses(packed)).toThrow();});
  it('binds identical secondary bytes to their actual separate native routes',async()=>{const{unpackFleetDailySecondaryResponses}=await import('./freshness-capacity-profile'),utf8='[]',sha256=createHash('sha256').update(utf8).digest('hex'),documents=[{url:'https://api.sleeper.app/a',utf8,sha256},{url:'https://api.sleeper.app/b',utf8,sha256}],primary={fixture:{documents},tankAttempts:[],secondaryResponses:[{attemptId:'b',documentRef:sha256}]},attempts=new Map([['b',{origin:'https://api.sleeper.app',path:'/b'}]]);expect(unpackFleetDailySecondaryResponses(primary,attempts)[0].document).toEqual(documents[1]);expect(()=>unpackFleetDailySecondaryResponses(primary,new Map())).toThrow('unbound');});
});
describe('daily source-success and immutable sparse boundaries',()=>{
  it('accepts genuine twenty-hour refreshes and rejects a late confirmation or renewed old receipt',async()=>{const{assertFleetDailyChain}=await import('./freshness-capacity-profile'),start=1_000_000,hour=60*60_000,end=start+25*hour;const first={receiptId:'a',attemptId:'a',sourceAt:start,acceptedAt:start,committedAt:start,confirmedAt:start},second={receiptId:'b',attemptId:'b',sourceAt:start+20*hour,acceptedAt:start+20*hour,committedAt:start+20*hour,confirmedAt:start+20*hour};expect(assertFleetDailyChain(start,end,[first,second])).toMatchObject({maximumGapMs:20*hour,tailMs:5*hour});expect(()=>assertFleetDailyChain(start,end,[first,{...second,confirmedAt:start+24*hour+1}])).toThrow('twenty-four');expect(()=>assertFleetDailyChain(start,end,[first,{...first,confirmedAt:start+24*hour}])).toThrow('trailing');expect(assertFleetDailyChain(start,end,[first,second,{receiptId:'c',attemptId:'c',sourceAt:end+1,acceptedAt:end+1,committedAt:end+1,confirmedAt:end+1}]).tailMs).toBe(5*hour);});
  it('requires every declared completion scope and fixed boundary without inventing minute samples',async()=>{const{assertFleetDailyAncillarySchedule}=await import('./freshness-capacity-profile'),manifest={boundaryOffsets:[100],leagues:[{key:'a'},{key:'b'}],initialRequests:[{cohort:'accepted',leagueKeys:['a','b']}]},evidence={startedAt:1000,intakes:[{cohort:'accepted',completedAt:1010}],boundaries:[{scheduledAt:1100,proofIds:['a1','a2','a3','a4','b1','b2','b3','b4']}]},rows=[...['a','b'].map(leagueKey=>({leagueKey,scheduledAt:1010})),...['a','b'].map(leagueKey=>({leagueKey,scheduledAt:1100,components:{one:leagueKey+'1',two:leagueKey+'2',three:leagueKey+'3',four:leagueKey+'4'}}))];const check=(selected:Record<string,unknown>[])=>assertFleetDailyAncillarySchedule(manifest as unknown as import('./freshness-capacity-daily').CapacityDailyManifest,evidence as unknown as import('./freshness-capacity-daily').CapacityDailyEvidence,selected);expect(()=>check(rows)).not.toThrow();expect(()=>check(rows.slice(1))).toThrow('incomplete');expect(()=>check([...rows,rows[0]])).toThrow('duplicate');expect(()=>check([...rows,{leagueKey:'a',scheduledAt:1050}])).toThrow('incomplete');});
  it('replays exact bounded catalog metadata instead of trusting eligibility labels',async()=>{const{replayFleetDailyCatalogTurn}=await import('./freshness-capacity-profile'),{PLAYER_DIRECTORY_READ_SQL}=await import('../lib/league-administration/neon/player-directory'),span={startedAt:1000,endedAt:1001,monotonicStartedAt:0,monotonicEndedAt:1};const turn={ordinal:0,scheduledAt:1000,startedAt:1000,endedAt:1010,state:'invoked' as const,read:{value:{status:'missing',latestAttempt:null},queries:[{sql:PLAYER_DIRECTORY_READ_SQL,params:[null,null,null,2],rows:[],span}]},lastAttemptId:null,retryAt:null,attemptIds:[],catalogChoices:[],invocationOutcome:null,invocationFailed:false};await expect(replayFleetDailyCatalogTurn(turn)).resolves.toEqual({status:'missing',latestAttempt:null});await expect(replayFleetDailyCatalogTurn({...turn,retryAt:1000})).rejects.toThrow();await expect(replayFleetDailyCatalogTurn({...turn,read:{...turn.read,value:{status:'missing',latestAttempt:'label'}}})).rejects.toThrow('typed');});
});

describe('daily actual terminal record binding',()=>{
 async function fixture(){const{CAPACITY_DAILY_INTAKE_SQL}=await import('./freshness-capacity-observer'),{capacityDigest}=await import('./freshness-capacity-manifest');const start=Date.parse('2026-10-17T00:00:00Z'),id='00000000-0000-4000-8000-000000000001';const request={id,terminal:true,revision:21,created_at:new Date(start).toISOString()},proof={requestId:id,terminalRevision:21,terminal:true},intake={requestId:id,createdAt:start,targetId:null,cycle:null,dueAt:null,completedAt:start+10,proof};const span=(a:number,b:number)=>({startedAt:start+a,endedAt:start+b,monotonicStartedAt:a,monotonicEndedAt:b});const ops=[{operation:'daily-intake-binding/'+id,span:span(1,9),outcome:{request,cycle:null,querySha256:createHash('sha256').update(CAPACITY_DAILY_INTAKE_SQL).digest('hex'),params:[id]}},{operation:'daily-intake/'+id,span:span(1,11),outcome:{requestId:id,completedAt:intake.completedAt,proofDigest:capacityDigest(proof)}}];return{request,intake,ops,end:start+20};}
 it('binds the actual original SQL request and completed proof without requiring current aggregate availability',async()=>{const f=await fixture(),{assertFleetDailyIntakeRecord}=await import('./freshness-capacity-profile');await expect(assertFleetDailyIntakeRecord(f.intake as unknown as import('./freshness-capacity-daily').DailyIntakeEvidence,f.request,null,f.ops,f.end)).resolves.toBeUndefined();});
 it.each(['terminal','revision','request','query','params','proof','future','binding-span','duplicate']as const)('rejects %s completion forgery',async fault=>{const f=await fixture(),{assertFleetDailyIntakeRecord}=await import('./freshness-capacity-profile');if(fault==='terminal')f.request.terminal=false;if(fault==='revision')f.request.revision++;if(fault==='request')f.intake.proof.requestId='different';if(fault==='query')f.ops[0].outcome.querySha256='a'.repeat(64);if(fault==='params')f.ops[0].outcome.params=['different'];if(fault==='proof')f.ops[1].outcome.proofDigest='b'.repeat(64);if(fault==='future')f.end=f.intake.completedAt-1;if(fault==='binding-span')f.ops[0].span.endedAt=f.intake.completedAt+1;if(fault==='duplicate')f.ops.push(f.ops[0]);await expect(assertFleetDailyIntakeRecord(f.intake as unknown as import('./freshness-capacity-daily').DailyIntakeEvidence,f.request,null,f.ops,f.end)).rejects.toThrow();});
});

describe('auxiliary complete disposition inventory',()=>{
 async function fixture(){const ids=Array.from({length:21},(_,i)=>String(i+1)),admitted=ids[0],resources=['catalog','detail','draft-trades','league-trades','selections'];const tasks=[...resources.map((resource,i)=>({ordinal:i+1,externalLeagueId:admitted,resource,collection:'complete',draftReceiptId:'receipt-'+i})),...ids.slice(1,20).flatMap((id,index)=>['catalog','league-trades'].map((resource,i)=>({ordinal:100+index*2+i,externalLeagueId:id,resource,collection:'unavailable',reason:'bootstrap-capacity',draftReceiptId:null})))];return{planned:{nativeLeagueIds:ids,admittedNativeLeagueId:admitted} as import('./freshness-capacity-daily').CapacityDailyAuxiliary,aggregate:{draftPicks:{policy:'sleeper-2026-draft-picks-v1',collection:'partial',summary:{observedLeagues:21,admittedLeagues:20,capacityLeagues:1,materializedResources:43,pendingResources:0,acquiredResources:5,unavailableResources:38,undiscoveredDraftLeagues:19},tasks}}};}
 it('keeps all43 dispositions while requiring only the five actually acquired receipts',async()=>{const f=await fixture(),{assertFleetAuxiliaryDraftInventory}=await import('./freshness-capacity-profile');expect(()=>assertFleetAuxiliaryDraftInventory(f.aggregate,f.planned)).not.toThrow();});
 it.each(['missing-task','false-complete','21st-fanout','changed-summary','missing-receipt','wrong-reason']as const)('rejects %s in auxiliary aggregate',async fault=>{const f=await fixture(),{assertFleetAuxiliaryDraftInventory}=await import('./freshness-capacity-profile'),inventory=f.aggregate.draftPicks;if(fault==='missing-task')inventory.tasks.pop();if(fault==='false-complete')inventory.tasks[5].collection='complete';if(fault==='21st-fanout')inventory.tasks[5].externalLeagueId=f.planned.nativeLeagueIds[20];if(fault==='changed-summary')inventory.summary.acquiredResources++;if(fault==='missing-receipt')inventory.tasks[0].draftReceiptId=null;if(fault==='wrong-reason')Object.assign(inventory.tasks[5],{reason:'unexplained'});expect(()=>assertFleetAuxiliaryDraftInventory(f.aggregate,f.planned)).toThrow();});
});


describe('daily actual empty origin',()=>{
 async function fixture(){const{CAPACITY_DAILY_EMPTY_SQL}=await import('./freshness-capacity-observer');return{sql:CAPACITY_DAILY_EMPTY_SQL,params:[],rows:[{requests:0,dispatches:0,targets:0,cycles:0,catalog_attempts:0}],span:{startedAt:1001,endedAt:1002,monotonicStartedAt:1,monotonicEndedAt:2}};}
 it('binds the actual empty state before the first submission and retains setup traffic',async()=>{const{assertFleetDailyEmptyOrigin}=await import('./freshness-capacity-profile');await expect(assertFleetDailyEmptyOrigin(await fixture(),1000,1003,999,[{at:1004,endedAt:1005}])).resolves.toBeUndefined();});
 it.each(['sql','params','nonempty','after-submission','before-setup','late-coverage','lost-prefix']as const)('rejects %s',async fault=>{const{assertFleetDailyEmptyOrigin}=await import('./freshness-capacity-profile'),f=await fixture();let coverage=999;const attempts=[{at:1004,endedAt:1005}];if(fault==='sql')f.sql+='changed';if(fault==='params')(f.params as unknown[]).push('other');if(fault==='nonempty')f.rows[0].dispatches=1;if(fault==='after-submission')f.span.endedAt=1004;if(fault==='before-setup')f.span.startedAt=999;if(fault==='late-coverage')coverage=1001;if(fault==='lost-prefix')attempts[0].at=998;await expect(assertFleetDailyEmptyOrigin(f,1000,1003,coverage,attempts)).rejects.toThrow();});
});


describe('daily closed actual catalog choice',()=>{
 async function fixture(mode:'busy'|'backoff'|'reserved'='reserved'){
  const{CAPACITY_DAILY_CATALOG_CLAIM_SQL:claimSql,CAPACITY_DAILY_CATALOG_RESERVE_SQL:reserveSql}=await import('./freshness-capacity-observer');const start=Date.parse('2026-10-17T00:00:00Z'),worker='00000000-0000-4000-8000-000000000001',id='00000000-0000-4000-8000-000000000002';const span=(a:number,b:number)=>({startedAt:start+a,endedAt:start+b,monotonicStartedAt:a,monotonicEndedAt:b});
  const claim={kind:'claim' as const,querySha256:createHash('sha256').update(claimSql).digest('hex'),params:['league-administration-public-intake','league-administration-public-intake',new Date(start).toISOString(),JSON.stringify({policy:'public-player-directory-v1',mode:'player-directory'}),worker,'25','60'],response:{fields:['attempt_count','lease_until'],rows:mode==='busy'?[]:[[3,new Date(start+25000).toISOString()]]},span:span(2,3),status:'success' as const};
  const result=mode==='backoff'?{status:'backoff',retryAt:new Date(start+60000).toISOString()}:{status:'reserved',attempt:{id,nonce:'00000000-0000-4000-8000-000000000003',ordinal:1,expectedGeneration:0,reservedAt:new Date(start+4).toISOString()}};
  const reserve={kind:'reserve' as const,querySha256:createHash('sha256').update(reserveSql).digest('hex'),params:[id,JSON.stringify({jobKey:'league-administration-public-intake',workerId:worker,generation:3,deadlineAt:new Date(start+20000).toISOString()})],response:{fields:['result'],rows:[[JSON.stringify(result)]]},span:span(4,5),status:'success' as const};
  const turn={ordinal:0,scheduledAt:start,startedAt:start,endedAt:start+20,state:'invoked' as const,read:null,invocationOutcome:{done:true},invocationFailed:false,lastAttemptId:null,retryAt:null,attemptIds:mode==='reserved'?['http']:[],catalogChoices:mode==='busy'?[claim]:[claim,reserve]};
  const invocation={owner:'data-refresh',span:span(0,19),outcome:turn.invocationOutcome,failed:false},sql=turn.catalogChoices.map((row,index)=>({sequence:index+1,querySha256:row.querySha256,outcome:'success',signal:true,span:{startedAt:new Date(row.span.startedAt).toISOString(),endedAt:new Date(row.span.endedAt).toISOString(),monotonicStartMs:row.span.monotonicStartedAt,monotonicEndMs:row.span.monotonicEndedAt}}));
  const attempts=new Map([['http',{id:'http',owner:'data-refresh',method:'GET',origin:'https://api.sleeper.app',path:'/v1/players/nfl',at:start+6,endedAt:start+7,outcome:'success'}]]);return{turn,invocation,sql,attempts};
 }
 it.each(['busy','backoff','reserved']as const)('independently binds actual %s SQL without treating primary as DATA success',async mode=>{const{assertFleetDailyCatalogChoices}=await import('./freshness-capacity-profile'),f=await fixture(mode);expect((await assertFleetDailyCatalogChoices(f.turn,f.invocation,f.sql,f.attempts)).status).toBe(mode==='busy'?'claim-busy':mode==='backoff'?'reservation-backoff':'reserved');});
 it('allows the actual persisted guard to become due within the same original turn',async()=>{const{assertFleetDailyCatalogChoices}=await import('./freshness-capacity-profile'),f=await fixture();Object.assign(f.turn,{retryAt:f.turn.startedAt+2});await expect(assertFleetDailyCatalogChoices(f.turn,f.invocation,f.sql,f.attempts)).resolves.toMatchObject({status:'reserved'});Object.assign(f.turn,{retryAt:f.turn.startedAt+3});await expect(assertFleetDailyCatalogChoices(f.turn,f.invocation,f.sql,f.attempts)).rejects.toThrow('persisted eligibility');});
 it.each(['unknown-ack','sql-hash','physical-span','worker','generation','renewed-deadline','wrong-mode','missing-get','early-get','false-primary','duplicate-sql']as const)('rejects %s',async fault=>{const{assertFleetDailyCatalogChoices}=await import('./freshness-capacity-profile'),f=await fixture();const choices=f.turn.catalogChoices;if(fault==='unknown-ack')Object.assign(choices[0],{status:'unclassified'});if(fault==='sql-hash')choices[0].querySha256='a'.repeat(64);if(fault==='physical-span')f.sql[0].span.endedAt=new Date(Date.parse(f.sql[0].span.endedAt)-1).toISOString();if(['worker','generation','renewed-deadline'].includes(fault)){const fence=JSON.parse(String(choices[1].params[1]));if(fault==='worker')fence.workerId='00000000-0000-4000-8000-000000000099';if(fault==='generation')fence.generation++;if(fault==='renewed-deadline')fence.deadlineAt=new Date(Date.parse(fence.deadlineAt)+1).toISOString();choices[1].params[1]=JSON.stringify(fence);}if(fault==='wrong-mode')choices[0].params[3]=JSON.stringify({policy:'public-data-refresh-v1',mode:'recurring'});if(fault==='missing-get')f.turn.attemptIds=[];if(fault==='early-get')f.attempts.get('http')!.at-=10;if(fault==='false-primary')f.invocation.failed=true;if(fault==='duplicate-sql')f.sql.push(f.sql[0]);await expect(assertFleetDailyCatalogChoices(f.turn,f.invocation,f.sql,f.attempts)).rejects.toThrow();});
});


describe('auxiliary maintained retained roster mapping',()=>{
 it('uses the actual nested mapping and exact original receipt',async()=>{const{assertFleetAuxiliaryRetainedRosterIdentity}=await import('./freshness-capacity-profile'),mapping={leagueSeasonId:'season'},row={status:'available',rosterReceiptId:'receipt',mapping};expect(()=>assertFleetAuxiliaryRetainedRosterIdentity(row,mapping,'receipt')).not.toThrow();expect(()=>assertFleetAuxiliaryRetainedRosterIdentity({...row,mapping:{leagueSeasonId:'other'}},mapping,'receipt')).toThrow();expect(()=>assertFleetAuxiliaryRetainedRosterIdentity({...row,rosterReceiptId:'other'},mapping,'receipt')).toThrow();expect(()=>assertFleetAuxiliaryRetainedRosterIdentity({status:'available',rosterReceiptId:'receipt',leagueSeasonId:'season'},mapping,'receipt')).toThrow();});
});


describe('daily lossless physical SQL ledger',()=>{
 function attempts(){return[{sequence:2,span:{startedAt:'2026-10-17T00:00:00.002Z',endedAt:'2026-10-17T00:00:00.003Z',monotonicStartMs:1.123456,monotonicEndMs:2.123457},querySha256:'a'.repeat(64),outcome:'success' as const,signal:false},{sequence:1,span:{startedAt:'2026-10-17T00:00:00.000Z',endedAt:'2026-10-17T00:00:00.004Z',monotonicStartMs:0,monotonicEndMs:3.23456789},querySha256:'b'.repeat(64),outcome:'failed' as const,signal:true},{sequence:3,span:{startedAt:'2026-10-17T00:00:00.005Z',endedAt:'2026-10-17T00:00:00.006Z',monotonicStartMs:4.1,monotonicEndMs:5.2},querySha256:'a'.repeat(64),outcome:'success' as const,signal:true}];}
 it('roundtrips exact ISO clocks, fractional monotonic values, failed rows and completion order',async()=>{const{packFleetDailySqlAttempts:pack,unpackFleetDailySqlAttempts:unpack}=await import('./freshness-capacity-profile'),original=attempts(),wire=pack(original);expect(wire.queryDigests).toEqual(['a'.repeat(64),'b'.repeat(64)]);expect(wire.rows.map(row=>row[0])).toEqual([2,1,3]);expect(unpack(JSON.parse(JSON.stringify(wire)))).toEqual(original);expect(unpack(pack([]))).toEqual([]);});
 it.each(['kind','extra','duplicate-digest','unused-digest','missing-digest','hash','tuple-size','index','index-fraction','outcome','signal','sequence-duplicate','sequence-gap','numeric-wall','offset-wall','backward-wall','mono-nan','mono-backward','missing-row','dictionary-order']as const)('rejects %s without partial reconstruction',async fault=>{const{packFleetDailySqlAttempts:pack,unpackFleetDailySqlAttempts:unpack}=await import('./freshness-capacity-profile'),wire=structuredClone(pack(attempts()));if(fault==='kind')Object.assign(wire,{kind:'other'});if(fault==='extra')Object.assign(wire,{unknown:true});if(fault==='duplicate-digest')wire.queryDigests[1]=wire.queryDigests[0];if(fault==='unused-digest')wire.queryDigests.push('c'.repeat(64));if(fault==='missing-digest')wire.queryDigests.pop();if(fault==='hash')wire.queryDigests[0]='bad';if(fault==='tuple-size')(wire.rows[0] as unknown[]).push(1);if(fault==='index')wire.rows[0][5]=9;if(fault==='index-fraction')wire.rows[0][5]=0.5;if(fault==='outcome')(wire.rows[0] as unknown[])[6]=false;if(fault==='signal')(wire.rows[0] as unknown[])[7]=2;if(fault==='sequence-duplicate')wire.rows[1][0]=2;if(fault==='sequence-gap')wire.rows[1][0]=4;if(fault==='numeric-wall')(wire.rows[0] as unknown[])[1]=Date.parse(wire.rows[0][1]);if(fault==='offset-wall')wire.rows[0][1]='2026-10-17T00:00:00.002+00:00';if(fault==='backward-wall')wire.rows[0][2]='2026-10-17T00:00:00.001Z';if(fault==='mono-nan')wire.rows[0][3]=NaN;if(fault==='mono-backward')wire.rows[0][4]=0;if(fault==='missing-row')wire.rows.splice(1,1);if(fault==='dictionary-order'){wire.queryDigests.reverse();for(const row of wire.rows)row[5]=1-row[5];}expect(()=>unpack(wire)).toThrow();});
 it('rejects omitted raw fields and bounds declared row count before iteration',async()=>{const{packFleetDailySqlAttempts:pack,unpackFleetDailySqlAttempts:unpack}=await import('./freshness-capacity-profile');expect(()=>pack(attempts().map(row=>({...row,secret:'not-retained'})))).toThrow();const wire={kind:'cp26-daily-sql-ledger-v1',queryDigests:[],rows:Array(FLEET_EVIDENCE_LIMITS.maxRows+1)};expect(()=>unpack(wire)).toThrow();});
});

describe('daily closed complete request document reference',()=>{
 function ledger(){return{coverageStartedAt:1000,coverageEndedAt:2000,attempts:[{id:'failed',at:1001,endedAt:1002,outcome:'failed'},{id:'success',at:1003,endedAt:1004,outcome:'success'}],ownerTotals:[{owner:'data-refresh',count:2}]};}
 it('resolves the exact complete already verified document without copying or losing failed attempts',async()=>{const{packFleetDailyRequestLedger:pack,resolveFleetDailyRequestLedger:resolve}=await import('./freshness-capacity-profile'),document=ledger();const ref=pack(document as unknown as import('./freshness-capacity-evidence').RequestAccounting);expect(Object.keys(ref).sort()).toEqual(['attemptCount','kind','sha256','stream']);expect(resolve(ref,document)).toBe(document);expect(resolve(JSON.parse(JSON.stringify(ref)),document)).toEqual(document);});
 it.each(['kind','stream','extra','inline','hash','count','count-string','count-fraction','count-negative','count-limit','missing-attempt','changed-failure','changed-coverage','changed-owner','nested-reference']as const)('rejects %s before semantic evaluation',async fault=>{const{packFleetDailyRequestLedger:pack,resolveFleetDailyRequestLedger:resolve}=await import('./freshness-capacity-profile');let document:unknown=ledger();const ref=pack(document as import('./freshness-capacity-evidence').RequestAccounting);if(fault==='kind')Object.assign(ref,{kind:'other'});if(fault==='stream')Object.assign(ref,{stream:'capacity-evidence'});if(fault==='extra')Object.assign(ref,{path:'elsewhere'});if(fault==='inline')Object.assign(ref,{attempts:ledger().attempts});if(fault==='hash')ref.sha256='f'.repeat(64);if(fault==='count')ref.attemptCount++;if(fault==='count-string')Object.assign(ref,{attemptCount:'2'});if(fault==='count-fraction')ref.attemptCount=1.5;if(fault==='count-negative')ref.attemptCount=-1;if(fault==='count-limit')ref.attemptCount=FLEET_EVIDENCE_LIMITS.maxRows+1;if(fault==='missing-attempt')(document as ReturnType<typeof ledger>).attempts.pop();if(fault==='changed-failure')(document as ReturnType<typeof ledger>).attempts[0].outcome='success';if(fault==='changed-coverage')(document as ReturnType<typeof ledger>).coverageStartedAt++;if(fault==='changed-owner')(document as ReturnType<typeof ledger>).ownerTotals[0].count++;if(fault==='nested-reference')document=ref;expect(()=>resolve(ref,document)).toThrow();});
 it('does not accept the old inline daily ledger as a reference',async()=>{const{resolveFleetDailyRequestLedger:resolve}=await import('./freshness-capacity-profile');expect(()=>resolve(ledger(),ledger())).toThrow();});
});

describe('daily closed deterministic manifest references',()=>{
 it.each(['daily-manifest','observer-manifest']as const)('reconstructs the exact source-bound %s body',async role=>{const{packFleetDailyManifestReference:pack,resolveFleetDailyManifestReference:resolve}=await import('./freshness-capacity-profile'),manifest={digest:'a'.repeat(64),source:{nativeBodies:['unchanged','changed']},clock:90000000};const ref=pack(role,manifest);expect(Object.keys(ref).sort()).toEqual(['digest','kind','role','sha256']);expect(resolve(JSON.parse(JSON.stringify(ref)),role,manifest)).toBe(manifest);});
 it.each(['kind','role','extra','inline','digest','hash','changed-body','changed-identity','wrong-expected-role','nested-reference','old-inline']as const)('rejects %s',async fault=>{const{packFleetDailyManifestReference:pack,resolveFleetDailyManifestReference:resolve}=await import('./freshness-capacity-profile'),manifest={digest:'a'.repeat(64),native:{season:2026},sourceHash:'b'.repeat(64)};let ref:unknown=pack('daily-manifest',manifest),expected:'daily-manifest'|'observer-manifest'='daily-manifest';if(fault==='kind')Object.assign(ref as object,{kind:'other'});if(fault==='role')Object.assign(ref as object,{role:'observer-manifest'});if(fault==='extra')Object.assign(ref as object,{path:'external'});if(fault==='inline')Object.assign(ref as object,{native:manifest.native});if(fault==='digest')Object.assign(ref as object,{digest:'c'.repeat(64)});if(fault==='hash')Object.assign(ref as object,{sha256:'d'.repeat(64)});if(fault==='changed-body')manifest.native.season=2025;if(fault==='changed-identity')manifest.digest='e'.repeat(64);if(fault==='wrong-expected-role')expected='observer-manifest';if(fault==='nested-reference')Object.assign(manifest,{native:ref});if(fault==='old-inline')ref=manifest;expect(()=>resolve(ref,expected,manifest)).toThrow();});
});

describe('daily qualification raw reference consumer',()=>{
 async function actualPrefix(){const ts=await import('typescript'),source=await readFile(new URL('./freshness-capacity-daily.qualification-case.ts',import.meta.url),'utf8'),file=ts.createSourceFile('daily-case.ts',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);let selected:import('typescript').CallExpression|undefined;
  function visit(node:import('typescript').Node){if(ts.isCallExpression(node)&&node.expression.getText(file)==='it'&&node.arguments[0]?.getText(file)==='FLEET_DAILY_TESTS[1]')selected=node;ts.forEachChild(node,visit);}visit(file);expect(selected).toBeDefined();const outer=selected!.arguments[1];expect(ts.isArrowFunction(outer)).toBe(true);const guarded=(outer as import('typescript').ArrowFunction).body;expect(ts.isCallExpression(guarded)).toBe(true);const callback=(guarded as import('typescript').CallExpression).arguments[1] as import('typescript').ArrowFunction;expect(ts.isBlock(callback.body)).toBe(true);const statements=(callback.body as import('typescript').Block).statements,index=statements.findIndex(node=>ts.isVariableStatement(node)&&node.declarationList.declarations.some(value=>value.name.getText(file)==='primary'));expect(index).toBeGreaterThan(0);
  const prefix=statements.slice(0,index).map(node=>node.getText(file)).join('\n'),compiled=ts.transpileModule('async function actualConsumer(){'+prefix+'}',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
  return new Function('readFleetRawEvidenceDocuments','rawInventory','rawDirectory','config','rebuilt','expect','assert','resolveFleetDailyManifestReference','resolveFleetDailyRequestLedger','evaluateCapacityDaily','capacityDigest',compiled+'; return actualConsumer();') as (...args:unknown[])=>Promise<void>;
 }
 async function fixture(){const p=await import('./freshness-capacity-profile'),{capacityDigest}=await import('./freshness-capacity-manifest'),assert=(await import('node:assert/strict')).default;const manifest={digest:'a'.repeat(64),native:{season:2026}},observerManifest={digest:'b'.repeat(64),source:{unchanged:true}},requests={coverageStartedAt:1000,coverageEndedAt:2000,attempts:[{id:'failed',outcome:'failed'}]},analysis={pass:true},rebuilt={fixture:{digest:'c'.repeat(64)},dailyManifest:manifest,observerManifest},config={fixtureDigest:rebuilt.fixture.digest,manifestDigest:manifest.digest};const raw={'transport-attempts':requests,'capacity-evidence':{manifest:p.packFleetDailyManifestReference('daily-manifest',manifest),observerManifest:p.packFleetDailyManifestReference('observer-manifest',observerManifest),evidence:{manifestDigest:manifest.digest,requests:p.packFleetDailyRequestLedger(requests as unknown as import('./freshness-capacity-evidence').RequestAccounting)},analysis}};const evaluate=vi.fn((actualManifest:unknown,actualEvidence:unknown)=>{expect(actualManifest).toBe(manifest);expect((actualEvidence as {requests:unknown}).requests).toBe(requests);return analysis;});const callback=await actualPrefix();return{raw,config,manifest,evaluate,run:()=>callback(async()=>raw,{retained:true},'verified-raw',config,rebuilt,expect,assert,p.resolveFleetDailyManifestReference,p.resolveFleetDailyRequestLedger,evaluate,capacityDigest)};
 }
 it('executes the maintained case prefix with both manifest references and exact physical ledger before evaluation',async()=>{const f=await fixture(),before=JSON.stringify(f.raw);await f.run();expect(f.evaluate).toHaveBeenCalledTimes(1);expect(JSON.stringify(f.raw)).toBe(before);});
 it.each(['manifest-role','manifest-body','observer-role','request-hash','request-count','config-fixture','config-manifest','extra-reference']as const)('rejects %s before invoking the evaluator',async fault=>{const f=await fixture(),raw=f.raw['capacity-evidence'];if(fault==='manifest-role')Object.assign(raw.manifest,{role:'observer-manifest'});if(fault==='manifest-body')f.manifest.native.season=2025;if(fault==='observer-role')Object.assign(raw.observerManifest,{role:'daily-manifest'});if(fault==='request-hash')raw.evidence.requests.sha256='d'.repeat(64);if(fault==='request-count')raw.evidence.requests.attemptCount++;if(fault==='config-fixture')f.config.fixtureDigest='e'.repeat(64);if(fault==='config-manifest')f.config.manifestDigest='f'.repeat(64);if(fault==='extra-reference')Object.assign(raw.manifest,{inline:f.manifest});await expect(f.run()).rejects.toThrow();expect(f.evaluate).not.toHaveBeenCalled();});
});
