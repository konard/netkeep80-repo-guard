import { execSync } from "node:child_process";
import {
  parseDiff,
  filterOperationalPaths,
  detectTouchedSurfaces,
  classifyNewFiles,
} from "../diff-checker.mjs";
import { extractAnchors } from "../extractors/anchors.mjs";

export function listTrackedFiles(repoRoot) {
  return execSync("git ls-files", { encoding: "utf-8", cwd: repoRoot })
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
  declaredChangeClass = null,
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

  return {
    mode,
    repositoryRoot,
    policy,
    contract,
    contractSource,
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
    trackedFiles: resolvedTrackedFiles,
    derived: {
      changedPaths,
      touchedSurfaces,
      newFileClasses,
    },
    declaredChangeClass,
    diagnostics: {
      ...diagnostics,
      skippedOperationalFiles: skippedOperationalFiles.length,
    },
  };
}
