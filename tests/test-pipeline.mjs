import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildPolicyFacts } from "../src/facts/input.mjs";
import { createIntegrationAnalysisReport } from "../src/integration-validator.mjs";
import { runPolicyPipeline } from "../src/runtime/pipeline.mjs";

let failures = 0;
const __dirname = new URL(".", import.meta.url).pathname;
const projectRoot = resolve(__dirname, "..");

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

const policy = {
  policy_format_version: "0.3.0",
  repository_kind: "tooling",
  paths: {
    forbidden: ["secrets/**"],
    canonical_docs: ["README.md"],
    operational_paths: [".github/**"],
    governance_paths: ["repo-policy.json"],
  },
  diff_rules: {
    max_new_docs: 5,
    max_new_files: 3,
    max_net_added_lines: 500,
  },
  surfaces: {
    source: ["src/**"],
    docs: ["docs/**"],
  },
  new_file_classes: {
    source: ["src/**"],
  },
  content_rules: [],
  cochange_rules: [{ if_changed: ["src/**"], must_change_any: ["tests/**"] }],
};

const diffText = [
  "diff --git a/src/feature.mjs b/src/feature.mjs",
  "new file mode 100644",
  "--- /dev/null",
  "+++ b/src/feature.mjs",
  "+export const value = 1;",
  "diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml",
  "--- a/.github/workflows/ci.yml",
  "+++ b/.github/workflows/ci.yml",
  "+name: ci",
].join("\n");

function runEquivalentInput(extra = {}) {
  return runPolicyPipeline({
    mode: "check-diff",
    repositoryRoot: "/tmp/repo-guard-test",
    policy,
    contract: null,
    contractSource: "none",
    enforcement: { ok: true, mode: "blocking", source: "test", requested: "blocking" },
    diffText,
    trackedFiles: ["README.md", "src/existing.mjs"],
    declaredChangeClass: null,
    initialChecks: [],
    ...extra,
  }, { quiet: true });
}

function buildEquivalentFacts(extra = {}) {
  return buildPolicyFacts({
    mode: "check-diff",
    repositoryRoot: "/tmp/repo-guard-test",
    policy,
    contract: null,
    contractSource: "none",
    enforcement: { ok: true, mode: "blocking", source: "test", requested: "blocking" },
    diffText,
    trackedFiles: ["README.md", "src/existing.mjs"],
    declaredChangeClass: null,
    ...extra,
  });
}

function expectCanonicalEnvelope(label, report, command) {
  const canonicalKeys = [
    "command",
    "mode",
    "ok",
    "result",
    "passed",
    "failed",
    "violations",
    "advisoryWarnings",
    "warnings",
    "violationCount",
    "exitCode",
    "ruleResults",
    "hints",
    "repositoryRoot",
  ];
  expect(`${label} command`, report.command, command);
  expect(`${label} canonical keys`, canonicalKeys.every((key) =>
    Object.prototype.hasOwnProperty.call(report, key)
  ), true);
  expect(`${label} ruleResults array`, Array.isArray(report.ruleResults), true);
  expect(`${label} violations array`, Array.isArray(report.violations), true);
  expect(`${label} hints array`, Array.isArray(report.hints), true);
  expect(`${label} canonical check result shape`, report.ruleResults.every((item) =>
    typeof item.rule === "string" &&
    typeof item.ok === "boolean" &&
    ["pass", "warning", "failure"].includes(item.severity) &&
    Array.isArray(item.details)
  ), true);
}

function makeIntegrationKernelRepo() {
  const dir = mkdtempSync(join(tmpdir(), "repo-guard-kernel-"));
  const policy = {
    policy_format_version: "0.3.0",
    repository_kind: "tooling",
    paths: {
      forbidden: [],
      canonical_docs: ["README.md"],
      governance_paths: ["repo-policy.json"],
    },
    diff_rules: {
      max_new_docs: 5,
      max_new_files: 5,
      max_net_added_lines: 500,
    },
    content_rules: [],
    cochange_rules: [],
  };

  writeFileSync(join(dir, "repo-policy.json"), JSON.stringify(policy, null, 2));
  writeFileSync(join(dir, "README.md"), "# Test\n");
  return dir;
}

console.log("\n--- shared policy pipeline normalizes facts and checks ---");
{
  const facts = buildEquivalentFacts();
  const result = runEquivalentInput();
  expect("pipeline records changed files before and after operational filtering", result.diff, {
    changedFiles: 2,
    checkedFiles: 1,
    skippedOperationalFiles: 1,
  });
  expect("facts identify check-diff mode", facts.mode, "check-diff");
  expect("facts identify contract source", facts.contractSource, "none");
  expect("facts expose all diff files", facts.diff.files.all.map((file) => file.path), [
    "src/feature.mjs",
    ".github/workflows/ci.yml",
  ]);
  expect("facts expose checked diff files", facts.diff.files.checked.map((file) => file.path), ["src/feature.mjs"]);
  expect("facts expose skipped operational files", facts.diff.files.skippedOperational.map((file) => file.path), [".github/workflows/ci.yml"]);
  expect("facts expose normalized changed paths", facts.derived.changedPaths, ["src/feature.mjs"]);
  expect("facts extract touched surfaces", facts.derived.touchedSurfaces.touched_surfaces, ["source"]);
  expect("facts classify new files", facts.derived.newFileClasses.files_by_class, {
    source: ["src/feature.mjs"],
  });
  expect(
    "pipeline runs existing checks",
    result.violations.some((violation) => violation.rule.startsWith("cochange:")),
    true
  );
}

console.log("\n--- equivalent command inputs share one result shape ---");
{
  const checkDiffStyle = runEquivalentInput();
  const checkPrStyle = runEquivalentInput({
    mode: "check-pr",
    contractSource: "pr body",
    initialChecks: [{ name: "change-contract", check: { ok: true } }],
  });
  const integrationRepo = makeIntegrationKernelRepo();
  const validateIntegrationStyle = createIntegrationAnalysisReport({
    packageRoot: projectRoot,
    repoRoot: integrationRepo,
    enforcementMode: null,
  }, { format: "json" });
  const checkDiffFacts = buildEquivalentFacts();
  const checkPrFacts = buildEquivalentFacts({ mode: "check-pr", contractSource: "pr body" });

  expectCanonicalEnvelope("check-diff report", checkDiffStyle, "check-diff");
  expectCanonicalEnvelope("check-pr report", checkPrStyle, "check-pr");
  expectCanonicalEnvelope("validate-integration report", validateIntegrationStyle, "validate-integration");
  expect("equivalent facts keep mode-specific provenance", {
    mode: checkPrFacts.mode,
    contractSource: checkPrFacts.contractSource,
  }, {
    mode: "check-pr",
    contractSource: "pr body",
  });
  expect("equivalent facts share checked diff paths", checkPrFacts.derived.changedPaths, checkDiffFacts.derived.changedPaths);
  expect(
    "check-pr style input adds contract validation without changing policy check result",
    checkPrStyle.violations.map((violation) => violation.rule),
    checkDiffStyle.violations.map((violation) => violation.rule)
  );
  rmSync(integrationRepo, { recursive: true });
}

console.log("\n--- check-pr style pipeline evaluates size rules ---");
{
  const sizeResult = runEquivalentInput({
    mode: "check-pr",
    policy: {
      ...policy,
      size_rules: [
        {
          id: "max-feature-lines",
          scope: "file",
          metric: "lines",
          glob: "src/feature.mjs",
          max: 0,
          count: "changed_only",
        },
      ],
    },
    readFile: (path) => {
      if (path === "src/feature.mjs") return "export const value = 1;\n";
      return "";
    },
  });

  const violation = sizeResult.violations.find((item) => item.rule === "size-rules");
  expect("check-pr pipeline reports size-rules violation", Boolean(violation), true);
  expect("check-pr pipeline reports offending file", violation?.data?.size_violations?.[0]?.path, "src/feature.mjs");
  expect("check-pr pipeline reports measured lines", violation?.data?.size_violations?.[0]?.actual, 1);
}

console.log(`\n${failures === 0 ? "All tests passed" : `${failures} test(s) failed`}`);
process.exit(failures === 0 ? 0 : 1);
