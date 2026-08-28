/**
 * B16.0.1 — regenerate the committed stage artifacts:
 *
 *   artifacts/ai-control-plane-b16-0-1/exact-route-authorization-policy.csv
 *
 * Run after any route-policy change:
 *   npx tsx scripts/generate-b16-0-1-artifacts.ts
 *
 * The CSV must stay byte-identical to the renderer — enforced by
 * `app/lib/auth/__tests__/b16-0-1-ci-gates.test.ts`.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderExactRoutePolicyCsv } from "../app/lib/auth/route-policy";

const outDir = join(process.cwd(), "artifacts", "ai-control-plane-b16-0-1");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "exact-route-authorization-policy.csv"), renderExactRoutePolicyCsv());
process.stdout.write(`Wrote exact-route-authorization-policy.csv to ${outDir}\n`);
