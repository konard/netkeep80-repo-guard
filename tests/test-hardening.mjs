import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  compileAnchorPolicy,
  compileForbidRegex,
  compileNewFilePolicy,
  compileSurfacePolicy,
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

describe("surface policy compilation", () => {
  it("accepts matrix references to declared surfaces and change classes", () => {
    const errors = compileSurfacePolicy({
      surfaces: {
        kernel: ["src/**"],
        tests: ["tests/**"],
      },
      change_classes: ["kernel-hardening"],
      surface_matrix: {
        "kernel-hardening": {
          allow: ["kernel", "tests"],
          forbid: [],
        },
      },
    });
    assert.equal(errors.length, 0);
  });

  it("rejects matrix entries that reference unknown surfaces", () => {
    const errors = compileSurfacePolicy({
      surfaces: {
        docs: ["docs/**"],
      },
      change_classes: ["docs-cleanup"],
      surface_matrix: {
        "docs-cleanup": {
          allow: ["docs", "kernel"],
          forbid: ["generated"],
        },
      },
    });
    assert.equal(errors.length, 2);
    assert.ok(errors.some((e) => e.message.includes("kernel")));
    assert.ok(errors.some((e) => e.message.includes("generated")));
  });

  it("rejects matrix entries that are not declared change classes", () => {
    const errors = compileSurfacePolicy({
      surfaces: {
        docs: ["docs/**"],
      },
      change_classes: ["docs-cleanup"],
      surface_matrix: {
        release: {
          allow: ["docs"],
          forbid: [],
        },
      },
    });
    assert.equal(errors.length, 1);
    assert.ok(errors[0].message.includes("change_classes"));
  });
});

describe("new file policy compilation", () => {
  it("accepts rules that reference declared classes and change classes", () => {
    const errors = compileNewFilePolicy({
      new_file_classes: {
        test: ["tests/**"],
        changelog_fragment: ["changelog.d/*.md"],
      },
      change_classes: ["kernel-hardening"],
      new_file_rules: {
        "kernel-hardening": {
          allow_classes: ["test", "changelog_fragment"],
          max_per_class: {
            test: 2,
          },
        },
      },
    });
    assert.equal(errors.length, 0);
  });

  it("rejects rules that reference unknown classes", () => {
    const errors = compileNewFilePolicy({
      new_file_classes: {
        test: ["tests/**"],
      },
      change_classes: ["kernel-hardening"],
      new_file_rules: {
        "kernel-hardening": {
          allow_classes: ["test", "generated"],
          max_per_class: {
            changelog_fragment: 1,
          },
        },
      },
    });
    assert.equal(errors.length, 2);
    assert.ok(errors.some((e) => e.message.includes("generated")));
    assert.ok(errors.some((e) => e.message.includes("changelog_fragment")));
  });

  it("rejects entries that are not declared change classes", () => {
    const errors = compileNewFilePolicy({
      new_file_classes: {
        test: ["tests/**"],
      },
      change_classes: ["kernel-hardening"],
      new_file_rules: {
        "docs-cleanup": {
          allow_classes: ["test"],
        },
      },
    });
    assert.equal(errors.length, 1);
    assert.ok(errors[0].message.includes("change_classes"));
  });

  it("requires explicit allow_classes in every rule", () => {
    const errors = compileNewFilePolicy({
      new_file_classes: {
        test: ["tests/**"],
      },
      change_classes: ["kernel-hardening"],
      new_file_rules: {
        "kernel-hardening": {
          max_per_class: {
            test: 1,
          },
        },
      },
    });
    assert.equal(errors.length, 1);
    assert.ok(errors[0].message.includes("allow_classes is required"));
  });

  it("accepts empty allow_classes as explicit deny-all semantics", () => {
    const errors = compileNewFilePolicy({
      new_file_classes: {
        test: ["tests/**"],
      },
      change_classes: ["docs-cleanup"],
      new_file_rules: {
        "docs-cleanup": {
          allow_classes: [],
          max_new_files: 0,
        },
      },
    });
    assert.equal(errors.length, 0);
  });
});

describe("anchor policy compilation", () => {
  it("accepts declared anchor types and trace rule references", () => {
    const errors = compileAnchorPolicy({
      anchors: {
        types: {
          requirement_id: {
            sources: [
              { kind: "json_field", glob: "requirements/**/*.json", field: "id" },
            ],
          },
          code_req_ref: {
            sources: [
              { kind: "regex", glob: "src/**", pattern: "@req\\s+((BR|SR)-[0-9]{3})" },
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
    });
    assert.equal(errors.length, 0);
  });

  it("rejects trace rules that reference unknown anchor types", () => {
    const errors = compileAnchorPolicy({
      anchors: {
        types: {
          requirement_id: {
            sources: [
              { kind: "json_field", glob: "requirements/**/*.json", field: "id" },
            ],
          },
        },
      },
      trace_rules: [
        {
          id: "code-refs-must-resolve",
          kind: "must_resolve",
          from_anchor_type: "code_req_ref",
          to_anchor_type: "missing_requirement_id",
        },
      ],
    });
    assert.equal(errors.length, 2);
    assert.ok(errors.some((e) => e.message.includes("code_req_ref")));
    assert.ok(errors.some((e) => e.message.includes("missing_requirement_id")));
  });

  it("rejects duplicate trace rule ids", () => {
    const errors = compileAnchorPolicy({
      anchors: {
        types: {
          requirement_id: {
            sources: [
              { kind: "json_field", glob: "requirements/**/*.json", field: "id" },
            ],
          },
        },
      },
      trace_rules: [
        {
          id: "code-refs-must-resolve",
          kind: "must_resolve",
          from_anchor_type: "requirement_id",
          to_anchor_type: "requirement_id",
        },
        {
          id: "code-refs-must-resolve",
          kind: "must_resolve",
          from_anchor_type: "requirement_id",
          to_anchor_type: "requirement_id",
        },
      ],
    });
    assert.equal(errors.length, 1);
    assert.ok(errors[0].message.includes("duplicates"));
  });

  it("rejects invalid regex extractor patterns", () => {
    const errors = compileAnchorPolicy({
      anchors: {
        types: {
          code_req_ref: {
            sources: [
              { kind: "regex", glob: "src/**", pattern: "[bad" },
            ],
          },
        },
      },
    });
    assert.equal(errors.length, 1);
    assert.ok(errors[0].message.includes("pattern is invalid"));
  });

  it("accepts evidence trace rules without anchor extractors", () => {
    const errors = compileAnchorPolicy({
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
    });
    assert.equal(errors.length, 0);
  });

  it("keeps policies without anchors and trace_rules compatible", () => {
    const errors = compileAnchorPolicy({});
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
