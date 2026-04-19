import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { extractContract, extractLinkedIssueNumbers, resolveContract } from "../src/markdown-contract.mjs";

const __dirname = new URL(".", import.meta.url).pathname;
const projectRoot = resolve(__dirname, "..");

let failures = 0;

function expect(label, actual, expected) {
  const passed = actual === expected;
  console.log(`${passed ? "PASS" : "FAIL"}: ${label}`);
  if (!passed) {
    failures++;
    console.error(`  expected: ${JSON.stringify(expected)}, got: ${JSON.stringify(actual)}`);
  }
}

// --- extractContract ---

const validMarkdown = `
## My PR

Some description here.

\`\`\`repo-guard-yaml
change_type: bugfix
scope:
  - src/app.mjs
budgets: {}
must_touch:
  - src/app.mjs
must_not_touch: []
expected_effects:
  - Fix crash
\`\`\`

More text after.
`;

const validJsonMarkdown = `
## My PR

Some description here.

\`\`\`repo-guard-json
{
  "change_type": "bugfix",
  "scope": ["src/app.mjs"],
  "budgets": {},
  "must_touch": ["src/app.mjs"],
  "must_not_touch": [],
  "expected_effects": ["Fix crash"]
}
\`\`\`

More text after.
`;

const yamlAnchorsMarkdown = `
## My PR

\`\`\`repo-guard-yaml
change_type: feature
scope:
  - src/app.mjs
budgets: {}
anchors:
  affects:
    - FR-014
  implements:
    - FR-014
  verifies:
    - FR-014
must_touch:
  - src/app.mjs
must_not_touch: []
expected_effects:
  - Implement anchor-aware contracts
\`\`\`
`;

const jsonAnchorsMarkdown = `
## My PR

\`\`\`repo-guard-json
{
  "change_type": "feature",
  "scope": ["src/app.mjs"],
  "budgets": {},
  "anchors": {
    "affects": ["FR-014"],
    "implements": ["FR-014"],
    "verifies": ["FR-014"]
  },
  "must_touch": ["src/app.mjs"],
  "must_not_touch": [],
  "expected_effects": ["Implement anchor-aware contracts"]
}
\`\`\`
`;

{
  const result = extractContract(validMarkdown);
  expect("valid markdown: ok", result.ok, true);
  expect("valid markdown: change_type", result.contract?.change_type, "bugfix");
  expect("valid markdown: scope length", result.contract?.scope?.length, 1);
}

{
  const template = readFileSync(resolve(projectRoot, ".github/PULL_REQUEST_TEMPLATE.md"), "utf-8");
  const result = extractContract(template);
  expect("repo PR template self-hosts YAML contract: ok", result.ok, true);
  expect("repo PR template self-hosts YAML contract: change_type", result.contract?.change_type, "feature");
}

{
  const template = readFileSync(resolve(projectRoot, ".github/ISSUE_TEMPLATE/change-contract.yml"), "utf-8");
  const result = extractContract(template);
  expect("repo issue template self-hosts YAML contract: ok", result.ok, true);
  expect("repo issue template self-hosts YAML contract: change_type", result.contract?.change_type, "feature");
}

{
  const result = extractContract(validJsonMarkdown);
  expect("valid JSON markdown remains supported: ok", result.ok, true);
  expect("valid JSON markdown remains supported: change_type", result.contract?.change_type, "bugfix");
}

{
  const result = extractContract(yamlAnchorsMarkdown);
  expect("YAML markdown with anchors remains supported: ok", result.ok, true);
  expect("YAML markdown with anchors: affects", result.contract?.anchors?.affects?.join(","), "FR-014");
  expect("YAML markdown with anchors: implements", result.contract?.anchors?.implements?.join(","), "FR-014");
  expect("YAML markdown with anchors: verifies", result.contract?.anchors?.verifies?.join(","), "FR-014");
}

{
  const result = extractContract(jsonAnchorsMarkdown);
  expect("JSON markdown with anchors remains supported: ok", result.ok, true);
  expect("JSON markdown with anchors: affects", result.contract?.anchors?.affects?.join(","), "FR-014");
  expect("JSON markdown with anchors: implements", result.contract?.anchors?.implements?.join(","), "FR-014");
  expect("JSON markdown with anchors: verifies", result.contract?.anchors?.verifies?.join(","), "FR-014");
}

{
  const result = extractContract("No contract block here");
  expect("no block: ok", result.ok, false);
  expect("no block: error", result.error, "contract_not_found");
}

{
  const md = `
\`\`\`repo-guard-json
{ invalid json
\`\`\`
`;
  const result = extractContract(md);
  expect("invalid JSON: ok", result.ok, false);
  expect("invalid JSON: error", result.error, "contract_malformed_json");
}

{
  const md = `
\`\`\`repo-guard-yaml
change_type: [unterminated
\`\`\`
`;
  const result = extractContract(md);
  expect("invalid YAML: ok", result.ok, false);
  expect("invalid YAML: error", result.error, "contract_malformed_yaml");
}

{
  const md = `
\`\`\`repo-guard-json
{"change_type": "bugfix", "scope": ["a"], "budgets": {}, "must_touch": [], "must_not_touch": [], "expected_effects": []}
\`\`\`

\`\`\`repo-guard-json
{"change_type": "feature", "scope": ["b"], "budgets": {}, "must_touch": [], "must_not_touch": [], "expected_effects": []}
\`\`\`
`;
  const result = extractContract(md);
  expect("multiple blocks: ok", result.ok, false);
  expect("multiple blocks: error", result.error, "multiple_contracts");
}

{
  const md = `
\`\`\`repo-guard-yaml
change_type: bugfix
scope: ["a"]
budgets: {}
must_touch: []
must_not_touch: []
expected_effects: []
\`\`\`

\`\`\`repo-guard-json
{"change_type": "feature", "scope": ["b"], "budgets": {}, "must_touch": [], "must_not_touch": [], "expected_effects": []}
\`\`\`
`;
  const result = extractContract(md);
  expect("multiple mixed blocks: ok", result.ok, false);
  expect("multiple mixed blocks: error", result.error, "multiple_contracts");
}

{
  const result = extractContract(null);
  expect("null input: ok", result.ok, false);
  expect("null input: error", result.error, "contract_not_found");
}

{
  const result = extractContract("");
  expect("empty input: ok", result.ok, false);
}

{
  const md = `
Some text

\`\`\`json
{"change_type": "bugfix"}
\`\`\`
`;
  const result = extractContract(md);
  expect("plain json block ignored: ok", result.ok, false);
  expect("plain json block ignored: error", result.error, "contract_not_found");
}

// --- extractLinkedIssueNumbers ---

expect("fixes #5", extractLinkedIssueNumbers("Fixes #5").join(","), "5");
expect("closes #12", extractLinkedIssueNumbers("Closes #12").join(","), "12");
expect("resolves #3", extractLinkedIssueNumbers("Resolves #3").join(","), "3");
expect("multiple links", extractLinkedIssueNumbers("Fixes #1\nCloses #2").join(","), "1,2");
expect("no links", extractLinkedIssueNumbers("Just a normal description").join(","), "");
expect("null input", extractLinkedIssueNumbers(null).join(","), "");
expect("dedup", extractLinkedIssueNumbers("Fixes #5\nCloses #5").join(","), "5");
expect("qualified ref owner/repo#N", extractLinkedIssueNumbers("Fixes netkeep80/repo-guard#11").join(","), "11");
expect("qualified ref mixed", extractLinkedIssueNumbers("Fixes owner/repo#7\nCloses #3").join(","), "7,3");

// --- resolveContract ---

const validPRBody = validMarkdown;
const validIssueBody = `
Issue description

\`\`\`repo-guard-yaml
change_type: feature
scope:
  - src/new.mjs
budgets:
  max_new_files: 3
must_touch: []
must_not_touch: []
expected_effects:
  - New feature
\`\`\`
`;

{
  const result = resolveContract(validPRBody, validIssueBody);
  expect("resolve: PR body wins", result.ok, true);
  expect("resolve: PR body change_type", result.contract?.change_type, "bugfix");
}

{
  const result = resolveContract("No contract here", validIssueBody);
  expect("resolve: issue fallback", result.ok, true);
  expect("resolve: issue change_type", result.contract?.change_type, "feature");
}

{
  const result = resolveContract("No contract", "Also no contract");
  expect("resolve: both missing", result.ok, false);
  expect("resolve: both missing error", result.error, "fallback_missing");
}

{
  const result = resolveContract("No contract", null);
  expect("resolve: no issue body", result.ok, false);
  expect("resolve: no issue body error", result.error, "contract_not_found");
}

{
  const badJsonPR = `
\`\`\`repo-guard-json
{ bad json
\`\`\`
`;
  const result = resolveContract(badJsonPR, validIssueBody);
  expect("resolve: PR malformed, no fallback", result.ok, false);
  expect("resolve: PR malformed error", result.error, "contract_malformed_json");
}

console.log(`\n${failures === 0 ? "All tests passed" : `${failures} test(s) failed`}`);
process.exit(failures === 0 ? 0 : 1);
