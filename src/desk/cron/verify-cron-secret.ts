export interface CronSecretVerification {
  readonly ok: boolean;
  readonly reason:
    | "authorized"
    | "missing_secret"
    | "missing_authorization"
    | "invalid_authorization"
    | "mismatch";
}

/**
 * Fail-closed cron auth. When `CRON_SECRET` is unset, every request is rejected.
 * Expects `Authorization: Bearer <CRON_SECRET>` (Vercel Cron convention).
 */
export function verifyCronSecret(
  request: Request,
  env: Record<string, string | undefined> = process.env,
): CronSecretVerification {
  const secret = env.CRON_SECRET?.trim();
  if (!secret) {
    return { ok: false, reason: "missing_secret" };
  }

  const authorization = request.headers.get("authorization");
  if (!authorization) {
    return { ok: false, reason: "missing_authorization" };
  }

  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  if (!match) {
    return { ok: false, reason: "invalid_authorization" };
  }

  if (match[1] !== secret) {
    return { ok: false, reason: "mismatch" };
  }

  return { ok: true, reason: "authorized" };
}
