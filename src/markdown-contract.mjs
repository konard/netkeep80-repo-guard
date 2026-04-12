const FENCE_RE = /^```repo-guard-json\s*\n([\s\S]*?)^```\s*$/gm;

export function extractContract(markdown) {
  if (!markdown || typeof markdown !== "string") {
    return { ok: false, error: "contract_not_found", message: "No markdown text provided" };
  }

  const blocks = [];
  let match;
  while ((match = FENCE_RE.exec(markdown)) !== null) {
    blocks.push(match[1]);
  }

  if (blocks.length === 0) {
    return { ok: false, error: "contract_not_found", message: "No repo-guard-json block found in markdown" };
  }

  if (blocks.length > 1) {
    return { ok: false, error: "multiple_contracts", message: `Found ${blocks.length} repo-guard-json blocks; expected exactly one` };
  }

  let parsed;
  try {
    parsed = JSON.parse(blocks[0]);
  } catch (e) {
    return { ok: false, error: "contract_malformed_json", message: `Invalid JSON in repo-guard-json block: ${e.message}` };
  }

  return { ok: true, contract: parsed };
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
