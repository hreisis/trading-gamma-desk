import { readFileSync } from "node:fs";
import { FileGammaSnapshotStore } from "@/gamma";

const root = process.env.GAMMADESK_APPEND_ROOT;
const snapshotFile = process.env.GAMMADESK_APPEND_SNAPSHOT;

if (!root || !snapshotFile) {
  console.error("missing GAMMADESK_APPEND_ROOT or GAMMADESK_APPEND_SNAPSHOT");
  process.exit(2);
}

const snapshot = JSON.parse(readFileSync(snapshotFile, "utf8"));
const store = new FileGammaSnapshotStore(root);

try {
  const result = store.append(snapshot);
  process.stdout.write(
    JSON.stringify({ status: "ok", outcome: result.outcome }) + "\n",
  );
} catch (err) {
  process.stdout.write(
    JSON.stringify({
      status: "error",
      name: err instanceof Error ? err.name : "Error",
      message: err instanceof Error ? err.message : String(err),
    }) + "\n",
  );
  process.exit(1);
}
