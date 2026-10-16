import net from 'node:net';
import tls from 'node:tls';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from '@neondatabase/serverless';

const state=vi.hoisted(()=>({ pools:[] as Pool[], clients:[] as Array<{ id:number; ended:boolean; statements:string[] }>,
  releases:[] as number[], failConnect:false, networkAttempts:0 }));
vi.mock('@neondatabase/serverless',async importOriginal=>{
  const actual=await importOriginal<typeof import('@neondatabase/serverless')>();
  const { EventEmitter }=await import('node:events');
  class SyntheticClient extends EventEmitter {
    _queryable=true; _ending=false; id=state.clients.length+1; ended=false; statements:string[]=[];
    constructor(){super();state.clients.push(this);}
    connect(callback:(error:Error|null)=>void){queueMicrotask(()=>callback(state.failConnect?new Error('synthetic connect failure'):null));}
    query(statement:string,parameters:unknown[],callback?:(error:Error|null,result?:{rows:unknown[]})=>void){
      this.statements.push(statement);
      const error=statement==='synthetic rejection'?Object.assign(new Error('public intake lease lost'),{code:'P0001'}):null;
      const result={rows:statement==='identity'?[{pid:7000+this.id,backend_start:'synthetic-'+this.id}]:[]};
      if(callback){queueMicrotask(()=>callback(error,result));return;}
      return error?Promise.reject(error):Promise.resolve(result);
    }
    end(){this.ended=true;this._ending=true;this._queryable=false;this.emit('end');}
  }
  class SyntheticTransportPool extends actual.Pool {
    constructor(options:ConstructorParameters<typeof actual.Pool>[0]){
      super(options);
      // NeonPool replaces the options.Client constructor. Replace only that slot,
      // before connect; all checked-in/out/idle/release/end logic stays installed.
      Reflect.set(this,'Client',SyntheticClient);
      this.on('release',(_error:Error|null,client:unknown)=>state.releases.push((client as unknown as SyntheticClient).id));
      state.pools.push(this);
    }
  }
  return {...actual,Pool:SyntheticTransportPool};
});
import { createIndependentDatabase, createIndependentPinnedDatabase } from './neon-integration-harness';
import { assertContentionBackendIdentity } from './competing-workers-protocol';

const url='postgresql://league_one_runtime:synthetic@cp23.invalid/cp23_test?sslmode=require';
function denyNetwork():never{state.networkAttempts++;throw new Error('Offline session test forbids network.');}
beforeEach(()=>{
  state.pools.length=0;state.clients.length=0;state.releases.length=0;state.failConnect=false;state.networkAttempts=0;
  vi.stubGlobal('fetch',denyNetwork);vi.stubGlobal('WebSocket',class {constructor(){denyNetwork();}});
  vi.spyOn(net.Socket.prototype,'connect').mockImplementation(denyNetwork);
  vi.spyOn(tls,'connect').mockImplementation(denyNetwork);
});
afterEach(async()=>{
  for(const pool of state.pools) if(!pool.ending) await pool.end();
  expect(state.networkAttempts).toBe(0);
  vi.restoreAllMocks();vi.unstubAllGlobals();
});

/** No real URL is contacted, SQL executed or role authenticated by these tests. */
describe('CP23 actual installed pool lifetime with synthetic transport only',()=>{
  it('reproduces default eviction after ten seconds while two real held-client paths preserve separate identities',async()=>{
    const ordinary=createIndependentDatabase(url);
    const first=await createIndependentPinnedDatabase(url),second=await createIndependentPinnedDatabase(url);
    try{
      const [initial]=await ordinary.database.query('identity');
      const [a]=await first.database.query('identity'),[b]=await second.database.query('identity');
      expect(a.pid).not.toBe(b.pid);
      expect(state.pools.map(pool=>pool.options.idleTimeoutMillis)).toEqual([10_000,10_000,10_000]);
      expect(state.pools.map(pool=>pool.options.max)).toEqual([1,1,1]);
      expect(state.pools.map(pool=>pool.idleCount)).toEqual([1,0,0]);
      const removed=new Promise<number>(resolve=>state.pools[0].once('remove',()=>resolve(performance.now())));
      const started=performance.now();
      await delay(10_250);
      expect(await removed-started).toBeGreaterThanOrEqual(9_990);
      expect(state.pools.map(pool=>pool.totalCount)).toEqual([0,1,1]);
      const [replacement]=await ordinary.database.query('identity');
      expect(replacement.pid).not.toBe(initial.pid);
      expect(replacement.backend_start).not.toBe(initial.backend_start);
      expect(await first.database.query('identity')).toEqual([a]);
      expect(await second.database.query('identity')).toEqual([b]);
      expect(state.releases.filter(id=>id===Number(a.pid)-7000||id===Number(b.pid)-7000)).toEqual([]);
      // The unchanged message oracle rejects the original helper's replacement.
      expect(()=>assertContentionBackendIdentity(initial,replacement)).toThrow('identity changed');
      expect(()=>assertContentionBackendIdentity(a,a)).not.toThrow();
    }finally{await ordinary.close();await first.close();await first.close();await second.close();await second.close();}
    expect(state.pools.every(pool=>pool.totalCount===0)).toBe(true);
    expect(state.clients.every(client=>client.ended)).toBe(true);
    expect(state.releases.filter(id=>id===1)).toHaveLength(1);
    expect(state.releases.filter(id=>id===2)).toHaveLength(1);
  },20_000);

  it('retains the held session through the real negative transaction wrapper and releases it once',async()=>{
    const session=await createIndependentPinnedDatabase(url);
    try{
      const before=await session.database.query('identity');
      await expect(session.database.queryAfterLock!('synthetic rejection',[],{statement:'SELECT 1',parameters:[]})).rejects.toMatchObject({code:'P0001'});
      expect(await session.database.query('identity')).toEqual(before);
      expect(state.clients[0].statements).toEqual(['identity','BEGIN ISOLATION LEVEL READ COMMITTED','SELECT 1','synthetic rejection','ROLLBACK','identity']);
      expect(state.releases).toEqual([]);
    }finally{await session.close();await session.close();}
    expect(state.releases).toEqual([1]);expect(state.pools[0].totalCount).toBe(0);
  });

  it('ends the actual pool after synthetic connection failure without returning a session',async()=>{
    state.failConnect=true;
    await expect(createIndependentPinnedDatabase(url)).rejects.toThrow('synthetic connect failure');
    expect(state.pools[0].ending).toBe(true);expect(state.pools[0].totalCount).toBe(0);
    // A rejected connect never becomes an acquired pool client. Its transport
    // owns connection-error teardown; the pool itself must be empty and ended.
    expect(state.releases).toEqual([]);expect(state.clients).toHaveLength(1);
  });
});
