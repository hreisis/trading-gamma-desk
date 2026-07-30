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
  } = {},
): Promise<ValidatedResponse> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(url, {
    headers: options.headers,
  });

  const validated: ValidatedResponse = {
    status: response.status,
    contentType: response.headers.get("content-type") ?? "(none)",
    body: await response.text(),
  };

  assertValidResponse(validated, expectations);
  return validated;
}
