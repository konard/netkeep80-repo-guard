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
    output: `${result.stdout || ""}${result.stderr || ""}`,
  };
}

function makePolicy(enforcementMode) {
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
      max_new_files: 0,
      max_net_added_lines: 500,
    },
    content_rules: [],
    cochange_rules: [],
  };

  if (enforcementMode) {
    policy.enforcement = { mode: enforcementMode };
  }

  return policy;
}

function makeRepo(enforcementMode) {
  const dir = mkdtempSync(join(tmpdir(), "repo-guard-enforcement-"));
  execSync("git init", { cwd: dir, stdio: "pipe" });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: "pipe" });
  execSync('git config user.name "Test"', { cwd: dir, stdio: "pipe" });

  writeFileSync(join(dir, "repo-policy.json"), JSON.stringify(makePolicy(enforcementMode), null, 2));
  writeFileSync(join(dir, "README.md"), "# Test\n");
  execSync("git add -A && git commit -m init", { cwd: dir, stdio: "pipe" });

  writeFileSync(join(dir, "new-file.txt"), "new\n");
  execSync("git add -A && git commit -m add-file", { cwd: dir, stdio: "pipe" });

  return {
    dir,
    base: execSync("git rev-parse HEAD~1", { cwd: dir, encoding: "utf-8" }).trim(),
    head: execSync("git rev-parse HEAD", { cwd: dir, encoding: "utf-8" }).trim(),
  };
}

console.log("\n--- blocking check-diff fails on policy violation ---");
{
  const repo = makeRepo();
  const result = runGuard([
    "--repo-root", repo.dir,
    "check-diff",
    "--base", repo.base,
    "--head", repo.head,
  ]);

  expect("blocking exit code", result.code, 1);
  expectIncludes("blocking reports FAIL", result.output, "FAIL: max-new-files");
  expectIncludes("blocking summary names mode", result.output, "mode: blocking");
  expectIncludes("blocking result failed", result.output, "Result: failed");

  rmSync(repo.dir, { recursive: true });
}

console.log("\n--- advisory check-diff reports but does not fail ---");
{
  const repo = makeRepo();
  const result = runGuard([
    "--repo-root", repo.dir,
    "--enforcement", "advisory",
    "check-diff",
    "--base", repo.base,
    "--head", repo.head,
  ]);

  expect("advisory exit code", result.code, 0);
  expectIncludes("advisory reports WARN", result.output, "WARN: max-new-files");
  expectIncludes("advisory summary has zero enforced failures", result.output, "0 failed");
  expectIncludes("advisory summary names advisory violations", result.output, "advisory violation");
  expectIncludes("advisory result still records failed checks", result.output, "Result: failed");

  rmSync(repo.dir, { recursive: true });
}

console.log("\n--- warn alias can be supplied after the command ---");
{
  const repo = makeRepo();
  const result = runGuard([
    "check-diff",
    "--repo-root", repo.dir,
    "--base", repo.base,
    "--head", repo.head,
    "--enforcement", "warn",
  ]);

  expect("warn alias exit code", result.code, 0);
  expectIncludes("warn alias resolves to advisory", result.output, "mode: advisory");

  rmSync(repo.dir, { recursive: true });
}

console.log("\n--- policy config can opt into advisory mode ---");
{
  const repo = makeRepo("advisory");
  const result = runGuard([
    "--repo-root", repo.dir,
    "check-diff",
    "--base", repo.base,
    "--head", repo.head,
  ]);

  expect("policy advisory exit code", result.code, 0);
  expectIncludes("policy advisory mode", result.output, "mode: advisory");

  rmSync(repo.dir, { recursive: true });
}

console.log("\n--- CLI enforcement overrides policy config ---");
{
  const repo = makeRepo("advisory");
  const result = runGuard([
    "--repo-root", repo.dir,
    "--enforcement", "blocking",
    "check-diff",
    "--base", repo.base,
    "--head", repo.head,
  ]);

  expect("CLI blocking override exit code", result.code, 1);
  expectIncludes("CLI blocking override mode", result.output, "mode: blocking");

  rmSync(repo.dir, { recursive: true });
}

console.log("\n--- check-pr missing contract is advisory when requested ---");
{
  const repo = makeRepo();
  const eventPath = join(repo.dir, "event.json");
  writeFileSync(eventPath, JSON.stringify({
    pull_request: {
      number: 123,
      base: { sha: repo.base },
      head: { sha: repo.head },
      body: "No contract here.",
    },
    repository: { full_name: "owner/repo" },
  }));

  const result = runGuard([
    "--repo-root", repo.dir,
    "--enforcement", "advisory",
    "check-pr",
  ], {
    env: { GITHUB_EVENT_PATH: eventPath },
  });

  expect("check-pr advisory missing contract exit code", result.code, 0);
  expectIncludes("check-pr missing contract warning", result.output, "WARN: change-contract");
  expectIncludes("check-pr advisory summary", result.output, "advisory violation");

  rmSync(repo.dir, { recursive: true });
}

console.log(`\n${failures === 0 ? "All enforcement mode tests passed" : `${failures} test(s) failed`}`);
process.exit(failures === 0 ? 0 : 1);
