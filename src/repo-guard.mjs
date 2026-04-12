#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";

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

function run() {
  const policySchemaPath = resolve(root, "schemas/repo-policy.schema.json");
  const contractSchemaPath = resolve(root, "schemas/change-contract.schema.json");
  const policyPath = resolve(root, "repo-policy.json");

  const policySchema = loadJSON(policySchemaPath);
  const contractSchema = loadJSON(contractSchemaPath);
  const policy = loadJSON(policyPath);

  const ajv = new Ajv({ allErrors: true });

  let ok = true;

  ok = validate(ajv, policySchema, policy, "repo-policy.json") && ok;

  const contractArg = process.argv[2];
  if (contractArg) {
    const contract = loadJSON(resolve(contractArg));
    ok = validate(ajv, contractSchema, contract, contractArg) && ok;
  }

  process.exit(ok ? 0 : 1);
}

run();
