import { mkdtempSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { execSync } from "node:child_process";
import Ajv from "ajv";

const __dirname = new URL(".", import.meta.url).pathname;
const projectRoot = resolve(__dirname, "..");

let failures = 0;

function expect(label, actual, expected) {
  const passed = actual === expected;
  console.log(`${passed ? "PASS" : "FAIL"}: ${label}`);
  if (!passed) {
    failures++;
    console.error(`  expected: ${JSON.stringify(expected)}, got: ${JSON.stringify(actual)}`);
  }
}

function expectIncludes(label, str, substring) {
  const passed = str.includes(substring);
  console.log(`${passed ? "PASS" : "FAIL"}: ${label}`);
  if (!passed) {
    failures++;
    console.error(`  expected to include: ${JSON.stringify(substring)}`);
  }
}

function makeTmpDir() {
  return mkdtempSync(join(tmpdir(), "repo-guard-init-"));
}

function runInit(args = "", cwd) {
  const cmd = `node ${resolve(projectRoot, "src/repo-guard.mjs")} ${args}`;
  return execSync(cmd, { encoding: "utf-8", cwd: cwd || projectRoot });
}

const policySchema = JSON.parse(readFileSync(resolve(projectRoot, "schemas/repo-policy.schema.json"), "utf-8"));
const ajv = new Ajv({ allErrors: true });
const validatePolicy = ajv.compile(policySchema);

// --- default preset and mode ---

console.log("\n--- default init (application + enforce) ---");
{
  const dir = makeTmpDir();
  const out = runInit(`--repo-root ${dir} init`);
  expectIncludes("default output mentions preset", out, "preset: application");
  expectIncludes("default output mentions enforcement", out, "enforcement: blocking");

  expect("creates repo-policy.json", existsSync(join(dir, "repo-policy.json")), true);
  expect("creates workflow", existsSync(join(dir, ".github/workflows/repo-guard.yml")), true);
  expect("creates PR template", existsSync(join(dir, ".github/PULL_REQUEST_TEMPLATE.md")), true);
  expect("creates issue template", existsSync(join(dir, ".github/ISSUE_TEMPLATE/change-contract.yml")), true);

  const policy = JSON.parse(readFileSync(join(dir, "repo-policy.json"), "utf-8"));
  expect("default policy kind", policy.repository_kind, "application");
  expect("default policy version", policy.policy_format_version, "0.3.0");
  expect("default max_new_files", policy.diff_rules.max_new_files, 20);

  const valid = validatePolicy(policy);
  expect("default policy validates against schema", valid, true);
}

// --- all presets produce valid policies ---

console.log("\n--- preset validation ---");
for (const preset of ["application", "library", "tooling", "documentation"]) {
  for (const mode of ["enforce", "advisory"]) {
    const dir = makeTmpDir();
    runInit(`--repo-root ${dir} init --preset ${preset} --mode ${mode}`);
    const policy = JSON.parse(readFileSync(join(dir, "repo-policy.json"), "utf-8"));
    const valid = validatePolicy(policy);
    expect(`${preset}+${mode} validates`, valid, true);
    expect(`${preset}+${mode} kind`, policy.repository_kind, preset);
  }
}

// --- advisory mode sets non-blocking enforcement without changing budgets ---

console.log("\n--- advisory mode enforcement ---");
{
  const dir = makeTmpDir();
  runInit(`--repo-root ${dir} init --preset library --mode advisory`);
  const policy = JSON.parse(readFileSync(join(dir, "repo-policy.json"), "utf-8"));
  expect("advisory enforcement mode", policy.enforcement.mode, "advisory");
  expect("advisory preserves preset max_new_files", policy.diff_rules.max_new_files, 15);
  expect("advisory preserves preset max_new_docs", policy.diff_rules.max_new_docs, 2);
  expect("advisory preserves preset max_net_added_lines", policy.diff_rules.max_net_added_lines, 1000);
}

// --- enforce mode uses preset budgets ---

console.log("\n--- enforce mode budgets ---");
{
  const dir = makeTmpDir();
  runInit(`--repo-root ${dir} init --preset library --mode enforce`);
  const policy = JSON.parse(readFileSync(join(dir, "repo-policy.json"), "utf-8"));
  expect("enforce maps to blocking enforcement", policy.enforcement.mode, "blocking");
  expect("enforce max_new_files", policy.diff_rules.max_new_files, 15);
  expect("enforce max_new_docs", policy.diff_rules.max_new_docs, 2);
  expect("enforce max_net_added_lines", policy.diff_rules.max_net_added_lines, 1000);
}

// --- --enforcement alias works with init ---

console.log("\n--- enforcement alias ---");
{
  const dir = makeTmpDir();
  runInit(`--repo-root ${dir} --enforcement warn init --preset tooling`);
  const policy = JSON.parse(readFileSync(join(dir, "repo-policy.json"), "utf-8"));
  const workflow = readFileSync(join(dir, ".github/workflows/repo-guard.yml"), "utf-8");
  expect("warn alias maps to advisory policy", policy.enforcement.mode, "advisory");
  expectIncludes("warn alias maps to advisory workflow", workflow, "enforcement: advisory");
}

// --- idempotency: skips existing files ---

console.log("\n--- idempotency ---");
{
  const dir = makeTmpDir();
  runInit(`--repo-root ${dir} init`);
  const out = runInit(`--repo-root ${dir} init`);
  expectIncludes("second run mentions skipped", out, "Skipped (already exist)");
  expectIncludes("second run mentions nothing to do", out, "All files already exist");
}

// --- does not overwrite existing files ---

console.log("\n--- does not overwrite ---");
{
  const dir = makeTmpDir();
  const policyPath = join(dir, "repo-policy.json");
  writeFileSync(policyPath, '{"custom": true}', "utf-8");
  runInit(`--repo-root ${dir} init`);
  const content = readFileSync(policyPath, "utf-8");
  expectIncludes("existing file preserved", content, '"custom"');
}

// --- workflow references repo-guard action ---

console.log("\n--- workflow content ---");
{
  const dir = makeTmpDir();
  runInit(`--repo-root ${dir} init`);
  const workflow = readFileSync(join(dir, ".github/workflows/repo-guard.yml"), "utf-8");
  expectIncludes("workflow uses repo-guard action", workflow, "netkeep80/repo-guard@main");
  expectIncludes("workflow uses check-pr", workflow, "mode: check-pr");
  expectIncludes("workflow uses blocking enforcement", workflow, "enforcement: blocking");
  expectIncludes("workflow has fetch-depth 0", workflow, "fetch-depth: 0");
  expectIncludes("workflow has GH_TOKEN", workflow, "GH_TOKEN");
}

// --- PR template has contract block ---

console.log("\n--- PR template content ---");
{
  const dir = makeTmpDir();
  runInit(`--repo-root ${dir} init`);
  const tpl = readFileSync(join(dir, ".github/PULL_REQUEST_TEMPLATE.md"), "utf-8");
  expectIncludes("PR template has contract block", tpl, "```repo-guard-json");
  expectIncludes("PR template has change_type", tpl, "change_type");
}

// --- issue template has contract block ---

console.log("\n--- issue template content ---");
{
  const dir = makeTmpDir();
  runInit(`--repo-root ${dir} init`);
  const tpl = readFileSync(join(dir, ".github/ISSUE_TEMPLATE/change-contract.yml"), "utf-8");
  expectIncludes("issue template has contract block", tpl, "repo-guard-json");
  expectIncludes("issue template has change_type", tpl, "change_type");
  expectIncludes("issue template has description field", tpl, "Description");
}

// --- library preset includes cochange rule ---

console.log("\n--- library preset cochange ---");
{
  const dir = makeTmpDir();
  runInit(`--repo-root ${dir} init --preset library`);
  const policy = JSON.parse(readFileSync(join(dir, "repo-policy.json"), "utf-8"));
  expect("library has cochange rules", policy.cochange_rules.length, 1);
  expect("library cochange if_changed", policy.cochange_rules[0].if_changed[0], "src/**");
  expect("library cochange must_change_any", policy.cochange_rules[0].must_change_any[0], "tests/**");
}

// --- help flag ---

console.log("\n--- help flag ---");
{
  const out = runInit("init --help");
  expectIncludes("help shows usage", out, "Usage: repo-guard init");
  expectIncludes("help lists presets", out, "application, library, tooling, documentation");
  expectIncludes("help lists modes", out, "advisory");
}

// --- error: unknown preset ---

console.log("\n--- error handling ---");
{
  let threw = false;
  try {
    runInit("init --preset unknown");
  } catch (e) {
    threw = true;
    expectIncludes("unknown preset error", e.stderr || e.stdout || "", "Unknown preset");
  }
  expect("unknown preset throws", threw, true);
}

{
  let threw = false;
  try {
    runInit("init --mode wrong");
  } catch (e) {
    threw = true;
    expectIncludes("unknown mode error", e.stderr || e.stdout || "", "Unknown mode");
  }
  expect("unknown mode throws", threw, true);
}

{
  let threw = false;
  try {
    runInit("init --bad-flag");
  } catch (e) {
    threw = true;
  }
  expect("unknown flag throws", threw, true);
}

// --- generated policy is actually runnable (repo-guard validate) ---

console.log("\n--- generated policy runnable ---");
{
  const dir = makeTmpDir();
  runInit(`--repo-root ${dir} init --preset tooling`);
  const out = runInit(`--repo-root ${dir}`);
  expectIncludes("validate passes on generated policy", out, "OK: repo-policy.json");
}

// --- summary ---

console.log(`\n${failures === 0 ? "All init tests passed." : `${failures} test(s) FAILED.`}`);
process.exit(failures > 0 ? 1 : 0);
