import { redactSecrets } from "./redaction";

export type SmokeErrorCode =
  | "authentication_error"
  | "insufficient_quota"
  | "rate_limit"
  | "timeout"
  | "provider_4xx"
  | "provider_5xx"
  | "schema_invalid"
  | "validation_rejected"
  | "dependency_unavailable"
  | "missing_credentials"
  | "awaiting_valid_credentials"
  | "awaiting_live_smoke"
  | "no_eligible_input"
  | "live_opt_in_required"
  | "public_demo_blocked"
  | "cache_integrity_failed"
  | "runner_error"
  | "unknown_error";

const QUOTA =
  /insufficient_quota|exceeded.*quota|quota.*exceeded|billing.*(?:limit|quota|credit)|out of (?:credits|quota)|credit balance|usage limit|exceeded your current quota/i;

/** Map provider / validator messages to safe, stable error codes. */
export function classifySmokeError(message: string): SmokeErrorCode {
  const m = redactSecrets(message);
  if (/OPENAI_API_KEY missing|APCA_.*missing|missing —/i.test(m)) {
    return "missing_credentials";
  }
  // Quota / billing before auth — OpenAI may return 403/429 with quota wording.
  if (QUOTA.test(m)) {
    return "insufficient_quota";
  }
  if (/429|rate.?limit/i.test(m)) return "rate_limit";
  if (/401|403|authentication|unauthorized|forbidden/i.test(m)) {
    return "authentication_error";
  }
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

/** Classify Alpaca credential / live readiness (not a bare adapter failure). */
export function classifyAlpacaCredentialState(options: {
  readonly keyIdPresent: boolean;
  readonly secretPresent: boolean;
  readonly fetchAttempted?: boolean;
  readonly fetchError?: string;
}): {
  readonly status:
    | "awaiting_valid_credentials"
    | "awaiting_live_smoke"
    | "authentication_error"
    | "ready";
  readonly errorCode: SmokeErrorCode;
} {
  if (!options.keyIdPresent || !options.secretPresent) {
    return {
      status: "awaiting_valid_credentials",
      errorCode: "awaiting_valid_credentials",
    };
  }
  if (options.fetchAttempted && options.fetchError) {
    const code = classifySmokeError(options.fetchError);
    if (code === "authentication_error" || code === "missing_credentials") {
      return {
        status: "authentication_error",
        errorCode:
          code === "missing_credentials"
            ? "awaiting_valid_credentials"
            : "authentication_error",
      };
    }
    return {
      status: "authentication_error",
      errorCode: code === "unknown_error" ? "authentication_error" : code,
    };
  }
  return {
    status: "awaiting_live_smoke",
    errorCode: "awaiting_live_smoke",
  };
}
