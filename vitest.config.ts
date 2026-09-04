import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@core": fileURLToPath(new URL("./src/core", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Reproduction tests read the real MOSAIC workbooks from local.config.json and
    // skip themselves when that file is absent (the data never enters the repo).
    testTimeout: 60_000,
  },
});
