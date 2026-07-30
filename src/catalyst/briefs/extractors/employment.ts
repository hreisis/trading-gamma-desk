import type { OfficialDocument } from "@/contracts";
import {
  emptyExtractorResult,
  tryFact,
  type ExtractorResult,
} from "../extract-common";
import { parseSignedNumber, parsePercentToken, sourceDisplayNumber } from "../numbers";

/**
 * Employment Situation extractor — payrolls, unemployment, prior revision.
 */
export function extractEmploymentRelease(
  doc: OfficialDocument,
  contentText: string,
): ExtractorResult {
  const out = emptyExtractorResult();
  const seen = new Set<string>();

  const payrollMatch = contentText.match(
    /(?:total )?nonfarm(?: payroll)? employment\s+(?:increased|rose|decreased|fell|changed little|was little changed|was unchanged)\s*(?:by\s+)?(\(?[+-]?[\d,]+\)?|unchanged)?\s*(?:thousand|thousands)?/i,
  );
  if (payrollMatch) {
    const raw = payrollMatch[1] ?? "unchanged";
    let value: number | null;
    if (/unchanged|little changed|changed little/i.test(payrollMatch[0]!)) {
      value = raw && !/unchanged|little/i.test(raw) ? parseSignedNumber(raw) : 0;
      if (value === null) value = 0;
    } else {
      value = parseSignedNumber(raw);
    }
    if (value !== null) {
      const excerpt = payrollMatch[0]!;
      const draft = tryFact(
        doc,
        contentText,
        {
          key: "total_nonfarm_payrolls_mom",
          label: "Nonfarm payroll change",
          text: `Nonfarm payrolls: ${sourceDisplayNumber(raw === "unchanged" ? "0" : raw, value)} thousand`,
          factType: "reported_value",
          excerpt,
          values: [
            {
              metric: "total_nonfarm_payrolls_mom",
              value,
              unit: "thousands",
              ...(doc.referencePeriod ? { period: doc.referencePeriod } : {}),
            },
          ],
        },
        seen,
      );
      if ("fact" in draft) {
        out.facts.push(draft.fact);
        out.headlineParts.push(`Payrolls ${value >= 0 ? "+" : ""}${value}k`);
      } else out.omissions.push(draft.omission);
    }
  }

  // "+57,000" style
  if (!seen.has("total_nonfarm_payrolls_mom")) {
    const alt = contentText.match(
      /total nonfarm payroll employment\s*\(\+?(-?[\d,]+)\)/i,
    );
    if (alt) {
      const value = parseSignedNumber(alt[1]!);
      if (value !== null) {
        const excerpt = alt[0]!;
        const draft = tryFact(
          doc,
          contentText,
          {
            key: "total_nonfarm_payrolls_mom",
            label: "Nonfarm payroll change",
            text: `Nonfarm payrolls: ${value} thousand`,
            factType: "reported_value",
            excerpt,
            values: [
              {
                metric: "total_nonfarm_payrolls_mom",
                value,
                unit: "thousands",
                ...(doc.referencePeriod ? { period: doc.referencePeriod } : {}),
              },
            ],
          },
          seen,
        );
        if ("fact" in draft) {
          out.facts.push(draft.fact);
          out.headlineParts.push(`Payrolls ${value >= 0 ? "+" : ""}${value}k`);
        } else out.omissions.push(draft.omission);
      }
    }
  }

  const urMatch = contentText.match(
    /unemployment rate\s+(?:was|remained at|held at|unchanged at|rose to|fell to|increased to|decreased to)\s+([+-]?\d+(?:\.\d+)?)\s*percent/i,
  );
  if (urMatch) {
    const value = parsePercentToken(urMatch[1]!);
    if (value !== null) {
      const excerpt = urMatch[0]!;
      const draft = tryFact(
        doc,
        contentText,
        {
          key: "unemployment_rate",
          label: "Unemployment rate",
          text: `Unemployment rate: ${sourceDisplayNumber(urMatch[1]!, value)} percent`,
          factType: "reported_value",
          excerpt,
          values: [
            {
              metric: "unemployment_rate",
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
        out.headlineParts.push(`UR ${value}%`);
      } else out.omissions.push(draft.omission);
    }
  }

  const revMatch = contentText.match(
    /(?:The\s+)?(?:change in total nonfarm payroll employment for|payroll employment for)\s+([A-Za-z]+)\s+was revised\s+(?:down|up)?\s*(?:by\s+)?(-?[\d,]+)/i,
  );
  if (revMatch) {
    const value = parseSignedNumber(revMatch[2]!);
    if (value !== null) {
      const excerpt = revMatch[0]!;
      const draft = tryFact(
        doc,
        contentText,
        {
          key: "payroll_prior_month_revision",
          label: "Prior-month revision",
          text: excerpt.trim(),
          factType: "revision",
          excerpt,
          values: [
            {
              metric: "payroll_prior_month_revision",
              value,
              unit: "thousands",
            },
          ],
        },
        seen,
      );
      if ("fact" in draft) out.facts.push(draft.fact);
      else out.omissions.push(draft.omission);
    }
  }

  const monthMatch = contentText.match(
    /THE EMPLOYMENT SITUATION\s*--\s*([A-Z]+)\s+(\d{4})/i,
  );
  if (monthMatch) {
    const excerpt = monthMatch[0]!;
    const draft = tryFact(
      doc,
      contentText,
      {
        key: "reference_month",
        label: "Reference month",
        text: `${monthMatch[1]} ${monthMatch[2]}`,
        factType: "reported_value",
        excerpt,
      },
      seen,
    );
    if ("fact" in draft) out.facts.push(draft.fact);
    else out.omissions.push(draft.omission);
  }

  return out;
}
