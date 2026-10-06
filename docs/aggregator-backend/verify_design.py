"""Offline design analysis: declared traceability, key/FD closure and model consistency.

No imports of application code, environment, network, database, or credentials.
This proves properties of declared models, not completeness of their assumptions.
"""
from __future__ import annotations

import argparse
import itertools
import json
import re
import sys
from collections import Counter
from pathlib import Path
from urllib.parse import unquote

sys.dont_write_bytecode = True
from render_requirements import render_requirements

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]


def closure(seed, dependencies):
    result = set(seed)
    while True:
        before = set(result)
        for fd in dependencies:
            if set(fd['determinant']) <= result:
                result.update(fd['dependent'])
        if result == before:
            return result


def projected_dependencies(attributes, dependencies):
    """Exact finite projection of F+ onto each declared binary component."""
    attributes = sorted(attributes)
    result = []
    for size in range(len(attributes) + 1):
        for seed in itertools.combinations(attributes, size):
            dependent = (closure(seed, dependencies) & set(attributes)) - set(seed)
            if dependent:
                result.append({'determinant': list(seed), 'dependent': sorted(dependent)})
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--write', action='store_true', help='Render requirements and analysis report')
    args = parser.parse_args()
    checks = 0

    def check(condition, message):
        nonlocal checks
        if not condition:
            raise ValueError(message)
        checks += 1

    def read(name):
        return json.loads((HERE / name).read_text(encoding='utf-8'))

    def unique(items, label):
        check(len(items) == len(set(items)), 'Duplicate ' + label)
        return set(items)

    def local_reference(target, context):
        file_part, separator, fragment = target.partition('#')
        path = HERE / unquote(file_part) if file_part else HERE / context
        check(path.is_file(), 'Missing design reference: ' + target)
        if separator and fragment and path.suffix == '.md':
            counts, anchors = {}, set()
            for heading in re.findall(r'^#{1,6}\s+(.+?)\s*#*$', path.read_text(encoding='utf-8'), re.MULTILINE):
                base = re.sub(r'[^\w\- ]', '', heading.lower()).replace(' ', '-')
                count = counts.get(base, 0)
                counts[base] = count + 1
                anchors.add(base if count == 0 else f'{base}-{count}')
            check(unquote(fragment) in anchors, 'Missing design anchor: ' + target)

    foundation = read('foundation.json')
    requirements = read('design-requirements.json')
    relational = read('relational-design.json')
    security = read('behavior-security-design.json')
    for name in ['requirements-traceability.md', 'relational-design.md', 'behavior-security-design.md', 'quality-operations.md']:
        local_reference(name, name)
        for target in re.findall(r'\]\(([^)]+)\)', (HERE / name).read_text(encoding='utf-8')):
            target = target.strip('<>')
            if '://' not in target:
                local_reference(target, name)
    fields = {r['name'] + '.' + f[0] for r in foundation['records'] for f in r['fields']}
    constraints = {r['name'] + '#' + str(i + 1): value for r in foundation['records']
                   for i, value in enumerate(r['constraints'])}
    types = set(foundation['types'])
    families = {c['id'] for c in foundation['cases']}
    check(set(requirements['field_catalog']) == fields, 'Field catalog differs from contract')
    check({c['id']: c['text'] for c in requirements['constraint_catalog']} == constraints,
          'Constraint catalog differs from contract')
    check(set(requirements['type_catalog']) == types, 'Type catalog differs from contract')
    check(requirements['source_baseline'] == security['sourceBaseline'] == foundation['baseline'],
          'Source baseline disagreement')
    check(requirements['foundation_version'] == relational['foundation_version'] == foundation['version'],
          'Contract version disagreement')
    source_ids = unique([s['id'] for s in requirements['sources']], 'requirement source')
    for source in requirements['sources']:
        path = (HERE / source['path']).resolve()
        check(path.is_file() and source['anchor'] in path.read_text(encoding='utf-8'),
              'Missing source/anchor: ' + source['id'])
    owners = unique([o['id'] for o in requirements['owners']], 'owner')
    for owner in requirements['owners']:
        check(bool(owner['responsibility']) and bool(owner['paths']), 'Unallocated owner')
        for path in owner['paths']:
            check((ROOT / path).is_file(), 'Missing existing owner: ' + path)
    extra_types = {t['name'] for t in requirements['external_type_refs']}
    for ref in requirements['external_type_refs']:
        check(ref['anchor'] in (ROOT / ref['source_path']).read_text(encoding='utf-8'),
              'Missing reused type: ' + ref['name'])
    reqs = {r['id']: r for r in requirements['requirements']}
    cases = {c['id']: c for c in requirements['verification_cases']}
    unique([r['id'] for r in requirements['requirements']], 'requirement')
    unique([c['id'] for c in requirements['verification_cases']], 'verification case')
    covered_fields, covered_constraints, covered_types = set(), set(), set()
    for identity, req in reqs.items():
        check(all(req.get(k) for k in ['statement', 'scope', 'rationale', 'owner', 'source_ids', 'case_ids', 'gate']),
              'Incomplete requirement: ' + identity)
        check(req['owner'] in owners and set(req['source_ids']) <= source_ids, 'Unknown allocation: ' + identity)
        check(set(req['fields']) <= fields and set(req['constraints']) <= set(constraints), 'Unknown contract target: ' + identity)
        check(set(req['type_refs']) <= types | extra_types, 'Unknown nested type: ' + identity)
        check(req['runtime_status'] == 'not_executed', 'Unsupported runtime completion: ' + identity)
        check(set(req['case_ids']) <= set(cases), 'Missing verification: ' + identity)
        check(bool(req.get('design_refs')), 'Missing design reference: ' + identity)
        for target in req['design_refs']:
            local_reference(target, 'requirements-traceability.md')
        for case_id in req['case_ids']:
            check(identity in cases[case_id]['requirement_ids'], 'Broken reverse case trace: ' + identity)
        covered_fields.update(req['fields'])
        covered_constraints.update(req['constraints'])
        covered_types.update(set(req['type_refs']) & types)
    check(covered_fields == fields, 'Unallocated fields: ' + str(fields - covered_fields))
    check(covered_constraints == set(constraints), 'Unallocated record constraints')
    check(covered_types == types, 'Unallocated nested types')
    check({c['parent_case'] for c in cases.values() if c['parent_case']} == families, 'Unallocated FS families')
    for identity, case in cases.items():
        check(all(case.get(k) for k in ['requirement_ids', 'method', 'fixture', 'procedure', 'oracle', 'evidence']),
              'Incomplete verification procedure: ' + identity)
        check(set(case['method']) <= {'inspection', 'analysis', 'test', 'demonstration'}, 'Unknown verification method')
        check(set(case['requirement_ids']) <= set(reqs), 'Unknown case requirement')
        check(case['execution_status'] == 'specified_not_executed', 'Unsupported execution claim')
        for req_id in case['requirement_ids']:
            check(identity in reqs[req_id]['case_ids'], 'Broken forward case trace: ' + identity)
    for need in requirements['deferred_needs']:
        check(all(need.get(k) for k in ['source_ids', 'need', 'milestone', 'gate', 'reason', 'preserved_by']), 'Unexplained deferral')
        check(set(need['source_ids']) <= source_ids and set(need['preserved_by']) <= set(reqs), 'Untraced deferral')
    for key, expected in [('quality_trace', {f'QA{i:02}' for i in range(1, 13)}),
                          ('decision_trace', {f'AD{i:02}' for i in range(1, 9)}),
                          ('operating_trace', {f'OE-T{i:02}' for i in range(1, 7)})]:
        check(unique([x['id'] for x in requirements[key]], key) == expected, 'Incomplete quality/operations trace')
        for row in requirements[key]:
            check(bool(row['requirements']) and set(row['requirements']) <= set(reqs), 'Invalid quality allocation')
            check(row['id'] in (HERE / 'quality-operations.md').read_text(encoding='utf-8'), 'Missing quality artifact')

    rd_ids = unique([r['id'] for r in relational['storage_responsibilities']], 'storage responsibility')
    for source in relational['source_evidence']:
        text = (ROOT / source['path']).read_text(encoding='utf-8')
        for anchor in source['anchors']:
            check(anchor in text, 'Missing relational source anchor: ' + source['path'] + ' / ' + anchor)
    check(unique([m['field'] for m in relational['field_mapping']], 'storage field') == fields, 'Incomplete physical mapping')
    for mapping in relational['field_mapping']:
        check(bool(mapping['relations']) and set(mapping['relations']) <= rd_ids and bool(mapping['storage_or_derivation']),
              'Unallocated physical field: ' + mapping['field'])
    unique([r['id'] for r in relational['relations']], 'logical relation')
    relation_rows = []
    for rel in relational['relations']:
        identity, attrs, fds = rel['id'], set(rel['attributes']), rel['functional_dependencies']
        check(len(attrs) == len(rel['attributes']), 'Duplicate attribute: ' + identity)
        check(bool(attrs) and bool(rel['candidate_keys']) and bool(rel['redundancy_owner']), 'Incomplete relation: ' + identity)
        for fd in fds:
            check(set(fd['determinant']) <= attrs and set(fd['dependent']) <= attrs, 'FD outside schema: ' + identity)
        keys = [set(key) for key in rel['candidate_keys']]
        check(set(rel['primary_key']) in keys, 'Primary key not candidate: ' + identity)
        for key in keys:
            check(key <= attrs and closure(key, fds) == attrs, 'Declared key is not a superkey: ' + identity)
            check(all(closure(key - {attribute}, fds) != attrs for attribute in key), 'Nonminimal key: ' + identity)
        prime = set().union(*keys)
        bcnf_bad, third_bad = [], []
        for fd in fds:
            lhs = set(fd['determinant'])
            nontrivial = set(fd['dependent']) - lhs
            if nontrivial and closure(lhs, fds) != attrs:
                bcnf_bad.append(fd)
                if nontrivial - prime:
                    third_bad.append(fd)
        form = rel['declared_normal_form']
        check(form in {'BCNF', '3NF', 'projection', 'document'}, 'Unknown normal-form claim')
        check(form != 'BCNF' or not bcnf_bad, 'False BCNF declaration: ' + identity)
        check(form != '3NF' or not third_bad, 'False 3NF declaration: ' + identity)
        relation_rows.append((identity, rel['name'], len(attrs), len(keys), form,
                              'declared FD/key analysis passed' if form in {'BCNF', '3NF'} else
                              'keys checked; no normal-form certification'))
    decomposition_rows = []
    for decomp in relational['decompositions']:
        left, right = set(decomp['left']), set(decomp['right'])
        universe, intersection = set(decomp['universal_attributes']), left & right
        fds = decomp['functional_dependencies']
        check(left | right == universe and intersection == set(decomp['intersection']), 'Invalid binary decomposition')
        for fd in fds:
            check(set(fd['determinant']) | set(fd['dependent']) <= universe, 'Decomposition FD outside schema')
        common = closure(intersection, fds)
        check(left <= common or right <= common, 'Unproved lossless join: ' + decomp['id'])
        projected = projected_dependencies(left, fds) + projected_dependencies(right, fds)
        preserved = all(set(fd['dependent']) <= closure(fd['determinant'], projected) for fd in fds)
        check(preserved, 'Dependency-losing decomposition needs explicit disposition: ' + decomp['id'])
        decomposition_rows.append((decomp['id'], 'lossless by intersection closure', 'all declared FDs preserved'))
    check(relational['policies']['D02_seconds'] == 3600 and relational['policies']['automatic_final_read_retry'] is False,
          'Policy or retry design drift')

    model_ids = set()
    for name in ['owners', 'boundaries', 'transitions', 'authorization', 'controls', 'oracles', 'residualRisks', 'sequences', 'adapters']:
        group_ids = unique([row['id'] for row in security[name]], 'security ' + name)
        check(not (group_ids & model_ids), 'Security ID reused across groups')
        model_ids.update(group_ids)
    control_ids = {x['id'] for x in security['controls']}
    oracle_ids = {x['id'] for x in security['oracles']}
    transition_ids = {x['id'] for x in security['transitions']}
    for key, expected in [('security_trace', control_ids), ('security_oracle_trace', oracle_ids)]:
        check(unique([x['id'] for x in requirements[key]], key) == expected, 'Incomplete security requirement trace')
        for row in requirements[key]:
            check(bool(row['requirements']) and set(row['requirements']) <= set(reqs), 'Invalid security allocation')
    model_catalogs = {'storage_responsibilities': rd_ids, 'transitions': transition_ids, 'controls': control_ids,
                      'quality_scenarios': {f'QA{i:02}' for i in range(1, 13)},
                      'architecture_decisions': {f'AD{i:02}' for i in range(1, 9)},
                      'operating_tests': {f'OE-T{i:02}' for i in range(1, 7)},
                      'security_oracles': oracle_ids, 'review_gates': {f'G{i}' for i in range(1, 8)}}
    allocated_model_ids = {kind: set() for kind in model_catalogs}
    for identity, req in reqs.items():
        allocation = req.get('design_allocations', {})
        check(bool(allocation) and set(allocation) <= set(model_catalogs), 'Unknown or absent model allocation: ' + identity)
        check(any(allocation.values()), 'Unallocated requirement: ' + identity)
        for kind, ids in allocation.items():
            check(set(ids) <= model_catalogs[kind], 'Missing design element: ' + identity)
            allocated_model_ids[kind].update(ids)
    for kind, expected in model_catalogs.items():
        check(allocated_model_ids[kind] == expected, 'Design element has no requirement rationale: ' + kind)
        reverse = requirements['model_trace'][kind]
        check(unique([row['id'] for row in reverse], 'reverse ' + kind) == expected, 'Incomplete reverse model catalog')
        for row in reverse:
            actual = {identity for identity, req in reqs.items() if row['id'] in req['design_allocations'].get(kind, [])}
            check(set(row['requirements']) == actual, 'Forward/reverse model allocation differs: ' + row['id'])
    for transition in security['transitions']:
        check(all(transition.get(k) for k in ['trigger', 'from', 'to', 'input', 'guard', 'owner', 'atomic', 'output', 'failure', 'recovery']),
              'Incomplete composed transition: ' + transition['id'])
        check(bool(transition['oracles']) and set(transition['oracles']) <= oracle_ids, 'Missing transition oracle')
    for row in security['controls']:
        check(set(row['caseIds']) <= families and bool(row['oracle']) and set(row['oracle']) <= oracle_ids,
              'Untraced security control: ' + row['id'])
    for row in security['authorization']:
        check(bool(row['controls']) and set(row['controls']) <= control_ids, 'Untraced permission rule')
    for row in security['oracles']:
        check(all(row.get(k) for k in ['fixture', 'schedule', 'expected', 'proof']), 'Missing independent security oracle')
        check(row['status'] == 'specified_not_executed', 'Unsupported security execution claim')
    for row in security['sequences']:
        check(bool(row['steps']) and set(row['steps']) <= transition_ids, 'Sequence references missing transition')
    asvs_ids = []
    for row in security['asvs']:
        check(bool(row['reason']) and set(row['controls']) <= control_ids, 'Unallocated ASVS selection')
        for identifier in row['ids']:
            check(re.fullmatch(r'v5\.0\.0-\d+\.\d+\.\d+', identifier) is not None, 'Unversioned ASVS reference')
            asvs_ids.append(identifier)
    readable = render_requirements(requirements)
    if args.write:
        (HERE / requirements['readable_view']).write_text(readable, encoding='utf-8', newline='\n')
    check((HERE / requirements['readable_view']).read_text(encoding='utf-8') == readable, 'Requirements generated view differs')
    summary = {'status': 'passed', 'model_assertions': checks, 'requirements': len(reqs),
               'specified_verification_cases': len(cases), 'fields': len(fields), 'record_constraints': len(constraints),
               'nested_types': len(types), 'acceptance_families': len(families), 'logical_relations': len(relation_rows),
               'normal_form_claims': dict(Counter(r[4] for r in relation_rows)),
               'lossless_dependency_preserving_decompositions': len(decomposition_rows),
               'transitions': len(transition_ids), 'security_controls': len(control_ids), 'security_oracles': len(oracle_ids),
               'selected_asvs_references': len(set(asvs_ids)), 'runtime_cases_executed': 0}
    lines = ['# Reproducible design analysis', '',
             'Generated by `verify_design.py` from the declared design. This is a model analysis, not SQL, runtime, provider or production qualification.', '',
             '```json', json.dumps(summary, indent=2), '```', '',
             '## Candidate keys and declared functional dependencies', '',
             'Attribute closure checks every declared candidate key for sufficiency and minimality. BCNF/3NF checks use the declared functional dependencies. Omitted semantic dependencies could change the result; independent domain review remains necessary. Immutable documents and constrained projections are explicitly outside normal-form certification. Null/conditional rules require the stated PostgreSQL constraints and later SQL qualification.', '',
             '| Relation | Name | Attributes | Candidate keys | Declared form | Analysis |', '| --- | --- | --- | --- | --- | --- |']
    lines += ['| ' + ' | '.join(map(str, row)) + ' |' for row in relation_rows]
    lines += ['', '## Binary decomposition', '',
              'For each declared decomposition, the common attributes determine one component under F+. Exact finite projection of F+ onto both components preserves every declared original dependency. This is a proof over the declared relation model; SQL NULLs, JSON internals and actual constraints are separately qualified.', '',
              '| Decomposition | Losslessness | Dependency preservation |', '| --- | --- | --- |']
    lines += ['| ' + ' | '.join(row) + ' |' for row in decomposition_rows]
    lines += ['', '## Evidence boundaries', '',
              'Forward/reverse requirement and case links, complete declared field/constraint/type/family allocation, storage coverage, source anchors, and model references are checked. These checks do not automatically establish requirement quality, complete threat coverage, actual DB privilege/lock enforcement or intended-use validation. All specified runtime cases remain unexecuted. G6 and G7 are open.', '']
    report = '\n'.join(lines)
    if args.write:
        (HERE / 'design-analysis.md').write_text(report, encoding='utf-8', newline='\n')
    check((HERE / 'design-analysis.md').read_text(encoding='utf-8') == report, 'Design analysis report differs')
    print(json.dumps(summary))


if __name__ == '__main__':
    main()
