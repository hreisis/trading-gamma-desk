/** Deterministic exclusion reason codes for inventory reporting. */
export const EXCLUSION = {
  MISSING_MACRO: "missing_macro",
  MACRO_DATE_MISMATCH: "macro_date_mismatch",
  MACRO_INVALID: "macro_invalid",
  MACRO_STALE: "macro_stale",
  MACRO_SYNTHETIC: "macro_synthetic_provenance",
  MISSING_EXACT_STRUCTURE: "missing_exact_date_structure",
  STRUCTURE_DATE_MISMATCH: "structure_date_mismatch",
  STRUCTURE_INVALID: "structure_invalid",
  STRUCTURE_SYNTHETIC: "structure_synthetic_provenance",
  CATALYST_CACHE_UNAVAILABLE: "catalyst_cache_unavailable",
  CATALYST_PIT_UNPROVEN: "catalyst_pit_availability_unproven",
  CATALYST_SYN_ID: "catalyst_syn_identifier",
  CATALYST_SYNTHETIC: "catalyst_synthetic_provenance",
  FIXTURE_PROVENANCE: "fixture_provenance_rejected",
  SCHEMA_INVALID: "schema_invalid_artifact",
  FUTURE_SESSION: "future_session_after_cutoff",
  PARTIAL_BOUNDED: "partial_bounded_structure",
  INELIGIBLE_COMPONENTS: "ineligible_required_components",
} as const;

export type ExclusionCode = (typeof EXCLUSION)[keyof typeof EXCLUSION];

export function exclusionMessage(code: ExclusionCode, detail?: string): string {
  const base: Record<ExclusionCode, string> = {
    missing_macro: "missing macro driver artifact",
    macro_date_mismatch: "macro driver marketSessionDate mismatch",
    macro_invalid: "macro driver failed validation",
    macro_stale: "macro driver incomplete or stale",
    macro_synthetic_provenance: "macro driver has synthetic provenance",
    missing_exact_date_structure: "missing exact-date structure artifact",
    structure_date_mismatch: "structure sessionDate mismatch",
    structure_invalid: "structure artifact failed validation",
    structure_synthetic_provenance: "structure artifact has synthetic provenance",
    catalyst_cache_unavailable: "catalyst cache unavailable",
    catalyst_pit_availability_unproven:
      "catalyst PIT availability cannot be proven for session",
    catalyst_syn_identifier: "syn-* catalyst identifier rejected",
    catalyst_synthetic_provenance: "catalyst has synthetic provenance",
    fixture_provenance_rejected: "fixture provenance rejected for real archive",
    schema_invalid_artifact: "schema-invalid artifact",
    future_session_after_cutoff: "session after explicit cutoff",
    partial_bounded_structure: "bounded structure partial or unavailable",
    ineligible_required_components: "required archive components ineligible",
  };
  return detail ? `${base[code]}: ${detail}` : base[code];
}
