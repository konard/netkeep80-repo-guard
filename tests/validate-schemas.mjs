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

// Content rules normalization tests
const oldFormPolicy = loadJSON(resolve(root, "tests/fixtures/invalid-content-rule-old-form.json"));
expect("old-form content_rules (pattern/severity/message) fails schema", validatePolicy(oldFormPolicy), false);

// Operational paths validation tests
const invalidOpPaths = loadJSON(resolve(root, "tests/fixtures/invalid-operational-paths.json"));
expect("invalid operational_paths (string instead of array) fails schema", validatePolicy(invalidOpPaths), false);

const missingAllowClassesPolicy = {
  change_classes: ["kernel-hardening"],
  new_file_classes: {
    test: ["tests/**"],
  },
  new_file_rules: {
    "kernel-hardening": {
      max_per_class: {
        test: 1,
      },
    },
  },
};
expect("new_file_rules without allow_classes fails schema", validatePolicy(missingAllowClassesPolicy), false);

// Contract tests
const validContract = loadJSON(resolve(root, "tests/fixtures/valid-contract.json"));
expect("valid-contract.json passes schema", validateContract(validContract), true);

const repositoryTypedContract = {
  ...validContract,
  change_type: "governance",
};
expect("repository-specific change_type passes schema", validateContract(repositoryTypedContract), true);

const invalidContract = loadJSON(resolve(root, "tests/fixtures/invalid-contract.json"));
expect("invalid-contract.json fails schema", validateContract(invalidContract), false);

console.log(`\n${failures === 0 ? "All tests passed" : `${failures} test(s) failed`}`);
process.exit(failures === 0 ? 0 : 1);
