import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { renderGraphReplayEvidence, renderLineageRecoveryEvidence, renderRecoveryEvidence, renderReplacementConnectivityEvidence, renderSchematicReplayEvidence } from "../app/lib/engineering/schematic-replay-evidence";

async function main(): Promise<void> {
  const b06Dir = resolve(process.cwd(), "artifacts/ai-control-plane-b06");
  const b061Dir = resolve(process.cwd(), "artifacts/ai-control-plane-b06-1");
  const b062Dir = resolve(process.cwd(), "artifacts/ai-control-plane-b06-2");
  const b063Dir = resolve(process.cwd(), "artifacts/ai-control-plane-b06-3");
  const b07Dir = resolve(process.cwd(), "artifacts/ai-control-plane-b07");
  for (const dir of [b06Dir, b061Dir, b062Dir, b063Dir, b07Dir]) await mkdir(dir, { recursive: true });
  await writeFile(resolve(b06Dir, "schematic-replay-fixtures.json"), renderSchematicReplayEvidence(), "utf8");
  await writeFile(resolve(b061Dir, "replacement-connectivity-fixtures.json"), renderReplacementConnectivityEvidence(), "utf8");
  await writeFile(resolve(b062Dir, "recovery-fixtures.json"), renderRecoveryEvidence(), "utf8");
  await writeFile(resolve(b063Dir, "lineage-recovery-fixtures.json"), renderLineageRecoveryEvidence(), "utf8");
  await writeFile(resolve(b07Dir, "schematic-graph-replay-fixtures.json"), renderGraphReplayEvidence(), "utf8");
  console.log(`Wrote fixtures: B06 → ${b06Dir}, B06.1 → ${b061Dir}, B06.2 → ${b062Dir}, B06.3 → ${b063Dir}, B07 → ${b07Dir}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
