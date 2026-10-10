/**
 * [B24-D1] D24-28, OD-212 - render the threshold census to its committed artifact: `pnpm exec tsx scripts/generate-b24-threshold-census.ts [outDir]`.
 * Writes threshold-census.csv (default outDir artifacts/ai-control-plane-b24); `b24-d1-threshold-census` byte-gates it against the
 * same rendering, so a bound added, moved or reclassified is reviewed in threshold-classification.ts first. It refuses to write
 * (and exits non-zero) when the classification has any problem: an unclassified CI bound, a stale key, a performance bound left in
 * CI, a moved marker naming an uncatalogued metric. Every path it reads comes from the tree; output is byte-stable (LF).
 */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { THRESHOLD_CLASSIFICATIONS } from "../app/lib/qualification/threshold-classification";
import { censusCounts, classifyThresholdCensus, renderThresholdCensusCsv, scanThresholdCensus } from "../app/lib/qualification/threshold-census";

async function main(): Promise<void> {
  const outDir = resolve(process.cwd(), process.argv[2] ?? "artifacts/ai-control-plane-b24");
  const scan = await scanThresholdCensus({ root: process.cwd() });
  const classified = classifyThresholdCensus(scan.rows, THRESHOLD_CLASSIFICATIONS);
  if (classified.problems.length > 0) throw new Error(`Refused: nothing written.\n${classified.problems.join("\n")}`);
  await mkdir(outDir, { recursive: true });
  await writeFile(resolve(outDir, "threshold-census.csv"), renderThresholdCensusCsv(classified.rows), "utf8");
  console.log(`Wrote the threshold census (${scan.files} files, ${classified.rows.length} rows: ${JSON.stringify(censusCounts(classified.rows))}) to ${outDir}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
