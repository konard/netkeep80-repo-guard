import { createDefaultRuleRegistry } from "./default-rule-families.mjs";

export function runPolicyChecks(facts, reporter, options = {}) {
  const registry = options.registry || createDefaultRuleRegistry();

  for (const entry of registry.evaluate(facts, options)) {
    reporter.report(entry.name, entry.check);
  }
}
