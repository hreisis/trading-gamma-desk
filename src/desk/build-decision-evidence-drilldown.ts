import type {
  SimilarRegimeStudy,
  StudyEvidenceBundle,
  StudyForwardOutcome,
  StudyMatchFactorKey,
  StudyMatchProfile,
  StudyMemo,
  StudyMemoBullet,
} from "@/contracts";
import type {
  CitationFieldPreview,
  DecisionEvidenceDrillDown,
  EvidenceDrillDownLane,
  HorizonEvidenceDrillDown,
  MatchFieldDisplay,
  MatchedSessionDisplay,
  MemoBulletDrillDown,
  PeerHorizonOutcomeDisplay,
} from "@/contracts/decision-surface";
import {
  normalizeBundleFieldPath,
  resolveBundleFieldPath,
} from "@/study-agent/citations";
import {
  buildDecisionEvidenceSummary,
  formatStudyReturnPercent,
} from "./decision-evidence-display";

export interface PeerSessionContext {
  readonly studyId: string;
  readonly profile: StudyMatchProfile | null;
  readonly outcome: StudyForwardOutcome | null;
}

const HORIZON_KEYS = {
  "1D": "d1",
  "5D": "d5",
  "20D": "d20",
} as const;

const SENSITIVE_VALUE_PATTERN =
  /(?:\/|\\|^data\/|^fixtures\/|\.json$|api[_-]?key|secret|password|token)/i;

function looksLikeSensitivePath(value: string): boolean {
  return SENSITIVE_VALUE_PATTERN.test(value);
}

/** Public-safe display string for a resolved bundle field value. */
export function formatCitationFieldValue(value: unknown): string {
  if (value === null || value === undefined) return "unknown";
  if (typeof value === "number") {
    if (Number.isFinite(value) && Math.abs(value) <= 1) {
      return formatStudyReturnPercent(value);
    }
    return String(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") {
    if (looksLikeSensitivePath(value)) return "unknown";
    return value;
  }
  if (Array.isArray(value)) {
    const items = value
      .map((item) => formatCitationFieldValue(item))
      .filter((item) => item !== "unknown");
    return items.length > 0 ? items.join(", ") : "unknown";
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const blockedKeys = new Set([
      "relativePath",
      "provenance",
      "path",
      "manifestPath",
      "archiveRef",
    ]);
    for (const key of blockedKeys) {
      if (key in record) {
        const sanitized = { ...record };
        for (const blocked of blockedKeys) {
          delete sanitized[blocked];
        }
        return formatCitationFieldValue(sanitized);
      }
    }
    try {
      const json = JSON.stringify(value);
      if (looksLikeSensitivePath(json)) return "unknown";
      if (json.length > 240) return `${json.slice(0, 237)}…`;
      return json;
    } catch {
      return "unknown";
    }
  }
  return "unknown";
}

export function resolveCitationPreviews(
  bundle: StudyEvidenceBundle,
  paths: readonly string[],
): CitationFieldPreview[] {
  return paths.map((rawPath) => {
    const path = normalizeBundleFieldPath(rawPath);
    const value = resolveBundleFieldPath(bundle, path);
    const resolved = value !== undefined;
    return {
      path,
      displayValue: resolved ? formatCitationFieldValue(value) : "unknown",
      resolved,
    };
  });
}

function matchFieldDisplay(
  profile: StudyMatchProfile,
  factor: StudyMatchFactorKey,
): MatchFieldDisplay {
  const field = profile.fields[factor];
  if (!field) {
    return {
      factor,
      queryValue: "unknown",
      status: "unavailable",
      unavailableReason: "field not present on profile",
    };
  }
  if (field.status === "available") {
    return {
      factor,
      queryValue: field.value,
      status: "available",
    };
  }
  return {
    factor,
    queryValue: "unknown",
    status: "unavailable",
    unavailableReason: field.reason,
  };
}

function horizonDrillDown(
  bundle: StudyEvidenceBundle,
  key: "d1" | "d5" | "d20",
): HorizonEvidenceDrillDown {
  const summary = buildDecisionEvidenceSummary(bundle);
  const block = bundle.horizonEvidence[key];
  const base = summary.horizons[key];
  const agg = block.aggregate;
  return {
    ...base,
    medianMfe:
      agg.medianMfe === null
        ? "unknown"
        : formatStudyReturnPercent(agg.medianMfe),
    medianMae:
      agg.medianMae === null
        ? "unknown"
        : formatStudyReturnPercent(agg.medianMae),
    statusBasisReasons: [...block.statusBasis.reasons],
  };
}

function peerHorizonDisplay(
  outcome: StudyForwardOutcome | null,
  horizon: "1D" | "5D" | "20D",
): PeerHorizonOutcomeDisplay {
  if (!outcome) {
    return {
      horizon,
      maturity: "unknown",
      return: "unknown",
      mfe: "unknown",
      mae: "unknown",
      unavailableReason: "forward outcome unavailable",
    };
  }
  const key = HORIZON_KEYS[horizon];
  const ret = outcome.returns[key];
  const ex = outcome.excursion[key];
  const mat = outcome.maturity.find((m) => m.horizon === horizon);
  const maturity = mat?.status ?? "unknown";
  return {
    horizon,
    maturity,
    return:
      ret.status === "available"
        ? formatStudyReturnPercent(ret.value)
        : "unknown",
    mfe:
      ex.status === "available"
        ? formatStudyReturnPercent(ex.mfe)
        : "unknown",
    mae:
      ex.status === "available"
        ? formatStudyReturnPercent(ex.mae)
        : "unknown",
    unavailableReason:
      ret.status === "unavailable"
        ? ret.reason
        : ex.status === "unavailable"
          ? ex.reason
          : mat?.reason,
  };
}

function buildMatchedSession(
  studyId: string,
  profile: StudyMatchProfile | null,
  outcome: StudyForwardOutcome | null,
  criteriaFactors: readonly StudyMatchFactorKey[],
): MatchedSessionDisplay {
  const missingDataNotes: string[] = [];
  let sessionDate = profile?.sessionDate;
  if (!sessionDate && outcome) {
    sessionDate = outcome.sessionDate;
  }
  if (!sessionDate) {
    sessionDate = "1970-01-01";
    missingDataNotes.push("session date unavailable");
  }

  const profileStatus = profile
    ? "available"
    : outcome
      ? "partial"
      : "unavailable";
  let outcomeStatus: MatchedSessionDisplay["outcomeStatus"] = "unavailable";
  if (outcome) {
    const matureCount = outcome.maturity.filter((m) => m.status === "mature").length;
    outcomeStatus =
      matureCount === 3 ? "available" : matureCount > 0 ? "partial" : "unavailable";
  } else {
    missingDataNotes.push("forward outcome not loaded");
  }

  const matchFields = criteriaFactors.map((factor) => {
    if (profile) return matchFieldDisplay(profile, factor);
    missingDataNotes.push(`match profile missing for ${factor}`);
    return {
      factor,
      queryValue: "unknown",
      status: "unavailable" as const,
      unavailableReason: "peer profile unavailable",
    };
  });

  return {
    studyId,
    sessionDate,
    matchFields,
    horizons: (["1D", "5D", "20D"] as const).map((h) =>
      peerHorizonDisplay(outcome, h),
    ),
    missingDataNotes,
    profileStatus,
    outcomeStatus,
  };
}

function memoLane(section: EvidenceDrillDownLane): EvidenceDrillDownLane {
  return section;
}

function buildMemoBulletDrillDown(
  bundle: StudyEvidenceBundle,
  bullet: StudyMemoBullet,
  lane: EvidenceDrillDownLane,
): MemoBulletDrillDown {
  return {
    id: bullet.id,
    text: bullet.text,
    lane: memoLane(lane),
    citations: resolveCitationPreviews(bundle, bullet.bundleFieldPaths),
  };
}

export function buildDecisionEvidenceDrillDown(input: {
  readonly bundle: StudyEvidenceBundle;
  readonly memo: StudyMemo | null;
  readonly similarRegimeStudy?: SimilarRegimeStudy | null;
  readonly peerSessions?: readonly PeerSessionContext[];
}): DecisionEvidenceDrillDown {
  const { bundle, memo } = input;
  const study = input.similarRegimeStudy;
  const criteriaFactors = bundle.matchCriteria.factors;

  const queryMatchFields = criteriaFactors.map((factor) =>
    matchFieldDisplay(bundle.queryContext.matchProfile, factor),
  );

  const matchedFactors =
    study?.matchedFactors ?? [...bundle.matchCriteria.factors];
  const differentFactors =
    study?.differentFactors.map((entry) => ({
      factor: entry.factor,
      distinctValues: [...entry.distinctValues],
    })) ?? [];

  const peerById = new Map(
    (input.peerSessions ?? []).map((peer) => [peer.studyId, peer]),
  );

  const matchedSessions = bundle.cohortQuality.matchedStudyIds.map((studyId) => {
    const peer = peerById.get(studyId);
    return buildMatchedSession(
      studyId,
      peer?.profile ?? null,
      peer?.outcome ?? null,
      criteriaFactors,
    );
  });

  const memoBullets: MemoBulletDrillDown[] = [];
  if (memo) {
    for (const bullet of memo.evidence) {
      memoBullets.push(buildMemoBulletDrillDown(bundle, bullet, "deterministic"));
    }
    for (const bullet of memo.inference) {
      memoBullets.push(buildMemoBulletDrillDown(bundle, bullet, "inference"));
    }
    for (const bullet of memo.limitations) {
      memoBullets.push(buildMemoBulletDrillDown(bundle, bullet, "limitations"));
    }
    for (const bullet of memo.unknowns) {
      memoBullets.push(buildMemoBulletDrillDown(bundle, bullet, "unknowns"));
    }
  }

  return {
    queryMatchFields,
    matchCriteria: {
      factors: [...bundle.matchCriteria.factors],
      excludeQueryStudy: bundle.matchCriteria.excludeQueryStudy,
      minMatureSampleSize: bundle.matchCriteria.minMatureSampleSize,
    },
    similarity: {
      matchedFactors: [...matchedFactors],
      differentFactors,
      rejectedStudyCount: bundle.cohortQuality.rejectedStudyCount,
      statusBasisReasons: [...bundle.statusBasis.reasons],
      statusBasisRuleId: bundle.statusBasis.ruleId,
    },
    horizons: {
      d1: horizonDrillDown(bundle, "d1"),
      d5: horizonDrillDown(bundle, "d5"),
      d20: horizonDrillDown(bundle, "d20"),
    },
    matchedSessions,
    bundleLimitations: [...bundle.limitations],
    cohortUnknowns: [...bundle.cohortQuality.warnings],
    memoBullets,
  };
}
