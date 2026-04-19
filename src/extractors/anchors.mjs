import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { minimatch } from "minimatch";

function matchesAny(filePath, patterns) {
  return patterns.some((pattern) => minimatch(filePath, pattern, { dot: true }));
}

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

function readRepositoryFile(filePath, options) {
  if (options.readFile) {
    const content = options.readFile(filePath);
    if (content === undefined || content === null) {
      throw new Error(`cannot read ${filePath}`);
    }
    return String(content);
  }
  return readFileSync(resolve(options.repoRoot || process.cwd(), filePath), "utf-8");
}

function candidateAnchorFiles(options) {
  const changedPaths = (options.changedFiles || [])
    .filter((file) => file.status !== "deleted")
    .map((file) => file.path);
  return uniqueSorted([...(options.trackedFiles || []), ...changedPaths].filter(Boolean));
}

function buildLineStarts(content) {
  const starts = [0];
  for (let i = 0; i < content.length; i++) {
    if (content[i] === "\n") starts.push(i + 1);
  }
  return starts;
}

function positionAt(lineStarts, index) {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (lineStarts[mid] <= index) low = mid + 1;
    else high = mid - 1;
  }
  const lineIndex = Math.max(0, high);
  return {
    line: lineIndex + 1,
    column: index - lineStarts[lineIndex] + 1,
  };
}

function makeRegex(pattern) {
  const compiled = new RegExp(pattern);
  let flags = compiled.flags;
  for (const flag of ["g", "d"]) {
    if (!flags.includes(flag)) flags += flag;
  }
  return new RegExp(compiled.source, flags);
}

function firstDefinedCapture(match) {
  for (let i = 1; i < match.length; i++) {
    if (match[i] !== undefined) return i;
  }
  return null;
}

function extractRegexAnchors(anchorType, source, file, content) {
  const instances = [];
  const regex = makeRegex(source.pattern);
  const lineStarts = buildLineStarts(content);

  for (const match of content.matchAll(regex)) {
    const captureGroup = firstDefinedCapture(match);
    const value = captureGroup ? match[captureGroup] : match[0];
    const index = captureGroup && match.indices?.[captureGroup]
      ? match.indices[captureGroup][0]
      : match.index;
    const position = positionAt(lineStarts, index);
    const instance = {
      anchorType,
      value: String(value),
      file,
      sourceKind: "regex",
      line: position.line,
      column: position.column,
      raw: match[0],
    };

    if (captureGroup) instance.captureGroup = captureGroup;
    instances.push(instance);
  }

  return instances;
}

function extractJsonFieldAnchor(anchorType, source, file, content) {
  let data;
  try {
    data = JSON.parse(content);
  } catch (e) {
    throw new Error(`invalid JSON: ${e.message}`);
  }
  if (data === null || Array.isArray(data) || typeof data !== "object") {
    throw new Error("json_field extractor requires a top-level JSON object");
  }
  if (!Object.hasOwn(data, source.field)) {
    throw new Error(`field "${source.field}" not found`);
  }

  const value = data[source.field];
  if (value === null || typeof value === "object") {
    throw new Error(`field "${source.field}" must be a string, number, or boolean`);
  }

  return [{
    anchorType,
    value: String(value),
    file,
    sourceKind: "json_field",
    raw: String(value),
  }];
}

function compareInstances(a, b) {
  return a.file.localeCompare(b.file) ||
    (a.line || 0) - (b.line || 0) ||
    (a.column || 0) - (b.column || 0) ||
    a.anchorType.localeCompare(b.anchorType) ||
    a.value.localeCompare(b.value);
}

function compareErrors(a, b) {
  return (a.file || "").localeCompare(b.file || "") ||
    a.anchorType.localeCompare(b.anchorType) ||
    a.sourceIndex - b.sourceIndex ||
    a.message.localeCompare(b.message);
}

function groupByType(anchorTypes, instances) {
  const byType = {};
  for (const anchorType of Object.keys(anchorTypes).sort()) {
    byType[anchorType] = [];
  }
  for (const instance of instances) {
    if (!byType[instance.anchorType]) byType[instance.anchorType] = [];
    byType[instance.anchorType].push(instance);
  }
  return byType;
}

export function extractAnchors(policy, options = {}) {
  const anchorTypes = policy.anchors?.types || {};
  const files = candidateAnchorFiles(options);
  const instances = [];
  const errors = [];
  const contentCache = new Map();

  function contentFor(file) {
    if (!contentCache.has(file)) {
      contentCache.set(file, readRepositoryFile(file, options));
    }
    return contentCache.get(file);
  }

  for (const [anchorType, config] of Object.entries(anchorTypes)) {
    for (const [sourceIndex, source] of (config.sources || []).entries()) {
      const sourceFiles = files.filter((file) => matchesAny(file, [source.glob]));
      for (const file of sourceFiles) {
        try {
          const content = contentFor(file);
          if (source.kind === "regex") {
            instances.push(...extractRegexAnchors(anchorType, source, file, content));
          } else if (source.kind === "json_field") {
            instances.push(...extractJsonFieldAnchor(anchorType, source, file, content));
          } else {
            throw new Error(`unsupported anchor source kind "${source.kind}"`);
          }
        } catch (e) {
          errors.push({
            anchorType,
            sourceKind: source.kind,
            sourceIndex,
            file,
            message: e.message,
          });
        }
      }
    }
  }

  instances.sort(compareInstances);
  errors.sort(compareErrors);

  return {
    instances,
    byType: groupByType(anchorTypes, instances),
    errors,
  };
}

export function formatAnchorExtractionError(error) {
  const source = `${error.sourceKind} source ${error.sourceIndex}`;
  const file = error.file ? `${error.file}: ` : "";
  return `[${error.anchorType} ${source}] ${file}${error.message}`;
}

export function checkAnchorExtraction(anchorExtraction) {
  const errors = anchorExtraction?.errors || [];
  return {
    ok: errors.length === 0,
    message: errors.length > 0 ? "anchor extraction failed" : undefined,
    errors: errors.map(formatAnchorExtractionError),
  };
}
