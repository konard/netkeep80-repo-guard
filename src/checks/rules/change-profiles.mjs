import { classifyNewFiles, detectTouchedSurfaces } from "../../diff/classification.mjs";
import { formatList, uniqueSorted } from "../../utils/collections.mjs";
import {
  checkCanonicalDocsBudget,
  checkNetAddedLinesBudget,
  checkNewFilesBudget,
} from "./budgets.mjs";

function checkProfileNewFiles(files, newFileClasses, newFilesRule, changeType) {
  if (!newFilesRule) return { ok: true };

  const detected = classifyNewFiles(files, newFileClasses || {});
  const newFiles = detected.new_files;

  if (newFiles.length === 0) {
    return {
      ok: true,
      change_type: changeType,
      new_files: newFiles,
      files_by_class: detected.files_by_class,
      unclassified_files: detected.unclassified_files,
    };
  }

  const allowedClasses = uniqueSorted(newFilesRule.allow_classes || []);
  const allowedSet = new Set(allowedClasses);
  const touchedClasses = uniqueSorted(Object.keys(detected.files_by_class));
  const violatingClasses = allowedClasses.length > 0
    ? touchedClasses.filter((fileClass) => !allowedSet.has(fileClass))
    : touchedClasses;
  const unclassifiedFiles = detected.unclassified_files;
  const hasUnclassifiedViolation = unclassifiedFiles.length > 0;
  const classBudgetViolations = [];

  for (const [fileClass, limit] of Object.entries(newFilesRule.max_per_class || {})) {
    const actual = (detected.files_by_class[fileClass] || []).length;
    if (actual > limit) {
      classBudgetViolations.push({
        class: fileClass,
        actual,
        limit,
        files: detected.files_by_class[fileClass],
      });
    }
  }

  const maxNewFiles = newFilesRule.max_new_files;
  const exceedsMaxNewFiles = maxNewFiles !== undefined && newFiles.length > maxNewFiles;
  const details = [
    ...violatingClasses.map(
      (fileClass) => `class ${fileClass} is not allowed by change_profiles["${changeType}"].new_files.allow_classes; files: ${detected.files_by_class[fileClass].join(", ")}`
    ),
    ...unclassifiedFiles.map(
      (file) => `file ${file} detected class: unclassified; violated rule: change_profiles["${changeType}"].new_files.allow_classes`
    ),
    ...classBudgetViolations.map(
      (violation) => `class ${violation.class} has ${violation.actual} new file(s), limit ${violation.limit}; files: ${violation.files.join(", ")}`
    ),
  ];
  if (exceedsMaxNewFiles) {
    details.push(`new files ${newFiles.length} exceeds change_profiles["${changeType}"].new_files.max_new_files ${maxNewFiles}`);
  }

  let message;
  if (violatingClasses.length > 0) {
    message = `change_type "${changeType}" cannot add new-file classes: ${violatingClasses.join(", ")}`;
  } else if (hasUnclassifiedViolation) {
    message = `change_profiles["${changeType}"].new_files found added files that match no declared new_file_class: ${unclassifiedFiles.join(", ")}`;
  } else if (classBudgetViolations.length > 0 || exceedsMaxNewFiles) {
    message = `change_type "${changeType}" exceeds change_profiles["${changeType}"].new_files budget`;
  }

  return {
    ok: violatingClasses.length === 0 && !hasUnclassifiedViolation && classBudgetViolations.length === 0 && !exceedsMaxNewFiles,
    message,
    change_type: changeType,
    new_files: newFiles,
    actual: exceedsMaxNewFiles ? newFiles.length : undefined,
    limit: exceedsMaxNewFiles ? maxNewFiles : undefined,
    allowed_classes: allowedClasses,
    touched_classes: touchedClasses,
    violating_classes: violatingClasses,
    class_budget_violations: classBudgetViolations,
    files_by_class: detected.files_by_class,
    unclassified_files: unclassifiedFiles,
    details,
    hint: hasUnclassifiedViolation
      ? "Add matching new_file_classes globs or update the change_profile.new_files.allow_classes."
      : undefined,
  };
}

export function checkChangeProfile(files, policy, changeType) {
  const changeProfiles = policy.change_profiles || {};
  if (Object.keys(changeProfiles).length === 0) return { ok: true };

  const changeTypeValue = changeType || null;
  if (!changeTypeValue) {
    return {
      ok: false,
      message: "change_profiles requires a declared change_type",
      change_type: null,
      hint: "Set change_type in the contract.",
    };
  }

  const profile = changeProfiles[changeTypeValue];
  if (!profile) {
    return {
      ok: false,
      message: `change_type "${changeTypeValue}" is not defined in change_profiles`,
      change_type: changeTypeValue,
      details: [`known change types: ${formatList(Object.keys(changeProfiles).sort())}`],
      hint: "Define the change type in change_profiles or use one of the configured types.",
    };
  }

  const detectedSurfaces = detectTouchedSurfaces(files, policy.surfaces);
  const touchedSurfaces = detectedSurfaces.touched_surfaces;
  const requiredSurfaces = uniqueSorted(profile.require_surfaces || []);
  const allowedSurfaces = uniqueSorted(profile.allow_surfaces || []);
  const forbiddenSurfaces = uniqueSorted(profile.forbid_surfaces || []);
  const allowedSet = new Set(allowedSurfaces);
  const forbiddenSet = new Set(forbiddenSurfaces);
  const touchedSet = new Set(touchedSurfaces);
  const usesSurfaceConstraints = requiredSurfaces.length > 0 ||
    allowedSurfaces.length > 0 ||
    forbiddenSurfaces.length > 0;
  const unclassifiedFiles = detectedSurfaces.unclassified_files;
  const allowUnclassifiedSurfaces = Boolean(profile.allow_unclassified_surfaces);
  const hasUnclassifiedViolation = usesSurfaceConstraints &&
    unclassifiedFiles.length > 0 &&
    !allowUnclassifiedSurfaces;
  const missingRequiredSurfaces = requiredSurfaces.filter((surface) => !touchedSet.has(surface));
  const notAllowedSurfaces = allowedSurfaces.length > 0
    ? touchedSurfaces.filter((surface) => !allowedSet.has(surface))
    : [];
  const explicitlyForbiddenSurfaces = touchedSurfaces.filter((surface) => forbiddenSet.has(surface));
  const violatingSurfaces = uniqueSorted([...notAllowedSurfaces, ...explicitlyForbiddenSurfaces]);

  const newFileResult = checkProfileNewFiles(
    files,
    policy.new_file_classes,
    profile.new_files,
    changeTypeValue
  );

  const budgets = profile.budgets || {};
  const docsBudget = checkCanonicalDocsBudget(files, policy.paths.canonical_docs, budgets.max_new_docs);
  const newFilesBudget = checkNewFilesBudget(files, budgets.max_new_files);
  const netLinesBudget = checkNetAddedLinesBudget(files, budgets.max_net_added_lines);

  const details = [
    ...missingRequiredSurfaces.map(
      (surface) => `required surface ${surface} was not touched by change_profiles["${changeTypeValue}"].require_surfaces`
    ),
    ...violatingSurfaces.map(
      (surface) => `surface ${surface} violated change_profiles["${changeTypeValue}"] surface constraints; files: ${detectedSurfaces.files_by_surface[surface].join(", ")}`
    ),
  ];
  if (hasUnclassifiedViolation) {
    details.push(`changed files matched no declared surface: ${unclassifiedFiles.join(", ")}`);
  }
  if (!docsBudget.ok) {
    details.push(`new docs ${docsBudget.actual} exceeds change_profiles["${changeTypeValue}"].budgets.max_new_docs ${docsBudget.limit}; files: ${docsBudget.files.join(", ")}`);
  }
  if (!newFilesBudget.ok) {
    details.push(`new files ${newFilesBudget.actual} exceeds change_profiles["${changeTypeValue}"].budgets.max_new_files ${newFilesBudget.limit}; files: ${newFilesBudget.files.join(", ")}`);
  }
  if (!netLinesBudget.ok) {
    details.push(`net added lines ${netLinesBudget.actual} exceeds change_profiles["${changeTypeValue}"].budgets.max_net_added_lines ${netLinesBudget.limit}`);
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
    message: ok ? undefined : `change_type "${changeTypeValue}" violated change_profiles`,
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
    new_files: newFileResult,
    details,
    hint: hasUnclassifiedViolation
      ? "Add matching surface globs or set change_profiles[change_type].allow_unclassified_surfaces: true."
      : undefined,
  };
}

export const changeProfileRuleFamily = {
  id: "change-profiles",
  applies(facts) {
    return Boolean(facts.policy.change_profiles);
  },
  evaluate(facts) {
    return {
      name: "change-profiles",
      check: checkChangeProfile(
        facts.diff.files.checked,
        facts.policy,
        facts.contract?.change_type
      ),
    };
  },
};
