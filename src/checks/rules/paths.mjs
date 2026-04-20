import { matchesAny } from "../../utils/path-patterns.mjs";

export function checkForbiddenPaths(files, forbidden) {
  const violations = [];
  for (const file of files) {
    if (file.status === "deleted") continue;
    if (matchesAny(file.path, forbidden)) {
      violations.push(file.path);
    }
  }
  return violations;
}

export const forbiddenPathsRuleFamily = {
  id: "forbidden-paths",
  evaluate(facts) {
    const violations = checkForbiddenPaths(facts.diff.files.checked, facts.policy.paths.forbidden);
    return {
      name: "forbidden-paths",
      check: {
        ok: violations.length === 0,
        files: violations,
      },
    };
  },
};
