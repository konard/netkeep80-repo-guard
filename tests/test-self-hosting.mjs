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

    assert.match(readme, /## Self-hosting/);
    assert.match(readme, /\.github\/workflows\//);
    assert.match(readme, /action\.yml/);
    assert.match(readme, /repo-policy\.json/);
    assert.match(readme, /templates\//);
  });
});
