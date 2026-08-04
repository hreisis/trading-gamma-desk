import { describe, expect, it } from "vitest";
import {
  EVAL_CASES,
  EVAL_CASE_IDS,
  buildEvalCaseBundle,
  writeEvalFixtures,
} from "@/study-agent/eval-fixtures";
import { StudyEvidenceBundle } from "@/contracts";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("study memo eval fixtures", () => {
  it("builds six valid bundles with expected evidence status", () => {
    for (const evalCase of EVAL_CASES) {
      const bundle = buildEvalCaseBundle(evalCase.id);
      expect(StudyEvidenceBundle.safeParse(bundle).success).toBe(true);
      expect(bundle.queryContext.sessionDate).toBe("2026-07-29");
      expect(bundle.evidenceStatus).toBe(evalCase.expectedEvidenceStatus);
      if (evalCase.abstains) {
        expect(bundle.evidenceStatus).toBe("insufficient_evidence");
      }
    }
  });

  it("writes committed fixture JSON files", () => {
    writeEvalFixtures();
    for (const evalCase of EVAL_CASES) {
      const path = join(
        process.cwd(),
        "fixtures/studies/eval",
        evalCase.fixtureFile,
      );
      const parsed = StudyEvidenceBundle.parse(
        JSON.parse(readFileSync(path, "utf8")),
      );
      expect(parsed.evidenceStatus).toBe(evalCase.expectedEvidenceStatus);
    }
  });

  it("partial horizon case has immature 20D and sparse MFE", () => {
    const bundle = buildEvalCaseBundle("partial_horizon_mfe");
    expect(bundle.horizonEvidence.d20.aggregate.status).toBe("insufficient_data");
    expect(bundle.horizonEvidence.d5.aggregate.meanMfe).not.toBeNull();
    expect(bundle.evidenceStatus).toBe("supported");
  });

  it("covers all case ids", () => {
    expect(EVAL_CASE_IDS.length).toBe(6);
  });
});
