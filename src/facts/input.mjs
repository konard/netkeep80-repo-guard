import { execSync } from "node:child_process";
import {
  parseDiff,
  filterOperationalPaths,
  detectTouchedSurfaces,
  classifyNewFiles,
} from "../diff-checker.mjs";

export function listTrackedFiles(repoRoot) {
  return execSync("git ls-files", { encoding: "utf-8", cwd: repoRoot })
    .split(/\r?\n/)
    .filter(Boolean);
}

export function buildPolicyFacts({
  repositoryRoot,
  policy,
  contract = null,
  enforcement,
  diffText,
  trackedFiles = null,
  declaredChangeClass = null,
}) {
  const diffFiles = parseDiff(diffText);
  const filteredOperationalFiles = filterOperationalPaths(diffFiles, policy.paths.operational_paths);
  const changedPaths = filteredOperationalFiles.map((file) => file.path);
  const skippedOperationalFiles = diffFiles.length - filteredOperationalFiles.length;

  return {
    repositoryRoot,
    policy,
    contract,
    enforcementMode: enforcement.mode,
    enforcement,
    diffFiles,
    filteredOperationalFiles,
    changedPaths,
    trackedFiles: trackedFiles || listTrackedFiles(repositoryRoot),
    touchedSurfaces: policy.surfaces
      ? detectTouchedSurfaces(filteredOperationalFiles, policy.surfaces)
      : null,
    newFileClasses: policy.new_file_classes
      ? classifyNewFiles(filteredOperationalFiles, policy.new_file_classes)
      : null,
    declaredChangeClass,
    diagnostics: {
      skippedOperationalFiles,
    },
  };
}
