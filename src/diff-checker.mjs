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
