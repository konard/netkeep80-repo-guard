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
  issueAuthorization,
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

  const trustedAuthorization = issueAuthorization && Array.isArray(issueAuthorization.authorized_governance_paths)
    ? issueAuthorization.authorized_governance_paths
    : [];
  const prBodyAuthorizationDeclared = contract && Array.isArray(contract.authorized_governance_paths)
    ? contract.authorized_governance_paths
    : [];
  const untrustedAuthorizationAttempted =
    contractSource !== "linked issue" && prBodyAuthorizationDeclared.length > 0;

  const unauthorized = [];
  for (const entry of touchedGovernance) {
    if (!authorizationCoversPath(entry.path, trustedAuthorization)) {
      unauthorized.push(entry.path);
    }
  }

  const details = [];
  for (const path of unauthorized) {
    details.push(
      `governance path ${path} changed without matching authorized_governance_paths entry in the linked issue body`
    );
  }
  if (untrustedAuthorizationAttempted) {
    details.push(
      `authorized_governance_paths declared in contract source "${contractSource}" is ignored; governance authorization must originate from the linked issue body`
    );
  }

  const ok = unauthorized.length === 0;
  return {
    ok,
    message: ok
      ? undefined
      : "governance_paths changed without issue-sanctioned authorization",
    touched_governance_paths: touchedGovernance.map((entry) => entry.path),
    trusted_authorized_governance_paths: trustedAuthorization,
    unauthorized_paths: unauthorized,
    untrusted_authorization_ignored: untrustedAuthorizationAttempted,
    contract_source: contractSource,
    details,
    hint: ok
      ? undefined
      : "Sanction governance changes from the linked issue: add a repo-guard contract block to the issue body with authorized_governance_paths listing the governance files this PR may modify. Authorization placed in the PR body is ignored so an AI agent cannot self-sanction policy changes.",
  };
}

export const governancePathsRuleFamily = {
  id: "governance-paths",
  applies(facts) {
    const trusted = Array.isArray(facts.trustedGovernancePaths)
      ? facts.trustedGovernancePaths
      : facts.policy.paths?.governance_paths;
    return Array.isArray(trusted) && trusted.length > 0;
  },
  evaluate(facts) {
    const trusted = Array.isArray(facts.trustedGovernancePaths)
      ? facts.trustedGovernancePaths
      : facts.policy.paths?.governance_paths;
    return {
      name: "governance-change-authorization",
      check: checkGovernanceChangeAuthorization({
        files: facts.diff.files.checked,
        governancePaths: trusted,
        issueAuthorization: facts.issueAuthorization,
        contract: facts.contract,
        contractSource: facts.contractSource,
      }),
    };
  },
};
