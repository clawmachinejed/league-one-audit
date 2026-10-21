import { createHash } from 'node:crypto';
import type { ObservedCoverage } from '../lib/aggregator/contracts';
import { projectOfficialStandings } from '../lib/aggregator/official-standings';
import { normalizeAdministrationObservation } from '../lib/league-administration/normalize';
import { ADMINISTRATION_DIALECT, ADMINISTRATION_NORMALIZER_VERSION, ADMINISTRATION_SCHEMA_VERSION,
  type AdministrationWriteFence, type JsonValue } from '../lib/league-administration/contracts';
import type { CanonicalLeagueSeasonInput, CanonicalRegistrationAuthorization, CanonicalSourceMappingV1,
  CanonicalSourceReference, RegistryProviderKey } from '../lib/league-administration/canonical-source-contracts';
import { CANONICAL_DELIVERY_VERSION, CANONICAL_HASH_VERSION, CANONICAL_STANDINGS_VERSION,
  canonicalEqual, canonicalStandingsBytes, canonicalStandingsJsonbText, canonicalStandingsScope,
  isCanonicalDecimal, type CanonicalFact, type CanonicalResourceAttempt, type CanonicalStandingsDelivery,
  type CanonicalStandingsPolicy, type CanonicalStandingsValue } from '../lib/league-administration/canonical-standings-contracts';

export const FIXTURE_POLICY_VERSION = 'canonical-standings-fixture-policy-v1';
export const FIXTURE_REVISION = 'canonical-standings-fixtures-v1';
export const FIXTURE_JOB_TYPE = 'canonical-fixture-standings-v1';
export type StandingsFixture = Readonly<{
  id: string; sourceLeague: CanonicalSourceReference; leagueKey: string; leagueName: string; season: 2026;
  sourceNamespace: string; policy: CanonicalStandingsPolicy; registrationPayload: JsonValue;
  registrationDigest: string; nativePayload: JsonValue; standingsDigest: string;
}>;
type Source = Readonly<{ key: string; provider: string; namespace: string; nativeId: string;
  leagueKey: string; leagueName: string; sourceNamespace: string; teamNamespace: string }>;
/** This finite deployment registry, and its independently installed SQL copy, are the admission authority. */
const SOURCES: readonly Source[] = [
  { key:'alpha',provider:'fixture-sports',namespace:'league:alpha',nativeId:'club:ABC-7',
    leagueKey:'standings-fixture-alpha',leagueName:'Fixture Alpha',sourceNamespace:'league:alpha:2026',teamNamespace:'squads:alpha:2026' },
  { key:'beta',provider:'fixture-sports',namespace:'league:beta',nativeId:'club:ABC-7',
    leagueKey:'standings-fixture-beta',leagueName:'Fixture Beta',sourceNamespace:'league:beta:2026',teamNamespace:'squads:beta:2026' },
  { key:'gamma',provider:'fixture-results',namespace:'league:alpha',nativeId:'club:ABC-7',
    leagueKey:'standings-fixture-gamma',leagueName:'Fixture Gamma',sourceNamespace:'league:alpha:2026',teamNamespace:'squads:gamma:2026' },
  { key:'sleeper',provider:'sleeper',namespace:'nfl',nativeId:'900000000000001',
    leagueKey:'standings-fixture-sleeper',leagueName:'Fixture Sleeper',sourceNamespace:'nfl:2026',teamNamespace:'["nfl",2026,"900000000000001"]' },
  { key:'delta',provider:'fixture-sports',namespace:'league:delta',nativeId:'club:ABC-7',
    leagueKey:'standings-fixture-delta',leagueName:'Fixture Delta',sourceNamespace:'league:delta:2026',teamNamespace:'squads:delta:2026' },
  { key:'sleeper-membership',provider:'sleeper',namespace:'nfl',nativeId:'900000000000002',
    leagueKey:'standings-fixture-sleeper-membership',leagueName:'Fixture Sleeper Membership',sourceNamespace:'nfl:2026',teamNamespace:'["nfl",2026,"900000000000002"]' },
  { key:'alpha-remap',provider:'fixture-sports',namespace:'league:remapped',nativeId:'club:ABC-7',
    leagueKey:'standings-fixture-alpha',leagueName:'Fixture Alpha',sourceNamespace:'league:remapped:2026',teamNamespace:'squads:remapped:2026' },
];
function sourcePolicy(source: Source): CanonicalStandingsPolicy {
  const sleeper = source.provider === 'sleeper';
  return Object.freeze({ contractVersion:CANONICAL_DELIVERY_VERSION,canonicalSchemaVersion:CANONICAL_STANDINGS_VERSION,
    hashVersion:CANONICAL_HASH_VERSION,adapterVersion:sleeper?'sleeper-standings-adapter-v1':'fixture-standings-adapter-v1',
    nativeVerifierVersion:sleeper?'sleeper-standings-sql-v1':'fixture-standings-sql-v1',
    canonicalNormalizerVersion:sleeper?'sleeper-standings-canonical-v1':'fixture-standings-canonical-v1',
    validationVersion:'canonical-standings-acceptance-v1',audienceId:'public',coverageSpecId:'official-season-standings-v1',
    provider:source.provider,nativeKind:sleeper?'sleeper-rosters':'fixture-standings',
    teamNamespace:source.teamNamespace,originPolicy:'fixture-v1' });
}
/** Limited to this reviewed fixture domain: strings, booleans, null and safe integers.
 * Persisted evidence is independently hashed by PostgreSQL; this computes the pinned admission digest. */
export const fixtureJsonbDigest = (value: unknown): string => 'sha256:' + createHash('sha256')
  .update(canonicalStandingsJsonbText(value), 'utf8').digest('hex');
export const fixtureRegistrationDigest = (payload: JsonValue): string => fixtureJsonbDigest({
  hashVersion:CANONICAL_HASH_VERSION,representation:'registration',nativeKind:'fixture-club-league',payload });
export const fixtureNativeDigest = (payload: JsonValue, policy: CanonicalStandingsPolicy): string => fixtureJsonbDigest({
  hashVersion:CANONICAL_HASH_VERSION,representation:'native',nativeKind:policy.nativeKind,
  adapterVersion:policy.adapterVersion,nativePayload:payload });

const entries: JsonValue[] = [
  { clubKey:'club:ABC-7',played:{won:3,lost:1,tied:0},totals:{for:'123.45',against:'0'},place:1,seedNumber:2 },
  { clubKey:'club:XYZ-9',played:{won:0,lost:3,tied:1},totals:{for:'0',against:'123.45'},place:2,seedNumber:1 },
];
const clubPayload = (changes: Record<string,JsonValue> = {}): JsonValue => ({
  leagueKey:'club:ABC-7',seasonTag:'2026',updatedAt:'2026-01-01T00:00:00.000001Z',teamTotal:2,page:{complete:true,next:null},entries,...changes });
const variants: readonly Readonly<{ key:string; nativePayload:JsonValue }>[] = [
  { key:'complete',nativePayload:clubPayload() },
  { key:'correction',nativePayload:clubPayload({updatedAt:'2026-01-01T00:00:00.000002Z',entries:[
    { clubKey:'club:ABC-7',played:{won:4,lost:1,tied:0},totals:{for:'124.45',against:'0'},place:1,seedNumber:2 },entries[1]]}) },
  { key:'stale',nativePayload:clubPayload({updatedAt:'2026-01-01T00:00:00.000000Z'}) },
  { key:'conflict',nativePayload:clubPayload({updatedAt:'2026-01-01T00:00:00.000002Z',entries:[
    { clubKey:'club:ABC-7',played:{won:5,lost:1,tied:0},totals:{for:'125.45',against:'0'},place:1,seedNumber:2 },entries[1]]}) },
  { key:'partial',nativePayload:clubPayload({updatedAt:'2026-01-01T00:00:00.000003Z',page:{complete:false,next:'page:2'},entries:[entries[0]]}) },
  { key:'unproved',nativePayload:clubPayload({updatedAt:'2026-01-01T00:00:00.000004Z',teamTotal:null}) },
  { key:'matching-unproved',nativePayload:clubPayload({updatedAt:'2026-01-01T00:00:00.000005Z',page:{complete:false,next:'page:2'}}) },
  { key:'mismatch',nativePayload:clubPayload({updatedAt:'2026-01-01T00:00:00.000006Z',teamTotal:3}) },
  { key:'field-states',nativePayload:clubPayload({entries:[
    {clubKey:'club:ABC-7',played:{lost:null,tied:'invalid'},totals:{for:'0',against:null},place:0},
    {clubKey:'club:XYZ-9',played:{won:0,lost:0,tied:0},totals:{for:'01.50',against:'-0.25'},place:2,seedNumber:null}]}) },
  { key:'duplicate',nativePayload:clubPayload({entries:[entries[0],entries[0]]}) },
  { key:'capacity',nativePayload:clubPayload({teamTotal:21,entries:Array.from({length:21},(_,index)=>({
    clubKey:`club:CAP-${index}`,played:{won:0,lost:0,tied:0},totals:{for:'0',against:'0'},place:index+1,seedNumber:index+1}))}) },
  { key:'decimal-capacity',nativePayload:clubPayload({entries:[
    {clubKey:'club:ABC-7',played:{won:0,lost:0,tied:0},totals:{for:'1'.repeat(1025),against:'0'},place:1,seedNumber:1},entries[1]]}) },
];
const sleeperPayload: JsonValue = [
  {roster_id:1,league_id:'900000000000001',settings:{wins:0,losses:2,ties:0,fpts:0,fpts_decimal:0,fpts_against:100,fpts_against_decimal:25,rank:2,seed:1}},
  {roster_id:2,league_id:'900000000000001',settings:{losses:null,ties:'invalid',fpts:12,fpts_decimal:5,fpts_against:null,rank:0}},
];
function makeFixture(source: Source, key: string, nativePayload: JsonValue): StandingsFixture {
  const policy=sourcePolicy(source), registrationPayload={leagueKey:source.nativeId,seasonTag:'2026',title:source.leagueName,teamTotal:2};
  return {id:`${source.key}-${key}`,sourceLeague:{provider:source.provider as RegistryProviderKey,
    resourceKind:'league',nativeNamespace:source.namespace,nativeId:source.nativeId},leagueKey:source.leagueKey,
    leagueName:source.leagueName,season:2026,sourceNamespace:source.sourceNamespace,policy,registrationPayload,
    registrationDigest:fixtureRegistrationDigest(registrationPayload),nativePayload,standingsDigest:fixtureNativeDigest(nativePayload,policy)};
}
function freeze<T>(value:T):T {
  if(value && typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;
}
export const STANDINGS_FIXTURES: readonly StandingsFixture[] = freeze([
  ...variants.map(variant=>makeFixture(SOURCES[0],variant.key,variant.nativePayload)),
  makeFixture(SOURCES[1],'complete',clubPayload()),makeFixture(SOURCES[2],'complete',clubPayload()),
  makeFixture(SOURCES[3],'parity',sleeperPayload),
  makeFixture(SOURCES[4],'complete',clubPayload()),
  makeFixture(SOURCES[5],'complete',(sleeperPayload as JsonValue[]).map(row=>({...row as Record<string,JsonValue>,league_id:'900000000000002'}))),
  makeFixture(SOURCES[6],'complete',clubPayload()),
]);
export function fixtureById(id:string):StandingsFixture {
  const fixture=STANDINGS_FIXTURES.find(item=>item.id===id);if(!fixture)throw new Error('Unregistered standings fixture.');return fixture;
}
function registeredFixture(value:StandingsFixture):StandingsFixture {
  const expected=fixtureById(value.id);if(!canonicalEqual(value,expected))throw new Error('Changed fixed standings fixture.');return expected;
}
export function resolveFixtureStandingsPolicy(mapping:CanonicalSourceMappingV1,recordedPolicy?:unknown):CanonicalStandingsPolicy {
  const fixture=STANDINGS_FIXTURES.find(item=>mapping.scope.provider===item.sourceLeague.provider
    && mapping.scope.nativeNamespace===item.sourceLeague.nativeNamespace && mapping.scope.externalLeagueId===item.sourceLeague.nativeId
    && mapping.scope.season===item.season && mapping.scope.leagueKey===item.leagueKey && mapping.sourceNamespace===item.sourceNamespace);
  if(!fixture || recordedPolicy!==undefined && !canonicalEqual(recordedPolicy,fixture.policy))throw new Error('Unregistered fixed fixture policy.');
  return fixture.policy;
}
export function fixtureJobPayload(value:StandingsFixture) {
  const fixture=registeredFixture(value);
  return {fixturePolicyVersion:FIXTURE_POLICY_VERSION,policy:fixture.policy,sourceLeague:fixture.sourceLeague,
    intendedLeagueKey:fixture.leagueKey,season:fixture.season,registrationDigest:fixture.registrationDigest,standingsDigest:fixture.standingsDigest};
}
export function fixtureRegistration(value:StandingsFixture,fence:AdministrationWriteFence):
  {input:CanonicalLeagueSeasonInput;authorization:CanonicalRegistrationAuthorization} {
  const fixture=registeredFixture(value);
  return {input:{mode:'official-data',leagueKey:fixture.leagueKey,leagueName:fixture.leagueName,season:fixture.season,
    sourceLeague:fixture.sourceLeague,scoringRules:null},authorization:{work:fixtureJobPayload(fixture),fence,
    registrationCapture:{version:'fixture-league-registration-v1',nativeKind:'fixture-club-league',origin:'fixture',
      payload:fixture.registrationPayload,sourceDigest:fixture.registrationDigest,requestStartedAt:null,requestCompletedAt:null,
      acquisition:{version:'canonical-fixture-registration-v1',jobKey:fence.jobKey,generation:fence.generation,sourceDigest:fixture.registrationDigest}}}};
}

const object=(value:unknown):Record<string,unknown>|null=>value!==null && typeof value==='object' && !Array.isArray(value)?value as Record<string,unknown>:null;
function fact<T>(parent:Record<string,unknown>|null,key:string,accept:(value:unknown)=>value is T):CanonicalFact<T> {
  if(!parent)return {state:'invalid',value:null};
  if(!Object.hasOwn(parent,key))return {state:'absent',value:null};
  const value=parent[key];return value===null?{state:'null',value:null}:accept(value)?{state:'known',value}:{state:'invalid',value:null};
}
const integer=(minimum:number)=>(value:unknown):value is number=>typeof value==='number' && Number.isSafeInteger(value) && value>=minimum;
export function projectFixtureStandings(value:StandingsFixture):CanonicalStandingsValue {
  const fixture=registeredFixture(value),raw=object(fixture.nativePayload);
  const failed=(status:'invalid'|'capacity',reason:string):CanonicalStandingsValue=>({schemaVersion:CANONICAL_STANDINGS_VERSION,status,teams:[],reasons:[reason]});
  if(fixture.policy.nativeKind==='sleeper-rosters') {
    const native=projectOfficialStandings(normalizeAdministrationObservation({schemaVersion:ADMINISTRATION_SCHEMA_VERSION,
      normalizerVersion:ADMINISTRATION_NORMALIZER_VERSION,dialect:ADMINISTRATION_DIALECT,
      scope:{provider:'sleeper',leagueKey:fixture.leagueKey,externalLeagueId:fixture.sourceLeague.nativeId,season:2026},
      family:'rosters',week:null,provenance:{origin:'bootstrap',requestStartedAt:null,requestCompletedAt:null,sourceObservedAt:null,
        checkedAt:'2026-01-01T00:00:00.000Z'},completeness:'complete',payload:fixture.nativePayload}));
    const strip=<T>(field:{state:'known'|'absent'|'null'|'invalid';value:T|null}):CanonicalFact<T>=>field.state==='known'
      ?{state:'known',value:field.value!}:{state:field.state,value:null};
    return {schemaVersion:CANONICAL_STANDINGS_VERSION,status:native.status,reasons:native.reasons.map(reason=>reason==='invalid_roster_identity'?'standings_identity_invalid':reason).sort(),
      teams:native.teams.map(team=>({sourceTeam:{provider:fixture.sourceLeague.provider,resourceKind:'team',nativeNamespace:fixture.policy.teamNamespace,nativeId:team.externalRosterId},
        sourceOrdinal:team.sourceOrdinal,record:{wins:strip(team.record.wins),losses:strip(team.record.losses),ties:strip(team.record.ties)},
        pointsFor:strip(team.pointsFor),pointsAgainst:strip(team.pointsAgainst),providerRank:strip(team.providerRank),providerSeed:strip(team.providerSeed)}))};
  }
  if(!raw || raw.leagueKey!==fixture.sourceLeague.nativeId || raw.seasonTag!=='2026' || !Array.isArray(raw.entries))return failed('invalid','standings_identity_invalid');
  if(raw.entries.length>20)return failed('capacity','standings_team_limit_exceeded');
  const seen=new Set<string>();
  for(const row of raw.entries){const entry=object(row);if(!entry || typeof entry.clubKey!=='string' || !entry.clubKey.trim()
    || /[\x00-\x1f\x7f\uD800-\uDFFF]/u.test(entry.clubKey) || seen.has(entry.clubKey))return failed('invalid','standings_identity_invalid');seen.add(entry.clubKey);}
  if(raw.entries.some(row=>Object.values(object(object(row)?.totals)??{}).some(item=>typeof item==='string' && item.length>1024)))return failed('capacity','standings_decimal_limit_exceeded');
  const result:CanonicalStandingsValue={schemaVersion:CANONICAL_STANDINGS_VERSION,status:'qualified',reasons:[],teams:raw.entries.map((row,sourceOrdinal)=>{
    const entry=object(row)!,played=entry.played===undefined?{}:object(entry.played),totals=entry.totals===undefined?{}:object(entry.totals);
    return {sourceTeam:{provider:fixture.sourceLeague.provider,resourceKind:'team',nativeNamespace:fixture.policy.teamNamespace,nativeId:String(entry.clubKey)},sourceOrdinal,
      record:{wins:fact(played,'won',integer(0)),losses:fact(played,'lost',integer(0)),ties:fact(played,'tied',integer(0))},
      pointsFor:fact(totals,'for',isCanonicalDecimal),pointsAgainst:fact(totals,'against',isCanonicalDecimal),
      providerRank:fact(entry,'place',integer(1)),providerSeed:fact(entry,'seedNumber',integer(1))};})};
  return canonicalStandingsBytes(result)>1_048_576?failed('capacity','standings_byte_limit_exceeded'):result;
}
export function fixtureStandingsCoverage(fixture:StandingsFixture,facts:CanonicalStandingsValue):ObservedCoverage {
  const raw=object(fixture.nativePayload),page=object(raw?.page),sleeper=fixture.policy.nativeKind==='sleeper-rosters';
  const expected=!sleeper && integer(1)(raw?.teamTotal) && Number(raw?.teamTotal)<=2_147_483_647?Number(raw?.teamTotal):null;
  const complete=sleeper || page?.complete===true && page.next===null;
  const population=expected===null?'unproved':facts.status!=='qualified' || expected!==facts.teams.length?'mismatch':!complete?'unproved':'proven';
  const fields=['wins','losses','ties','pointsFor','pointsAgainst','providerRank','providerSeed'].filter(key=>facts.teams.length>0 && facts.teams.every(team=>
    (key in team.record?team.record[key as keyof typeof team.record]:team[key as 'pointsFor'|'pointsAgainst'|'providerRank'|'providerSeed']).state==='known')).sort();
  const records=facts.status==='qualified' && facts.teams.length>0 && ['wins','losses','ties','pointsFor','pointsAgainst'].every(key=>fields.includes(key));
  const entitySet=facts.status!=='qualified'?'unknown':complete && population==='proven'?'full':population==='mismatch' || !complete?'subset':'unknown';
  return {periodIds:[],interval:null,entitySet,fields,pagination:complete?'complete':'unknown',nextCursor:null,
    completeness:facts.status!=='qualified'?'unknown':entitySet==='full' && records?'complete':'partial',
    reasons:[...new Set([...facts.reasons,...(population==='proven'?[]:[`standings_population_${population}`]),
      ...(complete?[]:['standings_capture_partial']),...(records?[]:['standings_record_fields_incomplete'])])].sort()};
}
export function buildFixtureStandingsDelivery(value:StandingsFixture,mapping:CanonicalSourceMappingV1,attempt:CanonicalResourceAttempt,
  fence:AdministrationWriteFence,options:Readonly<{captureId:string;checkedAt:string;sourceObservedAt?:string|null;normalizedAt?:string}>):CanonicalStandingsDelivery {
  const fixture=registeredFixture(value),policy=resolveFixtureStandingsPolicy(mapping,fixture.policy),facts=projectFixtureStandings(fixture);
  return {contractVersion:policy.contractVersion,canonicalSchemaVersion:policy.canonicalSchemaVersion,hashVersion:policy.hashVersion,
    adapterVersion:policy.adapterVersion,nativeVerifierVersion:policy.nativeVerifierVersion,canonicalNormalizerVersion:policy.canonicalNormalizerVersion,
    mapping,scope:canonicalStandingsScope(mapping),policy,attempt,fence,nativePayload:fixture.nativePayload,canonicalValue:facts,
    coverage:fixtureStandingsCoverage(fixture,facts),populationEvidence:null,
    nativeSourceRef:{kind:'fixture-standalone-v1',fixtureId:fixture.id,fixtureRevision:FIXTURE_REVISION,sourceDigest:fixture.standingsDigest},
    provenance:{captureId:options.captureId,origin:'fixture',requestStartedAt:null,requestCompletedAt:null,
      sourceObservedAt:options.sourceObservedAt??null,checkedAt:options.checkedAt,normalizedAt:options.normalizedAt??options.checkedAt,
      sourceUpdatedAt:fixture.policy.nativeKind==='sleeper-rosters'?null:String(object(fixture.nativePayload)!.updatedAt),nativeRevision:null,
      acquisition:{version:'canonical-fixture-capture-v1',jobKey:fence.jobKey,generation:fence.generation,attemptId:attempt.id,nonce:attempt.nonce,sourceDigest:fixture.standingsDigest}}};
}
