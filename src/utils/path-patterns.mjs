import { minimatch } from "minimatch";
import { uniqueSorted } from "./collections.mjs";

export function matchesAny(filePath, patterns = []) {
  return (patterns || []).some((pattern) => minimatch(filePath, pattern, { dot: true }));
}

export function normalizePathEntry(value) {
  return String(value || "").trim().replace(/^\.\//, "");
}

export function normalizePathList(values = []) {
  return uniqueSorted((values || []).map(normalizePathEntry).filter(Boolean));
}
