import type { OfficialDocument } from "@/contracts";
import {
  emptyExtractorResult,
  tryFact,
  type ExtractorResult,
} from "../extract-common";
import { parseBillionToken, sourceDisplayNumber } from "../numbers";

/**
 * International Trade — deficit/surplus, exports, imports, period change.
 */
export function extractTradeRelease(
  doc: OfficialDocument,
  contentText: string,
): ExtractorResult {
  const out = emptyExtractorResult();
  const seen = new Set<string>();

  const balMatch = contentText.match(
    /(?:goods and services )?(?:trade )?(deficit|surplus)\s+(?:was|increased to|decreased to|of)\s+\$?(-?[\d,]+(?:\.\d+)?)\s*billion/i,
  );
  if (balMatch) {
    const kind = balMatch[1]!.toLowerCase();
    let value = parseBillionToken(balMatch[2]!);
    if (value !== null) {
      if (kind === "deficit" && value > 0) value = -value;
      const excerpt = balMatch[0]!;
      const draft = tryFact(
        doc,
        contentText,
        {
          key: "trade_balance",
          label: "Trade balance",
          text: `Goods and services ${kind}: $${sourceDisplayNumber(balMatch[2]!, Math.abs(value))} billion`,
          factType: "reported_value",
          excerpt,
          values: [
            {
              metric: "trade_balance",
              value,
              unit: "billion_usd",
              ...(doc.referencePeriod ? { period: doc.referencePeriod } : {}),
            },
          ],
        },
        seen,
      );
      if ("fact" in draft) {
        out.facts.push(draft.fact);
        out.headlineParts.push(
          `${kind} $${sourceDisplayNumber(balMatch[2]!, Math.abs(value))}B`,
        );
      } else out.omissions.push(draft.omission);
    }
  }

  const expMatch = contentText.match(
    /exports\s+(?:were|of|increased to|decreased to)\s+\$?([\d,]+(?:\.\d+)?)\s*billion/i,
  );
  if (expMatch) {
    const value = parseBillionToken(expMatch[1]!);
    if (value !== null) {
      const excerpt = expMatch[0]!;
      const draft = tryFact(
        doc,
        contentText,
        {
          key: "exports",
          label: "Exports",
          text: `Exports: $${sourceDisplayNumber(expMatch[1]!, value)} billion`,
          factType: "reported_value",
          excerpt,
          values: [{ metric: "exports", value, unit: "billion_usd" }],
        },
        seen,
      );
      if ("fact" in draft) out.facts.push(draft.fact);
      else out.omissions.push(draft.omission);
    }
  }

  const impMatch = contentText.match(
    /imports\s+(?:were|of|increased to|decreased to)\s+\$?([\d,]+(?:\.\d+)?)\s*billion/i,
  );
  if (impMatch) {
    const value = parseBillionToken(impMatch[1]!);
    if (value !== null) {
      const excerpt = impMatch[0]!;
      const draft = tryFact(
        doc,
        contentText,
        {
          key: "imports",
          label: "Imports",
          text: `Imports: $${sourceDisplayNumber(impMatch[1]!, value)} billion`,
          factType: "reported_value",
          excerpt,
          values: [{ metric: "imports", value, unit: "billion_usd" }],
        },
        seen,
      );
      if ("fact" in draft) out.facts.push(draft.fact);
      else out.omissions.push(draft.omission);
    }
  }

  const chgMatch = contentText.match(
    /(?:deficit|surplus)\s+(?:increased|decreased)\s+\$?([\d,]+(?:\.\d+)?)\s*billion\s+(?:from|relative to)/i,
  );
  if (chgMatch) {
    const value = parseBillionToken(chgMatch[1]!);
    if (value !== null) {
      const excerpt = chgMatch[0]!;
      const draft = tryFact(
        doc,
        contentText,
        {
          key: "trade_balance_change",
          label: "Balance change vs prior period",
          text: excerpt.trim(),
          factType: "comparison",
          excerpt,
          values: [
            {
              metric: "trade_balance_change",
              value,
              unit: "billion_usd",
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
