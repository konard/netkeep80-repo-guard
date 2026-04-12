import {
  parseDiff,
  checkForbiddenPaths,
  checkCanonicalDocsBudget,
  checkNewFilesBudget,
  checkNetAddedLinesBudget,
  checkCochangeRules,
  checkContentRules,
  checkMustTouch,
  checkMustNotTouch,
} from "../src/diff-checker.mjs";

let failures = 0;

function expect(label, actual, expected) {
  const passed = actual === expected;
  console.log(`${passed ? "PASS" : "FAIL"}: ${label}`);
  if (!passed) {
    failures++;
    console.error(`  expected: ${expected}, got: ${actual}`);
  }
}

// --- parseDiff ---

const sampleDiff = [
  "diff --git a/src/app.mjs b/src/app.mjs",
  "new file mode 100644",
  "--- /dev/null",
  "+++ b/src/app.mjs",
  "+console.log('hello');",
  "+console.log('world');",
  "diff --git a/README.md b/README.md",
  "--- a/README.md",
  "+++ b/README.md",
  "-Old line in readme",
  "+New line in readme",
  "diff --git a/old.bak b/old.bak",
  "deleted file mode 100644",
  "--- a/old.bak",
  "+++ /dev/null",
  "-old content",
].join("\n");

const files = parseDiff(sampleDiff);
expect("parseDiff: file count", files.length, 3);
expect("parseDiff: new file status", files[0].status, "added");
expect("parseDiff: modified file status", files[1].status, "modified");
expect("parseDiff: deleted file status", files[2].status, "deleted");
expect("parseDiff: added lines count", files[0].addedLines.length, 2);
expect("parseDiff: deleted lines count (modified)", files[1].deletedLines.length, 1);
expect("parseDiff: deleted lines count (deleted file)", files[2].deletedLines.length, 1);

// --- 1. Valid diff passes ---

const validFiles = [
  { path: "src/utils.mjs", addedLines: ["const x = 1;"], deletedLines: [], status: "modified" },
  { path: "tests/test-utils.mjs", addedLines: ["assert(true);"], deletedLines: [], status: "added" },
];

const forbiddenPatterns = ["*.bak", "docs/phase-*"];
expect("1. valid diff: no forbidden paths", checkForbiddenPaths(validFiles, forbiddenPatterns).length, 0);
expect("1. valid diff: docs budget ok", checkCanonicalDocsBudget(validFiles, ["README.md"], 2).ok, true);
expect("1. valid diff: new files budget ok", checkNewFilesBudget(validFiles, 5).ok, true);
expect("1. valid diff: net added lines ok", checkNetAddedLinesBudget(validFiles, 100).ok, true);

const cochangeRules = [{ if_changed: ["src/**"], must_change_any: ["tests/**"] }];
expect("1. valid diff: cochange satisfied", checkCochangeRules(validFiles, cochangeRules).length, 0);

// --- 2. Forbidden path fails ---

const forbiddenFiles = [
  { path: "backup.bak", addedLines: ["data"], status: "added" },
  { path: "src/main.mjs", addedLines: [], status: "modified" },
];

const forbiddenResult = checkForbiddenPaths(forbiddenFiles, forbiddenPatterns);
expect("2. forbidden path detected", forbiddenResult.length, 1);
expect("2. forbidden path file", forbiddenResult[0], "backup.bak");

const forbiddenFiles2 = [
  { path: "docs/phase-1.md", addedLines: ["plan"], status: "added" },
];
expect("2. forbidden glob pattern", checkForbiddenPaths(forbiddenFiles2, forbiddenPatterns).length, 1);

// deleted files should not trigger forbidden
const deletedForbidden = [
  { path: "backup.bak", addedLines: [], status: "deleted" },
];
expect("2. deleted forbidden path ignored", checkForbiddenPaths(deletedForbidden, forbiddenPatterns).length, 0);

// --- 3. Max new docs exceeded ---

const manyDocsFiles = [
  { path: "docs/guide.md", addedLines: ["# Guide"], status: "added" },
  { path: "docs/faq.md", addedLines: ["# FAQ"], status: "added" },
  { path: "docs/changelog.md", addedLines: ["# Changelog"], status: "added" },
];

const docsResult = checkCanonicalDocsBudget(manyDocsFiles, ["README.md"], 2);
expect("3. max new docs exceeded", docsResult.ok, false);
expect("3. max new docs actual", docsResult.actual, 3);
expect("3. max new docs limit", docsResult.limit, 2);

// canonical docs don't count against budget
const canonicalFiles = [
  { path: "README.md", addedLines: ["# Readme"], status: "added" },
  { path: "docs/extra.md", addedLines: ["# Extra"], status: "added" },
];
const canonicalResult = checkCanonicalDocsBudget(canonicalFiles, ["README.md"], 1);
expect("3. canonical doc excluded from count", canonicalResult.ok, true);

// --- 4. Max net added lines exceeded ---

const manyLinesFiles = [
  { path: "src/big.mjs", addedLines: new Array(101).fill("line"), deletedLines: [], status: "added" },
];

const linesResult = checkNetAddedLinesBudget(manyLinesFiles, 100);
expect("4. max net added lines exceeded", linesResult.ok, false);
expect("4. net added lines actual", linesResult.actual, 101);

const exactLinesFiles = [
  { path: "src/exact.mjs", addedLines: new Array(100).fill("line"), deletedLines: [], status: "added" },
];
expect("4. exact budget passes", checkNetAddedLinesBudget(exactLinesFiles, 100).ok, true);

// net = added - deleted: 80 added, 30 deleted => net 50, within budget of 60
const netFiles = [
  { path: "src/refactor.mjs", addedLines: new Array(80).fill("new"), deletedLines: new Array(30).fill("old"), status: "modified" },
];
expect("4. net lines (added-deleted) within budget", checkNetAddedLinesBudget(netFiles, 60).ok, true);
expect("4. net lines actual is 50", checkNetAddedLinesBudget(netFiles, 60).actual, 50);

// net = added - deleted: 80 added, 30 deleted => net 50, exceeds budget of 40
expect("4. net lines exceeds tighter budget", checkNetAddedLinesBudget(netFiles, 40).ok, false);

// net can be negative when more lines deleted than added
const shrinkFiles = [
  { path: "src/cleanup.mjs", addedLines: new Array(5).fill("new"), deletedLines: new Array(20).fill("old"), status: "modified" },
];
expect("4. negative net always passes", checkNetAddedLinesBudget(shrinkFiles, 0).ok, true);
expect("4. negative net actual", checkNetAddedLinesBudget(shrinkFiles, 0).actual, -15);

// --- 5. Co-change rule violation ---

const srcOnlyFiles = [
  { path: "src/feature.mjs", addedLines: ["export function foo() {}"], status: "added" },
];

const cochangeViolations = checkCochangeRules(srcOnlyFiles, cochangeRules);
expect("5. cochange violation detected", cochangeViolations.length, 1);

// no trigger = no violation
const docsOnlyFiles = [
  { path: "docs/readme.md", addedLines: ["# Docs"], status: "added" },
];
expect("5. cochange not triggered", checkCochangeRules(docsOnlyFiles, cochangeRules).length, 0);

// --- 6. Forbidden regex found in added lines ---

const contentRules = [
  {
    id: "forbid_doxygen_tags_in_headers",
    glob: "include/**/*.h",
    mode: "added_lines",
    forbid_regex: ["@brief", "@param", "@return"],
  },
];

const headerFiles = [
  {
    path: "include/pmm/core.h",
    addedLines: ["/// @brief Does something", "void foo();"],
    status: "modified",
  },
];

const contentViolations = checkContentRules(headerFiles, contentRules);
expect("6. forbidden regex detected", contentViolations.length, 1);
expect("6. violation rule_id", contentViolations[0].rule_id, "forbid_doxygen_tags_in_headers");
expect("6. violation file", contentViolations[0].file, "include/pmm/core.h");

// non-matching glob should not trigger
const nonHeaderFiles = [
  {
    path: "src/impl.cpp",
    addedLines: ["/// @brief Implementation"],
    status: "modified",
  },
];
expect("6. non-matching glob skipped", checkContentRules(nonHeaderFiles, contentRules).length, 0);

// clean added lines should pass
const cleanHeaderFiles = [
  {
    path: "include/pmm/clean.h",
    addedLines: ["void bar();", "int baz();"],
    status: "modified",
  },
];
expect("6. clean header passes", checkContentRules(cleanHeaderFiles, contentRules).length, 0);

// --- 7. must_not_touch violation ---

const touchedFiles = [
  { path: "src/main.mjs", addedLines: [], status: "modified" },
  { path: "migrations/001.sql", addedLines: ["CREATE TABLE"], status: "added" },
];

const mustNotTouchResult = checkMustNotTouch(touchedFiles, ["migrations/**"]);
expect("7. must_not_touch violation", mustNotTouchResult.ok, false);
expect("7. touched file", mustNotTouchResult.touched[0], "migrations/001.sql");

// no violation when pattern doesn't match
expect("7. must_not_touch passes", checkMustNotTouch(validFiles, ["migrations/**"]).ok, true);

// empty must_not_touch always passes
expect("7. empty must_not_touch", checkMustNotTouch(touchedFiles, []).ok, true);

// --- 8. must_touch missing ---

const missingTouchFiles = [
  { path: "src/other.mjs", addedLines: ["code"], status: "modified" },
];

const mustTouchResult = checkMustTouch(missingTouchFiles, ["tests/**", "package.json"]);
expect("8. must_touch missing", mustTouchResult.ok, false);

// satisfied when at least one pattern matches
const satisfiedFiles = [
  { path: "src/other.mjs", addedLines: ["code"], status: "modified" },
  { path: "tests/new-test.mjs", addedLines: ["test"], status: "added" },
];
expect("8. must_touch satisfied", checkMustTouch(satisfiedFiles, ["tests/**"]).ok, true);

// empty must_touch always passes
expect("8. empty must_touch", checkMustTouch(missingTouchFiles, []).ok, true);

// --- Budget undefined = skip check ---

expect("budget: undefined max_new_docs skipped", checkCanonicalDocsBudget(manyDocsFiles, [], undefined).ok, true);
expect("budget: undefined max_new_files skipped", checkNewFilesBudget(manyDocsFiles, undefined).ok, true);
expect("budget: undefined max_net_added_lines skipped", checkNetAddedLinesBudget(manyLinesFiles, undefined).ok, true);

// --- Max new files budget ---

const manyNewFiles = [
  { path: "a.mjs", addedLines: [], status: "added" },
  { path: "b.mjs", addedLines: [], status: "added" },
  { path: "c.mjs", addedLines: [], status: "added" },
];

const newFilesResult = checkNewFilesBudget(manyNewFiles, 2);
expect("budget: max new files exceeded", newFilesResult.ok, false);
expect("budget: max new files actual", newFilesResult.actual, 3);

// --- Summary ---

console.log(`\n${failures === 0 ? "All tests passed" : `${failures} test(s) failed`}`);
process.exit(failures === 0 ? 0 : 1);
