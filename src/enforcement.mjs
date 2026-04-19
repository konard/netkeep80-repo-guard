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

function formatList(values) {
  return values && values.length > 0 ? values.join(", ") : "(none)";
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function printCheckDetails(mode, check) {
  const write = (message) => writeViolation(mode, message);

  if (check.message) {
    write(`    ${check.message}`);
  }
  if (check.actual !== undefined) {
    write(`    actual: ${check.actual}, limit: ${check.limit}`);
  }
  if (check.status) {
    write(`    status: ${check.status}`);
  }
  if (check.growth) {
    write(`    growth: new_files=${check.growth.new_files}, net_added_lines=${check.growth.net_added_lines}`);
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
  if (hasOwn(check, "change_class")) {
    write(`    change_class: ${check.change_class || "(missing)"}`);
  }
  if (hasOwn(check, "change_type")) {
    write(`    change_type: ${check.change_type || "(missing)"}`);
  }
  if (check.touched_surfaces) {
    write(`    touched_surfaces: ${formatList(check.touched_surfaces)}`);
  }
  if (check.new_files) {
    write(`    new_files: ${formatList(check.new_files)}`);
  }
  if (check.allowed_classes) {
    write(`    allowed_classes: ${formatList(check.allowed_classes)}`);
  }
  if (check.touched_classes) {
    write(`    touched_classes: ${formatList(check.touched_classes)}`);
  }
  if (check.violating_classes) {
    write(`    violating_classes: ${formatList(check.violating_classes)}`);
  }
  if (check.allowed_surfaces) {
    write(`    allowed_surfaces: ${formatList(check.allowed_surfaces)}`);
  }
  if (check.forbidden_surfaces) {
    write(`    forbidden_surfaces: ${formatList(check.forbidden_surfaces)}`);
  }
  if (check.violating_surfaces) {
    write(`    violating_surfaces: ${formatList(check.violating_surfaces)}`);
  }
  if (check.failed_rules) {
    write(`    failed_rules: ${formatList(check.failed_rules)}`);
  }
  if (check.matches) {
    for (const match of check.matches) {
      const sections = match.duplicate_section_titles && match.duplicate_section_titles.length > 0
        ? `, duplicate_sections=${formatList(match.duplicate_section_titles)}`
        : "";
      write(`    match: ${match.changed_file} -> ${match.canonical_file}, score=${match.score}, threshold=${match.threshold}${sections}`);
    }
  }
  if (check.unclassified_files && check.unclassified_files.length > 0) {
    write(`    unclassified_files: ${formatList(check.unclassified_files)}`);
  }
  if (check.class_budget_violations && check.class_budget_violations.length > 0) {
    for (const v of check.class_budget_violations) {
      write(`    class_budget: ${v.class} actual=${v.actual}, limit=${v.limit}, files=${formatList(v.files)}`);
    }
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
  if (check.status) details.push(`status: ${check.status}`);
  if (check.growth) {
    details.push(`growth: new_files=${check.growth.new_files}, net_added_lines=${check.growth.net_added_lines}`);
  }
  if (check.files) details.push(...check.files.map((f) => `file: ${f}`));
  if (check.touched) details.push(...check.touched.map((f) => `touched: ${f}`));
  if (check.must_touch) details.push(`must_touch: ${check.must_touch.join(", ")}`);
  if (check.must_not_touch) details.push(`must_not_touch: ${check.must_not_touch.join(", ")}`);
  if (hasOwn(check, "change_class")) details.push(`change_class: ${check.change_class || "(missing)"}`);
  if (hasOwn(check, "change_type")) details.push(`change_type: ${check.change_type || "(missing)"}`);
  if (check.touched_surfaces) details.push(`touched_surfaces: ${formatList(check.touched_surfaces)}`);
  if (check.new_files) details.push(`new_files: ${formatList(check.new_files)}`);
  if (check.allowed_classes) details.push(`allowed_classes: ${formatList(check.allowed_classes)}`);
  if (check.touched_classes) details.push(`touched_classes: ${formatList(check.touched_classes)}`);
  if (check.violating_classes) details.push(`violating_classes: ${formatList(check.violating_classes)}`);
  if (check.allowed_surfaces) details.push(`allowed_surfaces: ${formatList(check.allowed_surfaces)}`);
  if (check.forbidden_surfaces) details.push(`forbidden_surfaces: ${formatList(check.forbidden_surfaces)}`);
  if (check.violating_surfaces) details.push(`violating_surfaces: ${formatList(check.violating_surfaces)}`);
  if (check.failed_rules) details.push(`failed_rules: ${formatList(check.failed_rules)}`);
  if (check.matches) {
    details.push(...check.matches.map((match) => {
      const sections = match.duplicate_section_titles && match.duplicate_section_titles.length > 0
        ? `, duplicate_sections=${formatList(match.duplicate_section_titles)}`
        : "";
      return `match: ${match.changed_file} -> ${match.canonical_file}, score=${match.score}, threshold=${match.threshold}${sections}`;
    }));
  }
  if (check.unclassified_files && check.unclassified_files.length > 0) {
    details.push(`unclassified_files: ${formatList(check.unclassified_files)}`);
  }
  if (check.class_budget_violations && check.class_budget_violations.length > 0) {
    details.push(...check.class_budget_violations.map(
      (v) => `class_budget: ${v.class} actual=${v.actual}, limit=${v.limit}, files=${formatList(v.files)}`
    ));
  }
  if (check.details) details.push(...check.details);
  if (check.errors) details.push(...check.errors);
  if (check.hint) details.push(`hint: ${check.hint}`);
  return details;
}

function violationFromCheck(name, check) {
  const violation = {
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

  if (check.status) violation.status = check.status;
  if (check.growth) violation.growth = check.growth;
  if (check.surface_debt) violation.surface_debt = check.surface_debt;
  if (hasOwn(check, "change_class")) violation.change_class = check.change_class;
  if (hasOwn(check, "change_type")) violation.change_type = check.change_type;
  if (check.touched_surfaces) violation.touched_surfaces = check.touched_surfaces;
  if (check.new_files) violation.new_files = check.new_files;
  if (check.allowed_classes) violation.allowed_classes = check.allowed_classes;
  if (check.touched_classes) violation.touched_classes = check.touched_classes;
  if (check.violating_classes) violation.violating_classes = check.violating_classes;
  if (check.class_budget_violations) violation.class_budget_violations = check.class_budget_violations;
  if (check.files_by_class) violation.files_by_class = check.files_by_class;
  if (check.allowed_surfaces) violation.allowed_surfaces = check.allowed_surfaces;
  if (check.forbidden_surfaces) violation.forbidden_surfaces = check.forbidden_surfaces;
  if (check.violating_surfaces) violation.violating_surfaces = check.violating_surfaces;
  if (check.files_by_surface) violation.files_by_surface = check.files_by_surface;
  if (check.failed_rules) violation.failed_rules = check.failed_rules;
  if (check.results) violation.results = check.results;
  if (check.matches) violation.matches = check.matches;
  if (check.advisory) violation.advisory = true;
  if (check.unclassified_files && check.unclassified_files.length > 0) {
    violation.unclassified_files = check.unclassified_files;
  }

  return violation;
}

function renderMarkdownTableCell(value) {
  return String(value || "")
    .replaceAll("|", "\\|")
    .replaceAll("\n", "<br>");
}

function formatAnchorLocation(instance) {
  const line = instance.line ? `:${instance.line}` : "";
  const column = instance.column ? `:${instance.column}` : "";
  return `${instance.file}${line}${column}`;
}

export function createCheckReporter(mode, options = {}) {
  let passed = 0;
  let violations = 0;
  let warnings = 0;
  const quiet = options.quiet || false;
  const ruleResults = [];
  const violationDetails = [];
  const warningDetails = [];
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

      if (check.advisory) {
        warnings++;
        const warning = violationFromCheck(name, check);
        warning.advisory = true;
        warningDetails.push(warning);
        if (check.hint) hints.push({ rule: name, message: check.hint });
        if (!quiet) {
          writeViolation("advisory", `  WARN: ${name}`);
          printCheckDetails("advisory", check);
        }
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
      const warningPart = warnings > 0 ? `, ${warnings} warning(s)` : "";
      const result = violations > 0 ? "failed" : warnings > 0 ? "passed_with_warnings" : "passed";

      if (!quiet) {
        console.log(`\nSummary: ${passed} passed, ${enforcedFailures} failed${advisoryPart}${warningPart} (mode: ${mode}; ${modePart})`);
        console.log(`Result: ${result} (mode: ${mode}; exit code ${exitCode})`);
      }

      return {
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
    `- Checks: ${result.passed} passed, ${result.failed} failed${result.mode === "advisory" ? `, ${result.violationCount} advisory violation(s)` : ""}${result.warnings ? `, ${result.warnings} warning(s)` : ""}`,
  ];

  if (result.diff) {
    lines.push(`- Diff: ${result.diff.changedFiles} file(s) changed${result.diff.skippedOperationalFiles ? `, ${result.diff.skippedOperationalFiles} operational skipped` : ""}`);
  }

  if (result.anchors) {
    const stats = result.anchors.stats;
    lines.push(`- Anchors: ${stats.detected} detected, ${stats.changed} changed, ${stats.declaredByContract} declared, ${stats.unresolved} unresolved`);

    if (result.anchors.unresolved.length > 0) {
      lines.push("", "| Trace rule | Anchor | Locations |", "|---|---|---|");
      for (const unresolved of result.anchors.unresolved.slice(0, 10)) {
        const anchor = `${unresolved.fromAnchorType} -> ${unresolved.toAnchorType}: ${unresolved.value}`;
        const locations = unresolved.instances.map(formatAnchorLocation).join(", ");
        lines.push(`| ${renderMarkdownTableCell(unresolved.rule)} | ${renderMarkdownTableCell(anchor)} | ${renderMarkdownTableCell(locations)} |`);
      }
      if (result.anchors.unresolved.length > 10) {
        lines.push(`| ... | ... | ${result.anchors.unresolved.length - 10} more unresolved anchor(s) |`);
      }
    }
  }

  if (result.violations.length > 0) {
    lines.push("", "| Rule | Details |", "|---|---|");
    for (const violation of result.violations) {
      const details = detailFromCheck(violation).join("<br>") || "Violation reported";
      lines.push(`| ${renderMarkdownTableCell(violation.rule)} | ${renderMarkdownTableCell(details)} |`);
    }
  }

  if (result.advisoryWarnings && result.advisoryWarnings.length > 0) {
    lines.push("", "| Advisory | Details |", "|---|---|");
    for (const warning of result.advisoryWarnings) {
      const details = detailFromCheck(warning).join("<br>") || "Warning reported";
      lines.push(`| ${renderMarkdownTableCell(warning.rule)} | ${renderMarkdownTableCell(details)} |`);
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
