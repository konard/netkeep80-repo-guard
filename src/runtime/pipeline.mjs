import { buildPolicyFacts } from "../facts/input.mjs";
import { runPolicyChecks } from "../checks/orchestrator.mjs";
import { buildAnchorDiagnostics } from "../reporting/anchor-diagnostics.mjs";
import { createAnalysisCollector } from "./analysis-report.mjs";
import {
  createAnalysisTextPresenter,
  renderDiffAnalysis,
  renderEnforcementMode,
} from "../reporting/renderers.mjs";

export function runPolicyPipeline(input, options = {}) {
  const quiet = options.quiet || false;
  if (!quiet && options.printEnforcement !== false) {
    console.log(renderEnforcementMode(input.enforcement));
  }

  const reporter = createAnalysisCollector(input.enforcement, {
    presenter: quiet ? null : createAnalysisTextPresenter(),
  });

  for (const initialCheck of input.initialChecks || []) {
    reporter.report(initialCheck.name, initialCheck.check);
  }

  const facts = buildPolicyFacts(input);
  if (!quiet) {
    console.log(`\n${renderDiffAnalysis(facts)}`);
  }

  const anchorDiagnostics = buildAnchorDiagnostics(facts);
  runPolicyChecks(facts, reporter, { anchorDiagnostics });

  return reporter.finish({
    command: input.mode,
    repositoryRoot: facts.repositoryRoot,
    diff: {
      changedFiles: facts.diff.files.all.length,
      checkedFiles: facts.diff.files.checked.length,
      skippedOperationalFiles: facts.diagnostics.skippedOperationalFiles,
    },
    ...anchorDiagnostics,
  });
}
