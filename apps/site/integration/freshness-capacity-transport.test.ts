import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createCapacityFleetFixture, type CapacityFleetFixture } from './freshness-capacity-fixtures';
import { createCapacityFixtureTransport, createCapacityRecoveryTransport } from './freshness-capacity-transport';
import { createCapacityRecoveryManifest, RECOVERY_CLOCK, type CapacityRecoveryManifest } from './freshness-capacity-recovery';
import { projectDraftMetadata } from '../lib/aggregator/draft-metadata';
import { projectDraftSelections } from '../lib/aggregator/draft-selections';
import { projectTradedPicks } from '../lib/aggregator/traded-picks';
import { capacityWeeklyReportRequest } from './freshness-capacity-manifest';
import { capturePublicSleeperIdentity, capturePublicSleeperLeagueList, capturePublicSleeperCore,
  capturePublicSleeperWeeklyReport, getOfficialDraftAdministration, getOfficialAdministrationMetadata, getFantasyPlayerCatalog } from '../lib/sleeper';
import { loadCompletePlayerCatalog } from '../lib/sleeper-player-catalog';
import { normalizeAdministrationObservation } from '../lib/league-administration/normalize';
import type { AdministrationEnvelope } from '../lib/league-administration/contracts';
vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }));
let fleet: CapacityFleetFixture; let recovery:CapacityRecoveryManifest;
beforeAll(() => { fleet = createCapacityFleetFixture('transport-test'); recovery=createCapacityRecoveryManifest(fleet,{readinessContractSha256:'a'.repeat(64),acceptanceContractSha256:'b'.repeat(64),gitSha:'c'.repeat(40),appTreeSha:'d'.repeat(40),plannedPostgresqlVersion:'18.6',readerQueryMixSha256:'e'.repeat(64),observerManifestDigest:'f'.repeat(64),requestBudgetPolicy:'cp1-data-with-separate-existing-owners-v1',requestOwners:['data-refresh','primary-projection','administration-maintenance','independent-measurement']}); }, 30_000);
const native = '9260000000000000001';
const route = `https://api.sleeper.app/v1/league/${native}`;
function controlled() {
  let time = 1_000_000, mono = 100;
  const anchors = new Map<string, number>();
  const transport = createCapacityFixtureTransport(fleet, { owner: 'ordinary-runner', purpose: 'refresh', anchors: () => anchors,
    wallNow: () => time, monotonicNow: () => mono, outage: { startedAt: 9_000_000, endedAt: 9_001_000 } });
  return { transport, anchors, at(value: number) { time = value; mono++; } };
}

describe('closed synthetic provider transport', () => {
  it('selects bytes at request start and shares both lineup/score publication anchors', async () => {
    const { transport, anchors, at } = controlled();
    const first = await (await transport.fetch(route + '/matchups/7')).text();
    anchors.set('league-01/lineups', 1_000_000); anchors.set('league-01/official-scores', 1_000_000);
    at(1_059_999); expect(await (await transport.fetch(route + '/matchups/7')).text()).toBe(first);
    at(1_060_000); const updated = await (await transport.fetch(route + '/matchups/7')).text(); expect(updated).not.toBe(first);
    const journal = transport.journal(); expect(journal.responses.at(-1)).toMatchObject({ pairIds: ['league-01/lineups', 'league-01/official-scores'],
      version: fleet.prototype.events.find(row => row.id === 'league-01/lineups/event-1')!.after.version,
      responseBoundary: 'full-synthetic-bytes-available', requestStartedAt: 1_060_000, responseCompletedAt: 1_060_000 });
    expect(transport.journal().responses[0]).toBe(journal.responses[0]);
    expect(Object.isFrozen(journal.responses)).toBe(true);
    expect(journal.revision).toBe(6);
    expect(journal.attempts).toHaveLength(3); expect(journal.rejectedRequests).toEqual([]);
      expect(journal.attempts.every(row => row.origin === 'https://api.sleeper.app' || row.origin === 'https://sleeper.com')).toBe(true);
    anchors.set('league-01/official-scores', 1_000_001);
    await expect(transport.fetch(route + '/matchups/7')).rejects.toThrow('publication anchor');
    expect(transport.journal().rejectedRequests).toHaveLength(1);
  });
  it('keeps fresh pairs initial until acceptance and repeated source bytes under distinct versions', async () => {
    const { transport, anchors, at } = controlled(), endpoint = fleet.endpointInventory.find(row => row.id === 'league-09:rosters')!;
    at(8_000_000); const initial = await (await transport.fetch(endpoint.url)).text();
    anchors.set('league-09/rosters', 8_000_000); at(8_420_000);
    expect(await (await transport.fetch(endpoint.url)).text()).toBe(initial);
    const journal = transport.journal(); expect(journal.responses[0].version).not.toBe(journal.responses[1].version);
    expect(journal.responses[0].rawSha256).toBe(journal.responses[1].rawSha256);
  });
  it('rejects undeclared routes, methods, request bytes and partial paired anchors without network fallback', async () => {
    const { transport, anchors } = controlled();
    for (const [url, init] of [ ['https://unexpected.invalid/sql', undefined], [route + '/matchups/19', undefined],
      [route, { method: 'POST' }], ['https://sleeper.com/graphql', { method: 'POST', body: '{}' }],
      [route, { method: 'GET', body: new Uint8Array() }] ] as [string, RequestInit | undefined][]) await expect(transport.fetch(url, init)).rejects.toThrow('undeclared');
    anchors.set('league-01/lineups', 1_000_000); await expect(transport.fetch(route + '/matchups/7')).rejects.toThrow('all acceptance anchors');
    expect(transport.journal().attempts).toEqual([]); expect(transport.journal().rejectedRequests).toHaveLength(6);
  });
  it('records failed/aborted attempts without successful source observations or retries', async () => {
    const { transport, at } = controlled(); at(9_000_000);
    await expect(transport.fetch(route)).rejects.toThrow('outage');
    at(9_001_000); await expect(transport.fetch(route, { signal: AbortSignal.abort() })).rejects.toThrow();
    await transport.fetch(route);
    const journal = transport.journal(); expect(journal.attempts.map(row => row.outcome)).toEqual(['failed', 'timeout', 'success']);
    expect(journal.responses).toHaveLength(1); expect(journal.attempts.slice(0, 2).every(row => row.responseSha256 === null)).toBe(true);
    expect(journal.coverageStartedAt).toBe(1_000_000); expect(journal.coverageEndedAt).toBe(9_001_000);
    expect(Object.isFrozen(journal.responses[0])).toBe(true);
  });
  it('binds report POST exact body hash and accepts Request inputs', async () => {
    const { transport } = controlled(), body = capacityWeeklyReportRequest(native, 18);
    await transport.fetch(new Request('https://sleeper.com/graphql', { method: 'POST', body }));
    expect(transport.journal().attempts[0]).toMatchObject({ method: 'POST', path: '/graphql', report: { family: 'weekly_report', externalLeagueId: native, nativeWeek: 18 } });
  });
});

describe('actual maintained adapters over full authored inventory', () => {
  it('captures identity, discovery, all native periods, brackets, report POSTs, draft fanout and shared catalog', async () => {
    const transport = createCapacityFixtureTransport(fleet, { owner: 'ordinary-runner', purpose: 'intake', anchors: () => new Map() });
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(transport.fetch), signal = new AbortController().signal;
    try {
      for (const user of fleet.users.filter(row => row.cohort !== 'auxiliary')) {
        const identity = await capturePublicSleeperIdentity(user.username, signal);
        expect(identity.value?.userId).toBe(user.nativeManagerId);
        expect((await capturePublicSleeperIdentity(user.nativeManagerId, signal)).value?.userId).toBe(user.nativeManagerId);
        expect((await capturePublicSleeperLeagueList(user.nativeManagerId, 2026, signal)).value).toHaveLength(user.leagueKeys.length);
      }
      const normalize = (document: Awaited<ReturnType<typeof capturePublicSleeperWeeklyReport>>) => {
        const envelope: AdministrationEnvelope = { schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1', dialect: 'sleeper-nfl-v1',
          scope: { leagueKey: 'cp26-test', provider: 'sleeper', externalLeagueId: native, season: 2026 },
          family: document.family, week: document.week, completeness: 'complete', payload: document.payload as AdministrationEnvelope['payload'],
          provenance: { origin: 'network', requestStartedAt: document.requestStartedAt, requestCompletedAt: document.requestCompletedAt,
            sourceObservedAt: document.requestCompletedAt, checkedAt: document.requestCompletedAt } };
        const normalized = normalizeAdministrationObservation(envelope); expect(normalized.status, JSON.stringify(normalized)).toBe('accepted');
      };
      for (const family of ['league', 'rosters', 'users', 'winners_bracket', 'losers_bracket'] as const) normalize(await capturePublicSleeperCore(native, family, signal));
      for (let week = 1; week <= 18; week++) {
        normalize(await capturePublicSleeperCore(native, 'matchups', signal, week));
        normalize(await capturePublicSleeperWeeklyReport(native, week, signal));
      }
      for (let week = 0; week <= 18; week++) normalize(await capturePublicSleeperCore(native, 'transactions', signal, week));
      const drafts = await getOfficialDraftAdministration(native, 2026, { signal, maxRequests: 5 });
      expect(drafts.reason).toBeUndefined(); expect(drafts.providerRequests).toBe(4); drafts.observations.forEach(normalize);
      const metadata = await getOfficialAdministrationMetadata(native, 2026, { signal, maxRequests: 10 });
      expect(metadata.reason).toBeUndefined();
      const players = await getFantasyPlayerCatalog(); expect(players.complete).toBe(true);
      const complete = await loadCompletePlayerCatalog(); expect(complete.complete).toBe(true);
      expect(Object.keys(complete.catalog)).toHaveLength(22);
      const journal = transport.journal(); expect(journal.rejectedRequests).toEqual([]);
      expect(journal.attempts.filter(row => row.method === 'POST')).toHaveLength(18);
      expect(journal.responses.some(row => row.resource === 'player-position-catalog')).toBe(true);
      expect(journal.attempts.some(row => row.path === '/v1/players/nfl?position=QB')).toBe(true);
      expect(journal.attempts.every(row => row.origin === 'https://api.sleeper.app' || row.origin === 'https://sleeper.com')).toBe(true);
      for (const response of journal.responses) {
        expect(response.monotonicCompletedAt).toBeGreaterThanOrEqual(response.monotonicStartedAt);
        expect(response.responseCompletedAt).toBeGreaterThanOrEqual(response.requestStartedAt);
      }
    } finally { spy.mockRestore(); }
  }, 30_000);
});

it('snapshots validated source and records callback failures without successful observations', async () => {
  const mutable = structuredClone(fleet), transport = createCapacityFixtureTransport(mutable, { owner: 'ordinary-runner', purpose: 'refresh', anchors: () => new Map() });
  const expected = mutable.endpointInventory.find(row => row.id === 'league-01:league')!.versions[0].utf8;
  mutable.endpointInventory.find(row => row.id === 'league-01:league')!.versions[0].utf8 = '{}';
  expect(await (await transport.fetch(route)).text()).toBe(expected);
  for (const callback of ['onResponse', 'onAttempt'] as const) {
    const failed = createCapacityFixtureTransport(fleet, { owner: 'ordinary-runner', purpose: 'refresh', anchors: () => new Map(),
      [callback]: () => { throw new Error('journal sink unavailable'); } });
    await expect(failed.fetch(route)).rejects.toThrow('journal sink unavailable');
    expect(failed.journal().attempts[0]).toMatchObject({ outcome: 'failed', responseSha256: null }); expect(failed.journal().responses).toEqual([]);
  }
});

describe('separate recovery publication over the same HTTP boundary',()=>{
  it('retainsv0 until the full30minute outage ends and publishes exactlyv1 afterward',async()=>{
    const start=1_000_000;let time=start,mono=0;
    const transport=createCapacityRecoveryTransport(recovery,{owner:'data-refresh',purpose:'refresh',startedAt:start,wallNow:()=>time,monotonicNow:()=>++mono});
    const endpoint=recovery.endpoints.find(row=>row.id==='league-01:matchups:7')!;
    expect(await(await transport.fetch(endpoint.url)).text()).toBe(endpoint.before.utf8);
    time=start+RECOVERY_CLOCK.outageStartMs;await expect(transport.fetch(endpoint.url)).rejects.toThrow('outage');
    time=start+RECOVERY_CLOCK.outageEndMs-1;await expect(transport.fetch(endpoint.url)).rejects.toThrow('outage');
    time=start+RECOVERY_CLOCK.outageEndMs;expect(await(await transport.fetch(endpoint.url)).text()).toBe(endpoint.after.utf8);
    time=start+RECOVERY_CLOCK.workMs;expect(await(await transport.fetch(endpoint.url)).text()).toBe(endpoint.after.utf8);
    expect(transport.journal().attempts.map(row=>row.outcome)).toEqual(['success','failed','failed','success','success']);
    expect(new Set(transport.journal().responses.map(row=>row.version))).toEqual(new Set([endpoint.before.version,endpoint.after.version]));
    expect(()=>createCapacityRecoveryTransport(recovery,{owner:'unknown',purpose:'refresh',startedAt:start})).toThrow('unknown recovery');
  });
  it('captures native corrected draft metadata selections and trades through maintained adapters/projectors',async()=>{
    const transport=createCapacityRecoveryTransport(recovery,{owner:'data-refresh',purpose:'refresh',startedAt:0});
    const spy=vi.spyOn(globalThis,'fetch').mockImplementation(transport.fetch);
    try{for(const [mode,project] of [['metadataOnly',projectDraftMetadata],['selectionsOnly',projectDraftSelections],['tradedPicksOnly',projectTradedPicks]] as const){
      const result=await getOfficialDraftAdministration(native,2026,{signal:new AbortController().signal,maxRequests:10,[mode]:true});expect(result.reason).toBeUndefined();expect(result.observations.length).toBeGreaterThan(0);
      for(const document of result.observations){const envelope:AdministrationEnvelope={schemaVersion:'league-administration-v1',normalizerVersion:'sleeper-administration-v1',dialect:'sleeper-nfl-v1',scope:{leagueKey:'recovery-unit',provider:'sleeper',externalLeagueId:native,season:2026},family:document.family,week:document.week,completeness:'complete',payload:document.payload as AdministrationEnvelope['payload'],provenance:{origin:'network',requestStartedAt:document.requestStartedAt,requestCompletedAt:document.requestCompletedAt,sourceObservedAt:document.requestCompletedAt,checkedAt:document.requestCompletedAt}};
        expect(project(normalizeAdministrationObservation(envelope)).status).toBe('accepted');}
    }expect(transport.journal().rejectedRequests).toEqual([]);}finally{spy.mockRestore();}
  });
});
