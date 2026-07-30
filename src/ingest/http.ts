import { assertValidResponse, type ResponseExpectations } from "./validate";
import type { ValidatedResponse } from "./types";

export type FetchLike = (
  url: string,
  init?: RequestInit,
) => Promise<Response>;

export async function fetchValidated(
  url: string,
  expectations: ResponseExpectations,
  options: {
    readonly headers?: Record<string, string>;
    readonly fetchImpl?: FetchLike;
    /** Abort after this many ms (descriptive timeout error). */
    readonly timeoutMs?: number;
  } = {},
): Promise<ValidatedResponse> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs;
  const controller =
    timeoutMs !== undefined ? new AbortController() : undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (controller && timeoutMs !== undefined) {
    timer = setTimeout(() => controller.abort(), timeoutMs);
  }

  try {
    const response = await fetchImpl(url, {
      headers: options.headers,
      signal: controller?.signal,
    });

    const validated: ValidatedResponse = {
      status: response.status,
      contentType: response.headers.get("content-type") ?? "(none)",
      body: await response.text(),
    };

    assertValidResponse(validated, expectations);
    return validated;
  } catch (error: unknown) {
    if (
      controller?.signal.aborted ||
      (error instanceof Error && error.name === "AbortError")
    ) {
      throw new Error(
        `${expectations.label}: timed out after ${timeoutMs}ms fetching ${url}`,
      );
    }
    throw error;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
