/**
 * [B24-B3] Render the twenty-scenario map to its committed artifacts (D24-17, OD-206).
 *
 *   npx tsx scripts/generate-b24-scenario-map.ts [outDir]
 *
 * Writes scenario-map.csv and scenario-map.json (default outDir artifacts/ai-control-plane-b24); `b24-b3-scenario-map` case 5 byte-gates
 * both against the same renderings, so a change to a standing, an evidence item, a missing text, a decision or a blocker is reviewed in
 * the module first. It refuses to write anything (and exits non-zero) when the map has any problem: `scenarioMapProblems` over the
 * map's own recorded CI jobs, the live-blocker register's LB ids and the files the evidence cites. Every path it writes comes from its
 * arguments; every path it renders comes from the module's data. Output is byte-stable.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { liveBlockerIdsOf } from "../app/lib/evaluation/golden-catalog";
import { SCENARIO_MAP, SCENARIO_MAP_VERSION, describeScenarioMapProblems, recordedCiJobsOf, renderScenarioMapCsv, renderScenarioMapJson, scenarioMapProblems, type ScenarioMapFacts } from "../app/lib/evaluation/scenario-map";

const REGISTER = "artifacts/remaining-builder-program/LIVE_BLOCKERS.md";
const repoText = (path: string): string | null => {
  const full = resolve(process.cwd(), path);
  return existsSync(full) ? readFileSync(full, "utf8").replaceAll("\r\n", "\n") : null;
};

async function main(): Promise<void> {
  const outDir = resolve(process.cwd(), process.argv[2] ?? "artifacts/ai-control-plane-b24");
  const register = liveBlockerIdsOf((await readFile(resolve(process.cwd(), REGISTER), "utf8")).replaceAll("\r\n", "\n"));
  const facts: ScenarioMapFacts = { ciJobsOf: recordedCiJobsOf(SCENARIO_MAP), liveBlockerIds: register, read: repoText };
  const problems = scenarioMapProblems(SCENARIO_MAP, facts);
  if (problems.length > 0) throw new Error(`Refused: nothing written.\n${describeScenarioMapProblems(SCENARIO_MAP, facts).join("\n")}`);
  const csv = renderScenarioMapCsv();
  const json = renderScenarioMapJson();
  await mkdir(outDir, { recursive: true });
  await writeFile(resolve(outDir, "scenario-map.csv"), csv, "utf8");
  await writeFile(resolve(outDir, "scenario-map.json"), json, "utf8");
  console.log(`Wrote scenario map ${SCENARIO_MAP_VERSION} (${SCENARIO_MAP.length} scenarios) to ${outDir}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
