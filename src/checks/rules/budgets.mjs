import { calculateDiffGrowth } from "../../diff/growth.mjs";

export function checkCanonicalDocsBudget(files, canonicalDocs, maxNewDocs) {
  if (maxNewDocs === undefined) return { ok: true };

  const newDocs = files.filter(
    (file) =>
      file.status === "added" &&
      file.path.match(/\.md$/i) &&
      !canonicalDocs.includes(file.path)
  );

  return {
    ok: newDocs.length <= maxNewDocs,
    actual: newDocs.length,
    limit: maxNewDocs,
    files: newDocs.map((file) => file.path),
  };
}

export function checkNewFilesBudget(files, maxNewFiles) {
  if (maxNewFiles === undefined) return { ok: true };

  const newFiles = files.filter((file) => file.status === "added");
  return {
    ok: newFiles.length <= maxNewFiles,
    actual: newFiles.length,
    limit: maxNewFiles,
    files: newFiles.map((file) => file.path),
  };
}

export function checkNetAddedLinesBudget(files, maxNetAddedLines) {
  if (maxNetAddedLines === undefined) return { ok: true };

  let netAdded = 0;
  for (const file of files) {
    netAdded += file.addedLines.length - (file.deletedLines ? file.deletedLines.length : 0);
  }

  return {
    ok: netAdded <= maxNetAddedLines,
    actual: netAdded,
    limit: maxNetAddedLines,
  };
}

export function checkSurfaceDebt(files, surfaceDebt) {
  const growth = calculateDiffGrowth(files);
  const hasGrowth = growth.new_files > 0 || growth.net_added_lines > 0;

  if (!hasGrowth) {
    return {
      ok: true,
      status: "not_needed",
      growth,
    };
  }

  if (!surfaceDebt) {
    return {
      ok: true,
      status: "undeclared",
      growth,
      details: [
        `new files: ${growth.new_files}`,
        `net added lines: ${growth.net_added_lines}`,
      ],
    };
  }

  const missing = [];
  if (!surfaceDebt.repayment_issue) missing.push("repayment_issue");

  if (missing.length > 0) {
    return {
      ok: false,
      status: "missing_repayment_target",
      message: `declared surface debt is missing repayment target: ${missing.join(", ")}`,
      growth,
      surface_debt: surfaceDebt,
      details: missing.map((field) => `missing ${field}`),
      hint: "Set repayment_issue to the issue number where the temporary growth will be repaid.",
    };
  }

  const expectedDelta = surfaceDebt.expected_delta || {};
  const exceeded = [];
  if (
    expectedDelta.max_new_files !== undefined &&
    growth.new_files > expectedDelta.max_new_files
  ) {
    exceeded.push(`new files ${growth.new_files} exceeds declared debt ${expectedDelta.max_new_files}`);
  }
  if (
    expectedDelta.max_net_added_lines !== undefined &&
    growth.net_added_lines > expectedDelta.max_net_added_lines
  ) {
    exceeded.push(`net added lines ${growth.net_added_lines} exceeds declared debt ${expectedDelta.max_net_added_lines}`);
  }

  return {
    ok: exceeded.length === 0,
    status: exceeded.length === 0 ? "declared" : "declared_debt_exceeded",
    message: exceeded.length > 0 ? "declared surface debt is smaller than actual diff growth" : undefined,
    growth,
    surface_debt: surfaceDebt,
    details: exceeded,
    hint: exceeded.length > 0
      ? "Update expected_delta to match intentional temporary growth or reduce the diff."
      : undefined,
  };
}

export const budgetRuleFamily = {
  id: "budgets",
  evaluate(facts) {
    const files = facts.diff.files.checked;
    const policy = facts.policy;
    const diffRules = policy.diff_rules || {};
    const budgets = facts.contract?.budgets || {};

    return [
      {
        name: "canonical-docs-budget",
        check: checkCanonicalDocsBudget(
          files,
          policy.paths.canonical_docs,
          budgets.max_new_docs ?? diffRules.max_new_docs
        ),
      },
      {
        name: "max-new-files",
        check: checkNewFilesBudget(
          files,
          budgets.max_new_files ?? diffRules.max_new_files
        ),
      },
      {
        name: "max-net-added-lines",
        check: checkNetAddedLinesBudget(
          files,
          budgets.max_net_added_lines ?? diffRules.max_net_added_lines
        ),
      },
      {
        name: "surface-debt",
        check: checkSurfaceDebt(files, facts.contract?.surface_debt),
      },
    ];
  },
};
