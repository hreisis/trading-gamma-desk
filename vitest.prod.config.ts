import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/** Opt-in config for next-start smoke (see npm run smoke:demo:prod). */
export default defineConfig({
  test: {
    include: ["tests/public-demo-production.test.ts"],
    environment: "node",
    testTimeout: 90_000,
    hookTimeout: 90_000,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
