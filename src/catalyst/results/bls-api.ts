import { IngestError } from "@/ingest/types";
import { fetchValidated, type FetchLike } from "@/ingest/http";
import {
  BLS_RESULTS_API_URL,
  BLS_RESULTS_SOURCE_NAME,
  blsSeriesIdsToFetch,
} from "./registry";
import { parseBlsYearPeriod } from "./period";
import type { BlsSeriesData, BlsSeriesPoint } from "./types";

const DEFAULT_TIMEOUT_MS = 25_000;

function isPreliminary(footnotes: unknown): boolean {
  if (!Array.isArray(footnotes)) return false;
  return footnotes.some((f) => {
    if (!f || typeof f !== "object") return false;
    const o = f as Record<string, unknown>;
    const code = String(o.code ?? "").toUpperCase();
    const text = String(o.text ?? "").toLowerCase();
    return code === "P" || text.includes("preliminary");
  });
}

function parseSeriesPoints(
  seriesId: string,
  data: unknown,
): BlsSeriesPoint[] {
  if (!Array.isArray(data)) {
    throw new IngestError(
      "payload_shape",
      `BLS API: series ${seriesId} data is not an array`,
    );
  }
  const points: BlsSeriesPoint[] = [];
  for (const row of data) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const year = String(r.year ?? "");
    const period = String(r.period ?? "");
    const parsed = parseBlsYearPeriod(year, period);
    if (!parsed) continue; // drops M13 / malformed
    // BLS uses "-" for unpublished / suppressed cells — skip, do not invent 0.
    const rawValue = String(r.value ?? "").trim();
    if (rawValue === "" || rawValue === "-" || rawValue.toLowerCase() === "n/a") {
      continue;
    }
    const value = Number(rawValue);
    if (!Number.isFinite(value)) {
      throw new IngestError(
        "payload_shape",
        `BLS API: series ${seriesId} has non-numeric value ${JSON.stringify(rawValue)} for ${parsed.sourcePeriod}`,
      );
    }
    points.push({
      year: parsed.year,
      month: parsed.month,
      referencePeriod: parsed.referencePeriod,
      sourcePeriod: parsed.sourcePeriod,
      value,
      preliminary: isPreliminary(r.footnotes),
    });
  }
  // Ascending for transforms; API usually returns newest-first.
  points.sort((a, b) =>
    a.referencePeriod < b.referencePeriod
      ? -1
      : a.referencePeriod > b.referencePeriod
        ? 1
        : 0,
  );
  return points;
}

/**
 * Validate and parse BLS Public API v1/v2 timeseries JSON body.
 * Accepts text/plain JSON (BLS often serves application content as text/plain).
 */
export function parseBlsApiTimeseriesBody(body: string): {
  readonly series: BlsSeriesData[];
} {
  let json: unknown;
  try {
    json = JSON.parse(body) as unknown;
  } catch {
    throw new IngestError("payload_shape", "BLS API: body is not valid JSON");
  }
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    throw new IngestError("payload_shape", "BLS API: root must be an object");
  }
  const root = json as Record<string, unknown>;
  const status = String(root.status ?? "");
  if (status && status !== "REQUEST_SUCCEEDED") {
    const msg = Array.isArray(root.message)
      ? root.message.join("; ")
      : String(root.message ?? status);
    throw new IngestError(
      "payload_shape",
      `BLS API: request not succeeded (${status}): ${msg}`,
    );
  }
  const results = root.Results;
  if (!results || typeof results !== "object" || Array.isArray(results)) {
    throw new IngestError("payload_shape", "BLS API: missing Results object");
  }
  const seriesRaw = (results as Record<string, unknown>).series;
  if (!Array.isArray(seriesRaw) || seriesRaw.length === 0) {
    throw new IngestError(
      "payload_shape",
      "BLS API: Results.series must be a non-empty array",
    );
  }

  const series: BlsSeriesData[] = [];
  for (const item of seriesRaw) {
    if (!item || typeof item !== "object") {
      throw new IngestError("payload_shape", "BLS API: series item invalid");
    }
    const s = item as Record<string, unknown>;
    const seriesId = String(s.seriesID ?? s.seriesId ?? "");
    if (!seriesId) {
      throw new IngestError("payload_shape", "BLS API: series missing seriesID");
    }
    series.push({
      seriesId,
      points: parseSeriesPoints(seriesId, s.data),
    });
  }
  return { series };
}

export async function fetchBlsSeriesData(options: {
  readonly fetchImpl?: FetchLike;
  readonly timeoutMs?: number;
  readonly url?: string;
  readonly startYear?: number;
  readonly endYear?: number;
  readonly now?: Date;
} = {}): Promise<{
  readonly status: "ok" | "error";
  readonly error?: string;
  readonly series: BlsSeriesData[];
  readonly url: string;
}> {
  const url = options.url ?? BLS_RESULTS_API_URL;
  const now = options.now ?? new Date();
  const endYear = options.endYear ?? now.getUTCFullYear();
  const startYear = options.startYear ?? endYear - 2;
  const seriesid = blsSeriesIdsToFetch();

  try {
    const validated = await fetchValidated(
      url,
      {
        label: "BLS Public Data API",
        // BLS often returns text/plain; some gateways return application/json.
        contentTypeIncludes: "/",
      },
      {
        fetchImpl: options.fetchImpl,
        timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/plain, */*",
          "User-Agent":
            "GammaDesk/0.0 (local BLS results; +https://github.com/hreisis/trading-gamma-desk)",
        },
        body: JSON.stringify({
          seriesid,
          startyear: String(startYear),
          endyear: String(endYear),
        }),
      },
    );

    if (
      validated.body.trimStart().startsWith("<!") ||
      /<html[\s>]/i.test(validated.body.slice(0, 200))
    ) {
      throw new IngestError(
        "payload_shape",
        `BLS API: received HTML instead of JSON (possible bot block); preview: ${JSON.stringify(validated.body.slice(0, 120))}`,
      );
    }

    const parsed = parseBlsApiTimeseriesBody(validated.body);
    return { status: "ok", series: parsed.series, url };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: "error",
      error: message,
      series: [],
      url,
    };
  }
}

export { BLS_RESULTS_SOURCE_NAME };
