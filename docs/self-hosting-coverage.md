# Self-hosting coverage

`repo-guard` treats dogfooding as a hard invariant: every surviving capability
must be used by the repo itself, or explicitly marked as `not_self_hosted` with
a written rationale. This document is the human-readable view of the invariant.
The machine-checkable source is
[`docs/self-hosting-coverage.json`](self-hosting-coverage.json) and
`tests/test-self-hosting.mjs` enforces it in CI.

## Why it exists

Without dogfooding, a feature that exists "just in case" drifts from the
supported surface: tests keep it green, docs describe it, but nothing in the
repository depends on it. That is the trigger the issue calls out: if a
capability cannot be used on this repo in an honest way, it should be removed
rather than kept as abstract ballast.

## How to update

1. Edit [`docs/self-hosting-coverage.json`](self-hosting-coverage.json) when
   you add, remove, or move a capability.
2. If a capability is `self_used`, point `self_use` at the exact file or
   policy key inside this repo that exercises it.
3. If a capability is `not_self_hosted`, write an explicit `rationale` that
   says why using it here would be fake coverage. Never leave a capability
   without a status.
4. Run `npm run test:self-hosting` to re-check the matrix. The test fails if
   a declared self-use cannot be confirmed in `repo-policy.json` / CI, if a
   rationale is missing, or if a new top-level rule family appears in the
   schema without a matching entry.

## Coverage matrix

### Top-level CLI commands

| Command | Status | Self-use |
| --- | --- | --- |
| `validate` (default) | self-used | `.github/workflows/ci.yml` step "Validate repo-policy.json" |
| `check-pr` | self-used | `.github/workflows/ci.yml` step "Run PR policy check" |
| `check-diff` | self-used | `.github/workflows/ci.yml` step "Exercise advisory policy mode" |
| `init` | self-used | `tests/test-init.mjs` (scaffolding exercised against a temp dir; not re-run on this repo because governance files are already hand-authored) |
| `doctor` | self-used | `.github/workflows/ci.yml` step "Run doctor diagnostics on self" |
| `validate-integration` | self-used | `.github/workflows/ci.yml` step "Run validate-integration on self" |

### Enforcement modes

| Mode | Status | Self-use |
| --- | --- | --- |
| `blocking` | self-used | `repo-policy.json:enforcement.mode` + CI PR gate `enforcement: blocking` |
| `advisory` | self-used | CI step "Exercise advisory policy mode" asserts WARN output and exit 0 |

### Contract extraction paths

| Path | Status | Self-use |
| --- | --- | --- |
| `repo-guard-yaml` in PR body | self-used | `.github/PULL_REQUEST_TEMPLATE.md` |
| `repo-guard-yaml` in linked issue | self-used | `.github/ISSUE_TEMPLATE/change-contract.yml` |
| `repo-guard-json` in PR body | not self-hosted | YAML is the canonical advertised form; duplicating a JSON block in the same PR template would be fake coverage. JSON remains supported for external users and is covered by `tests/test-markdown-contract.mjs`. |

### Integration checks

| Check | Status | Self-use |
| --- | --- | --- |
| `integration.workflows` | self-used | `repo-policy.json:integration.workflows[0]` with full `expect` block |
| `integration.templates` (markdown) | self-used | `repo-policy.json:integration.templates[pull-request-template]` |
| `integration.templates` (github_issue_form) | self-used | `repo-policy.json:integration.templates[change-contract-issue-form]` |
| `integration.docs` | self-used | `repo-policy.json:integration.docs[readme]` with `must_mention_profiles` and `must_mention_contract_fields` |
| `integration.profiles` | self-used | `repo-policy.json:integration.profiles[self-hosting]` |

### Rule families

| Rule family | Status | Self-use |
| --- | --- | --- |
| `forbidden-paths` | self-used | `repo-policy.json:paths.forbidden` forbids `docs/phase-*`, `docs/history-*`, `*.bak` |
| `diff_rules` budgets | self-used | `repo-policy.json:diff_rules` with `max_new_docs`, `max_new_files`, `max_net_added_lines` |
| `content-rules` | self-used | `no-todo-without-issue` forbids bare to-do markers |
| `cochange-rules` | self-used | `src/**` changes require `tests/**` changes |
| `surfaces` | self-used | `repo-policy.json:surfaces` declares source, tests, schemas, docs, examples, templates, scripts, governance, workflows |
| `new_file_classes` | self-used | `repo-policy.json:new_file_classes` mirrors the declared surfaces |
| `change_profiles` | self-used | Profiles for `feature`, `bugfix`, `refactor`, `docs`, `test` change types |
| `size_rules` | self-used | Advisory drift detector for `src/**/*.mjs` at 900 lines |
| `registry_rules` | not self-hosted | This repo has no canonical JSON-vs-Markdown list that would honestly cross-check. Covered by `tests/test-rule-registry.mjs` and the downstream examples. |
| `advisory_text_rules` | not self-hosted | README is the single canonical doc; synthetic duplicate Markdown would be fake coverage. Covered by the rule-family tests. |
| `anchors` | not self-hosted | No requirement JSON files or `@req`-style anchors live in this source tree. Covered by `tests/test-anchor-extractors.mjs` and downstream examples. |
| `trace_rules` | not self-hosted | Depend on anchor declarations; see `anchors`. Covered by `tests/test-trace-evidence-rules.mjs` and `examples/downstream-integration-policy.json`. |
| `profile: requirements-strict` | not self-hosted | The built-in profile requires `requirements/*.json` canonical files; creating a fake one here would be the exact fake coverage this effort rejects. Covered by `docs/requirements-strict-profile.md` and `tests/test-policy-profiles.mjs`. |

## What the machine check enforces

`tests/test-self-hosting.mjs` loads `docs/self-hosting-coverage.json` and:

- fails if any documented capability is missing a status;
- for every `self_used` capability, confirms the referenced policy key or CI
  step actually exists in this repo;
- for every `not_self_hosted` capability, confirms a non-empty rationale is
  recorded;
- fails if a new top-level field appears in `schemas/repo-policy.schema.json`
  without a matching entry in the matrix.
