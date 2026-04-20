import { parseDocument } from "yaml";
import { uniqueSorted } from "../utils/collections.mjs";
import { readRepositoryTextFile } from "../utils/repository-files.mjs";

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function collapseMessage(message) {
  return String(message || "").replace(/\s+/g, " ").trim();
}

function parseYamlFile(content) {
  const doc = parseDocument(content, { prettyErrors: false });
  if (doc.errors.length > 0) {
    throw new Error(`invalid YAML: ${doc.errors.map((error) => collapseMessage(error.message)).join("; ")}`);
  }
  return doc.toJSON();
}

function normalizeValue(value) {
  if (value === undefined) return "";
  if (value === null) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  return JSON.stringify(value);
}

function normalizeMap(value) {
  if (!isPlainObject(value)) return null;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, normalizeValue(item)])
  );
}

function extractTriggerEvents(onValue) {
  if (typeof onValue === "string") return [onValue];
  if (Array.isArray(onValue)) {
    return onValue
      .filter((item) => item !== null && item !== undefined)
      .map((item) => normalizeValue(item));
  }
  if (isPlainObject(onValue)) return Object.keys(onValue);
  return [];
}

function extractTriggerEventTypes(onValue) {
  if (!isPlainObject(onValue)) return [];

  const result = [];
  for (const [event, config] of Object.entries(onValue)) {
    if (!isPlainObject(config) || !Object.hasOwn(config, "types")) continue;
    const rawTypes = Array.isArray(config.types) ? config.types : [config.types];
    const types = rawTypes
      .filter((item) => item !== null && item !== undefined)
      .map((item) => normalizeValue(item));
    if (types.length > 0) {
      result.push({ event, types });
    }
  }
  return result;
}

function collectEnvVars(envValue, scope, extra = {}) {
  const env = normalizeMap(envValue);
  if (!env) return [];
  return Object.entries(env).map(([name, value]) => ({
    scope,
    ...extra,
    name,
    value,
  }));
}

function collectWorkflowFacts(entry, content) {
  const data = parseYamlFile(content);
  if (!isPlainObject(data)) {
    throw new Error("workflow YAML must be a mapping");
  }

  const jobs = isPlainObject(data.jobs) ? data.jobs : {};
  const actionUses = [];
  const stepInputs = [];
  const envVars = collectEnvVars(data.env, "workflow");
  const ifConditions = [];
  const runCommands = [];
  const summaryPublishing = [];
  const continueOnError = [];
  const jobPermissions = [];

  for (const [jobId, job] of Object.entries(jobs)) {
    if (!isPlainObject(job)) continue;

    const jobPermission = normalizeMap(job.permissions);
    if (jobPermission) {
      jobPermissions.push({ jobId, permissions: jobPermission });
    } else if (typeof job.permissions === "string") {
      jobPermissions.push({ jobId, permissions: job.permissions });
    }

    envVars.push(...collectEnvVars(job.env, "job", { jobId }));

    if (job.if !== undefined) {
      ifConditions.push({
        scope: "job",
        jobId,
        condition: normalizeValue(job.if),
      });
    }

    if (job["continue-on-error"] !== undefined) {
      continueOnError.push({
        scope: "job",
        jobId,
        value: normalizeValue(job["continue-on-error"]),
      });
    }

    if (job.uses !== undefined) {
      const uses = normalizeValue(job.uses);
      actionUses.push({ scope: "job", jobId, uses });
      const inputs = normalizeMap(job.with);
      if (inputs) {
        stepInputs.push({ scope: "job", jobId, uses, inputs });
      }
    }

    if (!Array.isArray(job.steps)) continue;

    for (const [stepOffset, step] of job.steps.entries()) {
      if (!isPlainObject(step)) continue;
      const stepIndex = stepOffset + 1;
      const stepName = step.name ? normalizeValue(step.name) : undefined;
      const stepBase = { jobId, stepIndex };
      if (stepName) stepBase.stepName = stepName;

      if (step.uses !== undefined) {
        const uses = normalizeValue(step.uses);
        actionUses.push({ ...stepBase, uses });
        const inputs = normalizeMap(step.with);
        if (inputs) {
          stepInputs.push({ ...stepBase, uses, inputs });
        }
      }

      envVars.push(...collectEnvVars(step.env, "step", stepBase));

      if (step.if !== undefined) {
        ifConditions.push({
          scope: "step",
          ...stepBase,
          condition: normalizeValue(step.if),
        });
      }

      if (step["continue-on-error"] !== undefined) {
        continueOnError.push({
          ...stepBase,
          value: normalizeValue(step["continue-on-error"]),
        });
      }

      if (step.run !== undefined) {
        runCommands.push({
          ...stepBase,
          run: normalizeValue(step.run),
        });
      }

      const summaryMode = detectSummaryPublishingMode(step.run);
      if (summaryMode) {
        summaryPublishing.push({
          ...stepBase,
          mode: summaryMode,
        });
      }
    }
  }

  const workflowPermission = normalizeMap(data.permissions) ||
    (typeof data.permissions === "string" ? data.permissions : null);

  return {
    id: entry.id,
    kind: entry.kind,
    path: entry.path,
    role: entry.role,
    expect: entry.expect || null,
    triggerEvents: extractTriggerEvents(data.on),
    triggerEventTypes: extractTriggerEventTypes(data.on),
    permissions: {
      workflow: workflowPermission,
      jobs: jobPermissions,
    },
    actionUses,
    stepInputs,
    envVars,
    ifConditions,
    runCommands,
    summaryPublishing,
    continueOnError,
  };
}

function detectSummaryPublishingMode(run) {
  if (run === undefined || run === null) return null;
  const text = String(run);
  if (!text.includes("GITHUB_STEP_SUMMARY")) return null;
  const summaryTarget = String.raw`["']?\$?\{?GITHUB_STEP_SUMMARY\}?["']?`;
  const appendBeforeTarget = new RegExp(`>>\\s*${summaryTarget}`).test(text);
  const appendAfterTarget = new RegExp(`GITHUB_STEP_SUMMARY[^\\n]*>>`).test(text);
  if (appendBeforeTarget || appendAfterTarget) return "append";
  const writeBeforeTarget = new RegExp(`(^|[^>])>\\s*${summaryTarget}`).test(text);
  const writeAfterTarget = new RegExp(`GITHUB_STEP_SUMMARY[^\\n]*(^|[^>])>`).test(text);
  if (writeBeforeTarget || writeAfterTarget) return "write";
  return "mentions";
}

function parseMarkdown(content) {
  const lines = String(content || "").split(/\r?\n/);
  const headings = [];
  const codeBlocks = [];
  const errors = [];
  let fence = null;

  for (const [offset, line] of lines.entries()) {
    const lineNumber = offset + 1;

    if (!fence) {
      const heading = line.match(/^[ \t]{0,3}(#{1,6})(?:[ \t]+|$)(.*)$/);
      if (heading) {
        const text = heading[2].replace(/[ \t]+#+[ \t]*$/, "").trim();
        if (text) headings.push({ level: heading[1].length, text, line: lineNumber });
      }

      const openingFence = line.match(/^[ \t]{0,3}(`{3,}|~{3,})(.*)$/);
      if (openingFence) {
        fence = {
          marker: openingFence[1][0],
          length: openingFence[1].length,
          infoString: openingFence[2].trim(),
          startLine: lineNumber,
          contentLines: [],
        };
      }
      continue;
    }

    const closingFence = line.match(/^[ \t]{0,3}(`{3,}|~{3,})[ \t]*$/);
    if (
      closingFence &&
      closingFence[1][0] === fence.marker &&
      closingFence[1].length >= fence.length
    ) {
      const language = fence.infoString.split(/\s+/).filter(Boolean)[0] || "";
      codeBlocks.push({
        language,
        infoString: fence.infoString,
        startLine: fence.startLine,
        endLine: lineNumber,
        content: fence.contentLines.join("\n"),
      });
      fence = null;
      continue;
    }

    fence.contentLines.push(line);
  }

  if (fence) {
    errors.push({
      message: `unclosed Markdown fence starting at line ${fence.startLine}`,
    });
  }

  return { headings, codeBlocks, errors };
}

function publicCodeBlock(block) {
  return {
    language: block.language,
    infoString: block.infoString,
    startLine: block.startLine,
    endLine: block.endLine,
  };
}

function fieldPathsFromObject(value, prefix = "") {
  if (!isPlainObject(value)) return [];
  const paths = [];
  for (const key of Object.keys(value).sort()) {
    const path = prefix ? `${prefix}.${key}` : key;
    paths.push(path);
    paths.push(...fieldPathsFromObject(value[key], path));
  }
  return paths;
}

function parseContractBlock(block) {
  try {
    let data;
    if (block.language === "repo-guard-json") {
      data = JSON.parse(block.content);
    } else {
      data = parseYamlFile(block.content);
    }
    const fieldPaths = uniqueSorted(fieldPathsFromObject(data));
    return {
      ok: true,
      fieldNames: isPlainObject(data) ? Object.keys(data).sort() : [],
      fieldPaths,
    };
  } catch (e) {
    return {
      ok: false,
      message: `invalid ${block.language} block at line ${block.startLine}: ${e.message}`,
    };
  }
}

function extractContractBlocks(markdown) {
  const blocks = [];
  const errors = [];

  for (const block of markdown.codeBlocks) {
    if (block.language !== "repo-guard-yaml" && block.language !== "repo-guard-json") {
      continue;
    }

    const parsed = parseContractBlock(block);
    const fact = {
      format: block.language,
      startLine: block.startLine,
      endLine: block.endLine,
      ok: parsed.ok,
      fieldNames: parsed.fieldNames || [],
      fieldPaths: parsed.fieldPaths || [],
    };
    blocks.push(fact);

    if (!parsed.ok) {
      errors.push({ message: parsed.message });
    }
  }

  return { blocks, errors };
}

function templateFactFromMarkdown(entry, markdown) {
  const { blocks, errors } = extractContractBlocks(markdown);
  return {
    fact: {
      id: entry.id,
      kind: entry.kind,
      path: entry.path,
      present: true,
      optional: Boolean(entry.optional),
      requiresContractBlock: Boolean(entry.requires_contract_block),
      requiredBlockKind: entry.required_block_kind || null,
      requiredContractFields: entry.required_contract_fields || [],
      hasRepoGuardYamlBlock: blocks.some((block) => block.format === "repo-guard-yaml"),
      hasRepoGuardJsonBlock: blocks.some((block) => block.format === "repo-guard-json"),
      contractBlocks: blocks,
      contractFieldNames: uniqueSorted(blocks.flatMap((block) => block.fieldPaths)),
      headings: markdown.headings,
      codeBlocks: markdown.codeBlocks.map(publicCodeBlock),
    },
    errors,
  };
}

function collectStringValues(value, sourcePath = "$") {
  if (typeof value === "string") return [{ sourcePath, value }];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectStringValues(item, `${sourcePath}[${index}]`));
  }
  if (isPlainObject(value)) {
    return Object.entries(value).flatMap(([key, item]) => collectStringValues(item, `${sourcePath}.${key}`));
  }
  return [];
}

function collectIssueFormTemplateFacts(entry, content) {
  const data = parseYamlFile(content);
  const blocks = [];
  const errors = [];

  for (const source of collectStringValues(data)) {
    const markdown = parseMarkdown(source.value);
    errors.push(...markdown.errors.map((error) => ({
      message: `${source.sourcePath}: ${error.message}`,
    })));

    const extracted = extractContractBlocks(markdown);
    blocks.push(...extracted.blocks.map((block) => ({
      ...block,
      sourcePath: source.sourcePath,
    })));
    errors.push(...extracted.errors.map((error) => ({
      message: `${source.sourcePath}: ${error.message}`,
    })));
  }

  return {
    fact: {
      id: entry.id,
      kind: entry.kind,
      path: entry.path,
      present: true,
      optional: Boolean(entry.optional),
      requiresContractBlock: Boolean(entry.requires_contract_block),
      requiredBlockKind: entry.required_block_kind || null,
      requiredContractFields: entry.required_contract_fields || [],
      hasRepoGuardYamlBlock: blocks.some((block) => block.format === "repo-guard-yaml"),
      hasRepoGuardJsonBlock: blocks.some((block) => block.format === "repo-guard-json"),
      contractBlocks: blocks,
      contractFieldNames: uniqueSorted(blocks.flatMap((block) => block.fieldPaths)),
    },
    errors,
  };
}

function missingOptionalTemplateFact(entry) {
  return {
    id: entry.id,
    kind: entry.kind,
    path: entry.path,
    present: false,
    optional: true,
    requiresContractBlock: Boolean(entry.requires_contract_block),
    requiredBlockKind: entry.required_block_kind || null,
    requiredContractFields: entry.required_contract_fields || [],
    hasRepoGuardYamlBlock: false,
    hasRepoGuardJsonBlock: false,
    contractBlocks: [],
    contractFieldNames: [],
    headings: [],
    codeBlocks: [],
  };
}

function collectTemplateFacts(entry, content) {
  if (entry.kind === "github_issue_form") {
    return collectIssueFormTemplateFacts(entry, content);
  }

  const markdown = parseMarkdown(content);
  const result = templateFactFromMarkdown(entry, markdown);
  result.errors.push(...markdown.errors);
  return result;
}

function findLiteralOccurrences(content, term) {
  if (!term) return [];
  const needle = String(term).toLowerCase();
  const locations = [];

  for (const [offset, line] of String(content || "").split(/\r?\n/).entries()) {
    const haystack = line.toLowerCase();
    let index = 0;
    while ((index = haystack.indexOf(needle, index)) !== -1) {
      locations.push({ line: offset + 1, column: index + 1 });
      index += Math.max(needle.length, 1);
    }
  }

  return locations;
}

function mentionFact(content, term) {
  const locations = findLiteralOccurrences(content, term);
  return {
    term,
    present: locations.length > 0,
    count: locations.length,
    locations,
  };
}

function collectDocFacts(entry, content) {
  const markdown = parseMarkdown(content);
  return {
    fact: {
      id: entry.id,
      path: entry.path,
      headings: markdown.headings,
      codeBlocks: markdown.codeBlocks.map(publicCodeBlock),
      hasCodeBlocks: markdown.codeBlocks.length > 0,
      mentions: (entry.must_mention || []).map((term) => mentionFact(content, term)),
      fileReferences: (entry.must_reference_files || []).map((term) => mentionFact(content, term)),
      profileMentions: (entry.must_mention_profiles || []).map((term) => mentionFact(content, term)),
      contractFieldMentions: (entry.must_mention_contract_fields || []).map((term) => mentionFact(content, term)),
    },
    errors: markdown.errors,
  };
}

function collectRegexFacts(content, regexes) {
  const facts = [];
  const seen = new Set();
  const lines = String(content || "").split(/\r?\n/);

  for (const [offset, line] of lines.entries()) {
    for (const sourceRegex of regexes) {
      const regex = new RegExp(sourceRegex.source, sourceRegex.flags.includes("g")
        ? sourceRegex.flags
        : `${sourceRegex.flags}g`);
      let match;
      while ((match = regex.exec(line)) !== null) {
        const value = match[1];
        if (!value) continue;
        const column = match.index + match[0].lastIndexOf(value) + 1;
        const key = `${value}:${offset + 1}:${column}`;
        if (!seen.has(key)) {
          seen.add(key);
          facts.push({ value, line: offset + 1, column });
        }
      }
    }
  }

  return facts;
}

function profileReferenceFacts(content, profileId) {
  const values = uniqueSorted([
    profileId,
    String(profileId || "").replace(/[-_.]+/g, " ").trim(),
  ].filter(Boolean));
  const facts = [];
  const seen = new Set();

  for (const value of values) {
    for (const location of findLiteralOccurrences(content, value)) {
      const key = `${profileId}:${location.line}:${location.column}`;
      if (seen.has(key)) continue;
      seen.add(key);
      facts.push({ value: profileId, ...location });
    }
  }

  facts.sort((left, right) => left.line - right.line || left.column - right.column || left.value.localeCompare(right.value));
  return facts;
}

function collectProfileFacts(entry, content) {
  const markdown = parseMarkdown(content);
  const identifiers = collectRegexFacts(content, [
    /\bprofile[ _-]?id\b\s*[:=]\s*`?([A-Za-z0-9_.-]+)/i,
    /\bprofile\b\s*[:=]\s*`?([A-Za-z0-9_.-]+)/i,
  ]);
  const migrationTargets = collectRegexFacts(content, [
    /\bmigration[ _-]?target\b\s*[:=]\s*`?([A-Za-z0-9_.-]+)/i,
    /\bmigrat(?:e|es|ed|ing)\s+to\s+`?([A-Za-z0-9_.-]+)/i,
  ]);

  return {
    fact: {
      id: entry.id,
      docPath: entry.doc_path,
      headings: markdown.headings,
      codeBlocks: markdown.codeBlocks.map(publicCodeBlock),
      identifiers,
      migrationTargets,
      profileNameReferences: profileReferenceFacts(content, entry.id),
    },
    errors: markdown.errors,
  };
}

function compareErrors(left, right) {
  return left.section.localeCompare(right.section) ||
    (left.path || "").localeCompare(right.path || "") ||
    (left.id || "").localeCompare(right.id || "") ||
    left.message.localeCompare(right.message);
}

function withErrorContext(section, entry, message) {
  return {
    section,
    id: entry.id,
    kind: entry.kind,
    path: entry.path || entry.doc_path,
    message,
  };
}

function isMissingRepositoryFileError(error, entry) {
  const message = String(error?.message || "");
  return error?.code === "ENOENT" ||
    message.includes("ENOENT") ||
    message.includes("no such file or directory") ||
    message === `cannot read ${entry.path}` ||
    message.includes(`missing fixture ${entry.path}`);
}

export function extractIntegration(policy, options = {}) {
  const integration = policy.integration;
  const result = {
    workflows: [],
    templates: [],
    docs: [],
    profiles: [],
    errors: [],
  };

  if (!integration) return result;

  const contentCache = new Map();
  function contentFor(file) {
    if (!contentCache.has(file)) {
      contentCache.set(file, readRepositoryTextFile(file, options));
    }
    return contentCache.get(file);
  }

  for (const entry of integration.workflows || []) {
    try {
      result.workflows.push(collectWorkflowFacts(entry, contentFor(entry.path)));
    } catch (e) {
      result.errors.push(withErrorContext("workflows", entry, e.message));
    }
  }

  for (const entry of integration.templates || []) {
    try {
      const extracted = collectTemplateFacts(entry, contentFor(entry.path));
      result.templates.push(extracted.fact);
      result.errors.push(...extracted.errors.map((error) =>
        withErrorContext("templates", entry, error.message)
      ));
    } catch (e) {
      if (entry.optional === true && isMissingRepositoryFileError(e, entry)) {
        result.templates.push(missingOptionalTemplateFact(entry));
      } else {
        result.errors.push(withErrorContext("templates", entry, e.message));
      }
    }
  }

  for (const entry of integration.docs || []) {
    try {
      const extracted = collectDocFacts(entry, contentFor(entry.path));
      result.docs.push(extracted.fact);
      result.errors.push(...extracted.errors.map((error) =>
        withErrorContext("docs", entry, error.message)
      ));
    } catch (e) {
      result.errors.push(withErrorContext("docs", entry, e.message));
    }
  }

  for (const entry of integration.profiles || []) {
    try {
      const extracted = collectProfileFacts(entry, contentFor(entry.doc_path));
      result.profiles.push(extracted.fact);
      result.errors.push(...extracted.errors.map((error) =>
        withErrorContext("profiles", entry, error.message)
      ));
    } catch (e) {
      result.errors.push(withErrorContext("profiles", entry, e.message));
    }
  }

  result.errors.sort(compareErrors);
  return result;
}
