import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { extractContract, extractLinkedIssueNumbers, resolveContract } from "./markdown-contract.mjs";
import { warnReservedContractFields } from "./policy-compiler.mjs";
import { resolveEnforcementMode } from "./enforcement.mjs";
import { loadPolicyRuntime, validationCheck } from "./runtime/validation.mjs";
import { runPolicyPipeline } from "./runtime/pipeline.mjs";

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
  try {
    const result = execSync(
      `gh api repos/${repoFullName}/issues/${issueNumber} --jq .body`,
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
    execSync("git --version", { encoding: "utf-8", stdio: "pipe" });
  } catch {
    missing.push("git CLI (required for diff analysis)");
  }
  try {
    execSync("gh --version", { encoding: "utf-8", stdio: "pipe" });
  } catch {
    missing.push("gh CLI (required for linked issue fallback)");
  }
  return missing;
}

export function resolvePRContractFacts({ prBody, issueBody = null, linkedIssueCount = null }) {
  const prResult = extractContract(prBody);
  if (prResult.ok) {
    return {
      ok: true,
      contract: prResult.contract,
      contractSource: "pr body",
      linkedIssues: extractLinkedIssueNumbers(prBody),
    };
  }

  if (prResult.error !== "contract_not_found") {
    return {
      ok: false,
      error: prResult.error,
      message: prResult.message,
      contractSource: "pr body",
      linkedIssues: extractLinkedIssueNumbers(prBody),
    };
  }

  const linkedIssues = extractLinkedIssueNumbers(prBody);
  const resolvedLinkedIssueCount = linkedIssueCount ?? linkedIssues.length;
  if (resolvedLinkedIssueCount > 1) {
    return {
      ok: false,
      error: "issue_link_ambiguous",
      message: `PR body references ${resolvedLinkedIssueCount} issues (${linkedIssues.map(n => `#${n}`).join(", ")}); expected exactly one`,
      contractSource: "none",
      linkedIssues,
    };
  }

  const issueResult = resolveContract(prBody, issueBody);
  if (issueResult.ok) {
    return {
      ok: true,
      contract: issueResult.contract,
      contractSource: "linked issue",
      linkedIssues,
    };
  }

  return {
    ok: false,
    error: issueResult.error,
    message: issueResult.message,
    contractSource: "none",
    linkedIssues,
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
    console.error("Required: GITHUB_EVENT_PATH, git with sufficient fetch depth, gh CLI with auth token.");
    process.exit(1);
  }

  const eventInfo = loadGitHubEvent();
  if (!eventInfo.ok) {
    console.error(`ERROR: ${eventInfo.message}`);
    process.exit(1);
  }

  const { base, head, prBody, prNumber, repoFullName } = eventInfo;
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
  const prResult = extractContract(prBody);
  if (!prResult.ok && prResult.error === "contract_not_found") {
    const linkedIssues = extractLinkedIssueNumbers(prBody);
    if (linkedIssues.length > 1) {
      // Handled by resolvePRContractFacts after preserving linked issue diagnostics.
    } else if (linkedIssues.length === 1) {
      console.log(`No contract in PR body; trying linked issue #${linkedIssues[0]}...`);
      issueBody = fetchIssueBody(repoFullName, linkedIssues[0]);
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

  const diffText = execSync(`git diff ${base}...${head}`, { encoding: "utf-8", cwd: roots.repoRoot });
  const summary = runPolicyPipeline({
    mode: "check-pr",
    repositoryRoot: roots.repoRoot,
    policy,
    contract,
    contractSource,
    enforcement,
    diffText,
    declaredChangeClass: contract?.change_class || null,
    initialChecks,
  });
  process.exit(summary.exitCode);
}
