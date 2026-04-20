import { checkAnchorExtraction } from "../../extractors/anchors.mjs";
import { checkTraceRuleResult } from "../trace-rules.mjs";

export const anchorExtractionRuleFamily = {
  id: "anchor-extraction",
  applies(facts) {
    return Boolean(facts.policy.anchors);
  },
  evaluate(facts) {
    return {
      name: "anchor-extraction",
      check: checkAnchorExtraction(facts.anchors),
    };
  },
};

export const traceRuleFamily = {
  id: "trace-rules",
  applies(facts) {
    return Boolean(facts.policy.trace_rules && facts.policy.trace_rules.length > 0);
  },
  evaluate(_facts, context = {}) {
    return (context.anchorDiagnostics?.traceRuleResults || []).map((traceResult) => ({
      name: `trace-rule: ${traceResult.id}`,
      check: checkTraceRuleResult(traceResult),
    }));
  },
};
