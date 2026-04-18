# Pull Request Change Contract Example

Include a YAML change contract in the PR description so `repo-guard` can
validate the proposed changes against the repository policy:

```repo-guard-yaml
change_type: bugfix
change_class: kernel-hardening
scope:
  - src/pagination.mjs
budgets:
  max_new_files: 0
  max_new_docs: 0
must_touch:
  - src/pagination.mjs
must_not_touch:
  - schemas/
  - repo-policy.json
expected_effects:
  - Pagination returns correct page count
```
