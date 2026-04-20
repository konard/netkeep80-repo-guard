import { execFileSync } from "node:child_process";
import { classifyNewFiles, detectTouchedSurfaces } from "../diff/classification.mjs";
import { filterOperationalPaths } from "../diff/filters.mjs";
import { parseDiff } from "../diff/parser.mjs";
import { extractAnchors } from "../extractors/anchors.mjs";
import { extractIntegration } from "../extractors/integration.mjs";

export function listTrackedFiles(repoRoot) {
  return execFileSync("git", ["ls-files"], { encoding: "utf-8", cwd: repoRoot })
    .split(/\r?\n/)
    .filter(Boolean);
}

export function buildPolicyFacts({
  mode = "check-diff",
  repositoryRoot,
  policy,
  contract = null,
  contractSource = "none",
  enforcement,
  diffText,
  trackedFiles = null,
  diagnostics = {},
  readFile = null,
}) {
  const allFiles = parseDiff(diffText);
  const checkedFiles = filterOperationalPaths(allFiles, policy.paths.operational_paths);
  const skippedOperationalFiles = allFiles.filter((file) => !checkedFiles.includes(file));
  const changedPaths = checkedFiles.map((file) => file.path);
  const resolvedTrackedFiles = trackedFiles || listTrackedFiles(repositoryRoot);
  const touchedSurfaces = policy.surfaces
    ? detectTouchedSurfaces(checkedFiles, policy.surfaces)
    : null;
  const newFileClasses = policy.new_file_classes
    ? classifyNewFiles(checkedFiles, policy.new_file_classes)
    : null;
  const anchors = extractAnchors(policy, {
    repoRoot: repositoryRoot,
    trackedFiles: resolvedTrackedFiles,
    changedFiles: checkedFiles,
    readFile,
  });
  const integration = extractIntegration(policy, {
    repoRoot: repositoryRoot,
    trackedFiles: resolvedTrackedFiles,
    changedFiles: checkedFiles,
    readFile,
  });

  return {
    mode,
    repositoryRoot,
    policy,
    contract,
    contractSource,
    readFile,
    enforcementMode: enforcement.mode,
    enforcement,
    diff: {
      files: {
        all: allFiles,
        checked: checkedFiles,
        skippedOperational: skippedOperationalFiles,
      },
    },
    anchors,
    integration,
    trackedFiles: resolvedTrackedFiles,
    derived: {
      changedPaths,
      touchedSurfaces,
      newFileClasses,
    },
    diagnostics: {
      ...diagnostics,
      skippedOperationalFiles: skippedOperationalFiles.length,
    },
  };
}
