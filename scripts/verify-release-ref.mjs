#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_REPO = "netkeep80/repo-guard";
const GITHUB_API = "https://api.github.com";
const PASS = "PASS";
const FAIL = "FAIL";

const __dirname = dirname(fileURLToPath(import.meta.url));
const defaultPackageRoot = resolve(__dirname, "..");

function loadPackageVersion(packageRoot) {
  const packagePath = resolve(packageRoot, "package.json");
  const packageJson = JSON.parse(readFileSync(packagePath, "utf-8"));
  if (!packageJson.version || typeof packageJson.version !== "string") {
    throw new Error(`Cannot determine repo-guard package version from ${packagePath}`);
  }
  return packageJson.version;
}

function tokenHeaders(token) {
  const headers = {
    accept: "application/vnd.github+json",
    "user-agent": "repo-guard-release-ref-verifier",
    "x-github-api-version": "2022-11-28",
  };
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

async function githubGet(path, { repo, token, fetchImpl }) {
  const url = `${GITHUB_API}/repos/${repo}${path}`;
  let response;
  try {
    response = await fetchImpl(url, { headers: tokenHeaders(token) });
  } catch (e) {
    return { ok: false, status: 0, url, message: `request failed: ${e.message}` };
  }

  let body = null;
  try {
    body = await response.json();
  } catch {
    // Some error responses may not be JSON. Keep the status as the diagnostic.
  }

  if (response.status === 200) return { ok: true, status: response.status, url, body };
  const message = body?.message || `HTTP ${response.status}`;
  return { ok: false, status: response.status, url, body, message };
}

function pass(name, message) {
  return { name, status: PASS, message };
}

function fail(name, message, hint = null) {
  return { name, status: FAIL, message, hint };
}

export function expectedTagForVersion(version) {
  return `v${version}`;
}

export async function verifyReleaseRef({
  packageRoot = defaultPackageRoot,
  repo = DEFAULT_REPO,
  tag = null,
  token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "",
  fetchImpl = globalThis.fetch,
} = {}) {
  const checks = [];
  let packageVersion = null;
  let expectedTag = null;

  if (!fetchImpl) {
    checks.push(fail("github-api-client", "No fetch implementation is available"));
    return { ok: false, packageVersion, expectedTag, repo, checks };
  }

  try {
    packageVersion = loadPackageVersion(packageRoot);
    expectedTag = expectedTagForVersion(packageVersion);
    checks.push(pass("package-version", `package.json version is ${packageVersion}`));
  } catch (e) {
    checks.push(fail("package-version", e.message));
    return { ok: false, packageVersion, expectedTag, repo, checks };
  }

  const suppliedTag = tag?.trim() || expectedTag;
  if (suppliedTag !== expectedTag) {
    checks.push(fail(
      "release-tag-matches-package",
      `Release tag ${suppliedTag} does not match package.json version ${packageVersion}`,
      `Publish or verify ${expectedTag}, or bump package.json.version to match ${suppliedTag}`
    ));
    return { ok: false, packageVersion, expectedTag, repo, checks };
  }
  checks.push(pass("release-tag-matches-package", `${suppliedTag} matches package.json.version`));

  const encodedTag = encodeURIComponent(expectedTag);
  const tagResult = await githubGet(`/git/ref/tags/${encodedTag}`, { repo, token, fetchImpl });
  if (!tagResult.ok) {
    checks.push(fail(
      "published-git-tag",
      `Git tag ${expectedTag} was not found in ${repo}: ${tagResult.message}`,
      `Push the release tag before publishing package version ${packageVersion}`
    ));
    return { ok: false, packageVersion, expectedTag, repo, checks };
  }
  checks.push(pass("published-git-tag", `Git tag ${expectedTag} exists in ${repo}`));

  const releaseResult = await githubGet(`/releases/tags/${encodedTag}`, { repo, token, fetchImpl });
  if (!releaseResult.ok) {
    checks.push(fail(
      "published-github-release",
      `GitHub release ${expectedTag} was not found in ${repo}: ${releaseResult.message}`,
      `Create and publish the GitHub release before publishing package version ${packageVersion}`
    ));
    return { ok: false, packageVersion, expectedTag, repo, checks };
  }
  if (releaseResult.body?.draft === true) {
    checks.push(fail(
      "published-github-release",
      `GitHub release ${expectedTag} exists but is still a draft`,
      "Publish the draft release before publishing the npm package"
    ));
    return { ok: false, packageVersion, expectedTag, repo, checks };
  }
  checks.push(pass("published-github-release", `GitHub release ${expectedTag} is published in ${repo}`));

  return {
    ok: checks.every((check) => check.status === PASS),
    packageVersion,
    expectedTag,
    repo,
    checks,
  };
}

function usage() {
  return `Usage: node scripts/verify-release-ref.mjs [--repo <owner/repo>] [--tag <vX.Y.Z>] [--package-root <path>]

Checks the release invariant used by repo-guard init:
  package.json.version <-> published Git tag and GitHub release v<version>
`;
}

function parseArgs(args) {
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      opts.help = true;
    } else if (arg === "--repo" && args[i + 1]) {
      opts.repo = args[++i];
    } else if (arg === "--tag" && args[i + 1]) {
      opts.tag = args[++i];
    } else if (arg === "--package-root" && args[i + 1]) {
      opts.packageRoot = resolve(args[++i]);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return opts;
}

function printResult(result) {
  console.log("repo-guard release ref verification\n");
  console.log(`Repository: ${result.repo}`);
  if (result.packageVersion) console.log(`package.json version: ${result.packageVersion}`);
  if (result.expectedTag) {
    console.log(`Expected Action ref: ${result.repo}@${result.expectedTag}`);
  }
  console.log("");

  for (const check of result.checks) {
    console.log(`${check.status}: ${check.name}`);
    console.log(`  ${check.message}`);
    if (check.hint) console.log(`  hint: ${check.hint}`);
  }
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    console.error(usage());
    process.exit(2);
  }

  if (opts.help) {
    console.log(usage());
    process.exit(0);
  }

  const result = await verifyReleaseRef(opts);
  printResult(result);
  process.exit(result.ok ? 0 : 1);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((e) => {
    console.error(`ERROR: ${e.message}`);
    process.exit(1);
  });
}
