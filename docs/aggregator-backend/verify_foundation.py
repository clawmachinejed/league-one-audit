"""Offline documentation consistency only; no runtime/database/provider calls."""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
from urllib.parse import unquote


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]


def render(data: dict) -> str:
    def safe(value: str) -> str:
        return value.replace('|', '&#124;').replace('\n', ' ')

    lines = ['# First-slice fields and acceptance register', '',
             'Generated from [foundation.json](foundation.json); do not edit this view independently.', '',
             f"Version: **{data['version']}**. Status: **{data['status']}**. Baseline: `{data['baseline']}`.", '',
             'Logical records are not mandatory physical tables. Existing nested source/resource types are reused.', '',
             f"D02: `{data['policy']['version']}`, `max_membership_age_seconds = {data['policy']['max_membership_age_seconds']}`; approved, not deployed. L1 account access is unaffected.", '',
             '## Types', '', '| Type | Meaning |', '| --- | --- |']
    lines += [f'| `{name}` | {safe(value)} |' for name, value in data['types'].items()]
    traced = {name for item in data['capabilities'] for name in item['fields']}
    fields = sum(len(record['fields']) for record in data['records'])
    lines += ['', '## Capability trace', '',
              f'This selective index names {len(traced)} of {fields} fields. It is not a complete requirements or invariant verification matrix; see [methodology audit](methodology-audit.md).', '',
              '| Capability | Fields | Source facts | Acceptance |', '| --- | --- | --- | --- |']
    for item in data['capabilities']:
        lines.append(f"| {item['id']} | {safe(', '.join(item['fields']))} | {', '.join(item['sources'])} | {', '.join(item['cases'])} |")
    lines += ['', '## Source facts', '', '| ID | Source at baseline | Observation |', '| --- | --- | --- |']
    for source in data['sources']:
        lines.append(f"| {source['id']} | [{source['path']}](../../{source['path']}) — `{safe(source['anchor'])}` | {safe(source['fact'])} |")
    for record in data['records']:
        lines += ['', f"## {record['name']}", '', f"Disposition: {record['kind']}. Key: `{record['key']}`.", '',
                  'Sources: ' + ', '.join(record['sources']) + '.', '',
                  'Constraints: ' + ' '.join(record['constraints']), '',
                  '| Field | Type | Source | Null, relationship and acceptance rule |', '| --- | --- | --- | --- |']
        for field in record['fields']:
            lines.append('| ' + ' | '.join(safe(x) for x in field) + ' |')
        if 'variants' in record:
            lines += ['', 'Exact result variants (all listed keys required; additional keys prohibited):', '',
                      '| Status | Required keys | Rules |', '| --- | --- | --- |']
            for status, variant in record['variants'].items():
                lines.append(f"| {status} | {', '.join(variant['required'])} | {safe('; '.join(variant['rules']))} |")
    lines += ['', '## Open product decisions', '', '| ID | Decision | Activation gate |', '| --- | --- | --- |']
    for item in data['open_decisions']:
        lines.append(f"| {item['id']} | {item['decision']} | {item['gate']} |")
    lines += ['', '## Acceptance cases (specified, not executed)', '', '| ID | Observable pass condition |', '| --- | --- |']
    lines += [f"| {item['id']} | {safe(item['pass'])} |" for item in data['cases']]
    return '\n'.join(lines) + '\n'


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--write', action='store_true', help='Regenerate the readable field view')
    args = parser.parse_args()
    data = json.loads((HERE / 'foundation.json').read_text(encoding='utf-8'))
    checks = 0

    def check(condition: bool, message: str) -> None:
        nonlocal checks
        if not condition:
            raise ValueError(message)
        checks += 1

    source_ids = [x['id'] for x in data['sources']]
    check(len(source_ids) == len(set(source_ids)), 'Duplicate source ID')
    for source in data['sources']:
        path = ROOT / source['path']
        check(path.is_file(), f"Missing source: {source['path']}")
        check(source['anchor'] in path.read_text(encoding='utf-8'), f"Missing source anchor: {source['id']}")
    record_names = [x['name'] for x in data['records']]
    check(len(record_names) == len(set(record_names)), 'Duplicate record')
    all_fields = set()
    for record in data['records']:
        check(bool(record['key']) and bool(record['constraints']), f"Missing identity/constraint: {record['name']}")
        check(set(record['sources']) <= set(source_ids), f"Unknown record source: {record['name']}")
        for field in record['fields']:
            check(len(field) == 4 and all(isinstance(x, str) and x for x in field), 'Invalid field definition')
            name = record['name'] + '.' + field[0]
            check(name not in all_fields, 'Duplicate field: ' + name)
            all_fields.add(name)
        if 'variants' in record:
            names = {field[0] for field in record['fields']}
            for status, variant in record['variants'].items():
                check(set(variant['required']) <= names, 'Unknown variant field: ' + status)
                check(len(set(variant['required'])) == len(variant['required']), 'Duplicate variant field')
                check(variant['additionalFields'] is False and bool(variant['rules']), 'Unbounded result variant')
            if record['name'] == 'ReadCurrentRosterResult':
                check(set(record['variants']) == {'available', 'pending', 'unavailable', 'denied', 'indeterminate'}, 'Result status drift')
                for status in ['denied', 'indeterminate']:
                    check(set(record['variants'][status]['required']) == {'status', 'reason'}, 'Denied result metadata leak')
    cases = [x['id'] for x in data['cases']]
    check(len(cases) == len(set(cases)), 'Duplicate acceptance case')
    check(set(cases) == {f'FS{i:02}' for i in range(1, 23)}, 'Acceptance ID drift')
    covered = set()
    for capability in data['capabilities']:
        check(set(capability['fields']) <= all_fields, 'Unknown capability field')
        check(set(capability['sources']) <= set(source_ids), 'Unknown capability source')
        check(set(capability['cases']) <= set(cases), 'Unknown capability case')
        covered.update(capability['cases'])
    check(covered == set(cases), 'Untraced acceptance case')
    check({x['id'] for x in data['open_decisions']} == {'D03', 'D04', 'D05'}, 'Open-decision drift')
    policy = data['policy']
    historical = json.loads((HERE / policy['approval_evidence']).read_text(encoding='utf-8'))
    approved = historical['policies'][0]['versions'][0]
    check(policy['version'] == approved['policy_version'] == 'sleeper-membership-access-v1', 'D02 version drift')
    check(policy['max_membership_age_seconds'] == approved['parameters']['max_membership_age_seconds'] == 3600, 'D02 value drift')
    check(policy['clock_origin'] == approved['clock_origin'], 'D02 origin drift')
    check(policy['deployment_status'] == 'not_deployed' and policy['account_access_affected'] is False, 'D02 status drift')
    for name in ['README.md', 'contracts.md']:
        content = (HERE / name).read_text(encoding='utf-8')
        check(policy['version'] in content and ('3600' in content or '3,600' in content), 'Readable D02 drift')
    contracts = (HERE / 'contracts.md').read_text(encoding='utf-8')
    check('Public Sleeper links remain user-asserted and nonexclusive.' not in contracts, 'Superseded target survived')
    check('(SourceScope, canonicalNormalizerVersion, validationVersion)' in contracts, 'Head identity drift')
    checkpoint = json.loads((HERE / 'evidence/source-checkpoint.json').read_text(encoding='utf-8'))
    check(checkpoint['source_baseline'] == data['baseline'], 'Source baseline drift')
    check(checkpoint['source_hash_algorithm'] == 'sha256-lf-v1', 'Unknown source hash algorithm')
    for entry in checkpoint['source_files']:
        actual = hashlib.sha256((ROOT / entry['path']).read_bytes().replace(b'\r\n', b'\n')).hexdigest()
        check(actual == entry['sha256'], 'Source changed; revalidate evidence: ' + entry['path'])
    # This closes inventory omissions, not the design or verification gates.
    nasa_counts = {'4.1': 10, '4.2': 7, '4.3': 3, '4.4': 10,
                   '5.1': 3, '5.2': 7, '5.3': 4, '5.4': 4, '5.5': 5,
                   '6.1': 7, '6.2': 6, '6.3': 5, '6.4': 7, '6.5': 6,
                   '6.6': 3, '6.7': 3, '6.8': 7}
    expected_activities = {
        f'NASA-{process}.1.2.{i}' if process != '6.5' or i < 5
        else f'NASA-6.5.activity{i}'
        for process, count in nasa_counts.items() for i in range(1, count + 1)
    }
    for family, count in [('QAW', 8), ('ATAM', 9), ('DB', 10)]:
        expected_activities.update(f'{family}-{i}' for i in range(1, count + 1))
    ssdf = {'PO.1': [1, 2, 3], 'PO.2': [1, 2, 3], 'PO.3': [1, 2, 3],
            'PO.4': [1, 2], 'PO.5': [1, 2], 'PS.1': [1], 'PS.2': [1], 'PS.3': [1, 2],
            'PW.1': [1, 2, 3], 'PW.2': [1], 'PW.4': [1, 2, 4], 'PW.5': [1],
            'PW.6': [1, 2], 'PW.7': [1, 2], 'PW.8': [1, 2], 'PW.9': [1, 2],
            'RV.1': [1, 2, 3], 'RV.2': [1, 2], 'RV.3': [1, 2, 3, 4]}
    expected_activities.update(f'SSDF-{practice}.{i}' for practice, tasks in ssdf.items() for i in tasks)
    activity_rows = re.findall(r'^\| ((?:NASA|QAW|ATAM|DB|SSDF)-\S+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \|$',
                               (HERE / 'methodology-steps.md').read_text(encoding='utf-8'), re.MULTILINE)
    activity_ids = [row[0] for row in activity_rows]
    check(len(activity_ids) == len(set(activity_ids)), 'Duplicate methodology activity')
    check(set(activity_ids) == expected_activities, 'Missing or unexpected methodology activity')
    for identity, focus, status, evidence in activity_rows:
        check(status.strip() in {'documented', 'partial', 'gap', 'deferred', 'unassessed'}
              and bool(focus.strip()) and bool(evidence.strip()), 'Missing methodology disposition: ' + identity)

    def markdown_anchors(path: Path) -> set[str]:
        counts: dict[str, int] = {}
        anchors = set()
        for heading in re.findall(r'^#{1,6}\s+(.+?)\s*#*$', path.read_text(encoding='utf-8'), re.MULTILINE):
            base = re.sub(r'[^\w\- ]', '', heading.lower()).replace(' ', '-')
            count = counts.get(base, 0)
            counts[base] = count + 1
            anchors.add(base if count == 0 else f'{base}-{count}')
        return anchors

    for name in ['README.md', 'contracts.md', 'migration.md', 'foundation-fields.md', 'reconciliation.md',
                 'verification.md', 'methodology-audit.md', 'methodology-steps.md']:
        path = HERE / name
        # --write may run before a new view/report is created during authoring.
        if args.write and not path.exists():
            continue
        check(path.is_file(), 'Missing target document: ' + name)
        for target in re.findall(r'\]\(([^)]+)\)', path.read_text(encoding='utf-8')):
            target = target.strip('<>')
            if '://' in target:
                continue
            file_part, separator, fragment = target.partition('#')
            destination = path.parent / unquote(file_part) if file_part else path
            check(destination.exists(), 'Broken local link: ' + name + ' -> ' + target)
            if separator and fragment and destination.suffix == '.md':
                check(unquote(fragment) in markdown_anchors(destination), 'Broken local anchor: ' + name + ' -> ' + target)
    manifest = json.loads((HERE / 'evidence/backend-workspace-handoff-manifest.json').read_text(encoding='utf-8'))
    for name in ['backend-workspace-handoff.md', 'backend-policy-register.json']:
        expected = next(x['sha256'] for x in manifest['artifacts'] if x['path'] == name)
        actual = hashlib.sha256((HERE / 'evidence' / name).read_bytes()).hexdigest()
        check(actual == expected, 'Transition evidence hash mismatch: ' + name)
    expected_view = render(data)
    view = HERE / data['field_view']
    if args.write:
        view.write_text(expected_view, encoding='utf-8', newline='\n')
    check(view.read_text(encoding='utf-8') == expected_view, 'Generated view differs; review JSON and use --write')
    print(json.dumps({'status': 'passed', 'checks': checks, 'records': len(data['records']),
                      'fields': len(all_fields), 'capabilities': len(data['capabilities']),
                      'capability_index_fields': len({field for item in data['capabilities'] for field in item['fields']}),
                      'specified_acceptance_cases': len(cases), 'methodology_activity_dispositions': len(activity_ids),
                      'runtime_cases_executed': 0}))


if __name__ == '__main__':
    main()
