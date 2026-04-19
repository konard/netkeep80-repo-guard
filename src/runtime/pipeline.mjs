import { createCheckReporter, printEnforcementMode } from "../enforcement.mjs";
import { buildPolicyFacts } from "../facts/input.mjs";
import { runPolicyChecks } from "../checks/orchestrator.mjs";
import { buildAnchorDiagnostics } from "../reporting/anchor-diagnostics.mjs";

export function runPolicyPipeline(input, options = {}) {
  const quiet = options.quiet || false;
  if (!quiet && options.printEnforcement !== false) {
    printEnforcementMode(input.enforcement);
  }

  const reporter = createCheckReporter(input.enforcement.mode, { quiet });

  for (const initialCheck of input.initialChecks || []) {
    reporter.report(initialCheck.name, initialCheck.check);
  }

  const facts = buildPolicyFacts(input);
  if (!quiet) {
    const skipped = facts.diagnostics.skippedOperationalFiles;
    console.log(`\nDiff analysis: ${facts.diff.files.all.length} file(s) changed${skipped ? ` (${skipped} operational skipped)` : ""}`);
  }

  runPolicyChecks(facts, reporter);
  const anchorDiagnostics = buildAnchorDiagnostics(facts);

  return reporter.finish({
    repositoryRoot: facts.repositoryRoot,
    diff: {
      changedFiles: facts.diff.files.all.length,
      checkedFiles: facts.diff.files.checked.length,
      skippedOperationalFiles: facts.diagnostics.skippedOperationalFiles,
    },
    ...anchorDiagnostics,
  });
}
