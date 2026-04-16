#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
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
import {
  compileForbidRegex,
  warnReservedContractFields,
  warnReservedPolicyFields,
} from "./policy-compiler.mjs";
import {
  ajvErrors,
  createCheckReporter,
  printEnforcementMode,
  resolveEnforcementMode,
} from "./enforcement.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(__dirname, "..");

export function resolveRoots(args) {
  let repoRoot = process.cwd();
  let enforcementMode = null;
  const filtered = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--repo-root") {
      const next = args[i + 1];
      if (!next || next.startsWith("-")) {
        console.error("Error: --repo-root requires a path argument");
        console.error("Usage: repo-guard [--repo-root <path>] [--enforcement <advisory|blocking>] [check-diff|check-pr|init|doctor] [options]");
        process.exit(1);
      }
      repoRoot = resolve(args[++i]);
    } else if (args[i] === "--enforcement" || args[i] === "--enforcement-mode") {
      const next = args[i + 1];
      if (!next || next.startsWith("-")) {
        console.error(`Error: ${args[i]} requires a mode argument`);
        console.error("Usage: repo-guard [--repo-root <path>] [--enforcement <advisory|blocking>] [check-diff|check-pr|init|doctor] [options]");
        process.exit(1);
      }
      enforcementMode = args[++i];
    } else {
      filtered.push(args[i]);
    }
  }
  return { packageRoot, repoRoot, enforcementMode, args: filtered };
}

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

function validationCheck(ajv, schema, data, label) {
  const valid = ajv.validate(schema, data);
  if (valid) {
    return { ok: true };
  }
  return {
    ok: false,
    message: `${label} failed schema validation`,
    errors: ajvErrors(ajv.errors),
  };
}

function getDiff(base, head, cwd) {
  if (base && head) {
    return execSync(`git diff ${base}...${head}`, { encoding: "utf-8", cwd });
  }
  const staged = execSync("git diff --cached", { encoding: "utf-8", cwd });
  if (staged.trim()) return staged;
  return execSync("git diff HEAD", { encoding: "utf-8", cwd });
}

function runCheckDiff(roots, args) {
  const policySchemaPath = resolve(roots.packageRoot, "schemas/repo-policy.schema.json");
  const contractSchemaPath = resolve(roots.packageRoot, "schemas/change-contract.schema.json");
  const policyPath = resolve(roots.repoRoot, "repo-policy.json");

  const policySchema = loadJSON(policySchemaPath);
  const contractSchema = loadJSON(contractSchemaPath);
  const policy = loadJSON(policyPath);

  const ajv = new Ajv({ allErrors: true });

  let ok = true;
  ok = validate(ajv, policySchema, policy, "repo-policy.json") && ok;

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

  let base = null;
  let head = null;
  let contractPath = null;
  const KNOWN_DIFF_OPTS = new Set(["--base", "--head", "--contract"]);

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--base" && args[i + 1]) base = args[++i];
    else if (args[i] === "--head" && args[i + 1]) head = args[++i];
    else if (args[i] === "--contract" && args[i + 1]) {
      contractPath = resolve(roots.repoRoot, args[++i]);
    } else if (args[i].startsWith("-") && !KNOWN_DIFF_OPTS.has(args[i])) {
      console.error(`Unknown option for check-diff: ${args[i]}`);
      console.error("Usage: repo-guard check-diff [--base <ref>] [--head <ref>] [--contract <path>] [--enforcement <advisory|blocking>]");
      process.exit(1);
    }
  }

  if (!ok) {
    console.error("\nPolicy compilation failed; aborting enforcement.");
    process.exit(1);
  }

  const enforcement = resolveEnforcementMode({ cliValue: roots.enforcementMode, policy });
  if (!enforcement.ok) {
    console.error(`ERROR: ${enforcement.message}`);
    process.exit(1);
  }
  printEnforcementMode(enforcement);
  const reporter = createCheckReporter(enforcement.mode);

  let contract = null;
  if (contractPath) {
    try {
      const loadedContract = loadJSON(contractPath);
      const contractCheck = validationCheck(ajv, contractSchema, loadedContract, contractPath);
      reporter.report("change-contract", contractCheck);
      if (contractCheck.ok) {
        contract = loadedContract;
        for (const w of warnReservedContractFields(contract)) {
          console.warn(`WARN: ${w}`);
        }
      }
    } catch (e) {
      reporter.report("change-contract", {
        ok: false,
        message: `Cannot read ${contractPath}: ${e.message}`,
      });
    }
  }

  const diffText = getDiff(base, head, roots.repoRoot);
  const allFiles = parseDiff(diffText);
  const files = filterOperationalPaths(allFiles, policy.paths.operational_paths);

  const skipped = allFiles.length - files.length;
  console.log(`\nDiff analysis: ${allFiles.length} file(s) changed${skipped ? ` (${skipped} operational skipped)` : ""}`);

  const forbiddenViolations = checkForbiddenPaths(files, policy.paths.forbidden);
  reporter.report("forbidden-paths", {
    ok: forbiddenViolations.length === 0,
    files: forbiddenViolations,
  });

  const budgets = contract?.budgets || {};
  const maxNewDocs = budgets.max_new_docs ?? policy.diff_rules.max_new_docs;
  const maxNewFiles = budgets.max_new_files ?? policy.diff_rules.max_new_files;
  const maxNetAddedLines = budgets.max_net_added_lines ?? policy.diff_rules.max_net_added_lines;

  reporter.report("canonical-docs-budget", checkCanonicalDocsBudget(files, policy.paths.canonical_docs, maxNewDocs));
  reporter.report("max-new-files", checkNewFilesBudget(files, maxNewFiles));
  reporter.report("max-net-added-lines", checkNetAddedLinesBudget(files, maxNetAddedLines));

  const cochangeViolations = checkCochangeRules(files, policy.cochange_rules);
  if (cochangeViolations.length > 0) {
    for (const v of cochangeViolations) {
      reporter.report(`cochange: ${v.if_changed.join(",")} -> ${v.must_change_any.join(",")}`, {
        ok: false,
        must_touch: v.must_change_any,
      });
    }
  } else {
    reporter.report("cochange-rules", { ok: true });
  }

  const contentViolations = checkContentRules(files, policy.content_rules);
  if (contentViolations.length > 0) {
    reporter.report("content-rules", {
      ok: false,
      details: contentViolations.map((v) => `[${v.rule_id}] ${v.file}: "${v.line}" matched /${v.matched_regex}/`),
    });
  } else {
    reporter.report("content-rules", { ok: true });
  }

  if (contract) {
    reporter.report("must-touch", checkMustTouch(files, contract.must_touch));
    reporter.report("must-not-touch", checkMustNotTouch(files, contract.must_not_touch));
  }

  const summary = reporter.finish();
  process.exit(summary.exitCode);
}

function runValidate(roots, args) {
  const policySchemaPath = resolve(roots.packageRoot, "schemas/repo-policy.schema.json");
  const contractSchemaPath = resolve(roots.packageRoot, "schemas/change-contract.schema.json");
  const policyPath = resolve(roots.repoRoot, "repo-policy.json");

  const policySchema = loadJSON(policySchemaPath);
  const contractSchema = loadJSON(contractSchemaPath);
  const policy = loadJSON(policyPath);

  const ajv = new Ajv({ allErrors: true });

  let ok = true;
  ok = validate(ajv, policySchema, policy, "repo-policy.json") && ok;

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

  const contractArg = args[0];
  if (contractArg) {
    const contract = loadJSON(resolve(roots.repoRoot, contractArg));
    ok = validate(ajv, contractSchema, contract, contractArg) && ok;
    for (const w of warnReservedContractFields(contract)) {
      console.warn(`WARN: ${w}`);
    }
  }

  process.exit(ok ? 0 : 1);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(__dirname, "repo-guard.mjs");

if (isMain) {
  const MODES = new Set(["check-diff", "check-pr", "init", "doctor"]);
  const roots = resolveRoots(process.argv.slice(2));
  const command = roots.args[0];

  if (command && !MODES.has(command) && command.startsWith("-")) {
    console.error(`Unknown option: ${command}`);
    console.error("Usage: repo-guard [--repo-root <path>] [--enforcement <advisory|blocking>] [check-diff|check-pr|init|doctor] [options]");
    process.exit(1);
  }

  if (command === "check-diff") {
    roots.args = roots.args.slice(1);
    runCheckDiff(roots, roots.args);
  } else if (command === "check-pr") {
    roots.args = roots.args.slice(1);
    const { runCheckPR } = await import("./github-pr.mjs");
    runCheckPR(roots, roots.args);
  } else if (command === "init") {
    roots.args = roots.args.slice(1);
    const { runInit } = await import("./init.mjs");
    runInit(roots, roots.args);
  } else if (command === "doctor") {
    const { runDoctor } = await import("./doctor.mjs");
    const report = runDoctor(roots);
    process.exit(report.fails > 0 ? 1 : 0);
  } else {
    runValidate(roots, roots.args);
  }
}
