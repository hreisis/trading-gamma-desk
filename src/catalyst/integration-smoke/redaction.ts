const SECRET_ENV_KEYS = [
  "OPENAI_API_KEY",
  "APCA_API_KEY_ID",
  "APCA_API_SECRET_KEY",
  "TIINGO_TOKEN",
  "LLM_API_KEY",
] as const;

const PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_\-]{8,}\b/g,
  /\bBearer\s+[A-Za-z0-9._\-]+\b/gi,
  /\bAuthorization\s*[:=]\s*[^\s,;]+/gi,
  /\bAPCA-[A-Za-z0-9_\-]{8,}\b/g,
];

/** Redact secrets / auth material from strings for terminal + reports. */
export function redactSecrets(input: string): string {
  let out = input;
  for (const key of SECRET_ENV_KEYS) {
    const value = (process.env[key] ?? "").trim();
    if (value.length >= 4) {
      out = out.split(value).join(`[REDACTED:${key}]`);
    }
    out = out.replace(
      new RegExp(`${key}\\s*[=:]\\s*[^\\s,;]+`, "gi"),
      `${key}=[REDACTED]`,
    );
  }
  for (const re of PATTERNS) {
    out = out.replace(re, "[REDACTED]");
  }
  // Strip likely request-config blobs
  out = out.replace(
    /"headers"\s*:\s*\{[^}]{0,500}\}/gi,
    '"headers":"[REDACTED]"',
  );
  return out;
}

export function redactUnknown(value: unknown): string {
  try {
    return redactSecrets(
      typeof value === "string" ? value : JSON.stringify(value),
    );
  } catch {
    return "[unserializable]";
  }
}
