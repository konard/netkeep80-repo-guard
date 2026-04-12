import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

function loadJSON(path) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

const policySchema = loadJSON(resolve(root, "schemas/repo-policy.schema.json"));
const contractSchema = loadJSON(resolve(root, "schemas/change-contract.schema.json"));

const ajv = new Ajv({ allErrors: true });
const validatePolicy = ajv.compile(policySchema);
const validateContract = ajv.compile(contractSchema);

let failures = 0;

function expect(label, result, shouldPass) {
  const passed = result === shouldPass;
  const icon = passed ? "PASS" : "FAIL";
  console.log(`${icon}: ${label}`);
  if (!passed) {
    failures++;
    if (!shouldPass && result) {
      console.error("  Expected validation to fail, but it passed");
    }
  }
}

// Policy tests
const validPolicy = loadJSON(resolve(root, "tests/fixtures/valid-policy.json"));
expect("valid-policy.json passes schema", validatePolicy(validPolicy), true);

const invalidPolicy = loadJSON(resolve(root, "tests/fixtures/invalid-policy.json"));
expect("invalid-policy.json fails schema", validatePolicy(invalidPolicy), false);

const repoPolicy = loadJSON(resolve(root, "repo-policy.json"));
expect("repo-policy.json (self) passes schema", validatePolicy(repoPolicy), true);

// Contract tests
const validContract = loadJSON(resolve(root, "tests/fixtures/valid-contract.json"));
expect("valid-contract.json passes schema", validateContract(validContract), true);

const invalidContract = loadJSON(resolve(root, "tests/fixtures/invalid-contract.json"));
expect("invalid-contract.json fails schema", validateContract(invalidContract), false);

console.log(`\n${failures === 0 ? "All tests passed" : `${failures} test(s) failed`}`);
process.exit(failures === 0 ? 0 : 1);
