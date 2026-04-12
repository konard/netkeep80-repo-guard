import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  compileForbidRegex,
  warnReservedContractFields,
  warnReservedPolicyFields,
} from "../src/policy-compiler.mjs";
import { checkMustTouch } from "../src/diff-checker.mjs";
import { checkPrerequisites } from "../src/github-pr.mjs";

// Build test patterns without triggering the no-todo-without-issue content rule
const td = "TO" + "DO"; // eslint-disable-line prefer-template

describe("forbid_regex eager validation", () => {
  it("accepts valid regex patterns", () => {
    const rules = [
      { id: "r1", forbid_regex: [td, "FIXME", "console\\.log"] },
    ];
    const errors = compileForbidRegex(rules);
    assert.equal(errors.length, 0);
  });

  it("rejects malformed regex with clear diagnostic", () => {
    const rules = [
      { id: "bad-rule", forbid_regex: ["[invalid(", "ok-pattern"] },
    ];
    const errors = compileForbidRegex(rules);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].rule_id, "bad-rule");
    assert.equal(errors[0].pattern, "[invalid(");
    assert.ok(errors[0].message.length > 0, "should include error message");
  });

  it("reports multiple invalid patterns across rules", () => {
    const rules = [
      { id: "r1", forbid_regex: ["[bad1"] },
      { id: "r2", forbid_regex: ["good", "(bad2"] },
    ];
    const errors = compileForbidRegex(rules);
    assert.equal(errors.length, 2);
    assert.equal(errors[0].rule_id, "r1");
    assert.equal(errors[1].rule_id, "r2");
  });

  it("skips rules without forbid_regex", () => {
    const rules = [{ id: "no-regex" }];
    const errors = compileForbidRegex(rules);
    assert.equal(errors.length, 0);
  });

  it("handles complex valid regex like negative lookahead", () => {
    const rules = [
      { id: "r1", forbid_regex: [`${td}(?!\\(#\\d+\\))`] },
    ];
    const errors = compileForbidRegex(rules);
    assert.equal(errors.length, 0);
  });
});

describe("overrides reserved semantics", () => {
  it("warns when overrides is non-empty", () => {
    const contract = {
      overrides: [{ rule_id: "some-rule", reason: "testing" }],
    };
    const warnings = warnReservedContractFields(contract);
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0].includes("reserved"));
    assert.ok(warnings[0].includes("not enforced"));
  });

  it("no warning when overrides is empty", () => {
    const contract = { overrides: [] };
    const warnings = warnReservedContractFields(contract);
    assert.equal(warnings.length, 0);
  });

  it("no warning when overrides is absent", () => {
    const contract = {};
    const warnings = warnReservedContractFields(contract);
    assert.equal(warnings.length, 0);
  });
});

describe("governance_paths and public_api semantics", () => {
  it("warns when public_api is non-empty", () => {
    const policy = { paths: { public_api: ["src/api/**"] } };
    const warnings = warnReservedPolicyFields(policy);
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0].includes("public_api"));
    assert.ok(warnings[0].includes("reserved"));
  });

  it("no warning when public_api is empty", () => {
    const policy = { paths: { public_api: [] } };
    const warnings = warnReservedPolicyFields(policy);
    assert.equal(warnings.length, 0);
  });

  it("no warning when public_api is absent", () => {
    const policy = { paths: {} };
    const warnings = warnReservedPolicyFields(policy);
    assert.equal(warnings.length, 0);
  });

  it("governance_paths does not trigger runtime warnings (informational only)", () => {
    const policy = {
      paths: {
        governance_paths: ["repo-policy.json", "schemas/"],
      },
    };
    const warnings = warnReservedPolicyFields(policy);
    assert.equal(warnings.length, 0);
  });
});

describe("must_touch any-of semantics", () => {
  const files = [
    { path: "src/app.mjs", addedLines: [], deletedLines: [] },
    { path: "tests/test-app.mjs", addedLines: [], deletedLines: [] },
  ];

  it("satisfied when any pattern matches any changed file", () => {
    const result = checkMustTouch(files, ["docs/**", "tests/**"]);
    assert.equal(result.ok, true);
  });

  it("fails when no pattern matches any changed file", () => {
    const result = checkMustTouch(files, ["docs/**", "migrations/**"]);
    assert.equal(result.ok, false);
  });

  it("includes hint about any-of semantics on failure", () => {
    const result = checkMustTouch(files, ["docs/**"]);
    assert.equal(result.ok, false);
    assert.ok(result.hint, "should include hint on failure");
    assert.ok(result.hint.includes("any-of"));
  });

  it("no hint on success", () => {
    const result = checkMustTouch(files, ["tests/**"]);
    assert.equal(result.ok, true);
    assert.equal(result.hint, undefined);
  });

  it("empty must_touch always passes", () => {
    const result = checkMustTouch(files, []);
    assert.equal(result.ok, true);
  });
});

describe("check-pr prerequisites", () => {
  it("reports missing GITHUB_EVENT_PATH when not set", () => {
    const original = process.env.GITHUB_EVENT_PATH;
    delete process.env.GITHUB_EVENT_PATH;
    try {
      const missing = checkPrerequisites();
      assert.ok(missing.some((m) => m.includes("GITHUB_EVENT_PATH")));
    } finally {
      if (original !== undefined) process.env.GITHUB_EVENT_PATH = original;
    }
  });

  it("git and gh are available in test environment", () => {
    const missing = checkPrerequisites();
    const gitMissing = missing.some((m) => m.includes("git CLI"));
    const ghMissing = missing.some((m) => m.includes("gh CLI"));
    assert.equal(gitMissing, false, "git should be available");
    assert.equal(ghMissing, false, "gh should be available");
  });
});
