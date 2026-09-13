/**
 * [B19-A] Render the versioned source registry to its committed artifact.
 *
 *   npx tsx scripts/generate-b19-source-registry.ts [outDir]
 *
 * The committed CSV must byte-match this render (CI gate in
 * app/lib/acquisition/__tests__/b19-source-registry.test.ts): any change to a source's hosts, credentials references,
 * quota, freshness, terms or state changes the CSV, so the change is reviewed here first.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { renderSourceRegistryCsv, SOURCE_IDS, SOURCE_REGISTRY_VERSION, validateSourceRegistry } from "../app/lib/acquisition/source-registry";

async function main(): Promise<void> {
  const outDir = resolve(process.cwd(), process.argv[2] ?? "artifacts/ai-control-plane-b19");
  const errors = validateSourceRegistry();
  if (errors.length > 0) throw new Error(`Invalid source registry:\n${errors.join("\n")}`);
  await mkdir(outDir, { recursive: true });
  await writeFile(resolve(outDir, "source-registry.csv"), renderSourceRegistryCsv(), "utf8");
  console.log(`Wrote source registry ${SOURCE_REGISTRY_VERSION} (${SOURCE_IDS.length} sources) to ${outDir}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
