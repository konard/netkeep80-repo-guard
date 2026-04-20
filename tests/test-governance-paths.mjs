import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { checkGovernanceChangeAuthorization } from "../src/checks/rules/governance-paths.mjs";
import { createDefaultRuleRegistry } from "../src/checks/default-rule-families.mjs";
import { buildPolicyFacts } from "../src/facts/input.mjs";
import { runPolicyChecks } from "../src/checks/orchestrator.mjs";
import { createAnalysisCollector } from "../src/runtime/analysis-report.mjs";
import { extractIssueAuthorization } from "../src/markdown-contract.mjs";

const GOVERNANCE_PATHS = [
  "repo-policy.json",
  "schemas/",
  ".github/workflows/",
  ".github/PULL_REQUEST_TEMPLATE.md",
  ".github/ISSUE_TEMPLATE/",
  "templates/",
  "action.yml",
];

function file(path, { status = "modified", addedLines = [], deletedLines = [] } = {}) {
  return { path, status, addedLines, deletedLines };
}

describe("governance-change authorization unit checks", () => {
  it("passes when no governance file is touched", () => {
    const result = checkGovernanceChangeAuthorization({
      files: [file("src/feature.mjs", { addedLines: ["x"] })],
      governancePaths: GOVERNANCE_PATHS,
      issueAuthorization: null,
      contract: null,
      contractSource: "none",
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.touched_governance_paths, []);
  });

  it("fails when policy file is modified without any authorization", () => {
    const result = checkGovernanceChangeAuthorization({
      files: [file("repo-policy.json", { addedLines: ["  \"foo\": 1"] })],
      governancePaths: GOVERNANCE_PATHS,
      issueAuthorization: null,
      contract: null,
      contractSource: "none",
    });
    assert.equal(result.ok, false);
    assert.deepEqual(result.touched_governance_paths, ["repo-policy.json"]);
    assert.deepEqual(result.unauthorized_paths, ["repo-policy.json"]);
    assert.match(result.hint, /authorized_governance_paths/);
  });

  it("fails when authorization is only declared in the PR-body contract", () => {
    const result = checkGovernanceChangeAuthorization({
      files: [file("repo-policy.json", { addedLines: ["  \"foo\": 1"] })],
      governancePaths: GOVERNANCE_PATHS,
      issueAuthorization: null,
      contract: { authorized_governance_paths: ["repo-policy.json"] },
      contractSource: "pr body",
    });
    assert.equal(result.ok, false);
    assert.deepEqual(result.unauthorized_paths, ["repo-policy.json"]);
    assert.equal(result.untrusted_authorization_ignored, true);
  });

  it("passes when the linked-issue authorization covers the exact governance path", () => {
    const result = checkGovernanceChangeAuthorization({
      files: [file("repo-policy.json", { addedLines: ["  \"foo\": 1"] })],
      governancePaths: GOVERNANCE_PATHS,
      issueAuthorization: { authorized_governance_paths: ["repo-policy.json"] },
      contract: null,
      contractSource: "none",
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.unauthorized_paths, []);
    assert.equal(result.untrusted_authorization_ignored, false);
  });

  it("passes when split sources: PR-body change contract + linked-issue authorization", () => {
    const result = checkGovernanceChangeAuthorization({
      files: [file("schemas/repo-policy.schema.json", { addedLines: ["+"] })],
      governancePaths: GOVERNANCE_PATHS,
      issueAuthorization: { authorized_governance_paths: ["schemas/**"] },
      contract: { change_type: "feature", scope: ["schemas"] },
      contractSource: "pr body",
    });
    assert.equal(result.ok, true);
  });

  it("reports partial authorization correctly", () => {
    const result = checkGovernanceChangeAuthorization({
      files: [
        file("repo-policy.json", { addedLines: ["+"] }),
        file("schemas/change-contract.schema.json", { addedLines: ["+"] }),
      ],
      governancePaths: GOVERNANCE_PATHS,
      issueAuthorization: { authorized_governance_paths: ["repo-policy.json"] },
      contract: null,
      contractSource: "linked issue",
    });
    assert.equal(result.ok, false);
    assert.deepEqual(result.unauthorized_paths, ["schemas/change-contract.schema.json"]);
  });

  it("is ok when trusted governance_paths is empty", () => {
    const result = checkGovernanceChangeAuthorization({
      files: [file("repo-policy.json", { addedLines: ["+"] })],
      governancePaths: [],
      issueAuthorization: null,
      contract: null,
      contractSource: "none",
    });
    assert.equal(result.ok, true);
  });

  it("ignores authorized_governance_paths in contract when contract came from linked issue too (field lives on the authorization channel)", () => {
    const result = checkGovernanceChangeAuthorization({
      files: [file("repo-policy.json", { addedLines: ["+"] })],
      governancePaths: GOVERNANCE_PATHS,
      issueAuthorization: null,
      contract: { authorized_governance_paths: ["repo-policy.json"] },
      contractSource: "linked issue",
    });
    assert.equal(result.ok, false);
    assert.deepEqual(result.unauthorized_paths, ["repo-policy.json"]);
    assert.equal(result.untrusted_authorization_ignored, false);
  });
});

describe("extractIssueAuthorization", () => {
  it("returns null for empty input", () => {
    assert.equal(extractIssueAuthorization(null), null);
    assert.equal(extractIssueAuthorization(""), null);
  });

  it("returns null when the issue body has no repo-guard contract", () => {
    assert.equal(extractIssueAuthorization("just prose"), null);
  });

  it("returns null when the issue contract has no privileged fields", () => {
    const body = [
      "```repo-guard-yaml",
      "change_type: feature",
      "scope:",
      "  - src/",
      "budgets: {}",
      "must_touch: []",
      "must_not_touch: []",
      "expected_effects:",
      "  - x",
      "```",
    ].join("\n");
    assert.equal(extractIssueAuthorization(body), null);
  });

  it("extracts authorized_governance_paths from the issue body", () => {
    const body = [
      "```repo-guard-yaml",
      "change_type: feature",
      "scope:",
      "  - schemas/",
      "budgets: {}",
      "must_touch: []",
      "must_not_touch: []",
      "expected_effects:",
      "  - x",
      "authorized_governance_paths:",
      "  - schemas/**",
      "  - .github/ISSUE_TEMPLATE/**",
      "```",
    ].join("\n");
    const auth = extractIssueAuthorization(body);
    assert.deepEqual(auth, {
      authorized_governance_paths: ["schemas/**", ".github/ISSUE_TEMPLATE/**"],
    });
  });
});

describe("governance-change authorization integration via pipeline", () => {
  const basePolicy = {
    policy_format_version: "0.3.0",
    repository_kind: "tooling",
    paths: {
      forbidden: [],
      canonical_docs: ["README.md"],
      operational_paths: [],
      governance_paths: ["repo-policy.json", "schemas/"],
    },
    diff_rules: {
      max_new_docs: 5,
      max_new_files: 5,
      max_net_added_lines: 2000,
    },
    content_rules: [],
    cochange_rules: [],
  };

  const policyFileDiff = [
    "diff --git a/repo-policy.json b/repo-policy.json",
    "--- a/repo-policy.json",
    "+++ b/repo-policy.json",
    "+  \"foo\": 1",
  ].join("\n");

  function runRegistry({
    contract,
    contractSource,
    issueAuthorization = null,
    trustedGovernancePaths = basePolicy.paths.governance_paths,
    policy = basePolicy,
    diffText = policyFileDiff,
  }) {
    const facts = buildPolicyFacts({
      mode: "check-pr",
      repositoryRoot: "/tmp/repo-guard-test-governance",
      policy,
      contract,
      contractSource,
      issueAuthorization,
      trustedGovernancePaths,
      enforcement: { mode: "blocking" },
      diffText,
      trackedFiles: ["repo-policy.json", "README.md"],
    });
    const reporter = createAnalysisCollector({ mode: "blocking" });
    const registry = createDefaultRuleRegistry();
    runPolicyChecks(facts, reporter, { registry });
    return reporter.finish({ command: "check-pr" });
  }

  it("blocks AI-self-authorized PR-body-only contract", () => {
    const report = runRegistry({
      contract: {
        change_type: "feature",
        scope: ["repo-policy.json"],
        budgets: {},
        must_touch: [],
        must_not_touch: [],
        expected_effects: ["x"],
        authorized_governance_paths: ["repo-policy.json"],
      },
      contractSource: "pr body",
    });
    const governance = report.violations.find((v) => v.rule === "governance-change-authorization");
    assert.ok(governance, "expected governance-change-authorization violation");
    assert.equal(governance.ok, false);
  });

  it("allows split-source authorization: PR-body change contract + linked-issue authorization", () => {
    const report = runRegistry({
      contract: {
        change_type: "feature",
        scope: ["repo-policy.json"],
        budgets: {},
        must_touch: [],
        must_not_touch: [],
        expected_effects: ["x"],
      },
      contractSource: "pr body",
      issueAuthorization: { authorized_governance_paths: ["repo-policy.json"] },
    });
    const governance = report.ruleResults.find((r) => r.rule === "governance-change-authorization");
    assert.ok(governance);
    assert.equal(governance.ok, true);
  });

  it("blocks governance change with no contract and no authorization", () => {
    const report = runRegistry({
      contract: null,
      contractSource: "none",
    });
    const governance = report.violations.find((v) => v.rule === "governance-change-authorization");
    assert.ok(governance);
  });

  it("defends against the bypass attempt: PR that narrows head governance_paths cannot escape the trusted boundary", () => {
    // Head policy narrows governance_paths to exclude schemas/, but the
    // trusted base boundary still covers schemas/ and the diff touches it.
    const narrowedHeadPolicy = {
      ...basePolicy,
      paths: {
        ...basePolicy.paths,
        governance_paths: ["nonexistent-only.json"],
      },
    };
    const schemaDiff = [
      "diff --git a/schemas/repo-policy.schema.json b/schemas/repo-policy.schema.json",
      "--- a/schemas/repo-policy.schema.json",
      "+++ b/schemas/repo-policy.schema.json",
      "+  \"bypass\": true",
    ].join("\n");
    const report = runRegistry({
      contract: {
        change_type: "feature",
        scope: ["schemas/"],
        budgets: {},
        must_touch: [],
        must_not_touch: [],
        expected_effects: ["x"],
      },
      contractSource: "pr body",
      issueAuthorization: null,
      trustedGovernancePaths: basePolicy.paths.governance_paths,
      policy: narrowedHeadPolicy,
      diffText: schemaDiff,
    });
    const governance = report.violations.find((v) => v.rule === "governance-change-authorization");
    assert.ok(governance, "trusted boundary must still enforce schemas/ despite narrowed head policy");
  });

  it("is a no-op when trusted boundary is empty", () => {
    const report = runRegistry({
      contract: null,
      contractSource: "none",
      trustedGovernancePaths: [],
    });
    const governance = report.ruleResults.find((r) => r.rule === "governance-change-authorization");
    assert.equal(governance, undefined, "rule should not even apply when trusted boundary is empty");
  });
});
