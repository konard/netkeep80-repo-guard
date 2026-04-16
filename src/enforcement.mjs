const MODE_ALIASES = new Map([
  ["advisory", "advisory"],
  ["warn", "advisory"],
  ["blocking", "blocking"],
  ["enforce", "blocking"],
]);

export function normalizeEnforcementMode(value, label = "enforcement") {
  const raw = String(value || "").trim().toLowerCase();
  const mode = MODE_ALIASES.get(raw);
  if (!mode) {
    return {
      ok: false,
      message: `Unknown ${label}: ${value}. Must be one of: advisory, warn, blocking, enforce.`,
    };
  }
  return { ok: true, mode };
}

export function resolveEnforcementMode({ cliValue, policy }) {
  const policyValue = policy?.enforcement?.mode;
  const raw = cliValue || policyValue || "blocking";
  const source = cliValue ? "cli" : policyValue ? "policy" : "default";
  const result = normalizeEnforcementMode(raw, "enforcement mode");
  if (!result.ok) return result;
  return { ok: true, mode: result.mode, source, requested: raw };
}

export function printEnforcementMode(enforcement) {
  if (enforcement.mode === "advisory") {
    console.log("Enforcement mode: advisory (policy violations are reported as warnings; exit code remains 0)");
  } else {
    console.log("Enforcement mode: blocking (policy violations are enforced; exit code is 1 when violations exist)");
  }
}

function writeViolation(mode, message) {
  if (mode === "advisory") {
    console.warn(message);
  } else {
    console.error(message);
  }
}

function printCheckDetails(mode, check) {
  const write = (message) => writeViolation(mode, message);

  if (check.message) {
    write(`    ${check.message}`);
  }
  if (check.actual !== undefined) {
    write(`    actual: ${check.actual}, limit: ${check.limit}`);
  }
  if (check.files) {
    for (const f of check.files) write(`    - ${f}`);
  }
  if (check.touched) {
    for (const f of check.touched) write(`    - ${f}`);
  }
  if (check.must_touch) {
    write(`    must_touch: ${check.must_touch.join(", ")}`);
  }
  if (check.must_not_touch) {
    write(`    must_not_touch: ${check.must_not_touch.join(", ")}`);
  }
  if (check.details) {
    for (const detail of check.details) write(`    ${detail}`);
  }
  if (check.errors) {
    for (const error of check.errors) write(`    ${error}`);
  }
  if (check.hint) {
    write(`    hint: ${check.hint}`);
  }
}

export function createCheckReporter(mode) {
  let passed = 0;
  let violations = 0;

  return {
    report(name, check) {
      if (check.ok) {
        passed++;
        console.log(`  PASS: ${name}`);
        return;
      }

      violations++;
      const label = mode === "advisory" ? "WARN" : "FAIL";
      writeViolation(mode, `  ${label}: ${name}`);
      printCheckDetails(mode, check);
    },

    finish() {
      const enforcedFailures = mode === "blocking" ? violations : 0;
      const advisoryPart = mode === "advisory" ? `, ${violations} advisory violation(s)` : "";
      const modePart = mode === "advisory" ? "violations reported as warnings" : "violations enforced";
      const exitCode = enforcedFailures > 0 ? 1 : 0;
      const result = violations > 0 ? "failed" : "passed";

      console.log(`\nSummary: ${passed} passed, ${enforcedFailures} failed${advisoryPart} (mode: ${mode}; ${modePart})`);
      console.log(`Result: ${result} (mode: ${mode}; exit code ${exitCode})`);

      return { passed, violations, failed: enforcedFailures, exitCode };
    },

    get violations() {
      return violations;
    },
  };
}

export function ajvErrors(errors) {
  return (errors || []).map((err) => `${err.instancePath || "/"} ${err.message}`);
}
