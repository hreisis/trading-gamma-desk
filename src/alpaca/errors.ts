export type AlpacaClientErrorCode =
  | "not_configured"
  | "timeout"
  | "auth"
  | "feed_entitlement"
  | "rate_limit"
  | "http"
  | "parse"
  | "network";

interface AlpacaErrorBody {
  readonly message?: string;
  readonly code?: number;
}

export function classifyAlpacaHttpError(
  status: number,
  bodyText: string,
): { code: AlpacaClientErrorCode; message: string } {
  let parsed: AlpacaErrorBody | null = null;
  try {
    parsed = JSON.parse(bodyText) as AlpacaErrorBody;
  } catch {
    parsed = null;
  }
  const detail = parsed?.message?.trim() ?? bodyText.trim().slice(0, 200);

  if (status === 401) {
    return {
      code: "auth",
      message: detail
        ? `Alpaca credentials rejected (HTTP 401): ${detail}`
        : "Alpaca credentials rejected (HTTP 401)",
    };
  }

  if (status === 403) {
    const lower = detail.toLowerCase();
    if (
      lower.includes("subscription") ||
      lower.includes("does not permit") ||
      lower.includes("feed") ||
      lower.includes("entitlement") ||
      lower.includes("sip data")
    ) {
      return {
        code: "feed_entitlement",
        message: detail
          ? `Alpaca feed entitlement error (HTTP 403): ${detail}`
          : "Alpaca feed entitlement error (HTTP 403)",
      };
    }
    return {
      code: "auth",
      message: detail
        ? `Alpaca access denied (HTTP 403): ${detail}`
        : "Alpaca access denied (HTTP 403)",
    };
  }

  return {
    code: "http",
    message: detail
      ? `Alpaca HTTP ${status}: ${detail}`
      : `Alpaca HTTP ${status}`,
  };
}

export function mapAlpacaClientErrorToCredentialState(
  code: AlpacaClientErrorCode,
): "configured" | "invalid" {
  return code === "auth" ? "invalid" : "configured";
}
