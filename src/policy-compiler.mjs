export function compileForbidRegex(contentRules) {
  const errors = [];
  for (const rule of contentRules) {
    if (!rule.forbid_regex) continue;
    for (const pattern of rule.forbid_regex) {
      try {
        new RegExp(pattern);
      } catch (e) {
        errors.push({
          rule_id: rule.id,
          pattern,
          message: e.message,
        });
      }
    }
  }
  return errors;
}

export function compileSurfacePolicy(policy) {
  const errors = [];
  const surfaces = policy.surfaces || {};
  const surfaceNames = new Set(Object.keys(surfaces));
  const changeClasses = new Set(policy.change_classes || []);
  const surfaceMatrix = policy.surface_matrix || {};

  if (!policy.surface_matrix) return errors;

  if (surfaceNames.size === 0) {
    errors.push({ message: "surface_matrix requires at least one named surface in surfaces" });
  }
  if (changeClasses.size === 0) {
    errors.push({ message: "surface_matrix requires at least one named change class in change_classes" });
  }

  for (const [changeClass, rule] of Object.entries(surfaceMatrix)) {
    if (changeClasses.size > 0 && !changeClasses.has(changeClass)) {
      errors.push({
        change_class: changeClass,
        message: `surface_matrix entry "${changeClass}" is not listed in change_classes`,
      });
    }

    const allowed = new Set(rule.allow || []);
    for (const field of ["allow", "forbid"]) {
      for (const surface of rule[field] || []) {
        if (!surfaceNames.has(surface)) {
          errors.push({
            change_class: changeClass,
            surface,
            message: `surface_matrix["${changeClass}"].${field} references unknown surface "${surface}"`,
          });
        }
      }
    }

    for (const surface of rule.forbid || []) {
      if (allowed.has(surface)) {
        errors.push({
          change_class: changeClass,
          surface,
          message: `surface_matrix["${changeClass}"] lists surface "${surface}" in both allow and forbid`,
        });
      }
    }
  }

  return errors;
}

export function warnReservedContractFields(contract) {
  const warnings = [];
  if (contract.overrides && contract.overrides.length > 0) {
    warnings.push(
      `overrides: contains ${contract.overrides.length} entry/entries but is reserved and not enforced at runtime`
    );
  }
  return warnings;
}

export function warnReservedPolicyFields(policy) {
  const warnings = [];
  if (policy.paths?.public_api && policy.paths.public_api.length > 0) {
    warnings.push(
      "paths.public_api: defined but reserved for future use; not enforced at runtime"
    );
  }
  return warnings;
}
