import { resolve } from "node:path";
import {
  compileIntegrationPolicy,
} from "./policy-compiler.mjs";
import {
  ajvErrors,
  createCheckReporter,
  resolveEnforcementMode,
} from "./enforcement.mjs";
import {
  createAjv,
  loadJSON,
} from "./runtime/validation.mjs";
import { extractIntegration } from "./extractors/integration.mjs";

const FORMATS = new Set(["text", "json", "summary"]);

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function emptyIntegrationFacts() {
  return {
    workflows: [],
    templates: [],
    docs: [],
    profiles: [],
    errors: [],
  };
}

function parseArgs(args) {
  let format = "text";
  const rest = [];
  const known = new Set(["--format", "--integration"]);

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--integration") {
      continue;
    }
    if (arg === "--format") {
      const next = args[i + 1];
      if (!next || next.startsWith("-")) {
        return {
          ok: false,
          message: "Error: --format requires a value",
        };
      }
      format = next;
      i++;
      continue;
    }
    if (arg.startsWith("-") && !known.has(arg)) {
      return {
        ok: false,
        message: `Unknown option for validate-integration: ${arg}`,
      };
    }
    rest.push(arg);
  }

  if (rest.length > 0) {
    return {
      ok: false,
      message: `Unexpected argument for validate-integration: ${rest[0]}`,
    };
  }

  if (!FORMATS.has(format)) {
    return {
      ok: false,
      message: `Unknown validate-integration format: ${format}`,
    };
  }

  return { ok: true, format };
}

function usage() {
  return "Usage: repo-guard validate-integration [--format <text|json|summary>] [--enforcement <advisory|blocking>]";
}

function countDeclared(integration) {
  if (!isPlainObject(integration)) {
    return { workflows: 0, templates: 0, docs: 0, profiles: 0, total: 0 };
  }

  const counts = {
    workflows: Array.isArray(integration.workflows) ? integration.workflows.length : 0,
    templates: Array.isArray(integration.templates) ? integration.templates.length : 0,
    docs: Array.isArray(integration.docs) ? integration.docs.length : 0,
    profiles: Array.isArray(integration.profiles) ? integration.profiles.length : 0,
  };
  return {
    ...counts,
    total: counts.workflows + counts.templates + counts.docs + counts.profiles,
  };
}

function countExtracted(integration) {
  const counts = {
    workflows: integration.workflows.length,
    templates: integration.templates.length,
    docs: integration.docs.length,
    profiles: integration.profiles.length,
    errors: integration.errors.length,
  };
  return {
    ...counts,
    total: counts.workflows + counts.templates + counts.docs + counts.profiles,
  };
}

function formatIntegrationError(error) {
  const location = [
    error.section,
    error.id ? `:${error.id}` : "",
    error.path ? ` (${error.path})` : "",
  ].join("");
  return `${location || "integration"}: ${error.message}`;
}

function compileDetails(errors) {
  return errors.map((error) => error.message);
}

function workflowReferencesRepoGuard(workflow) {
  const usesRepoGuardAction = workflow.actionUses.some((fact) => {
    const uses = String(fact.uses || "").toLowerCase();
    return uses.includes("repo-guard") || uses === "./" || uses.startsWith("./");
  });
  const runsRepoGuardCommand = workflow.runCommands.some((fact) => {
    const run = String(fact.run || "").toLowerCase();
    return run.includes("repo-guard") || run.includes("src/repo-guard.mjs");
  });
  return usesRepoGuardAction || runsRepoGuardCommand;
}

function workflowRunsCheckPR(workflow) {
  const inputMode = workflow.stepInputs.some((fact) =>
    Object.values(fact.inputs || {}).some((value) => String(value).includes("check-pr"))
  );
  const runMode = workflow.runCommands.some((fact) => String(fact.run || "").includes("check-pr"));
  return inputMode || runMode;
}

function workflowHasFetchDepthZero(workflow) {
  return workflow.stepInputs.some((fact) => {
    const uses = String(fact.uses || "").toLowerCase();
    if (!uses.startsWith("actions/checkout")) return false;
    return fact.inputs?.["fetch-depth"] === "0";
  });
}

function workflowHasGitHubToken(workflow) {
  return workflow.envVars.some((fact) => fact.name === "GH_TOKEN" || fact.name === "GITHUB_TOKEN");
}

function workflowDiagnostics(integration) {
  const details = [];

  for (const workflow of integration.workflows) {
    if (!workflowReferencesRepoGuard(workflow)) {
      details.push(`${workflow.path}: workflow does not reference repo-guard via uses or run`);
    }

    if (workflow.role === "repo_guard_pr_gate") {
      const triggers = new Set(workflow.triggerEvents);
      if (!triggers.has("pull_request") && !triggers.has("pull_request_target")) {
        details.push(`${workflow.path}: repo_guard_pr_gate workflow must run on pull_request or pull_request_target`);
      }
      if (!workflowHasFetchDepthZero(workflow)) {
        details.push(`${workflow.path}: repo_guard_pr_gate workflow should checkout with fetch-depth: 0`);
      }
      if (workflowRunsCheckPR(workflow) && !workflowHasGitHubToken(workflow)) {
        details.push(`${workflow.path}: check-pr workflow should provide GH_TOKEN or GITHUB_TOKEN`);
      }
    }
  }

  return details;
}

function templateDiagnostics(integration) {
  const details = [];

  for (const template of integration.templates) {
    if (!template.requiresContractBlock) continue;
    if (template.hasRepoGuardYamlBlock || template.hasRepoGuardJsonBlock) continue;
    details.push(`${template.path}: ${template.id} requires a repo-guard contract block`);
  }

  return details;
}

function docDiagnostics(integration) {
  const details = [];

  for (const doc of integration.docs) {
    for (const mention of doc.mentions) {
      if (mention.present) continue;
      details.push(`${doc.path}: missing required mention "${mention.term}"`);
    }
  }

  return details;
}

function profileDiagnostics(integration) {
  const details = [];

  for (const profile of integration.profiles) {
    if (profile.profileNameReferences.length > 0) continue;
    details.push(`${profile.docPath}: profile "${profile.id}" is not mentioned`);
  }

  return details;
}

function renderMarkdownTableCell(value) {
  return String(value || "")
    .replaceAll("|", "\\|")
    .replaceAll("\n", "<br>");
}

function detailsForSummary(diagnostic) {
  const details = [];
  if (diagnostic.message) details.push(diagnostic.message);
  if (diagnostic.details) details.push(...diagnostic.details);
  if (diagnostic.errors) details.push(...diagnostic.errors);
  if (diagnostic.hint) details.push(`hint: ${diagnostic.hint}`);
  return details.length > 0 ? details.join("<br>") : "Diagnostic reported";
}

export function renderIntegrationSummary(report) {
  const declared = report.diagnostics.declared;
  const extracted = report.diagnostics.extracted;
  const lines = [
    "## repo-guard integration summary",
    "",
    `- Result: ${report.result}`,
    `- Mode: ${report.mode}`,
    `- Repository root: \`${report.repositoryRoot}\``,
    `- Declared: ${declared.workflows} workflow(s), ${declared.templates} template(s), ${declared.docs} doc(s), ${declared.profiles} profile(s)`,
    `- Extracted: ${extracted.workflows} workflow(s), ${extracted.templates} template(s), ${extracted.docs} doc(s), ${extracted.profiles} profile(s), ${extracted.errors} artifact error(s)`,
    `- Diagnostics: ${report.passed} passed, ${report.failed} failed${report.mode === "advisory" ? `, ${report.violationCount} advisory violation(s)` : ""}, ${report.warnings} warning(s)`,
  ];

  if (report.violations.length > 0) {
    lines.push("", "| Diagnostic | Details |", "|---|---|");
    for (const violation of report.violations) {
      lines.push(`| ${renderMarkdownTableCell(violation.rule)} | ${renderMarkdownTableCell(detailsForSummary(violation))} |`);
    }
  }

  if (report.advisoryWarnings.length > 0) {
    lines.push("", "| Advisory | Details |", "|---|---|");
    for (const warning of report.advisoryWarnings) {
      lines.push(`| ${renderMarkdownTableCell(warning.rule)} | ${renderMarkdownTableCell(detailsForSummary(warning))} |`);
    }
  }

  if (report.hints.length > 0) {
    lines.push("", "### Hints");
    for (const hint of report.hints) {
      lines.push(`- ${hint.rule}: ${hint.message}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function createReport(roots, { format }) {
  const policyPath = resolve(roots.repoRoot, "repo-policy.json");
  const schemaPath = resolve(roots.packageRoot, "schemas/repo-policy.schema.json");
  let policy = null;
  let policySchema = null;
  let policyLoadError = null;
  let schemaLoadError = null;

  try {
    policy = loadJSON(policyPath);
  } catch (e) {
    policyLoadError = e;
  }

  try {
    policySchema = loadJSON(schemaPath);
  } catch (e) {
    schemaLoadError = e;
  }

  const enforcement = resolveEnforcementMode({ cliValue: roots.enforcementMode, policy });
  if (!enforcement.ok) {
    return {
      fatal: true,
      message: `ERROR: ${enforcement.message}`,
    };
  }

  const quiet = format !== "text";
  if (!quiet) {
    console.log("repo-guard validate-integration\n");
  }

  const reporter = createCheckReporter(enforcement.mode, { quiet });
  const diagnostics = {
    declared: countDeclared(policy?.integration),
    extracted: countExtracted(emptyIntegrationFacts()),
    artifactErrors: [],
  };
  let integration = emptyIntegrationFacts();

  if (policyLoadError) {
    reporter.report("repo-policy.json", {
      ok: false,
      message: `Cannot read ${policyPath}: ${policyLoadError.message}`,
      hint: "Create a valid repo-policy.json before validating integration wiring",
    });
    return reporter.finish({
      command: "validate-integration",
      repositoryRoot: roots.repoRoot,
      integration,
      diagnostics,
    });
  }

  if (schemaLoadError) {
    reporter.report("repo-policy-schema", {
      ok: false,
      message: `Cannot read ${schemaPath}: ${schemaLoadError.message}`,
      hint: "Reinstall repo-guard; package schema files are missing",
    });
  } else {
    const ajv = createAjv();
    const valid = ajv.validate(policySchema, policy);
    reporter.report("repo-policy.json", valid
      ? { ok: true, message: "repo-policy.json is valid JSON policy" }
      : {
          ok: false,
          message: "repo-policy.json failed schema validation",
          errors: ajvErrors(ajv.errors),
          hint: "Fix policy schema errors before relying on integration diagnostics",
        });
  }

  const declared = countDeclared(policy.integration);
  diagnostics.declared = declared;
  const compileErrors = compileIntegrationPolicy(policy);
  const hasIntegration = isPlainObject(policy.integration);
  if (!hasIntegration) {
    reporter.report("integration-policy", {
      ok: false,
      message: "repo-policy.json has no integration section",
      hint: "Declare integration.workflows, integration.templates, integration.docs, or integration.profiles",
    });
  } else if (declared.total === 0) {
    reporter.report("integration-policy", {
      ok: false,
      message: "integration section declares no artifacts",
      hint: "Declare at least one integration workflow, template, doc, or profile",
    });
  } else if (compileErrors.length > 0) {
    reporter.report("integration-policy", {
      ok: false,
      message: "Integration policy failed compilation",
      details: compileDetails(compileErrors),
      hint: "Fix integration ids, roles, kinds, required fields, and profile references",
    });
  } else {
    reporter.report("integration-policy", {
      ok: true,
      message: "Integration policy compiles",
    });
  }

  if (hasIntegration && compileErrors.length === 0) {
    integration = extractIntegration(policy, { repoRoot: roots.repoRoot });
    diagnostics.extracted = countExtracted(integration);
    diagnostics.artifactErrors = integration.errors.map(formatIntegrationError);

    reporter.report("integration-artifacts", integration.errors.length === 0
      ? { ok: true, message: "All declared integration artifacts were read and parsed" }
      : {
          ok: false,
          message: "Integration artifact extraction failed",
          details: diagnostics.artifactErrors,
          hint: "Fix missing files, malformed workflow YAML, malformed contract blocks, or Markdown fences",
        });

    const workflowDetails = workflowDiagnostics(integration);
    reporter.report("integration-workflows", workflowDetails.length === 0
      ? { ok: true, message: "Workflow integration wiring is valid" }
      : {
          ok: false,
          message: "Workflow integration wiring has issues",
          details: workflowDetails,
          hint: "Compare declared repo-guard workflows with templates/example-workflow.yml",
        });

    const templateDetails = templateDiagnostics(integration);
    reporter.report("integration-templates", templateDetails.length === 0
      ? { ok: true, message: "Template integration wiring is valid" }
      : {
          ok: false,
          message: "Template integration wiring has issues",
          details: templateDetails,
          hint: "Add repo-guard-yaml or repo-guard-json fenced contract blocks to required templates",
        });

    const docDetails = docDiagnostics(integration);
    reporter.report("integration-docs", docDetails.length === 0
      ? { ok: true, message: "Documentation integration wiring is valid" }
      : {
          ok: false,
          message: "Documentation integration wiring has issues",
          details: docDetails,
          hint: "Update declared docs so every must_mention term appears",
        });

    const profileDetails = profileDiagnostics(integration);
    reporter.report("integration-profiles", profileDetails.length === 0
      ? { ok: true, message: "Profile documentation wiring is valid" }
      : {
          ok: false,
          message: "Profile documentation wiring has issues",
          details: profileDetails,
          hint: "Mention each integration profile id in its declared profile document",
        });
  }

  return reporter.finish({
    command: "validate-integration",
    repositoryRoot: roots.repoRoot,
    integration,
    diagnostics,
  });
}

export function runValidateIntegration(roots, args = []) {
  const parsed = parseArgs(args);
  if (!parsed.ok) {
    console.error(parsed.message);
    console.error(usage());
    process.exit(1);
  }

  const report = createReport(roots, { format: parsed.format });
  if (report.fatal) {
    console.error(report.message);
    process.exit(1);
  }

  if (parsed.format === "json") {
    console.log(JSON.stringify(report, null, 2));
  } else if (parsed.format === "summary") {
    console.log(renderIntegrationSummary(report));
  }

  process.exit(report.exitCode);
}
