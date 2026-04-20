import { detectTouchedSurfaces } from "../../diff/classification.mjs";
import { formatList, uniqueSorted } from "../../utils/collections.mjs";

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

export const surfaceMatrixRuleFamily = {
  id: "surface-matrix",
  applies(facts) {
    return Boolean(facts.policy.surface_matrix);
  },
  evaluate(facts) {
    return {
      name: "surface-matrix",
      check: checkSurfaceMatrix(
        facts.diff.files.checked,
        facts.policy.surfaces,
        facts.policy.surface_matrix,
        facts.declaredChangeClass,
        { allow_unclassified_files: facts.policy.allow_unclassified_files }
      ),
    };
  },
};
