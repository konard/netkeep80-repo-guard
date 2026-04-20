## Summary

<!-- Briefly describe the changes in this PR. -->

## Change Contract

<!-- Keep this YAML block updated so repo-guard validates the intended change. -->
<!-- Changes to files listed in policy.paths.governance_paths must be sanctioned
     from the LINKED ISSUE body (not this PR body) via authorized_governance_paths. -->

```repo-guard-yaml
change_type: feature
scope:
  - src/
budgets: {}
anchors:
  affects:
    - FR-014
  implements:
    - FR-014
  verifies:
    - FR-014
must_touch: []
must_not_touch: []
expected_effects:
  - Describe the expected effect
```
