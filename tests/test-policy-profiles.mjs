import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { strict as assert } from "node:assert";
import Ajv from "ajv";
import { loadJSON, loadPolicyRuntime } from "../src/runtime/validation.mjs";
import { runPolicyPipeline } from "../src/runtime/pipeline.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

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

function basePolicy() {
  return {
    policy_format_version: "0.3.0",
    repository_kind: "library",
    profile: "requirements-strict",
    profile_overrides: {
      strict_heading_docs: [
        "docs/architecture.md",
        "docs/pmm_requirements.md",
      ],
      evidence_surfaces: [
        "include/**",
        "src/**",
        "tests/**",
        "examples/**",
        "docs/**",
        "README.md",
        "requirements/README.md",
        "scripts/**",
        ".github/workflows/**",
      ],
    },
    paths: {
      forbidden: [],
      canonical_docs: ["README.md"],
      governance_paths: ["repo-policy.json"],
      operational_paths: [],
    },
    diff_rules: {
      max_new_docs: 2,
      max_new_files: 10,
      max_net_added_lines: 1000,
    },
    content_rules: [],
    cochange_rules: [],
  };
}

const pjsonEvidenceSurfaces = [
  "include/**",
  "src/**",
  "tests/**",
  "examples/**",
  "docs/**",
  "README.md",
  "requirements/README.md",
  "scripts/**",
  ".github/workflows/**",
];

function traceRule(policy, id) {
  return policy.trace_rules?.find((rule) => rule.id === id);
}

console.log("\n--- profile schema support ---");
{
  const schema = loadJSON(resolve(root, "schemas/repo-policy.schema.json"));
  const ajv = new Ajv({ allErrors: true });
  const validatePolicy = ajv.compile(schema);
  const valid = validatePolicy(basePolicy());

  expect("policy with requirements-strict profile passes schema", valid, true);
}

console.log("\n--- profile expansion in runtime policy load ---");
{
  const dir = mkdtempSync(join(tmpdir(), "repo-guard-profile-"));
  writeFileSync(join(dir, "repo-policy.json"), JSON.stringify(basePolicy(), null, 2), "utf-8");

  const runtime = loadPolicyRuntime({ packageRoot: root, repoRoot: dir }, { quiet: true });
  expect("runtime accepts profile policy", runtime.ok, true);
  expect("profile expands requirement_id anchor", Boolean(runtime.policy.anchors?.types?.requirement_id), true);
  expect(
    "profile override drives strict heading docs",
    runtime.policy.anchors?.types?.doc_heading_req_ref?.sources.map((source) => source.glob),
    ["docs/architecture.md", "docs/pmm_requirements.md"]
  );
  expect(
    "profile override drives changed requirement evidence surfaces",
    traceRule(runtime.policy, "changed-requirements-need-evidence")?.must_touch_any,
    basePolicy().profile_overrides.evidence_surfaces
  );
}

console.log("\n--- pjson-style strict profile overrides ---");
{
  const dir = mkdtempSync(join(tmpdir(), "repo-guard-profile-"));
  const policy = {
    ...basePolicy(),
    profile_overrides: {
      strict_heading_docs: [
        "docs/architecture.md",
        "docs/pmm_requirements.md",
      ],
      evidence_surfaces: pjsonEvidenceSurfaces,
      affected_evidence_surfaces: [
        "include/**",
        "src/**",
        "tests/**",
        "examples/**",
        "docs/**",
        "README.md",
        "requirements/README.md",
        "scripts/**",
      ],
    },
  };
  writeFileSync(join(dir, "repo-policy.json"), JSON.stringify(policy, null, 2), "utf-8");

  const runtime = loadPolicyRuntime({ packageRoot: root, repoRoot: dir }, { quiet: true });
  expect(
    "pjson-style profile keeps conventional requirement JSON globs",
    runtime.policy.anchors?.types?.requirement_id?.sources.map((source) => source.glob),
    [
      "requirements/business/*.json",
      "requirements/stakeholder/*.json",
      "requirements/functional/*.json",
      "requirements/nonfunctional/*.json",
      "requirements/constraints/*.json",
      "requirements/interface/*.json",
    ]
  );
  expect(
    "pjson-style profile can refine changed requirement evidence",
    traceRule(runtime.policy, "changed-requirements-need-evidence")?.must_touch_any,
    pjsonEvidenceSurfaces
  );
  expect(
    "pjson-style profile can refine affected anchor evidence separately",
    traceRule(runtime.policy, "declared-affected-anchors-need-evidence")?.must_touch_any,
    policy.profile_overrides.affected_evidence_surfaces
  );
  expect(
    "pjson-style profile defaults implementation evidence to implementation surfaces",
    traceRule(runtime.policy, "declared-implemented-anchors-need-evidence")?.must_touch_any,
    ["include/**", "src/**", "scripts/**", ".github/workflows/**"]
  );
  expect(
    "pjson-style profile defaults verification evidence to verification surfaces",
    traceRule(runtime.policy, "declared-verified-anchors-need-evidence")?.must_touch_any,
    ["tests/**", "experiments/**", "scripts/**", ".github/workflows/**"]
  );
}

console.log("\n--- explicit expanded sections remain compatible ---");
{
  const dir = mkdtempSync(join(tmpdir(), "repo-guard-profile-"));
  const policy = {
    ...basePolicy(),
    anchors: {
      types: {
        custom_requirement_id: {
          sources: [
            { kind: "json_field", glob: "specs/*.json", field: "id" },
          ],
        },
      },
    },
    trace_rules: [],
  };
  writeFileSync(join(dir, "repo-policy.json"), JSON.stringify(policy, null, 2), "utf-8");

  const runtime = loadPolicyRuntime({ packageRoot: root, repoRoot: dir }, { quiet: true });
  expect("explicit anchors remain valid with profile", runtime.ok, true);
  expect("explicit anchors take precedence over generated profile anchors", Boolean(runtime.policy.anchors?.types?.requirement_id), false);
  expect("explicit trace_rules take precedence over generated profile trace_rules", runtime.policy.trace_rules, []);
}

console.log("\n--- profile trace rules enforce changed requirement evidence ---");
{
  const dir = mkdtempSync(join(tmpdir(), "repo-guard-profile-"));
  writeFileSync(join(dir, "repo-policy.json"), JSON.stringify(basePolicy(), null, 2), "utf-8");
  const runtime = loadPolicyRuntime({ packageRoot: root, repoRoot: dir }, { quiet: true });

  const files = {
    "requirements/functional/FR-001.json": JSON.stringify({ id: "FR-001", title: "Feature" }),
  };
  const diffText = [
    "diff --git a/requirements/functional/FR-001.json b/requirements/functional/FR-001.json",
    "--- a/requirements/functional/FR-001.json",
    "+++ b/requirements/functional/FR-001.json",
    "-{\"id\":\"FR-001\",\"title\":\"Old\"}",
    "+{\"id\":\"FR-001\",\"title\":\"Feature\"}",
  ].join("\n");

  const result = runPolicyPipeline({
    mode: "check-diff",
    repositoryRoot: dir,
    policy: runtime.policy,
    contract: null,
    contractSource: "none",
    enforcement: { ok: true, mode: "blocking", source: "test", requested: "blocking" },
    diffText,
    trackedFiles: Object.keys(files),
    readFile: (file) => files[file],
    initialChecks: [],
  }, { quiet: true });

  expect("changed requirement without evidence fails", result.ok, false);
  expect("changed requirement without evidence is blocking", result.exitCode, 1);
  expectIncludes(
    "profile trace rule reports missing evidence",
    result.violations.find((item) => item.trace_rule === "changed-requirements-need-evidence")?.message,
    "missing evidence"
  );
}

console.log(`\n${failures === 0 ? "All policy profile tests passed" : `${failures} test(s) failed`}`);
process.exit(failures === 0 ? 0 : 1);
