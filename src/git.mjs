import { execFileSync } from "node:child_process";

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
    const subcommand = args[0] ? ` ${args[0]}` : "";
    throw new Error(`git${subcommand} failed: ${childProcessMessage(error)}`);
  }
}

export function getDiff(base, head, cwd) {
  if (base && head) {
    return runGit(["diff", `${base}...${head}`], { cwd });
  }
  const staged = runGit(["diff", "--cached"], { cwd });
  if (staged.trim()) return staged;
  return runGit(["diff", "HEAD"], { cwd });
}
