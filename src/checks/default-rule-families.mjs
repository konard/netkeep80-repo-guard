import { advisoryTextRuleFamily } from "./rules/advisory-text-rules.mjs";
import { anchorExtractionRuleFamily, traceRuleFamily } from "./rules/anchor-rules.mjs";
import { budgetRuleFamily } from "./rules/budgets.mjs";
import { changeTypeRuleFamily } from "./rules/change-type-rules.mjs";
import { cochangeRuleFamily } from "./rules/cochange-rules.mjs";
import { contentRuleFamily } from "./rules/content-rules.mjs";
import { contractRuleFamily } from "./rules/contract-rules.mjs";
import { forbiddenPathsRuleFamily } from "./rules/paths.mjs";
import { newFileRuleFamily } from "./rules/new-file-rules.mjs";
import { registryRuleFamily } from "./rules/registry-rules.mjs";
import { sizeRuleFamily } from "./rules/size-rules.mjs";
import { surfaceMatrixRuleFamily } from "./rules/surface-matrix.mjs";
import { createRuleRegistry } from "./rule-registry.mjs";

export const defaultRuleFamilies = [
  forbiddenPathsRuleFamily,
  budgetRuleFamily,
  sizeRuleFamily,
  registryRuleFamily,
  advisoryTextRuleFamily,
  anchorExtractionRuleFamily,
  traceRuleFamily,
  changeTypeRuleFamily,
  newFileRuleFamily,
  surfaceMatrixRuleFamily,
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
