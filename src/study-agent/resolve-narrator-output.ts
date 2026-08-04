import type {
  StudyMemoBullet,
  StudyMemoNarratorOutput,
  StudyMemoNarratorRawOutput,
} from "@/contracts";
import {
  REQUIRED_FIRST_EVIDENCE_CITATION_IDS,
  type StudyMemoCitationCatalog,
} from "./citation-catalog";
import { buildStudyMemoHeadlineFromPacket } from "./headline";
import type { StudyMemoInputPacket } from "./narrator";

function resolveBullet(
  catalog: StudyMemoCitationCatalog,
  bullet: StudyMemoNarratorRawOutput["evidence"][number],
  label: string,
  errors: string[],
): StudyMemoBullet | null {
  const paths: string[] = [];
  for (const citationId of bullet.citationIds) {
    const path = catalog.idToPath.get(citationId);
    if (!path) {
      errors.push(`${label} ${bullet.id}: unknown citationId ${citationId}`);
      return null;
    }
    if (!paths.includes(path)) paths.push(path);
  }
  if (paths.length === 0) {
    errors.push(`${label} ${bullet.id}: no resolved bundle paths`);
    return null;
  }
  return {
    id: bullet.id,
    text: bullet.text,
    bundleFieldPaths: paths,
  };
}

function resolveSection(
  catalog: StudyMemoCitationCatalog,
  bullets: StudyMemoNarratorRawOutput["inference"],
  label: string,
  errors: string[],
): StudyMemoBullet[] {
  const out: StudyMemoBullet[] = [];
  for (const bullet of bullets) {
    const resolved = resolveBullet(catalog, bullet, label, errors);
    if (resolved) out.push(resolved);
  }
  return out;
}

/**
 * Resolve narrator citationIds to canonical bundleFieldPaths and apply deterministic headline.
 * Rejects unknown citation IDs — no silent repair.
 */
export function resolveStudyMemoNarratorOutput(input: {
  readonly packet: StudyMemoInputPacket;
  readonly catalog: StudyMemoCitationCatalog;
  readonly raw: StudyMemoNarratorRawOutput;
}): { ok: true; output: StudyMemoNarratorOutput } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const evidence = resolveSection(
    input.catalog,
    input.raw.evidence,
    "evidence",
    errors,
  );
  const inference = resolveSection(
    input.catalog,
    input.raw.inference,
    "inference",
    errors,
  );
  const limitations = resolveSection(
    input.catalog,
    input.raw.limitations,
    "limitations",
    errors,
  );
  const unknowns = resolveSection(
    input.catalog,
    input.raw.unknowns,
    "unknowns",
    errors,
  );

  if (evidence.length === 0) {
    errors.push("evidence must contain at least one resolved bullet");
  }

  const firstRaw = input.raw.evidence[0];
  if (firstRaw) {
    for (const requiredId of REQUIRED_FIRST_EVIDENCE_CITATION_IDS) {
      if (!firstRaw.citationIds.includes(requiredId)) {
        errors.push(
          `first evidence bullet must cite ${requiredId} (got ${firstRaw.citationIds.join(", ")})`,
        );
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    output: {
      headline: buildStudyMemoHeadlineFromPacket(input.packet),
      evidence,
      inference,
      limitations,
      unknowns,
    },
  };
}
