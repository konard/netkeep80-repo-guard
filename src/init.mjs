import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, relative, dirname } from "node:path";

const PRESETS = {
  application: {
    repository_kind: "application",
    paths: {
      forbidden: ["*.bak", "*.log"],
      canonical_docs: ["README.md"],
      governance_paths: ["repo-policy.json"],
    },
    diff_rules: { max_new_docs: 3, max_new_files: 20, max_net_added_lines: 1500 },
    content_rules: [],
    cochange_rules: [],
  },
  library: {
    repository_kind: "library",
    paths: {
      forbidden: ["*.bak"],
      canonical_docs: ["README.md", "CHANGELOG.md"],
      governance_paths: ["repo-policy.json"],
    },
    diff_rules: { max_new_docs: 2, max_new_files: 15, max_net_added_lines: 1000 },
    content_rules: [],
    cochange_rules: [{ if_changed: ["src/**"], must_change_any: ["tests/**"] }],
  },
  tooling: {
    repository_kind: "tooling",
    paths: {
      forbidden: ["*.bak"],
      canonical_docs: ["README.md"],
      governance_paths: ["repo-policy.json"],
    },
    diff_rules: { max_new_docs: 2, max_new_files: 15, max_net_added_lines: 2000 },
    content_rules: [],
    cochange_rules: [{ if_changed: ["src/**"], must_change_any: ["tests/**"] }],
  },
  documentation: {
    repository_kind: "documentation",
    paths: {
      forbidden: [],
      canonical_docs: ["README.md"],
      governance_paths: ["repo-policy.json"],
    },
    diff_rules: { max_new_docs: 10, max_new_files: 20 },
    content_rules: [],
    cochange_rules: [],
  },
};

const ADVISORY_OVERRIDES = {
  diff_rules: { max_new_docs: 10, max_new_files: 50, max_net_added_lines: 5000 },
};

function buildPolicy(preset, mode) {
  const base = JSON.parse(JSON.stringify(PRESETS[preset]));
  const policy = { policy_format_version: "0.3.0", ...base };
  if (mode === "advisory") {
    Object.assign(policy.diff_rules, ADVISORY_OVERRIDES.diff_rules);
  }
  return policy;
}

function buildWorkflow() {
  return `name: repo-guard policy check

on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]
    branches: [main]

jobs:
  policy-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Enforce repository policy
        uses: netkeep80/repo-guard@main
        with:
          mode: check-pr
        env:
          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
`;
}

function buildPRTemplate() {
  return `## Summary

<!-- Briefly describe the changes in this PR. -->

## Change Contract

<!-- Paste a change contract block so repo-guard can validate this PR. -->
<!-- See https://github.com/netkeep80/repo-guard for contract format. -->

\`\`\`repo-guard-json
{
  "change_type": "feature",
  "scope": ["src/"],
  "budgets": {},
  "must_touch": [],
  "must_not_touch": [],
  "expected_effects": ["Describe the expected effect"]
}
\`\`\`
`;
}

function buildIssueTemplate() {
  return `name: Change contract
description: Propose a code change with a repo-guard change contract.
title: "[change] "
body:
  - type: markdown
    attributes:
      value: |
        Describe the proposed change and include a change contract block.
  - type: textarea
    id: description
    attributes:
      label: Description
      description: What does this change do and why?
    validations:
      required: true
  - type: textarea
    id: contract
    attributes:
      label: Change Contract
      description: Paste a repo-guard change contract block.
      value: |
        \`\`\`repo-guard-json
        {
          "change_type": "feature",
          "scope": ["src/"],
          "budgets": {},
          "must_touch": [],
          "must_not_touch": [],
          "expected_effects": ["Describe the expected effect"]
        }
        \`\`\`
    validations:
      required: true
`;
}

function writeIfAbsent(filePath, content, created, skipped) {
  if (existsSync(filePath)) {
    skipped.push(filePath);
    return;
  }
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, "utf-8");
  created.push(filePath);
}

export function runInit(roots, args) {
  let preset = "application";
  let mode = "enforce";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--preset" && args[i + 1]) {
      preset = args[++i];
    } else if (args[i] === "--mode" && args[i + 1]) {
      mode = args[++i];
    } else if (args[i] === "--help") {
      printUsage();
      process.exit(0);
    } else {
      console.error(`Unknown option for init: ${args[i]}`);
      printUsage();
      process.exit(1);
    }
  }

  if (!PRESETS[preset]) {
    console.error(`Unknown preset: ${preset}`);
    console.error(`Available presets: ${Object.keys(PRESETS).join(", ")}`);
    process.exit(1);
  }

  if (mode !== "advisory" && mode !== "enforce") {
    console.error(`Unknown mode: ${mode}. Must be "advisory" or "enforce".`);
    process.exit(1);
  }

  const repoRoot = roots.repoRoot;
  const created = [];
  const skipped = [];

  const policyPath = resolve(repoRoot, "repo-policy.json");
  const policyContent = JSON.stringify(buildPolicy(preset, mode), null, 2) + "\n";
  writeIfAbsent(policyPath, policyContent, created, skipped);

  const workflowPath = resolve(repoRoot, ".github/workflows/repo-guard.yml");
  writeIfAbsent(workflowPath, buildWorkflow(), created, skipped);

  const prTemplatePath = resolve(repoRoot, ".github/PULL_REQUEST_TEMPLATE.md");
  writeIfAbsent(prTemplatePath, buildPRTemplate(), created, skipped);

  const issueTemplatePath = resolve(repoRoot, ".github/ISSUE_TEMPLATE/change-contract.yml");
  writeIfAbsent(issueTemplatePath, buildIssueTemplate(), created, skipped);

  console.log(`repo-guard init (preset: ${preset}, mode: ${mode})\n`);

  if (created.length > 0) {
    console.log("Created:");
    for (const f of created) console.log(`  ${relative(repoRoot, f)}`);
  }

  if (skipped.length > 0) {
    console.log("Skipped (already exist):");
    for (const f of skipped) console.log(`  ${relative(repoRoot, f)}`);
  }

  if (created.length === 0 && skipped.length > 0) {
    console.log("\nAll files already exist. Nothing to do.");
  } else if (created.length > 0) {
    console.log("\nNext steps:");
    console.log("  1. Review the generated files and adjust to your needs.");
    console.log("  2. Commit and push the changes.");
  }
}

function printUsage() {
  console.log(`Usage: repo-guard init [--preset <preset>] [--mode <mode>]

Scaffold a repo-guard setup in the current repository.

Options:
  --preset <preset>  Repository preset (default: application)
                     Presets: application, library, tooling, documentation
  --mode <mode>      Default enforcement mode (default: enforce)
                     Modes: advisory (relaxed budgets), enforce (strict budgets)
  --help             Show this help message

Files created:
  repo-policy.json                         Repository policy
  .github/workflows/repo-guard.yml         GitHub Actions workflow
  .github/PULL_REQUEST_TEMPLATE.md         PR template with contract block
  .github/ISSUE_TEMPLATE/change-contract.yml  Issue template for contracts`);
}
