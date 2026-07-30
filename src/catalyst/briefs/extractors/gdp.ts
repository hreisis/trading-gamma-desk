import type { OfficialDocument } from "@/contracts";
import {
  emptyExtractorResult,
  tryFact,
  type ExtractorResult,
} from "../extract-common";
import { parsePercentToken, sourceDisplayNumber } from "../numbers";

/**
 * GDP release extractor — annualized real GDP, estimate type, prior estimate.
 */
export function extractGdpRelease(
  doc: OfficialDocument,
  contentText: string,
): ExtractorResult {
  const out = emptyExtractorResult();
  const seen = new Set<string>();

  const gdpMatch = contentText.match(
    /real\s+(?:gross domestic product|GDP)\s+(?:increased|decreased|rose|fell)\s+(?:at an annual rate of\s+)?([+-]?\d+(?:\.\d+)?)\s*percent/i,
  );
  if (gdpMatch) {
    const value = parsePercentToken(gdpMatch[1]!);
    if (value !== null) {
      const excerpt = gdpMatch[0]!;
      const draft = tryFact(
        doc,
        contentText,
        {
          key: "real_gdp_annualized",
          label: "Real GDP (annualized)",
          text: `Real GDP ${value >= 0 ? "increased" : "decreased"} at an annual rate of ${sourceDisplayNumber(gdpMatch[1]!, Math.abs(value))} percent`,
          factType: "reported_value",
          excerpt,
          values: [
            {
              metric: "real_gdp_annualized",
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
        out.headlineParts.push(`GDP ${value}% annualized`);
      } else out.omissions.push(draft.omission);
    }
  }

  const estimateMatch =
    contentText.match(
      /\((Advance|Second|Third)\s+Estimate\)/i,
    ) ??
    doc.title.match(
      /\((Advance|Second|Third)\s+Estimate\)/i,
    );
  if (estimateMatch) {
    const kind = estimateMatch[1]!;
    // Prefer body excerpt; fall back to title only if present in contentText.
    let excerpt = estimateMatch[0]!;
    if (!contentText.includes(excerpt) && contentText.toLowerCase().includes(`${kind.toLowerCase()} estimate`)) {
      const m2 = contentText.match(
        new RegExp(`${kind}\\s+Estimate`, "i"),
      );
      if (m2) excerpt = m2[0]!;
    }
    if (contentText.includes(excerpt)) {
      const draft = tryFact(
        doc,
        contentText,
        {
          key: "estimate_type",
          label: "Estimate type",
          text: `${kind} Estimate`,
          factType: "reported_value",
          excerpt,
        },
        seen,
      );
      if ("fact" in draft) {
        out.facts.push(draft.fact);
        out.headlineParts.push(`${kind} Estimate`);
      } else out.omissions.push(draft.omission);
    } else {
      out.omissions.push(
        "estimate_type: estimate type not evidenced in contentText (title-only omitted)",
      );
    }
  }

  const prevMatch = contentText.match(
    /(?:In the (?:second|previous) estimate|previously estimated|compared with|revised from).{0,40}?(?:increase|decrease|increase of|decrease of)?\s*([+-]?\d+(?:\.\d+)?)\s*percent/i,
  );
  if (prevMatch) {
    const value = parsePercentToken(prevMatch[1]!);
    if (value !== null) {
      const excerpt = prevMatch[0]!;
      const draft = tryFact(
        doc,
        contentText,
        {
          key: "previous_estimate_comparison",
          label: "Previous estimate",
          text: excerpt.trim(),
          factType: "comparison",
          excerpt,
          values: [
            {
              metric: "real_gdp_previous_estimate",
              value,
              unit: "percent",
            },
          ],
        },
        seen,
      );
      if ("fact" in draft) out.facts.push(draft.fact);
      else out.omissions.push(draft.omission);
    }
  }

  return out;
}
