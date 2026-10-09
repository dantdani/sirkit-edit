import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // tsconfig says jsx: "preserve" (Next's compiler owns it); vitest's esbuild
  // must transform JSX itself for .test.tsx files.
  esbuild: { jsx: "automatic" },
  resolve: {
    // Mirror tsconfig's "@/*" → "./*" so tests can exercise modules that use
    // the app-wide import alias.
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)).replace(/[\\/]$/, "") },
  },
  test: {
    environment: "node",
    // Stage 17: .test.tsx files run component tests — they opt into jsdom
    // with a `// @vitest-environment jsdom` docblock; .test.ts stays node.
    include: ["app/**/__tests__/**/*.test.{ts,tsx}"],
    setupFiles: ["./app/lib/qualification/__tests__/_database-env-guard.ts"], // [B24-C1 review, 2026-10-08] no suite reaches a database the shell names: an ambient DATABASE_URL is removed before every test file
  },
});
