import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { execSync } from "node:child_process";

const __dirname = new URL(".", import.meta.url).pathname;
const projectRoot = resolve(__dirname, "..");

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
    console.error(`  expected to include: ${JSON.stringify(substring)}, got: ${JSON.stringify(str.slice(0, 200))}`);
  }
}

function expectNotIncludes(label, str, substring) {
  const passed = !str.includes(substring);
  console.log(`${passed ? "PASS" : "FAIL"}: ${label}`);
  if (!passed) {
    failures++;
    console.error(`  expected NOT to include: ${JSON.stringify(substring)}`);
  }
}

function makeTmpDir() {
  return mkdtempSync(join(tmpdir(), "repo-guard-doctor-"));
}

function initGitRepo(dir) {
  execSync("git init", { cwd: dir, stdio: "pipe" });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: "pipe" });
  execSync('git config user.name "Test"', { cwd: dir, stdio: "pipe" });
  execSync("git commit --allow-empty -m init", { cwd: dir, stdio: "pipe" });
}

function validPolicy() {
  return JSON.stringify({
    policy_format_version: "0.3.0",
    repository_kind: "tooling",
    paths: { forbidden: [], canonical_docs: ["README.md"], governance_paths: ["repo-policy.json"] },
    diff_rules: { max_new_docs: 2, max_new_files: 15 },
    content_rules: [],
    cochange_rules: []
  });
}

function runRepoGuard(args = "", opts = {}) {
  const cmd = `node ${resolve(projectRoot, "src/repo-guard.mjs")} ${args}`;
  try {
    const stdout = execSync(cmd, { encoding: "utf-8", cwd: opts.cwd || projectRoot, stdio: ["pipe", "pipe", "pipe"] });
    return { stdout, stderr: "", code: 0 };
  } catch (e) {
    return { stdout: e.stdout || "", stderr: e.stderr || "", code: e.status };
  }
}

function runDoctor(args = "", opts = {}) {
  return runRepoGuard(args, opts);
}

// --- self-hosting: doctor runs on this repo ---

console.log("\n--- self-hosting: doctor on repo-guard itself ---");
{
  const { stdout, code } = runDoctor("doctor");
  expect("exit code 0 on healthy repo", code, 0);
  expectIncludes("shows header", stdout, "repo-guard doctor");
  expectIncludes("repo root passes", stdout, "PASS: repository-root");
  expectIncludes("git passes", stdout, "PASS: git-available");
  expectIncludes("fetch-depth passes", stdout, "PASS: fetch-depth");
  expectIncludes("policy passes", stdout, "PASS: repo-policy.json");
  expectIncludes("workflow passes", stdout, "PASS: workflow-config");
  expectIncludes("summary line", stdout, "Summary:");
  expectNotIncludes("no failures in summary", stdout, "1 failed");
}

// --- self-hosting: doctor catches broken fixture ---

console.log("\n--- self-hosting: doctor catches broken-policy fixture ---");
{
  const dir = makeTmpDir();
  initGitRepo(dir);
  const brokenPolicy = resolve(projectRoot, "tests/fixtures/broken-policy.json");
  const dest = resolve(dir, "repo-policy.json");
  writeFileSync(dest, readFileSync(brokenPolicy, "utf-8"));

  const { stdout, code } = runDoctor(`--repo-root ${dir} doctor`);
  expect("exit code 1 for broken policy", code, 1);
  expectIncludes("detects invalid forbid_regex", stdout, "FAIL: repo-policy.json");
  expectIncludes("mentions bad-regex-rule", stdout, "bad-regex-rule");
  expectIncludes("summary shows failure", stdout, "1 failed");
}

// --- missing repo-policy.json ---

console.log("\n--- missing repo-policy.json ---");
{
  const dir = makeTmpDir();
  initGitRepo(dir);

  const { stdout, code } = runDoctor(`--repo-root ${dir} doctor`);
  expect("exit code 1 for missing policy", code, 1);
  expectIncludes("policy FAIL", stdout, "FAIL: repo-policy.json");
  expectIncludes("hint mentions init", stdout, "repo-guard init");
}

// --- invalid JSON in repo-policy.json ---

console.log("\n--- malformed JSON in repo-policy.json ---");
{
  const dir = makeTmpDir();
  initGitRepo(dir);
  writeFileSync(resolve(dir, "repo-policy.json"), "{ not valid json }}}");

  const { stdout, code } = runDoctor(`--repo-root ${dir} doctor`);
  expect("exit code 1 for malformed json", code, 1);
  expectIncludes("policy FAIL with parse error", stdout, "FAIL: repo-policy.json");
  expectIncludes("mentions parse error", stdout, "Parse error");
}

// --- schema-invalid policy ---

console.log("\n--- schema-invalid repo-policy.json ---");
{
  const dir = makeTmpDir();
  initGitRepo(dir);
  writeFileSync(resolve(dir, "repo-policy.json"), JSON.stringify({
    policy_format_version: "0.3.0",
    repository_kind: "unknown_kind",
    paths: {},
    diff_rules: {}
  }));

  const { stdout, code } = runDoctor(`--repo-root ${dir} doctor`);
  expect("exit code 1 for invalid schema", code, 1);
  expectIncludes("policy FAIL with schema error", stdout, "FAIL: repo-policy.json");
  expectIncludes("mentions schema validation", stdout, "Schema validation failed");
}

// --- integration compile diagnostics surface through validate and doctor ---

console.log("\n--- integration compile diagnostics surface through validate and doctor ---");
{
  const dir = makeTmpDir();
  initGitRepo(dir);
  writeFileSync(resolve(dir, "repo-policy.json"), JSON.stringify({
    policy_format_version: "0.3.0",
    repository_kind: "tooling",
    integration: {
      workflows: [
        {
          id: "pr-gate",
          kind: "github_actions",
          path: ".github/workflows/repo-guard.yml",
          role: "custom_gate",
          profiles: ["missing-profile"],
        },
      ],
      profiles: [],
    },
    paths: { forbidden: [], canonical_docs: ["README.md"], governance_paths: ["repo-policy.json"] },
    diff_rules: { max_new_docs: 2, max_new_files: 15 },
    content_rules: [],
    cochange_rules: [],
  }));

  const validate = runRepoGuard(`--repo-root ${dir}`);
  expect("validate exit code 1 for invalid integration", validate.code, 1);
  expectIncludes("validate reports integration compilation", validate.stderr, "FAIL: integration policy compilation");
  expectIncludes("validate reports unknown workflow role", validate.stderr, "role must be one of");
  expectIncludes("validate reports missing profile reference", validate.stderr, "missing-profile");

  const doctor = runDoctor(`--repo-root ${dir} doctor`);
  expect("doctor exit code 1 for invalid integration", doctor.code, 1);
  expectIncludes("doctor reports invalid integration policy", doctor.stdout, "Invalid integration policy");
  expectIncludes("doctor reports unknown workflow role", doctor.stdout, "role must be one of");
  expectIncludes("doctor reports missing profile reference", doctor.stdout, "missing-profile");
}

// --- not a git repo ---

console.log("\n--- not a git repository ---");
{
  const dir = makeTmpDir();
  writeFileSync(resolve(dir, "repo-policy.json"), validPolicy());

  const { stdout, code } = runDoctor(`--repo-root ${dir} doctor`);
  expect("exit code 0 (warns, no fails)", code, 0);
  expectIncludes("git WARN for non-repo", stdout, "WARN: git-available");
  expectIncludes("hint mentions git init", stdout, "git init");
}

// --- non-existent repo root ---

console.log("\n--- non-existent repo root ---");
{
  const { stdout, code } = runDoctor("--repo-root /nonexistent/path/xyz doctor");
  expect("exit code 1 for missing root", code, 1);
  expectIncludes("root FAIL", stdout, "FAIL: repository-root");
}

// --- no workflow directory ---

console.log("\n--- no workflow directory ---");
{
  const dir = makeTmpDir();
  initGitRepo(dir);
  writeFileSync(resolve(dir, "repo-policy.json"), validPolicy());

  const { stdout, code } = runDoctor(`--repo-root ${dir} doctor`);
  expect("exit code 0 (warns, no fails)", code, 0);
  expectIncludes("workflow WARN for missing dir", stdout, "WARN: workflow-config");
  expectIncludes("hint mentions init", stdout, "repo-guard init");
}

// --- workflow without repo-guard reference ---

console.log("\n--- workflow without repo-guard reference ---");
{
  const dir = makeTmpDir();
  initGitRepo(dir);
  writeFileSync(resolve(dir, "repo-policy.json"), validPolicy());
  mkdirSync(resolve(dir, ".github/workflows"), { recursive: true });
  writeFileSync(resolve(dir, ".github/workflows/ci.yml"), "name: CI\non:\n  push:\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hello\n");

  const { stdout, code } = runDoctor(`--repo-root ${dir} doctor`);
  expect("exit code 0 (warns, no fails)", code, 0);
  expectIncludes("workflow WARN for no repo-guard ref", stdout, "WARN: workflow-config");
  expectIncludes("mentions no workflow references", stdout, "No workflow references repo-guard");
}

// --- workflow missing fetch-depth: 0 ---

console.log("\n--- workflow missing fetch-depth ---");
{
  const dir = makeTmpDir();
  initGitRepo(dir);
  writeFileSync(resolve(dir, "repo-policy.json"), validPolicy());
  mkdirSync(resolve(dir, ".github/workflows"), { recursive: true });
  writeFileSync(resolve(dir, ".github/workflows/ci.yml"), "name: CI\non:\n  push:\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npx repo-guard check-pr\n");

  const { stdout, code } = runDoctor(`--repo-root ${dir} doctor`);
  expect("exit code 0 (warns)", code, 0);
  expectIncludes("workflow WARN for missing config", stdout, "WARN: workflow-config");
  expectIncludes("mentions fetch-depth", stdout, "fetch-depth");
}

// --- pass/warn/fail distinction ---

console.log("\n--- output distinguishes pass / warn / fail ---");
{
  const { stdout } = runDoctor("doctor");
  expectIncludes("contains PASS", stdout, "PASS:");
  if (process.env.GITHUB_EVENT_PATH) {
    // In CI with GH_TOKEN, all checks may PASS — WARN is not guaranteed
    console.log("PASS: skipping WARN check (CI with full context may have no warnings)");
  } else {
    expectIncludes("contains WARN", stdout, "WARN:");
  }
  expectIncludes("contains Summary", stdout, "Summary:");
}

// --- event context adapts to environment ---

console.log("\n--- event context adapts to environment ---");
{
  const { stdout } = runDoctor("doctor");
  if (process.env.GITHUB_EVENT_PATH) {
    expectIncludes("event-context PASS in CI", stdout, "PASS: event-context");
  } else {
    expectIncludes("event-context WARN outside CI", stdout, "WARN: event-context");
    expectIncludes("mentions not in GitHub Actions", stdout, "not in GitHub Actions");
  }
}

// --- gh/auth are optional unless linked-issue fallback is used ---

console.log("\n--- gh/auth are optional unless linked-issue fallback is used ---");
{
  const { stdout } = runDoctor("doctor");
  expectNotIncludes("gh-cli absence is never a hard failure", stdout, "FAIL: gh-cli");
  expectNotIncludes("auth-token is never FAIL (auth only needed for linked-issue fallback)", stdout, "FAIL: auth-token");
}

// --- --repo-root works with doctor ---

console.log("\n--- --repo-root flag works with doctor ---");
{
  const { stdout, code } = runDoctor(`--repo-root ${projectRoot} doctor`);
  expect("exit code 0 with explicit repo-root", code, 0);
  expectIncludes("shows repo root path", stdout, projectRoot);
}

// --- summary ---

console.log("\n=========================");
if (failures > 0) {
  console.error(`${failures} test(s) FAILED`);
  process.exit(1);
} else {
  console.log("All doctor tests passed");
}
