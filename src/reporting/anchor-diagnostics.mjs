const CONTRACT_ANCHOR_FIELDS = ["affects", "implements", "verifies"];

function cloneAnchorInstance(instance) {
  return { ...instance };
}

function sortedUnique(values) {
  return [...new Set((values || []).map((value) => String(value)))].sort();
}

function groupByValue(instances) {
  const grouped = new Map();
  for (const instance of instances || []) {
    if (!grouped.has(instance.value)) grouped.set(instance.value, []);
    grouped.get(instance.value).push(cloneAnchorInstance(instance));
  }
  return grouped;
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

function buildMustResolveDiagnostics(rule, anchorExtraction) {
  const fromInstances = anchorExtraction.byType?.[rule.from_anchor_type] || [];
  const toInstances = anchorExtraction.byType?.[rule.to_anchor_type] || [];
  const fromByValue = groupByValue(fromInstances);
  const toByValue = groupByValue(toInstances);
  const resolved = [];
  const unresolved = [];

  for (const value of [...fromByValue.keys()].sort()) {
    const from = fromByValue.get(value);
    const to = toByValue.get(value) || [];
    if (to.length > 0) {
      resolved.push({ value, from, to });
    } else {
      unresolved.push({ value, instances: from });
    }
  }

  return {
    id: rule.id,
    kind: rule.kind,
    fromAnchorType: rule.from_anchor_type,
    toAnchorType: rule.to_anchor_type,
    ok: unresolved.length === 0,
    resolved,
    unresolved,
    stats: {
      fromInstances: fromInstances.length,
      fromValues: fromByValue.size,
      toInstances: toInstances.length,
      toValues: toByValue.size,
      resolved: resolved.length,
      unresolved: unresolved.length,
    },
  };
}

function buildTraceRuleDiagnostics(policy, anchorExtraction) {
  return (policy.trace_rules || []).map((rule) => {
    if (rule.kind === "must_resolve") {
      return buildMustResolveDiagnostics(rule, anchorExtraction);
    }

    return {
      id: rule.id,
      kind: rule.kind,
      fromAnchorType: rule.from_anchor_type,
      toAnchorType: rule.to_anchor_type,
      ok: true,
      resolved: [],
      unresolved: [],
      stats: {
        fromInstances: 0,
        fromValues: 0,
        toInstances: 0,
        toValues: 0,
        resolved: 0,
        unresolved: 0,
      },
    };
  });
}

function flattenUnresolved(traceRuleResults) {
  const unresolved = [];
  for (const result of traceRuleResults) {
    for (const item of result.unresolved) {
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
  if (!facts.policy.anchors) return {};

  const detected = (facts.anchors?.instances || []).map(cloneAnchorInstance);
  const changedPaths = new Set(facts.derived.changedPaths || []);
  const changed = detected
    .filter((instance) => changedPaths.has(instance.file))
    .map(cloneAnchorInstance);
  const declaredByContract = declaredContractAnchors(facts.contract);
  const traceRuleResults = buildTraceRuleDiagnostics(facts.policy, facts.anchors || {});
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
