# Pull Request Change Contract Example

Include a YAML change contract in the PR description so `repo-guard` can
validate the proposed changes against the repository policy:

```repo-guard-yaml
change_type: bugfix
scope:
  - src/pagination.mjs
budgets:
  max_new_files: 0
  max_new_docs: 0
surface_debt:
  kind: temporary_growth
  reason: Introduce extraction path before removing duplicated code
  expected_delta:
    max_new_files: 1
    max_net_added_lines: 60
  repayment_issue: 123
anchors:
  affects:
    - FR-014
  implements:
    - FR-014
  verifies:
    - FR-014
must_touch:
  - src/pagination.mjs
must_not_touch:
  - schemas/
  - repo-policy.json
expected_effects:
  - Pagination returns correct page count
```
