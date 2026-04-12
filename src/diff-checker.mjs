import { minimatch } from "minimatch";

export function matchesAny(filePath, patterns) {
  return patterns.some((p) => minimatch(filePath, p, { dot: true }));
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
