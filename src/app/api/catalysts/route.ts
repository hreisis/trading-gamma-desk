import { NextResponse } from "next/server";
import {
  CatalystCategory,
  CatalystImportance,
  CatalystStatus,
} from "@/contracts";
import { loadCatalystFeed, toPublicCatalystFeed } from "@/catalyst";
import type { CatalystQuery } from "@/catalyst";

/**
 * Read-only catalyst feed DTO. Public demo: synthetic fixtures only.
 * Local: official calendar cache when present (no network in the request path).
 * Query: category, status, importance, asset, start, end.
 *
 * Response is the public CatalystFeed contract — cache paths, raw provider
 * errors, AI token usage, and internal identity fields are stripped.
 */
export const dynamic = "force-dynamic";

function parseEnum<T extends string>(
  raw: string | null,
  schema: { safeParse: (v: unknown) => { success: boolean; data?: T } },
): T | undefined {
  if (!raw) return undefined;
  const parsed = schema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

export function GET(request: Request) {
  const url = new URL(request.url);
  const query: CatalystQuery = {
    category: parseEnum(url.searchParams.get("category"), CatalystCategory),
    status: parseEnum(url.searchParams.get("status"), CatalystStatus),
    importance: parseEnum(
      url.searchParams.get("importance"),
      CatalystImportance,
    ),
    affectedAsset: url.searchParams.get("asset") ?? undefined,
    start: url.searchParams.get("start") ?? undefined,
    end: url.searchParams.get("end") ?? undefined,
  };

  const feed = toPublicCatalystFeed(loadCatalystFeed(query));
  return NextResponse.json(feed);
}
