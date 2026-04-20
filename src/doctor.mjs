import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import Ajv from "ajv";
import { compileAnchorPolicy, compileForbidRegex, compileIntegrationPolicy } from "./policy-compiler.mjs";
import { resolvePolicyProfile } from "./policy-profiles.mjs";

const PASS = "PASS";
const WARN = "WARN";
const FAIL = "FAIL";

function check(name, fn) {
  try {
    return fn();
  } catch (e) {
    return { name, status: FAIL, message: e.message, hint: "Unexpected error during check" };
  }
}

function checkRepoRoot(repoRoot) {
  return check("repository-root", () => {
    if (!existsSync(repoRoot)) {
      return { name: "repository-root", status: FAIL, message: `Path does not exist: ${repoRoot}`, hint: "Pass a valid path via --repo-root or run from inside a repository" };
    }
    const stat = statSync(repoRoot);
    if (!stat.isDirectory()) {
      return { name: "repository-root", status: FAIL, message: `Not a directory: ${repoRoot}`, hint: "Pass a directory path via --repo-root" };
    }
    return { name: "repository-root", status: PASS, message: repoRoot };
  });
}

function checkGit(repoRoot) {
  return check("git-available", () => {
    try {
      const version = execFileSync("git", ["--version"], { encoding: "utf-8", stdio: "pipe" }).trim();
      const isRepo = existsSync(resolve(repoRoot, ".git"));
      if (!isRepo) {
        return { name: "git-available", status: WARN, message: `${version} (not a git repository at ${repoRoot})`, hint: "Run 'git init' or check --repo-root points to a git repository" };
      }
      return { name: "git-available", status: PASS, message: version };
    } catch {
      return { name: "git-available", status: FAIL, message: "git CLI not found", hint: "Install git: https://git-scm.com/downloads" };
    }
  });
}

function checkFetchDepth(repoRoot) {
  return check("fetch-depth", () => {
    try {
      const isShallow = execFileSync("git", ["rev-parse", "--is-shallow-repository"], { encoding: "utf-8", cwd: repoRoot, stdio: "pipe" }).trim();
      if (isShallow === "true") {
        let count;
        try {
          count = execFileSync("git", ["rev-list", "--count", "HEAD"], { encoding: "utf-8", cwd: repoRoot, stdio: "pipe" }).trim();
        } catch {
          count = "unknown";
        }
        return { name: "fetch-depth", status: WARN, message: `Shallow clone detected (${count} commit(s) available)`, hint: "Use 'fetch-depth: 0' in actions/checkout to enable full diff analysis" };
      }
      return { name: "fetch-depth", status: PASS, message: "Full history available" };
    } catch {
      return { name: "fetch-depth", status: WARN, message: "Unable to determine fetch depth (not a git repository?)", hint: "Ensure this is a git repository with at least one commit" };
    }
  });
}

function checkPolicyDiscovery(repoRoot, packageRoot) {
  return check("repo-policy.json", () => {
    const policyPath = resolve(repoRoot, "repo-policy.json");
    if (!existsSync(policyPath)) {
      return { name: "repo-policy.json", status: FAIL, message: `Not found at ${policyPath}`, hint: "Create repo-policy.json or run 'repo-guard init' to scaffold one" };
    }

    let policy;
    try {
      policy = JSON.parse(readFileSync(policyPath, "utf-8"));
    } catch (e) {
      return { name: "repo-policy.json", status: FAIL, message: `Parse error: ${e.message}`, hint: "Fix JSON syntax in repo-policy.json" };
    }

    const schemaPath = resolve(packageRoot, "schemas/repo-policy.schema.json");
    if (!existsSync(schemaPath)) {
      return { name: "repo-policy.json", status: FAIL, message: "Policy schema not found at package root", hint: "Reinstall repo-guard — schema files are missing" };
    }

    const schema = JSON.parse(readFileSync(schemaPath, "utf-8"));
    const ajv = new Ajv({ allErrors: true });
    const valid = ajv.validate(schema, policy);
    if (!valid) {
      const errors = ajv.errors.map(e => `${e.instancePath || "/"} ${e.message}`).join("; ");
      const integrationErrors = compileIntegrationPolicy(policy);
      const integrationDetails = integrationErrors.length > 0
        ? `; Invalid integration policy: ${integrationErrors.map(e => e.message).join("; ")}`
        : "";
      return { name: "repo-policy.json", status: FAIL, message: `Schema validation failed: ${errors}${integrationDetails}`, hint: "Fix the policy to match the schema — see schemas/repo-policy.schema.json" };
    }

    const profileResult = resolvePolicyProfile(policy);
    if (!profileResult.ok) {
      const details = profileResult.errors.map(e => e.message).join("; ");
      return { name: "repo-policy.json", status: FAIL, message: `Invalid profile policy: ${details}`, hint: "Fix profile and profile_overrides in repo-policy.json" };
    }

    const effectivePolicy = profileResult.policy;

    const regexErrors = compileForbidRegex(effectivePolicy.content_rules || []);
    if (regexErrors.length > 0) {
      const details = regexErrors.map(e => `[${e.rule_id}] /${e.pattern}/: ${e.message}`).join("; ");
      return { name: "repo-policy.json", status: FAIL, message: `Invalid forbid_regex: ${details}`, hint: "Fix the regular expressions in content_rules" };
    }

    const anchorErrors = compileAnchorPolicy(effectivePolicy);
    if (anchorErrors.length > 0) {
      const details = anchorErrors.map(e => e.message).join("; ");
      return { name: "repo-policy.json", status: FAIL, message: `Invalid anchor policy: ${details}`, hint: "Fix anchors and trace_rules references in repo-policy.json" };
    }

    const integrationErrors = compileIntegrationPolicy(effectivePolicy);
    if (integrationErrors.length > 0) {
      const details = integrationErrors.map(e => e.message).join("; ");
      return { name: "repo-policy.json", status: FAIL, message: `Invalid integration policy: ${details}`, hint: "Fix integration ids, kinds, roles, required fields, and profile references in repo-policy.json" };
    }

    const profileSuffix = effectivePolicy.profile ? `, profile ${effectivePolicy.profile}` : "";
    return { name: "repo-policy.json", status: PASS, message: `Valid (${effectivePolicy.repository_kind}, format ${effectivePolicy.policy_format_version}${profileSuffix})` };
  });
}

function checkEventContext() {
  return check("event-context", () => {
    const eventPath = process.env.GITHUB_EVENT_PATH;
    if (!eventPath) {
      return { name: "event-context", status: WARN, message: "GITHUB_EVENT_PATH not set (not in GitHub Actions)", hint: "This is expected when running locally; check-pr requires GitHub Actions context" };
    }

    if (!existsSync(eventPath)) {
      return { name: "event-context", status: FAIL, message: `GITHUB_EVENT_PATH set but file not found: ${eventPath}`, hint: "The event file should be created by GitHub Actions — check runner configuration" };
    }

    let event;
    try {
      event = JSON.parse(readFileSync(eventPath, "utf-8"));
    } catch (e) {
      return { name: "event-context", status: FAIL, message: `Event file parse error: ${e.message}`, hint: "The event file is corrupt — check runner configuration" };
    }

    if (!event.pull_request) {
      return { name: "event-context", status: WARN, message: "Event file present but not a pull_request event", hint: "check-pr requires a pull_request trigger; other triggers are fine for check-diff" };
    }

    const pr = event.pull_request;
    const hasSHAs = pr.base?.sha && pr.head?.sha;
    if (!hasSHAs) {
      return { name: "event-context", status: FAIL, message: "pull_request event missing base/head SHA", hint: "Ensure the workflow trigger includes the pull_request event with SHA context" };
    }

    return { name: "event-context", status: PASS, message: `PR #${pr.number} (${pr.base.sha.slice(0, 7)}..${pr.head.sha.slice(0, 7)})` };
  });
}

function checkAuth() {
  return check("auth-token", () => {
    const ghToken = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
    if (!ghToken) {
      try {
        execFileSync("gh", ["auth", "status"], { encoding: "utf-8", stdio: "pipe" });
        return { name: "auth-token", status: PASS, message: "gh CLI authenticated (no explicit token)" };
      } catch {
        return { name: "auth-token", status: WARN, message: "No GH_TOKEN/GITHUB_TOKEN and gh CLI not authenticated", hint: "Set GH_TOKEN or GITHUB_TOKEN, or run 'gh auth login'. Auth is only required when check-pr falls back to linked-issue body for the change contract" };
      }
    }
    return { name: "auth-token", status: PASS, message: "Token present via environment" };
  });
}

function checkGhCli() {
  return check("gh-cli", () => {
    try {
      const version = execFileSync("gh", ["--version"], { encoding: "utf-8", stdio: "pipe" }).trim().split("\n")[0];
      return { name: "gh-cli", status: PASS, message: version };
    } catch {
      return { name: "gh-cli", status: FAIL, message: "gh CLI not found", hint: "Install gh CLI — check-pr requires it for linked-issue fallback: https://cli.github.com/" };
    }
  });
}

function checkWorkflowConfig(repoRoot) {
  return check("workflow-config", () => {
    const workflowDir = resolve(repoRoot, ".github/workflows");
    if (!existsSync(workflowDir)) {
      return { name: "workflow-config", status: WARN, message: "No .github/workflows/ directory found", hint: "Run 'repo-guard init' to generate a workflow, or create one manually" };
    }

    const files = readdirSync(workflowDir).filter(f => f.endsWith(".yml") || f.endsWith(".yaml"));
    if (files.length === 0) {
      return { name: "workflow-config", status: WARN, message: "No YAML workflow files in .github/workflows/", hint: "Run 'repo-guard init' to generate a workflow" };
    }

    let repoGuardFound = false;
    let fetchDepthOk = false;
    let ghTokenOk = false;

    for (const file of files) {
      const content = readFileSync(resolve(workflowDir, file), "utf-8");
      if (content.includes("repo-guard") || content.includes("check-pr")) {
        repoGuardFound = true;
        if (/fetch-depth\s*:\s*0/.test(content)) fetchDepthOk = true;
        if (/GH_TOKEN|GITHUB_TOKEN/.test(content)) ghTokenOk = true;
      }
    }

    if (!repoGuardFound) {
      return { name: "workflow-config", status: WARN, message: "No workflow references repo-guard or check-pr", hint: "Add a repo-guard workflow — run 'repo-guard init' or see templates/example-workflow.yml" };
    }

    const issues = [];
    if (!fetchDepthOk) issues.push("missing 'fetch-depth: 0' (required for full diff)");
    if (!ghTokenOk) issues.push("missing GH_TOKEN/GITHUB_TOKEN env (required for issue fallback)");

    if (issues.length > 0) {
      return { name: "workflow-config", status: WARN, message: `Workflow found but: ${issues.join("; ")}`, hint: "Compare your workflow with templates/example-workflow.yml" };
    }

    return { name: "workflow-config", status: PASS, message: "Workflow configured with fetch-depth: 0 and token" };
  });
}

export function runDoctor(roots) {
  console.log("repo-guard doctor\n");

  const results = [];

  results.push(checkRepoRoot(roots.repoRoot));
  results.push(checkGit(roots.repoRoot));
  results.push(checkFetchDepth(roots.repoRoot));
  results.push(checkPolicyDiscovery(roots.repoRoot, roots.packageRoot));
  results.push(checkEventContext());
  results.push(checkAuth());
  results.push(checkGhCli());
  results.push(checkWorkflowConfig(roots.repoRoot));

  let passes = 0;
  let warns = 0;
  let fails = 0;

  for (const r of results) {
    const icon = r.status === PASS ? PASS : r.status === WARN ? WARN : FAIL;
    console.log(`  ${icon}: ${r.name}`);
    console.log(`    ${r.message}`);
    if (r.hint) {
      console.log(`    hint: ${r.hint}`);
    }

    if (r.status === PASS) passes++;
    else if (r.status === WARN) warns++;
    else fails++;
  }

  console.log(`\nSummary: ${passes} passed, ${warns} warnings, ${fails} failed`);

  return { results, passes, warns, fails };
}
