# Issue Change Contract Example

When opening an issue that proposes code changes, attach a change contract
as a YAML code block so `repo-guard` can validate it:

```repo-guard-yaml
change_type: feature
scope:
  - src/auth.mjs
  - src/middleware/**
budgets:
  max_new_files: 5
  max_new_docs: 1
surface_debt:
  kind: temporary_growth
  reason: Add temporary adapter before deleting the old middleware path
  expected_delta:
    max_new_files: 1
    max_net_added_lines: 80
  repayment_issue: 456
anchors:
  affects:
    - FR-014
  implements:
    - FR-014
  verifies:
    - FR-014
must_touch:
  - src/auth.mjs
must_not_touch:
  - migrations/
expected_effects:
  - New /login and /logout endpoints
```
