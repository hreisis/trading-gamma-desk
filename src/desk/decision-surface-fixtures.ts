import {
  StudyEvidenceBundle,
  type StudyMemo,
} from "@/contracts";
import {
  RULE_BASED_MEMO_MODEL,
  RULE_BASED_MEMO_PROVIDER,
  buildRuleBasedMemoOutput,
  validateStudyMemoOutput,
} from "@/study-agent";
import { PUBLIC_DEMO_DRIVER, PUBLIC_DEMO_SESSION } from "./public-demo";
import evidenceBundleFixture from "../../fixtures/studies/evidence-bundle.m62.json";

/** Exact session date with bundled public decision-surface fixtures — no latest fallback. */
export const DECISION_SURFACE_FIXTURE_SESSION = PUBLIC_DEMO_SESSION;

export const DECISION_SURFACE_EVIDENCE_FIXTURE_PATH =
  "fixtures/studies/evidence-bundle.m62.json";

export const DECISION_SURFACE_DRIVER = PUBLIC_DEMO_DRIVER;

export const DECISION_SURFACE_EVIDENCE_BUNDLE = StudyEvidenceBundle.parse(
  evidenceBundleFixture,
);

/** Rule-based validated memo — offline, no LLM. */
export const DECISION_SURFACE_MEMO: StudyMemo = validateStudyMemoOutput({
  bundle: DECISION_SURFACE_EVIDENCE_BUNDLE,
  output: buildRuleBasedMemoOutput(DECISION_SURFACE_EVIDENCE_BUNDLE),
  provider: RULE_BASED_MEMO_PROVIDER,
  model: RULE_BASED_MEMO_MODEL,
  generatedAt: DECISION_SURFACE_EVIDENCE_BUNDLE.computedAt,
  synthetic: true,
});

export const DECISION_SURFACE_SOURCE_LABEL =
  "Illustrative decision surface · synthetic fixtures";

export const PUBLIC_POLICY_UNAVAILABLE_MESSAGE =
  "Portfolio policy is unavailable in the public repository. Thresholds, sizing, and allocation rules are evaluated in a separate private workspace (M7 — not wired here).";
