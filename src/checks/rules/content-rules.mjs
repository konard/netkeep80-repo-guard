import { matchesAny } from "../../utils/path-patterns.mjs";

export function checkContentRules(files, rules = []) {
  const violations = [];

  for (const rule of rules) {
    if (!rule.forbid_regex || rule.mode !== "added_lines") continue;

    const regexes = rule.forbid_regex.map((pattern) => new RegExp(pattern));
    const glob = rule.glob || "**";

    for (const file of files) {
      if (!matchesAny(file.path, [glob])) continue;

      for (const line of file.addedLines) {
        for (let i = 0; i < regexes.length; i++) {
          if (regexes[i].test(line)) {
            violations.push({
              rule_id: rule.id,
              file: file.path,
              line: line.trim(),
              matched_regex: rule.forbid_regex[i],
            });
          }
        }
      }
    }
  }

  return violations;
}

export const contentRuleFamily = {
  id: "content-rules",
  evaluate(facts) {
    const violations = checkContentRules(facts.diff.files.checked, facts.policy.content_rules);
    if (violations.length > 0) {
      return {
        name: "content-rules",
        check: {
          ok: false,
          details: violations.map((violation) =>
            `[${violation.rule_id}] ${violation.file}: "${violation.line}" matched /${violation.matched_regex}/`
          ),
        },
      };
    }

    return {
      name: "content-rules",
      check: { ok: true },
    };
  },
};
