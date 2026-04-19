import {
  checkForbiddenPaths,
  checkCanonicalDocsBudget,
  checkNewFilesBudget,
  checkNetAddedLinesBudget,
  checkSurfaceDebt,
  checkCochangeRules,
  checkNewFileRules,
  checkSurfaceMatrix,
  checkContentRules,
  checkMustTouch,
  checkMustNotTouch,
  checkChangeTypeRules,
  checkRegistryRules,
  checkAdvisoryTextRules,
} from "../diff-checker.mjs";

export function runPolicyChecks(facts, reporter) {
  const policy = facts.policy;
  const files = facts.filteredOperationalFiles;
  const contract = facts.contract;

  const forbiddenViolations = checkForbiddenPaths(files, policy.paths.forbidden);
  reporter.report("forbidden-paths", {
    ok: forbiddenViolations.length === 0,
    files: forbiddenViolations,
  });

  const budgets = contract?.budgets || {};
  reporter.report("canonical-docs-budget", checkCanonicalDocsBudget(
    files,
    policy.paths.canonical_docs,
    budgets.max_new_docs ?? policy.diff_rules.max_new_docs
  ));
  reporter.report("max-new-files", checkNewFilesBudget(
    files,
    budgets.max_new_files ?? policy.diff_rules.max_new_files
  ));
  reporter.report("max-net-added-lines", checkNetAddedLinesBudget(
    files,
    budgets.max_net_added_lines ?? policy.diff_rules.max_net_added_lines
  ));
  reporter.report("surface-debt", checkSurfaceDebt(files, contract?.surface_debt));
  reporter.report("registry-rules", checkRegistryRules(policy.registry_rules, { repoRoot: facts.repositoryRoot }));
  reporter.report(
    "advisory-text-rules",
    checkAdvisoryTextRules(files, policy.advisory_text_rules, {
      repoRoot: facts.repositoryRoot,
      allFiles: facts.trackedFiles,
    })
  );

  if (policy.change_type_rules) {
    reporter.report("change-type-rules", checkChangeTypeRules(files, policy, contract?.change_type));
  }

  if (policy.new_file_rules) {
    reporter.report(
      "new-file-rules",
      checkNewFileRules(files, policy.new_file_classes, policy.new_file_rules, facts.declaredChangeClass)
    );
  }

  if (policy.surface_matrix) {
    reporter.report(
      "surface-matrix",
      checkSurfaceMatrix(
        files,
        policy.surfaces,
        policy.surface_matrix,
        facts.declaredChangeClass,
        { allow_unclassified_files: policy.allow_unclassified_files }
      )
    );
  }

  const cochangeViolations = checkCochangeRules(files, policy.cochange_rules);
  if (cochangeViolations.length > 0) {
    for (const violation of cochangeViolations) {
      reporter.report(`cochange: ${violation.if_changed.join(",")} -> ${violation.must_change_any.join(",")}`, {
        ok: false,
        must_touch: violation.must_change_any,
      });
    }
  } else {
    reporter.report("cochange-rules", { ok: true });
  }

  const contentViolations = checkContentRules(files, policy.content_rules);
  if (contentViolations.length > 0) {
    reporter.report("content-rules", {
      ok: false,
      details: contentViolations.map((v) => `[${v.rule_id}] ${v.file}: "${v.line}" matched /${v.matched_regex}/`),
    });
  } else {
    reporter.report("content-rules", { ok: true });
  }

  if (contract) {
    reporter.report("must-touch", checkMustTouch(files, contract.must_touch));
    reporter.report("must-not-touch", checkMustNotTouch(files, contract.must_not_touch));
  }
}
