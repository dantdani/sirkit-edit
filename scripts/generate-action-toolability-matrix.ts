import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  ACTION_COVERAGE_REGISTRY,
  API_ROUTE_COVERAGE,
  renderActionToolabilityCsv,
  renderApiRouteCoverageCsv,
  validateActionCoverageRegistry,
} from "../app/lib/engineering/action-registry";
import { scanUiControlFingerprint } from "../app/lib/engineering/action-surface";

async function main(): Promise<void> {
  const outDir = resolve(process.cwd(), process.argv[2] ?? "artifacts/ai-control-plane-b01");
  const errors = validateActionCoverageRegistry();
  if (errors.length > 0) {
    throw new Error(`Invalid action coverage registry:\n${errors.join("\n")}`);
  }

  await mkdir(outDir, { recursive: true });
  await writeFile(resolve(outDir, "ui-command-toolability-matrix.csv"), renderActionToolabilityCsv(), "utf8");
  await writeFile(resolve(outDir, "api-route-coverage.csv"), renderApiRouteCoverageCsv(), "utf8");
  await writeFile(
    resolve(outDir, "ui-control-fingerprint.json"),
    JSON.stringify(scanUiControlFingerprint(process.cwd()), null, 2) + "\n",
    "utf8",
  );
  console.log(
    `Wrote ${ACTION_COVERAGE_REGISTRY.length} action records, ${API_ROUTE_COVERAGE.length} route coverage entries, and the UI control fingerprint to ${outDir}`,
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
