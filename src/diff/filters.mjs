import { matchesAny } from "../utils/path-patterns.mjs";

export function filterOperationalPaths(files, operationalPaths) {
  if (!operationalPaths || operationalPaths.length === 0) return files;
  return files.filter((file) => !matchesAny(file.path, operationalPaths));
}
