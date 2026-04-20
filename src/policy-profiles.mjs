const REQUIREMENT_ID_PATTERN = "(?:BR|SR|FR|NFR|CR|IR)-[0-9]{3}";

const REQUIREMENTS_STRICT_DEFAULTS = {
  requirement_json_globs: [
    "requirements/business/*.json",
    "requirements/stakeholder/*.json",
    "requirements/functional/*.json",
    "requirements/nonfunctional/*.json",
    "requirements/constraints/*.json",
    "requirements/interface/*.json",
  ],
  code_reference_globs: [
    "scripts/**/*.js",
    "include/**/*.{h,hpp,hh}",
    "src/**/*.{h,hpp,hh,c,cc,cpp,cxx}",
    "tests/**/*.{h,hpp,hh,c,cc,cpp,cxx,js,mjs}",
    "examples/**/*.{h,hpp,hh,c,cc,cpp,cxx,js,mjs}",
  ],
  doc_reference_globs: [
    "*.md",
    "docs/**/*.md",
    "requirements/**/*.md",
    ".github/**/*.md",
  ],
  strict_heading_docs: [
    "docs/**/*.md",
  ],
  evidence_surfaces: [
    "src/**",
    "tests/**",
    "docs/**",
    "README.md",
    "requirements/README.md",
  ],
  implementation_evidence_surfaces: [
    "include/**",
    "src/**",
    "scripts/**",
    ".github/workflows/**",
  ],
  verification_evidence_surfaces: [
    "tests/**",
    "experiments/**",
    "scripts/**",
    ".github/workflows/**",
  ],
};

const PROFILE_OVERRIDE_ARRAY_FIELDS = new Set([
  "requirement_json_globs",
  "code_reference_globs",
  "doc_reference_globs",
  "strict_heading_docs",
  "evidence_surfaces",
  "changed_requirement_evidence_surfaces",
  "affected_evidence_surfaces",
  "implementation_evidence_surfaces",
  "verification_evidence_surfaces",
]);

const BUILT_IN_PROFILE_NAMES = new Set(["requirements-strict"]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function arrayOverride(overrides, field, fallback) {
  if (Array.isArray(overrides?.[field])) return [...overrides[field]];
  return [...fallback];
}

function jsonFieldSources(globs, field) {
  return globs.map((glob) => ({ kind: "json_field", glob, field }));
}

function regexSources(globs, pattern) {
  return globs.map((glob) => ({ kind: "regex", glob, pattern }));
}

function buildRequirementsStrictProfile(overrides = {}) {
  const requirementJsonGlobs = arrayOverride(
    overrides,
    "requirement_json_globs",
    REQUIREMENTS_STRICT_DEFAULTS.requirement_json_globs
  );
  const codeReferenceGlobs = arrayOverride(
    overrides,
    "code_reference_globs",
    REQUIREMENTS_STRICT_DEFAULTS.code_reference_globs
  );
  const docReferenceGlobs = arrayOverride(
    overrides,
    "doc_reference_globs",
    REQUIREMENTS_STRICT_DEFAULTS.doc_reference_globs
  );
  const strictHeadingDocs = arrayOverride(
    overrides,
    "strict_heading_docs",
    REQUIREMENTS_STRICT_DEFAULTS.strict_heading_docs
  );
  const evidenceSurfaces = arrayOverride(
    overrides,
    "evidence_surfaces",
    REQUIREMENTS_STRICT_DEFAULTS.evidence_surfaces
  );
  const changedRequirementEvidenceSurfaces = arrayOverride(
    overrides,
    "changed_requirement_evidence_surfaces",
    evidenceSurfaces
  );
  const affectedEvidenceSurfaces = arrayOverride(
    overrides,
    "affected_evidence_surfaces",
    evidenceSurfaces
  );
  const implementationEvidenceSurfaces = arrayOverride(
    overrides,
    "implementation_evidence_surfaces",
    REQUIREMENTS_STRICT_DEFAULTS.implementation_evidence_surfaces
  );
  const verificationEvidenceSurfaces = arrayOverride(
    overrides,
    "verification_evidence_surfaces",
    REQUIREMENTS_STRICT_DEFAULTS.verification_evidence_surfaces
  );

  return {
    anchors: {
      types: {
        requirement_id: {
          sources: jsonFieldSources(requirementJsonGlobs, "id"),
        },
        requirement_json_req_ref: {
          sources: regexSources(
            requirementJsonGlobs,
            `"(${REQUIREMENT_ID_PATTERN})"`
          ),
        },
        code_req_ref: {
          sources: regexSources(
            codeReferenceGlobs,
            `(?:@req\\s+|,\\s*)(${REQUIREMENT_ID_PATTERN})`
          ),
        },
        doc_req_ref: {
          sources: regexSources(
            docReferenceGlobs,
            `(?:^|[^A-Z0-9])(${REQUIREMENT_ID_PATTERN})(?![0-9])`
          ),
        },
        doc_heading_req_ref: {
          sources: regexSources(
            strictHeadingDocs,
            `(?:^|\\n)#{1,6}\\s+[^\\n]*?\\[(${REQUIREMENT_ID_PATTERN})\\]`
          ),
        },
        doc_heading_without_req_ref: {
          sources: regexSources(
            strictHeadingDocs,
            `(?:^|\\n)(#{1,6}\\s+(?![^\\n]*\\[${REQUIREMENT_ID_PATTERN}\\])[^\\n]*)`
          ),
        },
      },
    },
    trace_rules: [
      {
        id: "requirement-json-req-refs-must-resolve",
        kind: "must_resolve",
        from_anchor_type: "requirement_json_req_ref",
        to_anchor_type: "requirement_id",
      },
      {
        id: "code-req-refs-must-resolve",
        kind: "must_resolve",
        from_anchor_type: "code_req_ref",
        to_anchor_type: "requirement_id",
      },
      {
        id: "doc-req-refs-must-resolve",
        kind: "must_resolve",
        from_anchor_type: "doc_req_ref",
        to_anchor_type: "requirement_id",
      },
      {
        id: "doc-heading-req-refs-must-resolve",
        kind: "must_resolve",
        from_anchor_type: "doc_heading_req_ref",
        to_anchor_type: "requirement_id",
      },
      {
        id: "doc-headings-must-have-req-ref",
        kind: "must_resolve",
        from_anchor_type: "doc_heading_without_req_ref",
        to_anchor_type: "requirement_id",
      },
      {
        id: "changed-requirements-need-evidence",
        kind: "changed_files_require_evidence",
        if_changed: requirementJsonGlobs,
        must_touch_any: changedRequirementEvidenceSurfaces,
      },
      {
        id: "declared-affected-anchors-need-evidence",
        kind: "declared_anchors_require_evidence",
        contract_field: "anchors.affects",
        must_touch_any: affectedEvidenceSurfaces,
      },
      {
        id: "declared-implemented-anchors-need-evidence",
        kind: "declared_anchors_require_evidence",
        contract_field: "anchors.implements",
        must_touch_any: implementationEvidenceSurfaces,
      },
      {
        id: "declared-verified-anchors-need-evidence",
        kind: "declared_anchors_require_evidence",
        contract_field: "anchors.verifies",
        must_touch_any: verificationEvidenceSurfaces,
      },
    ],
  };
}

export function listBuiltInProfiles() {
  return [...BUILT_IN_PROFILE_NAMES].sort();
}

export function compileProfilePolicy(policy) {
  const errors = [];
  const profile = policy?.profile;
  const overrides = policy?.profile_overrides;

  if (overrides !== undefined && !profile) {
    errors.push({
      field: "profile_overrides",
      message: "profile_overrides requires top-level profile",
    });
  }

  if (profile !== undefined && !BUILT_IN_PROFILE_NAMES.has(profile)) {
    errors.push({
      field: "profile",
      profile,
      message: `profile "${profile}" is not supported; use ${listBuiltInProfiles().join(", ")}`,
    });
  }

  if (overrides !== undefined) {
    if (!isPlainObject(overrides)) {
      errors.push({
        field: "profile_overrides",
        message: "profile_overrides must be an object",
      });
    } else {
      for (const field of Object.keys(overrides)) {
        if (!PROFILE_OVERRIDE_ARRAY_FIELDS.has(field)) {
          errors.push({
            field: `profile_overrides.${field}`,
            message: `profile_overrides.${field} is not supported`,
          });
          continue;
        }

        const value = overrides[field];
        const valid = Array.isArray(value) &&
          value.length > 0 &&
          value.every((item) => typeof item === "string" && item.trim().length > 0);
        if (!valid) {
          errors.push({
            field: `profile_overrides.${field}`,
            message: `profile_overrides.${field} must be a non-empty array of non-empty strings`,
          });
        }
      }
    }
  }

  return errors;
}

export function expandPolicyProfile(policy) {
  const base = clone(policy);
  if (!base.profile) return base;

  let profilePatch;
  if (base.profile === "requirements-strict") {
    profilePatch = buildRequirementsStrictProfile(base.profile_overrides || {});
  } else {
    return base;
  }

  return {
    ...base,
    anchors: base.anchors || profilePatch.anchors,
    trace_rules: base.trace_rules || profilePatch.trace_rules,
  };
}

export function resolvePolicyProfile(policy) {
  const errors = compileProfilePolicy(policy);
  if (errors.length > 0) {
    return { ok: false, policy: clone(policy), errors };
  }
  return {
    ok: true,
    policy: expandPolicyProfile(policy),
    errors: [],
  };
}
