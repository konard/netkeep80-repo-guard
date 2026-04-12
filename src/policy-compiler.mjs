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
