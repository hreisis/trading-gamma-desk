import type { OfficialDocument } from "@/contracts";
import {
  emptyExtractorResult,
  tryFact,
  type ExtractorResult,
} from "../extract-common";
import { parsePercentToken, sourceDisplayNumber } from "../numbers";

function addPercentFact(
  doc: OfficialDocument,
  contentText: string,
  out: ExtractorResult,
  seen: Set<string>,
  opts: {
    readonly key: string;
    readonly label: string;
    readonly metric: string;
    readonly pattern: RegExp;
    readonly saNote?: boolean;
  },
): void {
  const m = contentText.match(opts.pattern);
  if (!m) return;
  const raw = m[1]!;
  const value = parsePercentToken(raw);
  if (value === null) {
    out.omissions.push(`${opts.key}: could not parse percent token ${raw}`);
    return;
  }
  const excerpt = m[0]!;
  const display = sourceDisplayNumber(raw, value);
  const sa =
    opts.saNote && /seasonally adjusted/i.test(excerpt)
      ? " (seasonally adjusted)"
      : "";
  const draft = tryFact(
    doc,
    contentText,
    {
      key: opts.key,
      label: opts.label,
      text: `${opts.label}: ${display} percent${sa}`,
      factType: "reported_value",
      excerpt,
      values: [
        {
          metric: opts.metric,
          value,
          unit: "percent",
          ...(doc.referencePeriod ? { period: doc.referencePeriod } : {}),
        },
      ],
    },
    seen,
  );
  if ("fact" in draft) {
    out.facts.push(draft.fact);
    out.headlineParts.push(`${opts.label} ${display}%`);
  } else out.omissions.push(draft.omission);
}

/**
 * CPI release extractor — headline/core monthly and 12-month changes.
 */
export function extractCpiRelease(
  doc: OfficialDocument,
  contentText: string,
): ExtractorResult {
  const out = emptyExtractorResult();
  const seen = new Set<string>();

  addPercentFact(doc, contentText, out, seen, {
    key: "headline_cpi_sa_mom",
    label: "Headline CPI monthly",
    metric: "headline_cpi_sa_mom",
    saNote: true,
    pattern:
      /(?:The\s+)?(?:Consumer Price Index for All Urban Consumers|CPI-U|All items)(?:\s+\([^)]*\))?\s+(?:increased|rose|decreased|fell|was unchanged|unchanged)\s+(?:by\s+)?([+-]?\d+(?:\.\d+)?|unchanged)\s*percent(?:\s+in\s+[A-Za-z]+)?(?:\s+on a seasonally adjusted basis)?/i,
  });

  // Alternate: "increased 0.1 percent ... seasonally adjusted"
  if (!seen.has("headline_cpi_sa_mom")) {
    addPercentFact(doc, contentText, out, seen, {
      key: "headline_cpi_sa_mom",
      label: "Headline CPI monthly",
      metric: "headline_cpi_sa_mom",
      saNote: true,
      pattern:
        /(?:All items|CPI-U).{0,40}?(?:increased|rose|decreased|fell)\s+([+-]?\d+(?:\.\d+)?)\s*percent.{0,40}?seasonally adjusted/i,
    });
  }

  addPercentFact(doc, contentText, out, seen, {
    key: "headline_cpi_sa_yoy",
    label: "Headline CPI 12-month",
    metric: "headline_cpi_sa_yoy",
    pattern:
      /(?:All items|CPI-U|Consumer Price Index for All Urban Consumers).{0,80}?(?:increased|rose|decreased|fell|up|down)\s+([+-]?\d+(?:\.\d+)?)\s*percent\s+over the (?:last|past) 12 months/i,
  });

  addPercentFact(doc, contentText, out, seen, {
    key: "core_cpi_sa_mom",
    label: "Core CPI monthly",
    metric: "core_cpi_sa_mom",
    saNote: true,
    pattern:
      /(?:index for )?all items less food and energy(?:\s+\([^)]*\))?\s+(?:increased|rose|decreased|fell|was unchanged|unchanged)\s+(?:by\s+)?([+-]?\d+(?:\.\d+)?|unchanged)\s*percent/i,
  });

  addPercentFact(doc, contentText, out, seen, {
    key: "core_cpi_sa_yoy",
    label: "Core CPI 12-month",
    metric: "core_cpi_sa_yoy",
    pattern:
      /(?:all items less food and energy|core).{0,60}?(?:increased|rose|decreased|fell|up|down)\s+([+-]?\d+(?:\.\d+)?)\s*percent\s+over the (?:last|past) 12 months/i,
  });

  return out;
}
