/**
 * [B24-B1] Render the golden evaluation catalog to its committed artifacts (D24-14, OD-203).
 *
 *   npx tsx scripts/generate-b24-eval-catalog.ts [outDir]
 *
 * Writes eval-catalog.csv and eval-catalog.json (default outDir artifacts/ai-control-plane-b24); `b24-b1-catalog` case 9 byte-gates
 * both against the same renderings, so a change to a row, a link, a job, a live blocker, an owner or a note is reviewed in the module
 * first. It refuses to write anything when the catalog is invalid or when a row cites an LB id (in its live blockers or its note)
 * that is no row of the live-blocker register: `goldenCatalogWriteProblems` is the guard. Every path it writes comes from its
 * arguments; every catalog path it renders comes from the module's data. Output is byte-stable.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { GOLDEN_EVAL_CATALOG, GOLDEN_EVAL_CATALOG_VERSION, describeGoldenCatalogProblems, goldenCatalogWriteProblems, liveBlockerIdsOf, renderGoldenCatalogCsv, renderGoldenCatalogJson } from "../app/lib/evaluation/golden-catalog";

const REGISTER = "artifacts/remaining-builder-program/LIVE_BLOCKERS.md";

async function main(): Promise<void> {
  const outDir = resolve(process.cwd(), process.argv[2] ?? "artifacts/ai-control-plane-b24");
  const register = liveBlockerIdsOf((await readFile(resolve(process.cwd(), REGISTER), "utf8")).replaceAll("\r\n", "\n"));
  const problems = goldenCatalogWriteProblems(GOLDEN_EVAL_CATALOG, register);
  if (problems.length > 0) throw new Error(`Refused: nothing written.\n${[...problems, ...describeGoldenCatalogProblems(GOLDEN_EVAL_CATALOG)].join("\n")}`);
  const csv = renderGoldenCatalogCsv();
  const json = renderGoldenCatalogJson();
  await mkdir(outDir, { recursive: true });
  await writeFile(resolve(outDir, "eval-catalog.csv"), csv, "utf8");
  await writeFile(resolve(outDir, "eval-catalog.json"), json, "utf8");
  console.log(`Wrote golden evaluation catalog ${GOLDEN_EVAL_CATALOG_VERSION} (${GOLDEN_EVAL_CATALOG.length} rows) to ${outDir}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
