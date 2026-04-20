function writeViolation(mode, message) {
  if (mode === "advisory") {
    console.warn(message);
  } else {
    console.error(message);
  }
}

function printCheckDetails(mode, check) {
  const write = (message) => writeViolation(mode, message);
  for (const detail of check.details || []) write(`    ${detail}`);
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

export function renderEnforcementMode(enforcement) {
  if (enforcement.mode === "advisory") {
    return "Enforcement mode: advisory (policy violations are reported as warnings; exit code remains 0)";
  }
  return "Enforcement mode: blocking (policy violations are enforced; exit code is 1 when violations exist)";
}

export function renderDiffAnalysis(facts) {
  const skipped = facts.diagnostics.skippedOperationalFiles;
  return `Diff analysis: ${facts.diff.files.all.length} file(s) changed${skipped ? ` (${skipped} operational skipped)` : ""}`;
}

export function createAnalysisTextPresenter() {
  return {
    check({ check, mode, outcome }) {
      if (outcome === "pass") {
        console.log(`  PASS: ${check.rule}`);
        return;
      }

      if (outcome === "warning") {
        writeViolation("advisory", `  WARN: ${check.rule}`);
        printCheckDetails("advisory", check);
        return;
      }

      const label = mode === "advisory" ? "WARN" : "FAIL";
      writeViolation(mode, `  ${label}: ${check.rule}`);
      printCheckDetails(mode, check);
    },

    finish(report) {
      const advisoryPart = report.mode === "advisory" ? `, ${report.violationCount} advisory violation(s)` : "";
      const modePart = report.mode === "advisory" ? "violations reported as warnings" : "violations enforced";
      const warningPart = report.warnings > 0 ? `, ${report.warnings} warning(s)` : "";

      console.log(`\nSummary: ${report.passed} passed, ${report.failed} failed${advisoryPart}${warningPart} (mode: ${report.mode}; ${modePart})`);
      console.log(`Result: ${report.result} (mode: ${report.mode}; exit code ${report.exitCode})`);
    },
  };
}

function renderCountLine(report, label) {
  return `- ${label}: ${report.passed} passed, ${report.failed} failed${report.mode === "advisory" ? `, ${report.violationCount} advisory violation(s)` : ""}${report.warnings ? `, ${report.warnings} warning(s)` : ""}`;
}

function renderCheckExtraLines(report) {
  const lines = [];

  if (report.diff) {
    lines.push(`- Diff: ${report.diff.changedFiles} file(s) changed${report.diff.skippedOperationalFiles ? `, ${report.diff.skippedOperationalFiles} operational skipped` : ""}`);
  }

  if (report.anchors) {
    const stats = report.anchors.stats;
    lines.push(`- Anchors: ${stats.detected} detected, ${stats.changed} changed, ${stats.declaredByContract} declared, ${stats.unresolved} unresolved`);

    if (report.anchors.unresolved.length > 0) {
      lines.push("", "| Trace rule | Anchor | Locations |", "|---|---|---|");
      for (const unresolved of report.anchors.unresolved.slice(0, 10)) {
        const anchor = `${unresolved.fromAnchorType} -> ${unresolved.toAnchorType}: ${unresolved.value}`;
        const locations = unresolved.instances.map(formatAnchorLocation).join(", ");
        lines.push(`| ${renderMarkdownTableCell(unresolved.rule)} | ${renderMarkdownTableCell(anchor)} | ${renderMarkdownTableCell(locations)} |`);
      }
      if (report.anchors.unresolved.length > 10) {
        lines.push(`| ... | ... | ${report.anchors.unresolved.length - 10} more unresolved anchor(s) |`);
      }
    }
  }

  return lines;
}

function renderIntegrationExtraLines(report) {
  const declared = report.diagnostics.declared;
  const extracted = report.diagnostics.extracted;
  return [
    `- Declared: ${declared.workflows} workflow(s), ${declared.templates} template(s), ${declared.docs} doc(s), ${declared.profiles} profile(s)`,
    `- Extracted: ${extracted.workflows} workflow(s), ${extracted.templates} template(s), ${extracted.docs} doc(s), ${extracted.profiles} profile(s), ${extracted.errors} artifact error(s)`,
  ];
}

function renderResultTable(lines, heading, entries, fallback) {
  if (!entries || entries.length === 0) return;

  lines.push("", `| ${heading} | Details |`, "|---|---|");
  for (const entry of entries) {
    const details = (entry.details || []).join("<br>") || fallback;
    lines.push(`| ${renderMarkdownTableCell(entry.rule)} | ${renderMarkdownTableCell(details)} |`);
  }
}

function renderMarkdownSummary(report, {
  title,
  countLabel,
  violationLabel,
  violationFallback,
  extraLines = () => [],
}) {
  const lines = [
    `## ${title}`,
    "",
    `- Result: ${report.result}`,
    `- Mode: ${report.mode}`,
    `- Repository root: \`${report.repositoryRoot}\``,
    renderCountLine(report, countLabel),
    ...extraLines(report),
  ];

  renderResultTable(lines, violationLabel, report.violations, violationFallback);
  renderResultTable(lines, "Advisory", report.advisoryWarnings, "Warning reported");

  if (report.hints.length > 0) {
    lines.push("", "### Hints");
    for (const hint of report.hints) {
      lines.push(`- ${hint.rule}: ${hint.message}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

export function renderCheckSummary(report) {
  return renderMarkdownSummary(report, {
    title: "repo-guard summary",
    countLabel: "Checks",
    violationLabel: "Rule",
    violationFallback: "Violation reported",
    extraLines: renderCheckExtraLines,
  });
}

export function renderIntegrationSummary(report) {
  return renderMarkdownSummary(report, {
    title: "repo-guard integration summary",
    countLabel: "Diagnostics",
    violationLabel: "Diagnostic",
    violationFallback: "Diagnostic reported",
    extraLines: renderIntegrationExtraLines,
  });
}

export function renderAnalysisReport(report, { format, summary } = {}) {
  if (format === "json") {
    return JSON.stringify(report, null, 2);
  }
  if (format === "summary") {
    const summaryKind = summary || (report.command === "validate-integration" ? "integration" : "check");
    return summaryKind === "integration"
      ? renderIntegrationSummary(report)
      : renderCheckSummary(report);
  }
  return null;
}
