/**
 * [B23-A1] Render the provider registry to its committed artifact.
 *
 *   npx tsx scripts/generate-b23-provider-registry.ts [outDir]
 *
 * The committed CSV must byte-match this render (gate in
 * app/lib/manufacturing-providers/__tests__/b23-a-provider-registry.test.ts): a change to a provider's kind, API access (status and
 * owner decision), enabled tier, hosts, credential reference names, account scope, the twelve runbook facts, capability mapping,
 * documentation URLs or reading (label, reader, date and re-read mark),
 * or to an operation's id, tier, channel, state, never-called mark, endpoint, authentication scheme or record source, changes the
 * CSV, so the change is reviewed here first. [B23-A1 review, 2026-10-02] Prose is not rendered: an operation's provider name,
 * purpose and reason, a row's notes, a credential reference's role and each documentation page's own date are reviewed in
 * provider-registry.ts, where the registry suite reads them. [B23-A1 lead, 2026-10-02] So are the API access's reason and the
 * reading's `where`: neither is rendered, so neither changes the CSV.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PROVIDER_IDS, PROVIDER_REGISTRY_VERSION, renderProviderRegistryCsv, validateProviderRegistry } from "../app/lib/manufacturing-providers/provider-registry";

async function main(): Promise<void> {
  const outDir = resolve(process.cwd(), process.argv[2] ?? "artifacts/ai-control-plane-b23");
  const errors = validateProviderRegistry();
  if (errors.length > 0) throw new Error(`Invalid provider registry:\n${errors.join("\n")}`);
  await mkdir(outDir, { recursive: true });
  await writeFile(resolve(outDir, "provider-registry.csv"), renderProviderRegistryCsv(), "utf8");
  console.log(`Wrote provider registry ${PROVIDER_REGISTRY_VERSION} (${PROVIDER_IDS.length} providers) to ${outDir}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
