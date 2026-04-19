import { strict as assert } from "node:assert";
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

function expectIncludes(label, value, substring) {
  const actual = String(value || "");
  const passed = actual.includes(substring);
  console.log(`${passed ? "PASS" : "FAIL"}: ${label}`);
  if (!passed) {
    failures++;
    console.error(`  expected ${JSON.stringify(actual)} to include ${JSON.stringify(substring)}`);
  }
}

function makePolicy(traceRules) {
  return {
    policy_format_version: "0.3.0",
    repository_kind: "tooling",
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
    trace_rules: traceRules,
    content_rules: [],
    cochange_rules: [],
  };
}

function runTracePolicy({ traceRules, diffText, contract = null }) {
  return runPolicyPipeline({
    mode: "check-diff",
    repositoryRoot: "/tmp/repo",
    policy: makePolicy(traceRules),
    contract,
    contractSource: contract ? "test" : "none",
    enforcement: { ok: true, mode: "blocking", source: "test", requested: "blocking" },
    diffText,
    trackedFiles: [],
    readFile: () => "",
    initialChecks: [],
  }, { quiet: true });
}

const evidenceSurfaces = ["src/**", "tests/**", "docs/**"];

console.log("\n--- changed requirement files require evidence ---");
{
  const traceRules = [
    {
      id: "changed-requirements-need-evidence",
      kind: "changed_files_require_evidence",
      if_changed: ["requirements/**"],
      must_touch_any: evidenceSurfaces,
    },
  ];
  const missingEvidenceDiff = [
    "diff --git a/requirements/fr-001.json b/requirements/fr-001.json",
    "--- a/requirements/fr-001.json",
    "+++ b/requirements/fr-001.json",
    "-{\"id\":\"FR-001\",\"title\":\"Old\"}",
    "+{\"id\":\"FR-001\",\"title\":\"New\"}",
  ].join("\n");
  const result = runTracePolicy({ traceRules, diffText: missingEvidenceDiff });

  expect("requirement-only diff fails", result.ok, false);
  expect("requirement-only diff sets blocking exit code", result.exitCode, 1);

  const violation = result.violations.find((item) => item.trace_rule === "changed-requirements-need-evidence");
  expect("missing evidence violation is reported as a trace rule", Boolean(violation), true);
  expect("missing evidence violation has evidence trace kind", violation?.trace_kind, "changed_files_require_evidence");
  expect("missing evidence violation keeps changed requirement path", violation?.changed_files, ["requirements/fr-001.json"]);
  expect("missing evidence violation keeps required evidence surfaces", violation?.must_touch_any, evidenceSurfaces);
  expectIncludes("missing evidence message is distinct", violation?.message, "missing evidence");
}

console.log("\n--- evidence surfaces satisfy changed requirement rule ---");
{
  const traceRules = [
    {
      id: "changed-requirements-need-evidence",
      kind: "changed_files_require_evidence",
      if_changed: ["requirements/**"],
      must_touch_any: evidenceSurfaces,
    },
  ];
  const diffText = [
    "diff --git a/requirements/fr-001.json b/requirements/fr-001.json",
    "--- a/requirements/fr-001.json",
    "+++ b/requirements/fr-001.json",
    "-{\"id\":\"FR-001\",\"title\":\"Old\"}",
    "+{\"id\":\"FR-001\",\"title\":\"New\"}",
    "diff --git a/tests/fr-001.test.mjs b/tests/fr-001.test.mjs",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/tests/fr-001.test.mjs",
    "+test('FR-001 behavior', () => {});",
  ].join("\n");
  const result = runTracePolicy({ traceRules, diffText });

  expect("requirement diff with test evidence passes", result.ok, true);
  expect("evidence trace result records touched evidence",
    result.traceRuleResults.find((item) => item.id === "changed-requirements-need-evidence")?.evidenceFiles,
    ["tests/fr-001.test.mjs"]);
}

console.log("\n--- declared contract anchors require evidence ---");
{
  const traceRules = [
    {
      id: "declared-anchors-need-evidence",
      kind: "declared_anchors_require_evidence",
      contract_field: "anchors.affects",
      must_touch_any: evidenceSurfaces,
    },
  ];
  const contract = {
    change_type: "feature",
    scope: ["requirements/**"],
    budgets: {},
    anchors: {
      affects: ["FR-001"],
    },
    must_touch: [],
    must_not_touch: [],
    expected_effects: ["Update affected requirement"],
  };
  const missingEvidenceDiff = [
    "diff --git a/requirements/fr-001.json b/requirements/fr-001.json",
    "--- a/requirements/fr-001.json",
    "+++ b/requirements/fr-001.json",
    "-{\"id\":\"FR-001\",\"title\":\"Old\"}",
    "+{\"id\":\"FR-001\",\"title\":\"New\"}",
  ].join("\n");
  const result = runTracePolicy({ traceRules, diffText: missingEvidenceDiff, contract });

  expect("declared affects without evidence fails", result.ok, false);
  const violation = result.violations.find((item) => item.trace_rule === "declared-anchors-need-evidence");
  expect("declared anchor evidence violation is reported", Boolean(violation), true);
  expect("declared anchor evidence violation has distinct kind", violation?.trace_kind, "declared_anchors_require_evidence");
  expect("declared anchor evidence violation keeps contract field", violation?.contract_field, "anchors.affects");
  expect("declared anchor evidence violation keeps declared anchors", violation?.declared_anchors, ["FR-001"]);
  expectIncludes("declared anchor evidence message is distinct", violation?.message, "missing evidence");
}

console.log("\n--- evidence surfaces satisfy declared anchor rule ---");
{
  const traceRules = [
    {
      id: "declared-anchors-need-evidence",
      kind: "declared_anchors_require_evidence",
      contract_field: "anchors.affects",
      must_touch_any: evidenceSurfaces,
    },
  ];
  const contract = {
    change_type: "feature",
    scope: ["requirements/**", "docs/**"],
    budgets: {},
    anchors: {
      affects: ["FR-001"],
    },
    must_touch: [],
    must_not_touch: [],
    expected_effects: ["Update affected requirement and docs"],
  };
  const diffText = [
    "diff --git a/requirements/fr-001.json b/requirements/fr-001.json",
    "--- a/requirements/fr-001.json",
    "+++ b/requirements/fr-001.json",
    "-{\"id\":\"FR-001\",\"title\":\"Old\"}",
    "+{\"id\":\"FR-001\",\"title\":\"New\"}",
    "diff --git a/docs/fr-001.md b/docs/fr-001.md",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/docs/fr-001.md",
    "+# FR-001",
  ].join("\n");
  const result = runTracePolicy({ traceRules, diffText, contract });

  expect("declared affects with docs evidence passes", result.ok, true);
  expect("declared anchor trace result records declared anchors",
    result.traceRuleResults.find((item) => item.id === "declared-anchors-need-evidence")?.declaredAnchors,
    ["FR-001"]);
}

console.log(`\n${failures === 0 ? "All trace evidence rule tests passed" : `${failures} test(s) failed`}`);
process.exit(failures === 0 ? 0 : 1);
