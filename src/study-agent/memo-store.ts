import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { StudyEvidenceBundle, StudyMemo } from "@/contracts";
import { writeJsonAtomic } from "@/desk/atomic-write";
import { deepEqualJson } from "@/gamma/deep-equal";

export class StudyMemoStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudyMemoStoreError";
  }
}

export function studyMemoRelPath(sessionDate: string): string {
  return join("studies", "memos", sessionDate, "study-memo.json");
}

export function studyMemoPath(dataRoot: string, sessionDate: string): string {
  return join(dataRoot, studyMemoRelPath(sessionDate));
}

export function readStudyEvidenceBundle(path: string): StudyEvidenceBundle {
  if (!existsSync(path)) {
    throw new StudyMemoStoreError(`evidence bundle not found: ${path}`);
  }
  return StudyEvidenceBundle.parse(
    JSON.parse(readFileSync(path, "utf8")),
  );
}

/**
 * Atomic write of a validated StudyMemo.
 * Idempotent when an identical memo already exists at path.
 */
export function writeStudyMemo(path: string, memo: StudyMemo): StudyMemo {
  const validated = StudyMemo.parse(memo);

  if (existsSync(path)) {
    const existing = StudyMemo.parse(
      JSON.parse(readFileSync(path, "utf8")),
    );
    if (!deepEqualJson(existing, validated)) {
      throw new StudyMemoStoreError(
        `study memo already exists with different payload: ${path}`,
      );
    }
    return validated;
  }

  writeJsonAtomic(path, validated);
  return validated;
}
