import { matchesAny } from "../../utils/path-patterns.mjs";

export function checkCochangeRules(files, rules = []) {
  const changedPaths = files.map((file) => file.path);
  const violations = [];

  for (const rule of rules) {
    const triggered = changedPaths.some((path) => matchesAny(path, rule.if_changed));
    if (!triggered) continue;

    const satisfied = changedPaths.some((path) => matchesAny(path, rule.must_change_any));
    if (!satisfied) {
      violations.push({
        if_changed: rule.if_changed,
        must_change_any: rule.must_change_any,
      });
    }
  }

  return violations;
}

export const cochangeRuleFamily = {
  id: "cochange-rules",
  evaluate(facts) {
    const violations = checkCochangeRules(facts.diff.files.checked, facts.policy.cochange_rules);
    if (violations.length === 0) {
      return {
        name: "cochange-rules",
        check: { ok: true },
      };
    }

    return violations.map((violation) => ({
      name: `cochange: ${violation.if_changed.join(",")} -> ${violation.must_change_any.join(",")}`,
      check: {
        ok: false,
        must_touch: violation.must_change_any,
      },
    }));
  },
};
