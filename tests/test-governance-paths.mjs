import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { checkGovernanceChangeAuthorization } from "../src/checks/rules/governance-paths.mjs";
import { createDefaultRuleRegistry } from "../src/checks/default-rule-families.mjs";
import { buildPolicyFacts } from "../src/facts/input.mjs";
import { runPolicyChecks } from "../src/checks/orchestrator.mjs";
import { createAnalysisCollector } from "../src/runtime/analysis-report.mjs";

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
      contract: null,
      contractSource: "none",
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.touched_governance_paths, []);
  });

  it("fails when policy file is modified without a contract", () => {
    const result = checkGovernanceChangeAuthorization({
      files: [file("repo-policy.json", { addedLines: ["  \"foo\": 1"] })],
      governancePaths: GOVERNANCE_PATHS,
      contract: null,
      contractSource: "none",
    });
    assert.equal(result.ok, false);
    assert.deepEqual(result.touched_governance_paths, ["repo-policy.json"]);
    assert.deepEqual(result.unauthorized_paths, ["repo-policy.json"]);
    assert.match(result.hint, /authorized_governance_paths/);
  });

  it("fails when contract authorizes but is carried by the PR body only", () => {
    const result = checkGovernanceChangeAuthorization({
      files: [file("repo-policy.json", { addedLines: ["  \"foo\": 1"] })],
      governancePaths: GOVERNANCE_PATHS,
      contract: { authorized_governance_paths: ["repo-policy.json"] },
      contractSource: "pr body",
    });
    assert.equal(result.ok, false);
    assert.deepEqual(result.unauthorized_paths, []);
    assert.deepEqual(result.unsanctioned_paths, ["repo-policy.json"]);
  });

  it("passes when contract in linked issue authorizes the exact governance path", () => {
    const result = checkGovernanceChangeAuthorization({
      files: [file("repo-policy.json", { addedLines: ["  \"foo\": 1"] })],
      governancePaths: GOVERNANCE_PATHS,
      contract: { authorized_governance_paths: ["repo-policy.json"] },
      contractSource: "linked issue",
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.unauthorized_paths, []);
    assert.deepEqual(result.unsanctioned_paths, []);
  });

  it("passes when contract authorization glob covers touched governance file", () => {
    const result = checkGovernanceChangeAuthorization({
      files: [file("schemas/repo-policy.schema.json", { addedLines: ["+"] })],
      governancePaths: GOVERNANCE_PATHS,
      contract: { authorized_governance_paths: ["schemas/**"] },
      contractSource: "linked issue",
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
      contract: { authorized_governance_paths: ["repo-policy.json"] },
      contractSource: "linked issue",
    });
    assert.equal(result.ok, false);
    assert.deepEqual(result.unauthorized_paths, ["schemas/change-contract.schema.json"]);
  });

  it("is ok when governance_paths is missing from policy", () => {
    const result = checkGovernanceChangeAuthorization({
      files: [file("repo-policy.json", { addedLines: ["+"] })],
      governancePaths: [],
      contract: null,
      contractSource: "none",
    });
    assert.equal(result.ok, true);
  });
});

describe("governance-change authorization integration via pipeline", () => {
  const policy = {
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

  const diffText = [
    "diff --git a/repo-policy.json b/repo-policy.json",
    "--- a/repo-policy.json",
    "+++ b/repo-policy.json",
    "+  \"foo\": 1",
  ].join("\n");

  function runRegistry({ contract, contractSource }) {
    const facts = buildPolicyFacts({
      mode: "check-pr",
      repositoryRoot: "/tmp/repo-guard-test-governance",
      policy,
      contract,
      contractSource,
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

  it("allows issue-sanctioned governance change", () => {
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
      contractSource: "linked issue",
    });
    const governance = report.ruleResults.find((r) => r.rule === "governance-change-authorization");
    assert.ok(governance);
    assert.equal(governance.ok, true);
  });

  it("blocks governance change with no contract", () => {
    const report = runRegistry({
      contract: null,
      contractSource: "none",
    });
    const governance = report.violations.find((v) => v.rule === "governance-change-authorization");
    assert.ok(governance);
  });
});
