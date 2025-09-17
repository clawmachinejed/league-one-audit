- Judge only against audit/acceptance-contract.yml.
- Read audit/audit.json; report only failing checks, ordered by rule priority.
- For each failure: include Rule ID, evidence (file/selector/line), minimal change scope.
- Output two blocks:
  1. Machine-readable YAML: ruleId -> fail + notes.
  2. Human summary: Fix order with short why.
- If audit/mode.txt is "single-file:<path>", ignore issues outside that file EXCEPT BUILD-001 (red flags like broken typecheck).
