import { strict as assert } from "node:assert";
import { buildPolicyFacts } from "../src/facts/input.mjs";
import { extractAnchors } from "../src/extractors/anchors.mjs";
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

function makeReadFile(files) {
  return (file) => {
    if (!Object.hasOwn(files, file)) {
      throw new Error(`missing fixture ${file}`);
    }
    return files[file];
  };
}

function makePolicy(anchorTypes) {
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
    anchors: {
      types: anchorTypes,
    },
    content_rules: [],
    cochange_rules: [],
  };
}

console.log("\n--- anchor extractors return normalized instances ---");
{
  const policy = makePolicy({
    requirement_id: {
      sources: [
        { kind: "json_field", glob: "requirements/**/*.json", field: "id" },
      ],
    },
    code_req_ref: {
      sources: [
        { kind: "regex", glob: "src/**", pattern: "@req\\s+((FR|SR)-[0-9]{3})" },
      ],
    },
  });
  const files = {
    "requirements/fr-001.json": JSON.stringify({ id: "FR-001", title: "Login" }),
    "src/feature.mjs": "export function feature() {} // @req FR-001\n// @req SR-002\n",
  };

  const extraction = extractAnchors(policy, {
    repoRoot: "/tmp/repo",
    trackedFiles: Object.keys(files),
    readFile: makeReadFile(files),
  });

  expect("extractors produce no errors", extraction.errors, []);
  expect("extractors group instances by anchor type", Object.keys(extraction.byType).sort(), [
    "code_req_ref",
    "requirement_id",
  ]);

  const requirement = extraction.instances.find((instance) => instance.anchorType === "requirement_id");
  expect("json_field instance is normalized", requirement, {
    anchorType: "requirement_id",
    value: "FR-001",
    file: "requirements/fr-001.json",
    sourceKind: "json_field",
    raw: "FR-001",
  });

  const codeRef = extraction.instances.find((instance) =>
    instance.anchorType === "code_req_ref" && instance.value === "FR-001"
  );
  expect("regex instance uses first capture group as value", {
    anchorType: codeRef?.anchorType,
    value: codeRef?.value,
    file: codeRef?.file,
    sourceKind: codeRef?.sourceKind,
    captureGroup: codeRef?.captureGroup,
    raw: codeRef?.raw,
    line: codeRef?.line,
  }, {
    anchorType: "code_req_ref",
    value: "FR-001",
    file: "src/feature.mjs",
    sourceKind: "regex",
    captureGroup: 1,
    raw: "@req FR-001",
    line: 1,
  });
  expect("regex extractor reports one-based column for captured value", codeRef?.column > 1, true);
}

console.log("\n--- normalized facts include repository and changed anchor files ---");
{
  const policy = makePolicy({
    requirement_id: {
      sources: [
        { kind: "json_field", glob: "requirements/**/*.json", field: "id" },
      ],
    },
    test_req_ref: {
      sources: [
        { kind: "regex", glob: "tests/**", pattern: "\\[REQ-([0-9]+)\\]" },
      ],
    },
  });
  const files = {
    "requirements/req-42.json": JSON.stringify({ id: "REQ-42" }),
    "tests/new.test.mjs": "test('new behavior [REQ-42]', () => {});\n",
  };
  const diffText = [
    "diff --git a/tests/new.test.mjs b/tests/new.test.mjs",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/tests/new.test.mjs",
    "+test('new behavior [REQ-42]', () => {});",
  ].join("\n");

  const facts = buildPolicyFacts({
    mode: "check-diff",
    repositoryRoot: "/tmp/repo",
    policy,
    contract: null,
    contractSource: "none",
    enforcement: { ok: true, mode: "blocking", source: "test", requested: "blocking" },
    diffText,
    trackedFiles: ["requirements/req-42.json"],
    readFile: makeReadFile(files),
  });

  expect("facts expose anchor instances from tracked and changed files",
    facts.anchors.instances.map((instance) => `${instance.anchorType}:${instance.file}:${instance.value}`),
    [
      "requirement_id:requirements/req-42.json:REQ-42",
      "test_req_ref:tests/new.test.mjs:42",
    ]);
  expect("facts expose anchor extraction errors", facts.anchors.errors, []);
}

console.log("\n--- anchor extraction errors are predictable and reported by pipeline ---");
{
  const policy = makePolicy({
    requirement_id: {
      sources: [
        { kind: "json_field", glob: "requirements/**/*.json", field: "id" },
      ],
    },
  });
  const files = {
    "requirements/bad.json": "{",
    "requirements/missing.json": JSON.stringify({ title: "No id" }),
  };
  const extraction = extractAnchors(policy, {
    repoRoot: "/tmp/repo",
    trackedFiles: Object.keys(files),
    readFile: makeReadFile(files),
  });

  expect("json_field extractor records both errors", extraction.errors.map((error) => ({
    anchorType: error.anchorType,
    sourceKind: error.sourceKind,
    file: error.file,
  })), [
    { anchorType: "requirement_id", sourceKind: "json_field", file: "requirements/bad.json" },
    { anchorType: "requirement_id", sourceKind: "json_field", file: "requirements/missing.json" },
  ]);
  expectIncludes("json parse error is stable", extraction.errors[0]?.message, "invalid JSON");
  expectIncludes("missing field error identifies the field", extraction.errors[1]?.message, "field \"id\"");

  const result = runPolicyPipeline({
    mode: "check-diff",
    repositoryRoot: "/tmp/repo",
    policy,
    contract: null,
    contractSource: "none",
    enforcement: { ok: true, mode: "blocking", source: "test", requested: "blocking" },
    diffText: "",
    trackedFiles: Object.keys(files),
    readFile: makeReadFile(files),
    initialChecks: [],
  }, { quiet: true });

  const violation = result.violations.find((item) => item.rule === "anchor-extraction");
  expect("pipeline reports anchor extraction as a policy violation", Boolean(violation), true);
  expect("pipeline exposes formatted extraction errors",
    violation?.errors.some((error) => error.includes("requirements/bad.json")),
    true);
}

console.log(`\n${failures === 0 ? "All anchor extractor tests passed" : `${failures} test(s) failed`}`);
process.exit(failures === 0 ? 0 : 1);
