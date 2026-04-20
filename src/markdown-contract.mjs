import { parse as parseYaml } from "yaml";

const FENCE_RE = /^[ \t]*```(repo-guard-json|repo-guard-yaml)\s*\n([\s\S]*?)^[ \t]*```\s*$/gm;
const FORMAT_LABELS = {
  "repo-guard-json": "JSON",
  "repo-guard-yaml": "YAML",
};

function parseContractBlock(block) {
  try {
    if (block.format === "repo-guard-json") {
      return { ok: true, contract: JSON.parse(block.content) };
    }
    return { ok: true, contract: parseYaml(block.content) };
  } catch (e) {
    const format = FORMAT_LABELS[block.format];
    return {
      ok: false,
      error: `contract_malformed_${format.toLowerCase()}`,
      message: `Invalid ${format} in ${block.format} block: ${e.message}`,
    };
  }
}

export function extractContract(markdown) {
  if (!markdown || typeof markdown !== "string") {
    return { ok: false, error: "contract_not_found", message: "No markdown text provided" };
  }

  const blocks = [];
  let match;
  while ((match = FENCE_RE.exec(markdown)) !== null) {
    blocks.push({ format: match[1], content: match[2] });
  }

  if (blocks.length === 0) {
    return { ok: false, error: "contract_not_found", message: "No repo-guard-json or repo-guard-yaml block found in markdown" };
  }

  if (blocks.length > 1) {
    return { ok: false, error: "multiple_contracts", message: `Found ${blocks.length} repo-guard contract blocks; expected exactly one` };
  }

  return parseContractBlock(blocks[0]);
}

const ISSUE_LINK_RE = /(?:Fixes|Closes|Resolves)\s+(?:[\w.-]+\/[\w.-]+)?#(\d+)/gi;

export function extractLinkedIssueNumbers(text) {
  if (!text || typeof text !== "string") return [];
  const numbers = [];
  let match;
  while ((match = ISSUE_LINK_RE.exec(text)) !== null) {
    numbers.push(parseInt(match[1], 10));
  }
  return [...new Set(numbers)];
}

export function resolveContract(prBody, issueBody) {
  const prResult = extractContract(prBody);
  if (prResult.ok) return prResult;

  if (prResult.error !== "contract_not_found") return prResult;

  if (!issueBody) {
    return { ok: false, error: "contract_not_found", message: "No contract in PR body and no linked issue body available" };
  }

  const issueResult = extractContract(issueBody);
  if (issueResult.ok) return issueResult;

  if (issueResult.error === "contract_not_found") {
    return { ok: false, error: "fallback_missing", message: "No contract found in PR body or linked issue body" };
  }

  return issueResult;
}

const PRIVILEGED_AUTHORIZATION_FIELDS = ["authorized_governance_paths"];

export function extractIssueAuthorization(issueBody) {
  if (!issueBody) return null;
  const result = extractContract(issueBody);
  if (!result.ok) return null;
  const authorization = {};
  let hasAny = false;
  for (const field of PRIVILEGED_AUTHORIZATION_FIELDS) {
    if (Object.hasOwn(result.contract, field)) {
      authorization[field] = result.contract[field];
      hasAny = true;
    }
  }
  return hasAny ? authorization : null;
}
