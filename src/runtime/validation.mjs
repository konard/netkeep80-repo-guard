import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Ajv from "ajv";
import { ajvErrors } from "../enforcement.mjs";
import {
  compileAnchorPolicy,
  compileForbidRegex,
  compileIntegrationPolicy,
  compileNewFilePolicy,
  compileChangeTypePolicy,
  compileSurfacePolicy,
  warnReservedPolicyFields,
} from "../policy-compiler.mjs";
import { resolvePolicyProfile } from "../policy-profiles.mjs";

export function loadJSON(path) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

export function createAjv() {
  return new Ajv({ allErrors: true });
}

export function validate(ajv, schema, data, label, options = {}) {
  const valid = ajv.validate(schema, data);
  if (!valid) {
    if (!options.quiet) {
      console.error(`FAIL: ${label}`);
      for (const err of ajv.errors) {
        console.error(`  ${err.instancePath || "/"} ${err.message}`);
      }
    }
    return false;
  }
  if (!options.quiet) console.log(`OK: ${label}`);
  return true;
}

export function validationCheck(ajv, schema, data, label) {
  const valid = ajv.validate(schema, data);
  if (valid) return { ok: true };
  return {
    ok: false,
    message: `${label} failed schema validation`,
    errors: ajvErrors(ajv.errors),
  };
}

export function loadPolicyRuntime(roots, options = {}) {
  const policySchema = loadJSON(resolve(roots.packageRoot, "schemas/repo-policy.schema.json"));
  const contractSchema = loadJSON(resolve(roots.packageRoot, "schemas/change-contract.schema.json"));
  const rawPolicy = loadJSON(resolve(roots.repoRoot, "repo-policy.json"));
  const ajv = createAjv();
  const quiet = options.quiet || false;

  let ok = true;
  ok = validate(ajv, policySchema, rawPolicy, "repo-policy.json", { quiet }) && ok;

  const profileResult = resolvePolicyProfile(rawPolicy);
  const policy = profileResult.policy;

  const compileGroups = [
    ["profile compilation", profileResult.errors, (e) => e.message],
    ["forbid_regex compilation", compileForbidRegex(policy.content_rules), (e) => `[${e.rule_id}] invalid regex /${e.pattern}/: ${e.message}`],
    ["surface policy compilation", compileSurfacePolicy(policy), (e) => e.message],
    ["new file policy compilation", compileNewFilePolicy(policy), (e) => e.message],
    ["change type policy compilation", compileChangeTypePolicy(policy), (e) => e.message],
    ["anchor policy compilation", compileAnchorPolicy(policy), (e) => e.message],
    ["integration policy compilation", compileIntegrationPolicy(policy), (e) => e.message],
  ];

  for (const [label, errors, format] of compileGroups) {
    if (errors.length === 0) continue;
    ok = false;
    if (!quiet) {
      console.error(`FAIL: ${label}`);
      for (const error of errors) {
        console.error(`  ${format(error)}`);
      }
    }
  }

  if (!quiet) {
    for (const warning of warnReservedPolicyFields(policy)) {
      console.warn(`WARN: ${warning}`);
    }
  }

  return { ok, ajv, policy, contractSchema };
}
