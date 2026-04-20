import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  compileAnchorPolicy,
  compileForbidRegex,
  compileIntegrationPolicy,
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

describe("integration policy compilation", () => {
  it("keeps policies without integration compatible", () => {
    const errors = compileIntegrationPolicy({});
    assert.equal(errors.length, 0);
  });

  it("accepts unique ids within each integration section", () => {
    const errors = compileIntegrationPolicy({
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
            must_mention: ["repo-guard"],
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
    });
    assert.equal(errors.length, 0);
  });

  it("rejects duplicate ids within an integration section", () => {
    const errors = compileIntegrationPolicy({
      integration: {
        workflows: [
          {
            id: "pr-gate",
            kind: "github_actions",
            path: ".github/workflows/repo-guard.yml",
            role: "repo_guard_pr_gate",
          },
          {
            id: "pr-gate",
            kind: "github_actions",
            path: ".github/workflows/repo-guard-advisory.yml",
            role: "repo_guard_pr_gate",
          },
        ],
      },
    });
    assert.equal(errors.length, 1);
    assert.equal(errors[0].section, "workflows");
    assert.ok(errors[0].message.includes("duplicates"));
  });

  it("rejects duplicate ids across integration sections", () => {
    const errors = compileIntegrationPolicy({
      integration: {
        workflows: [
          {
            id: "repo-guard",
            kind: "github_actions",
            path: ".github/workflows/repo-guard.yml",
            role: "repo_guard_pr_gate",
          },
        ],
        templates: [
          {
            id: "repo-guard",
            kind: "markdown",
            path: ".github/PULL_REQUEST_TEMPLATE.md",
            requires_contract_block: true,
          },
        ],
      },
    });
    assert.equal(errors.length, 1);
    assert.equal(errors[0].section, "templates");
    assert.ok(errors[0].message.includes("duplicates"));
    assert.ok(errors[0].message.includes("integration.workflows[0].id"));
  });

  it("rejects malformed integration shapes and missing required fields during compilation", () => {
    const errors = compileIntegrationPolicy({
      integration: {
        workflows: "not-an-array",
        templates: [
          null,
          {
            id: "pull-request-template",
            kind: "markdown",
            path: ".github/PULL_REQUEST_TEMPLATE.md",
          },
        ],
        docs: [
          {
            id: "readme",
            path: "",
            must_mention: [],
          },
        ],
        profiles: [
          {
            id: "requirements-strict",
          },
        ],
      },
    });

    assert.ok(errors.some((e) => e.message.includes("integration.workflows must be an array")));
    assert.ok(errors.some((e) => e.message.includes("integration.templates[0] must be an object")));
    assert.ok(errors.some((e) => e.message.includes("requires_contract_block is required")));
    assert.ok(errors.some((e) => e.message.includes("integration.docs[0].path is required")));
    assert.ok(errors.some((e) => e.message.includes("integration.docs[0].must_mention must contain at least one")));
    assert.ok(errors.some((e) => e.message.includes("integration.profiles[0].doc_path is required")));
  });

  it("rejects unsupported integration kinds and workflow roles", () => {
    const errors = compileIntegrationPolicy({
      integration: {
        workflows: [
          {
            id: "cron",
            kind: "cron",
            path: ".github/workflows/repo-guard.yml",
            role: "custom_gate",
          },
        ],
        templates: [
          {
            id: "template",
            kind: "html",
            path: ".github/PULL_REQUEST_TEMPLATE.md",
            requires_contract_block: true,
          },
        ],
        docs: [
          {
            id: "readme",
            kind: "html",
            path: "README.md",
            must_mention: ["repo-guard"],
          },
        ],
      },
    });

    assert.equal(errors.length, 4);
    assert.ok(errors.some((e) => e.message.includes("integration.workflows[0].kind must be one of")));
    assert.ok(errors.some((e) => e.message.includes("integration.workflows[0].role must be one of")));
    assert.ok(errors.some((e) => e.message.includes("integration.templates[0].kind must be one of")));
    assert.ok(errors.some((e) => e.message.includes("integration.docs[0].kind must be one of")));
  });

  it("rejects malformed workflow PR-gate expectations during compilation", () => {
    const errors = compileIntegrationPolicy({
      integration: {
        workflows: [
          {
            id: "pr-gate",
            kind: "github_actions",
            path: ".github/workflows/repo-guard.yml",
            role: "repo_guard_pr_gate",
            expect: {
              events: "pull_request",
              action: {
                uses: "",
                ref_pinning: "floating",
              },
              mode: "deploy",
              enforcement: "warn",
              permissions: {
                contents: "admin",
              },
              token_env: [],
              summary: "yes",
              disallow: ["manual_clone", "unknown_pattern"],
            },
          },
        ],
      },
    });

    assert.ok(errors.some((e) => e.message.includes("integration.workflows[0].expect.events must be an array")));
    assert.ok(errors.some((e) => e.message.includes("integration.workflows[0].expect.action.uses is required")));
    assert.ok(errors.some((e) => e.message.includes("integration.workflows[0].expect.action.ref_pinning must be one of")));
    assert.ok(errors.some((e) => e.message.includes("integration.workflows[0].expect.mode must be one of")));
    assert.ok(errors.some((e) => e.message.includes("integration.workflows[0].expect.enforcement must be one of")));
    assert.ok(errors.some((e) => e.message.includes("integration.workflows[0].expect.permissions.contents must be one of")));
    assert.ok(errors.some((e) => e.message.includes("integration.workflows[0].expect.token_env must contain at least one")));
    assert.ok(errors.some((e) => e.message.includes("integration.workflows[0].expect.summary must be a boolean")));
    assert.ok(errors.some((e) => e.message.includes("integration.workflows[0].expect.disallow[1] must be one of")));
  });

  it("rejects profile references that do not resolve to integration.profiles ids", () => {
    const errors = compileIntegrationPolicy({
      integration: {
        workflows: [
          {
            id: "pr-gate",
            kind: "github_actions",
            path: ".github/workflows/repo-guard.yml",
            role: "repo_guard_pr_gate",
            profiles: ["requirements-strict", "missing-profile"],
          },
        ],
        templates: [
          {
            id: "pull-request-template",
            kind: "markdown",
            path: ".github/PULL_REQUEST_TEMPLATE.md",
            requires_contract_block: true,
            profiles: ["missing-template-profile"],
          },
        ],
        docs: [
          {
            id: "readme",
            kind: "markdown",
            path: "README.md",
            must_mention: ["repo-guard"],
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
    });

    assert.equal(errors.length, 2);
    assert.ok(errors.some((e) => e.message.includes("missing-profile")));
    assert.ok(errors.some((e) => e.message.includes("missing-template-profile")));
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
