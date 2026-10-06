"""Offline planning coverage and cross-artifact checks; never opens a DB or network.

These checks verify declared allocation, references, budgets and SQL inventory.
They do not parse PostgreSQL, prove complete requirements or qualify runtime.
"""
from pathlib import Path
import argparse
import json
import re
from urllib.parse import unquote

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--write', action='store_true')
    args = parser.parse_args()
    count = 0

    def check(value, message):
        nonlocal count
        if not value:
            raise ValueError(message)
        count += 1

    def read(name):
        return json.loads((HERE / name).read_text(encoding='utf-8'))

    def unique(rows, label):
        ids = [r['id'] for r in rows]
        check(len(ids) == len(set(ids)), 'Duplicate ' + label)
        return set(ids)

    def acyclic(rows, label):
        graph = {r['id']: r['depends_on'] for r in rows}
        complete, active = set(), set()
        def visit(key):
            check(key in graph, 'Unknown dependency ' + key)
            check(key not in active, 'Cycle in ' + label + ': ' + key)
            if key in complete:
                return
            active.add(key)
            for dependency in graph[key]:
                visit(dependency)
            active.remove(key)
            complete.add(key)
        for key in graph:
            visit(key)

    coverage = read('backend-coverage.json')
    decisions = read('backend-decisions.json')
    admission = read('acquisition-admission-design.json')
    foundation = read('foundation.json')
    relation = read('relational-design.json')
    needs = unique(coverage['needs'], 'need')
    owners = unique(coverage['owners'], 'owner')
    milestones = unique(coverage['milestones'], 'milestone')
    ids = unique(coverage['obligations'], 'obligation')
    decision_ids = unique(decisions['decisions'], 'decision')
    check(ids == {f'BC{i:03}' for i in range(1, 70)}, 'Full-scope obligation inventory drift')
    check(milestones == {f'BC-M{i}' for i in range(7)}, 'Milestone inventory drift')
    check(decision_ids == {'D03','D04','D05'} | {f'ENG{i:02}' for i in range(1,9)}, 'Selected decision inventory drift')
    check(decisions['authority']['kind'] == 'direct_user_delegation' and bool(decisions['authority']['quote']), 'Missing decision authority')
    expected_domains = {'acquisition','analytics','capability','capacity','delivery','discovery','evidence','freshness','governance','history','identity','lifecycle','nfl','official','operations','privacy','providers','readers','reliability','security'}
    check({r['domain'] for r in coverage['obligations']} == expected_domains, 'Missing full-backend domain')
    for need in coverage['needs']:
        if need['path'].startswith('https://'):
            check(need['path'] == 'https://docs.sleeper.com/' and bool(need['anchor']), 'Unknown external need: verify source explicitly')
        else:
            source = HERE / need['path']
            check(source.is_file() and need['anchor'] in source.read_text(encoding='utf-8'), 'Missing need source/anchor ' + need['id'])
    for owner in coverage['owners']:
        check(bool(owner['responsibility']) and bool(owner['source_paths']), 'Unassigned owner')
        for path in owner['source_paths']:
            check((ROOT/path).is_file(), 'Missing existing owner source ' + path)
    covered_needs, covered_owners, covered_decisions, acceptance_ids = set(), set(), set(), set()
    for row in coverage['obligations']:
        for key in ['domain','title','need_ids','owner_id','milestone_id','contract_fields','selected_plan','acceptance_id','acceptance','evidence_status','design_artifact_refs','current_source_paths','verification_methods','required_evidence']:
            check(bool(row.get(key)), 'Unallocated '+row['id']+': '+key)
        check(isinstance(row.get('decision_refs'), list), 'Missing decision disposition; an empty list means retained source behavior')
        check(set(row['need_ids']) <= needs and row['owner_id'] in owners, 'Unknown need/owner')
        check(row['milestone_id'] in milestones and set(row['decision_refs']) <= decision_ids | {'D02'}, 'Unknown milestone/decision')
        check(set(row['depends_on']) <= ids, 'Unknown obligation dependency')
        check(row['acceptance_id'] == 'V-'+row['id'] and row['acceptance_id'] not in acceptance_ids, 'Acceptance identity drift')
        check(row['evidence_status'] == 'specified_not_executed_for_target', 'Unsupported runtime claim')
        for path in row['design_artifact_refs']:
            check((HERE/path).is_file(), 'Missing design artifact '+path)
        for path in row['current_source_paths']:
            check((ROOT/path).is_file(), 'Missing source '+path)
        covered_needs.update(row['need_ids']); covered_owners.add(row['owner_id'])
        covered_decisions.update(row['decision_refs']); acceptance_ids.add(row['acceptance_id'])
    check(covered_needs == needs, 'Unallocated approved need')
    check(covered_owners == owners, 'Owner has no obligation')
    check(decision_ids <= covered_decisions, 'Selected decision has no rationale/allocation')
    acyclic(coverage['milestones'], 'milestones')
    acyclic(coverage['obligations'], 'obligations')
    for surface in coverage['contract_surface_register']:
        check(bool(surface['target_fields']) and bool(surface['representation']), 'Unspecified contract surface')
        check(bool(surface['obligations']) and set(surface['obligations']) <= ids, 'Unallocated contract surface')
    readable = (HERE/coverage['readable_view']).read_text(encoding='utf-8')
    for row in coverage['obligations']:
        check(row['id'] in readable and row['acceptance_id'] in readable, 'Readable coverage omission')
    budget = decisions['provider_budget']; policy = admission['policy']
    check(sum(budget['lanes'].values()) == budget['actual_starts_per_rolling_60_seconds'] == policy['global_starts_per_rolling_60s'] == 900, 'Aggregate budget disagreement')
    lane_mapping = {'live_score':'live-score','roles_roster':'role-roster','transactions':'transactions','administration':'metadata','interactive':'interactive','import_future':'import','retry':'retry'}
    check({lane_mapping[k]:v for k,v in budget['lanes'].items()} == {r['id']:r['limit'] for r in policy['lanes']}, 'Lane budget disagreement')
    check(budget['permit_charge_window_seconds'] == policy['reservation_accounting_window_seconds'] == 61, 'Reservation window drift')
    check(budget['dispatch_deadline_seconds']*1000 == policy['dispatch_validity_ms'] == 1000, 'Dispatch-bound drift')
    check(sum(r['limit'] for r in policy['lanes']) == 900 and 500*61/45 < 680, 'Declared baseline rate arithmetic fails')
    check(foundation['open_decisions'] == [] and foundation['policy']['max_membership_age_seconds'] == 3600, 'Delegated policy drift')
    identify = next(r for r in foundation['records'] if r['name']=='IdentifyProviderAccountResult')
    check('pending' in next(f[1] for f in identify['fields'] if f[0]=='status'), 'Missing durable pending identity result')
    check(len(admission['schedules']) >= 8 and all(r['expected'] for r in admission['schedules']), 'Missing adversarial admission oracles')
    sql = (HERE/'proposed-schema.sql').read_text(encoding='utf-8')
    check('NOT A MIGRATION' in sql and 'NEVER execute' in sql, 'DDL scope warning missing')
    tables = re.findall(r'CREATE TABLE\s+([a-z_][a-z_0-9.]+)\s*\(', sql, re.I)
    check(bool(tables) and len(tables)==len(set(tables)), 'Duplicate/absent proposed tables')
    check(not re.search(r'^\s*(DROP TABLE|TRUNCATE|DELETE FROM|INSERT INTO)\b',sql,re.M|re.I), 'Unexpected data/destructive statement in design')
    erd = (HERE/'relational-erd.md').read_text(encoding='utf-8')
    check(erd.count('erDiagram') >= 3, 'Missing conceptual/relational diagrams')
    # Exact manifest parity, when authored, is a structure check, not SQL validity.
    manifest = relation.get('ddl_specification')
    if manifest:
        check({r['table'] for r in manifest['create_tables']} == set(tables), 'DDL manifest/table mismatch')
        logical = {r['id'] for r in relation['relations']}
        responsibilities = {r['id'] for r in relation['storage_responsibilities']}
        for row in manifest['create_tables'] + manifest['alter_existing_tables']:
            check(bool(row['logical_relations']) and set(row['logical_relations']) <= logical, 'DDL relation allocation missing')
            check(bool(row['storage_responsibilities']) and set(row['storage_responsibilities']) <= responsibilities, 'DDL owner allocation missing')
        for row in manifest['create_tables']:
            check(row['erd_entity'] in erd, 'Proposed table omitted from ERD')
        for row in manifest['helper_privileges']:
            check(bool(row['signature']) and (bool(row['execute_roles']) or (row.get('owner_session_only') is True and row['owner'] == 'existing migration owner' and row['signature'] in {'public.disable_app_actor_v1(uuid,uuid)','public.revoke_app_login_identity_v1(uuid,uuid)'})) and row['public_execute'] is False and row['raw_auth_grants'] is False, 'Unsafe or unspecified helper privilege')
    for name in ['backend-build-plan.md','backend-decisions.md','backend-coverage.md','relational-erd.md','acquisition-admission-design.md']:
        text = (HERE/name).read_text(encoding='utf-8')
        for target in re.findall(r'\]\(([^)]+)\)',text):
            if '://' in target:
                continue
            path = unquote(target.strip('<>').split('#',1)[0])
            if path:
                check((HERE/path).exists(), 'Broken plan link '+target)
    summary = {'status':'passed','planning_assertions':count,'scope_obligations':len(ids),'covered_obligations':len(acceptance_ids),'scope_domains':len(expected_domains),'approved_need_anchors':len(needs),'existing_owner_roles':len(owners),'selected_decisions':len(decision_ids),'milestones':len(milestones),'proposed_tables':len(tables),'admission_paper_schedules':len(admission['schedules']),'planning_allocation_percent':100,'runtime_cases_executed':0,'limits':'100% refers only to allocation of the enumerated approved planning scope. No universal completeness, SQL parser/execution, external source entitlement, capacity or production certification.'}
    report = '# Full backend planning checks\n\nGenerated by `verify_backend_plan.py`. These are offline declared-model checks; independent semantic reviews and later detailed designs/runtime qualification remain required.\n\n```json\n'+json.dumps(summary,indent=2)+'\n```\n'
    if args.write:
        (HERE/'backend-plan-analysis.md').write_text(report,encoding='utf-8',newline='\n')
    check((HERE/'backend-plan-analysis.md').read_text(encoding='utf-8') == report, 'Plan analysis differs; deliberately regenerate')
    print(json.dumps(summary))


if __name__ == '__main__':
    main()
