# requirements-strict Profile

`requirements-strict` is a built-in repo-guard policy profile for repositories
where requirement JSON files are the canonical source of traceability.

The profile is enabled with top-level `profile: "requirements-strict"`.
`repo-guard` validates the raw policy against the JSON Schema, expands the
profile into `anchors` and `trace_rules`, then compiles and runs the effective
policy. Repositories that already store expanded `anchors` or `trace_rules`
remain compatible: explicit policy sections take precedence over generated
profile sections.

## Generated Anchors

| Anchor type | Source |
| --- | --- |
| `requirement_id` | `id` fields in requirement JSON files |
| `requirement_json_req_ref` | Requirement IDs referenced inside requirement JSON |
| `code_req_ref` | `@req` and comma-separated requirement refs in code, tests, scripts, and examples |
| `doc_req_ref` | Requirement refs in Markdown files |
| `doc_heading_req_ref` | Bracketed requirement refs in strict heading docs |
| `doc_heading_without_req_ref` | Headings in strict heading docs that are missing a bracketed requirement ref |

## Generated Trace Rules

| Rule | Behavior |
| --- | --- |
| `requirement-json-req-refs-must-resolve` | Requirement refs inside requirement JSON must resolve to canonical `requirement_id` anchors |
| `code-req-refs-must-resolve` | Code/test/script/example refs must resolve |
| `doc-req-refs-must-resolve` | Markdown refs must resolve |
| `doc-heading-req-refs-must-resolve` | Bracketed heading refs must resolve |
| `doc-headings-must-have-req-ref` | Strict heading docs must not contain headings without bracketed requirement refs |
| `changed-requirements-need-evidence` | Changed requirement JSON files must be accompanied by an evidence surface |
| `declared-affected-anchors-need-evidence` | `anchors.affects` declarations must be accompanied by evidence |
| `declared-implemented-anchors-need-evidence` | `anchors.implements` declarations must be accompanied by implementation evidence |
| `declared-verified-anchors-need-evidence` | `anchors.verifies` declarations must be accompanied by verification evidence |

## Overrides

All override values are non-empty arrays of non-empty strings.

| Override | Default |
| --- | --- |
| `requirement_json_globs` | `requirements/business/*.json`, `requirements/stakeholder/*.json`, `requirements/functional/*.json`, `requirements/nonfunctional/*.json`, `requirements/constraints/*.json`, `requirements/interface/*.json` |
| `code_reference_globs` | `scripts/**/*.js`, `include/**/*.{h,hpp,hh}`, `src/**/*.{h,hpp,hh,c,cc,cpp,cxx}`, `tests/**/*.{h,hpp,hh,c,cc,cpp,cxx,js,mjs}`, `examples/**/*.{h,hpp,hh,c,cc,cpp,cxx,js,mjs}` |
| `doc_reference_globs` | `*.md`, `docs/**/*.md`, `requirements/**/*.md`, `.github/**/*.md` |
| `strict_heading_docs` | `docs/**/*.md` |
| `evidence_surfaces` | `src/**`, `tests/**`, `docs/**`, `README.md`, `requirements/README.md` |
| `changed_requirement_evidence_surfaces` | Falls back to `evidence_surfaces` |
| `affected_evidence_surfaces` | Falls back to `evidence_surfaces` |
| `implementation_evidence_surfaces` | `include/**`, `src/**`, `scripts/**`, `.github/workflows/**` |
| `verification_evidence_surfaces` | `tests/**`, `experiments/**`, `scripts/**`, `.github/workflows/**` |

Example:

```json
{
  "profile": "requirements-strict",
  "profile_overrides": {
    "strict_heading_docs": [
      "docs/architecture.md",
      "docs/pmm_requirements.md"
    ],
    "evidence_surfaces": [
      "include/**",
      "src/**",
      "tests/**",
      "examples/**",
      "docs/**",
      "README.md",
      "requirements/README.md",
      "scripts/**",
      ".github/workflows/**"
    ],
    "verification_evidence_surfaces": [
      "tests/**",
      "experiments/**",
      "scripts/**",
      ".github/workflows/**"
    ]
  }
}
```
