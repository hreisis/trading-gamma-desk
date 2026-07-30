import type { OfficialDocument } from "@/contracts";
import {
  emptyExtractorResult,
  tryFact,
  type ExtractorResult,
} from "../extract-common";
import { parseTargetRange } from "../numbers";

/**
 * FOMC statement extractor — policy action, target range, vote, dissenters.
 * Does not infer hawkish/dovish, future path, or SEP.
 */
export function extractFomcStatement(
  doc: OfficialDocument,
  contentText: string,
): ExtractorResult {
  const out = emptyExtractorResult();
  const seen = new Set<string>();

  const actionMatch = contentText.match(
    /(?:The\s+)?(?:Federal Open Market )?Committee decided to (maintain|raise|lower) the target range for the federal funds rate(?: at| to)?\s+(\d(?:\.\d+)?\s*(?:to|–|-)\s*\d(?:\.\d+)?\s*percent)/i,
  );
  if (actionMatch) {
    const verb = actionMatch[1]!.toLowerCase();
    const range = parseTargetRange(actionMatch[2]!);
    const excerpt = actionMatch[0]!;
    const actionLabel =
      verb === "maintain"
        ? "Maintained target range"
        : verb === "raise"
          ? "Raised target range"
          : "Lowered target range";
    const draft = tryFact(
      doc,
      contentText,
      {
        key: "policy_action",
        label: actionLabel,
        text: excerpt.trim(),
        factType: "policy_action",
        excerpt,
        values: range
          ? [
              {
                metric: "fomc_target_range_low",
                value: range.low,
                unit: "percent",
              },
              {
                metric: "fomc_target_range_high",
                value: range.high,
                unit: "percent",
              },
            ]
          : undefined,
      },
      seen,
    );
    if ("fact" in draft) {
      out.facts.push(draft.fact);
      out.headlineParts.push(actionLabel);
      if (range) {
        out.headlineParts.push(`${range.low}–${range.high}%`);
      }
    } else out.omissions.push(draft.omission);
  }

  // Explicit vote tally when stated as "approved ... by an X-Y vote"
  const voteMatch = contentText.match(
    /(?:approved|issued).{0,80}?by an?\s+(\d+)\s*[–-]\s*(\d+)\s+vote/i,
  );
  if (voteMatch) {
    const forN = Number(voteMatch[1]);
    const againstN = Number(voteMatch[2]);
    const excerpt = voteMatch[0]!;
    const draft = tryFact(
      doc,
      contentText,
      {
        key: "vote_result",
        label: "Vote result",
        text: `Vote ${forN}–${againstN}`,
        factType: "vote",
        excerpt,
        values: [
          { metric: "fomc_vote_for", value: forN, unit: "persons" },
          { metric: "fomc_vote_against", value: againstN, unit: "persons" },
        ],
      },
      seen,
    );
    if ("fact" in draft) {
      out.facts.push(draft.fact);
      out.headlineParts.push(`Vote ${forN}–${againstN}`);
    } else out.omissions.push(draft.omission);
  }

  const dissentMatch = contentText.match(
    /Voting against (?:this|the) (?:monetary policy )?action (?:was|were)\s+([^.]+)\./i,
  );
  if (dissentMatch) {
    const excerpt = dissentMatch[0]!;
    const draft = tryFact(
      doc,
      contentText,
      {
        key: "dissenters",
        label: "Dissenters",
        text: excerpt.trim(),
        factType: "vote",
        excerpt,
      },
      seen,
    );
    if ("fact" in draft) out.facts.push(draft.fact);
    else out.omissions.push(draft.omission);
  }

  return out;
}
