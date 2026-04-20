import { uniqueSorted } from "../utils/collections.mjs";
import { matchesAny } from "../utils/path-patterns.mjs";

const CONTRACT_ANCHOR_FIELDS = new Map([
  ["anchors.affects", ["anchors", "affects"]],
  ["anchors.implements", ["anchors", "implements"]],
  ["anchors.verifies", ["anchors", "verifies"]],
]);

function formatAnchorLocation(instance) {
  const line = instance.line ? `:${instance.line}` : "";
  const column = instance.column ? `:${instance.column}` : "";
  return `${instance.file}${line}${column}`;
}

function cloneAnchorInstance(instance) {
  return { ...instance };
}

function groupByValue(instances) {
  const grouped = new Map();
  for (const instance of instances || []) {
    if (!grouped.has(instance.value)) grouped.set(instance.value, []);
    grouped.get(instance.value).push(cloneAnchorInstance(instance));
  }
  return grouped;
}

function changedPaths(facts) {
  return (facts.diff?.files?.checked || []).map((file) => file.path);
}

function matchingPaths(paths, patterns) {
  return uniqueSorted(paths.filter((path) => matchesAny(path, patterns || [])));
}

function contractFieldValues(contract, field) {
  const path = CONTRACT_ANCHOR_FIELDS.get(field);
  if (!path) return [];

  let current = contract || {};
  for (const segment of path) {
    current = current?.[segment];
  }
  if (!Array.isArray(current)) return [];
  return uniqueSorted(current.map((value) => String(value)));
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

function buildChangedFilesRequireEvidenceDiagnostics(rule, facts) {
  const paths = changedPaths(facts);
  const changedFiles = matchingPaths(paths, rule.if_changed);
  const evidenceFiles = matchingPaths(paths, rule.must_touch_any);

  return {
    id: rule.id,
    kind: rule.kind,
    ok: changedFiles.length === 0 || evidenceFiles.length > 0,
    ifChanged: [...(rule.if_changed || [])],
    mustTouchAny: [...(rule.must_touch_any || [])],
    changedFiles,
    evidenceFiles,
    stats: {
      changedFiles: changedFiles.length,
      evidenceFiles: evidenceFiles.length,
    },
  };
}

function buildDeclaredAnchorsRequireEvidenceDiagnostics(rule, facts) {
  const paths = changedPaths(facts);
  const declaredAnchors = contractFieldValues(facts.contract, rule.contract_field);
  const evidenceFiles = matchingPaths(paths, rule.must_touch_any);

  return {
    id: rule.id,
    kind: rule.kind,
    ok: declaredAnchors.length === 0 || evidenceFiles.length > 0,
    contractField: rule.contract_field,
    mustTouchAny: [...(rule.must_touch_any || [])],
    declaredAnchors,
    evidenceFiles,
    stats: {
      declaredAnchors: declaredAnchors.length,
      evidenceFiles: evidenceFiles.length,
    },
  };
}

export function buildTraceRuleDiagnostics(facts) {
  return (facts.policy.trace_rules || []).map((rule) => {
    if (rule.kind === "must_resolve") {
      return buildMustResolveDiagnostics(rule, facts.anchors || {});
    }
    if (rule.kind === "changed_files_require_evidence") {
      return buildChangedFilesRequireEvidenceDiagnostics(rule, facts);
    }
    if (rule.kind === "declared_anchors_require_evidence") {
      return buildDeclaredAnchorsRequireEvidenceDiagnostics(rule, facts);
    }

    return {
      id: rule.id,
      kind: rule.kind,
      ok: true,
      stats: {},
    };
  });
}

function checkMustResolveTraceRuleResult(result) {
  const unresolvedAnchors = (result.unresolved || []).map((item) => {
    const instances = item.instances || [];
    return {
      value: item.value,
      fromAnchorType: result.fromAnchorType,
      toAnchorType: result.toAnchorType,
      locations: instances.map(formatAnchorLocation),
      instances,
    };
  });

  const details = [];
  for (const anchor of unresolvedAnchors) {
    for (const location of anchor.locations) {
      details.push(`${anchor.value} (${anchor.fromAnchorType} -> ${anchor.toAnchorType}) at ${location}`);
    }
  }

  return {
    ok: unresolvedAnchors.length === 0,
    message: unresolvedAnchors.length > 0
      ? `unresolved anchor reference(s) for trace rule "${result.id}"`
      : undefined,
    trace_rule: result.id,
    trace_kind: result.kind,
    from_anchor_type: result.fromAnchorType,
    to_anchor_type: result.toAnchorType,
    unresolved_anchors: unresolvedAnchors,
    files: uniqueSorted(unresolvedAnchors.flatMap((anchor) =>
      anchor.instances.map((instance) => instance.file)
    )),
    details,
  };
}

function evidenceDetails(result) {
  const details = [];
  if (result.changedFiles) details.push(`changed_files: ${result.changedFiles.join(", ")}`);
  if (result.contractField) details.push(`contract_field: ${result.contractField}`);
  if (result.declaredAnchors) details.push(`declared_anchors: ${result.declaredAnchors.join(", ")}`);
  details.push(`must_touch_any: ${result.mustTouchAny.join(", ")}`);
  details.push(`evidence_files: ${result.evidenceFiles.length > 0 ? result.evidenceFiles.join(", ") : "(none)"}`);
  return details;
}

function checkEvidenceTraceRuleResult(result) {
  return {
    ok: result.ok,
    message: result.ok ? undefined : `missing evidence for trace rule "${result.id}"`,
    trace_rule: result.id,
    trace_kind: result.kind,
    if_changed: result.ifChanged,
    must_touch_any: result.mustTouchAny,
    changed_files: result.changedFiles,
    contract_field: result.contractField,
    declared_anchors: result.declaredAnchors,
    evidence_files: result.evidenceFiles,
    files: uniqueSorted([...(result.changedFiles || []), ...(result.evidenceFiles || [])]),
    details: evidenceDetails(result),
  };
}

export function checkTraceRuleResult(result) {
  if (result.kind === "must_resolve") {
    return checkMustResolveTraceRuleResult(result);
  }
  if (
    result.kind === "changed_files_require_evidence" ||
    result.kind === "declared_anchors_require_evidence"
  ) {
    return checkEvidenceTraceRuleResult(result);
  }

  return {
    ok: true,
    trace_rule: result.id,
    trace_kind: result.kind,
    details: [],
  };
}
