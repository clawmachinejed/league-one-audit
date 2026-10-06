import { describe, expect, it, vi } from 'vitest';
import { inspectParentCatalog, QUALIFICATION_PARENT, validateParentApproval, type ParentApproval } from './qualification-parent-preflight';

const approval: ParentApproval = { reviewedSha:'a'.repeat(40), authorization:'I_AUTHORIZE_ONE_READ_ONLY_TEST_PARENT_PREFLIGHT',
  credentialProvenanceEvidenceHash:'b'.repeat(64),quiescenceEvidenceHash:'c'.repeat(64),
  expectedDatabaseNames:['integration_test','neondb'],expectedRoles:[{name:'neondb_owner'}],expectedRoleMemberships:[] };
const identity = {database:'integration_test',login:'neondb_owner',actor:'neondb_owner',tls:true,
  settings:{'neon.project_id':{value:QUALIFICATION_PARENT.projectId,context:'postmaster',pending:false},
    'neon.branch_id':{value:QUALIFICATION_PARENT.parentBranchId,context:'postmaster',pending:false}}};
const databases = [{name:'integration_test',template:false,connectable:true},{name:'neondb',template:false,connectable:true},
  {name:'template0',template:true,connectable:false},{name:'template1',template:true,connectable:true}];
const empty = {schemas:0,relations:0,functions:0,types:0,sessions:0,extensions:0,
  largeobjects:0,foreignservers:0,publications:0,subscriptions:0,eventtriggers:0,defaultacls:0};
function query(overrides: Partial<{identity:unknown[];databases:unknown[];roles:unknown[];memberships:unknown[];counts:unknown[]}> = {}) {
  const replies = {identity:[identity],databases,roles:approval.expectedRoles,memberships:[],counts:[empty],...overrides};
  return vi.fn(async (sql: string) => ({rows: (sql.includes('current_database()') ? replies.identity
    : sql.includes('FROM pg_database') ? replies.databases : sql.includes('FROM pg_roles ORDER') ? replies.roles
    : sql.includes('FROM pg_auth_members') ? replies.memberships : replies.counts) as Record<string,unknown>[]}));
}

describe('test-only parent catalog preflight, offline fixtures',()=>{
  it('reports all database inventory and checks global roles/memberships rather than one database only',async()=>{
    const q=query();
    expect(await inspectParentCatalog(q,'integration_test',approval)).toEqual({database:'integration_test',databases,counts:empty});
    expect(q).toHaveBeenCalledTimes(5);
    expect(q.mock.calls.every(([sql])=>sql.startsWith('SELECT'))).toBe(true);
  });
  it.each(Object.keys(empty))('refuses nonempty %s',async field=>{
    await expect(inspectParentCatalog(query({counts:[{...empty,[field]:1}]}),'integration_test',approval)).rejects.toThrow();
  });
  it.each(['login','actor','database'])('refuses mismatched actual %s',async field=>{
    await expect(inspectParentCatalog(query({identity:[{...identity,[field]:'wrong'}]}),'integration_test',approval)).rejects.toThrow();
  });
  it('refuses an apparently matching user-configurable branch setting',async()=>{
    const changed=structuredClone(identity);changed.settings['neon.branch_id'].context='user';
    await expect(inspectParentCatalog(query({identity:[changed]}),'integration_test',approval)).rejects.toThrow();
  });
  it('refuses a TLS-free connection',async()=>{
    await expect(inspectParentCatalog(query({identity:[{...identity,tls:false}]}),'integration_test',approval)).rejects.toThrow();
  });
  it('refuses extra databases even if the configured target is empty',async()=>{
    await expect(inspectParentCatalog(query({databases:[...databases,{name:'hidden',template:false,connectable:true}]}),'integration_test',approval)).rejects.toThrow();
  });
  it('refuses an inaccessible application database without altering its connection flags',async()=>{
    const changed=structuredClone(databases);changed[1].connectable=false;
    await expect(inspectParentCatalog(query({databases:changed}),'integration_test',approval)).rejects.toThrow();
  });
  it('refuses inherited application roles even if listed in operator input',async()=>{
    const roles=[...approval.expectedRoles,{name:'league_one_account'}];
    await expect(inspectParentCatalog(query({roles}),'integration_test',{...approval,expectedRoles:roles})).rejects.toThrow();
  });
  it('refuses unapproved global role memberships',async()=>{
    await expect(inspectParentCatalog(query({memberships:[{role:'neon_superuser',member:'intruder',admin:true}]}),'integration_test',approval)).rejects.toThrow();
  });
  it.each([{}, {...approval,authorization:'I_AUTHORIZE_DISPOSABLE_TEST_BRANCHES'},
    {...approval,credentialProvenanceEvidenceHash:''},{...approval,quiescenceEvidenceHash:''},
    {...approval,expectedDatabaseNames:['integration_test','integration_test']},
    {...approval,expectedDatabaseNames:['integration_test','projection_refactor_test']}])('requires separate explicit preflight approval',value=>{
    expect(()=>validateParentApproval(value)).toThrow();
  });
  it('retains explicit evidence references without claiming they prove key binding',()=>{
    expect(validateParentApproval(approval)).toEqual(approval);
  });
});
