import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import YAML from "yaml";

const __dirname = new URL(".", import.meta.url).pathname;
const projectRoot = resolve(__dirname, "..");

function readProjectFile(path) {
  return readFileSync(resolve(projectRoot, path), "utf-8");
}

function loadWorkflow(path) {
  return YAML.parse(readProjectFile(path));
}

function loadPolicy() {
  return JSON.parse(readProjectFile("repo-policy.json"));
}

describe("repo-guard self-hosting workflow", () => {
  it("checks ready pull requests through the local reusable action in blocking mode", () => {
    const workflow = loadWorkflow(".github/workflows/ci.yml");
    const steps = workflow.jobs.validate.steps;
    const selfHostStep = steps.find((step) => step.name === "Run PR policy check");

    assert.ok(selfHostStep, "CI should include a repo-guard PR policy check");
    assert.equal(selfHostStep.uses, "./");
    assert.equal(selfHostStep.with.mode, "check-pr");
    assert.equal(selfHostStep.with.enforcement, "blocking");
    assert.match(selfHostStep.if, /pull_request/);
    assert.match(selfHostStep.if, /!github\.event\.pull_request\.draft/);
    assert.equal(selfHostStep.env.GH_TOKEN, "${{ secrets.GITHUB_TOKEN }}");
  });

  it("exercises advisory behavior intentionally in CI", () => {
    const workflow = loadWorkflow(".github/workflows/ci.yml");
    const steps = workflow.jobs.validate.steps;
    const advisoryStep = steps.find((step) => step.name === "Exercise advisory policy mode");

    assert.ok(advisoryStep, "CI should intentionally exercise advisory behavior");
    assert.match(advisoryStep.run, /--enforcement advisory check-diff/);
    assert.match(advisoryStep.run, /WARN: content-rules/);
    assert.match(advisoryStep.run, /Result: failed/);
    assert.match(advisoryStep.run, /mode: advisory/);
  });
});

describe("repo-guard self-hosting policy", () => {
  it("governs the files that define repo-guard's own enforcement surface", () => {
    const policy = loadPolicy();

    for (const expected of [
      "repo-policy.json",
      "schemas/",
      ".github/workflows/",
      ".github/PULL_REQUEST_TEMPLATE.md",
      ".github/ISSUE_TEMPLATE/",
      "templates/",
      "action.yml",
    ]) {
      assert.ok(
        policy.paths.governance_paths.includes(expected),
        `expected governance_paths to include ${expected}`,
      );
    }
  });

  it("does not treat GitHub workflow and template files as operational escapes", () => {
    const policy = loadPolicy();
    const operational = policy.paths.operational_paths || [];

    assert.equal(operational.some((path) => path.startsWith(".github/")), false);
  });

  it("declares its own repo-guard integration surface", () => {
    const policy = loadPolicy();
    const integration = policy.integration;

    assert.ok(integration, "self policy should declare integration metadata");
    assert.equal(integration.workflows[0].path, ".github/workflows/ci.yml");
    assert.equal(integration.workflows[0].role, "repo_guard_pr_gate");
    assert.ok(
      integration.templates.some((template) => template.path === ".github/PULL_REQUEST_TEMPLATE.md"),
      "expected PR template to be declared",
    );
    assert.ok(
      integration.templates.some((template) => template.path === ".github/ISSUE_TEMPLATE/change-contract.yml"),
      "expected issue form to be declared",
    );
    assert.equal(integration.docs[0].path, "README.md");
    assert.equal(integration.profiles[0].id, "self-hosting");
  });
});

describe("repo-guard self-hosting templates and docs", () => {
  it("internal PR template requires a repo-guard YAML contract", () => {
    const template = readProjectFile(".github/PULL_REQUEST_TEMPLATE.md");

    assert.match(template, /```repo-guard-yaml/);
    assert.match(template, /must_touch:/);
    assert.match(template, /must_not_touch:/);
    assert.match(template, /expected_effects:/);
  });

  it("README documents what self-hosted paths are governed and why", () => {
    const readme = readProjectFile("README.md");

    assert.match(readme, /## Самопроверка репозитория/);
    assert.match(readme, /управляющие пути/);
    assert.match(readme, /\.github\/workflows\//);
    assert.match(readme, /action\.yml/);
    assert.match(readme, /repo-policy\.json/);
    assert.match(readme, /templates\//);
  });

  it("README links the downstream migration guide and examples", () => {
    const readme = readProjectFile("README.md");

    assert.match(readme, /docs\/removing-bespoke-validators\.md/);
    assert.match(readme, /examples\/downstream-integration-policy\.json/);
    assert.match(readme, /examples\/replace-custom-validator-workflow\.yml/);
  });

  it("README links the self-hosting coverage matrix", () => {
    const readme = readProjectFile("README.md");

    assert.match(readme, /docs\/self-hosting-coverage\.md/);
    assert.match(readme, /docs\/self-hosting-coverage\.json/);
  });

  it("migration guide maps custom validators to built-in integration policy", () => {
    const guide = readProjectFile("docs/removing-bespoke-validators.md");

    assert.match(guide, /## Migration Sequence/);
    assert.match(guide, /Delete the custom validator/);
    assert.match(guide, /integration\.workflows/);
    assert.match(guide, /integration\.templates/);
    assert.match(guide, /integration\.docs/);
    assert.match(guide, /requirements-strict/);
    assert.match(guide, /examples\/downstream-integration-policy\.json/);
    assert.match(guide, /examples\/replace-custom-validator-workflow\.yml/);
  });
});

describe("repo-guard self-hosting capability coverage matrix", () => {
  const coverage = JSON.parse(readProjectFile("docs/self-hosting-coverage.json"));
  const policy = loadPolicy();
  const ciWorkflow = loadWorkflow(".github/workflows/ci.yml");
  const ciSteps = ciWorkflow.jobs.validate.steps;
  const ciStepNames = new Set(ciSteps.map((step) => step.name).filter(Boolean));

  function requireSelfUse(entry, { validator }) {
    assert.equal(entry.status, "self_used", `expected self_used, got ${entry.status}`);
    assert.ok(entry.self_use, "self_used entry must declare a concrete self_use reference");
    validator(entry);
  }

  function requireNotSelfHosted(entry) {
    assert.equal(entry.status, "not_self_hosted");
    assert.ok(
      typeof entry.rationale === "string" && entry.rationale.trim().length > 0,
      "not_self_hosted entry must carry a non-empty rationale",
    );
  }

  function requirePolicyKey(keys) {
    let cursor = policy;
    for (const key of keys) {
      assert.ok(
        cursor !== null && typeof cursor === "object" && Object.prototype.hasOwnProperty.call(cursor, key),
        `policy is missing key ${keys.join(".")}`,
      );
      cursor = cursor[key];
    }
    return cursor;
  }

  function requireCiStep(stepName) {
    assert.ok(
      ciStepNames.has(stepName),
      `CI workflow is missing step "${stepName}"; existing steps: ${[...ciStepNames].join(", ")}`,
    );
  }

  it("has a populated capabilities section", () => {
    assert.ok(coverage.capabilities, "coverage matrix must declare capabilities");
    const groups = Object.keys(coverage.capabilities);
    for (const group of [
      "top_level_commands",
      "enforcement_modes",
      "contract_extraction",
      "integration_checks",
      "rule_families",
    ]) {
      assert.ok(groups.includes(group), `coverage matrix must include group ${group}`);
    }
  });

  it("every entry declares a valid status", () => {
    for (const [group, entries] of Object.entries(coverage.capabilities)) {
      for (const [id, entry] of Object.entries(entries)) {
        assert.ok(
          entry.status === "self_used" || entry.status === "not_self_hosted",
          `${group}.${id} has unknown status "${entry.status}"`,
        );
        if (entry.status === "self_used") {
          assert.ok(
            entry.self_use,
            `${group}.${id} is self_used but has no self_use reference`,
          );
        } else {
          assert.ok(
            typeof entry.rationale === "string" && entry.rationale.trim().length > 0,
            `${group}.${id} is not_self_hosted but has no rationale`,
          );
        }
      }
    }
  });

  it("top-level CLI commands map to real CI steps or integration tests", () => {
    const commands = coverage.capabilities.top_level_commands;
    requireSelfUse(commands.validate, {
      validator: () => requireCiStep("Validate repo-policy.json"),
    });
    requireSelfUse(commands["check-pr"], {
      validator: () => requireCiStep("Run PR policy check"),
    });
    requireSelfUse(commands["check-diff"], {
      validator: () => requireCiStep("Exercise advisory policy mode"),
    });
    requireSelfUse(commands.doctor, {
      validator: () => requireCiStep("Run doctor diagnostics on self"),
    });
    requireSelfUse(commands["validate-integration"], {
      validator: () => requireCiStep("Run validate-integration on self"),
    });
    requireSelfUse(commands.init, {
      validator: (entry) => {
        assert.match(entry.self_use, /tests\/test-init\.mjs/);
      },
    });
  });

  it("enforcement modes are both exercised", () => {
    const modes = coverage.capabilities.enforcement_modes;
    requireSelfUse(modes.blocking, {
      validator: () => {
        assert.equal(policy.enforcement?.mode, "blocking");
      },
    });
    requireSelfUse(modes.advisory, {
      validator: () => requireCiStep("Exercise advisory policy mode"),
    });
  });

  it("every integration check is declared in repo-policy.json", () => {
    const integration = coverage.capabilities.integration_checks;
    requireSelfUse(integration["integration.workflows"], {
      validator: () => {
        const workflows = requirePolicyKey(["integration", "workflows"]);
        assert.ok(Array.isArray(workflows) && workflows.length > 0);
      },
    });
    requireSelfUse(integration["integration.templates[markdown]"], {
      validator: () => {
        const templates = requirePolicyKey(["integration", "templates"]);
        assert.ok(
          templates.some((t) => t.kind === "markdown"),
          "expected at least one markdown integration template",
        );
      },
    });
    requireSelfUse(integration["integration.templates[github_issue_form]"], {
      validator: () => {
        const templates = requirePolicyKey(["integration", "templates"]);
        assert.ok(
          templates.some((t) => t.kind === "github_issue_form"),
          "expected at least one github_issue_form integration template",
        );
      },
    });
    requireSelfUse(integration["integration.docs"], {
      validator: () => {
        const docs = requirePolicyKey(["integration", "docs"]);
        assert.ok(Array.isArray(docs) && docs.length > 0);
      },
    });
    requireSelfUse(integration["integration.profiles"], {
      validator: () => {
        const profiles = requirePolicyKey(["integration", "profiles"]);
        assert.ok(Array.isArray(profiles) && profiles.length > 0);
      },
    });
  });

  it("self-used rule families are declared in repo-policy.json", () => {
    const rules = coverage.capabilities.rule_families;
    requireSelfUse(rules["forbidden-paths"], {
      validator: () => {
        const forbidden = requirePolicyKey(["paths", "forbidden"]);
        assert.ok(Array.isArray(forbidden) && forbidden.length > 0);
      },
    });
    requireSelfUse(rules.diff_rules_budgets, {
      validator: () => {
        const diffRules = requirePolicyKey(["diff_rules"]);
        assert.ok(typeof diffRules.max_new_docs === "number");
        assert.ok(typeof diffRules.max_new_files === "number");
        assert.ok(typeof diffRules.max_net_added_lines === "number");
      },
    });
    requireSelfUse(rules["content-rules"], {
      validator: () => {
        const contentRules = requirePolicyKey(["content_rules"]);
        assert.ok(Array.isArray(contentRules) && contentRules.length > 0);
      },
    });
    requireSelfUse(rules["cochange-rules"], {
      validator: () => {
        const cochange = requirePolicyKey(["cochange_rules"]);
        assert.ok(Array.isArray(cochange) && cochange.length > 0);
      },
    });
    requireSelfUse(rules.surfaces, {
      validator: () => {
        const surfaces = requirePolicyKey(["surfaces"]);
        assert.ok(
          surfaces && typeof surfaces === "object" && Object.keys(surfaces).length > 0,
          "policy.surfaces must declare at least one named surface",
        );
      },
    });
    requireSelfUse(rules.new_file_classes, {
      validator: () => {
        const classes = requirePolicyKey(["new_file_classes"]);
        assert.ok(
          classes && typeof classes === "object" && Object.keys(classes).length > 0,
          "policy.new_file_classes must declare at least one class",
        );
      },
    });
    requireSelfUse(rules.change_profiles, {
      validator: () => {
        const profiles = requirePolicyKey(["change_profiles"]);
        assert.ok(
          profiles && typeof profiles === "object" && Object.keys(profiles).length > 0,
          "policy.change_profiles must declare at least one profile",
        );
      },
    });
    requireSelfUse(rules.size_rules, {
      validator: () => {
        const sizeRules = requirePolicyKey(["size_rules"]);
        assert.ok(Array.isArray(sizeRules) && sizeRules.length > 0);
      },
    });

    requireNotSelfHosted(rules.registry_rules);
    requireNotSelfHosted(rules.advisory_text_rules);
    requireNotSelfHosted(rules.anchors);
    requireNotSelfHosted(rules.trace_rules);
    requireNotSelfHosted(rules["profile_requirements-strict"]);
  });

  it("contract extraction paths are either exercised or explicitly skipped", () => {
    const extraction = coverage.capabilities.contract_extraction;
    requireSelfUse(extraction["repo-guard-yaml_in_pr_body"], {
      validator: () => {
        const template = readProjectFile(".github/PULL_REQUEST_TEMPLATE.md");
        assert.match(template, /```repo-guard-yaml/);
      },
    });
    requireSelfUse(extraction["repo-guard-yaml_in_linked_issue"], {
      validator: () => {
        const form = readProjectFile(".github/ISSUE_TEMPLATE/change-contract.yml");
        assert.match(form, /repo-guard-yaml/);
      },
    });
    requireNotSelfHosted(extraction["repo-guard-json_in_pr_body"]);
  });

  it("every top-level policy schema property has a matching coverage entry", () => {
    const schema = JSON.parse(readProjectFile("schemas/repo-policy.schema.json"));
    const schemaProps = Object.keys(schema.properties);
    // Structural policy fields that don't map one-to-one to capabilities.
    const structural = new Set([
      "policy_format_version",
      "repository_kind",
      "enforcement",
      "integration",
      "paths",
      "diff_rules",
      "content_rules",
      "cochange_rules",
    ]);

    const ruleFamilies = coverage.capabilities.rule_families;
    const mapped = new Set([
      "surfaces",
      "new_file_classes",
      "change_profiles",
      "size_rules",
      "registry_rules",
      "advisory_text_rules",
      "anchors",
      "trace_rules",
      "profile",
      "profile_overrides",
    ]);

    for (const property of schemaProps) {
      if (structural.has(property)) continue;
      assert.ok(
        mapped.has(property),
        `schema property "${property}" is not acknowledged by the coverage matrix; add it to rule_families or to the structural allow-list`,
      );
    }

    // Spot-check a few concrete mappings instead of trusting only the allow-list.
    assert.ok(ruleFamilies.surfaces);
    assert.ok(ruleFamilies.new_file_classes);
    assert.ok(ruleFamilies.change_profiles);
    assert.ok(ruleFamilies.size_rules);
    assert.ok(ruleFamilies.registry_rules);
    assert.ok(ruleFamilies.advisory_text_rules);
    assert.ok(ruleFamilies.anchors);
    assert.ok(ruleFamilies.trace_rules);
    assert.ok(ruleFamilies["profile_requirements-strict"]);
  });
});
