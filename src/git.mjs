import { execFileSync } from "node:child_process";

const SAFE_GIT_REF = /^[A-Za-z0-9@][A-Za-z0-9._/@~^-]*$/;
const MAX_GIT_REF_LENGTH = 256;

function invalidGitRef(message) {
  return { ok: false, message };
}

function describeGitRef(label) {
  return label ? `git ref for ${label}` : "git ref";
}

export function validateGitRef(ref, label = "") {
  const name = describeGitRef(label);
  if (typeof ref !== "string") {
    return invalidGitRef(`Invalid ${name}: expected a string`);
  }
  if (ref.length === 0) {
    return invalidGitRef(`Invalid ${name}: value is required`);
  }
  if (ref.trim() !== ref) {
    return invalidGitRef(`Invalid ${name}: leading or trailing whitespace is not allowed`);
  }
  if (ref.length > MAX_GIT_REF_LENGTH) {
    return invalidGitRef(`Invalid ${name}: value is too long`);
  }
  if (ref.startsWith("-")) {
    return invalidGitRef(`Invalid ${name}: must not start with '-'`);
  }
  if (ref.endsWith("/") || ref.endsWith(".")) {
    return invalidGitRef(`Invalid ${name}: must not end with '/' or '.'`);
  }
  if (ref.includes("..")) {
    return invalidGitRef(`Invalid ${name}: '..' is not allowed`);
  }
  if (ref.includes("//")) {
    return invalidGitRef(`Invalid ${name}: empty path segments are not allowed`);
  }
  if (ref.includes("@{")) {
    return invalidGitRef(`Invalid ${name}: reflog syntax is not allowed`);
  }
  if (ref.endsWith(".lock") || ref.includes(".lock/")) {
    return invalidGitRef(`Invalid ${name}: '.lock' path segments are not allowed`);
  }
  if (!SAFE_GIT_REF.test(ref)) {
    return invalidGitRef(`Invalid ${name}: contains unsupported characters`);
  }
  return { ok: true };
}

export function validateGitDiffRefs(base, head, options = {}) {
  const {
    baseLabel = "--base",
    headLabel = "--head",
    requireBoth = false,
  } = options;

  if (requireBoth && (!base || !head)) {
    return invalidGitRef(`Invalid git refs: ${baseLabel} and ${headLabel} are required`);
  }

  if (base !== null && base !== undefined) {
    const result = validateGitRef(base, baseLabel);
    if (!result.ok) return result;
  }
  if (head !== null && head !== undefined) {
    const result = validateGitRef(head, headLabel);
    if (!result.ok) return result;
  }

  return { ok: true };
}

function childProcessMessage(error) {
  const stderr = error?.stderr?.toString?.().trim();
  if (stderr) return stderr;
  const stdout = error?.stdout?.toString?.().trim();
  if (stdout) return stdout;
  return error?.message || "command failed";
}

export function runGit(args, options = {}) {
  try {
    return execFileSync("git", args, {
      encoding: "utf-8",
      cwd: options.cwd,
      stdio: options.stdio || "pipe",
    });
  } catch (error) {
    throw new Error(`git ${args.join(" ")} failed: ${childProcessMessage(error)}`);
  }
}

export function getDiff(base, head, cwd) {
  const refCheck = validateGitDiffRefs(base, head);
  if (!refCheck.ok) {
    throw new Error(refCheck.message);
  }

  if (base && head) {
    return runGit(["diff", `${base}...${head}`], { cwd });
  }
  const staged = runGit(["diff", "--cached"], { cwd });
  if (staged.trim()) return staged;
  return runGit(["diff", "HEAD"], { cwd });
}
