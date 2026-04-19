import { strict as assert } from "node:assert";
import { buildPolicyFacts } from "../src/facts/input.mjs";
import { runPolicyPipeline } from "../src/runtime/pipeline.mjs";

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
    repositoryRoot: "/tmp/repo-guard-test",
    policy,
    contract: null,
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
    repositoryRoot: "/tmp/repo-guard-test",
    policy,
    contract: null,
    enforcement: { ok: true, mode: "blocking", source: "test", requested: "blocking" },
    diffText,
    trackedFiles: ["README.md", "src/existing.mjs"],
    declaredChangeClass: null,
    ...extra,
  });
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
  expect("facts expose normalized changed paths", facts.changedPaths, ["src/feature.mjs"]);
  expect("facts extract touched surfaces", facts.touchedSurfaces.touched_surfaces, ["source"]);
  expect("facts classify new files", facts.newFileClasses.files_by_class, {
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
    initialChecks: [{ name: "change-contract", check: { ok: true } }],
  });
  const checkDiffFacts = buildEquivalentFacts();
  const checkPrFacts = buildEquivalentFacts();

  expect("equivalent facts are identical", checkPrFacts, checkDiffFacts);
  expect(
    "check-pr style input adds contract validation without changing policy check result",
    checkPrStyle.violations.map((violation) => violation.rule),
    checkDiffStyle.violations.map((violation) => violation.rule)
  );
}

console.log(`\n${failures === 0 ? "All tests passed" : `${failures} test(s) failed`}`);
process.exit(failures === 0 ? 0 : 1);
