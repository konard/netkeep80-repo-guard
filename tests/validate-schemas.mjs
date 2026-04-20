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

const policyWithAnchors = {
  ...validPolicy,
  anchors: {
    types: {
      requirement_id: {
        sources: [
          { kind: "json_field", glob: "requirements/**/*.json", field: "id" },
        ],
      },
      code_req_ref: {
        sources: [
          { kind: "regex", glob: "src/**", pattern: "@req\\s+((BR|SR|FR|NFR|CR|IR)-[0-9]{3})" },
        ],
      },
    },
  },
  trace_rules: [
    {
      id: "code-refs-must-resolve",
      kind: "must_resolve",
      from_anchor_type: "code_req_ref",
      to_anchor_type: "requirement_id",
    },
  ],
};
expect("policy with anchors and trace_rules passes schema", validatePolicy(policyWithAnchors), true);

const policyWithEvidenceRules = {
  ...validPolicy,
  trace_rules: [
    {
      id: "changed-requirements-need-evidence",
      kind: "changed_files_require_evidence",
      if_changed: ["requirements/**"],
      must_touch_any: ["src/**", "tests/**", "docs/**"],
    },
    {
      id: "declared-anchors-need-evidence",
      kind: "declared_anchors_require_evidence",
      contract_field: "anchors.affects",
      must_touch_any: ["src/**", "tests/**", "docs/**"],
    },
  ],
};
expect("policy with evidence trace_rules passes schema", validatePolicy(policyWithEvidenceRules), true);

const policyWithIntegration = {
  ...validPolicy,
  integration: {
    workflows: [
      {
        id: "pr-gate",
        kind: "github_actions",
        path: ".github/workflows/repo-guard.yml",
        role: "repo_guard_pr_gate",
        profiles: ["requirements-strict"],
        expect: {
          events: ["pull_request"],
          event_types: ["opened", "synchronize", "reopened", "ready_for_review"],
          action: {
            uses: "netkeep80/repo-guard",
            ref_pinning: "semver",
          },
          mode: "check-pr",
          enforcement: "blocking",
          permissions: {
            contents: "read",
            "pull-requests": "read",
          },
          token_env: ["GH_TOKEN"],
          summary: true,
          disallow: ["continue_on_error", "manual_clone", "direct_temp_cli_execution"],
        },
      },
    ],
    templates: [
      {
        id: "pull-request-template",
        kind: "markdown",
        path: ".github/PULL_REQUEST_TEMPLATE.md",
        requires_contract_block: true,
        profiles: ["requirements-strict"],
      },
    ],
    docs: [
      {
        id: "readme",
        kind: "markdown",
        path: "README.md",
        must_mention: ["repo-guard", "anchors.affects"],
        profiles: ["requirements-strict"],
      },
    ],
    profiles: [
      {
        id: "requirements-strict",
        doc_path: "docs/requirements-strict-profile.md",
      },
    ],
  },
};
expect("policy with integration section passes schema", validatePolicy(policyWithIntegration), true);

const invalidIntegrationExpectationPolicy = {
  ...validPolicy,
  integration: {
    workflows: [
      {
        id: "pr-gate",
        kind: "github_actions",
        path: ".github/workflows/repo-guard.yml",
        role: "repo_guard_pr_gate",
        expect: {
          action: {
            uses: "",
            ref_pinning: "floating",
          },
          mode: "deploy",
          token_env: [],
          disallow: ["shell_script"],
        },
      },
    ],
  },
};
expect("policy with malformed integration workflow expectations fails schema", validatePolicy(invalidIntegrationExpectationPolicy), false);

const invalidIntegrationPolicy = {
  ...validPolicy,
  integration: {
    workflows: [
      {
        id: "pr-gate",
        kind: "cron",
        path: ".github/workflows/repo-guard.yml",
        role: "repo_guard_pr_gate",
      },
    ],
  },
};
expect("policy with unknown integration workflow kind fails schema", validatePolicy(invalidIntegrationPolicy), false);

const invalidIntegrationRolePolicy = {
  ...validPolicy,
  integration: {
    workflows: [
      {
        id: "pr-gate",
        kind: "github_actions",
        path: ".github/workflows/repo-guard.yml",
        role: "custom_gate",
      },
    ],
  },
};
expect("policy with unknown integration workflow role fails schema", validatePolicy(invalidIntegrationRolePolicy), false);

const invalidIntegrationDocKindPolicy = {
  ...validPolicy,
  integration: {
    docs: [
      {
        id: "readme",
        kind: "html",
        path: "README.md",
        must_mention: ["repo-guard"],
      },
    ],
  },
};
expect("policy with unknown integration doc kind fails schema", validatePolicy(invalidIntegrationDocKindPolicy), false);

// Content rules normalization tests
const oldFormPolicy = loadJSON(resolve(root, "tests/fixtures/invalid-content-rule-old-form.json"));
expect("old-form content_rules (pattern/severity/message) fails schema", validatePolicy(oldFormPolicy), false);

// Operational paths validation tests
const invalidOpPaths = loadJSON(resolve(root, "tests/fixtures/invalid-operational-paths.json"));
expect("invalid operational_paths (string instead of array) fails schema", validatePolicy(invalidOpPaths), false);

const invalidAnchorPolicy = {
  ...validPolicy,
  anchors: {
    types: {
      requirement_id: {
        sources: [
          { kind: "json_field", glob: "requirements/**/*.json", pattern: "id" },
        ],
      },
    },
  },
};
expect("invalid json_field anchor source fails schema", validatePolicy(invalidAnchorPolicy), false);

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

const contractWithAnchors = {
  ...validContract,
  anchors: {
    affects: ["FR-014"],
    implements: ["FR-014"],
    verifies: ["FR-014"],
  },
};
expect("contract with anchor intent passes schema", validateContract(contractWithAnchors), true);

const repositoryTypedContract = {
  ...validContract,
  change_type: "governance",
};
expect("repository-specific change_type passes schema", validateContract(repositoryTypedContract), true);

const invalidContract = loadJSON(resolve(root, "tests/fixtures/invalid-contract.json"));
expect("invalid-contract.json fails schema", validateContract(invalidContract), false);

const malformedAnchorContract = {
  ...validContract,
  anchors: {
    affects: ["FR-014", "FR-014"],
  },
};
expect("contract with duplicate anchor intent fails schema", validateContract(malformedAnchorContract), false);

const unknownAnchorFieldContract = {
  ...validContract,
  anchors: {
    affects: ["FR-014"],
    notes: ["reserved for a future schema version"],
  },
};
expect("contract with unknown anchor field fails schema", validateContract(unknownAnchorFieldContract), false);

const nonStringAnchorContract = {
  ...validContract,
  anchors: {
    verifies: ["FR-014", 14],
  },
};
expect("contract with non-string anchor intent fails schema", validateContract(nonStringAnchorContract), false);

console.log(`\n${failures === 0 ? "All tests passed" : `${failures} test(s) failed`}`);
process.exit(failures === 0 ? 0 : 1);
