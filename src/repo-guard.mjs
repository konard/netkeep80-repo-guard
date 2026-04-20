#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  warnReservedContractFields,
} from "./policy-compiler.mjs";
import {
  resolveEnforcementMode,
} from "./enforcement.mjs";
import { renderCheckSummary } from "./reporting/renderers.mjs";
import { loadJSON, loadPolicyRuntime, validate, validationCheck } from "./runtime/validation.mjs";
import { runPolicyPipeline } from "./runtime/pipeline.mjs";

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
        console.error("Usage: repo-guard [--repo-root <path>] [--enforcement <advisory|blocking>] [check-diff|check-pr|init|doctor|validate-integration] [options]");
        process.exit(1);
      }
      repoRoot = resolve(args[++i]);
    } else if (args[i] === "--enforcement" || args[i] === "--enforcement-mode") {
      const next = args[i + 1];
      if (!next || next.startsWith("-")) {
        console.error(`Error: ${args[i]} requires a mode argument`);
        console.error("Usage: repo-guard [--repo-root <path>] [--enforcement <advisory|blocking>] [check-diff|check-pr|init|doctor|validate-integration] [options]");
        process.exit(1);
      }
      enforcementMode = args[++i];
    } else {
      filtered.push(args[i]);
    }
  }
  return { packageRoot, repoRoot, enforcementMode, args: filtered };
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
  let base = null;
  let head = null;
  let contractPath = null;
  let cliChangeClass = null;
  let format = "text";
  const KNOWN_DIFF_OPTS = new Set(["--base", "--head", "--contract", "--format", "--change-class"]);

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--base" && args[i + 1]) base = args[++i];
    else if (args[i] === "--head" && args[i + 1]) head = args[++i];
    else if (args[i] === "--contract" && args[i + 1]) {
      contractPath = resolve(roots.repoRoot, args[++i]);
    } else if (args[i] === "--format" && args[i + 1]) {
      format = args[++i];
    } else if (args[i] === "--change-class") {
      const next = args[i + 1];
      if (!next || next.startsWith("-")) {
        console.error("Error: --change-class requires a name argument");
        console.error("Usage: repo-guard check-diff [--base <ref>] [--head <ref>] [--contract <path>] [--change-class <name>] [--format <text|json|summary>] [--enforcement <advisory|blocking>]");
        process.exit(1);
      }
      cliChangeClass = next;
      i++;
    } else if (args[i].startsWith("-") && !KNOWN_DIFF_OPTS.has(args[i])) {
      console.error(`Unknown option for check-diff: ${args[i]}`);
      console.error("Usage: repo-guard check-diff [--base <ref>] [--head <ref>] [--contract <path>] [--change-class <name>] [--format <text|json|summary>] [--enforcement <advisory|blocking>]");
      process.exit(1);
    }
  }

  if (!["text", "json", "summary"].includes(format)) {
    console.error(`Unknown check-diff format: ${format}`);
    console.error("Usage: repo-guard check-diff [--base <ref>] [--head <ref>] [--contract <path>] [--change-class <name>] [--format <text|json|summary>] [--enforcement <advisory|blocking>]");
    process.exit(1);
  }

  const quiet = format === "json";

  const runtime = loadPolicyRuntime(roots, { quiet });
  const { ajv, policy, contractSchema } = runtime;

  if (!runtime.ok) {
    if (!quiet) console.error("\nPolicy compilation failed; aborting enforcement.");
    process.exit(1);
  }

  const enforcement = resolveEnforcementMode({ cliValue: roots.enforcementMode, policy });
  if (!enforcement.ok) {
    console.error(`ERROR: ${enforcement.message}`);
    process.exit(1);
  }

  let contract = null;
  const initialChecks = [];
  if (contractPath) {
    try {
      const loadedContract = loadJSON(contractPath);
      const contractCheck = validationCheck(ajv, contractSchema, loadedContract, contractPath);
      initialChecks.push({ name: "change-contract", check: contractCheck });
      if (contractCheck.ok) {
        contract = loadedContract;
        if (!quiet) {
          for (const w of warnReservedContractFields(contract)) {
            console.warn(`WARN: ${w}`);
          }
        }
      }
    } catch (e) {
      initialChecks.push({
        name: "change-contract",
        check: {
          ok: false,
          message: `Cannot read ${contractPath}: ${e.message}`,
        },
      });
    }
  }

  const diffText = getDiff(base, head, roots.repoRoot);
  const declaredChangeClass = cliChangeClass || contract?.change_class || null;

  const summary = runPolicyPipeline({
    mode: "check-diff",
    repositoryRoot: roots.repoRoot,
    policy,
    contract,
    contractSource: contractPath ? "cli file" : "none",
    enforcement,
    diffText,
    declaredChangeClass,
    initialChecks,
  }, { quiet });

  if (format === "json") {
    console.log(JSON.stringify(summary, null, 2));
  } else if (format === "summary") {
    console.log(renderCheckSummary(summary));
  }
  process.exit(summary.exitCode);
}

function runValidate(roots, args) {
  const runtime = loadPolicyRuntime(roots);
  const { ajv, contractSchema } = runtime;
  let ok = runtime.ok;

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

function sameEntrypointPath(left, right) {
  try {
    return realpathSync(left) === realpathSync(right);
  } catch {
    return resolve(left) === resolve(right);
  }
}

const isMain = process.argv[1] && sameEntrypointPath(process.argv[1], resolve(__dirname, "repo-guard.mjs"));

if (isMain) {
  const MODES = new Set(["check-diff", "check-pr", "init", "doctor", "validate-integration"]);
  const roots = resolveRoots(process.argv.slice(2));
  const command = roots.args[0];

  if (command && !MODES.has(command) && command.startsWith("-")) {
    console.error(`Unknown option: ${command}`);
    console.error("Usage: repo-guard [--repo-root <path>] [--enforcement <advisory|blocking>] [check-diff|check-pr|init|doctor|validate-integration] [options]");
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
    roots.args = roots.args.slice(1);
    if (roots.args.includes("--integration")) {
      const { runValidateIntegration } = await import("./integration-validator.mjs");
      runValidateIntegration(roots, roots.args);
    } else {
      const { runDoctor } = await import("./doctor.mjs");
      const report = runDoctor(roots);
      process.exit(report.fails > 0 ? 1 : 0);
    }
  } else if (command === "validate-integration") {
    roots.args = roots.args.slice(1);
    const { runValidateIntegration } = await import("./integration-validator.mjs");
    runValidateIntegration(roots, roots.args);
  } else {
    runValidate(roots, roots.args);
  }
}
