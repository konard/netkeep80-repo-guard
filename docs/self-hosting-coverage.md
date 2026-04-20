# Self-hosting coverage

`repo-guard` treats dogfooding as a hard invariant: every surviving capability
must be used by the repo itself, or explicitly marked `not_self_hosted` with a
written rationale.

The **single source of truth is
[`docs/self-hosting-coverage.json`](self-hosting-coverage.json)**. That file
carries the full capability → self-use map and is loaded by
`tests/test-self-hosting.mjs`, which enforces the invariant in CI.

This Markdown file intentionally stays short so the JSON is not duplicated in
two places. To add, move, or retire a capability, edit the JSON: set `status`
to `self_used` with a concrete `self_use` pointer, or to `not_self_hosted`
with a non-empty `rationale`. The test run will fail if a declared self-use
cannot be confirmed in `repo-policy.json` / CI, if a rationale is missing, or
if a new top-level schema property appears without a matching entry.
