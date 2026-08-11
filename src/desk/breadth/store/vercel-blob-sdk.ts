import {
  BlobAccessError,
  BlobClientTokenExpiredError,
  BlobError,
  BlobNotFoundError,
  BlobPreconditionFailedError,
  BlobServiceNotAvailable,
  BlobServiceRateLimited,
  BlobStoreNotFoundError,
  BlobStoreSuspendedError,
  get as blobGet,
  list as blobList,
  put as blobPut,
} from "@vercel/blob";
import type { BlobStoreClient, BlobStorePutOptions } from "./blob-client";

const PRIVATE_ACCESS = "private" as const;

function redactSensitiveText(text: string): string {
  return text
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/authorization:\s*\S+/gi, "authorization: [redacted]");
}

function describeBlobSdkError(error: unknown): {
  readonly errorClass: string;
  readonly statusOrCode: string | null;
  readonly message: string;
} {
  const errorClass =
    error instanceof Error ? error.constructor.name : "UnknownError";
  let statusOrCode: string | null = null;

  if (error instanceof BlobServiceRateLimited) {
    statusOrCode = `rate_limited:${error.retryAfter}`;
  } else if (error instanceof BlobAccessError) {
    statusOrCode = "access_denied";
  } else if (error instanceof BlobClientTokenExpiredError) {
    statusOrCode = "token_expired";
  } else if (error instanceof BlobStoreNotFoundError) {
    statusOrCode = "store_not_found";
  } else if (error instanceof BlobStoreSuspendedError) {
    statusOrCode = "store_suspended";
  } else if (error instanceof BlobPreconditionFailedError) {
    statusOrCode = "precondition_failed";
  } else if (error instanceof BlobServiceNotAvailable) {
    statusOrCode = "service_unavailable";
  } else if (error instanceof BlobError) {
    const match = error.message.match(/\b(40[0-9]|50[0-9])\b/);
    statusOrCode = match?.[1] ?? "blob_error";
  }

  const message = redactSensitiveText(
    error instanceof Error ? error.message : String(error),
  );

  return { errorClass, statusOrCode, message };
}

function logBlobStoreError(
  operation: "put" | "get",
  error: unknown,
): void {
  const detail = describeBlobSdkError(error);
  console.error("[breadth-blob]", {
    operation,
    errorClass: detail.errorClass,
    statusOrCode: detail.statusOrCode,
    message: detail.message,
  });
}

function toSafeBlobClientError(
  operation: "put" | "get",
  error: unknown,
): Error {
  const detail = describeBlobSdkError(error);
  return new Error(
    `vercel blob ${operation} failed (${detail.errorClass}${detail.statusOrCode ? `:${detail.statusOrCode}` : ""}): ${detail.message}`,
  );
}

async function readBlobStream(
  stream: ReadableStream<Uint8Array>,
): Promise<string> {
  return await new Response(stream).text();
}

/**
 * Production breadth blob transport via `@vercel/blob` with private access.
 * Uses BLOB_READ_WRITE_TOKEN; does not hardcode Blob API versions.
 */
export function createVercelBlobStoreClient(input: {
  readonly token: string;
}): BlobStoreClient {
  const token = input.token;

  return {
    async put(pathname, body, options?: BlobStorePutOptions) {
      try {
        await blobPut(pathname, body, {
          access: PRIVATE_ACCESS,
          addRandomSuffix: false,
          allowOverwrite: options?.allowOverwrite ?? false,
          contentType: "application/json",
          token,
        });
      } catch (error) {
        if (error instanceof BlobNotFoundError) {
          logBlobStoreError("put", error);
          throw toSafeBlobClientError("put", error);
        }
        logBlobStoreError("put", error);
        throw toSafeBlobClientError("put", error);
      }
    },

    async get(pathname) {
      try {
        const result = await blobGet(pathname, {
          access: PRIVATE_ACCESS,
          token,
          useCache: false,
        });
        if (result === null) {
          return null;
        }
        if (result.statusCode === 304 || result.stream === null) {
          throw new Error("vercel blob get returned empty stream");
        }
        return await readBlobStream(result.stream);
      } catch (error) {
        if (error instanceof BlobNotFoundError) {
          return null;
        }
        logBlobStoreError("get", error);
        throw toSafeBlobClientError("get", error);
      }
    },

    async list(prefix) {
      try {
        const result = await blobList({ prefix, token });
        return result.blobs.map((blob) => blob.pathname);
      } catch (error) {
        logBlobStoreError("get", error);
        throw toSafeBlobClientError("get", error);
      }
    },
  };
}
