#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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
    const { runCheckDiff } = await import("./check-diff.mjs");
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
    const { runValidate } = await import("./validate.mjs");
    runValidate(roots, roots.args);
  }
}
