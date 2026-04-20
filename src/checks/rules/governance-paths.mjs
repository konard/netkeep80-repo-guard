import { matchesAny } from "../../utils/path-patterns.mjs";

function expandGovernancePattern(pattern) {
  if (typeof pattern !== "string" || pattern.length === 0) return [];
  if (pattern.endsWith("/")) {
    return [`${pattern}**`];
  }
  return [pattern];
}

export function expandGovernancePatterns(patterns = []) {
  const expanded = [];
  for (const pattern of patterns) {
    for (const value of expandGovernancePattern(pattern)) {
      if (!expanded.includes(value)) expanded.push(value);
    }
  }
  return expanded;
}

function matchingPatterns(filePath, patterns) {
  return (patterns || []).filter((pattern) => matchesAny(filePath, expandGovernancePattern(pattern)));
}

function authorizationCoversPath(filePath, authorizedPatterns) {
  if (!Array.isArray(authorizedPatterns) || authorizedPatterns.length === 0) return false;
  return matchesAny(filePath, expandGovernancePatterns(authorizedPatterns));
}

export function checkGovernanceChangeAuthorization({
  files,
  governancePaths,
  contract,
  contractSource,
}) {
  if (!Array.isArray(governancePaths) || governancePaths.length === 0) {
    return { ok: true };
  }

  const touchedGovernance = [];
  for (const file of files) {
    const matched = matchingPatterns(file.path, governancePaths);
    if (matched.length > 0) {
      touchedGovernance.push({ path: file.path, matched });
    }
  }

  if (touchedGovernance.length === 0) {
    return {
      ok: true,
      touched_governance_paths: [],
    };
  }

  const authorized = contract && Array.isArray(contract.authorized_governance_paths)
    ? contract.authorized_governance_paths
    : [];
  const issueAuthorized = contractSource === "linked issue";

  const unauthorized = [];
  const unsanctioned = [];

  for (const entry of touchedGovernance) {
    const covered = authorizationCoversPath(entry.path, authorized);
    if (!covered) {
      unauthorized.push(entry.path);
      continue;
    }
    if (!issueAuthorized) {
      unsanctioned.push(entry.path);
    }
  }

  const details = [];
  for (const path of unauthorized) {
    details.push(
      `governance path ${path} changed without matching contract.authorized_governance_paths entry`
    );
  }
  for (const path of unsanctioned) {
    details.push(
      `governance path ${path} is authorized in contract but contract source is "${contractSource}"; authorization must originate from the linked issue body`
    );
  }

  const ok = unauthorized.length === 0 && unsanctioned.length === 0;
  return {
    ok,
    message: ok
      ? undefined
      : "governance_paths changed without issue-sanctioned authorization in the change contract",
    touched_governance_paths: touchedGovernance.map((entry) => entry.path),
    authorized_governance_paths: authorized,
    unauthorized_paths: unauthorized,
    unsanctioned_paths: unsanctioned,
    contract_source: contractSource,
    details,
    hint: ok
      ? undefined
      : "Sanction governance changes from the linked issue: add authorized_governance_paths to the contract block in the issue body listing the governance files the PR may modify.",
  };
}

export const governancePathsRuleFamily = {
  id: "governance-paths",
  applies(facts) {
    return Array.isArray(facts.policy.paths?.governance_paths) &&
      facts.policy.paths.governance_paths.length > 0;
  },
  evaluate(facts) {
    return {
      name: "governance-change-authorization",
      check: checkGovernanceChangeAuthorization({
        files: facts.diff.files.checked,
        governancePaths: facts.policy.paths.governance_paths,
        contract: facts.contract,
        contractSource: facts.contractSource,
      }),
    };
  },
};
