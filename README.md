# repo-guard

Executable repository policy enforcement via JSON Schema validation.

## What it does

`repo-guard` formalizes repository rules as machine-readable JSON and validates changes against them:

- **`repo-policy.json`** — declares what is allowed in the repository: forbidden paths, file budgets, content rules.
- **Change contract** — a JSON document describing a proposed change: scope, budgets, files to touch/avoid, expected effects.
- **JSON Schemas** — validate both the policy and contracts, preventing malformed or garbage data.
- **CLI runner** (`src/repo-guard.mjs`) — loads the policy, validates it against its schema, and optionally validates a change contract.

## What it does not do

- Parse git diffs or PR content.
- Post comments on GitHub PRs/issues.
- Enforce budgets against actual file changes.
- Act as a reusable GitHub Action.

These are planned for future iterations.

## Quick start

```bash
npm install
node src/repo-guard.mjs                          # validate repo-policy.json
node src/repo-guard.mjs path/to/contract.json    # also validate a change contract
npm test                                          # run schema validation tests
```

## Key entities

| Entity | File | Purpose |
|---|---|---|
| Repository policy | `repo-policy.json` | Declares repository rules |
| Policy schema | `schemas/repo-policy.schema.json` | Validates policy structure |
| Change contract schema | `schemas/change-contract.schema.json` | Validates change contracts |
| CLI runner | `src/repo-guard.mjs` | Validates policy and contracts |
| Templates | `templates/` | Starter policy and contract examples |

## MVP roadmap

1. **v0.1** (this issue) — JSON models, schemas, CLI validator, CI.
2. **v0.2** — Diff-based budget enforcement against actual git changes.
3. **v0.3** — GitHub PR integration (auto-comments, status checks).

## License

[Unlicense](LICENSE)
