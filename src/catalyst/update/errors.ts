/**
 * Shared safe error classification for catalyst update.
 * Reuses integration-smoke classifier + Alpaca credential states.
 */

import {
  classifyAlpacaCredentialState,
  classifySmokeError,
  type SmokeErrorCode,
} from "../integration-smoke/errors";
import { redactSecrets } from "../integration-smoke/redaction";

export type UpdateErrorCode = SmokeErrorCode;

export {
  classifySmokeError,
  classifyAlpacaCredentialState,
  type SmokeErrorCode,
};

export function classifyUpdateError(message: string): UpdateErrorCode {
  const m = redactSecrets(message);
  if (/awaiting_valid_credentials|secret.*invalid|incomplete credentials/i.test(m)) {
    return "awaiting_valid_credentials";
  }
  if (/awaiting_live_smoke/i.test(m)) return "awaiting_live_smoke";
  return classifySmokeError(m);
}
