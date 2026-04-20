const MODE_ALIASES = new Map([
  ["advisory", "advisory"],
  ["warn", "advisory"],
  ["blocking", "blocking"],
  ["enforce", "blocking"],
]);

export function normalizeEnforcementMode(value, label = "enforcement") {
  const raw = String(value || "").trim().toLowerCase();
  const mode = MODE_ALIASES.get(raw);
  if (!mode) {
    return {
      ok: false,
      message: `Unknown ${label}: ${value}. Must be one of: advisory, warn, blocking, enforce.`,
    };
  }
  return { ok: true, mode };
}

export function resolveEnforcementMode({ cliValue, policy }) {
  const policyValue = policy?.enforcement?.mode;
  const raw = cliValue || policyValue || "blocking";
  const source = cliValue ? "cli" : policyValue ? "policy" : "default";
  const result = normalizeEnforcementMode(raw, "enforcement mode");
  if (!result.ok) return result;
  return { ok: true, mode: result.mode, source, requested: raw };
}
