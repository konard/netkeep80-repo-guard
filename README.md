# repo-guard

Executable repository policy enforcement via JSON Schema validation and diff-based checks.

## What it does

`repo-guard` formalizes repository rules as machine-readable JSON and enforces them against actual changes:

- **`repo-policy.json`** — declares what is allowed: forbidden paths, file budgets, content rules, co-change rules, operational paths.
- **Change contract** — a JSON document describing a proposed change: scope, budgets, files to touch/avoid, expected effects.
- **JSON Schemas** — validate both the policy and contracts, preventing malformed data.
- **CLI runner** (`src/repo-guard.mjs`) — validates policy/contracts and runs diff-based enforcement checks.

### Diff-based enforcement (`check-diff`)

- Forbidden path detection (glob patterns)
- Canonical docs budget (max new `.md` files)
- New files budget
- Net added lines budget (added − deleted)
- Co-change rules (if X changed, Y must also change)
- Content rules (forbid regex patterns in added lines)
- `must_touch` / `must_not_touch` validation (from change contracts)
- Operational paths (bot-artifact files excluded from checks)

### GitHub PR policy gate (`check-pr`)

- Extracts change-contract from PR body (fenced ` ```repo-guard-json ` block)
- Falls back to linked issue body (`Fixes #N` / `Closes #N` / `Resolves #N`)
- Validates extracted contract against schema
- Runs full diff-based enforcement between PR base and head
- Distinct error codes for missing contract, malformed JSON, schema violations, and policy violations

## What it does not do

- Post comments on GitHub PRs/issues.
- Act as a reusable GitHub Action.

These are planned for the next iteration.

## Quick start

```bash
npm install
node src/repo-guard.mjs                                  # validate repo-policy.json
node src/repo-guard.mjs path/to/contract.json            # also validate a change contract
node src/repo-guard.mjs check-diff                       # run diff checks against staged/HEAD
node src/repo-guard.mjs check-diff --base main --head feature  # compare branches
node src/repo-guard.mjs check-pr                              # PR policy gate (GitHub Actions)
npm test                                                  # run all tests
```

## Key entities

| Entity | File | Purpose |
|---|---|---|
| Repository policy | `repo-policy.json` | Declares repository rules |
| Policy schema | `schemas/repo-policy.schema.json` | Validates policy structure |
| Change contract schema | `schemas/change-contract.schema.json` | Validates change contracts |
| CLI runner | `src/repo-guard.mjs` | Validates and enforces policy |
| Diff checker | `src/diff-checker.mjs` | Diff analysis and rule checks |
| Contract extractor | `src/markdown-contract.mjs` | Extracts change-contract from markdown |
| GitHub PR integration | `src/github-pr.mjs` | PR policy gate for GitHub Actions |
| Templates | `templates/` | Starter policy and contract examples |

## License

[Unlicense](LICENSE)
