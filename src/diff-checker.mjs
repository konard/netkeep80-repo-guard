import { minimatch } from "minimatch";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

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

function normalizePathList(values) {
  return uniqueSorted((values || []).map(normalizeRegistryEntry).filter(Boolean));
}

function changedPaths(files, options = {}) {
  const includeDeleted = Boolean(options.includeDeleted);
  return normalizePathList(
    (files || [])
      .filter((file) => includeDeleted || file.status !== "deleted")
      .map((file) => file.path)
  );
}

function allKnownPaths(files, options = {}) {
  return normalizePathList([
    ...(options.trackedFiles || options.allFiles || []),
    ...changedPaths(files),
  ]);
}

function ignoredBySizeRule(path, rule, options = {}) {
  const ignored = [
    ...(options.ignorePatterns || []),
    ...(rule.ignore || []),
  ];
  return ignored.length > 0 && matchesAny(path, ignored);
}

function matchingSizeRulePaths(paths, rule, options = {}) {
  const glob = rule.glob || "**";
  return normalizePathList(paths).filter(
    (path) =>
      minimatch(path, glob, { dot: true }) &&
      !ignoredBySizeRule(path, rule, options)
  );
}

function sizeRuleApplies(rule, options = {}) {
  const changeType = options.changeType || null;
  const changeClass = options.changeClass || null;
  if (
    rule.applies_to_change_types &&
    !rule.applies_to_change_types.includes(changeType)
  ) {
    return false;
  }
  if (
    rule.applies_to_change_classes &&
    !rule.applies_to_change_classes.includes(changeClass)
  ) {
    return false;
  }
  return true;
}

function readSizeRuleFile(path, options = {}) {
  if (options.readFile) {
    const content = options.readFile(path);
    if (content === undefined || content === null) {
      throw new Error(`cannot read ${path}`);
    }
    return Buffer.isBuffer(content) ? content : Buffer.from(String(content));
  }

  const fullPath = resolve(options.repoRoot || process.cwd(), path);
  if (!existsSync(fullPath)) return null;
  return readFileSync(fullPath);
}

export function countTextLines(content) {
  if (content.length === 0) return 0;
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  let lines = 1;
  for (const char of normalized) {
    if (char === "\n") lines++;
  }
  return normalized.endsWith("\n") ? lines - 1 : lines;
}

function measureSizeRuleFile(path, metric, options = {}) {
  const content = readSizeRuleFile(path, options);
  if (content === null) return { skipped: true, actual: 0 };
  if (metric === "bytes") return { skipped: false, actual: content.length };
  return { skipped: false, actual: countTextLines(content.toString("utf-8")) };
}

function directoryPathFromGlob(glob) {
  const normalized = normalizeRegistryEntry(glob).replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  const stableParts = [];
  for (const part of parts) {
    if (/[*?[\]{}()]/.test(part)) break;
    stableParts.push(part);
  }
  return stableParts.length > 0 ? stableParts.join("/") : (normalized || ".");
}

function formatSizeViolation(violation) {
  const unit = violation.metric;
  return `[${violation.ruleId}] ${violation.path} has ${violation.actual} ${unit} (max ${violation.max})`;
}

export function checkSizeRules(files, rules = [], options = {}) {
  if (!rules || rules.length === 0) {
    return {
      ok: true,
      size_violations: [],
      advisory_violations: [],
      failed_rules: [],
      details: [],
    };
  }

  const blockingViolations = [];
  const advisoryViolations = [];
  const errors = [];
  const allPaths = allKnownPaths(files, options);
  const changedNonDeletedPaths = changedPaths(files);
  const changedIncludingDeletedPaths = changedPaths(files, { includeDeleted: true });

  for (const rule of rules) {
    if (!sizeRuleApplies(rule, options)) continue;

    const count = rule.count || "all_tracked";
    const level = rule.level || "blocking";
    const addViolation = (violation) => {
      if (level === "advisory") advisoryViolations.push(violation);
      else blockingViolations.push(violation);
    };

    try {
      if (rule.scope === "file") {
        const sourcePaths = count === "changed_only" ? changedNonDeletedPaths : allPaths;
        const paths = matchingSizeRulePaths(sourcePaths, rule, options);
        for (const path of paths) {
          const measured = measureSizeRuleFile(path, rule.metric, options);
          if (measured.skipped || measured.actual <= rule.max) continue;
          addViolation({
            ruleId: rule.id,
            rule_id: rule.id,
            scope: "file",
            path,
            metric: rule.metric,
            actual: measured.actual,
            max: rule.max,
            count,
            level,
          });
        }
      } else if (rule.scope === "directory") {
        if (
          count === "changed_only" &&
          matchingSizeRulePaths(changedIncludingDeletedPaths, rule, options).length === 0
        ) {
          continue;
        }

        const paths = matchingSizeRulePaths(allPaths, rule, options);
        let actual = 0;
        for (const path of paths) {
          const measured = measureSizeRuleFile(path, rule.metric, options);
          if (!measured.skipped) actual += measured.actual;
        }
        if (actual > rule.max) {
          addViolation({
            ruleId: rule.id,
            rule_id: rule.id,
            scope: "directory",
            path: directoryPathFromGlob(rule.glob),
            metric: rule.metric,
            actual,
            max: rule.max,
            count,
            level,
            files: paths,
          });
        }
      }
    } catch (e) {
      errors.push(`[${rule.id}] ${e.message}`);
    }
  }

  const failedRules = uniqueSorted([
    ...blockingViolations.map((violation) => violation.ruleId),
    ...(errors.length > 0 ? ["read-errors"] : []),
  ]);

  return {
    ok: blockingViolations.length === 0 && errors.length === 0,
    size_violations: blockingViolations,
    advisory_violations: advisoryViolations,
    failed_rules: failedRules,
    details: blockingViolations.map(formatSizeViolation),
    advisory_details: advisoryViolations.map(formatSizeViolation),
    errors,
  };
}

function readPolicyFile(path, options) {
  if (options.readFile) {
    const content = options.readFile(path);
    if (content === undefined || content === null) {
      throw new Error(`cannot read ${path}`);
    }
    return String(content);
  }
  return readFileSync(resolve(options.repoRoot || process.cwd(), path), "utf-8");
}

function normalizeRegistryEntry(value) {
  return String(value || "").trim().replace(/^\.\//, "");
}

function uniqueSortedNormalized(values) {
  return uniqueSorted(values.map(normalizeRegistryEntry).filter(Boolean));
}

function decodeJsonPointerPart(part) {
  return part.replace(/~1/g, "/").replace(/~0/g, "~");
}

function resolveJsonPointer(data, pointer) {
  if (pointer === "") return data;
  if (!pointer || !pointer.startsWith("/")) {
    throw new Error(`invalid json_pointer "${pointer}"`);
  }

  let current = data;
  for (const rawPart of pointer.slice(1).split("/")) {
    const part = decodeJsonPointerPart(rawPart);
    if (current === null || current === undefined || !Object.prototype.hasOwnProperty.call(current, part)) {
      throw new Error(`json_pointer "${pointer}" does not exist`);
    }
    current = current[part];
  }
  return current;
}

function markdownHeadingLevel(line, section) {
  const match = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
  if (!match) return null;
  return match[2].trim().toLowerCase() === section.trim().toLowerCase()
    ? match[1].length
    : null;
}

function extractMarkdownSection(content, section) {
  const lines = content.split(/\r?\n/);
  let inSection = false;
  let level = null;
  const sectionLines = [];

  for (const line of lines) {
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (!inSection) {
      const matchedLevel = markdownHeadingLevel(line, section);
      if (matchedLevel) {
        inSection = true;
        level = matchedLevel;
      }
      continue;
    }

    if (heading && heading[1].length <= level) break;
    sectionLines.push(line);
  }

  if (!inSection) {
    throw new Error(`markdown section "${section}" not found`);
  }
  return sectionLines.join("\n");
}

function normalizeMarkdownLinkTarget(target, source) {
  const cleanTarget = normalizeRegistryEntry(target.split("#")[0].split("?")[0]);
  if (!cleanTarget || /^[a-z][a-z0-9+.-]*:/i.test(cleanTarget) || cleanTarget.startsWith("#")) {
    return "";
  }

  const sourceDir = source.file.includes("/")
    ? source.file.split("/").slice(0, -1).join("/")
    : "";
  const withSourceDir = cleanTarget.startsWith("/")
    ? cleanTarget.slice(1)
    : normalizeRegistryEntry(`${sourceDir}/${cleanTarget}`);
  const parts = [];
  for (const part of withSourceDir.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

function applyMarkdownLinkPrefix(target, source) {
  if (!source.prefix) return target;
  const prefix = normalizeRegistryEntry(source.prefix);
  if (target.startsWith(prefix)) return target;
  const sourceDir = source.file.includes("/")
    ? `${source.file.split("/").slice(0, -1).join("/")}/`
    : "";
  if (sourceDir && target.startsWith(sourceDir)) {
    return normalizeRegistryEntry(`${prefix}${target.slice(sourceDir.length)}`);
  }
  return target;
}

function readRegistrySource(source, options = {}) {
  const content = readPolicyFile(source.file, options);

  if (source.type === "json_array") {
    const data = JSON.parse(content);
    const value = resolveJsonPointer(data, source.json_pointer);
    if (!Array.isArray(value)) {
      throw new Error(`${source.file}${source.json_pointer} is not a JSON array`);
    }
    if (value.some((entry) => typeof entry !== "string")) {
      throw new Error(`${source.file}${source.json_pointer} must contain only strings`);
    }
    return uniqueSortedNormalized(value);
  }

  if (source.type === "markdown_section_links") {
    const section = extractMarkdownSection(content, source.section);
    const links = [];
    const linkPattern = /\[[^\]]+\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
    for (const match of section.matchAll(linkPattern)) {
      const normalized = normalizeMarkdownLinkTarget(match[1], source);
      if (!normalized) continue;
      links.push(applyMarkdownLinkPrefix(normalized, source));
    }
    return uniqueSortedNormalized(links);
  }

  throw new Error(`unsupported registry source type "${source.type}"`);
}

export function checkRegistryRules(registryRules = [], options = {}) {
  if (!registryRules || registryRules.length === 0) return { ok: true, results: [] };

  const results = [];
  for (const rule of registryRules) {
    try {
      const leftEntries = readRegistrySource(rule.left, options);
      const rightEntries = readRegistrySource(rule.right, options);
      const leftSet = new Set(leftEntries);
      const rightSet = new Set(rightEntries);
      const missingFromRight = leftEntries.filter((entry) => !rightSet.has(entry));
      const extraInRight = rightEntries.filter((entry) => !leftSet.has(entry));
      let ok;
      if (rule.kind === "set_equality") {
        ok = missingFromRight.length === 0 && extraInRight.length === 0;
      } else if (rule.kind === "left_subset_of_right") {
        ok = missingFromRight.length === 0;
      } else if (rule.kind === "right_subset_of_left") {
        ok = extraInRight.length === 0;
      } else {
        throw new Error(`unsupported registry rule kind "${rule.kind}"`);
      }

      results.push({
        ok,
        rule_id: rule.id,
        kind: rule.kind,
        left_entries: leftEntries,
        right_entries: rightEntries,
        missing_from_right: missingFromRight,
        extra_in_right: extraInRight,
        message: ok ? undefined : `registry rule "${rule.id}" failed ${rule.kind}`,
      });
    } catch (e) {
      results.push({
        ok: false,
        rule_id: rule.id,
        kind: rule.kind,
        left_entries: [],
        right_entries: [],
        missing_from_right: [],
        extra_in_right: [],
        message: `registry rule "${rule.id}" could not be evaluated`,
        details: [e.message],
      });
    }
  }

  const failed = results.filter((result) => !result.ok);
  return {
    ok: failed.length === 0,
    results,
    failed_rules: failed.map((result) => result.rule_id),
    details: failed.flatMap((result) => [
      `[${result.rule_id}] ${result.message}`,
      `left entries: ${formatList(result.left_entries)}`,
      `right entries: ${formatList(result.right_entries)}`,
      `missing from right: ${formatList(result.missing_from_right)}`,
      `extra in right: ${formatList(result.extra_in_right)}`,
      ...(result.details || []),
    ]),
  };
}

function stripMarkdownNoise(content) {
  return content
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/<[^>]+>/g, " ");
}

function markdownTokens(content) {
  const normalized = stripMarkdownNoise(content)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ");
  return normalized.split(/\s+/).filter((token) => token.length >= 3);
}

function tokenSet(content) {
  return new Set(markdownTokens(content));
}

function jaccardScore(left, right) {
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) intersection++;
  }
  const union = left.size + right.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function markdownHeadings(content) {
  const headings = [];
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (match) {
      headings.push({
        level: match[1].length,
        title: match[2].trim(),
        normalized: match[2].trim().toLowerCase().replace(/\s+/g, " "),
      });
    }
  }
  return headings;
}

export function checkAdvisoryTextRules(files, rules, options = {}) {
  if (!rules) return { ok: true, matches: [] };

  const canonicalPatterns = rules.canonical_files || [];
  const changedMarkdown = files.filter(
    (file) => file.status !== "deleted" && file.path.match(/\.md$/i)
  );
  if (changedMarkdown.length === 0 || canonicalPatterns.length === 0) {
    return { ok: true, matches: [] };
  }

  const threshold = rules.warn_on_similarity_above ?? 0.7;
  const maxReported = rules.max_reported_matches ?? 3;
  const canonicalFiles = uniqueSorted(options.allFiles || []);
  const results = [];
  const readErrors = [];

  for (const changed of changedMarkdown) {
    let changedContent;
    try {
      changedContent = readPolicyFile(changed.path, options);
    } catch (e) {
      readErrors.push(`${changed.path}: ${e.message}`);
      continue;
    }

    const changedTokens = tokenSet(changedContent);
    const changedHeadings = markdownHeadings(changedContent);
    const changedHeadingSet = new Set(changedHeadings.map((heading) => heading.normalized));

    for (const canonicalPath of canonicalFiles) {
      if (canonicalPath === changed.path) continue;
      if (!canonicalPath.match(/\.md$/i)) continue;
      if (!matchesAny(canonicalPath, canonicalPatterns)) continue;

      let canonicalContent;
      try {
        canonicalContent = readPolicyFile(canonicalPath, options);
      } catch (e) {
        readErrors.push(`${canonicalPath}: ${e.message}`);
        continue;
      }

      const score = jaccardScore(changedTokens, tokenSet(canonicalContent));
      const canonicalHeadings = markdownHeadings(canonicalContent);
      const duplicateHeadings = uniqueSorted(
        canonicalHeadings
          .filter((heading) => changedHeadingSet.has(heading.normalized))
          .map((heading) => heading.title)
      );

      if (score >= threshold || duplicateHeadings.length > 0) {
        results.push({
          changed_file: changed.path,
          canonical_file: canonicalPath,
          score: Number(score.toFixed(3)),
          threshold,
          duplicate_section_titles: duplicateHeadings,
          reason: score >= threshold ? "text_similarity" : "duplicate_section_title",
        });
      }
    }
  }

  results.sort((a, b) =>
    b.score - a.score ||
    a.changed_file.localeCompare(b.changed_file) ||
    a.canonical_file.localeCompare(b.canonical_file)
  );

  const matches = results.slice(0, maxReported);
  const details = matches.map((match) => {
    const sections = match.duplicate_section_titles.length > 0
      ? `; duplicate sections: ${match.duplicate_section_titles.join(", ")}`
      : "";
    return `${match.changed_file} overlaps ${match.canonical_file} (score ${match.score}, threshold ${match.threshold}${sections})`;
  });

  return {
    ok: matches.length === 0,
    advisory: true,
    message: matches.length > 0 ? "heuristic markdown duplication advisory" : undefined,
    matches,
    details: [...details, ...readErrors.map((error) => `read warning: ${error}`)],
    hint: matches.length > 0
      ? "Review whether the changed markdown should update the canonical source instead of duplicating policy prose."
      : undefined,
  };
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
