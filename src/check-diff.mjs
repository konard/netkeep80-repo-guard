import { resolve } from "node:path";
import { getDiff } from "./git.mjs";
import { warnReservedContractFields } from "./policy-compiler.mjs";
import { resolveEnforcementMode } from "./enforcement.mjs";
import { renderAnalysisReport } from "./reporting/renderers.mjs";
import { loadJSON, loadPolicyRuntime, validationCheck } from "./runtime/validation.mjs";
import { runPolicyPipeline } from "./runtime/pipeline.mjs";

const CHECK_DIFF_USAGE = "Usage: repo-guard check-diff [--base <ref>] [--head <ref>] [--contract <path>] [--change-class <name>] [--format <text|json|summary>] [--enforcement <advisory|blocking>]";
const FORMATS = new Set(["text", "json", "summary"]);
const KNOWN_DIFF_OPTS = new Set(["--base", "--head", "--contract", "--format", "--change-class"]);

function parseCheckDiffArgs(roots, args) {
  let base = null;
  let head = null;
  let contractPath = null;
  let cliChangeClass = null;
  let format = "text";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--base" && args[i + 1]) base = args[++i];
    else if (args[i] === "--head" && args[i + 1]) head = args[++i];
    else if (args[i] === "--contract" && args[i + 1]) {
      contractPath = resolve(roots.repoRoot, args[++i]);
    } else if (args[i] === "--format" && args[i + 1]) {
      format = args[++i];
    } else if (args[i] === "--change-class") {
      const next = args[i + 1];
      if (!next || next.startsWith("-")) {
        return {
          ok: false,
          message: "Error: --change-class requires a name argument",
        };
      }
      cliChangeClass = next;
      i++;
    } else if (args[i].startsWith("-") && !KNOWN_DIFF_OPTS.has(args[i])) {
      return {
        ok: false,
        message: `Unknown option for check-diff: ${args[i]}`,
      };
    }
  }

  if (!FORMATS.has(format)) {
    return {
      ok: false,
      message: `Unknown check-diff format: ${format}`,
    };
  }

  return { ok: true, base, head, contractPath, cliChangeClass, format };
}

export function runCheckDiff(roots, args) {
  const parsed = parseCheckDiffArgs(roots, args);
  if (!parsed.ok) {
    console.error(parsed.message);
    console.error(CHECK_DIFF_USAGE);
    process.exit(1);
  }

  const quiet = parsed.format !== "text";

  const runtime = loadPolicyRuntime(roots, { quiet });
  const { ajv, policy, contractSchema } = runtime;

  if (!runtime.ok) {
    if (!quiet) console.error("\nPolicy compilation failed; aborting enforcement.");
    process.exit(1);
  }

  const enforcement = resolveEnforcementMode({ cliValue: roots.enforcementMode, policy });
  if (!enforcement.ok) {
    console.error(`ERROR: ${enforcement.message}`);
    process.exit(1);
  }

  let contract = null;
  const initialChecks = [];
  if (parsed.contractPath) {
    try {
      const loadedContract = loadJSON(parsed.contractPath);
      const contractCheck = validationCheck(ajv, contractSchema, loadedContract, parsed.contractPath);
      initialChecks.push({ name: "change-contract", check: contractCheck });
      if (contractCheck.ok) {
        contract = loadedContract;
        if (!quiet) {
          for (const w of warnReservedContractFields(contract)) {
            console.warn(`WARN: ${w}`);
          }
        }
      }
    } catch (e) {
      initialChecks.push({
        name: "change-contract",
        check: {
          ok: false,
          message: `Cannot read ${parsed.contractPath}: ${e.message}`,
        },
      });
    }
  }

  let diffText;
  try {
    diffText = getDiff(parsed.base, parsed.head, roots.repoRoot);
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
  const declaredChangeClass = parsed.cliChangeClass || contract?.change_class || null;

  const report = runPolicyPipeline({
    mode: "check-diff",
    repositoryRoot: roots.repoRoot,
    policy,
    contract,
    contractSource: parsed.contractPath ? "cli file" : "none",
    enforcement,
    diffText,
    declaredChangeClass,
    initialChecks,
  }, { quiet });

  const output = renderAnalysisReport(report, { format: parsed.format });
  if (output) console.log(output);

  process.exit(report.exitCode);
}
