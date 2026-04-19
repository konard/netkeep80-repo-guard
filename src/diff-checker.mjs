import { minimatch } from "minimatch";

export function matchesAny(filePath, patterns) {
  return patterns.some((p) => minimatch(filePath, p, { dot: true }));
}

export function filterOperationalPaths(files, operationalPaths) {
  if (!operationalPaths || operationalPaths.length === 0) return files;
  return files.filter((f) => !matchesAny(f.path, operationalPaths));
}

export function parseDiff(diffText) {
  const files = [];
  let current = null;

  for (const line of diffText.split("\n")) {
    if (line.startsWith("diff --git")) {
      if (current) files.push(current);
      const match = line.match(/diff --git a\/.+ b\/(.+)/);
      current = { path: match ? match[1] : "", addedLines: [], deletedLines: [], status: "modified" };
      continue;
    }

    if (!current) continue;

    if (line.startsWith("new file")) {
      current.status = "added";
    } else if (line.startsWith("deleted file")) {
      current.status = "deleted";
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      current.addedLines.push(line.slice(1));
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      current.deletedLines.push(line.slice(1));
    }
  }

  if (current) files.push(current);
  return files;
}

export function checkForbiddenPaths(files, forbidden) {
  const violations = [];
  for (const f of files) {
    if (f.status === "deleted") continue;
    if (matchesAny(f.path, forbidden)) {
      violations.push(f.path);
    }
  }
  return violations;
}

export function checkCanonicalDocsBudget(files, canonicalDocs, maxNewDocs) {
  if (maxNewDocs === undefined) return { ok: true };

  const newDocs = files.filter(
    (f) =>
      f.status === "added" &&
      f.path.match(/\.md$/i) &&
      !canonicalDocs.includes(f.path)
  );

  return {
    ok: newDocs.length <= maxNewDocs,
    actual: newDocs.length,
    limit: maxNewDocs,
    files: newDocs.map((f) => f.path),
  };
}

export function checkNewFilesBudget(files, maxNewFiles) {
  if (maxNewFiles === undefined) return { ok: true };

  const newFiles = files.filter((f) => f.status === "added");
  return {
    ok: newFiles.length <= maxNewFiles,
    actual: newFiles.length,
    limit: maxNewFiles,
    files: newFiles.map((f) => f.path),
  };
}

export function checkNetAddedLinesBudget(files, maxNetAddedLines) {
  if (maxNetAddedLines === undefined) return { ok: true };

  let netAdded = 0;
  for (const f of files) {
    netAdded += f.addedLines.length - (f.deletedLines ? f.deletedLines.length : 0);
  }

  return {
    ok: netAdded <= maxNetAddedLines,
    actual: netAdded,
    limit: maxNetAddedLines,
  };
}

export function calculateDiffGrowth(files) {
  const newFiles = files.filter((f) => f.status === "added").map((f) => f.path);
  let netAddedLines = 0;
  for (const f of files) {
    netAddedLines += f.addedLines.length - (f.deletedLines ? f.deletedLines.length : 0);
  }

  return {
    new_files: newFiles.length,
    new_files_list: newFiles,
    net_added_lines: netAddedLines,
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

export function checkCochangeRules(files, rules) {
  const changedPaths = files.map((f) => f.path);
  const violations = [];

  for (const rule of rules) {
    const triggered = changedPaths.some((p) => matchesAny(p, rule.if_changed));
    if (!triggered) continue;

    const satisfied = changedPaths.some((p) => matchesAny(p, rule.must_change_any));
    if (!satisfied) {
      violations.push({
        if_changed: rule.if_changed,
        must_change_any: rule.must_change_any,
      });
    }
  }

  return violations;
}

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

function formatList(values) {
  return values && values.length > 0 ? values.join(", ") : "(none)";
}

export function detectTouchedSurfaces(files, surfaces = {}) {
  const filesBySurface = {};
  const classifiedFiles = new Set();

  for (const [surface, patterns] of Object.entries(surfaces || {})) {
    const matchedFiles = uniqueSorted(
      files
        .filter((f) => matchesAny(f.path, patterns || []))
        .map((f) => f.path)
    );

    if (matchedFiles.length > 0) {
      filesBySurface[surface] = matchedFiles;
      for (const file of matchedFiles) {
        classifiedFiles.add(file);
      }
    }
  }

  const changedFiles = uniqueSorted(files.map((f) => f.path));

  return {
    touched_surfaces: Object.keys(filesBySurface).sort(),
    files_by_surface: filesBySurface,
    unclassified_files: changedFiles.filter((file) => !classifiedFiles.has(file)),
  };
}

function unclassifiedFilesMessage(unclassifiedFiles) {
  return `surface_matrix found changed files that match no declared surface: ${unclassifiedFiles.join(", ")}`;
}

function unclassifiedFilesHint() {
  return "Add matching surface globs or set allow_unclassified_files: true if unclassified files are intentional.";
}

export function classifyNewFiles(files, newFileClasses = {}) {
  const filesByClass = {};
  const classByFile = {};
  const classifiedFiles = new Set();
  const newFiles = uniqueSorted(files.filter((f) => f.status === "added").map((f) => f.path));

  for (const [fileClass, patterns] of Object.entries(newFileClasses || {})) {
    const matchedFiles = newFiles.filter((file) => matchesAny(file, patterns || []));

    if (matchedFiles.length > 0) {
      filesByClass[fileClass] = matchedFiles;
      for (const file of matchedFiles) {
        classifiedFiles.add(file);
        if (!classByFile[file]) classByFile[file] = [];
        classByFile[file].push(fileClass);
      }
    }
  }

  for (const classes of Object.values(classByFile)) {
    classes.sort();
  }

  return {
    new_files: newFiles,
    files_by_class: filesByClass,
    class_by_file: classByFile,
    unclassified_files: newFiles.filter((file) => !classifiedFiles.has(file)),
  };
}

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
      (v) => `class ${v.class} has ${v.actual} new file(s), limit ${v.limit}; files: ${v.files.join(", ")}`
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

export function checkSurfaceMatrix(files, surfaces, surfaceMatrix, changeClass, options = {}) {
  if (!surfaceMatrix || Object.keys(surfaceMatrix).length === 0) return { ok: true };

  const detected = detectTouchedSurfaces(files, surfaces);
  const touchedSurfaces = detected.touched_surfaces;
  const unclassifiedFiles = detected.unclassified_files;
  const changeClassValue = changeClass || null;
  const allowUnclassifiedFiles = Boolean(
    options.allow_unclassified_files || options.allowUnclassifiedFiles
  );
  const hasUnclassifiedViolation = unclassifiedFiles.length > 0 && !allowUnclassifiedFiles;
  const unclassifiedDetails = hasUnclassifiedViolation
    ? [`changed files matched no declared surface: ${unclassifiedFiles.join(", ")}`]
    : [];

  if (touchedSurfaces.length === 0 && !hasUnclassifiedViolation) {
    return {
      ok: true,
      change_class: changeClassValue,
      touched_surfaces: touchedSurfaces,
      files_by_surface: detected.files_by_surface,
      unclassified_files: unclassifiedFiles,
    };
  }

  if (touchedSurfaces.length === 0 && hasUnclassifiedViolation) {
    return {
      ok: false,
      message: unclassifiedFilesMessage(unclassifiedFiles),
      change_class: changeClassValue,
      touched_surfaces: touchedSurfaces,
      files_by_surface: detected.files_by_surface,
      unclassified_files: unclassifiedFiles,
      details: unclassifiedDetails,
      hint: unclassifiedFilesHint(),
    };
  }

  if (!changeClassValue) {
    return {
      ok: false,
      message: "surface_matrix requires a declared change_class",
      change_class: null,
      touched_surfaces: touchedSurfaces,
      files_by_surface: detected.files_by_surface,
      unclassified_files: unclassifiedFiles,
      details: unclassifiedDetails,
      hint: hasUnclassifiedViolation
        ? `Set change_class in the contract or pass --change-class <name>. ${unclassifiedFilesHint()}`
        : "Set change_class in the contract or pass --change-class <name>.",
    };
  }

  const matrixEntry = surfaceMatrix[changeClassValue];
  if (!matrixEntry) {
    return {
      ok: false,
      message: `change_class "${changeClassValue}" is not defined in surface_matrix`,
      change_class: changeClassValue,
      touched_surfaces: touchedSurfaces,
      files_by_surface: detected.files_by_surface,
      unclassified_files: unclassifiedFiles,
      details: [
        `known change classes: ${formatList(Object.keys(surfaceMatrix).sort())}`,
        ...unclassifiedDetails,
      ],
      hint: hasUnclassifiedViolation
        ? `Define the change class in surface_matrix or use one of the configured classes. ${unclassifiedFilesHint()}`
        : "Define the change class in surface_matrix or use one of the configured classes.",
    };
  }

  const allowedSurfaces = uniqueSorted(matrixEntry.allow || []);
  const forbiddenSurfaces = uniqueSorted(matrixEntry.forbid || []);
  const allowedSet = new Set(allowedSurfaces);
  const forbiddenSet = new Set(forbiddenSurfaces);

  const notAllowed = allowedSurfaces.length > 0
    ? touchedSurfaces.filter((surface) => !allowedSet.has(surface))
    : [];
  const explicitlyForbidden = touchedSurfaces.filter((surface) => forbiddenSet.has(surface));
  const violatingSurfaces = uniqueSorted([...notAllowed, ...explicitlyForbidden]);
  const details = [
    ...violatingSurfaces.map(
      (surface) => `surface ${surface} matched: ${detected.files_by_surface[surface].join(", ")}`
    ),
    ...unclassifiedDetails,
  ];
  let message;
  if (violatingSurfaces.length > 0 && hasUnclassifiedViolation) {
    message = `change_class "${changeClassValue}" cannot touch surfaces: ${violatingSurfaces.join(", ")}; unclassified files: ${unclassifiedFiles.join(", ")}`;
  } else if (violatingSurfaces.length > 0) {
    message = `change_class "${changeClassValue}" cannot touch surfaces: ${violatingSurfaces.join(", ")}`;
  } else if (hasUnclassifiedViolation) {
    message = unclassifiedFilesMessage(unclassifiedFiles);
  }

  return {
    ok: violatingSurfaces.length === 0 && !hasUnclassifiedViolation,
    message,
    change_class: changeClassValue,
    touched_surfaces: touchedSurfaces,
    allowed_surfaces: allowedSurfaces,
    forbidden_surfaces: forbiddenSurfaces,
    violating_surfaces: violatingSurfaces,
    files_by_surface: detected.files_by_surface,
    unclassified_files: unclassifiedFiles,
    details,
    hint: hasUnclassifiedViolation ? unclassifiedFilesHint() : undefined,
  };
}

export function checkContentRules(files, rules) {
  const violations = [];

  for (const rule of rules) {
    if (!rule.forbid_regex || rule.mode !== "added_lines") continue;

    const regexes = rule.forbid_regex.map((r) => new RegExp(r));
    const glob = rule.glob || "**";

    for (const f of files) {
      if (!minimatch(f.path, glob, { dot: true })) continue;

      for (const line of f.addedLines) {
        for (let i = 0; i < regexes.length; i++) {
          if (regexes[i].test(line)) {
            violations.push({
              rule_id: rule.id,
              file: f.path,
              line: line.trim(),
              matched_regex: rule.forbid_regex[i],
            });
          }
        }
      }
    }
  }

  return violations;
}

export function checkMustTouch(files, mustTouch) {
  if (!mustTouch || mustTouch.length === 0) return { ok: true };

  const changedPaths = files.map((f) => f.path);
  const satisfied = mustTouch.some((p) =>
    changedPaths.some((cp) => minimatch(cp, p, { dot: true }))
  );

  return {
    ok: satisfied,
    must_touch: mustTouch,
    changed: changedPaths,
    hint: satisfied ? undefined : "must_touch uses any-of semantics: at least one pattern must match a changed file",
  };
}

export function checkMustNotTouch(files, mustNotTouch) {
  if (!mustNotTouch || mustNotTouch.length === 0) return { ok: true };

  const changedPaths = files.map((f) => f.path);
  const touched = [];

  for (const pattern of mustNotTouch) {
    for (const cp of changedPaths) {
      if (minimatch(cp, pattern, { dot: true })) {
        touched.push(cp);
      }
    }
  }

  return {
    ok: touched.length === 0,
    touched,
    must_not_touch: mustNotTouch,
  };
}
