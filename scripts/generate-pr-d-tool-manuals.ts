/**
 * [PR-D] Regenerate the registry-backed tool manuals (assignment D.9): one Markdown manual per descriptor of the B04 catalog and a
 * manifest, rendered by app/lib/engineering/tool-manual.ts from the registry and the handler modules it binds.
 *
 *   pnpm exec tsx scripts/generate-pr-d-tool-manuals.ts [outDir]
 *
 * Writes artifacts/product-reliability-simple-ui/manuals/<toolId>.md and manuals/MANIFEST.json ({ toolId, version, sha256 } per
 * manual, sorted by tool id, plus the registry digest) deterministically: no timestamps, LF only, byte-stable across runs. A manual
 * whose tool is no longer in the catalog is removed from the directory (a stale manual fails the gate until regenerated). The
 * committed files must byte-match this render (the gate in app/lib/engineering/__tests__/pr-d-tool-manuals.test.ts): a descriptor
 * or handler change changes a manual's digest, so the change is reviewed here first. The render refuses (and nothing is written)
 * when an example does not validate against its schema. Importing this module from a test is side-effect free (the
 * generate-pr-d-coverage-matrix precedent).
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { sirkitToolRegistry } from "../app/lib/engineering/tool-catalog";
import { MANUAL_MANIFEST_SCHEMA, renderToolManuals, type RenderedToolManual } from "../app/lib/engineering/tool-manual";
import type { ToolRegistry } from "../app/lib/engineering/tool-registry";

export const PR_D_MANUALS_DIR = "artifacts/product-reliability-simple-ui/manuals";
export const PR_D_MANUALS_MANIFEST = "MANIFEST.json";

export interface ManualManifestEntry { toolId: string; version: string; sha256: string }
export interface ManualManifest { schema: typeof MANUAL_MANIFEST_SCHEMA; registryDigest: string; count: number; manuals: ManualManifestEntry[] }
export interface GeneratedToolManuals {
  manuals: Array<RenderedToolManual & { sha256: string }>;
  manifest: ManualManifest;
  manifestJson: string;
}

export const sha256Hex = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

/** Generate every manual and the manifest in memory from the registry (the gate compares this with the committed files byte for byte). */
export function generateToolManuals(registry: ToolRegistry = sirkitToolRegistry()): GeneratedToolManuals {
  const manuals = renderToolManuals(registry).map((manual) => ({ ...manual, sha256: sha256Hex(manual.markdown) }));
  const sorted = [...manuals].sort((a, b) => (a.toolId < b.toolId ? -1 : a.toolId > b.toolId ? 1 : 0));
  const manifest: ManualManifest = {
    schema: MANUAL_MANIFEST_SCHEMA,
    registryDigest: registry.digest(),
    count: sorted.length,
    manuals: sorted.map(({ toolId, version, sha256 }) => ({ toolId, version, sha256 })),
  };
  return { manuals: sorted, manifest, manifestJson: `${JSON.stringify(manifest, null, 2)}\n` };
}

// Run only as a script (tsx) - importing this module from a test is side-effect free.
const invokedAsScript = Boolean(process.argv[1] && process.argv[1].replace(/\\/g, "/").includes("generate-pr-d-tool-manuals"));
if (invokedAsScript) {
  const outDir = resolve(process.cwd(), process.argv[2] ?? PR_D_MANUALS_DIR);
  const generated = generateToolManuals();
  mkdirSync(outDir, { recursive: true });
  const expected = new Set([...generated.manuals.map((manual) => manual.file), PR_D_MANUALS_MANIFEST]);
  const stale = existsSync(outDir) ? readdirSync(outDir).filter((entry) => (entry.endsWith(".md") || entry === PR_D_MANUALS_MANIFEST) && !expected.has(entry)) : [];
  for (const entry of stale) rmSync(join(outDir, entry));
  for (const manual of generated.manuals) writeFileSync(join(outDir, manual.file), manual.markdown, "utf8");
  writeFileSync(join(outDir, PR_D_MANUALS_MANIFEST), generated.manifestJson, "utf8");
  const families = new Map<string, number>();
  for (const manual of generated.manuals) families.set(manual.family, (families.get(manual.family) ?? 0) + 1);
  process.stdout.write(`Wrote ${generated.manuals.length} manuals and ${PR_D_MANUALS_MANIFEST} (registry ${generated.manifest.registryDigest}) to ${outDir}${stale.length > 0 ? `; removed stale: ${stale.join(", ")}` : ""}\n${[...families.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([family, count]) => `  ${family}: ${count}`).join("\n")}\n`);
}
