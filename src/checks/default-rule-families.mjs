import { advisoryTextRuleFamily } from "./rules/advisory-text-rules.mjs";
import { anchorExtractionRuleFamily, traceRuleFamily } from "./rules/anchor-rules.mjs";
import { budgetRuleFamily } from "./rules/budgets.mjs";
import { changeProfileRuleFamily } from "./rules/change-profiles.mjs";
import { cochangeRuleFamily } from "./rules/cochange-rules.mjs";
import { contentRuleFamily } from "./rules/content-rules.mjs";
import { contractRuleFamily } from "./rules/contract-rules.mjs";
import { governancePathsRuleFamily } from "./rules/governance-paths.mjs";
import { forbiddenPathsRuleFamily } from "./rules/paths.mjs";
import { registryRuleFamily } from "./rules/registry-rules.mjs";
import { sizeRuleFamily } from "./rules/size-rules.mjs";
import { createRuleRegistry } from "./rule-registry.mjs";

export const defaultRuleFamilies = [
  forbiddenPathsRuleFamily,
  governancePathsRuleFamily,
  budgetRuleFamily,
  sizeRuleFamily,
  registryRuleFamily,
  advisoryTextRuleFamily,
  anchorExtractionRuleFamily,
  traceRuleFamily,
  changeProfileRuleFamily,
  cochangeRuleFamily,
  contentRuleFamily,
  contractRuleFamily,
];

export function createDefaultRuleRegistry() {
  const registry = createRuleRegistry();
  for (const family of defaultRuleFamilies) {
    registry.register(family);
  }
  return registry;
}
