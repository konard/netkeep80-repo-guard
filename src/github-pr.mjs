import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve } from "node:path";
import Ajv from "ajv";
import { extractContract, extractLinkedIssueNumbers, resolveContract } from "./markdown-contract.mjs";
import {
  compileForbidRegex,
  warnReservedContractFields,
  warnReservedPolicyFields,
} from "./policy-compiler.mjs";
import {
  parseDiff,
  filterOperationalPaths,
  checkForbiddenPaths,
  checkCanonicalDocsBudget,
  checkNewFilesBudget,
  checkNetAddedLinesBudget,
  checkCochangeRules,
  checkContentRules,
  checkMustTouch,
  checkMustNotTouch,
} from "./diff-checker.mjs";

function loadJSON(path) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function validate(ajv, schema, data, label) {
  const valid = ajv.validate(schema, data);
  if (!valid) {
    console.error(`FAIL: ${label}`);
    for (const err of ajv.errors) {
      console.error(`  ${err.instancePath || "/"} ${err.message}`);
    }
    return false;
  }
  console.log(`OK: ${label}`);
  return true;
}

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

export function runCheckPR(roots) {
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

  let issueBody = null;
  const prResult = extractContract(prBody);
  if (!prResult.ok && prResult.error === "contract_not_found") {
    const linkedIssues = extractLinkedIssueNumbers(prBody);
    if (linkedIssues.length > 1) {
      console.error(`ERROR [issue_link_ambiguous]: PR body references ${linkedIssues.length} issues (${linkedIssues.map(n => `#${n}`).join(", ")}); expected exactly one`);
      process.exit(1);
    }
    if (linkedIssues.length === 1) {
      console.log(`No contract in PR body; trying linked issue #${linkedIssues[0]}...`);
      issueBody = fetchIssueBody(repoFullName, linkedIssues[0]);
      if (!issueBody) {
        console.error(`ERROR: Could not fetch issue #${linkedIssues[0]} body`);
      }
    }
  }

  const contractResult = resolveContract(prBody, issueBody);
  if (!contractResult.ok) {
    console.error(`ERROR [${contractResult.error}]: ${contractResult.message}`);
    process.exit(1);
  }

  const contract = contractResult.contract;
  console.log("OK: change-contract extracted");

  const policySchema = loadJSON(resolve(roots.packageRoot, "schemas/repo-policy.schema.json"));
  const contractSchema = loadJSON(resolve(roots.packageRoot, "schemas/change-contract.schema.json"));
  const policy = loadJSON(resolve(roots.repoRoot, "repo-policy.json"));

  const ajv = new Ajv({ allErrors: true });

  let ok = true;
  ok = validate(ajv, policySchema, policy, "repo-policy.json") && ok;
  ok = validate(ajv, contractSchema, contract, "change-contract (from markdown)") && ok;

  const regexErrors = compileForbidRegex(policy.content_rules);
  if (regexErrors.length > 0) {
    ok = false;
    console.error("FAIL: forbid_regex compilation");
    for (const e of regexErrors) {
      console.error(`  [${e.rule_id}] invalid regex /${e.pattern}/: ${e.message}`);
    }
  }

  for (const w of warnReservedPolicyFields(policy)) {
    console.warn(`WARN: ${w}`);
  }
  for (const w of warnReservedContractFields(contract)) {
    console.warn(`WARN: ${w}`);
  }

  if (!ok) {
    console.error("\nPolicy compilation failed");
    process.exit(1);
  }

  const diffText = execSync(`git diff ${base}...${head}`, { encoding: "utf-8", cwd: roots.repoRoot });
  const allFiles = parseDiff(diffText);
  const files = filterOperationalPaths(allFiles, policy.paths.operational_paths);

  const skipped = allFiles.length - files.length;
  console.log(`\nDiff analysis: ${allFiles.length} file(s) changed${skipped ? ` (${skipped} operational skipped)` : ""}`);

  let passed = 0;
  let failed = 0;

  function report(name, check) {
    if (check.ok) {
      passed++;
      console.log(`  PASS: ${name}`);
    } else {
      failed++;
      ok = false;
      console.error(`  FAIL: ${name}`);
      if (check.actual !== undefined) {
        console.error(`    actual: ${check.actual}, limit: ${check.limit}`);
      }
      if (check.files) {
        for (const f of check.files) console.error(`    - ${f}`);
      }
      if (check.touched) {
        for (const f of check.touched) console.error(`    - ${f}`);
      }
      if (check.must_touch) {
        console.error(`    must_touch: ${check.must_touch.join(", ")}`);
      }
      if (check.hint) {
        console.error(`    hint: ${check.hint}`);
      }
    }
  }

  const forbiddenViolations = checkForbiddenPaths(files, policy.paths.forbidden);
  report("forbidden-paths", {
    ok: forbiddenViolations.length === 0,
    files: forbiddenViolations,
  });

  const budgets = contract.budgets || {};
  const maxNewDocs = budgets.max_new_docs ?? policy.diff_rules.max_new_docs;
  const maxNewFiles = budgets.max_new_files ?? policy.diff_rules.max_new_files;
  const maxNetAddedLines = budgets.max_net_added_lines ?? policy.diff_rules.max_net_added_lines;

  report("canonical-docs-budget", checkCanonicalDocsBudget(files, policy.paths.canonical_docs, maxNewDocs));
  report("max-new-files", checkNewFilesBudget(files, maxNewFiles));
  report("max-net-added-lines", checkNetAddedLinesBudget(files, maxNetAddedLines));

  const cochangeViolations = checkCochangeRules(files, policy.cochange_rules);
  if (cochangeViolations.length > 0) {
    for (const v of cochangeViolations) {
      report(`cochange: ${v.if_changed.join(",")} -> ${v.must_change_any.join(",")}`, {
        ok: false,
        must_touch: v.must_change_any,
      });
    }
  } else {
    report("cochange-rules", { ok: true });
  }

  const contentViolations = checkContentRules(files, policy.content_rules);
  if (contentViolations.length > 0) {
    ok = false;
    failed++;
    console.error("  FAIL: content-rules");
    for (const v of contentViolations) {
      console.error(`    [${v.rule_id}] ${v.file}: "${v.line}" matched /${v.matched_regex}/`);
    }
  } else {
    passed++;
    console.log("  PASS: content-rules");
  }

  report("must-touch", checkMustTouch(files, contract.must_touch));
  report("must-not-touch", checkMustNotTouch(files, contract.must_not_touch));

  console.log(`\nSummary: ${passed} passed, ${failed} failed`);
  process.exit(ok ? 0 : 1);
}
