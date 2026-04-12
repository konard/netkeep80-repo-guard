# Issue Change Contract Example

When opening an issue that proposes code changes, attach a change contract
as a JSON code block so `repo-guard` can validate it:

```repo-guard-json
{
  "change_type": "feature",
  "scope": ["src/auth.mjs", "src/middleware/**"],
  "budgets": {
    "max_new_files": 5,
    "max_new_docs": 1
  },
  "must_touch": ["src/auth.mjs"],
  "must_not_touch": ["migrations/"],
  "expected_effects": ["New /login and /logout endpoints"],
  "overrides": []
}
```
