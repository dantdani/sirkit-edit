/**
 * Regenerates the B16.0 authentication artifacts.
 *
 *   npx tsx scripts/generate-b16-0-artifacts.ts
 *
 * Writes:
 *   artifacts/ai-control-plane-b16-0/auth-route-coverage.csv
 *
 * The committed file is byte-checked by
 * `app/api/__tests__/b16-0-auth-route-coverage.test.ts`.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderAuthRouteCoverageCsv } from "../app/lib/auth/route-coverage";

const outDir = process.argv[2] ?? join("artifacts", "ai-control-plane-b16-0");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "auth-route-coverage.csv"), renderAuthRouteCoverageCsv());
process.stdout.write(`Wrote auth-route-coverage.csv to ${outDir}\n`);
