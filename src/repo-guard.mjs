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

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(__dirname, "..");

export function resolveRoots(args) {
  let repoRoot = process.cwd();
  const filtered = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--repo-root" && args[i + 1]) {
      repoRoot = resolve(args[++i]);
    } else {
      filtered.push(args[i]);
    }
  }
  return { packageRoot, repoRoot, args: filtered };
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

  let contract = null;
  let base = null;
  let head = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--base" && args[i + 1]) base = args[++i];
    else if (args[i] === "--head" && args[i + 1]) head = args[++i];
    else if (args[i] === "--contract" && args[i + 1]) {
      const contractPath = resolve(roots.repoRoot, args[++i]);
      contract = loadJSON(contractPath);
      ok = validate(ajv, contractSchema, contract, contractPath) && ok;
      for (const w of warnReservedContractFields(contract)) {
        console.warn(`WARN: ${w}`);
      }
    }
  }

  if (!ok) {
    console.error("\nPolicy compilation failed; aborting enforcement.");
    process.exit(1);
  }

  const diffText = getDiff(base, head, roots.repoRoot);
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

  const budgets = contract?.budgets || {};
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
    console.error(`  FAIL: content-rules`);
    for (const v of contentViolations) {
      console.error(`    [${v.rule_id}] ${v.file}: "${v.line}" matched /${v.matched_regex}/`);
    }
  } else {
    passed++;
    console.log(`  PASS: content-rules`);
  }

  if (contract) {
    report("must-touch", checkMustTouch(files, contract.must_touch));
    report("must-not-touch", checkMustNotTouch(files, contract.must_not_touch));
  }

  console.log(`\nSummary: ${passed} passed, ${failed} failed`);
  process.exit(ok ? 0 : 1);
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
  const command = process.argv[2];

  if (command === "check-diff") {
    const roots = resolveRoots(process.argv.slice(3));
    runCheckDiff(roots, roots.args);
  } else if (command === "check-pr") {
    const roots = resolveRoots(process.argv.slice(3));
    const { runCheckPR } = await import("./github-pr.mjs");
    runCheckPR(roots);
  } else {
    const roots = resolveRoots(process.argv.slice(2));
    runValidate(roots, roots.args);
  }
}
