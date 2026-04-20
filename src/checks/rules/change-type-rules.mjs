import { detectTouchedSurfaces } from "../../diff/classification.mjs";
import { formatList, uniqueSorted } from "../../utils/collections.mjs";
import {
  checkCanonicalDocsBudget,
  checkNetAddedLinesBudget,
  checkNewFilesBudget,
} from "./budgets.mjs";
import { checkNewFileRules } from "./new-file-rules.mjs";

export function checkChangeTypeRules(files, policy, changeType) {
  const changeTypeRules = policy.change_type_rules || {};
  if (Object.keys(changeTypeRules).length === 0) return { ok: true };

  const changeTypeValue = changeType || null;
  if (!changeTypeValue) {
    return {
      ok: false,
      message: "change_type_rules requires a declared change_type",
      change_type: null,
      hint: "Set change_type in the contract.",
    };
  }

  const rule = changeTypeRules[changeTypeValue];
  if (!rule) {
    return {
      ok: false,
      message: `change_type "${changeTypeValue}" is not defined in change_type_rules`,
      change_type: changeTypeValue,
      details: [`known change types: ${formatList(Object.keys(changeTypeRules).sort())}`],
      hint: "Define the change type in change_type_rules or use one of the configured types.",
    };
  }

  const detectedSurfaces = detectTouchedSurfaces(files, policy.surfaces);
  const touchedSurfaces = detectedSurfaces.touched_surfaces;
  const requiredSurfaces = uniqueSorted(rule.require_surfaces || []);
  const allowedSurfaces = uniqueSorted(rule.allow_surfaces || []);
  const forbiddenSurfaces = uniqueSorted(rule.forbid_surfaces || []);
  const allowedSet = new Set(allowedSurfaces);
  const forbiddenSet = new Set(forbiddenSurfaces);
  const touchedSet = new Set(touchedSurfaces);
  const usesSurfaceConstraints = requiredSurfaces.length > 0 ||
    allowedSurfaces.length > 0 ||
    forbiddenSurfaces.length > 0;
  const unclassifiedFiles = detectedSurfaces.unclassified_files;
  const hasUnclassifiedViolation = usesSurfaceConstraints && unclassifiedFiles.length > 0;
  const missingRequiredSurfaces = requiredSurfaces.filter((surface) => !touchedSet.has(surface));
  const notAllowedSurfaces = allowedSurfaces.length > 0
    ? touchedSurfaces.filter((surface) => !allowedSet.has(surface))
    : [];
  const explicitlyForbiddenSurfaces = touchedSurfaces.filter((surface) => forbiddenSet.has(surface));
  const violatingSurfaces = uniqueSorted([...notAllowedSurfaces, ...explicitlyForbiddenSurfaces]);

  const newFileResult = rule.new_file_rules
    ? checkNewFileRules(files, policy.new_file_classes, { [changeTypeValue]: rule.new_file_rules }, changeTypeValue)
    : { ok: true };
  const docsBudget = checkCanonicalDocsBudget(files, policy.paths.canonical_docs, rule.max_new_docs);
  const newFilesBudget = checkNewFilesBudget(files, rule.max_new_files);
  const netLinesBudget = checkNetAddedLinesBudget(files, rule.max_net_added_lines);

  const details = [
    ...missingRequiredSurfaces.map(
      (surface) => `required surface ${surface} was not touched by change_type_rules["${changeTypeValue}"].require_surfaces`
    ),
    ...violatingSurfaces.map(
      (surface) => `surface ${surface} violated change_type_rules["${changeTypeValue}"] surface constraints; files: ${detectedSurfaces.files_by_surface[surface].join(", ")}`
    ),
  ];
  if (hasUnclassifiedViolation) {
    details.push(`changed files matched no declared surface: ${unclassifiedFiles.join(", ")}`);
  }
  if (!docsBudget.ok) {
    details.push(`new docs ${docsBudget.actual} exceeds change_type_rules["${changeTypeValue}"].max_new_docs ${docsBudget.limit}; files: ${docsBudget.files.join(", ")}`);
  }
  if (!newFilesBudget.ok) {
    details.push(`new files ${newFilesBudget.actual} exceeds change_type_rules["${changeTypeValue}"].max_new_files ${newFilesBudget.limit}; files: ${newFilesBudget.files.join(", ")}`);
  }
  if (!netLinesBudget.ok) {
    details.push(`net added lines ${netLinesBudget.actual} exceeds change_type_rules["${changeTypeValue}"].max_net_added_lines ${netLinesBudget.limit}`);
  }
  if (!newFileResult.ok) {
    details.push(...(newFileResult.details || [newFileResult.message]).filter(Boolean));
  }

  const ok = missingRequiredSurfaces.length === 0 &&
    violatingSurfaces.length === 0 &&
    !hasUnclassifiedViolation &&
    docsBudget.ok &&
    newFilesBudget.ok &&
    netLinesBudget.ok &&
    newFileResult.ok;

  return {
    ok,
    message: ok ? undefined : `change_type "${changeTypeValue}" violated change_type_rules`,
    change_type: changeTypeValue,
    touched_surfaces: touchedSurfaces,
    required_surfaces: requiredSurfaces,
    allowed_surfaces: allowedSurfaces,
    forbidden_surfaces: forbiddenSurfaces,
    missing_required_surfaces: missingRequiredSurfaces,
    violating_surfaces: violatingSurfaces,
    files_by_surface: detectedSurfaces.files_by_surface,
    unclassified_files: unclassifiedFiles,
    docs_budget: docsBudget,
    new_files_budget: newFilesBudget,
    net_added_lines_budget: netLinesBudget,
    new_file_rules: newFileResult,
    details,
    hint: hasUnclassifiedViolation ? "Add matching surface globs so change_type_rules can classify every changed file." : undefined,
  };
}

export const changeTypeRuleFamily = {
  id: "change-type-rules",
  applies(facts) {
    return Boolean(facts.policy.change_type_rules);
  },
  evaluate(facts) {
    return {
      name: "change-type-rules",
      check: checkChangeTypeRules(
        facts.diff.files.checked,
        facts.policy,
        facts.contract?.change_type
      ),
    };
  },
};
