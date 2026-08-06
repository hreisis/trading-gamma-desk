import { z } from "zod";

export const ArtifactKind = z.enum(["driver", "structure"]);

export const ArtifactSeverity = z.enum([
  "missing",
  "invalid",
  "mismatched",
  "stale",
]);

export const ArtifactIntegrityIssue = z.object({
  artifact: ArtifactKind,
  severity: ArtifactSeverity,
  message: z.string().min(1),
  path: z.string().optional(),
});

export type ArtifactKind = z.infer<typeof ArtifactKind>;
export type ArtifactSeverity = z.infer<typeof ArtifactSeverity>;
export type ArtifactIntegrityIssue = z.infer<typeof ArtifactIntegrityIssue>;
