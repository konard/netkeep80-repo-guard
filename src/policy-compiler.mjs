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

export function compileAnchorPolicy(policy) {
  const errors = [];
  const anchors = policy.anchors;
  const traceRules = policy.trace_rules || [];
  const anchorTypes = anchors?.types || {};
  const anchorTypeNames = new Set(Object.keys(anchorTypes));
  const traceRuleIds = new Set();
  const contractAnchorFields = new Set(["anchors.affects", "anchors.implements", "anchors.verifies"]);

  if (!anchors && traceRules.length === 0) return errors;

  if (traceRules.some((rule) => rule.kind === "must_resolve") && anchorTypeNames.size === 0) {
    errors.push({ message: "trace_rules.kind = \"must_resolve\" requires anchor types in anchors.types" });
  }

  for (const [anchorType, config] of Object.entries(anchorTypes)) {
    for (const [index, source] of (config.sources || []).entries()) {
      if (source.kind === "regex") {
        try {
          new RegExp(source.pattern);
        } catch (e) {
          errors.push({
            anchor_type: anchorType,
            source_index: index,
            pattern: source.pattern,
            message: `anchors.types["${anchorType}"].sources[${index}].pattern is invalid: ${e.message}`,
          });
        }
      }
    }
  }

  for (const [index, rule] of traceRules.entries()) {
    if (traceRuleIds.has(rule.id)) {
      errors.push({
        trace_rule: rule.id,
        message: `trace_rules[${index}].id duplicates trace rule "${rule.id}"`,
      });
    }
    traceRuleIds.add(rule.id);

    if (rule.kind === "must_resolve") {
      for (const field of ["from_anchor_type", "to_anchor_type"]) {
        const anchorType = rule[field];
        if (!anchorTypeNames.has(anchorType)) {
          errors.push({
            trace_rule: rule.id,
            anchor_type: anchorType,
            message: `trace_rules[${index}].${field} references unknown anchor type "${anchorType}"`,
          });
        }
      }
    } else if (rule.kind === "declared_anchors_require_evidence") {
      if (!contractAnchorFields.has(rule.contract_field)) {
        errors.push({
          trace_rule: rule.id,
          contract_field: rule.contract_field,
          message: `trace_rules[${index}].contract_field must be one of ${[...contractAnchorFields].join(", ")}`,
        });
      }
    }
  }

  return errors;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const integrationSectionRules = {
  workflows: {
    requiredStrings: ["id", "kind", "path", "role"],
    requiredBooleans: [],
    requiredStringArrays: [],
    optionalStringArrays: ["profiles"],
    allowedFields: new Set(["id", "kind", "path", "role", "expect", "profiles"]),
    kinds: new Set(["github_actions"]),
    roles: new Set(["repo_guard_advisory", "repo_guard_policy_validation", "repo_guard_pr_gate"]),
  },
  templates: {
    requiredStrings: ["id", "kind", "path"],
    requiredBooleans: ["requires_contract_block"],
    requiredStringArrays: [],
    optionalStringArrays: ["profiles"],
    allowedFields: new Set(["id", "kind", "path", "requires_contract_block", "profiles"]),
    kinds: new Set(["github_issue_form", "markdown"]),
  },
  docs: {
    requiredStrings: ["id", "path"],
    optionalStrings: ["kind"],
    requiredBooleans: [],
    requiredStringArrays: ["must_mention"],
    optionalStringArrays: ["profiles"],
    allowedFields: new Set(["id", "kind", "path", "must_mention", "profiles"]),
    kinds: new Set(["markdown"]),
  },
  profiles: {
    requiredStrings: ["id", "doc_path"],
    requiredBooleans: [],
    requiredStringArrays: [],
    optionalStringArrays: [],
    allowedFields: new Set(["id", "doc_path"]),
  },
};

const workflowExpectationRules = {
  allowedFields: new Set([
    "events",
    "event_types",
    "action",
    "mode",
    "enforcement",
    "permissions",
    "token_env",
    "required_env",
    "summary",
    "disallow",
  ]),
  actionFields: new Set(["uses", "ref", "ref_pinning"]),
  modes: new Set(["check-pr", "check-diff"]),
  enforcementModes: new Set(["advisory", "blocking"]),
  permissionValues: new Set(["none", "read", "write"]),
  refPinning: new Set(["any", "local", "ref", "tag", "semver", "sha"]),
  disallowedPatterns: new Set(["continue_on_error", "manual_clone", "direct_temp_cli_execution"]),
};

function formatAllowed(values) {
  return [...values].sort().join(", ");
}

function compileIntegrationError(section, index, field, message, extra = {}) {
  return {
    section,
    ...(index !== null && index !== undefined ? { index } : {}),
    ...(field ? { field } : {}),
    ...extra,
    message,
  };
}

function hasNonEmptyString(entry, field) {
  return typeof entry[field] === "string" && entry[field].trim().length > 0;
}

function validateIntegrationString(errors, section, index, entry, field, { required = true } = {}) {
  if (!Object.hasOwn(entry, field)) {
    if (required) {
      errors.push(compileIntegrationError(
        section,
        index,
        field,
        `integration.${section}[${index}].${field} is required`
      ));
    }
    return false;
  }

  if (!hasNonEmptyString(entry, field)) {
    errors.push(compileIntegrationError(
      section,
      index,
      field,
      `integration.${section}[${index}].${field} is required and must be a non-empty string`,
      { value: entry[field] }
    ));
    return false;
  }

  return true;
}

function validateIntegrationBoolean(errors, section, index, entry, field) {
  if (!Object.hasOwn(entry, field)) {
    errors.push(compileIntegrationError(
      section,
      index,
      field,
      `integration.${section}[${index}].${field} is required`
    ));
    return false;
  }

  if (typeof entry[field] !== "boolean") {
    errors.push(compileIntegrationError(
      section,
      index,
      field,
      `integration.${section}[${index}].${field} must be a boolean`,
      { value: entry[field] }
    ));
    return false;
  }

  return true;
}

function validateIntegrationStringArray(errors, section, index, entry, field, { required = true } = {}) {
  if (!Object.hasOwn(entry, field)) {
    if (required) {
      errors.push(compileIntegrationError(
        section,
        index,
        field,
        `integration.${section}[${index}].${field} is required`
      ));
    }
    return [];
  }

  const value = entry[field];
  if (!Array.isArray(value)) {
    errors.push(compileIntegrationError(
      section,
      index,
      field,
      `integration.${section}[${index}].${field} must be an array of non-empty strings`,
      { value }
    ));
    return [];
  }

  const validValues = [];
  for (const [itemIndex, item] of value.entries()) {
    if (typeof item === "string" && item.trim().length > 0) {
      validValues.push(item);
      continue;
    }

    errors.push(compileIntegrationError(
      section,
      index,
      field,
      `integration.${section}[${index}].${field}[${itemIndex}] must be a non-empty string`,
      { value: item }
    ));
  }

  if (validValues.length === 0) {
    errors.push(compileIntegrationError(
      section,
      index,
      field,
      `integration.${section}[${index}].${field} must contain at least one non-empty string`
    ));
  }

  return validValues;
}

function integrationExpectationMessage(index, path, message) {
  return `integration.workflows[${index}].expect.${path} ${message}`;
}

function pushWorkflowExpectationError(errors, index, path, message, extra = {}) {
  errors.push(compileIntegrationError(
    "workflows",
    index,
    `expect.${path}`,
    integrationExpectationMessage(index, path, message),
    extra
  ));
}

function validateExpectationString(errors, index, source, path, { required = false, field = path } = {}) {
  if (!Object.hasOwn(source, field)) {
    if (required) {
      pushWorkflowExpectationError(errors, index, path, "is required");
    }
    return false;
  }

  if (typeof source[field] !== "string" || source[field].trim().length === 0) {
    pushWorkflowExpectationError(
      errors,
      index,
      path,
      "is required and must be a non-empty string",
      { value: source[field] }
    );
    return false;
  }

  return true;
}

function validateExpectationEnum(errors, index, source, path, allowedValues, { required = false, field = path } = {}) {
  if (!validateExpectationString(errors, index, source, path, { required, field })) {
    return;
  }

  if (!allowedValues.has(source[field])) {
    pushWorkflowExpectationError(
      errors,
      index,
      path,
      `must be one of ${formatAllowed(allowedValues)}`,
      { value: source[field] }
    );
  }
}

function validateExpectationStringArray(errors, index, source, path, allowedValues = null) {
  const value = source[path];
  if (!Array.isArray(value)) {
    pushWorkflowExpectationError(
      errors,
      index,
      path,
      "must be an array of non-empty strings",
      { value }
    );
    return [];
  }

  const validValues = [];
  for (const [itemIndex, item] of value.entries()) {
    const itemPath = `${path}[${itemIndex}]`;
    if (typeof item !== "string" || item.trim().length === 0) {
      pushWorkflowExpectationError(
        errors,
        index,
        itemPath,
        "must be a non-empty string",
        { value: item }
      );
      continue;
    }

    if (allowedValues && !allowedValues.has(item)) {
      pushWorkflowExpectationError(
        errors,
        index,
        itemPath,
        `must be one of ${formatAllowed(allowedValues)}`,
        { value: item }
      );
      continue;
    }

    validValues.push(item);
  }

  if (validValues.length === 0) {
    pushWorkflowExpectationError(
      errors,
      index,
      path,
      "must contain at least one non-empty string"
    );
  }

  return validValues;
}

function validateWorkflowExpectations(errors, index, entry) {
  if (!Object.hasOwn(entry, "expect")) return;

  const expect = entry.expect;
  if (!isPlainObject(expect)) {
    errors.push(compileIntegrationError(
      "workflows",
      index,
      "expect",
      `integration.workflows[${index}].expect must be an object`,
      { value: expect }
    ));
    return;
  }

  for (const field of Object.keys(expect)) {
    if (!workflowExpectationRules.allowedFields.has(field)) {
      pushWorkflowExpectationError(errors, index, field, "is not supported");
    }
  }

  for (const field of ["events", "event_types", "token_env", "required_env"]) {
    if (Object.hasOwn(expect, field)) {
      validateExpectationStringArray(errors, index, expect, field);
    }
  }

  if (Object.hasOwn(expect, "mode")) {
    validateExpectationEnum(errors, index, expect, "mode", workflowExpectationRules.modes);
  }

  if (Object.hasOwn(expect, "enforcement")) {
    validateExpectationEnum(errors, index, expect, "enforcement", workflowExpectationRules.enforcementModes);
  }

  if (Object.hasOwn(expect, "summary") && typeof expect.summary !== "boolean") {
    pushWorkflowExpectationError(
      errors,
      index,
      "summary",
      "must be a boolean",
      { value: expect.summary }
    );
  }

  if (Object.hasOwn(expect, "disallow")) {
    validateExpectationStringArray(errors, index, expect, "disallow", workflowExpectationRules.disallowedPatterns);
  }

  if (Object.hasOwn(expect, "permissions")) {
    if (!isPlainObject(expect.permissions)) {
      pushWorkflowExpectationError(
        errors,
        index,
        "permissions",
        "must be an object",
        { value: expect.permissions }
      );
    } else {
      const entries = Object.entries(expect.permissions);
      if (entries.length === 0) {
        pushWorkflowExpectationError(errors, index, "permissions", "must declare at least one permission");
      }
      for (const [permission, value] of entries) {
        if (!workflowExpectationRules.permissionValues.has(value)) {
          pushWorkflowExpectationError(
            errors,
            index,
            `permissions.${permission}`,
            `must be one of ${formatAllowed(workflowExpectationRules.permissionValues)}`,
            { value }
          );
        }
      }
    }
  }

  if (Object.hasOwn(expect, "action")) {
    if (!isPlainObject(expect.action)) {
      pushWorkflowExpectationError(
        errors,
        index,
        "action",
        "must be an object",
        { value: expect.action }
      );
    } else {
      for (const field of Object.keys(expect.action)) {
        if (!workflowExpectationRules.actionFields.has(field)) {
          pushWorkflowExpectationError(errors, index, `action.${field}`, "is not supported");
        }
      }
      for (const field of ["uses", "ref"]) {
        if (Object.hasOwn(expect.action, field)) {
          validateExpectationString(errors, index, expect.action, `action.${field}`, { field });
        }
      }
      if (Object.hasOwn(expect.action, "ref_pinning")) {
        validateExpectationEnum(
          errors,
          index,
          expect.action,
          "action.ref_pinning",
          workflowExpectationRules.refPinning,
          { field: "ref_pinning" }
        );
      }
    }
  }
}

export function compileIntegrationPolicy(policy) {
  const errors = [];
  const integration = policy.integration;

  if (!integration) return errors;

  if (!isPlainObject(integration)) {
    return [compileIntegrationError(null, null, null, "integration must be an object")];
  }

  const sectionNames = Object.keys(integrationSectionRules);
  const profileReferences = [];
  const profileIds = new Set();
  const globalIds = new Map();

  for (const section of Object.keys(integration)) {
    if (!Object.hasOwn(integrationSectionRules, section)) {
      errors.push(compileIntegrationError(
        section,
        null,
        null,
        `integration.${section} is not supported; use ${sectionNames.join(", ")}`
      ));
    }
  }

  for (const section of sectionNames) {
    const rules = integrationSectionRules[section];
    const seen = new Map();
    const sectionValue = integration[section];
    if (sectionValue === undefined) continue;

    if (!Array.isArray(sectionValue)) {
      errors.push(compileIntegrationError(
        section,
        null,
        null,
        `integration.${section} must be an array`
      ));
      continue;
    }

    const entries = sectionValue;
    for (const [index, entry] of entries.entries()) {
      if (!isPlainObject(entry)) {
        errors.push(compileIntegrationError(
          section,
          index,
          null,
          `integration.${section}[${index}] must be an object`
        ));
        continue;
      }

      for (const field of Object.keys(entry)) {
        if (!rules.allowedFields.has(field)) {
          errors.push(compileIntegrationError(
            section,
            index,
            field,
            `integration.${section}[${index}].${field} is not supported`
          ));
        }
      }

      for (const field of rules.requiredStrings || []) {
        validateIntegrationString(errors, section, index, entry, field);
      }

      for (const field of rules.optionalStrings || []) {
        validateIntegrationString(errors, section, index, entry, field, { required: false });
      }

      for (const field of rules.requiredBooleans || []) {
        validateIntegrationBoolean(errors, section, index, entry, field);
      }

      for (const field of rules.requiredStringArrays || []) {
        validateIntegrationStringArray(errors, section, index, entry, field);
      }

      for (const field of rules.optionalStringArrays || []) {
        const references = validateIntegrationStringArray(errors, section, index, entry, field, { required: false });
        for (const profileId of references) {
          profileReferences.push({ section, index, field, profileId });
        }
      }

      if (rules.kinds && hasNonEmptyString(entry, "kind") && !rules.kinds.has(entry.kind)) {
        errors.push(compileIntegrationError(
          section,
          index,
          "kind",
          `integration.${section}[${index}].kind must be one of ${formatAllowed(rules.kinds)}`,
          { value: entry.kind }
        ));
      }

      if (rules.roles && hasNonEmptyString(entry, "role") && !rules.roles.has(entry.role)) {
        errors.push(compileIntegrationError(
          section,
          index,
          "role",
          `integration.${section}[${index}].role must be one of ${formatAllowed(rules.roles)}`,
          { value: entry.role }
        ));
      }

      if (section === "workflows") {
        validateWorkflowExpectations(errors, index, entry);
      }

      if (!hasNonEmptyString(entry, "id")) continue;

      if (seen.has(entry.id)) {
        errors.push({
          section,
          id: entry.id,
          index,
          message: `integration.${section}[${index}].id duplicates integration.${section}[${seen.get(entry.id)}].id "${entry.id}"`,
        });
      } else {
        seen.set(entry.id, index);
      }

      if (globalIds.has(entry.id)) {
        const previous = globalIds.get(entry.id);
        if (previous.section !== section) {
          errors.push({
            section,
            id: entry.id,
            index,
            previous_section: previous.section,
            previous_index: previous.index,
            message: `integration.${section}[${index}].id duplicates integration.${previous.section}[${previous.index}].id "${entry.id}"`,
          });
        }
      } else {
        globalIds.set(entry.id, { section, index });
      }

      if (section === "profiles") {
        profileIds.add(entry.id);
      }
    }
  }

  for (const reference of profileReferences) {
    if (profileIds.has(reference.profileId)) continue;
    errors.push(compileIntegrationError(
      reference.section,
      reference.index,
      reference.field,
      `integration.${reference.section}[${reference.index}].${reference.field} references unknown integration.profiles id "${reference.profileId}"`,
      { profile_id: reference.profileId }
    ));
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
