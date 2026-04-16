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
