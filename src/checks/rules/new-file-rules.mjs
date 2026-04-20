import { classifyNewFiles } from "../../diff/classification.mjs";
import { formatList, uniqueSorted } from "../../utils/collections.mjs";

function unclassifiedNewFilesMessage(unclassifiedFiles) {
  return `new_file_rules found added files that match no declared new_file_class: ${unclassifiedFiles.join(", ")}`;
}

function unclassifiedNewFilesHint() {
  return "Add matching new_file_classes globs or update the change class new_file_rules.";
}

export function checkNewFileRules(files, newFileClasses, newFileRules, changeClass) {
  if (!newFileRules || Object.keys(newFileRules).length === 0) return { ok: true };

  const detected = classifyNewFiles(files, newFileClasses);
  const newFiles = detected.new_files;
  const changeClassValue = changeClass || null;

  if (newFiles.length === 0) {
    return {
      ok: true,
      change_class: changeClassValue,
      new_files: newFiles,
      files_by_class: detected.files_by_class,
      unclassified_files: detected.unclassified_files,
    };
  }

  if (!changeClassValue) {
    return {
      ok: false,
      message: "new_file_rules requires a declared change_class when new files are added",
      change_class: null,
      new_files: newFiles,
      files_by_class: detected.files_by_class,
      unclassified_files: detected.unclassified_files,
      details: newFiles.map((file) => {
        const classes = detected.class_by_file[file] || ["unclassified"];
        return `file ${file} detected class: ${classes.join(", ")}`;
      }),
      hint: "Set change_class in the contract or pass --change-class <name>.",
    };
  }

  const rule = newFileRules[changeClassValue];
  if (!rule) {
    return {
      ok: false,
      message: `change_class "${changeClassValue}" is not defined in new_file_rules`,
      change_class: changeClassValue,
      new_files: newFiles,
      files_by_class: detected.files_by_class,
      unclassified_files: detected.unclassified_files,
      details: [`known change classes: ${formatList(Object.keys(newFileRules).sort())}`],
      hint: "Define the change class in new_file_rules or use one of the configured classes.",
    };
  }

  const allowedClasses = uniqueSorted(rule.allow_classes || []);
  const allowedSet = new Set(allowedClasses);
  const touchedClasses = uniqueSorted(Object.keys(detected.files_by_class));
  const violatingClasses = allowedClasses.length > 0
    ? touchedClasses.filter((fileClass) => !allowedSet.has(fileClass))
    : touchedClasses;
  const hasUnclassifiedViolation = detected.unclassified_files.length > 0;
  const classBudgetViolations = [];

  for (const [fileClass, limit] of Object.entries(rule.max_per_class || {})) {
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

  const maxNewFiles = rule.max_new_files;
  const exceedsMaxNewFiles = maxNewFiles !== undefined && newFiles.length > maxNewFiles;
  const details = [
    ...violatingClasses.map(
      (fileClass) => `class ${fileClass} is not allowed by new_file_rules["${changeClassValue}"].allow_classes; files: ${detected.files_by_class[fileClass].join(", ")}`
    ),
    ...detected.unclassified_files.map(
      (file) => `file ${file} detected class: unclassified; violated rule: new_file_rules["${changeClassValue}"].allow_classes`
    ),
    ...classBudgetViolations.map(
      (violation) => `class ${violation.class} has ${violation.actual} new file(s), limit ${violation.limit}; files: ${violation.files.join(", ")}`
    ),
  ];
  if (exceedsMaxNewFiles) {
    details.push(`new files ${newFiles.length} exceeds new_file_rules["${changeClassValue}"].max_new_files ${maxNewFiles}`);
  }

  let message;
  if (violatingClasses.length > 0) {
    message = `change_class "${changeClassValue}" cannot add new-file classes: ${violatingClasses.join(", ")}`;
  } else if (hasUnclassifiedViolation) {
    message = unclassifiedNewFilesMessage(detected.unclassified_files);
  } else if (classBudgetViolations.length > 0 || exceedsMaxNewFiles) {
    message = `change_class "${changeClassValue}" exceeds new_file_rules budget`;
  }

  return {
    ok: violatingClasses.length === 0 && !hasUnclassifiedViolation && classBudgetViolations.length === 0 && !exceedsMaxNewFiles,
    message,
    change_class: changeClassValue,
    new_files: newFiles,
    actual: exceedsMaxNewFiles ? newFiles.length : undefined,
    limit: exceedsMaxNewFiles ? maxNewFiles : undefined,
    allowed_classes: allowedClasses,
    touched_classes: touchedClasses,
    violating_classes: violatingClasses,
    class_budget_violations: classBudgetViolations,
    files_by_class: detected.files_by_class,
    unclassified_files: detected.unclassified_files,
    details,
    hint: hasUnclassifiedViolation ? unclassifiedNewFilesHint() : undefined,
  };
}

export const newFileRuleFamily = {
  id: "new-file-rules",
  applies(facts) {
    return Boolean(facts.policy.new_file_rules);
  },
  evaluate(facts) {
    return {
      name: "new-file-rules",
      check: checkNewFileRules(
        facts.diff.files.checked,
        facts.policy.new_file_classes,
        facts.policy.new_file_rules,
        facts.declaredChangeClass
      ),
    };
  },
};
