import { strict as assert } from "node:assert";
import { buildPolicyFacts } from "../src/facts/input.mjs";
import { extractIntegration } from "../src/extractors/integration.mjs";

let failures = 0;

function expect(label, actual, expected) {
  try {
    assert.deepEqual(actual, expected);
    console.log(`PASS: ${label}`);
  } catch (e) {
    failures++;
    console.error(`FAIL: ${label}`);
    console.error(`  expected: ${JSON.stringify(expected)}, got: ${JSON.stringify(actual)}`);
  }
}

function expectIncludes(label, value, substring) {
  const actual = String(value || "");
  const passed = actual.includes(substring);
  console.log(`${passed ? "PASS" : "FAIL"}: ${label}`);
  if (!passed) {
    failures++;
    console.error(`  expected ${JSON.stringify(actual)} to include ${JSON.stringify(substring)}`);
  }
}

function makeReadFile(files) {
  return (file) => {
    if (!Object.hasOwn(files, file)) {
      throw new Error(`missing fixture ${file}`);
    }
    return files[file];
  };
}

function makePolicy(overrides = {}) {
  return {
    policy_format_version: "0.3.0",
    repository_kind: "tooling",
    integration: {
      workflows: [
        {
          id: "pr-gate",
          kind: "github_actions",
          path: ".github/workflows/repo-guard.yml",
          role: "repo_guard_pr_gate",
        },
      ],
      templates: [
        {
          id: "pull-request-template",
          kind: "markdown",
          path: ".github/PULL_REQUEST_TEMPLATE.md",
          requires_contract_block: true,
        },
        {
          id: "change-contract-issue-form",
          kind: "github_issue_form",
          path: ".github/ISSUE_TEMPLATE/change-contract.yml",
          requires_contract_block: true,
        },
      ],
      docs: [
        {
          id: "readme",
          path: "README.md",
          must_mention: ["repo-guard", "contract", "integration", "anchors.affects"],
        },
      ],
      profiles: [
        {
          id: "self-hosting",
          doc_path: "README.md",
        },
      ],
      ...overrides.integration,
    },
    paths: {
      forbidden: [],
      canonical_docs: [],
      operational_paths: [],
      governance_paths: [],
    },
    diff_rules: {
      max_new_docs: 10,
      max_new_files: 10,
      max_net_added_lines: 1000,
    },
    content_rules: [],
    cochange_rules: [],
  };
}

const files = {
  ".github/workflows/repo-guard.yml": [
    "name: repo guard",
    "on:",
    "  pull_request:",
    "    types: [opened, synchronize]",
    "  push:",
    "permissions:",
    "  contents: read",
    "env:",
    "  RG_MODE: blocking",
    "jobs:",
    "  validate:",
    "    if: github.event.pull_request.draft == false",
    "    permissions:",
    "      pull-requests: write",
    "    runs-on: ubuntu-latest",
    "    env:",
    "      JOB_ENV: job-value",
    "    steps:",
    "      - uses: actions/checkout@v4",
    "        with:",
    "          fetch-depth: 0",
    "      - name: Run repo-guard",
    "        if: always()",
    "        env:",
    "          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}",
    "        run: |",
    "          node src/repo-guard.mjs check-pr",
    "          echo \"### repo-guard\" >> \"$GITHUB_STEP_SUMMARY\"",
    "      - uses: ./",
    "        with:",
    "          mode: check-pr",
  ].join("\n"),
  ".github/PULL_REQUEST_TEMPLATE.md": [
    "# Change Contract",
    "",
    "```repo-guard-yaml",
    "change_type: feature",
    "scope:",
    "  - src/**",
    "anchors:",
    "  affects:",
    "    - FR-001",
    "```",
  ].join("\n"),
  ".github/ISSUE_TEMPLATE/change-contract.yml": [
    "name: Change contract",
    "body:",
    "  - type: markdown",
    "    attributes:",
    "      value: |",
    "        ```repo-guard-yaml",
    "        change_type: docs",
    "        expected_effects:",
    "          - README explains the contract",
    "        ```",
  ].join("\n"),
  "README.md": [
    "# Repo Guard",
    "",
    "Uses repo-guard contract and integration policy.",
    "",
    "```bash",
    "repo-guard check-pr",
    "```",
    "",
    "Profile id: self-hosting",
    "Migration target: requirements-strict",
    "The self-hosting profile is the default profile name.",
  ].join("\n"),
};

console.log("\n--- integration extractor builds normalized workflow, template, doc, and profile facts ---");
{
  const policy = makePolicy();
  const extraction = extractIntegration(policy, {
    repoRoot: "/tmp/repo",
    trackedFiles: Object.keys(files),
    readFile: makeReadFile(files),
  });

  expect("integration extraction reports no errors", extraction.errors, []);

  const workflow = extraction.workflows[0];
  expect("workflow trigger events are normalized", workflow.triggerEvents, ["pull_request", "push"]);
  expect("workflow permissions are normalized", workflow.permissions.workflow, { contents: "read" });
  expect("job permissions are normalized", workflow.permissions.jobs, [
    { jobId: "validate", permissions: { "pull-requests": "write" } },
  ]);
  expect("action uses are collected from steps", workflow.actionUses.map((fact) => fact.uses), [
    "actions/checkout@v4",
    "./",
  ]);
  expect("step inputs keep scalar values as strings",
    workflow.stepInputs.find((fact) => fact.uses === "actions/checkout@v4")?.inputs,
    { "fetch-depth": "0" });
  expect("env vars include workflow, job, and step scopes",
    workflow.envVars.map((fact) => `${fact.scope}:${fact.name}`).sort(),
    ["job:JOB_ENV", "step:GH_TOKEN", "workflow:RG_MODE"]);
  expect("if conditions include job and step scopes",
    workflow.ifConditions.map((fact) => `${fact.scope}:${fact.condition}`),
    ["job:github.event.pull_request.draft == false", "step:always()"]);
  expect("summary publishing behavior is detected", workflow.summaryPublishing, [
    {
      jobId: "validate",
      stepIndex: 2,
      stepName: "Run repo-guard",
      mode: "append",
    },
  ]);

  const prTemplate = extraction.templates.find((template) => template.id === "pull-request-template");
  const issueTemplate = extraction.templates.find((template) => template.id === "change-contract-issue-form");
  expect("markdown template detects repo-guard-yaml block", prTemplate?.hasRepoGuardYamlBlock, true);
  expect("markdown template extracts nested contract field names", prTemplate?.contractFieldNames, [
    "anchors",
    "anchors.affects",
    "change_type",
    "scope",
  ]);
  expect("issue form template extracts markdown contract blocks from YAML string fields",
    issueTemplate?.contractFieldNames,
    ["change_type", "expected_effects"]);

  const doc = extraction.docs[0];
  expect("docs expose headings", doc.headings, [{ level: 1, text: "Repo Guard", line: 1 }]);
  expect("docs expose code block presence", doc.codeBlocks, [
    { language: "bash", infoString: "bash", startLine: 5, endLine: 7 },
  ]);
  expect("docs expose text mention facts",
    doc.mentions.map((mention) => `${mention.term}:${mention.present}:${mention.count}`),
    ["repo-guard:true:2", "contract:true:1", "integration:true:1", "anchors.affects:false:0"]);

  const profile = extraction.profiles[0];
  expect("profile docs expose configured profile identifiers",
    profile.identifiers.map((fact) => fact.value),
    ["self-hosting"]);
  expect("profile docs expose migration target mentions",
    profile.migrationTargets.map((fact) => fact.value),
    ["requirements-strict"]);
  expect("profile docs expose profile name references",
    profile.profileNameReferences.map((fact) => fact.value),
    ["self-hosting", "self-hosting"]);
}

console.log("\n--- policy facts expose integration extraction independently from enforcement ---");
{
  const facts = buildPolicyFacts({
    mode: "check-diff",
    repositoryRoot: "/tmp/repo",
    policy: makePolicy(),
    contract: null,
    contractSource: "none",
    enforcement: { ok: true, mode: "blocking", source: "test", requested: "blocking" },
    diffText: "",
    trackedFiles: Object.keys(files),
    readFile: makeReadFile(files),
  });

  expect("facts expose integration workflow facts", facts.integration.workflows[0].triggerEvents, [
    "pull_request",
    "push",
  ]);
  expect("facts expose integration extraction errors", facts.integration.errors, []);
}

console.log("\n--- malformed integration artifacts produce explicit diagnostics ---");
{
  const policy = makePolicy({
    integration: {
      workflows: [
        {
          id: "bad-workflow",
          kind: "github_actions",
          path: ".github/workflows/bad.yml",
          role: "repo_guard_pr_gate",
        },
      ],
      templates: [
        {
          id: "bad-template",
          kind: "markdown",
          path: ".github/PULL_REQUEST_TEMPLATE.md",
          requires_contract_block: true,
        },
      ],
      docs: [
        {
          id: "bad-doc",
          path: "README.md",
          must_mention: ["repo-guard"],
        },
      ],
      profiles: [],
    },
  });
  const malformedFiles = {
    ".github/workflows/bad.yml": "name: bad\non: [",
    ".github/PULL_REQUEST_TEMPLATE.md": [
      "```repo-guard-yaml",
      "change_type: [",
      "```",
    ].join("\n"),
    "README.md": [
      "# Bad Doc",
      "",
      "```bash",
      "repo-guard check-pr",
    ].join("\n"),
  };

  const extraction = extractIntegration(policy, {
    repoRoot: "/tmp/repo",
    trackedFiles: Object.keys(malformedFiles),
    readFile: makeReadFile(malformedFiles),
  });

  expect("malformed extraction records one error per artifact", extraction.errors.length, 3);
  expectIncludes("workflow error identifies invalid YAML",
    extraction.errors.find((error) => error.section === "workflows")?.message,
    "invalid YAML");
  expectIncludes("template error identifies invalid contract block",
    extraction.errors.find((error) => error.section === "templates")?.message,
    "invalid repo-guard-yaml block");
  expectIncludes("doc error identifies unclosed Markdown fence",
    extraction.errors.find((error) => error.section === "docs")?.message,
    "unclosed Markdown fence");
}

console.log(`\n${failures === 0 ? "All integration extractor tests passed" : `${failures} test(s) failed`}`);
process.exit(failures === 0 ? 0 : 1);
