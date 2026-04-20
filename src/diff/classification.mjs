import { uniqueSorted } from "../utils/collections.mjs";
import { matchesAny } from "../utils/path-patterns.mjs";

export function detectTouchedSurfaces(files, surfaces = {}) {
  const filesBySurface = {};
  const classifiedFiles = new Set();

  for (const [surface, patterns] of Object.entries(surfaces || {})) {
    const matchedFiles = uniqueSorted(
      files
        .filter((file) => matchesAny(file.path, patterns || []))
        .map((file) => file.path)
    );

    if (matchedFiles.length > 0) {
      filesBySurface[surface] = matchedFiles;
      for (const file of matchedFiles) {
        classifiedFiles.add(file);
      }
    }
  }

  const changedFiles = uniqueSorted(files.map((file) => file.path));

  return {
    touched_surfaces: Object.keys(filesBySurface).sort(),
    files_by_surface: filesBySurface,
    unclassified_files: changedFiles.filter((file) => !classifiedFiles.has(file)),
  };
}

export function classifyNewFiles(files, newFileClasses = {}) {
  const filesByClass = {};
  const classByFile = {};
  const classifiedFiles = new Set();
  const newFiles = uniqueSorted(files.filter((file) => file.status === "added").map((file) => file.path));

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
