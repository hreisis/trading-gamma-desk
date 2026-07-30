import type { OfficialDocument } from "@/contracts";
import {
  emptyExtractorResult,
  tryFact,
  type ExtractorResult,
} from "../extract-common";
import { parsePercentToken, sourceDisplayNumber } from "../numbers";

function addMom(
  doc: OfficialDocument,
  contentText: string,
  out: ExtractorResult,
  seen: Set<string>,
  key: string,
  label: string,
  metric: string,
  pattern: RegExp,
): void {
  const m = contentText.match(pattern);
  if (!m) return;
  const value = parsePercentToken(m[1]!);
  if (value === null) {
    out.omissions.push(`${key}: unparseable percent`);
    return;
  }
  const excerpt = m[0]!;
  const draft = tryFact(
    doc,
    contentText,
    {
      key,
      label,
      text: `${label}: ${sourceDisplayNumber(m[1]!, value)} percent`,
      factType: "reported_value",
      excerpt,
      values: [
        {
          metric,
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
    out.headlineParts.push(`${label} ${value}%`);
  } else out.omissions.push(draft.omission);
}

/**
 * Personal Income and Outlays — income, DPI, PCE spending, PCE inflation.
 */
export function extractPersonalIncomeRelease(
  doc: OfficialDocument,
  contentText: string,
): ExtractorResult {
  const out = emptyExtractorResult();
  const seen = new Set<string>();

  addMom(
    doc,
    contentText,
    out,
    seen,
    "personal_income_mom",
    "Personal income",
    "personal_income_mom",
    /Personal income\s+(?:increased|decreased|rose|fell)\s+([+-]?\d+(?:\.\d+)?)\s*percent/i,
  );

  addMom(
    doc,
    contentText,
    out,
    seen,
    "disposable_personal_income_mom",
    "Disposable personal income",
    "disposable_personal_income_mom",
    /Disposable personal income\s+(?:increased|decreased|rose|fell)\s+([+-]?\d+(?:\.\d+)?)\s*percent/i,
  );

  addMom(
    doc,
    contentText,
    out,
    seen,
    "pce_spending_mom",
    "PCE / consumer spending",
    "pce_spending_mom",
    /(?:Personal consumption expenditures|PCE|consumer spending)\s+(?:increased|decreased|rose|fell)\s+([+-]?\d+(?:\.\d+)?)\s*percent/i,
  );

  addMom(
    doc,
    contentText,
    out,
    seen,
    "headline_pce_yoy",
    "Headline PCE 12-month",
    "headline_pce_yoy",
    /(?:PCE price index|price index for personal consumption expenditures)\s+(?:excluding food and energy\s+)?(?:increased|rose|decreased|fell)\s+([+-]?\d+(?:\.\d+)?)\s*percent\s+from\s+(?:the\s+)?(?:same month|a year)/i,
  );

  // Prefer explicit "excluding food and energy" for core.
  const core = contentText.match(
    /(?:PCE price index|price index).{0,40}?excluding food and energy.{0,40}?(?:increased|rose|decreased|fell)\s+([+-]?\d+(?:\.\d+)?)\s*percent\s+from/i,
  );
  if (core) {
    const value = parsePercentToken(core[1]!);
    if (value !== null) {
      const excerpt = core[0]!;
      const draft = tryFact(
        doc,
        contentText,
        {
          key: "core_pce_yoy",
          label: "Core PCE 12-month",
          text: `Core PCE: ${sourceDisplayNumber(core[1]!, value)} percent`,
          factType: "reported_value",
          excerpt,
          values: [
            {
              metric: "core_pce_yoy",
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
        out.headlineParts.push(`Core PCE ${value}%`);
      } else out.omissions.push(draft.omission);
    }
  }

  return out;
}
