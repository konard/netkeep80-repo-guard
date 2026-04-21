import { existsSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadGitHubEvent, resolvePRContractFacts } from "../src/github-pr.mjs";
import { resolveContract, extractLinkedIssueNumbers } from "../src/markdown-contract.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
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

function runRepoGuard(args, opts = {}) {
  return spawnSync(process.execPath, [repoGuard, ...args], {
    cwd: opts.cwd || projectRoot,
    env: opts.env || process.env,
    encoding: "utf-8",
  });
}

function initTinyRepo(prefix) {
  const tmp = mkdtempSync(join(tmpdir(), prefix));
  execSync("git init", { cwd: tmp, stdio: "pipe" });
  execSync("git config user.email test@test.com", { cwd: tmp, stdio: "pipe" });
  execSync("git config user.name Test", { cwd: tmp, stdio: "pipe" });

  const policy = {
    policy_format_version: "0.1.0",
    repository_kind: "library",
    paths: {
      forbidden: [],
      canonical_docs: ["README.md"],
      governance_paths: ["repo-policy.json"],
    },
    diff_rules: { max_new_docs: 5, max_new_files: 20, max_net_added_lines: 500 },
    content_rules: [],
    cochange_rules: [],
  };
  writeFileSync(join(tmp, "repo-policy.json"), JSON.stringify(policy));
  writeFileSync(join(tmp, "a.txt"), "a\nb\n");
  execSync("git add -A", { cwd: tmp, stdio: "pipe" });
  execSync("git commit -m init", { cwd: tmp, stdio: "pipe" });

  writeFileSync(join(tmp, "a.txt"), "a\n");
  execSync("git add -A", { cwd: tmp, stdio: "pipe" });
  execSync("git commit -m second", { cwd: tmp, stdio: "pipe" });

  return tmp;
}

// --- loadGitHubEvent ---

{
  const saved = process.env.GITHUB_EVENT_PATH;
  delete process.env.GITHUB_EVENT_PATH;
  const result = loadGitHubEvent();
  expect("no event path: ok", result.ok, false);
  expect("no event path: error", result.error, "no_event");
  if (saved !== undefined) process.env.GITHUB_EVENT_PATH = saved;
}

{
  const tmp = mkdtempSync(join(tmpdir(), "rg-test-"));
  const eventFile = join(tmp, "event.json");
  writeFileSync(eventFile, JSON.stringify({
    pull_request: {
      number: 42,
      base: { sha: "aaa111" },
      head: { sha: "bbb222" },
      body: "PR description\n\nFixes #7",
    },
    repository: { full_name: "owner/repo" },
  }));

  const saved = process.env.GITHUB_EVENT_PATH;
  process.env.GITHUB_EVENT_PATH = eventFile;
  const result = loadGitHubEvent();
  expect("valid event: ok", result.ok, true);
  expect("valid event: base", result.base, "aaa111");
  expect("valid event: head", result.head, "bbb222");
  expect("valid event: prNumber", result.prNumber, 42);
  expect("valid event: repoFullName", result.repoFullName, "owner/repo");
  expect("valid event: prBody contains Fixes", result.prBody.includes("Fixes #7"), true);

  if (saved !== undefined) process.env.GITHUB_EVENT_PATH = saved;
  else delete process.env.GITHUB_EVENT_PATH;
  rmSync(tmp, { recursive: true });
}

{
  const tmp = mkdtempSync(join(tmpdir(), "rg-test-"));
  const eventFile = join(tmp, "event.json");
  writeFileSync(eventFile, JSON.stringify({ action: "push" }));

  const saved = process.env.GITHUB_EVENT_PATH;
  process.env.GITHUB_EVENT_PATH = eventFile;
  const result = loadGitHubEvent();
  expect("non-PR event: ok", result.ok, false);
  expect("non-PR event: error", result.error, "not_pr_event");

  if (saved !== undefined) process.env.GITHUB_EVENT_PATH = saved;
  else delete process.env.GITHUB_EVENT_PATH;
  rmSync(tmp, { recursive: true });
}

// --- Integration: simulated PR with valid contract passes ---

{
  const prBody = `
## Description
This fixes the login bug.

\`\`\`repo-guard-json
{
  "change_type": "bugfix",
  "scope": ["src/auth.mjs"],
  "budgets": {"max_new_files": 0},
  "must_touch": ["src/auth.mjs"],
  "must_not_touch": ["schemas/"],
  "expected_effects": ["Login works"]
}
\`\`\`

Fixes #10
`;

  const result = resolveContract(prBody, null);
  expect("integration valid: ok", result.ok, true);
  expect("integration valid: change_type", result.contract.change_type, "bugfix");
  expect("integration valid: scope", result.contract.scope[0], "src/auth.mjs");

  const facts = resolvePRContractFacts({ prBody });
  expect("integration valid: adapter ok", facts.ok, true);
  expect("integration valid: adapter source", facts.contractSource, "pr body");

  const issues = extractLinkedIssueNumbers(prBody);
  expect("integration valid: linked issue", issues[0], 10);
}

// --- Integration: issue body carries privileged authorization alongside PR-body change contract ---

{
  const prBody = `
## Description
Edits governance files.

\`\`\`repo-guard-yaml
change_type: feature
scope:
  - schemas/
budgets: {}
must_touch: []
must_not_touch: []
expected_effects:
  - edit governance
\`\`\`

Fixes #77
`;
  const issueBody = `
\`\`\`repo-guard-yaml
change_type: feature
scope:
  - schemas/
budgets: {}
must_touch: []
must_not_touch: []
expected_effects:
  - edit governance
authorized_governance_paths:
  - schemas/**
\`\`\`
`;

  const facts = resolvePRContractFacts({ prBody, issueBody });
  expect("split-source: adapter ok", facts.ok, true);
  expect("split-source: change contract from PR body", facts.contractSource, "pr body");
  expect(
    "split-source: issueAuthorization carries authorized_governance_paths",
    Array.isArray(facts.issueAuthorization?.authorized_governance_paths) &&
      facts.issueAuthorization.authorized_governance_paths[0] === "schemas/**",
    true
  );
}

// --- Integration: simulated PR with no contract, issue fallback ---

{
  const prBody = "Simple PR without contract\n\nFixes #15";
  const issueBody = `
Feature request.

\`\`\`repo-guard-json
{
  "change_type": "feature",
  "scope": ["src/new.mjs"],
  "budgets": {"max_new_files": 2},
  "must_touch": [],
  "must_not_touch": [],
  "expected_effects": ["New feature added"]
}
\`\`\`
`;

  const result = resolveContract(prBody, issueBody);
  expect("integration fallback: ok", result.ok, true);
  expect("integration fallback: from issue", result.contract.change_type, "feature");

  const facts = resolvePRContractFacts({ prBody, issueBody });
  expect("integration fallback: adapter ok", facts.ok, true);
  expect("integration fallback: adapter source", facts.contractSource, "linked issue");
  expect("integration fallback: adapter linked issue", facts.linkedIssues[0], 15);
}

// --- Integration: ambiguous linked issues (>1) should be detected ---

{
  const prBody = "No contract here\n\nFixes #10\nCloses #20\nResolves #30";
  const issues = extractLinkedIssueNumbers(prBody);
  expect("ambiguous links: count", issues.length, 3);
  expect("ambiguous links: first", issues[0], 10);
  expect("ambiguous links: second", issues[1], 20);
  expect("ambiguous links: third", issues[2], 30);

  const prResult = resolveContract(prBody, null);
  expect("ambiguous links: no contract in PR", prResult.ok, false);
  expect("ambiguous links: contract_not_found", prResult.error, "contract_not_found");

  const facts = resolvePRContractFacts({ prBody });
  expect("ambiguous links: adapter fails", facts.ok, false);
  expect("ambiguous links: adapter error", facts.error, "issue_link_ambiguous");
  expect("ambiguous links: adapter source", facts.contractSource, "none");
}

{
  const prBody = "PR with contract and multiple links\n\nFixes #10\nCloses #20\n\n```repo-guard-json\n{\"change_type\":\"bugfix\",\"scope\":[\"a\"],\"budgets\":{},\"must_touch\":[],\"must_not_touch\":[],\"expected_effects\":[\"fix\"]}\n```";
  const result = resolveContract(prBody, null);
  expect("ambiguous links with contract: ok (contract in PR, no fallback needed)", result.ok, true);
}

// --- Integration: simulated PR with no contract anywhere fails ---

{
  const prBody = "No contract here\n\nFixes #20";
  const issueBody = "Also no contract in the issue";

  const result = resolveContract(prBody, issueBody);
  expect("integration missing: ok", result.ok, false);
  expect("integration missing: error", result.error, "fallback_missing");

  const facts = resolvePRContractFacts({ prBody, issueBody });
  expect("integration missing: adapter ok", facts.ok, false);
  expect("integration missing: adapter error", facts.error, "fallback_missing");
  expect("integration missing: adapter source", facts.contractSource, "none");
}

// --- check-pr passes shell-looking event refs to git without executing them ---

{
  const tmp = initTinyRepo("rg-ref-injection-pr-");
  const marker = join(tmp, "check-pr-injected");
  const eventFile = join(tmp, "event.json");
  writeFileSync(eventFile, JSON.stringify({
    pull_request: {
      number: 42,
      base: { sha: `HEAD~1; touch ${marker}; #` },
      head: { sha: "HEAD" },
      body: "```repo-guard-json\n{\"change_type\":\"bugfix\",\"scope\":[\"a.txt\"],\"budgets\":{\"max_new_files\":0,\"max_net_added_lines\":500},\"must_touch\":[\"a.txt\"],\"must_not_touch\":[],\"expected_effects\":[\"test\"]}\n```",
    },
    repository: { full_name: "owner/repo" },
  }));

  const result = runRepoGuard(["--repo-root", tmp, "check-pr"], {
    env: { ...process.env, GITHUB_EVENT_PATH: eventFile },
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`;
  expect("check-pr rejects shell-looking base ref", result.status, 1);
  expect("check-pr reports git diff failure", output.includes("git diff failed"), true);
  expect("check-pr does not execute injected command", existsSync(marker), false);

  rmSync(tmp, { recursive: true });
}

// --- check-pr fetches linked issue body for privileged authorization even when PR body has a contract ---

{
  const { mkdirSync } = await import("node:fs");
  const tmp = mkdtempSync(join(tmpdir(), "rg-issue-fetch-"));
  execSync("git init", { cwd: tmp, stdio: "pipe" });
  execSync("git config user.email test@test.com", { cwd: tmp, stdio: "pipe" });
  execSync("git config user.name Test", { cwd: tmp, stdio: "pipe" });

  const policy = {
    policy_format_version: "0.1.0",
    repository_kind: "library",
    paths: { forbidden: [], canonical_docs: ["README.md"], governance_paths: ["schemas/**"] },
    diff_rules: { max_new_docs: 5, max_new_files: 20, max_net_added_lines: 500 },
    content_rules: [],
    cochange_rules: [],
  };
  writeFileSync(join(tmp, "repo-policy.json"), JSON.stringify(policy));
  writeFileSync(join(tmp, "a.txt"), "a\n");
  execSync("git add -A && git commit -m init", { cwd: tmp, stdio: "pipe" });

  mkdirSync(join(tmp, "schemas"), { recursive: true });
  writeFileSync(join(tmp, "schemas/change-contract.schema.json"), "changed\n");
  execSync("git add -A && git commit -m 'touch governance'", { cwd: tmp, stdio: "pipe" });

  const eventFile = join(tmp, "event.json");
  const prContract = {
    change_type: "feature",
    scope: ["schemas/"],
    budgets: { max_new_files: 5, max_net_added_lines: 500 },
    must_touch: [],
    must_not_touch: [],
    expected_effects: ["edit governance"],
  };
  const prBody = "```repo-guard-json\n" + JSON.stringify(prContract) + "\n```\n\nFixes #77";
  writeFileSync(eventFile, JSON.stringify({
    pull_request: {
      number: 42,
      base: { sha: "HEAD~1" },
      head: { sha: "HEAD" },
      body: prBody,
    },
    repository: { full_name: "owner/repo" },
  }));

  // Fake `gh` that responds with an issue body carrying privileged authorization.
  const fakeGhDir = mkdtempSync(join(tmpdir(), "rg-fake-gh-"));
  const fakeGh = join(fakeGhDir, "gh");
  const issueBody = [
    "```repo-guard-yaml",
    "authorized_governance_paths:",
    "  - schemas/**",
    "```",
  ].join("\n");
  writeFileSync(
    fakeGh,
    `#!/usr/bin/env node\nif (process.argv.includes("--version")) { console.log("gh 0.0"); process.exit(0); }\nconst body = ${JSON.stringify(issueBody)};\nprocess.stdout.write(body);\n`
  );
  execSync(`chmod +x ${fakeGh}`);

  const result = runRepoGuard(["--repo-root", tmp, "check-pr"], {
    env: {
      ...process.env,
      GITHUB_EVENT_PATH: eventFile,
      PATH: `${fakeGhDir}:${process.env.PATH}`,
    },
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`;
  expect(
    "check-pr fetches issue body when PR body has contract: authorization applied",
    output.includes("PASS: governance-change-authorization"),
    true
  );
  expect(
    "check-pr fetches issue body when PR body has contract: no FAIL",
    output.includes("FAIL: governance-change-authorization"),
    false
  );

  rmSync(tmp, { recursive: true });
  rmSync(fakeGhDir, { recursive: true });
}

// --- check-pr fails closed when base repo-policy.json cannot be read (no fallback to head policy) ---

{
  const tmp = mkdtempSync(join(tmpdir(), "rg-fail-closed-missing-base-"));
  execSync("git init", { cwd: tmp, stdio: "pipe" });
  execSync("git config user.email test@test.com", { cwd: tmp, stdio: "pipe" });
  execSync("git config user.name Test", { cwd: tmp, stdio: "pipe" });

  // Base commit: no repo-policy.json present (simulates a broken / unreadable base policy).
  writeFileSync(join(tmp, "a.txt"), "a\n");
  execSync("git add -A && git commit -m init-no-policy", { cwd: tmp, stdio: "pipe" });
  const baseSha = execSync("git rev-parse HEAD", { cwd: tmp, encoding: "utf-8" }).trim();

  // Head commit: policy file appears with NO governance_paths (i.e. head policy
  // would say "no boundary" — exactly the bypass the rule must defend against).
  const headPolicy = {
    policy_format_version: "0.1.0",
    repository_kind: "library",
    paths: { forbidden: [], canonical_docs: ["README.md"], governance_paths: [] },
    diff_rules: { max_new_docs: 5, max_new_files: 20, max_net_added_lines: 500 },
    content_rules: [],
    cochange_rules: [],
  };
  writeFileSync(join(tmp, "repo-policy.json"), JSON.stringify(headPolicy));
  writeFileSync(join(tmp, "a.txt"), "a\nb\n");
  execSync("git add -A && git commit -m head-introduces-policy-without-boundary", { cwd: tmp, stdio: "pipe" });

  const eventFile = join(tmp, "event.json");
  writeFileSync(eventFile, JSON.stringify({
    pull_request: {
      number: 42,
      base: { sha: baseSha },
      head: { sha: "HEAD" },
      body: "```repo-guard-json\n{\"change_type\":\"chore\",\"scope\":[\"a.txt\"],\"budgets\":{\"max_new_files\":5,\"max_net_added_lines\":500},\"must_touch\":[],\"must_not_touch\":[],\"expected_effects\":[\"x\"]}\n```",
    },
    repository: { full_name: "owner/repo" },
  }));

  const result = runRepoGuard(["--repo-root", tmp, "check-pr"], {
    env: { ...process.env, GITHUB_EVENT_PATH: eventFile },
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`;
  expect(
    "fail-closed (missing base policy): exits non-zero",
    result.status,
    1
  );
  expect(
    "fail-closed (missing base policy): governance-trusted-boundary fails",
    output.includes("FAIL: governance-trusted-boundary"),
    true
  );
  expect(
    "fail-closed (missing base policy): does NOT fall back to head policy with WARN",
    output.includes("falling back to head policy"),
    false
  );

  rmSync(tmp, { recursive: true });
}

// --- check-pr fails closed when base repo-policy.json is unparseable JSON ---

{
  const tmp = mkdtempSync(join(tmpdir(), "rg-fail-closed-bad-base-"));
  execSync("git init", { cwd: tmp, stdio: "pipe" });
  execSync("git config user.email test@test.com", { cwd: tmp, stdio: "pipe" });
  execSync("git config user.name Test", { cwd: tmp, stdio: "pipe" });

  // Base commit: repo-policy.json is invalid JSON.
  writeFileSync(join(tmp, "repo-policy.json"), "not valid json {{{");
  writeFileSync(join(tmp, "a.txt"), "a\n");
  execSync("git add -A && git commit -m init-broken-policy", { cwd: tmp, stdio: "pipe" });
  const baseSha = execSync("git rev-parse HEAD", { cwd: tmp, encoding: "utf-8" }).trim();

  // Head commit: replace policy with a valid one (so head loads); make a benign edit too.
  const headPolicy = {
    policy_format_version: "0.1.0",
    repository_kind: "library",
    paths: { forbidden: [], canonical_docs: ["README.md"], governance_paths: ["repo-policy.json"] },
    diff_rules: { max_new_docs: 5, max_new_files: 20, max_net_added_lines: 500 },
    content_rules: [],
    cochange_rules: [],
  };
  writeFileSync(join(tmp, "repo-policy.json"), JSON.stringify(headPolicy));
  writeFileSync(join(tmp, "a.txt"), "a\nb\n");
  execSync("git add -A && git commit -m head-fixes-policy", { cwd: tmp, stdio: "pipe" });

  const eventFile = join(tmp, "event.json");
  writeFileSync(eventFile, JSON.stringify({
    pull_request: {
      number: 42,
      base: { sha: baseSha },
      head: { sha: "HEAD" },
      body: "```repo-guard-json\n{\"change_type\":\"chore\",\"scope\":[\"a.txt\"],\"budgets\":{\"max_new_files\":5,\"max_net_added_lines\":500},\"must_touch\":[],\"must_not_touch\":[],\"expected_effects\":[\"x\"]}\n```",
    },
    repository: { full_name: "owner/repo" },
  }));

  const result = runRepoGuard(["--repo-root", tmp, "check-pr"], {
    env: { ...process.env, GITHUB_EVENT_PATH: eventFile },
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`;
  expect(
    "fail-closed (unparseable base policy): exits non-zero",
    result.status,
    1
  );
  expect(
    "fail-closed (unparseable base policy): governance-trusted-boundary fails",
    output.includes("FAIL: governance-trusted-boundary"),
    true
  );
  expect(
    "fail-closed (unparseable base policy): does NOT fall back to head policy",
    output.includes("falling back to head policy"),
    false
  );

  rmSync(tmp, { recursive: true });
}

// --- check-pr evaluates rules from the trusted base policy, not the PR head policy ---

{
  const { mkdirSync } = await import("node:fs");
  const tmp = mkdtempSync(join(tmpdir(), "rg-base-policy-rules-"));
  execSync("git init", { cwd: tmp, stdio: "pipe" });
  execSync("git config user.email test@test.com", { cwd: tmp, stdio: "pipe" });
  execSync("git config user.name Test", { cwd: tmp, stdio: "pipe" });

  const basePolicy = {
    policy_format_version: "0.3.0",
    repository_kind: "library",
    paths: {
      forbidden: [],
      canonical_docs: ["README.md"],
      governance_paths: ["repo-policy.json"],
    },
    diff_rules: { max_new_docs: 5, max_new_files: 20, max_net_added_lines: 500 },
    size_rules: [
      {
        id: "base-max-feature-lines",
        scope: "file",
        metric: "lines",
        glob: "src/feature.txt",
        max: 0,
        count: "changed_only",
        level: "blocking",
      },
    ],
    content_rules: [],
    cochange_rules: [],
  };

  mkdirSync(join(tmp, "src"), { recursive: true });
  writeFileSync(join(tmp, "README.md"), "# Test\n");
  writeFileSync(join(tmp, "src/feature.txt"), "");
  writeFileSync(join(tmp, "repo-policy.json"), JSON.stringify(basePolicy, null, 2));
  execSync("git add -A && git commit -m init", { cwd: tmp, stdio: "pipe" });
  const baseSha = execSync("git rev-parse HEAD", { cwd: tmp, encoding: "utf-8" }).trim();

  const relaxedHeadPolicy = {
    ...basePolicy,
    size_rules: [
      {
        ...basePolicy.size_rules[0],
        max: 1000,
      },
    ],
  };
  writeFileSync(join(tmp, "repo-policy.json"), JSON.stringify(relaxedHeadPolicy, null, 2));
  writeFileSync(join(tmp, "src/feature.txt"), "one line that base policy must reject\n");
  execSync("git add -A && git commit -m relax-policy-and-change-feature", { cwd: tmp, stdio: "pipe" });

  const prContract = {
    change_type: "feature",
    scope: ["repo-policy.json", "src/feature.txt"],
    budgets: { max_new_files: 5, max_net_added_lines: 500 },
    must_touch: [],
    must_not_touch: [],
    expected_effects: ["exercise base policy"],
  };
  const eventFile = join(tmp, "event.json");
  writeFileSync(eventFile, JSON.stringify({
    pull_request: {
      number: 42,
      base: { sha: baseSha },
      head: { sha: "HEAD" },
      body: "```repo-guard-json\n" + JSON.stringify(prContract) + "\n```\n\nFixes #77",
    },
    repository: { full_name: "owner/repo" },
  }));

  const fakeGhDir = mkdtempSync(join(tmpdir(), "rg-fake-gh-"));
  const fakeGh = join(fakeGhDir, "gh");
  const issueBody = [
    "```repo-guard-yaml",
    "authorized_governance_paths:",
    "  - repo-policy.json",
    "```",
  ].join("\n");
  writeFileSync(
    fakeGh,
    `#!/usr/bin/env node\nif (process.argv.includes("--version")) { console.log("gh 0.0"); process.exit(0); }\nprocess.stdout.write(${JSON.stringify(issueBody)});\n`
  );
  execSync(`chmod +x ${fakeGh}`);

  const result = runRepoGuard(["--repo-root", tmp, "check-pr"], {
    env: {
      ...process.env,
      GITHUB_EVENT_PATH: eventFile,
      PATH: `${fakeGhDir}:${process.env.PATH}`,
    },
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`;
  expect(
    "check-pr uses base policy rules: exits non-zero",
    result.status,
    1
  );
  expect(
    "check-pr uses base policy rules: size rule fails",
    output.includes("FAIL: size-rules"),
    true
  );
  expect(
    "check-pr uses base policy rules: reports base rule id",
    output.includes("base-max-feature-lines"),
    true
  );

  rmSync(tmp, { recursive: true });
  rmSync(fakeGhDir, { recursive: true });
}

console.log(`\n${failures === 0 ? "All tests passed" : `${failures} test(s) failed`}`);
process.exit(failures === 0 ? 0 : 1);
