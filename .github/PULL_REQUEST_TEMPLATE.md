## Summary

<!-- Briefly describe the changes in this PR. -->

## Change Contract

<!-- Keep this YAML block updated so repo-guard validates the intended change. -->

```repo-guard-yaml
change_type: feature
change_class: kernel-hardening
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
