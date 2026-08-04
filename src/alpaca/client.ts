import type { FetchLike } from "@/ingest/http";
import type { AlpacaClientConfig } from "./config";
import {
  classifyAlpacaHttpError,
  type AlpacaClientErrorCode,
} from "./errors";

export type { AlpacaClientErrorCode };
export {
  classifyAlpacaHttpError,
  mapAlpacaClientErrorToCredentialState,
} from "./errors";

export class AlpacaClientError extends Error {
  readonly code: AlpacaClientErrorCode;
  readonly statusCode?: number;

  constructor(
    message: string,
    code: AlpacaClientErrorCode,
    statusCode?: number,
  ) {
    super(message);
    this.name = "AlpacaClientError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export interface AlpacaJsonResponse<T> {
  readonly ok: true;
  readonly status: number;
  readonly data: T;
}

export interface AlpacaClient {
  readonly configured: boolean;
  getJson<T>(path: string, query?: Record<string, string>): Promise<T>;
}

export function createAlpacaClient(options: {
  readonly config: AlpacaClientConfig;
  readonly fetchImpl?: FetchLike;
}): AlpacaClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const { config } = options;
  const configured = Boolean(config.credentials);

  return {
    configured,
    async getJson<T>(
      path: string,
      query: Record<string, string> = {},
    ): Promise<T> {
      if (!config.credentials) {
        throw new AlpacaClientError(
          "Alpaca not configured — set APCA_API_KEY_ID and APCA_API_SECRET_KEY",
          "not_configured",
        );
      }

      const url = new URL(path, config.baseUrl.endsWith("/") ? config.baseUrl : `${config.baseUrl}/`);
      for (const [key, value] of Object.entries(query)) {
        if (value.length > 0) url.searchParams.set(key, value);
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.timeoutMs);
      try {
        const response = await fetchImpl(url.toString(), {
          method: "GET",
          headers: {
            "APCA-API-KEY-ID": config.credentials.keyId,
            "APCA-API-SECRET-KEY": config.credentials.secretKey,
            Accept: "application/json",
          },
          signal: controller.signal,
        });
        const text = await response.text();

        if (response.status === 401 || response.status === 403) {
          const classified = classifyAlpacaHttpError(response.status, text);
          throw new AlpacaClientError(
            classified.message,
            classified.code,
            response.status,
          );
        }
        if (response.status === 429) {
          throw new AlpacaClientError(
            "Alpaca rate limit exceeded (HTTP 429)",
            "rate_limit",
            response.status,
          );
        }
        if (!response.ok) {
          throw new AlpacaClientError(
            `Alpaca HTTP ${response.status}: ${text.slice(0, 200)}`,
            "http",
            response.status,
          );
        }

        try {
          return JSON.parse(text) as T;
        } catch {
          throw new AlpacaClientError(
            "Alpaca response is not valid JSON",
            "parse",
            response.status,
          );
        }
      } catch (error: unknown) {
        if (error instanceof AlpacaClientError) throw error;
        if (
          error instanceof Error &&
          (error.name === "AbortError" || controller.signal.aborted)
        ) {
          throw new AlpacaClientError(
            `Alpaca request timed out after ${config.timeoutMs}ms`,
            "timeout",
          );
        }
        throw new AlpacaClientError(
          error instanceof Error ? error.message : String(error),
          "network",
        );
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
