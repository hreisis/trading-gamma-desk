import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deskDataRootFromGammaProviderRoot } from "@/desk/production-runtime";
import { createFilesystemRuntimeJsonStore } from "@/desk/runtime-store/filesystem";
import { readJson, writeJson } from "@/desk/runtime-store/json";
import { boundedGammaArtifactRelativePath } from "@/gamma/marketdata-app/paths";

async function main() {
  const deskRoot = mkdtempSync(join(tmpdir(), "gammadesk-fs-verify-"));
  const gammaRoot = join(deskRoot, "gamma/providers/marketdata-app");
  const store = createFilesystemRuntimeJsonStore({ dataRoot: deskRoot });
  const rel = boundedGammaArtifactRelativePath("SPY");
  const payload = { symbol: "SPY", sessionDate: "2026-08-12", probe: "local-fs" };

  await writeJson(store, rel, payload);
  const fromStore = await readJson(store, rel);
  const fromDisk = JSON.parse(readFileSync(join(deskRoot, rel), "utf8"));
  const mappedRoot = deskDataRootFromGammaProviderRoot(gammaRoot);

  console.log("local filesystem verify: ok");
  console.log("  deskRoot:", deskRoot);
  console.log("  artifact path:", join(deskRoot, rel));
  console.log(
    "  gamma provider mapping:",
    mappedRoot === deskRoot ? "ok" : "mismatch",
  );
  console.log(
    "  roundtrip match:",
    JSON.stringify(fromStore) === JSON.stringify(fromDisk),
  );

  rmSync(deskRoot, { recursive: true, force: true });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
