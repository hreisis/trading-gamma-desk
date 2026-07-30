import { redactSecrets } from "./redaction";

export type SmokeErrorCode =
  | "authentication_error"
  | "rate_limit"
  | "timeout"
  | "provider_4xx"
  | "provider_5xx"
  | "schema_invalid"
  | "validation_rejected"
  | "dependency_unavailable"
  | "missing_credentials"
  | "no_eligible_input"
  | "live_opt_in_required"
  | "public_demo_blocked"
  | "cache_integrity_failed"
  | "runner_error"
  | "unknown_error";

/** Map provider / validator messages to safe, stable error codes. */
export function classifySmokeError(message: string): SmokeErrorCode {
  const m = redactSecrets(message);
  if (/OPENAI_API_KEY missing|APCA_.*missing|missing —/i.test(m)) {
    return "missing_credentials";
  }
  if (/401|403|authentication|unauthorized|forbidden/i.test(m)) {
    return "authentication_error";
  }
  if (/429|rate.?limit/i.test(m)) return "rate_limit";
  if (/timed out|timeout|AbortError/i.test(m)) return "timeout";
  if (/HTTP 5\d\d|provider failure/i.test(m)) return "provider_5xx";
  if (/HTTP 4\d\d/i.test(m)) return "provider_4xx";
  if (/schema invalid|not JSON|missing structured/i.test(m)) {
    return "schema_invalid";
  }
  if (/rejected|validation|unsupported number|prohibited|evidenceId/i.test(m)) {
    return "validation_rejected";
  }
  if (
    /market-context|market-reactions|briefs cache|Cannot enhance|missing at/i.test(
      m,
    )
  ) {
    return "dependency_unavailable";
  }
  if (/public demo/i.test(m)) return "public_demo_blocked";
  return "unknown_error";
}
