import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execSync, spawnSync } from "node:child_process";

const __dirname = new URL(".", import.meta.url).pathname;
const projectRoot = resolve(__dirname, "..");
const repoGuard = resolve(projectRoot, "src/repo-guard.mjs");

let failures = 0;

function expect(label, actual, expected) {
  const passed = actual === expected;
  console.log(`${passed ? "PASS" : "FAIL"}: ${label}`);
  if (!passed) {
    failures++;
    console.error(`  expected: ${JSON.stringify(expected)}, got: ${JSON.stringify(actual)}`);
  }
}

function expectIncludes(label, str, substring) {
  const passed = str.includes(substring);
  console.log(`${passed ? "PASS" : "FAIL"}: ${label}`);
  if (!passed) {
    failures++;
    console.error(`  expected to include: ${JSON.stringify(substring)}`);
    console.error(`  output: ${JSON.stringify(str.slice(0, 1000))}`);
  }
}

function expectTopLevelKeys(label, actual, expected) {
  const keys = Object.keys(actual || {}).sort();
  expect(label, JSON.stringify(keys), JSON.stringify([...expected].sort()));
}

function runGuard(args, opts = {}) {
  const result = spawnSync(process.execPath, [repoGuard, ...args], {
    cwd: opts.cwd || projectRoot,
    env: { ...process.env, ...(opts.env || {}) },
    encoding: "utf-8",
  });
  return {
    code: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    output: `${result.stdout || ""}${result.stderr || ""}`,
  };
}

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), "repo-guard-format-"));
  execSync("git init", { cwd: dir, stdio: "pipe" });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: "pipe" });
  execSync('git config user.name "Test"', { cwd: dir, stdio: "pipe" });

  const policy = {
    policy_format_version: "0.3.0",
    repository_kind: "tooling",
    paths: {
      forbidden: ["secrets/**"],
      canonical_docs: ["README.md"],
      governance_paths: ["repo-policy.json"],
    },
    diff_rules: {
      max_new_docs: 5,
      max_new_files: 0,
      max_net_added_lines: 500,
    },
    content_rules: [],
    cochange_rules: [{ if_changed: ["src/**"], must_change_any: ["tests/**"] }],
  };

  writeFileSync(join(dir, "repo-policy.json"), JSON.stringify(policy, null, 2));
  writeFileSync(join(dir, "README.md"), "# Test\n");
  execSync("git add -A && git commit -m init", { cwd: dir, stdio: "pipe" });

  execSync("mkdir -p src secrets", { cwd: dir, stdio: "pipe" });
  writeFileSync(join(dir, "src", "feature.mjs"), "export const value = 1;\n");
  writeFileSync(join(dir, "secrets", "token.txt"), "token\n");
  execSync("git add -A && git commit -m feature", { cwd: dir, stdio: "pipe" });

  return {
    dir,
    base: execSync("git rev-parse HEAD~1", { cwd: dir, encoding: "utf-8" }).trim(),
    head: execSync("git rev-parse HEAD", { cwd: dir, encoding: "utf-8" }).trim(),
  };
}

function makeSizeRulesRepo() {
  const dir = mkdtempSync(join(tmpdir(), "repo-guard-size-rules-"));
  execSync("git init", { cwd: dir, stdio: "pipe" });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: "pipe" });
  execSync('git config user.name "Test"', { cwd: dir, stdio: "pipe" });

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
    size_rules: [
      {
        id: "max-src-lines",
        scope: "file",
        metric: "lines",
        glob: "src/**/*.mjs",
        max: 2,
      },
      {
        id: "max-src-bytes",
        scope: "directory",
        metric: "bytes",
        glob: "src/**",
        max: 10,
      },
    ],
    content_rules: [],
    cochange_rules: [],
  };

  writeFileSync(join(dir, "repo-policy.json"), JSON.stringify(policy, null, 2));
  writeFileSync(join(dir, "README.md"), "# Test\n");
  execSync("git add -A && git commit -m init", { cwd: dir, stdio: "pipe" });

  execSync("mkdir -p src", { cwd: dir, stdio: "pipe" });
  writeFileSync(join(dir, "src", "big.mjs"), "one\ntwo\nthree\n");
  execSync("git add -A && git commit -m oversized-source", { cwd: dir, stdio: "pipe" });

  return {
    dir,
    base: execSync("git rev-parse HEAD~1", { cwd: dir, encoding: "utf-8" }).trim(),
    head: execSync("git rev-parse HEAD", { cwd: dir, encoding: "utf-8" }).trim(),
  };
}

function makeSurfaceRepo() {
  const dir = mkdtempSync(join(tmpdir(), "repo-guard-surfaces-"));
  execSync("git init", { cwd: dir, stdio: "pipe" });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: "pipe" });
  execSync('git config user.name "Test"', { cwd: dir, stdio: "pipe" });

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
    surfaces: {
      kernel: ["src/**"],
      tests: ["tests/**"],
      docs: ["docs/**", "README.md"],
      governance: ["repo-policy.json", ".github/**"],
      generated: ["single_include/**"],
      release: ["CHANGELOG.md", "package.json"],
    },
    change_profiles: {
      docs: {
        allow_surfaces: ["docs", "governance"],
        forbid_surfaces: ["kernel", "tests", "generated", "release"],
      },
      feature: {
        allow_surfaces: ["kernel", "tests"],
        forbid_surfaces: ["generated", "release"],
      },
      refactor: {
        allow_surfaces: ["generated", "release"],
        forbid_surfaces: ["kernel", "docs", "governance"],
      },
    },
    content_rules: [],
    cochange_rules: [],
  };

  writeFileSync(join(dir, "repo-policy.json"), JSON.stringify(policy, null, 2));
  writeFileSync(join(dir, "README.md"), "# Test\n");
  execSync("git add -A && git commit -m init", { cwd: dir, stdio: "pipe" });

  execSync("mkdir -p docs src", { cwd: dir, stdio: "pipe" });
  execSync("mkdir -p scripts", { cwd: dir, stdio: "pipe" });
  writeFileSync(join(dir, "docs", "guide.md"), "# Guide\n");
  writeFileSync(join(dir, "src", "feature.mjs"), "export const value = 1;\n");
  writeFileSync(join(dir, "scripts", "tool.mjs"), "export const tool = true;\n");
  execSync("git add -A && git commit -m docs-plus-kernel", { cwd: dir, stdio: "pipe" });

  return {
    dir,
    base: execSync("git rev-parse HEAD~1", { cwd: dir, encoding: "utf-8" }).trim(),
    head: execSync("git rev-parse HEAD", { cwd: dir, encoding: "utf-8" }).trim(),
  };
}

function makeAdvisoryTextRepo() {
  const dir = mkdtempSync(join(tmpdir(), "repo-guard-advisory-text-"));
  execSync("git init", { cwd: dir, stdio: "pipe" });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: "pipe" });
  execSync('git config user.name "Test"', { cwd: dir, stdio: "pipe" });

  const policy = {
    policy_format_version: "0.3.0",
    repository_kind: "documentation",
    paths: {
      forbidden: [],
      canonical_docs: ["docs/canonical.md"],
      governance_paths: ["repo-policy.json"],
    },
    diff_rules: {
      max_new_docs: 5,
      max_new_files: 5,
      max_net_added_lines: 500,
    },
    advisory_text_rules: {
      canonical_files: ["docs/canonical.md"],
      warn_on_similarity_above: 0.7,
      max_reported_matches: 2,
    },
    content_rules: [],
    cochange_rules: [],
  };

  writeFileSync(join(dir, "repo-policy.json"), JSON.stringify(policy, null, 2));
  execSync("mkdir -p docs", { cwd: dir, stdio: "pipe" });
  writeFileSync(
    join(dir, "docs", "canonical.md"),
    [
      "# Release Policy",
      "",
      "Policy prose belongs in the canonical document so maintainers update one source.",
      "Release approvals require a changelog entry, owner review, and a documented rollback path.",
    ].join("\n")
  );
  execSync("git add -A && git commit -m init", { cwd: dir, stdio: "pipe" });

  writeFileSync(
    join(dir, "docs", "copy.md"),
    [
      "# Release Policy",
      "",
      "Policy prose belongs in the canonical document so maintainers update one source.",
      "Release approvals require a changelog entry, owner review, and a documented rollback path.",
    ].join("\n")
  );
  execSync("git add -A && git commit -m duplicate-doc", { cwd: dir, stdio: "pipe" });

  return {
    dir,
    base: execSync("git rev-parse HEAD~1", { cwd: dir, encoding: "utf-8" }).trim(),
    head: execSync("git rev-parse HEAD", { cwd: dir, encoding: "utf-8" }).trim(),
  };
}

function makeSurfaceDebtRepo(contract) {
  const dir = mkdtempSync(join(tmpdir(), "repo-guard-debt-"));
  execSync("git init", { cwd: dir, stdio: "pipe" });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: "pipe" });
  execSync('git config user.name "Test"', { cwd: dir, stdio: "pipe" });

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
  if (contract) writeFileSync(join(dir, "contract.json"), JSON.stringify(contract, null, 2));
  writeFileSync(join(dir, "README.md"), "# Test\n");
  execSync("git add -A && git commit -m init", { cwd: dir, stdio: "pipe" });

  execSync("mkdir -p src", { cwd: dir, stdio: "pipe" });
  writeFileSync(join(dir, "src", "growth.mjs"), `${new Array(12).fill("export const value = 1;").join("\n")}\n`);
  execSync("git add -A && git commit -m growth", { cwd: dir, stdio: "pipe" });

  return {
    dir,
    contractPath: contract ? "contract.json" : null,
    base: execSync("git rev-parse HEAD~1", { cwd: dir, encoding: "utf-8" }).trim(),
    head: execSync("git rev-parse HEAD", { cwd: dir, encoding: "utf-8" }).trim(),
  };
}

function makeUnclassifiedOnlySurfaceRepo() {
  const dir = mkdtempSync(join(tmpdir(), "repo-guard-unclassified-"));
  execSync("git init", { cwd: dir, stdio: "pipe" });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: "pipe" });
  execSync('git config user.name "Test"', { cwd: dir, stdio: "pipe" });

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
    surfaces: {
      docs: ["docs/**", "README.md"],
    },
    change_profiles: {
      docs: {
        allow_surfaces: ["docs"],
        forbid_surfaces: [],
        allow_unclassified_surfaces: true,
      },
    },
    content_rules: [],
    cochange_rules: [],
  };

  writeFileSync(join(dir, "repo-policy.json"), JSON.stringify(policy, null, 2));
  writeFileSync(join(dir, "README.md"), "# Test\n");
  execSync("mkdir -p scripts", { cwd: dir, stdio: "pipe" });
  writeFileSync(join(dir, "scripts", "tool.mjs"), "export const oldTool = true;\nexport const removed = true;\n");
  execSync("git add -A && git commit -m init", { cwd: dir, stdio: "pipe" });

  writeFileSync(join(dir, "scripts", "tool.mjs"), "export const tool = true;\n");
  execSync("git add -A && git commit -m script", { cwd: dir, stdio: "pipe" });

  return {
    dir,
    base: execSync("git rev-parse HEAD~1", { cwd: dir, encoding: "utf-8" }).trim(),
    head: execSync("git rev-parse HEAD", { cwd: dir, encoding: "utf-8" }).trim(),
  };
}

function makeRegistryRepo() {
  const dir = mkdtempSync(join(tmpdir(), "repo-guard-registry-"));
  execSync("git init", { cwd: dir, stdio: "pipe" });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: "pipe" });
  execSync('git config user.name "Test"', { cwd: dir, stdio: "pipe" });

  const policy = {
    policy_format_version: "0.3.0",
    repository_kind: "tooling",
    paths: {
      forbidden: [],
      canonical_docs: ["README.md", "docs/policy.md"],
      governance_paths: ["repo-policy.json"],
    },
    diff_rules: {
      max_new_docs: 5,
      max_new_files: 5,
      max_net_added_lines: 500,
    },
    registry_rules: [
      {
        id: "canonical-docs-sync",
        kind: "set_equality",
        left: {
          type: "json_array",
          file: "repo-policy.json",
          json_pointer: "/paths/canonical_docs",
        },
        right: {
          type: "markdown_section_links",
          file: "docs/index.md",
          section: "Canonical Documents",
          prefix: "docs/",
        },
      },
    ],
    content_rules: [],
    cochange_rules: [],
  };

  writeFileSync(join(dir, "repo-policy.json"), JSON.stringify(policy, null, 2));
  writeFileSync(join(dir, "README.md"), "# Test\n");
  execSync("mkdir -p docs", { cwd: dir, stdio: "pipe" });
  writeFileSync(join(dir, "docs", "policy.md"), "# Policy\n");
  writeFileSync(join(dir, "docs", "index.md"), [
    "# Docs",
    "",
    "## Canonical Documents",
    "",
    "- [Readme](../README.md)",
    "- [Architecture](architecture.md)",
  ].join("\n"));
  execSync("git add -A && git commit -m init", { cwd: dir, stdio: "pipe" });

  writeFileSync(join(dir, "README.md"), "# Test\n\nChange.\n");
  execSync("git add -A && git commit -m change", { cwd: dir, stdio: "pipe" });

  return {
    dir,
    base: execSync("git rev-parse HEAD~1", { cwd: dir, encoding: "utf-8" }).trim(),
    head: execSync("git rev-parse HEAD", { cwd: dir, encoding: "utf-8" }).trim(),
  };
}

function makeAnchorAwareRepo() {
  const dir = mkdtempSync(join(tmpdir(), "repo-guard-anchors-"));
  execSync("git init", { cwd: dir, stdio: "pipe" });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: "pipe" });
  execSync('git config user.name "Test"', { cwd: dir, stdio: "pipe" });

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
    anchors: {
      types: {
        requirement_id: {
          sources: [
            { kind: "json_field", glob: "requirements/**/*.json", field: "id" },
          ],
        },
        code_req_ref: {
          sources: [
            { kind: "regex", glob: "src/**", pattern: "@req\\s+([A-Z]+-[0-9]+)" },
          ],
        },
        doc_req_ref: {
          sources: [
            { kind: "regex", glob: "docs/**/*.md", pattern: "\\[([A-Z]+-[0-9]+)\\]" },
          ],
        },
      },
    },
    trace_rules: [
      {
        id: "code-refs-must-resolve",
        kind: "must_resolve",
        from_anchor_type: "code_req_ref",
        to_anchor_type: "requirement_id",
      },
      {
        id: "doc-refs-must-resolve",
        kind: "must_resolve",
        from_anchor_type: "doc_req_ref",
        to_anchor_type: "requirement_id",
      },
    ],
    content_rules: [],
    cochange_rules: [],
  };

  const contract = {
    change_type: "feature",
    scope: ["src/**"],
    budgets: {},
    anchors: {
      affects: ["FR-001"],
      implements: ["FR-999"],
      verifies: ["FR-404"],
    },
    must_touch: [],
    must_not_touch: [],
    expected_effects: ["Add anchor diagnostics to structured output"],
  };

  writeFileSync(join(dir, "repo-policy.json"), JSON.stringify(policy, null, 2));
  writeFileSync(join(dir, "contract.json"), JSON.stringify(contract, null, 2));
  writeFileSync(join(dir, "README.md"), "# Test\n");
  execSync("mkdir -p requirements", { cwd: dir, stdio: "pipe" });
  writeFileSync(join(dir, "requirements", "fr-001.json"), JSON.stringify({ id: "FR-001", title: "Login" }));
  writeFileSync(join(dir, "requirements", "fr-002.json"), JSON.stringify({ id: "FR-002", title: "Docs" }));
  execSync("git add -A && git commit -m init", { cwd: dir, stdio: "pipe" });

  execSync("mkdir -p docs src", { cwd: dir, stdio: "pipe" });
  writeFileSync(join(dir, "src", "feature.mjs"), [
    "export function feature() {",
    "  return true; // @req FR-001",
    "}",
    "// @req FR-999",
    "",
  ].join("\n"));
  writeFileSync(join(dir, "docs", "feature.md"), "Covers [FR-002] and [FR-404].\n");
  execSync("git add -A && git commit -m feature", { cwd: dir, stdio: "pipe" });

  return {
    dir,
    contractPath: "contract.json",
    base: execSync("git rev-parse HEAD~1", { cwd: dir, encoding: "utf-8" }).trim(),
    head: execSync("git rev-parse HEAD", { cwd: dir, encoding: "utf-8" }).trim(),
  };
}

console.log("\n--- check-diff --format json emits stable machine-readable result ---");
{
  const repo = makeRepo();
  const result = runGuard([
    "--repo-root", repo.dir,
    "check-diff",
    "--format", "json",
    "--base", repo.base,
    "--head", repo.head,
  ]);

  expect("json exit code follows blocking failures", result.code, 1);
  let parsed = null;
  try {
    parsed = JSON.parse(result.stdout);
    expect("stdout is valid json", true, true);
  } catch (e) {
    expect("stdout is valid json", e.message, "valid json");
  }
  expect("stderr is empty for json output", result.stderr, "");
  expect("command is check-diff", parsed?.command, "check-diff");
  expect("mode is blocking", parsed?.mode, "blocking");
  expect("repositoryRoot is absolute", parsed?.repositoryRoot, repo.dir);
  expect("ok is false", parsed?.ok, false);
  expect("exitCode is 1", parsed?.exitCode, 1);
  expect("changed file count", parsed?.diff?.changedFiles, 2);
  expectTopLevelKeys("top-level json shape is stable", parsed, [
    "advisoryWarnings",
    "command",
    "diff",
    "exitCode",
    "failed",
    "hints",
    "mode",
    "ok",
    "passed",
    "repositoryRoot",
    "result",
    "ruleResults",
    "violationCount",
    "violations",
    "warnings",
  ]);
  expect("result array is stable", Array.isArray(parsed?.ruleResults), true);
  expect("violations array is stable", Array.isArray(parsed?.violations), true);
  expect("hints array is stable", Array.isArray(parsed?.hints), true);
  expect("forbidden violation is detailed",
    parsed?.violations.some((v) => v.rule === "forbidden-paths" && v.data?.files?.includes("secrets/token.txt")),
    true);
  expect("cochange violation is detailed",
    parsed?.violations.some((v) => v.rule.startsWith("cochange:") && v.data?.must_touch?.includes("tests/**")),
    true);

  rmSync(repo.dir, { recursive: true });
}

console.log("\n--- check-diff reports anchor diagnostics in JSON and summary output ---");
{
  const repo = makeAnchorAwareRepo();
  const result = runGuard([
    "--repo-root", repo.dir,
    "check-diff",
    "--format", "json",
    "--base", repo.base,
    "--head", repo.head,
    "--contract", repo.contractPath,
  ]);

  expect("unresolved trace diagnostics fail in blocking mode", result.code, 1);
  let parsed = null;
  try {
    parsed = JSON.parse(result.stdout);
    expect("anchor diagnostics stdout is valid json", true, true);
  } catch (e) {
    expect("anchor diagnostics stdout is valid json", e.message, "valid json");
  }
  expectTopLevelKeys("anchor-aware json shape adds diagnostics without removing stable fields", parsed, [
    "advisoryWarnings",
    "anchors",
    "command",
    "diff",
    "exitCode",
    "failed",
    "hints",
    "mode",
    "ok",
    "passed",
    "repositoryRoot",
    "result",
    "ruleResults",
    "traceRuleResults",
    "violationCount",
    "violations",
    "warnings",
  ]);
  expect("anchor diagnostics count detected anchors", parsed?.anchors?.stats?.detected, 6);
  expect("anchor diagnostics count changed anchors", parsed?.anchors?.stats?.changed, 4);
  expect("anchor diagnostics count declared contract anchors", parsed?.anchors?.stats?.declaredByContract, 3);
  expect("anchor diagnostics count unresolved anchors", parsed?.anchors?.stats?.unresolved, 2);
  expect("anchor diagnostics expose declared contract affects", parsed?.anchors?.declaredByContract?.affects[0], "FR-001");
  expect("anchor diagnostics expose changed anchor file",
    JSON.stringify(parsed?.anchors?.changed.map((anchor) => anchor.file).sort()),
    JSON.stringify(["docs/feature.md", "docs/feature.md", "src/feature.mjs", "src/feature.mjs"]));
  expect("trace rule diagnostics include both results", parsed?.traceRuleResults?.length, 2);
  expect("trace rule diagnostics report unresolved status", parsed?.traceRuleResults?.[0]?.ok, false);
  expect("trace rule diagnostics report resolved value", parsed?.traceRuleResults?.[0]?.resolved[0]?.value, "FR-001");
  expect("trace rule diagnostics report unresolved value", parsed?.traceRuleResults?.[0]?.unresolved[0]?.value, "FR-999");
  expect("anchor unresolved list links back to rule", parsed?.anchors?.unresolved[0]?.rule, "code-refs-must-resolve");
  expect("violations include code trace rule",
    parsed?.violations.some((violation) =>
      violation.rule === "trace-rule: code-refs-must-resolve" &&
      violation.data?.unresolved_anchors?.[0]?.value === "FR-999" &&
      violation.data?.unresolved_anchors?.[0]?.locations[0] === "src/feature.mjs:4:9"
    ),
    true);
  expect("violations include doc trace rule",
    parsed?.violations.some((violation) =>
      violation.rule === "trace-rule: doc-refs-must-resolve" &&
      violation.data?.unresolved_anchors?.[0]?.value === "FR-404" &&
      violation.data?.unresolved_anchors?.[0]?.locations[0] === "docs/feature.md:1:22"
    ),
    true);

  const summary = runGuard([
    "--repo-root", repo.dir,
    "check-diff",
    "--format", "summary",
    "--base", repo.base,
    "--head", repo.head,
    "--contract", repo.contractPath,
  ]);
  expect("anchor summary exit semantics", summary.code, 1);
  expectIncludes("summary reports anchor totals", summary.output, "- Anchors: 6 detected, 4 changed, 3 declared, 2 unresolved");
  expectIncludes("summary reports unresolved trace rule", summary.output, "code-refs-must-resolve");
  expectIncludes("summary reports unresolved anchor value", summary.output, "FR-999");
  expectIncludes("summary reports doc trace rule", summary.output, "doc-refs-must-resolve");
  expectIncludes("summary reports doc anchor value", summary.output, "FR-404");

  rmSync(repo.dir, { recursive: true });
}

console.log("\n--- check-diff with docs change_profile flags forbidden surfaces ---");
{
  const repo = makeSurfaceRepo();
  writeFileSync(join(repo.dir, "contract.json"), JSON.stringify({
    change_type: "docs",
    scope: ["docs/**"],
    budgets: {},
    must_touch: [],
    must_not_touch: [],
    expected_effects: ["Documentation change"],
  }, null, 2));

  const result = runGuard([
    "--repo-root", repo.dir,
    "check-diff",
    "--format", "json",
    "--base", repo.base,
    "--head", repo.head,
    "--contract", "contract.json",
  ]);

  expect("change_profiles exit code follows blocking failure", result.code, 1);
  let parsed = null;
  try {
    parsed = JSON.parse(result.stdout);
    expect("change_profiles stdout is valid json", true, true);
  } catch (e) {
    expect("change_profiles stdout is valid json", e.message, "valid json");
  }
  expect("change_profiles violation is detailed",
    parsed?.violations.some((v) =>
      v.rule === "change-profiles" &&
      v.data?.change_type === "docs" &&
      v.data?.touched_surfaces?.includes("docs") &&
      v.data?.touched_surfaces?.includes("kernel") &&
      v.data?.violating_surfaces?.includes("kernel") &&
      v.data?.unclassified_files?.includes("scripts/tool.mjs")
    ),
    true);

  rmSync(repo.dir, { recursive: true });
}

console.log("\n--- check-diff honors allow_unclassified_surfaces profile switch ---");
{
  const repo = makeUnclassifiedOnlySurfaceRepo();
  writeFileSync(join(repo.dir, "contract.json"), JSON.stringify({
    change_type: "docs",
    scope: ["scripts/**"],
    budgets: {},
    must_touch: [],
    must_not_touch: [],
    expected_effects: ["Script tweak"],
  }, null, 2));

  const result = runGuard([
    "--repo-root", repo.dir,
    "check-diff",
    "--format", "json",
    "--base", repo.base,
    "--head", repo.head,
    "--contract", "contract.json",
  ]);

  expect("allow_unclassified_surfaces keeps unclassified-only diff passing", result.code, 0);
  let parsed = null;
  try {
    parsed = JSON.parse(result.stdout);
    expect("allow_unclassified_surfaces stdout is valid json", true, true);
  } catch (e) {
    expect("allow_unclassified_surfaces stdout is valid json", e.message, "valid json");
  }
  expect("allow_unclassified_surfaces result is ok", parsed?.ok, true);
  expect("allow_unclassified_surfaces has no violations", parsed?.violations.length, 0);

  rmSync(repo.dir, { recursive: true });
}

console.log("\n--- check-diff reports surface debt status in JSON output ---");
{
  const contract = {
    change_type: "feature",
    scope: ["src/**"],
    budgets: {},
    surface_debt: {
      kind: "temporary_growth",
      reason: "Introduce extraction seam before removing duplicated path",
      expected_delta: {
        max_new_files: 1,
        max_net_added_lines: 20,
      },
      repayment_issue: 123,
    },
    must_touch: [],
    must_not_touch: [],
    expected_effects: ["Temporary growth is explicit and repayable"],
  };
  const repo = makeSurfaceDebtRepo(contract);
  const result = runGuard([
    "--repo-root", repo.dir,
    "check-diff",
    "--format", "json",
    "--base", repo.base,
    "--head", repo.head,
    "--contract", repo.contractPath,
  ]);

  expect("declared surface debt exit code", result.code, 0);
  let parsed = null;
  try {
    parsed = JSON.parse(result.stdout);
    expect("surface debt stdout is valid json", true, true);
  } catch (e) {
    expect("surface debt stdout is valid json", e.message, "valid json");
  }
  const debtResult = parsed?.ruleResults.find((r) => r.rule === "surface-debt");
  expect("surface debt rule passes", debtResult?.ok, true);
  expect("surface debt rule exposes declared status",
    debtResult?.details.includes("status: declared"),
    true);

  rmSync(repo.dir, { recursive: true });
}

console.log("\n--- check-diff reports anchor contract schema errors in JSON output ---");
{
  const contract = {
    change_type: "feature",
    scope: ["src/**"],
    budgets: {},
    anchors: {
      affects: ["FR-014", "FR-014"],
    },
    must_touch: [],
    must_not_touch: [],
    expected_effects: ["Anchor intent should be unique"],
  };
  const repo = makeSurfaceDebtRepo(contract);
  const result = runGuard([
    "--repo-root", repo.dir,
    "check-diff",
    "--format", "json",
    "--base", repo.base,
    "--head", repo.head,
    "--contract", repo.contractPath,
  ]);

  expect("malformed anchor contract exit code", result.code, 1);
  let parsed = null;
  try {
    parsed = JSON.parse(result.stdout);
    expect("malformed anchor contract stdout is valid json", true, true);
  } catch (e) {
    expect("malformed anchor contract stdout is valid json", e.message, "valid json");
  }
  const contractViolation = parsed?.violations.find((v) => v.rule === "change-contract");
  expect("anchor contract violation is present", Boolean(contractViolation), true);
  expect("anchor contract error points to anchors",
    contractViolation?.details.some((detail) => detail.includes("/anchors/affects")),
    true);
  expect("anchor contract error reports duplicate items",
    contractViolation?.details.some((detail) => detail.includes("duplicate")),
    true);

  rmSync(repo.dir, { recursive: true });
}

console.log("\n--- check-diff evaluates registry_rules in JSON output ---");
{
  const repo = makeRegistryRepo();
  const result = runGuard([
    "--repo-root", repo.dir,
    "check-diff",
    "--format", "json",
    "--base", repo.base,
    "--head", repo.head,
  ]);

  expect("registry rule exit code follows blocking failure", result.code, 1);
  let parsed = null;
  try {
    parsed = JSON.parse(result.stdout);
    expect("registry rule stdout is valid json", true, true);
  } catch (e) {
    expect("registry rule stdout is valid json", e.message, "valid json");
  }
  const registryViolation = parsed?.violations.find((v) => v.rule === "registry-rules");
  expect("registry violation is present", Boolean(registryViolation), true);
  expect("registry failed rule id reported", registryViolation?.data?.failed_rules?.[0], "canonical-docs-sync");
  expect(
    "registry result includes left entries",
    registryViolation?.data?.results?.[0]?.left_entries?.includes("docs/policy.md"),
    true
  );
  expect(
    "registry result includes right entries",
    registryViolation?.data?.results?.[0]?.right_entries?.includes("docs/architecture.md"),
    true
  );
  expect("registry missing item is reported", registryViolation?.data?.results?.[0]?.missing_from_right?.[0], "docs/policy.md");
  expect("registry extra item is reported", registryViolation?.data?.results?.[0]?.extra_in_right?.[0], "docs/architecture.md");

  rmSync(repo.dir, { recursive: true });
}

console.log("\n--- check-diff reports size_rules in JSON, text, and summary output ---");
{
  const repo = makeSizeRulesRepo();
  const jsonResult = runGuard([
    "--repo-root", repo.dir,
    "check-diff",
    "--format", "json",
    "--base", repo.base,
    "--head", repo.head,
  ]);

  expect("size rules json exit code follows blocking failure", jsonResult.code, 1);
  let parsed = null;
  try {
    parsed = JSON.parse(jsonResult.stdout);
    expect("size rules stdout is valid json", true, true);
  } catch (e) {
    expect("size rules stdout is valid json", e.message, "valid json");
  }
  const violation = parsed?.violations.find((v) => v.rule === "size-rules");
  expect("size rules violation is present", Boolean(violation), true);
  expect("size rules structured file violation",
    violation?.data?.size_violations?.some((v) =>
      v.ruleId === "max-src-lines" &&
      v.scope === "file" &&
      v.path === "src/big.mjs" &&
      v.metric === "lines" &&
      v.actual === 3 &&
      v.max === 2
    ),
    true);
  expect("size rules structured directory violation",
    violation?.data?.size_violations?.some((v) =>
      v.ruleId === "max-src-bytes" &&
      v.scope === "directory" &&
      v.path === "src" &&
      v.metric === "bytes" &&
      v.actual === 14 &&
      v.max === 10
    ),
    true);

  const textResult = runGuard([
    "--repo-root", repo.dir,
    "check-diff",
    "--base", repo.base,
    "--head", repo.head,
  ]);
  expect("size rules text exit code follows blocking failure", textResult.code, 1);
  expectIncludes("text output names size-rules check", textResult.output, "FAIL: size-rules");
  expectIncludes("text output includes size detail", textResult.output, "[max-src-lines] src/big.mjs has 3 lines (max 2)");

  const summaryResult = runGuard([
    "--repo-root", repo.dir,
    "check-diff",
    "--format", "summary",
    "--base", repo.base,
    "--head", repo.head,
  ]);
  expect("size rules summary exit code follows blocking failure", summaryResult.code, 1);
  expectIncludes("summary output names size-rules check", summaryResult.output, "| size-rules |");
  expectIncludes("summary output includes size detail", summaryResult.output, "[max-src-bytes] src has 14 bytes (max 10)");

  rmSync(repo.dir, { recursive: true });
}

console.log("\n--- check-diff treats undeclared growth as non-blocking and enforces declared debt ---");
{
  const undeclaredRepo = makeSurfaceDebtRepo(null);
  const undeclared = runGuard([
    "--repo-root", undeclaredRepo.dir,
    "check-diff",
    "--format", "json",
    "--base", undeclaredRepo.base,
    "--head", undeclaredRepo.head,
  ]);
  expect("undeclared growth exit code", undeclared.code, 0);
  const undeclaredParsed = JSON.parse(undeclared.stdout);
  expect("undeclared growth result passes", undeclaredParsed.ok, true);
  expect("undeclared growth status",
    undeclaredParsed.ruleResults.find((r) => r.rule === "surface-debt")?.details.includes("status: undeclared"),
    true);
  expect("undeclared growth has no violation",
    undeclaredParsed.violations.some((v) => v.rule === "surface-debt"),
    false);
  rmSync(undeclaredRepo.dir, { recursive: true });

  const exceededContract = {
    change_type: "feature",
    scope: ["src/**"],
    budgets: {},
    surface_debt: {
      kind: "temporary_growth",
      reason: "Introduce extraction seam before removing duplicated path",
      expected_delta: {
        max_new_files: 0,
        max_net_added_lines: 1,
      },
      repayment_issue: 123,
    },
    must_touch: [],
    must_not_touch: [],
    expected_effects: ["Temporary growth is explicit and repayable"],
  };
  const exceededRepo = makeSurfaceDebtRepo(exceededContract);
  const exceeded = runGuard([
    "--repo-root", exceededRepo.dir,
    "check-diff",
    "--format", "json",
    "--base", exceededRepo.base,
    "--head", exceededRepo.head,
    "--contract", exceededRepo.contractPath,
  ]);
  expect("declared debt exceeded exit code", exceeded.code, 1);
  const exceededParsed = JSON.parse(exceeded.stdout);
  expect("declared debt exceeded status",
    exceededParsed.violations.find((v) => v.rule === "surface-debt")?.data?.status,
    "declared_debt_exceeded");
  rmSync(exceededRepo.dir, { recursive: true });
}

console.log("\n--- advisory text rules warn without blocking in blocking mode ---");
{
  const repo = makeAdvisoryTextRepo();
  const result = runGuard([
    "--repo-root", repo.dir,
    "check-diff",
    "--format", "json",
    "--base", repo.base,
    "--head", repo.head,
  ]);

  expect("advisory text exit code stays zero", result.code, 0);
  const parsed = JSON.parse(result.stdout);
  expect("advisory text result has warnings", parsed.result, "passed_with_warnings");
  expect("advisory text warning count", parsed.warnings, 1);
  const warning = parsed.advisoryWarnings.find((item) => item.rule === "advisory-text-rules");
  expect("advisory text warning present", Boolean(warning), true);
  expect("advisory text changed file in structured output", warning?.data?.matches?.[0]?.changed_file, "docs/copy.md");
  expect("advisory text canonical file in structured output", warning?.data?.matches?.[0]?.canonical_file, "docs/canonical.md");
  expect("advisory text has no enforced violations", parsed.violations.length, 0);

  rmSync(repo.dir, { recursive: true });
}

console.log("\n--- check-diff --format summary emits GitHub-friendly concise summary ---");
{
  const repo = makeRepo();
  const result = runGuard([
    "--repo-root", repo.dir,
    "--enforcement", "advisory",
    "check-diff",
    "--format", "summary",
    "--base", repo.base,
    "--head", repo.head,
  ]);

  expect("summary advisory exit code", result.code, 0);
  expectIncludes("summary has heading", result.output, "## repo-guard summary");
  expectIncludes("summary has result", result.output, "- Result: failed");
  expectIncludes("summary has mode", result.output, "- Mode: advisory");
  expectIncludes("summary has violation table", result.output, "| Rule | Details |");
  expectIncludes("summary includes forbidden path", result.output, "secrets/token.txt");

  rmSync(repo.dir, { recursive: true });
}

console.log(`\n${failures === 0 ? "All structured output tests passed" : `${failures} test(s) failed`}`);
process.exit(failures === 0 ? 0 : 1);
