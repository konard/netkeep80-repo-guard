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
    change_classes: ["docs-cleanup", "kernel-hardening", "generated-refresh"],
    surface_matrix: {
      "docs-cleanup": {
        allow: ["docs", "governance"],
        forbid: ["kernel", "tests", "generated", "release"],
      },
      "kernel-hardening": {
        allow: ["kernel", "tests"],
        forbid: ["generated", "release"],
      },
      "generated-refresh": {
        allow: ["generated", "release"],
        forbid: ["kernel", "docs", "governance"],
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
    change_classes: ["docs-cleanup"],
    allow_unclassified_files: true,
    surface_matrix: {
      "docs-cleanup": {
        allow: ["docs"],
        forbid: [],
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
  expect("mode is blocking", parsed?.mode, "blocking");
  expect("repositoryRoot is absolute", parsed?.repositoryRoot, repo.dir);
  expect("ok is false", parsed?.ok, false);
  expect("exitCode is 1", parsed?.exitCode, 1);
  expect("changed file count", parsed?.diff?.changedFiles, 2);
  expectTopLevelKeys("top-level json shape is stable", parsed, [
    "advisoryWarnings",
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
    parsed?.violations.some((v) => v.rule === "forbidden-paths" && v.files.includes("secrets/token.txt")),
    true);
  expect("cochange violation is detailed",
    parsed?.violations.some((v) => v.rule.startsWith("cochange:") && v.must_touch.includes("tests/**")),
    true);

  rmSync(repo.dir, { recursive: true });
}

console.log("\n--- check-diff --change-class enforces surface_matrix ---");
{
  const repo = makeSurfaceRepo();
  const result = runGuard([
    "--repo-root", repo.dir,
    "check-diff",
    "--format", "json",
    "--base", repo.base,
    "--head", repo.head,
    "--change-class", "docs-cleanup",
  ]);

  expect("surface matrix exit code follows blocking failure", result.code, 1);
  let parsed = null;
  try {
    parsed = JSON.parse(result.stdout);
    expect("surface matrix stdout is valid json", true, true);
  } catch (e) {
    expect("surface matrix stdout is valid json", e.message, "valid json");
  }
  expect("surface matrix violation is detailed",
    parsed?.violations.some((v) =>
      v.rule === "surface-matrix" &&
      v.change_class === "docs-cleanup" &&
      v.touched_surfaces.includes("docs") &&
      v.touched_surfaces.includes("kernel") &&
      v.violating_surfaces.includes("kernel") &&
      v.unclassified_files.includes("scripts/tool.mjs")
    ),
    true);

  rmSync(repo.dir, { recursive: true });
}

console.log("\n--- check-diff honors allow_unclassified_files policy switch ---");
{
  const repo = makeUnclassifiedOnlySurfaceRepo();
  const result = runGuard([
    "--repo-root", repo.dir,
    "check-diff",
    "--format", "json",
    "--base", repo.base,
    "--head", repo.head,
    "--change-class", "docs-cleanup",
  ]);

  expect("allow_unclassified_files keeps unclassified-only diff passing", result.code, 0);
  let parsed = null;
  try {
    parsed = JSON.parse(result.stdout);
    expect("allow_unclassified_files stdout is valid json", true, true);
  } catch (e) {
    expect("allow_unclassified_files stdout is valid json", e.message, "valid json");
  }
  expect("allow_unclassified_files result is ok", parsed?.ok, true);
  expect("allow_unclassified_files has no violations", parsed?.violations.length, 0);

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
  expect("registry failed rule id reported", registryViolation?.failed_rules[0], "canonical-docs-sync");
  expect(
    "registry result includes left entries",
    registryViolation?.results[0].left_entries.includes("docs/policy.md"),
    true
  );
  expect(
    "registry result includes right entries",
    registryViolation?.results[0].right_entries.includes("docs/architecture.md"),
    true
  );
  expect("registry missing item is reported", registryViolation?.results[0].missing_from_right[0], "docs/policy.md");
  expect("registry extra item is reported", registryViolation?.results[0].extra_in_right[0], "docs/architecture.md");

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
    exceededParsed.violations.find((v) => v.rule === "surface-debt")?.status,
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
  expect("advisory text changed file in structured output", warning?.matches[0]?.changed_file, "docs/copy.md");
  expect("advisory text canonical file in structured output", warning?.matches[0]?.canonical_file, "docs/canonical.md");
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
