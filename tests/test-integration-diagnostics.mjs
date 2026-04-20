import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const __dirname = new URL(".", import.meta.url).pathname;
const projectRoot = resolve(__dirname, "..");

let failures = 0;

function expect(label, actual, expected) {
  try {
    assert.deepEqual(actual, expected);
    console.log(`PASS: ${label}`);
  } catch {
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

function expectTrue(label, value) {
  expect(label, Boolean(value), true);
}

function runGuard(args) {
  const result = spawnSync(process.execPath, [
    resolve(projectRoot, "src/repo-guard.mjs"),
    ...args,
  ], {
    cwd: projectRoot,
    encoding: "utf-8",
  });
  return {
    code: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    output: `${result.stdout || ""}${result.stderr || ""}`,
  };
}

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2));
}

function basePolicy(overrides = {}) {
  return {
    policy_format_version: "0.3.0",
    repository_kind: "tooling",
    enforcement: { mode: "blocking" },
    integration: {
      workflows: [
        {
          id: "pr-gate",
          kind: "github_actions",
          path: ".github/workflows/repo-guard.yml",
          role: "repo_guard_pr_gate",
          profiles: ["self-hosting"],
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
          kind: "markdown",
          path: "README.md",
          must_mention: ["repo-guard", "contract", "integration"],
          profiles: ["self-hosting"],
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
      canonical_docs: ["README.md"],
      governance_paths: ["repo-policy.json"],
    },
    diff_rules: {
      max_new_docs: 2,
      max_new_files: 15,
      max_net_added_lines: 2000,
    },
    content_rules: [],
    cochange_rules: [],
  };
}

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), "repo-guard-integration-"));
  mkdirSync(join(dir, ".github", "workflows"), { recursive: true });
  mkdirSync(join(dir, ".github", "ISSUE_TEMPLATE"), { recursive: true });

  writeJson(join(dir, "repo-policy.json"), basePolicy());
  writeFileSync(join(dir, ".github", "workflows", "repo-guard.yml"), [
    "name: repo guard",
    "on:",
    "  pull_request:",
    "  push:",
    "jobs:",
    "  validate:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@v4",
    "        with:",
    "          fetch-depth: 0",
    "      - name: Run repo-guard",
    "        env:",
    "          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}",
    "        run: npx repo-guard check-pr --format summary",
    "",
  ].join("\n"));
  writeFileSync(join(dir, ".github", "PULL_REQUEST_TEMPLATE.md"), [
    "## Change Contract",
    "",
    "```repo-guard-yaml",
    "change_type: feature",
    "scope:",
    "  - src/**",
    "```",
    "",
  ].join("\n"));
  writeFileSync(join(dir, ".github", "ISSUE_TEMPLATE", "change-contract.yml"), [
    "name: Change contract",
    "body:",
    "  - type: textarea",
    "    attributes:",
    "      value: |",
    "        ```repo-guard-yaml",
    "        change_type: feature",
    "        scope:",
    "          - src/**",
    "        ```",
    "",
  ].join("\n"));
  writeFileSync(join(dir, "README.md"), [
    "# Test Repo",
    "",
    "This repository documents repo-guard contract integration for self-hosting.",
    "Profile id: self-hosting",
    "",
  ].join("\n"));
  return dir;
}

function makeBrokenRepo() {
  const dir = makeRepo();
  writeFileSync(join(dir, ".github", "workflows", "repo-guard.yml"), [
    "name: repo guard",
    "on:",
    "  push:",
    "jobs:",
    "  validate:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@v4",
    "      - run: echo no policy gate here",
    "",
  ].join("\n"));
  writeFileSync(join(dir, ".github", "PULL_REQUEST_TEMPLATE.md"), "## Missing contract\n");
  writeFileSync(join(dir, "README.md"), "# Missing integration docs\n");
  return dir;
}

console.log("\n--- validate-integration --format json emits normalized integration diagnostics ---");
{
  const dir = makeRepo();
  const result = runGuard([
    "--repo-root", dir,
    "validate-integration",
    "--format", "json",
  ]);

  expect("valid integration exits 0", result.code, 0);
  expect("json stderr is empty", result.stderr, "");

  let parsed = null;
  try {
    parsed = JSON.parse(result.stdout);
    expect("stdout is valid json", true, true);
  } catch (e) {
    expect("stdout is valid json", e.message, "valid json");
  }

  expect("command name is stable", parsed?.command, "validate-integration");
  expect("mode is blocking", parsed?.mode, "blocking");
  expect("result passed", parsed?.result, "passed");
  expect("repository root is included", parsed?.repositoryRoot, dir);
  expect("workflow facts are emitted", parsed?.integration?.workflows?.[0]?.triggerEvents, ["pull_request", "push"]);
  expect("run commands are normalized facts", parsed?.integration?.workflows?.[0]?.runCommands?.[0]?.run, "npx repo-guard check-pr --format summary");
  expect("template diagnostics pass", parsed?.ruleResults?.some((rule) => rule.rule === "integration-templates" && rule.ok), true);
  expect("stats include declared templates", parsed?.diagnostics?.declared?.templates, 2);

  rmSync(dir, { recursive: true });
}

console.log("\n--- doctor --integration aliases validate-integration diagnostics ---");
{
  const dir = makeRepo();
  const result = runGuard([
    "--repo-root", dir,
    "doctor",
    "--integration",
    "--format", "json",
  ]);
  const parsed = JSON.parse(result.stdout);

  expect("doctor integration alias exits 0", result.code, 0);
  expect("alias uses validate-integration command shape", parsed.command, "validate-integration");
  expect("alias emits integration facts", parsed.integration.workflows.length, 1);

  rmSync(dir, { recursive: true });
}

console.log("\n--- validate-integration --format summary reports CI-readable diagnostics ---");
{
  const dir = makeBrokenRepo();
  const result = runGuard([
    "--repo-root", dir,
    "validate-integration",
    "--format", "summary",
  ]);

  expect("broken integration blocks in blocking mode", result.code, 1);
  expectIncludes("summary heading", result.output, "## repo-guard integration summary");
  expectIncludes("summary result", result.output, "- Result: failed");
  expectIncludes("workflow diagnostic appears", result.output, "repo_guard_pr_gate workflow must run on pull_request");
  expectIncludes("template diagnostic appears", result.output, "requires a repo-guard contract block");
  expectIncludes("doc diagnostic appears", result.output, "missing required mention");

  rmSync(dir, { recursive: true });
}

console.log("\n--- validate-integration advisory mode reports but does not block ---");
{
  const dir = makeBrokenRepo();
  const result = runGuard([
    "--repo-root", dir,
    "--enforcement", "advisory",
    "validate-integration",
    "--format", "json",
  ]);
  const parsed = JSON.parse(result.stdout);

  expect("advisory integration exits 0", result.code, 0);
  expect("advisory result still records failure", parsed.result, "failed");
  expect("advisory has zero enforced failures", parsed.failed, 0);
  expectTrue("advisory records violations", parsed.violationCount > 0);
  expectTrue("template violation is present", parsed.violations.some((violation) => violation.rule === "integration-templates"));

  rmSync(dir, { recursive: true });
}

console.log(`\n${failures === 0 ? "All integration diagnostics tests passed" : `${failures} test(s) failed`}`);
process.exit(failures === 0 ? 0 : 1);
