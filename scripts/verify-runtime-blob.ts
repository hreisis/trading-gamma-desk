import { readBreadthBlobToken } from "@/desk/breadth/store/blob-client";
import { createVercelBlobStoreClient } from "@/desk/breadth/store/vercel-blob-sdk";
import { createBlobRuntimeJsonStore } from "@/desk/runtime-store/blob";
import { readJson, writeJson } from "@/desk/runtime-store/json";

async function main() {
  const token = readBreadthBlobToken(process.env);
  if (!token) {
    console.log("blob verify: skipped (BLOB_READ_WRITE_TOKEN not configured)");
    return;
  }

  const client = createVercelBlobStoreClient({ token });
  const store = createBlobRuntimeJsonStore({ client, prefix: "desk" });
  const rel = "runtime-store/_probe.json";
  const payload = { probe: "blob-roundtrip", at: new Date().toISOString() };

  const wrote = await writeJson(store, rel, payload, { allowOverwrite: true });
  const readBack = await readJson(store, rel);
  const ok =
    wrote &&
    readBack !== null &&
    (readBack as { probe: string }).probe === payload.probe;

  console.log("blob verify:", ok ? "ok" : "failed");
  console.log("  store mode:", store.mode);
  console.log("  store root:", store.rootLabel);
  console.log("  probe path:", rel);
  if (!ok) process.exit(1);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
