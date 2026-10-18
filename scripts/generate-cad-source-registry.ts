/**
 * [PR-M, 2026-10-18] Section M2: render the reviewed CAD source registry to its committed artifact.
 *
 *   npx tsx scripts/generate-cad-source-registry.ts
 *
 * The committed CSV must byte-match this render (gate: app/lib/component-resolution/__tests__/m2-2-cad-source-registry.test.ts): any change to a
 * CAD source's hosts, templates, ceilings, refs, licence, retention, disclosure or status changes the CSV, so the change is reviewed here.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { CAD_SOURCE_ENTRIES, CAD_SOURCE_REGISTRY_ARTIFACT, CAD_SOURCE_REGISTRY_VERSION, renderCadSourceRegistryCsv, validateCadSourceRegistry } from "../app/lib/acquisition/cad-source-registry";

async function main(): Promise<void> {
  const errors = validateCadSourceRegistry();
  if (errors.length > 0) throw new Error(`Invalid CAD source registry:\n${errors.join("\n")}`);
  const target = resolve(process.cwd(), CAD_SOURCE_REGISTRY_ARTIFACT);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, renderCadSourceRegistryCsv(), "utf8");
  console.log(`Wrote CAD source registry ${CAD_SOURCE_REGISTRY_VERSION} (${CAD_SOURCE_ENTRIES.length} sources) to ${CAD_SOURCE_REGISTRY_ARTIFACT}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
