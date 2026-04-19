import { buildTraceRuleDiagnostics } from "../checks/trace-rules.mjs";

const CONTRACT_ANCHOR_FIELDS = ["affects", "implements", "verifies"];

function cloneAnchorInstance(instance) {
  return { ...instance };
}

function sortedUnique(values) {
  return [...new Set((values || []).map((value) => String(value)))].sort();
}

function groupByType(anchorTypes, instances) {
  const byType = {};
  for (const anchorType of Object.keys(anchorTypes || {}).sort()) {
    byType[anchorType] = { detected: 0, changed: 0 };
  }
  for (const instance of instances.detected) {
    if (!byType[instance.anchorType]) byType[instance.anchorType] = { detected: 0, changed: 0 };
    byType[instance.anchorType].detected++;
  }
  for (const instance of instances.changed) {
    if (!byType[instance.anchorType]) byType[instance.anchorType] = { detected: 0, changed: 0 };
    byType[instance.anchorType].changed++;
  }
  return byType;
}

function declaredContractAnchors(contract) {
  const contractAnchors = contract?.anchors || {};
  const declared = {};
  const all = [];

  for (const field of CONTRACT_ANCHOR_FIELDS) {
    const values = sortedUnique(contractAnchors[field]);
    declared[field] = values;
    for (const value of values) {
      all.push({ relation: field, value });
    }
  }

  declared.all = all;
  return declared;
}

function flattenUnresolved(traceRuleResults) {
  const unresolved = [];
  for (const result of traceRuleResults) {
    for (const item of result.unresolved || []) {
      unresolved.push({
        rule: result.id,
        kind: result.kind,
        fromAnchorType: result.fromAnchorType,
        toAnchorType: result.toAnchorType,
        value: item.value,
        instances: item.instances,
      });
    }
  }
  return unresolved;
}

export function buildAnchorDiagnostics(facts) {
  const traceRuleResults = buildTraceRuleDiagnostics(facts);
  if (!facts.policy.anchors) {
    return traceRuleResults.length > 0 ? { traceRuleResults } : {};
  }

  const detected = (facts.anchors?.instances || []).map(cloneAnchorInstance);
  const changedPaths = new Set(facts.derived.changedPaths || []);
  const changed = detected
    .filter((instance) => changedPaths.has(instance.file))
    .map(cloneAnchorInstance);
  const declaredByContract = declaredContractAnchors(facts.contract);
  const unresolved = flattenUnresolved(traceRuleResults);

  return {
    anchors: {
      detected,
      changed,
      declaredByContract,
      unresolved,
      stats: {
        detected: detected.length,
        changed: changed.length,
        declaredByContract: declaredByContract.all.length,
        unresolved: unresolved.length,
        extractionErrors: (facts.anchors?.errors || []).length,
        byType: groupByType(facts.policy.anchors.types, { detected, changed }),
      },
    },
    traceRuleResults,
  };
}
