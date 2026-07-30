import { IngestError, type ValidatedResponse } from "./types";

export interface ResponseExpectations {
  readonly label: string;
  /** Substring that must appear in Content-Type (e.g. "text/csv", "json"). */
  readonly contentTypeIncludes: string;
  /** Optional first-line / header signature for CSV bodies. */
  readonly headerIncludes?: string;
  readonly minRows?: number;
}

/**
 * Stooq lesson: HTTP 200 alone is not enough. A bot-challenge page also
 * returns 200; Content-Type and the header signature catch it before parse.
 */
export function assertValidResponse(
  response: ValidatedResponse,
  expectations: ResponseExpectations,
): void {
  if (response.status < 200 || response.status >= 300) {
    throw new IngestError(
      "http_status",
      `${expectations.label}: HTTP ${response.status}`,
    );
  }

  const contentType = response.contentType.toLowerCase();
  if (!contentType.includes(expectations.contentTypeIncludes.toLowerCase())) {
    throw new IngestError(
      "content_type",
      `${expectations.label}: content-type ${JSON.stringify(response.contentType)} ` +
        `does not include ${JSON.stringify(expectations.contentTypeIncludes)}; ` +
        `body preview: ${JSON.stringify(response.body.slice(0, 120))}`,
    );
  }

  if (expectations.headerIncludes !== undefined) {
    const firstLine = response.body.split(/\r?\n/, 1)[0] ?? "";
    if (!firstLine.includes(expectations.headerIncludes)) {
      throw new IngestError(
        "header_signature",
        `${expectations.label}: first line missing ${JSON.stringify(expectations.headerIncludes)}; ` +
          `got ${JSON.stringify(firstLine.slice(0, 160))}`,
      );
    }
  }

  if (expectations.minRows !== undefined) {
    const lines = response.body
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    // Header + data rows for CSV; for JSON this check is skipped by callers.
    if (lines.length - 1 < expectations.minRows) {
      throw new IngestError(
        "row_count",
        `${expectations.label}: expected ≥ ${expectations.minRows} data rows, got ${Math.max(0, lines.length - 1)}`,
      );
    }
  }
}

export function assertJsonArray(
  label: string,
  parsed: unknown,
  minRows: number,
): asserts parsed is unknown[] {
  if (!Array.isArray(parsed)) {
    throw new IngestError("payload_shape", `${label}: expected a JSON array`);
  }
  if (parsed.length < minRows) {
    throw new IngestError(
      "row_count",
      `${label}: expected ≥ ${minRows} rows, got ${parsed.length}`,
    );
  }
}
