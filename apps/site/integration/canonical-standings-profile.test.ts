import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { CANONICAL_STANDINGS_PROFILE, CANONICAL_STANDINGS_MODULE, CANONICAL_STANDINGS_TESTS,
  CANONICAL_STANDINGS_FULL_NAMES, CANONICAL_STANDINGS_PATTERN, CANONICAL_STANDINGS_CASE_TIMEOUTS_MS,
  CANONICAL_STANDINGS_BEFORE_ALL_MS, CANONICAL_STANDINGS_AFTER_ALL_MS, CANONICAL_STANDINGS_LIMITS,
  CANONICAL_STANDINGS_SUITE, CANONICAL_STANDINGS_MOCKED_REQUESTS, CANONICAL_STANDINGS_REQUIRED_ASSERTIONS,
  assertCanonicalStandingsEvidence } from './canonical-standings-profile';
import { assertCanonicalStandingsSupportSources, CANONICAL_STANDINGS_SOURCE_DIGEST,
  CANONICAL_STANDINGS_SUPPORT_SOURCES, parseQualificationArguments, qualificationArguments, qualificationSourceDigest,
  qualificationDigest, validateQualificationReport, type QualificationContext, type QualificationReport } from './qualification-profile';
import { STANDINGS_FIXTURES, fixtureById, fixtureJobPayload, fixtureRegistration,
  fixtureRegistrationDigest, fixtureNativeDigest, fixtureJsonbDigest, projectFixtureStandings,
  fixtureStandingsCoverage, buildFixtureStandingsDelivery, resolveFixtureStandingsPolicy } from './canonical-standings-fixtures';
import { assertCanonicalDelivery, canonicalInstantMicros } from '../lib/league-administration/canonical-standings-contracts';
import type { CanonicalSourceMappingV1 } from '../lib/league-administration/canonical-source-contracts';

describe('canonical standings qualification source contract', () => {
  it('selects only the closed thirteen-case profile and retains the reviewed total time budget', () => {
    expect(parseQualificationArguments(['--profile=' + CANONICAL_STANDINGS_PROFILE])).toBe(CANONICAL_STANDINGS_PROFILE);
    expect(qualificationArguments(CANONICAL_STANDINGS_PROFILE,'/reporter')).toEqual(['--reporter','verbose','--reporter','/reporter',
      '--configLoader','runner',CANONICAL_STANDINGS_MODULE,'--testNamePattern',CANONICAL_STANDINGS_PATTERN]);
    expect(CANONICAL_STANDINGS_TESTS).toHaveLength(13);
    expect(new Set(CANONICAL_STANDINGS_FULL_NAMES).size).toBe(13);
    expect(CANONICAL_STANDINGS_BEFORE_ALL_MS + CANONICAL_STANDINGS_AFTER_ALL_MS
      + CANONICAL_STANDINGS_CASE_TIMEOUTS_MS.reduce((sum,value)=>sum+value,0)).toBe(1_545_000);
    expect(CANONICAL_STANDINGS_LIMITS.reservedMs).toBe(255_000);
    for(const name of CANONICAL_STANDINGS_FULL_NAMES)expect(new RegExp(CANONICAL_STANDINGS_PATTERN).test(name.replaceAll(' > ',' '))).toBe(true);
    for(const args of [['--profile='+CANONICAL_STANDINGS_PROFILE,'--retry=1'],['--profile='+CANONICAL_STANDINGS_PROFILE,'--testNamePattern=S01'],
      ['--profile=data-canonical-standings-v2']])expect(()=>parseQualificationArguments(args)).toThrow();
  });
  it('pins every new module and support source without updating a historical source oracle', async () => {
    const root=fileURLToPath(new URL('..',import.meta.url));
    await expect(assertCanonicalStandingsSupportSources(root)).resolves.toBeUndefined();
    expect(qualificationSourceDigest(await readFile(new URL('./canonical-standings.qualification-case.ts',import.meta.url),'utf8')))
      .toBe(CANONICAL_STANDINGS_SOURCE_DIGEST);
  });
  it('requires all thirteen actual report cases in order with both hooks and no retries or omissions', () => {
    const context:QualificationContext={kind:'integration-qualification-context-v1',runId:'11111111-1111-4111-8111-111111111111',
      nonce:'22222222-2222-4222-8222-222222222222',gitSha:'a'.repeat(40),profile:CANONICAL_STANDINGS_PROFILE,
      modules:[{path:CANONICAL_STANDINGS_MODULE,sourceDigest:CANONICAL_STANDINGS_SOURCE_DIGEST}],
      profileDigest:qualificationDigest({version:1,profile:CANONICAL_STANDINGS_PROFILE,module:CANONICAL_STANDINGS_MODULE,
        pattern:CANONICAL_STANDINGS_PATTERN,sourceDigest:CANONICAL_STANDINGS_SOURCE_DIGEST,inventory:CANONICAL_STANDINGS_FULL_NAMES,
        supportSources:CANONICAL_STANDINGS_SUPPORT_SOURCES,caseTimeoutsMs:CANONICAL_STANDINGS_CASE_TIMEOUTS_MS,
        beforeAllMs:CANONICAL_STANDINGS_BEFORE_ALL_MS,afterAllMs:CANONICAL_STANDINGS_AFTER_ALL_MS,limits:CANONICAL_STANDINGS_LIMITS})};
    const report=():QualificationReport=>({kind:'integration-qualification-report-v1',contextDigest:qualificationDigest(context),
      starts:1,ends:1,reason:'passed',unhandledErrors:0,specifications:[{path:CANONICAL_STANDINGS_MODULE,pattern:CANONICAL_STANDINGS_PATTERN,otherFilters:false}],
      collected:[CANONICAL_STANDINGS_MODULE],hooks:['beforeAll','afterAll'].map(name=>({key:'suite:'+name,starts:1,ends:1})),
      modules:[{path:CANONICAL_STANDINGS_MODULE,state:'passed',errors:0,suites:[{id:'suite',name:CANONICAL_STANDINGS_SUITE,mode:'run',errors:0}],
        cases:CANONICAL_STANDINGS_FULL_NAMES.map((name,index)=>({id:'case-'+index,name,state:'passed',mode:'run',expectedFailure:false,
          configuredRetries:false,configuredRepeats:0,errors:0,readyEvents:1,resultEvents:1,
          diagnostic:{retryCount:0,repeatCount:0,flaky:false,duration:1,startTime:1000+index*2}}))}]});
    expect(()=>validateQualificationReport(context,report())).not.toThrow();
    const changes:((value:QualificationReport)=>void)[]=[
      value=>{value.modules[0].cases.pop();},value=>{value.modules[0].cases.reverse();},value=>{value.hooks.pop();},
      value=>{value.hooks[0].starts=2;value.hooks[0].ends=2;},value=>{value.modules[0].cases[0].state='skipped';},
      value=>{value.modules[0].cases[0].configuredRetries=true;},value=>{value.modules[0].cases[0].diagnostic!.duration=45_001;},
      value=>{value.modules[0].cases[1].diagnostic!.startTime=0;},value=>{value.specifications[0].otherFilters=true;},
    ];
    for(const change of changes){const altered=report();change(altered);expect(()=>validateQualificationReport(context,altered)).toThrow();}
  });
  it('uses only the fixed registry and distinguishes provider and namespace despite identical bare IDs', () => {
    expect(STANDINGS_FIXTURES).toHaveLength(18);
    const sources=['alpha-complete','beta-complete','gamma-complete'].map(id=>fixtureById(id).sourceLeague);
    expect(new Set(sources.map(source=>source.nativeId)).size).toBe(1);
    expect(new Set(sources.map(source=>JSON.stringify(source))).size).toBe(3);
    expect(()=>fixtureById('arbitrary')).toThrow();
    expect(()=>fixtureJobPayload({...fixtureById('alpha-complete'),leagueKey:'unrelated'})).toThrow();
    const alias=fixtureById('alpha-remap-complete'), original=fixtureById('alpha-complete');
    expect(alias.leagueKey).toBe(original.leagueKey);
    expect(alias.sourceLeague).toEqual({...original.sourceLeague,nativeNamespace:'league:remapped'});
    expect(alias.policy.teamNamespace).toBe('squads:remapped:2026');
    expect(()=>fixtureJobPayload({...alias,leagueKey:'unrelated'})).toThrow();
    for(const fixture of STANDINGS_FIXTURES){
      expect(fixture.registrationDigest).toBe(fixtureRegistrationDigest(fixture.registrationPayload));
      expect(fixture.standingsDigest).toBe(fixtureNativeDigest(fixture.nativePayload,fixture.policy));
      expect(fixtureJobPayload(fixture)).toEqual({fixturePolicyVersion:'canonical-standings-fixture-policy-v1',policy:fixture.policy,
        sourceLeague:fixture.sourceLeague,intendedLeagueKey:fixture.leagueKey,season:2026,
        registrationDigest:fixture.registrationDigest,standingsDigest:fixture.standingsDigest});
    }
    expect(fixtureJsonbDigest({b:2,a:1})).toBe(fixtureJsonbDigest({a:1,b:2}));
    expect(fixtureJsonbDigest({value:'ABC'})).not.toBe(fixtureJsonbDigest({value:'abc'}));
  });
  it('requires bound PostgreSQL 18 simulation evidence with every case and boundary assertion and no provider requests', () => {
    const digest='a'.repeat(64), evidence=()=>({kind:'canonical-standings-qualification-evidence-v1',contextDigest:digest,
      serverVersion:'18.0 (qualification)',serverVersionNum:180000,providerSimulation:true,actualProviderRequests:0,
      mockedRequests:[...CANONICAL_STANDINGS_MOCKED_REQUESTS],originalSealedCaptures:6,nativeStepDurationsMs:Array.from({length:8},()=>100),forbiddenRequests:0,
      completed:[...CANONICAL_STANDINGS_TESTS],boundaryAssertions:[...CANONICAL_STANDINGS_REQUIRED_ASSERTIONS],cleanupComplete:true});
    expect(()=>assertCanonicalStandingsEvidence(evidence(),digest)).not.toThrow();
    for(const changed of [{contextDigest:'b'.repeat(64)},{serverVersion:'17.6'},{serverVersionNum:190000},
      {providerSimulation:false},{actualProviderRequests:1},{forbiddenRequests:1},{originalSealedCaptures:5},
      {nativeStepDurationsMs:[100]},{nativeStepDurationsMs:[20_000,...Array.from({length:7},()=>100)]},
      {nativeStepDurationsMs:[0.5,...Array.from({length:7},()=>100)]},
      {mockedRequests:CANONICAL_STANDINGS_MOCKED_REQUESTS.slice(1)},{completed:CANONICAL_STANDINGS_TESTS.slice(1)},
      {completed:[...CANONICAL_STANDINGS_TESTS].reverse()},{boundaryAssertions:CANONICAL_STANDINGS_REQUIRED_ASSERTIONS.slice(1)},
      {boundaryAssertions:[...CANONICAL_STANDINGS_REQUIRED_ASSERTIONS,CANONICAL_STANDINGS_REQUIRED_ASSERTIONS[0]]},
      {boundaryAssertions:[...CANONICAL_STANDINGS_REQUIRED_ASSERTIONS,'unreviewed-probe']},
      {cleanupComplete:false},{unknown:true}])expect(()=>assertCanonicalStandingsEvidence({...evidence(),...changed},digest)).toThrow();
  });
  it('preserves zero absent null and invalid native states without making incomplete fields complete', () => {
    const fixture=fixtureById('alpha-field-states'),facts=projectFixtureStandings(fixture),coverage=fixtureStandingsCoverage(fixture,facts);
    expect(facts.teams[0].record).toEqual({wins:{state:'absent',value:null},losses:{state:'null',value:null},ties:{state:'invalid',value:null}});
    expect(facts.teams[0].pointsFor).toEqual({state:'known',value:'0'});
    expect(facts.teams[1].pointsFor).toEqual({state:'invalid',value:null});
    expect(facts.teams[1].pointsAgainst).toEqual({state:'known',value:'-0.25'});
    expect(coverage).toMatchObject({entitySet:'full',completeness:'partial',reasons:['standings_record_fields_incomplete']});
    for(const [id,status,reason] of [['alpha-duplicate','invalid','standings_identity_invalid'],
      ['alpha-capacity','capacity','standings_team_limit_exceeded'],['alpha-decimal-capacity','capacity','standings_decimal_limit_exceeded']]){
      expect(projectFixtureStandings(fixtureById(id))).toMatchObject({status,teams:[],reasons:[reason]});
    }
  });
  it('does not convert a matching count or incomplete native page into independent population proof', () => {
    const coverage=(id:string)=>{const fixture=fixtureById(id);return fixtureStandingsCoverage(fixture,projectFixtureStandings(fixture));};
    expect(coverage('alpha-complete')).toMatchObject({entitySet:'full',completeness:'complete',reasons:[]});
    expect(coverage('alpha-matching-unproved')).toMatchObject({entitySet:'subset',pagination:'unknown',completeness:'partial',
      reasons:['standings_capture_partial','standings_population_unproved']});
    expect(coverage('alpha-unproved')).toMatchObject({entitySet:'unknown',reasons:['standings_population_unproved']});
    expect(coverage('alpha-partial')).toMatchObject({entitySet:'subset',reasons:['standings_capture_partial','standings_population_mismatch']});
  });
  it('keeps standalone Sleeper translation population unproved and preserves unusual native points', () => {
    const fixture=fixtureById('sleeper-parity'),facts=projectFixtureStandings(fixture);
    expect(facts.teams[0].pointsFor).toEqual({state:'known',value:'0'});
    expect(facts.teams[0].pointsAgainst).toEqual({state:'known',value:'100.25'});
    expect(facts.teams[1].pointsFor).toEqual({state:'known',value:'12.05'});
    expect(facts.teams[1].record.wins).toEqual({state:'absent',value:null});
    expect(fixtureStandingsCoverage(fixture,facts)).toMatchObject({entitySet:'unknown',completeness:'partial'});
  });
  it('binds exact registration and fixture acquisition and preserves source microsecond time meaning', () => {
    const fixture=fixtureById('alpha-complete');
    const mapping:CanonicalSourceMappingV1={connectionId:'11111111-1111-4111-8111-111111111111',leagueSeasonId:'22222222-2222-4222-8222-222222222222',
      revisionId:'33333333-3333-4333-8333-333333333333',generation:1,sourceNamespace:fixture.sourceNamespace,
      scope:{provider:fixture.sourceLeague.provider,leagueKey:fixture.leagueKey,externalLeagueId:fixture.sourceLeague.nativeId,
        season:2026,nativeNamespace:fixture.sourceLeague.nativeNamespace}};
    const fence={jobKey:'source-contract-only',workerId:'source-contract-worker',generation:1,deadlineAt:'2026-02-01T00:00:10.000Z'};
    const attempt={id:'44444444-4444-4444-8444-444444444444',scopeId:'55555555-5555-4555-8555-555555555555',
      ordinal:1,expectedGeneration:0,nonce:'66666666-6666-4666-8666-666666666666'};
    const registration=fixtureRegistration(fixture,fence);
    expect(registration.authorization.work).toEqual(fixtureJobPayload(fixture));
    expect(registration.authorization.registrationCapture).toMatchObject({origin:'fixture',requestStartedAt:null,requestCompletedAt:null,
      acquisition:{version:'canonical-fixture-registration-v1',jobKey:fence.jobKey,generation:1,sourceDigest:fixture.registrationDigest}});
    const delivery=buildFixtureStandingsDelivery(fixture,mapping,attempt,fence,{captureId:'77777777-7777-4777-8777-777777777777',checkedAt:'2026-02-01T00:00:00.000Z'});
    expect(()=>assertCanonicalDelivery(delivery,fixture.policy)).not.toThrow();
    expect(delivery).not.toHaveProperty('legacyInput');
    expect(delivery.provenance.sourceUpdatedAt).toBe('2026-01-01T00:00:00.000001Z');
    expect(delivery.provenance.acquisition).toMatchObject({attemptId:attempt.id,nonce:attempt.nonce,sourceDigest:fixture.standingsDigest});
    const correction=buildFixtureStandingsDelivery(fixtureById('alpha-correction'),mapping,attempt,fence,{captureId:delivery.provenance.captureId,checkedAt:delivery.provenance.checkedAt});
    expect(canonicalInstantMicros(correction.provenance.sourceUpdatedAt)-canonicalInstantMicros(delivery.provenance.sourceUpdatedAt)).toBe(1n);
    expect(()=>resolveFixtureStandingsPolicy({...mapping,sourceNamespace:'wrong'})).toThrow();
    for(const provenance of [{...delivery.provenance,requestStartedAt:delivery.provenance.checkedAt},
      {...delivery.provenance,requestCompletedAt:delivery.provenance.checkedAt}])expect(()=>assertCanonicalDelivery({...delivery,provenance},fixture.policy)).toThrow();
  });
});
