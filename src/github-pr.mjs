import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { getDiff, readBaseGovernancePaths } from "./git.mjs";
import {
  extractContract,
  extractIssueAuthorization,
  extractLinkedIssueNumbers,
  resolveContract,
} from "./markdown-contract.mjs";
import { warnReservedContractFields } from "./policy-compiler.mjs";
import { resolveEnforcementMode } from "./enforcement.mjs";
import { loadPolicyRuntime, validationCheck } from "./runtime/validation.mjs";
import { runPolicyPipeline } from "./runtime/pipeline.mjs";

const GITHUB_REPO_FULL_NAME = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const ISSUE_NUMBER = /^[1-9][0-9]*$/;

export function loadGitHubEvent() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) {
    return { ok: false, error: "no_event", message: "GITHUB_EVENT_PATH not set; not running in GitHub Actions" };
  }

  let event;
  try {
    event = JSON.parse(readFileSync(eventPath, "utf-8"));
  } catch (e) {
    return { ok: false, error: "event_read_error", message: `Cannot read event file: ${e.message}` };
  }

  const pr = event.pull_request;
  if (!pr) {
    return { ok: false, error: "not_pr_event", message: "GitHub event does not contain pull_request data" };
  }

  return {
    ok: true,
    base: pr.base?.sha,
    head: pr.head?.sha,
    prBody: pr.body || "",
    prNumber: pr.number,
    repoFullName: event.repository?.full_name || process.env.GITHUB_REPOSITORY || "",
  };
}

export function fetchIssueBody(repoFullName, issueNumber) {
  const issueNumberText = String(issueNumber);
  if (!GITHUB_REPO_FULL_NAME.test(repoFullName) || !ISSUE_NUMBER.test(issueNumberText)) {
    return null;
  }

  try {
    const result = execFileSync(
      "gh",
      ["api", `repos/${repoFullName}/issues/${issueNumberText}`, "--jq", ".body"],
      { encoding: "utf-8", timeout: 30000 }
    );
    return result.trim() || null;
  } catch {
    return null;
  }
}

export function checkPrerequisites() {
  const missing = [];
  if (!process.env.GITHUB_EVENT_PATH) {
    missing.push("GITHUB_EVENT_PATH env var (set automatically by GitHub Actions)");
  }
  try {
    execFileSync("git", ["--version"], { encoding: "utf-8", stdio: "pipe" });
  } catch {
    missing.push("git CLI (required for diff analysis)");
  }
  return missing;
}

export function checkIssueFallbackPrerequisites() {
  const missing = [];
  try {
    execFileSync("gh", ["--version"], { encoding: "utf-8", stdio: "pipe" });
  } catch {
    missing.push("gh CLI (required for linked issue fallback)");
  }
  return missing;
}

export function resolvePRContractFacts({ prBody, issueBody = null, linkedIssueCount = null }) {
  const linkedIssues = extractLinkedIssueNumbers(prBody);
  const issueAuthorization = extractIssueAuthorization(issueBody);

  const prResult = extractContract(prBody);
  if (prResult.ok) {
    return {
      ok: true,
      contract: prResult.contract,
      contractSource: "pr body",
      linkedIssues,
      issueAuthorization,
    };
  }

  if (prResult.error !== "contract_not_found") {
    return {
      ok: false,
      error: prResult.error,
      message: prResult.message,
      contractSource: "pr body",
      linkedIssues,
      issueAuthorization,
    };
  }

  const resolvedLinkedIssueCount = linkedIssueCount ?? linkedIssues.length;
  if (resolvedLinkedIssueCount > 1) {
    return {
      ok: false,
      error: "issue_link_ambiguous",
      message: `PR body references ${resolvedLinkedIssueCount} issues (${linkedIssues.map(n => `#${n}`).join(", ")}); expected exactly one`,
      contractSource: "none",
      linkedIssues,
      issueAuthorization,
    };
  }

  const issueResult = resolveContract(prBody, issueBody);
  if (issueResult.ok) {
    return {
      ok: true,
      contract: issueResult.contract,
      contractSource: "linked issue",
      linkedIssues,
      issueAuthorization,
    };
  }

  return {
    ok: false,
    error: issueResult.error,
    message: issueResult.message,
    contractSource: "none",
    linkedIssues,
    issueAuthorization,
  };
}

export function runCheckPR(roots, args = []) {
  for (const arg of args) {
    if (arg.startsWith("-")) {
      console.error(`Unknown option for check-pr: ${arg}`);
      console.error("Usage: repo-guard check-pr [--enforcement <advisory|blocking>]");
      process.exit(1);
    }
  }

  const prereqs = checkPrerequisites();
  if (prereqs.length > 0) {
    console.error("ERROR: check-pr prerequisites not met:");
    for (const p of prereqs) console.error(`  - ${p}`);
    console.error("\ncheck-pr expects to run inside a GitHub Actions pull_request workflow.");
    console.error("Required: GITHUB_EVENT_PATH and git with sufficient fetch depth.");
    process.exit(1);
  }

  const eventInfo = loadGitHubEvent();
  if (!eventInfo.ok) {
    console.error(`ERROR: ${eventInfo.message}`);
    process.exit(1);
  }

  const { base, head, prBody, prNumber, repoFullName } = eventInfo;
  if (!base || !head) {
    console.error("ERROR: pull_request event missing base/head SHA");
    process.exit(1);
  }
  console.log(`PR #${prNumber}: checking contract and diff (${base?.slice(0, 7)}..${head?.slice(0, 7)})`);

  const runtime = loadPolicyRuntime(roots);
  const { ajv, policy, contractSchema } = runtime;

  if (!runtime.ok) {
    console.error("\nPolicy compilation failed");
    process.exit(1);
  }

  const enforcement = resolveEnforcementMode({ cliValue: roots.enforcementMode, policy });
  if (!enforcement.ok) {
    console.error(`ERROR: ${enforcement.message}`);
    process.exit(1);
  }

  let issueBody = null;
  const linkedIssues = extractLinkedIssueNumbers(prBody);
  const prResult = extractContract(prBody);
  const prBodyHasContract = prResult.ok;
  const needsIssueFallback =
    !prResult.ok && prResult.error === "contract_not_found" && linkedIssues.length === 1;
  if (linkedIssues.length === 1 && (needsIssueFallback || prBodyHasContract)) {
    if (needsIssueFallback) {
      console.log(`No contract in PR body; trying linked issue #${linkedIssues[0]}...`);
    } else {
      console.log(`Fetching linked issue #${linkedIssues[0]} for privileged authorization...`);
    }
    const fallbackPrereqs = checkIssueFallbackPrerequisites();
    if (fallbackPrereqs.length > 0) {
      if (needsIssueFallback) {
        console.error("ERROR: linked issue fallback prerequisites not met:");
        for (const p of fallbackPrereqs) console.error(`  - ${p}`);
        process.exit(1);
      } else {
        console.warn(
          "WARN: linked issue lookup prerequisites not met; privileged authorization from the issue body will be unavailable"
        );
        for (const p of fallbackPrereqs) console.warn(`  - ${p}`);
      }
    } else {
      issueBody = fetchIssueBody(repoFullName, linkedIssues[0]);
      if (issueBody === null && prBodyHasContract) {
        console.warn(
          `WARN: could not fetch linked issue #${linkedIssues[0]} body; privileged authorization from the issue body will be unavailable`
        );
      }
    }
  }

  let contractResult = resolvePRContractFacts({ prBody, issueBody });
  if (
    !contractResult.ok &&
    contractResult.linkedIssues.length === 1 &&
    issueBody === null &&
    contractResult.error !== "issue_link_ambiguous"
  ) {
    contractResult = {
      ...contractResult,
      error: "issue_fetch_failed",
      message: `Could not fetch issue #${contractResult.linkedIssues[0]} body`,
    };
  }
  let contract = null;
  let contractSource = contractResult.contractSource || "none";
  const issueAuthorization = contractResult.issueAuthorization || null;
  const initialChecks = [];
  if (!contractResult.ok) {
    initialChecks.push({
      name: "change-contract",
      check: {
        ok: false,
        message: `[${contractResult.error}]: ${contractResult.message}`,
      },
    });
  } else {
    const contractCheck = validationCheck(ajv, contractSchema, contractResult.contract, "change-contract (from markdown)");
    initialChecks.push({ name: "change-contract", check: contractCheck });
    if (contractCheck.ok) {
      contract = contractResult.contract;
      contractSource = contractResult.contractSource;
      for (const w of warnReservedContractFields(contract)) {
        console.warn(`WARN: ${w}`);
      }
    }
  }

  let diffText;
  try {
    diffText = getDiff(base, head, roots.repoRoot);
  } catch (e) {
    console.error(`ERROR: ${e.message}`);
    process.exit(1);
  }

  const basePolicyRead = readBaseGovernancePaths(base, roots.repoRoot);
  let trustedGovernancePaths;
  if (basePolicyRead.error) {
    initialChecks.push({
      name: "governance-trusted-boundary",
      check: {
        ok: false,
        message: `cannot establish trusted governance boundary: ${basePolicyRead.error}`,
        hint: "check-pr requires reading repo-policy.json at the PR base via `git show <base>:repo-policy.json` so a PR cannot narrow the governance perimeter in the same diff. The boundary is intentionally not falling back to the PR head policy. Ensure the base ref is fetched and repo-policy.json is valid JSON on the base branch.",
        details: [`base_ref: ${base}`, `base_policy_read_error: ${basePolicyRead.error}`],
      },
    });
    trustedGovernancePaths = [];
  } else {
    trustedGovernancePaths = basePolicyRead.governancePaths ?? [];
  }

  const summary = runPolicyPipeline({
    mode: "check-pr",
    repositoryRoot: roots.repoRoot,
    policy,
    contract,
    contractSource,
    issueAuthorization,
    trustedGovernancePaths,
    enforcement,
    diffText,
    initialChecks,
  });
  process.exit(summary.exitCode);
}
