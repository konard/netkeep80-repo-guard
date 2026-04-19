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

export function compileNewFilePolicy(policy) {
  const errors = [];
  const newFileClasses = policy.new_file_classes || {};
  const classNames = new Set(Object.keys(newFileClasses));
  const changeClasses = new Set(policy.change_classes || []);
  const newFileRules = policy.new_file_rules || {};

  if (!policy.new_file_rules) return errors;

  if (classNames.size === 0) {
    errors.push({ message: "new_file_rules requires at least one named class in new_file_classes" });
  }
  if (changeClasses.size === 0) {
    errors.push({ message: "new_file_rules requires at least one named change class in change_classes" });
  }

  for (const [changeClass, rule] of Object.entries(newFileRules)) {
    if (changeClasses.size > 0 && !changeClasses.has(changeClass)) {
      errors.push({
        change_class: changeClass,
        message: `new_file_rules entry "${changeClass}" is not listed in change_classes`,
      });
    }

    if (!Object.hasOwn(rule, "allow_classes")) {
      errors.push({
        change_class: changeClass,
        message: `new_file_rules["${changeClass}"].allow_classes is required; use [] to forbid all new-file classes`,
      });
    }

    for (const fileClass of rule.allow_classes || []) {
      if (!classNames.has(fileClass)) {
        errors.push({
          change_class: changeClass,
          class: fileClass,
          message: `new_file_rules["${changeClass}"].allow_classes references unknown class "${fileClass}"`,
        });
      }
    }

    for (const fileClass of Object.keys(rule.max_per_class || {})) {
      if (!classNames.has(fileClass)) {
        errors.push({
          change_class: changeClass,
          class: fileClass,
          message: `new_file_rules["${changeClass}"].max_per_class references unknown class "${fileClass}"`,
        });
      }
    }
  }

  return errors;
}

export function compileChangeTypePolicy(policy) {
  const errors = [];
  const changeTypeRules = policy.change_type_rules || {};
  const surfaces = policy.surfaces || {};
  const surfaceNames = new Set(Object.keys(surfaces));
  const newFileClasses = policy.new_file_classes || {};
  const classNames = new Set(Object.keys(newFileClasses));

  if (!policy.change_type_rules) return errors;

  for (const [changeType, rule] of Object.entries(changeTypeRules)) {
    for (const field of ["allow_surfaces", "forbid_surfaces", "require_surfaces"]) {
      for (const surface of rule[field] || []) {
        if (!surfaceNames.has(surface)) {
          errors.push({
            change_type: changeType,
            surface,
            message: `change_type_rules["${changeType}"].${field} references unknown surface "${surface}"`,
          });
        }
      }
    }

    const allowed = new Set(rule.allow_surfaces || []);
    for (const surface of rule.forbid_surfaces || []) {
      if (allowed.has(surface)) {
        errors.push({
          change_type: changeType,
          surface,
          message: `change_type_rules["${changeType}"] lists surface "${surface}" in both allow_surfaces and forbid_surfaces`,
        });
      }
    }

    const newFileRules = rule.new_file_rules;
    if (!newFileRules) continue;

    if (!Object.hasOwn(newFileRules, "allow_classes")) {
      errors.push({
        change_type: changeType,
        message: `change_type_rules["${changeType}"].new_file_rules.allow_classes is required; use [] to forbid all new-file classes`,
      });
    }

    for (const fileClass of newFileRules.allow_classes || []) {
      if (!classNames.has(fileClass)) {
        errors.push({
          change_type: changeType,
          class: fileClass,
          message: `change_type_rules["${changeType}"].new_file_rules.allow_classes references unknown class "${fileClass}"`,
        });
      }
    }

    for (const fileClass of Object.keys(newFileRules.max_per_class || {})) {
      if (!classNames.has(fileClass)) {
        errors.push({
          change_type: changeType,
          class: fileClass,
          message: `change_type_rules["${changeType}"].new_file_rules.max_per_class references unknown class "${fileClass}"`,
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
