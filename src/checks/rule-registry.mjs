function assertRuleFamily(family) {
  if (!family || typeof family !== "object") {
    throw new TypeError("rule family must be an object");
  }
  if (!family.id || typeof family.id !== "string") {
    throw new TypeError("rule family requires a string id");
  }
  if (typeof family.evaluate !== "function") {
    throw new TypeError(`rule family "${family.id}" requires an evaluate function`);
  }
}

function normalizeRuleEntries(family, entries) {
  const list = Array.isArray(entries) ? entries : [entries];
  return list
    .filter(Boolean)
    .map((entry) => {
      if (!entry.name || !entry.check) {
        throw new TypeError(`rule family "${family.id}" returned an invalid rule entry`);
      }
      return {
        family: family.id,
        name: entry.name,
        check: entry.check,
      };
    });
}

export function createRuleRegistry() {
  const families = [];
  const ids = new Set();

  return {
    register(family) {
      assertRuleFamily(family);
      if (ids.has(family.id)) {
        throw new Error(`rule family "${family.id}" is already registered`);
      }
      families.push(family);
      ids.add(family.id);
      return this;
    },

    list() {
      return families.map((family) => family.id);
    },

    evaluate(facts, context = {}) {
      return families.flatMap((family) => {
        if (family.applies && !family.applies(facts, context)) return [];
        return normalizeRuleEntries(family, family.evaluate(facts, context));
      });
    },
  };
}
