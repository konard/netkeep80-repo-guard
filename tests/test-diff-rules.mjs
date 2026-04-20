import { classifyNewFiles, detectTouchedSurfaces } from "../src/diff/classification.mjs";
import { filterOperationalPaths } from "../src/diff/filters.mjs";
import { parseDiff } from "../src/diff/parser.mjs";
import {
  checkCanonicalDocsBudget,
  checkNetAddedLinesBudget,
  checkNewFilesBudget,
  checkSurfaceDebt,
} from "../src/checks/rules/budgets.mjs";
import { checkChangeTypeRules } from "../src/checks/rules/change-type-rules.mjs";
import { checkCochangeRules } from "../src/checks/rules/cochange-rules.mjs";
import { checkContentRules } from "../src/checks/rules/content-rules.mjs";
import { checkMustNotTouch, checkMustTouch } from "../src/checks/rules/contract-rules.mjs";
import { checkAdvisoryTextRules } from "../src/checks/rules/advisory-text-rules.mjs";
import { checkForbiddenPaths } from "../src/checks/rules/paths.mjs";
import { checkNewFileRules } from "../src/checks/rules/new-file-rules.mjs";
import { checkRegistryRules } from "../src/checks/rules/registry-rules.mjs";
import { checkSizeRules, countTextLines } from "../src/checks/rules/size-rules.mjs";
import { checkSurfaceMatrix } from "../src/checks/rules/surface-matrix.mjs";

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

// --- 4b. Surface debt validates temporary growth declarations ---

const growthDebt = {
  kind: "temporary_growth",
  reason: "Introduce extraction seam before removing duplicate path",
  expected_delta: {
    max_new_files: 1,
    max_net_added_lines: 60,
  },
  repayment_issue: 123,
};

const growthFiles = [
  { path: "src/extract.mjs", addedLines: new Array(50).fill("new"), deletedLines: [], status: "added" },
];

expect("4b. undeclared surface growth passes by default", checkSurfaceDebt(growthFiles, null).ok, true);
expect("4b. undeclared surface growth status", checkSurfaceDebt(growthFiles, null).status, "undeclared");
expect("4b. declared surface debt passes", checkSurfaceDebt(growthFiles, growthDebt).ok, true);
expect("4b. declared surface debt status", checkSurfaceDebt(growthFiles, growthDebt).status, "declared");
expect(
  "4b. declared debt exceeded fails",
  checkSurfaceDebt(growthFiles, { ...growthDebt, expected_delta: { max_new_files: 0, max_net_added_lines: 10 } }).status,
  "declared_debt_exceeded"
);
expect(
  "4b. declared debt missing repayment fails",
  checkSurfaceDebt(growthFiles, { ...growthDebt, repayment_issue: undefined }).status,
  "missing_repayment_target"
);
expect("4b. shrink needs no surface debt", checkSurfaceDebt(shrinkFiles, null).ok, true);
expect("4b. shrink surface debt status", checkSurfaceDebt(shrinkFiles, null).status, "not_needed");

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

// --- 9. filterOperationalPaths ---

const mixedFiles = [
  { path: "src/app.mjs", addedLines: ["code"], status: "modified" },
  { path: ".claude/settings.json", addedLines: ["{}"], status: "added" },
  { path: ".claude/memory/note.md", addedLines: ["note"], status: "added" },
  { path: "tests/test.mjs", addedLines: ["test"], status: "added" },
];

const filteredFiles = filterOperationalPaths(mixedFiles, [".claude/**"]);
expect("9. operational paths filtered", filteredFiles.length, 2);
expect("9. non-operational file kept (src)", filteredFiles[0].path, "src/app.mjs");
expect("9. non-operational file kept (tests)", filteredFiles[1].path, "tests/test.mjs");

// empty operational_paths returns all files
expect("9. empty operational_paths", filterOperationalPaths(mixedFiles, []).length, 4);

// undefined operational_paths returns all files
expect("9. undefined operational_paths", filterOperationalPaths(mixedFiles, undefined).length, 4);

// operational paths don't affect unrelated files
const noOpFiles = [
  { path: "src/main.mjs", addedLines: [], status: "modified" },
];
expect("9. no operational match", filterOperationalPaths(noOpFiles, [".claude/**"]).length, 1);

// .gitkeep bot artifact filtered by exact-match operational path
const gitkeepFiles = [
  { path: ".gitkeep", addedLines: [""], status: "added" },
  { path: "src/app.mjs", addedLines: ["code"], status: "modified" },
  { path: ".claude/memory/note.md", addedLines: ["note"], status: "added" },
];
const gitkeepFiltered = filterOperationalPaths(gitkeepFiles, [".claude/**", ".gitkeep"]);
expect("9. .gitkeep filtered as operational", gitkeepFiltered.length, 1);
expect("9. .gitkeep: only src file remains", gitkeepFiltered[0].path, "src/app.mjs");

// --- 10. surface matrix ---

const surfaceFiles = [
  { path: "src/core.mjs", addedLines: ["code"], deletedLines: [], status: "modified" },
  { path: "tests/core.test.mjs", addedLines: ["test"], deletedLines: [], status: "modified" },
  { path: "docs/guide.md", addedLines: ["docs"], deletedLines: [], status: "modified" },
];

const surfaces = {
  kernel: ["src/**"],
  tests: ["tests/**"],
  docs: ["docs/**", "README.md"],
  generated: ["single_include/**"],
  release: ["CHANGELOG.md", "package.json"],
};

const touchedSurfaces = detectTouchedSurfaces(surfaceFiles, surfaces);
expect("10. detects touched surface count", touchedSurfaces.touched_surfaces.length, 3);
expect("10. detects docs surface", touchedSurfaces.touched_surfaces.includes("docs"), true);
expect("10. maps files by surface", touchedSurfaces.files_by_surface.kernel[0], "src/core.mjs");
expect("10. reports no unclassified files for fully classified diff", touchedSurfaces.unclassified_files.length, 0);

const surfaceMatrix = {
  "kernel-hardening": {
    allow: ["kernel", "tests"],
    forbid: ["generated", "release"],
  },
  "docs-cleanup": {
    allow: ["docs", "governance"],
    forbid: ["kernel", "tests", "generated", "release"],
  },
};

const kernelOnlyFiles = [
  { path: "src/core.mjs", addedLines: ["code"], deletedLines: [], status: "modified" },
  { path: "tests/core.test.mjs", addedLines: ["test"], deletedLines: [], status: "modified" },
];

const kernelSurfaceResult = checkSurfaceMatrix(kernelOnlyFiles, surfaces, surfaceMatrix, "kernel-hardening");
expect("10. allowed kernel/test surface combination passes", kernelSurfaceResult.ok, true);
expect("10. allowed combination reports change_class", kernelSurfaceResult.change_class, "kernel-hardening");

const unclassifiedOnlyFiles = [
  { path: "scripts/tool.mjs", addedLines: ["code"], deletedLines: [], status: "modified" },
];

const unclassifiedSurfaces = detectTouchedSurfaces(unclassifiedOnlyFiles, surfaces);
expect("10. detects unclassified changed file", unclassifiedSurfaces.unclassified_files[0], "scripts/tool.mjs");

const unclassifiedResult = checkSurfaceMatrix(unclassifiedOnlyFiles, surfaces, surfaceMatrix, "docs-cleanup");
expect("10. surface matrix rejects unclassified files by default", unclassifiedResult.ok, false);
expect("10. reports unclassified files", unclassifiedResult.unclassified_files[0], "scripts/tool.mjs");
expect("10. unclassified failure message names file", unclassifiedResult.message.includes("scripts/tool.mjs"), true);

const allowedUnclassifiedResult = checkSurfaceMatrix(
  unclassifiedOnlyFiles,
  surfaces,
  surfaceMatrix,
  "docs-cleanup",
  { allow_unclassified_files: true }
);
expect("10. policy can explicitly allow unclassified files", allowedUnclassifiedResult.ok, true);

const docsSurfaceResult = checkSurfaceMatrix(surfaceFiles, surfaces, surfaceMatrix, "docs-cleanup");
expect("10. docs class rejects kernel/test surfaces", docsSurfaceResult.ok, false);
expect("10. reports declared change_class", docsSurfaceResult.change_class, "docs-cleanup");
expect("10. reports touched surfaces", docsSurfaceResult.touched_surfaces.join(","), "docs,kernel,tests");
expect("10. reports violating surfaces", docsSurfaceResult.violating_surfaces.join(","), "kernel,tests");

const missingClassResult = checkSurfaceMatrix(surfaceFiles, surfaces, surfaceMatrix, null);
expect("10. surface matrix requires change_class", missingClassResult.ok, false);
expect("10. missing change_class message", missingClassResult.message, "surface_matrix requires a declared change_class");

const unknownClassResult = checkSurfaceMatrix(surfaceFiles, surfaces, surfaceMatrix, "release");
expect("10. undefined change_class fails", unknownClassResult.ok, false);
expect("10. undefined change_class is reported", unknownClassResult.change_class, "release");

// --- 11. new file classes ---

const newFileClassFiles = [
  { path: "src/core.mjs", addedLines: ["code"], deletedLines: [], status: "modified" },
  { path: "tests/core.test.mjs", addedLines: ["test"], deletedLines: [], status: "added" },
  { path: "changelog.d/core.md", addedLines: ["note"], deletedLines: [], status: "added" },
  { path: "single_include/core.h", addedLines: ["generated"], deletedLines: [], status: "added" },
  { path: "scratch.txt", addedLines: ["temp"], deletedLines: [], status: "added" },
];

const newFileClasses = {
  test: ["tests/**"],
  changelog_fragment: ["changelog.d/*.md"],
  generated: ["single_include/**"],
};

const classifiedNewFiles = classifyNewFiles(newFileClassFiles, newFileClasses);
expect("11. classifies only added files", classifiedNewFiles.new_files.length, 4);
expect("11. detects test class", classifiedNewFiles.files_by_class.test[0], "tests/core.test.mjs");
expect("11. reports unclassified new file", classifiedNewFiles.unclassified_files[0], "scratch.txt");
expect("11. ignores modified files for classification", classifiedNewFiles.new_files.includes("src/core.mjs"), false);

const newFileRules = {
  "kernel-hardening": {
    allow_classes: ["test", "changelog_fragment"],
    max_per_class: {
      test: 2,
      changelog_fragment: 1,
    },
  },
  "docs-cleanup": {
    allow_classes: [],
    max_new_files: 0,
  },
  "generated-refresh": {
    allow_classes: ["generated"],
    max_per_class: {
      generated: 1,
    },
  },
};

const allowedTypedNewFiles = [
  { path: "tests/core.test.mjs", addedLines: ["test"], deletedLines: [], status: "added" },
  { path: "changelog.d/core.md", addedLines: ["note"], deletedLines: [], status: "added" },
];

const allowedNewFileResult = checkNewFileRules(
  allowedTypedNewFiles,
  newFileClasses,
  newFileRules,
  "kernel-hardening"
);
expect("11. allowed new file classes pass", allowedNewFileResult.ok, true);
expect("11. reports declared new-file change_class", allowedNewFileResult.change_class, "kernel-hardening");

const disallowedNewFileResult = checkNewFileRules(
  newFileClassFiles,
  newFileClasses,
  newFileRules,
  "kernel-hardening"
);
expect("11. rejects disallowed new file class", disallowedNewFileResult.ok, false);
expect("11. reports generated class violation", disallowedNewFileResult.violating_classes[0], "generated");
expect("11. failure names offending generated file", disallowedNewFileResult.details.some((d) => d.includes("single_include/core.h")), true);
expect("11. failure names unclassified file", disallowedNewFileResult.details.some((d) => d.includes("scratch.txt")), true);

const tooManyTestsResult = checkNewFileRules(
  [
    { path: "tests/a.test.mjs", addedLines: ["test"], deletedLines: [], status: "added" },
    { path: "tests/b.test.mjs", addedLines: ["test"], deletedLines: [], status: "added" },
  ],
  newFileClasses,
  {
    "kernel-hardening": {
      allow_classes: ["test"],
      max_per_class: { test: 1 },
    },
  },
  "kernel-hardening"
);
expect("11. enforces max_per_class", tooManyTestsResult.ok, false);
expect("11. max_per_class reports class", tooManyTestsResult.class_budget_violations[0].class, "test");

const docsCleanupResult = checkNewFileRules(
  allowedTypedNewFiles,
  newFileClasses,
  newFileRules,
  "docs-cleanup"
);
expect("11. per-change max_new_files can forbid all new files", docsCleanupResult.ok, false);
expect("11. per-change max_new_files reports actual", docsCleanupResult.actual, 2);

expect(
  "11. new file rules require change_class when new files exist",
  checkNewFileRules(allowedTypedNewFiles, newFileClasses, newFileRules, null).ok,
  false
);
expect(
  "11. new file rules pass when no new files exist without change_class",
  checkNewFileRules([{ path: "src/core.mjs", addedLines: ["code"], deletedLines: [], status: "modified" }], newFileClasses, newFileRules, null).ok,
  true
);

// --- 12. change type rules ---

const changeTypePolicy = {
  paths: {
    canonical_docs: ["README.md"],
  },
  surfaces: {
    ...surfaces,
    docs: [...surfaces.docs, "changelog.d/*.md"],
  },
  new_file_classes: newFileClasses,
  change_type_rules: {
    governance: {
      allow_surfaces: ["docs"],
      forbid_surfaces: ["kernel", "generated"],
      max_new_docs: 0,
      max_new_files: 1,
      new_file_rules: {
        allow_classes: ["changelog_fragment"],
        max_per_class: {
          changelog_fragment: 1,
        },
      },
    },
    "kernel-hardening": {
      require_surfaces: ["tests"],
    },
  },
};

const governanceViolation = checkChangeTypeRules(
  [
    { path: "src/core.mjs", addedLines: ["code"], deletedLines: [], status: "modified" },
    { path: "docs/new.md", addedLines: ["docs"], deletedLines: [], status: "added" },
    { path: "single_include/core.h", addedLines: ["generated"], deletedLines: [], status: "added" },
  ],
  changeTypePolicy,
  "governance"
);
expect("12. change type rules reject forbidden surfaces", governanceViolation.ok, false);
expect("12. change type result names declared type", governanceViolation.change_type, "governance");
expect("12. change type reports violating kernel surface", governanceViolation.violating_surfaces.includes("kernel"), true);
expect("12. change type reports docs budget", governanceViolation.docs_budget.ok, false);
expect("12. change type reports new-file class violations", governanceViolation.new_file_rules.ok, false);

const governanceUnclassifiedViolation = checkChangeTypeRules(
  [
    { path: "docs/policy.md", addedLines: ["docs"], deletedLines: [], status: "modified" },
    { path: "scripts/tool.mjs", addedLines: ["code"], deletedLines: [], status: "modified" },
  ],
  changeTypePolicy,
  "governance"
);
expect("12. change type surface constraints reject unclassified files", governanceUnclassifiedViolation.ok, false);
expect("12. change type reports unclassified file", governanceUnclassifiedViolation.unclassified_files[0], "scripts/tool.mjs");
expect(
  "12. change type unclassified file appears in details",
  governanceUnclassifiedViolation.details.some((detail) => detail.includes("scripts/tool.mjs")),
  true
);

const kernelHardeningAllowed = checkChangeTypeRules(
  [
    { path: "src/core.mjs", addedLines: ["code"], deletedLines: [], status: "modified" },
    { path: "tests/core.test.mjs", addedLines: ["test"], deletedLines: [], status: "modified" },
  ],
  changeTypePolicy,
  "kernel-hardening"
);
expect("12. change type rules pass allowed constraints", kernelHardeningAllowed.ok, true);

const missingRequiredSurface = checkChangeTypeRules(
  [{ path: "src/core.mjs", addedLines: ["code"], deletedLines: [], status: "modified" }],
  changeTypePolicy,
  "kernel-hardening"
);
expect("12. change type require_surfaces fails when missing", missingRequiredSurface.ok, false);
expect("12. change type missing surface reported", missingRequiredSurface.missing_required_surfaces[0], "tests");

expect(
  "12. change type rules require declared change_type",
  checkChangeTypeRules(surfaceFiles, changeTypePolicy, null).ok,
  false
);
expect(
  "12. unknown change_type fails with known types",
  checkChangeTypeRules(surfaceFiles, changeTypePolicy, "release").ok,
  false
);

// --- 13. registry rules ---

const registryFiles = new Map([
  [
    "repo-policy.json",
    JSON.stringify({
      paths: {
        canonical_docs: ["README.md", "docs/policy.md"],
      },
    }),
  ],
  [
    "docs/index.md",
    [
      "# Documentation",
      "",
      "## Canonical Documents",
      "",
      "- [Readme](../README.md)",
      "- [Policy](policy.md)",
      "",
      "## Other Documents",
      "",
      "- [Extra](extra.md)",
    ].join("\n"),
  ],
]);

const registryRules = [
  {
    id: "canonical-docs-sync",
    kind: "set_equality",
    left: {
      type: "json_array",
      file: "repo-policy.json",
      json_pointer: "/paths/canonical_docs",
    },
    right: {
      type: "markdown_section_links",
      file: "docs/index.md",
      section: "Canonical Documents",
      prefix: "docs/",
    },
  },
];

const matchingRegistryResult = checkRegistryRules(registryRules, {
  readFile: (path) => registryFiles.get(path),
});
expect("13. matching registry rule passes", matchingRegistryResult.ok, true);
expect("13. matching registry rule count", matchingRegistryResult.results.length, 1);

const mismatchedRegistryResult = checkRegistryRules(registryRules, {
  readFile: (path) => {
    if (path === "docs/index.md") {
      return [
        "# Documentation",
        "",
        "## Canonical Documents",
        "",
        "- [Readme](../README.md)",
        "- [Architecture](architecture.md)",
      ].join("\n");
    }
    return registryFiles.get(path);
  },
});
expect("13. registry mismatch fails", mismatchedRegistryResult.ok, false);
expect("13. failed rule id reported", mismatchedRegistryResult.results[0].rule_id, "canonical-docs-sync");
expect("13. left entries reported", mismatchedRegistryResult.results[0].left_entries.includes("docs/policy.md"), true);
expect("13. right entries reported", mismatchedRegistryResult.results[0].right_entries.includes("docs/architecture.md"), true);
expect("13. missing entries reported", mismatchedRegistryResult.results[0].missing_from_right[0], "docs/policy.md");
expect("13. extra entries reported", mismatchedRegistryResult.results[0].extra_in_right[0], "docs/architecture.md");

const subsetRegistryResult = checkRegistryRules(
  [
    {
      id: "canonical-docs-listed",
      kind: "left_subset_of_right",
      left: registryRules[0].left,
      right: {
        ...registryRules[0].right,
        section: "All Documents",
      },
    },
  ],
  {
    readFile: (path) => {
      if (path === "docs/index.md") {
        return [
          "## All Documents",
          "",
          "- [Readme](../README.md)",
          "- [Policy](policy.md)",
          "- [Extra](extra.md)",
        ].join("\n");
      }
      return registryFiles.get(path);
    },
  }
);
expect("13. left subset of right passes with extra right entries", subsetRegistryResult.ok, true);

const missingSourceResult = checkRegistryRules(registryRules, {
  readFile: () => undefined,
});
expect("13. missing source fails", missingSourceResult.ok, false);
expect("13. missing source detail names file", missingSourceResult.results[0].details[0].includes("repo-policy.json"), true);

const nonStringRegistryResult = checkRegistryRules(registryRules, {
  readFile: (path) => {
    if (path === "repo-policy.json") {
      return JSON.stringify({ paths: { canonical_docs: ["README.md", 42] } });
    }
    return registryFiles.get(path);
  },
});
expect("13. non-string JSON registry entries fail", nonStringRegistryResult.ok, false);
expect("13. non-string JSON registry detail", nonStringRegistryResult.results[0].details[0].includes("only strings"), true);

// --- 14. advisory text rules ---

const advisoryFiles = new Map([
  [
    "docs/canonical.md",
    [
      "# Release Policy",
      "",
      "Policy text must live in the canonical document so maintainers update one source.",
      "Release approvals require a changelog entry, owner review, and a documented rollback path.",
    ].join("\n"),
  ],
  [
    "docs/new-policy.md",
    [
      "# Release Policy",
      "",
      "Policy text must live in the canonical document so maintainers update one source.",
      "Release approvals require a changelog entry, owner review, and a documented rollback path.",
    ].join("\n"),
  ],
  [
    "docs/other.md",
    [
      "# Independent Notes",
      "",
      "This document describes a separate maintenance workflow with different words.",
    ].join("\n"),
  ],
]);

const advisoryRules = {
  canonical_files: ["docs/canonical.md"],
  warn_on_similarity_above: 0.7,
  max_reported_matches: 3,
};

const advisoryResult = checkAdvisoryTextRules(
  [{ path: "docs/new-policy.md", addedLines: [], deletedLines: [], status: "added" }],
  advisoryRules,
  {
    allFiles: ["docs/canonical.md", "docs/new-policy.md", "docs/other.md"],
    readFile: (path) => advisoryFiles.get(path),
  }
);
expect("14. advisory duplication warns", advisoryResult.ok, false);
expect("14. advisory is warning-only", advisoryResult.advisory, true);
expect("14. advisory changed file reported", advisoryResult.matches[0].changed_file, "docs/new-policy.md");
expect("14. advisory canonical file reported", advisoryResult.matches[0].canonical_file, "docs/canonical.md");
expect("14. advisory score crosses threshold", advisoryResult.matches[0].score >= 0.7, true);
expect("14. duplicate section title reported", advisoryResult.matches[0].duplicate_section_titles[0], "Release Policy");

const cleanAdvisoryResult = checkAdvisoryTextRules(
  [{ path: "docs/other.md", addedLines: [], deletedLines: [], status: "modified" }],
  advisoryRules,
  {
    allFiles: ["docs/canonical.md", "docs/other.md"],
    readFile: (path) => advisoryFiles.get(path),
  }
);
expect("14. unrelated markdown passes advisory", cleanAdvisoryResult.ok, true);

const cappedAdvisoryResult = checkAdvisoryTextRules(
  [
    { path: "docs/new-policy.md", addedLines: [], deletedLines: [], status: "added" },
    { path: "docs/other.md", addedLines: [], deletedLines: [], status: "modified" },
  ],
  { ...advisoryRules, canonical_files: ["docs/*.md"], max_reported_matches: 1 },
  {
    allFiles: ["docs/canonical.md", "docs/new-policy.md", "docs/other.md"],
    readFile: (path) => advisoryFiles.get(path),
  }
);
expect("14. advisory caps reported matches", cappedAdvisoryResult.matches.length, 1);

// --- 15. size rules ---

expect("15. line count empty content", countTextLines(""), 0);
expect("15. line count single blank line", countTextLines("\n"), 1);
expect("15. line count trailing newline", countTextLines("a\n"), 1);
expect("15. line count two blank lines", countTextLines("\n\n"), 2);

const sizeRuleFiles = new Map([
  ["src/small.mjs", "one\ntwo\n"],
  ["src/large.mjs", "one\ntwo\nthree\n"],
  ["src/bytes.bin", "abcdef"],
  ["src/subtree/a.mjs", "a\nb\n"],
  ["src/subtree/b.mjs", "c\n"],
  ["docs/readme.md", "# Docs\n"],
]);

const sizeRuleOptions = {
  trackedFiles: [...sizeRuleFiles.keys()],
  readFile: (path) => sizeRuleFiles.get(path),
};

const passingFileSizeResult = checkSizeRules(
  [],
  [{ id: "max-small-lines", scope: "file", metric: "lines", glob: "src/small.mjs", max: 2 }],
  sizeRuleOptions
);
expect("15. passing file line rule", passingFileSizeResult.ok, true);

const failingFileSizeResult = checkSizeRules(
  [],
  [{ id: "max-large-lines", scope: "file", metric: "lines", glob: "src/large.mjs", max: 2 }],
  sizeRuleOptions
);
expect("15. failing file line rule", failingFileSizeResult.ok, false);
expect("15. file violation rule id", failingFileSizeResult.size_violations[0].ruleId, "max-large-lines");
expect("15. file violation path", failingFileSizeResult.size_violations[0].path, "src/large.mjs");
expect("15. file violation actual lines", failingFileSizeResult.size_violations[0].actual, 3);
expect("15. file violation max", failingFileSizeResult.size_violations[0].max, 2);

const passingDirectorySizeResult = checkSizeRules(
  [],
  [{ id: "max-subtree-lines", scope: "directory", metric: "lines", glob: "src/subtree/**", max: 3 }],
  sizeRuleOptions
);
expect("15. passing directory line rule", passingDirectorySizeResult.ok, true);

const failingDirectorySizeResult = checkSizeRules(
  [],
  [{ id: "max-subtree-bytes", scope: "directory", metric: "bytes", glob: "src/subtree/**", max: 5 }],
  sizeRuleOptions
);
expect("15. failing directory byte rule", failingDirectorySizeResult.ok, false);
expect("15. directory violation scope", failingDirectorySizeResult.size_violations[0].scope, "directory");
expect("15. directory violation path", failingDirectorySizeResult.size_violations[0].path, "src/subtree");
expect("15. directory violation metric", failingDirectorySizeResult.size_violations[0].metric, "bytes");

const failingByteSizeResult = checkSizeRules(
  [],
  [{ id: "max-file-bytes", scope: "file", metric: "bytes", glob: "src/bytes.bin", max: 5 }],
  sizeRuleOptions
);
expect("15. failing file byte rule", failingByteSizeResult.ok, false);
expect("15. file byte violation actual", failingByteSizeResult.size_violations[0].actual, 6);

const changedOnlySkippedResult = checkSizeRules(
  [{ path: "docs/readme.md", addedLines: ["docs"], deletedLines: [], status: "modified" }],
  [{ id: "changed-only-lines", scope: "file", metric: "lines", glob: "src/large.mjs", max: 2, count: "changed_only" }],
  sizeRuleOptions
);
expect("15. changed_only skips unchanged file", changedOnlySkippedResult.ok, true);

const changedOnlyFailingResult = checkSizeRules(
  [{ path: "src/large.mjs", addedLines: ["three"], deletedLines: [], status: "modified" }],
  [{ id: "changed-only-lines", scope: "file", metric: "lines", glob: "src/large.mjs", max: 2, count: "changed_only" }],
  sizeRuleOptions
);
expect("15. changed_only evaluates changed file", changedOnlyFailingResult.ok, false);

const ignoredSizeResult = checkSizeRules(
  [],
  [{ id: "ignore-generated", scope: "file", metric: "bytes", glob: "src/**", max: 10, ignore: ["src/bytes.bin", "src/large.mjs", "src/subtree/**"] }],
  sizeRuleOptions
);
expect("15. ignore patterns exclude matching files", ignoredSizeResult.ok, true);

const advisorySizeResult = checkSizeRules(
  [],
  [{ id: "advisory-large-lines", scope: "file", metric: "lines", glob: "src/large.mjs", max: 2, level: "advisory" }],
  sizeRuleOptions
);
expect("15. advisory size rule does not fail blocking result", advisorySizeResult.ok, true);
expect("15. advisory size rule is reported separately", advisorySizeResult.advisory_violations.length, 1);

// --- Summary ---

console.log(`\n${failures === 0 ? "All tests passed" : `${failures} test(s) failed`}`);
process.exit(failures === 0 ? 0 : 1);
