import { matchesAny } from "../../utils/path-patterns.mjs";

export function checkMustTouch(files, mustTouch) {
  if (!mustTouch || mustTouch.length === 0) return { ok: true };

  const changedPaths = files.map((file) => file.path);
  const satisfied = mustTouch.some((pattern) =>
    changedPaths.some((changedPath) => matchesAny(changedPath, [pattern]))
  );

  return {
    ok: satisfied,
    must_touch: mustTouch,
    changed: changedPaths,
    hint: satisfied ? undefined : "must_touch uses any-of semantics: at least one pattern must match a changed file",
  };
}

export function checkMustNotTouch(files, mustNotTouch) {
  if (!mustNotTouch || mustNotTouch.length === 0) return { ok: true };

  const changedPaths = files.map((file) => file.path);
  const touched = [];

  for (const pattern of mustNotTouch) {
    for (const changedPath of changedPaths) {
      if (matchesAny(changedPath, [pattern])) {
        touched.push(changedPath);
      }
    }
  }

  return {
    ok: touched.length === 0,
    touched,
    must_not_touch: mustNotTouch,
  };
}

export const contractRuleFamily = {
  id: "contract-rules",
  applies(facts) {
    return Boolean(facts.contract);
  },
  evaluate(facts) {
    const files = facts.diff.files.checked;
    return [
      {
        name: "must-touch",
        check: checkMustTouch(files, facts.contract.must_touch),
      },
      {
        name: "must-not-touch",
        check: checkMustNotTouch(files, facts.contract.must_not_touch),
      },
    ];
  },
};
