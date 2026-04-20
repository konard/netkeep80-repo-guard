import {
  createDefaultRuleRegistry,
  defaultRuleFamilies,
} from "../src/checks/default-rule-families.mjs";

let failures = 0;

function expect(label, actual, expected) {
  const passed = actual === expected;
  console.log(`${passed ? "PASS" : "FAIL"}: ${label}`);
  if (!passed) {
    failures++;
    console.error(`  expected: ${expected}, got: ${actual}`);
  }
}

function expectIncludes(label, values, expected) {
  const passed = values.includes(expected);
  console.log(`${passed ? "PASS" : "FAIL"}: ${label}`);
  if (!passed) {
    failures++;
    console.error(`  expected ${JSON.stringify(values)} to include ${expected}`);
  }
}

function sorted(values) {
  return [...values].sort();
}

const content = new Map([
  ["src/feature.mjs", "const feature = true;\n"],
  ["tests/feature.test.mjs", "assert.ok(true);\n"],
  ["docs/notes.md", "# Independent Notes\n\nA short implementation note.\n"],
  ["docs/canonical.md", "# Release Policy\n\nCanonical policy language lives here.\n"],
  [
    "docs/index.md",
    [
      "# Documentation",
      "",
      "## Canonical Documents",
      "",
      "- [Canonical](canonical.md)",
    ].join("\n"),
  ],
  [
    "repo-policy.json",
    JSON.stringify({
      paths: {
        canonical_docs: ["docs/canonical.md"],
      },
    }),
  ],
]);

const facts = {
  repositoryRoot: process.cwd(),
  policy: {
    paths: {
      forbidden: ["secrets/**"],
      canonical_docs: ["docs/canonical.md"],
      operational_paths: [".gitkeep"],
    },
    diff_rules: {
      max_new_docs: 2,
      max_new_files: 3,
      max_net_added_lines: 20,
    },
    size_rules: [
      { id: "max-feature-lines", scope: "file", metric: "lines", glob: "src/feature.mjs", max: 10, count: "changed_only" },
    ],
    registry_rules: [
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
        },
      },
    ],
    advisory_text_rules: {
      canonical_files: ["docs/canonical.md"],
      warn_on_similarity_above: 0.8,
    },
    anchors: {
      types: {},
    },
    trace_rules: [
      {
        id: "evidence-ok",
        kind: "changed_files_require_evidence",
        if_changed: ["src/**"],
        must_touch_any: ["tests/**"],
      },
    ],
    surfaces: {
      app: ["src/**"],
      tests: ["tests/**"],
      docs: ["docs/**"],
    },
    change_type_rules: {
      implementation: {
        require_surfaces: ["tests"],
        allow_surfaces: ["app", "tests", "docs"],
      },
    },
    new_file_classes: {
      tests: ["tests/**"],
    },
    new_file_rules: {
      implementation: {
        allow_classes: ["tests"],
      },
    },
    surface_matrix: {
      implementation: {
        allow: ["app", "tests", "docs"],
      },
    },
    cochange_rules: [
      { if_changed: ["src/**"], must_change_any: ["tests/**"] },
    ],
    content_rules: [
      {
        id: "no-sentinel",
        glob: "src/**",
        mode: "added_lines",
        forbid_regex: ["NEVER_MATCH_REGISTRY_TEST"],
      },
    ],
  },
  contract: {
    change_type: "implementation",
    must_touch: ["tests/**"],
    must_not_touch: ["secrets/**"],
  },
  diff: {
    files: {
      checked: [
        { path: "src/feature.mjs", addedLines: ["const feature = true;"], deletedLines: [], status: "modified" },
        { path: "tests/feature.test.mjs", addedLines: ["assert.ok(true);"], deletedLines: [], status: "modified" },
        { path: "docs/notes.md", addedLines: ["A short implementation note."], deletedLines: [], status: "modified" },
      ],
    },
  },
  trackedFiles: [...content.keys()],
  readFile: (path) => content.get(path),
  anchors: {
    errors: [],
  },
  declaredChangeClass: "implementation",
};

const anchorDiagnostics = {
  traceRuleResults: [
    {
      id: "evidence-ok",
      kind: "changed_files_require_evidence",
      ok: true,
      ifChanged: ["src/**"],
      mustTouchAny: ["tests/**"],
      changedFiles: ["src/feature.mjs"],
      evidenceFiles: ["tests/feature.test.mjs"],
      stats: {
        changedFiles: 1,
        evidenceFiles: 1,
      },
    },
  ],
};

const registry = createDefaultRuleRegistry();
const expectedFamilyIds = defaultRuleFamilies.map((family) => family.id);

expect(
  "default registry lists every built-in family",
  registry.list().join(","),
  expectedFamilyIds.join(",")
);

const entries = registry.evaluate(facts, { anchorDiagnostics });
const executedFamilies = sorted(new Set(entries.map((entry) => entry.family)));

expect(
  "every registered family executed",
  executedFamilies.join(","),
  sorted(expectedFamilyIds).join(",")
);

for (const name of [
  "forbidden-paths",
  "canonical-docs-budget",
  "max-new-files",
  "max-net-added-lines",
  "surface-debt",
  "size-rules",
  "registry-rules",
  "advisory-text-rules",
  "anchor-extraction",
  "trace-rule: evidence-ok",
  "change-type-rules",
  "new-file-rules",
  "surface-matrix",
  "cochange-rules",
  "content-rules",
  "must-touch",
  "must-not-touch",
]) {
  expectIncludes(`registry emitted ${name}`, entries.map((entry) => entry.name), name);
}

expect(
  "all emitted checks expose canonical ok boolean",
  entries.every((entry) => typeof entry.check.ok === "boolean"),
  true
);

console.log(`\n${failures === 0 ? "All rule registry tests passed" : `${failures} test(s) failed`}`);
process.exit(failures === 0 ? 0 : 1);
