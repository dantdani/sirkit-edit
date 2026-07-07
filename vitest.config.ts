import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Mirror tsconfig's "@/*" → "./*" so tests can exercise modules that use
    // the app-wide import alias.
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)).replace(/[\\/]$/, "") },
  },
  test: {
    environment: "node",
    include: ["app/**/__tests__/**/*.test.ts"],
  },
});
