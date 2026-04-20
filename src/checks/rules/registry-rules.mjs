import { formatList, uniqueSorted } from "../../utils/collections.mjs";
import { normalizePathEntry } from "../../utils/path-patterns.mjs";
import { readRepositoryTextFile } from "../../utils/repository-files.mjs";

function uniqueSortedNormalized(values) {
  return uniqueSorted(values.map(normalizePathEntry).filter(Boolean));
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
  const cleanTarget = normalizePathEntry(target.split("#")[0].split("?")[0]);
  if (!cleanTarget || /^[a-z][a-z0-9+.-]*:/i.test(cleanTarget) || cleanTarget.startsWith("#")) {
    return "";
  }

  const sourceDir = source.file.includes("/")
    ? source.file.split("/").slice(0, -1).join("/")
    : "";
  const withSourceDir = cleanTarget.startsWith("/")
    ? cleanTarget.slice(1)
    : normalizePathEntry(`${sourceDir}/${cleanTarget}`);
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
  const prefix = normalizePathEntry(source.prefix);
  if (target.startsWith(prefix)) return target;
  const sourceDir = source.file.includes("/")
    ? `${source.file.split("/").slice(0, -1).join("/")}/`
    : "";
  if (sourceDir && target.startsWith(sourceDir)) {
    return normalizePathEntry(`${prefix}${target.slice(sourceDir.length)}`);
  }
  return target;
}

function readRegistrySource(source, options = {}) {
  const content = readRepositoryTextFile(source.file, options);

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
    } catch (error) {
      results.push({
        ok: false,
        rule_id: rule.id,
        kind: rule.kind,
        left_entries: [],
        right_entries: [],
        missing_from_right: [],
        extra_in_right: [],
        message: `registry rule "${rule.id}" could not be evaluated`,
        details: [error.message],
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

export const registryRuleFamily = {
  id: "registry-rules",
  evaluate(facts) {
    return {
      name: "registry-rules",
      check: checkRegistryRules(facts.policy.registry_rules, {
        repoRoot: facts.repositoryRoot,
        readFile: facts.readFile,
      }),
    };
  },
};
