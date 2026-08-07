import type { BlobStoreClient } from "./blob-client";

const BLOB_API_VERSION = "7";

export function createFetchVercelBlobStoreClient(input: {
  readonly token: string;
  readonly fetchImpl?: typeof fetch;
}): BlobStoreClient {
  const fetchImpl = input.fetchImpl ?? fetch;
  const token = input.token;

  async function requestPath(
    pathname: string,
    method: "HEAD" | "PUT",
    body?: string,
  ): Promise<Response> {
    return fetchImpl(`https://blob.vercel-storage.com/${encodeURI(pathname)}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        "x-api-version": BLOB_API_VERSION,
        ...(method === "PUT"
          ? {
              "x-content-type": "application/json",
              "x-add-random-suffix": "0",
            }
          : {}),
      },
      body: method === "PUT" ? body : undefined,
    });
  }

  return {
    async put(pathname, body) {
      const response = await requestPath(pathname, "PUT", body);
      if (!response.ok) {
        throw new Error(`vercel blob put failed: HTTP ${response.status}`);
      }
    },

    async get(pathname) {
      const head = await requestPath(pathname, "HEAD");
      if (head.status === 404) {
        return null;
      }
      if (!head.ok) {
        throw new Error(`vercel blob head failed: HTTP ${head.status}`);
      }

      const downloadUrl = head.headers.get("url");
      if (!downloadUrl) {
        return null;
      }

      const response = await fetchImpl(downloadUrl);
      if (response.status === 404) {
        return null;
      }
      if (!response.ok) {
        throw new Error(`vercel blob download failed: HTTP ${response.status}`);
      }
      return await response.text();
    },
  };
}
