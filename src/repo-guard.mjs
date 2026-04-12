#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import {
  parseDiff,
  checkForbiddenPaths,
  checkCanonicalDocsBudget,
  checkNewFilesBudget,
  checkNetAddedLinesBudget,
  checkCochangeRules,
  checkContentRules,
  checkMustTouch,
  checkMustNotTouch,
} from "./diff-checker.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

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

function getDiff(base, head) {
  if (base && head) {
    return execSync(`git diff ${base}...${head}`, { encoding: "utf-8", cwd: root });
  }
  const staged = execSync("git diff --cached", { encoding: "utf-8", cwd: root });
  if (staged.trim()) return staged;
  return execSync("git diff HEAD", { encoding: "utf-8", cwd: root });
}

function runCheckDiff(args) {
  const policySchemaPath = resolve(root, "schemas/repo-policy.schema.json");
  const contractSchemaPath = resolve(root, "schemas/change-contract.schema.json");
  const policyPath = resolve(root, "repo-policy.json");

  const policySchema = loadJSON(policySchemaPath);
  const contractSchema = loadJSON(contractSchemaPath);
  const policy = loadJSON(policyPath);

  const ajv = new Ajv({ allErrors: true });

  let ok = true;
  ok = validate(ajv, policySchema, policy, "repo-policy.json") && ok;

  let contract = null;
  let base = null;
  let head = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--base" && args[i + 1]) base = args[++i];
    else if (args[i] === "--head" && args[i + 1]) head = args[++i];
    else if (args[i] === "--contract" && args[i + 1]) {
      const contractPath = resolve(args[++i]);
      contract = loadJSON(contractPath);
      ok = validate(ajv, contractSchema, contract, contractPath) && ok;
    }
  }

  const diffText = getDiff(base, head);
  const files = parseDiff(diffText);

  console.log(`\nDiff analysis: ${files.length} file(s) changed`);

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

function runValidate(args) {
  const policySchemaPath = resolve(root, "schemas/repo-policy.schema.json");
  const contractSchemaPath = resolve(root, "schemas/change-contract.schema.json");
  const policyPath = resolve(root, "repo-policy.json");

  const policySchema = loadJSON(policySchemaPath);
  const contractSchema = loadJSON(contractSchemaPath);
  const policy = loadJSON(policyPath);

  const ajv = new Ajv({ allErrors: true });

  let ok = true;
  ok = validate(ajv, policySchema, policy, "repo-policy.json") && ok;

  const contractArg = args[0];
  if (contractArg) {
    const contract = loadJSON(resolve(contractArg));
    ok = validate(ajv, contractSchema, contract, contractArg) && ok;
  }

  process.exit(ok ? 0 : 1);
}

const command = process.argv[2];

if (command === "check-diff") {
  runCheckDiff(process.argv.slice(3));
} else {
  runValidate(process.argv.slice(2));
}
