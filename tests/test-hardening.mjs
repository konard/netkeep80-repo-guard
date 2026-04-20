import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  checkRemovedContractFields,
  checkRemovedPolicyFields,
  compileAnchorPolicy,
  compileChangeProfiles,
  compileForbidRegex,
  compileIntegrationPolicy,
  warnReservedContractFields,
  warnReservedPolicyFields,
} from "../src/policy-compiler.mjs";
import { checkMustTouch } from "../src/checks/rules/contract-rules.mjs";
import { checkIssueFallbackPrerequisites, checkPrerequisites } from "../src/github-pr.mjs";

// Build test patterns without triggering the no-todo-without-issue content rule
const td = "TO" + "DO"; // eslint-disable-line prefer-template
const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const repoGuard = resolve(projectRoot, "src/repo-guard.mjs");

function runRepoGuard(args, opts = {}) {
  return spawnSync(process.execPath, [repoGuard, ...args], {
    cwd: opts.cwd || projectRoot,
    env: opts.env || process.env,
    encoding: "utf-8",
  });
}

function initTinyRepo(prefix) {
  const tmp = mkdtempSync(join(tmpdir(), prefix));
  execSync("git init", { cwd: tmp, stdio: "pipe" });
  execSync("git config user.email test@test.com", { cwd: tmp, stdio: "pipe" });
  execSync("git config user.name Test", { cwd: tmp, stdio: "pipe" });

  const policy = {
    policy_format_version: "0.1.0",
    repository_kind: "library",
    paths: {
      forbidden: [],
      canonical_docs: ["README.md"],
      governance_paths: ["repo-policy.json"],
    },
    diff_rules: { max_new_docs: 5, max_new_files: 20, max_net_added_lines: 500 },
    content_rules: [],
    cochange_rules: [],
  };
  writeFileSync(join(tmp, "repo-policy.json"), JSON.stringify(policy));
  writeFileSync(join(tmp, "a.txt"), "a\nb\n");
  execSync("git add -A", { cwd: tmp, stdio: "pipe" });
  execSync("git commit -m init", { cwd: tmp, stdio: "pipe" });

  writeFileSync(join(tmp, "a.txt"), "a\n");
  execSync("git add -A", { cwd: tmp, stdio: "pipe" });
  execSync("git commit -m second", { cwd: tmp, stdio: "pipe" });

  return tmp;
}

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

describe("change_profiles compilation", () => {
  it("accepts profiles that reference declared surfaces and new-file classes", () => {
    const errors = compileChangeProfiles({
      surfaces: {
        kernel: ["src/**"],
        tests: ["tests/**"],
      },
      new_file_classes: {
        test: ["tests/**"],
        changelog_fragment: ["changelog.d/*.md"],
      },
      change_profiles: {
        feature: {
          allow_surfaces: ["kernel", "tests"],
          forbid_surfaces: [],
          new_files: {
            allow_classes: ["test", "changelog_fragment"],
            max_per_class: { test: 2 },
          },
        },
      },
    });
    assert.equal(errors.length, 0);
  });

  it("rejects profiles that reference unknown surfaces", () => {
    const errors = compileChangeProfiles({
      surfaces: {
        docs: ["docs/**"],
      },
      change_profiles: {
        docs: {
          allow_surfaces: ["docs", "kernel"],
          forbid_surfaces: ["generated"],
        },
      },
    });
    assert.equal(errors.length, 2);
    assert.ok(errors.some((e) => e.message.includes("kernel")));
    assert.ok(errors.some((e) => e.message.includes("generated")));
  });

  it("rejects surfaces listed in both allow_surfaces and forbid_surfaces", () => {
    const errors = compileChangeProfiles({
      surfaces: {
        docs: ["docs/**"],
      },
      change_profiles: {
        docs: {
          allow_surfaces: ["docs"],
          forbid_surfaces: ["docs"],
        },
      },
    });
    assert.equal(errors.length, 1);
    assert.ok(errors[0].message.includes("both allow_surfaces and forbid_surfaces"));
  });

  it("rejects new_files with unknown class references", () => {
    const errors = compileChangeProfiles({
      surfaces: { kernel: ["src/**"] },
      new_file_classes: {
        test: ["tests/**"],
      },
      change_profiles: {
        feature: {
          allow_surfaces: ["kernel"],
          new_files: {
            allow_classes: ["test", "generated"],
            max_per_class: { changelog_fragment: 1 },
          },
        },
      },
    });
    assert.equal(errors.length, 2);
    assert.ok(errors.some((e) => e.message.includes("generated")));
    assert.ok(errors.some((e) => e.message.includes("changelog_fragment")));
  });

  it("requires explicit allow_classes in every new_files block", () => {
    const errors = compileChangeProfiles({
      surfaces: { kernel: ["src/**"] },
      new_file_classes: { test: ["tests/**"] },
      change_profiles: {
        feature: {
          allow_surfaces: ["kernel"],
          new_files: {
            max_per_class: { test: 1 },
          },
        },
      },
    });
    assert.equal(errors.length, 1);
    assert.ok(errors[0].message.includes("allow_classes is required"));
  });

  it("accepts empty allow_classes as explicit deny-all semantics", () => {
    const errors = compileChangeProfiles({
      surfaces: { docs: ["docs/**"] },
      new_file_classes: { test: ["tests/**"] },
      change_profiles: {
        docs: {
          allow_surfaces: ["docs"],
          new_files: {
            allow_classes: [],
          },
        },
      },
    });
    assert.equal(errors.length, 0);
  });

  it("keeps policies without change_profiles compatible", () => {
    const errors = compileChangeProfiles({ surfaces: { kernel: ["src/**"] } });
    assert.equal(errors.length, 0);
  });
});

describe("removed DSL defense-in-depth", () => {
  it("rejects removed policy fields with actionable errors", () => {
    const errors = checkRemovedPolicyFields({
      change_classes: ["kernel-hardening"],
      surface_matrix: { "kernel-hardening": { allow: [] } },
      new_file_rules: { "kernel-hardening": { allow_classes: [] } },
      change_type_rules: { feature: {} },
      allow_unclassified_files: true,
    });
    assert.equal(errors.length, 5);
    const fields = errors.map((e) => e.field).sort();
    assert.deepEqual(fields, [
      "allow_unclassified_files",
      "change_classes",
      "change_type_rules",
      "new_file_rules",
      "surface_matrix",
    ]);
    for (const error of errors) {
      assert.ok(error.message.includes("was removed"));
      assert.ok(error.message.includes("change_profiles"));
    }
  });

  it("rejects removed contract fields with actionable errors", () => {
    const errors = checkRemovedContractFields({
      change_type: "feature",
      change_class: "kernel-hardening",
    });
    assert.equal(errors.length, 1);
    assert.equal(errors[0].field, "change_class");
    assert.ok(errors[0].message.includes("change_type"));
  });

  it("returns no errors when the old fields are absent", () => {
    assert.equal(checkRemovedPolicyFields({ change_profiles: {} }).length, 0);
    assert.equal(checkRemovedContractFields({ change_type: "feature" }).length, 0);
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
            optional: true,
            required_block_kind: "repo-guard-yaml",
            required_contract_fields: ["change_type", "scope", "anchors.affects"],
            profiles: ["requirements-strict"],
          },
        ],
        docs: [
          {
            id: "readme",
            kind: "markdown",
            path: "README.md",
            must_mention: ["repo-guard"],
            must_reference_files: ["repo-policy.json"],
            must_mention_profiles: ["requirements-strict"],
            must_mention_contract_fields: ["anchors.affects"],
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

  it("rejects malformed generalized template and doc integration rules", () => {
    const errors = compileIntegrationPolicy({
      integration: {
        templates: [
          {
            id: "pull-request-template",
            kind: "markdown",
            path: ".github/PULL_REQUEST_TEMPLATE.md",
            requires_contract_block: true,
            optional: "yes",
            required_block_kind: "repo-guard-xml",
            required_contract_fields: ["change_type", ""],
          },
        ],
        docs: [
          {
            id: "readme",
            kind: "markdown",
            path: "README.md",
            must_mention: ["repo-guard"],
            must_reference_files: [],
            must_mention_profiles: ["missing-profile"],
            must_mention_contract_fields: [""],
          },
        ],
        profiles: [],
      },
    });

    assert.ok(errors.some((e) => e.message.includes("integration.templates[0].optional must be a boolean")));
    assert.ok(errors.some((e) => e.message.includes("integration.templates[0].required_block_kind must be one of")));
    assert.ok(errors.some((e) => e.message.includes("integration.templates[0].required_contract_fields[1] must be a non-empty string")));
    assert.ok(errors.some((e) => e.message.includes("integration.docs[0].must_reference_files must contain at least one")));
    assert.ok(errors.some((e) => e.message.includes("integration.docs[0].must_mention_contract_fields[0] must be a non-empty string")));
    assert.ok(errors.some((e) => e.message.includes("missing-profile")));
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

  it("requires git but not gh at startup", () => {
    const missing = checkPrerequisites();
    const gitMissing = missing.some((m) => m.includes("git CLI"));
    const ghMissing = missing.some((m) => m.includes("gh CLI"));
    assert.equal(gitMissing, false, "git should be available");
    assert.equal(ghMissing, false, "gh is only needed for linked issue fallback");
  });

  it("does not report gh missing before linked-issue fallback is needed", () => {
    const tmp = mkdtempSync(join(tmpdir(), "rg-no-gh-prereq-"));
    const fakeGit = join(tmp, "git");
    writeFileSync(fakeGit, "#!/bin/sh\nprintf 'git version 2.0.0\\n'\n");
    chmodSync(fakeGit, 0o755);

    const originalPath = process.env.PATH;
    const originalEvent = process.env.GITHUB_EVENT_PATH;
    process.env.PATH = tmp;
    process.env.GITHUB_EVENT_PATH = join(tmp, "event.json");
    try {
      const missing = checkPrerequisites();
      assert.equal(missing.some((m) => m.includes("git CLI")), false);
      assert.equal(missing.some((m) => m.includes("gh CLI")), false);
      assert.equal(checkIssueFallbackPrerequisites().some((m) => m.includes("gh CLI")), true);
    } finally {
      process.env.PATH = originalPath;
      if (originalEvent !== undefined) process.env.GITHUB_EVENT_PATH = originalEvent;
      else delete process.env.GITHUB_EVENT_PATH;
      rmSync(tmp, { recursive: true });
    }
  });
});

describe("check-diff command execution hardening", () => {
  it("passes shell-looking refs as git arguments without executing them", () => {
    const tmp = initTinyRepo("rg-ref-injection-diff-");
    try {
      const marker = join(tmp, "check-diff-injected");
      const result = runRepoGuard([
        "check-diff",
        "--repo-root",
        tmp,
        "--base",
        `HEAD~1; touch ${marker}; #`,
        "--head",
        "HEAD",
      ]);
      const output = `${result.stdout || ""}${result.stderr || ""}`;

      assert.equal(result.status, 1);
      assert.match(output, /git diff failed/);
      assert.equal(existsSync(marker), false);
    } finally {
      rmSync(tmp, { recursive: true });
    }
  });
});
