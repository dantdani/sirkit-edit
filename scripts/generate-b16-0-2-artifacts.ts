/**
 * B16.0.2 — regenerate the committed byte-pinned artifacts:
 *   artifacts/ai-control-plane-b16-0-2/route-data-and-resource-classification.csv
 *
 * Run after any route-policy / classification change:
 *   npx tsx scripts/generate-b16-0-2-artifacts.ts
 *
 * Byte stability is enforced by app/lib/auth/__tests__/b16-0-2-gates.test.ts.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderRouteResourceClassificationCsv } from "../app/lib/auth/route-resource-classification";

const outDir = join(process.cwd(), "artifacts", "ai-control-plane-b16-0-2");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "route-data-and-resource-classification.csv"), renderRouteResourceClassificationCsv());
process.stdout.write(`Wrote route-data-and-resource-classification.csv to ${outDir}\n`);
