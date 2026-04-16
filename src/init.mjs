import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, relative, dirname } from "node:path";
import { normalizeEnforcementMode } from "./enforcement.mjs";

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

function buildPolicy(preset, enforcementMode) {
  const base = JSON.parse(JSON.stringify(PRESETS[preset]));
  return {
    policy_format_version: "0.3.0",
    repository_kind: base.repository_kind,
    enforcement: { mode: enforcementMode },
    paths: base.paths,
    diff_rules: base.diff_rules,
    content_rules: base.content_rules,
    cochange_rules: base.cochange_rules,
  };
}

function buildWorkflow(enforcementMode) {
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
          enforcement: ${enforcementMode}
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
  let mode = roots.enforcementMode || "enforce";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--preset" && args[i + 1]) {
      preset = args[++i];
    } else if (args[i] === "--mode" && args[i + 1]) {
      mode = args[++i];
    } else if (args[i] === "--enforcement" && args[i + 1]) {
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

  const enforcement = normalizeEnforcementMode(mode, "mode");
  if (!enforcement.ok) {
    console.error(enforcement.message);
    process.exit(1);
  }
  const enforcementMode = enforcement.mode;

  const repoRoot = roots.repoRoot;
  const created = [];
  const skipped = [];

  const policyPath = resolve(repoRoot, "repo-policy.json");
  const policyContent = JSON.stringify(buildPolicy(preset, enforcementMode), null, 2) + "\n";
  writeIfAbsent(policyPath, policyContent, created, skipped);

  const workflowPath = resolve(repoRoot, ".github/workflows/repo-guard.yml");
  writeIfAbsent(workflowPath, buildWorkflow(enforcementMode), created, skipped);

  const prTemplatePath = resolve(repoRoot, ".github/PULL_REQUEST_TEMPLATE.md");
  writeIfAbsent(prTemplatePath, buildPRTemplate(), created, skipped);

  const issueTemplatePath = resolve(repoRoot, ".github/ISSUE_TEMPLATE/change-contract.yml");
  writeIfAbsent(issueTemplatePath, buildIssueTemplate(), created, skipped);

  console.log(`repo-guard init (preset: ${preset}, enforcement: ${enforcementMode})\n`);

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
  --mode <mode>      Default enforcement behavior (default: enforce)
                     Modes: advisory/warn (non-blocking), enforce/blocking (blocking)
  --enforcement <mode>
                     Alias for --mode
  --help             Show this help message

Files created:
  repo-policy.json                         Repository policy
  .github/workflows/repo-guard.yml         GitHub Actions workflow
  .github/PULL_REQUEST_TEMPLATE.md         PR template with contract block
  .github/ISSUE_TEMPLATE/change-contract.yml  Issue template for contracts`);
}
