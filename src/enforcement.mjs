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

function detailFromCheck(check) {
  const details = [];
  if (check.message) details.push(check.message);
  if (check.actual !== undefined) details.push(`actual: ${check.actual}, limit: ${check.limit}`);
  if (check.files) details.push(...check.files.map((f) => `file: ${f}`));
  if (check.touched) details.push(...check.touched.map((f) => `touched: ${f}`));
  if (check.must_touch) details.push(`must_touch: ${check.must_touch.join(", ")}`);
  if (check.must_not_touch) details.push(`must_not_touch: ${check.must_not_touch.join(", ")}`);
  if (check.details) details.push(...check.details);
  if (check.errors) details.push(...check.errors);
  if (check.hint) details.push(`hint: ${check.hint}`);
  return details;
}

function violationFromCheck(name, check) {
  return {
    rule: name,
    message: check.message,
    actual: check.actual,
    limit: check.limit,
    files: check.files || [],
    touched: check.touched || [],
    must_touch: check.must_touch || [],
    must_not_touch: check.must_not_touch || [],
    details: check.details || [],
    errors: check.errors || [],
    hint: check.hint,
  };
}

function renderMarkdownTableCell(value) {
  return String(value || "")
    .replaceAll("|", "\\|")
    .replaceAll("\n", "<br>");
}

export function createCheckReporter(mode, options = {}) {
  let passed = 0;
  let violations = 0;
  const quiet = options.quiet || false;
  const ruleResults = [];
  const violationDetails = [];
  const hints = [];

  return {
    report(name, check) {
      const normalized = { rule: name, ok: Boolean(check.ok), details: detailFromCheck(check) };
      ruleResults.push(normalized);

      if (check.ok) {
        passed++;
        if (!quiet) console.log(`  PASS: ${name}`);
        return;
      }

      violations++;
      const violation = violationFromCheck(name, check);
      violationDetails.push(violation);
      if (check.hint) hints.push({ rule: name, message: check.hint });
      const label = mode === "advisory" ? "WARN" : "FAIL";
      if (!quiet) {
        writeViolation(mode, `  ${label}: ${name}`);
        printCheckDetails(mode, check);
      }
    },

    finish(extra = {}) {
      const enforcedFailures = mode === "blocking" ? violations : 0;
      const advisoryPart = mode === "advisory" ? `, ${violations} advisory violation(s)` : "";
      const modePart = mode === "advisory" ? "violations reported as warnings" : "violations enforced";
      const exitCode = enforcedFailures > 0 ? 1 : 0;
      const result = violations > 0 ? "failed" : "passed";

      if (!quiet) {
        console.log(`\nSummary: ${passed} passed, ${enforcedFailures} failed${advisoryPart} (mode: ${mode}; ${modePart})`);
        console.log(`Result: ${result} (mode: ${mode}; exit code ${exitCode})`);
      }

      return {
        mode,
        ok: violations === 0,
        result,
        passed,
        violations: violationDetails,
        violationCount: violations,
        failed: enforcedFailures,
        exitCode,
        ruleResults,
        hints,
        ...extra,
      };
    },

    get violations() {
      return violations;
    },
  };
}

export function renderCheckSummary(result) {
  const lines = [
    "## repo-guard summary",
    "",
    `- Result: ${result.result}`,
    `- Mode: ${result.mode}`,
    `- Repository root: \`${result.repositoryRoot}\``,
    `- Checks: ${result.passed} passed, ${result.failed} failed${result.mode === "advisory" ? `, ${result.violationCount} advisory violation(s)` : ""}`,
  ];

  if (result.diff) {
    lines.push(`- Diff: ${result.diff.changedFiles} file(s) changed${result.diff.skippedOperationalFiles ? `, ${result.diff.skippedOperationalFiles} operational skipped` : ""}`);
  }

  if (result.violations.length > 0) {
    lines.push("", "| Rule | Details |", "|---|---|");
    for (const violation of result.violations) {
      const details = detailFromCheck(violation).join("<br>") || "Violation reported";
      lines.push(`| ${renderMarkdownTableCell(violation.rule)} | ${renderMarkdownTableCell(details)} |`);
    }
  }

  if (result.hints.length > 0) {
    lines.push("", "### Hints");
    for (const hint of result.hints) {
      lines.push(`- ${hint.rule}: ${hint.message}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

export function ajvErrors(errors) {
  return (errors || []).map((err) => `${err.instancePath || "/"} ${err.message}`);
}
