const CHECK_FIELDS = new Set([
  "ok",
  "advisory",
  "message",
  "details",
  "errors",
  "hint",
  "rule",
  "severity",
  "data",
]);

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isScalar(value) {
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}

function formatList(values) {
  return values.length > 0 ? values.join(", ") : "(none)";
}

function compactValue(value) {
  if (Array.isArray(value)) return value.map(compactValue).filter((item) => item !== undefined);
  if (!isPlainObject(value)) return value;

  const compacted = {};
  for (const [key, nested] of Object.entries(value)) {
    const clean = compactValue(nested);
    if (clean !== undefined) compacted[key] = clean;
  }
  return compacted;
}

function checkData(check) {
  if (isPlainObject(check.data)) return check.data;

  const data = {};
  for (const [key, value] of Object.entries(check || {})) {
    if (CHECK_FIELDS.has(key) || value === undefined) continue;
    const compacted = compactValue(value);
    if (Array.isArray(compacted) && compacted.length === 0) continue;
    if (isPlainObject(compacted) && Object.keys(compacted).length === 0) continue;
    data[key] = compacted;
  }
  return data;
}

function dataDetails(data, { includeComplex }) {
  const details = [];
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue;
    if (isScalar(value)) {
      details.push(`${key}: ${value}`);
    } else if (Array.isArray(value) && value.every(isScalar)) {
      if (value.length > 0) details.push(`${key}: ${formatList(value)}`);
    } else if (includeComplex && isPlainObject(value) && Object.values(value).every(isScalar)) {
      details.push(`${key}: ${JSON.stringify(value)}`);
    } else if (includeComplex && Array.isArray(value) && value.length > 0) {
      details.push(`${key}: ${value.length} item(s)`);
    }
  }
  return details;
}

function asList(value) {
  if (!value) return [];
  return Array.isArray(value) ? value.map(String) : [String(value)];
}

export function detailFromCheck(check) {
  const explicitDetails = asList(check.details);
  const errors = asList(check.errors);
  const data = checkData(check);
  const includeComplex = explicitDetails.length === 0 && errors.length === 0;
  return [
    ...asList(check.message),
    ...dataDetails(data, { includeComplex }),
    ...explicitDetails,
    ...errors,
    ...asList(check.hint).map((hint) => `hint: ${hint}`),
  ];
}

function normalizeCheckResult(name, check) {
  const ok = Boolean(check.ok);
  const result = {
    rule: name,
    ok,
    severity: ok ? "pass" : check.advisory ? "warning" : "failure",
    details: detailFromCheck(check),
  };
  const data = checkData(check);

  if (check.message) result.message = check.message;
  if (check.hint) result.hint = check.hint;
  if (Object.keys(data).length > 0) result.data = data;
  return result;
}

function normalizeEnforcement(enforcement) {
  if (typeof enforcement === "string") return { mode: enforcement };
  return enforcement || { mode: "blocking" };
}

export function createAnalysisCollector(enforcementInput, options = {}) {
  const enforcement = normalizeEnforcement(enforcementInput);
  const mode = enforcement.mode;
  const presenter = options.presenter || null;
  let passed = 0;
  let violations = 0;
  let warnings = 0;
  const ruleResults = [];
  const violationDetails = [];
  const warningDetails = [];
  const hints = [];

  return {
    report(name, check) {
      const normalized = normalizeCheckResult(name, check);
      ruleResults.push(normalized);

      if (check.ok) {
        passed++;
        presenter?.check?.({ check: normalized, mode, outcome: "pass" });
        return;
      }

      if (check.advisory) {
        warnings++;
        warningDetails.push(normalized);
        if (normalized.hint) hints.push({ rule: name, message: normalized.hint });
        presenter?.check?.({ check: normalized, mode, outcome: "warning" });
        return;
      }

      violations++;
      violationDetails.push(normalized);
      if (normalized.hint) hints.push({ rule: name, message: normalized.hint });
      presenter?.check?.({ check: normalized, mode, outcome: "violation" });
    },

    finish(extra = {}) {
      const enforcedFailures = mode === "blocking" ? violations : 0;
      const exitCode = enforcedFailures > 0 ? 1 : 0;
      const result = violations > 0 ? "failed" : warnings > 0 ? "passed_with_warnings" : "passed";
      const report = {
        command: extra.command || null,
        mode,
        ok: violations === 0,
        result,
        passed,
        violations: violationDetails,
        advisoryWarnings: warningDetails,
        warnings,
        violationCount: violations,
        failed: enforcedFailures,
        exitCode,
        ruleResults,
        hints,
        ...extra,
      };

      presenter?.finish?.(report);
      return report;
    },

    get violations() {
      return violations;
    },
  };
}
