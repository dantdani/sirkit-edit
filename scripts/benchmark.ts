import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { builtinBenchmarkExecutor } from "../app/lib/benchmark/builtin-executor";
import { COMPETITIVE_CAPABILITY_REGISTRY, COMPETITIVE_PROTOCOL_DIGEST, COMPETITIVE_PROTOCOL_V1 } from "../app/lib/benchmark/capability-registry";
import { summarizeBenchmarkRuns, renderBenchmarkReport } from "../app/lib/benchmark/analysis";
import { STAGE9_CORPUS_PACKAGES, STAGE9_CORPUS_V1 } from "../app/lib/benchmark/corpus-v1";
import { ImmutableBenchmarkStore } from "../app/lib/benchmark/result-store";
import { runBenchmarkPackage } from "../app/lib/benchmark/runner";
import { REGRESSION_BUDGETS, REGRESSION_POLICY_VERSION, REGRESSION_SUITES } from "../app/lib/benchmark/regression-policy";
import { benchmarkDigest, canonicalBenchmarkJson } from "../app/lib/benchmark/stable";
import { validateCorpusManifest } from "../app/lib/benchmark/validation";

const root = process.cwd();
const artifactRoot = path.join(root, "artifacts", "stage-09");

function gitHead(): string {
  try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", windowsHide: true }).trim(); } catch { return "git-unavailable"; }
}

async function workspaceDigests(pathspecs: string[], excludedPrefixes: string[] = []): Promise<Array<{ file: string; digest: string }>> {
  const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", ...pathspecs], { cwd: root, encoding: "utf8", windowsHide: true })
    .split(/\r?\n/).filter((file) => file && !excludedPrefixes.some((prefix) => file.startsWith(prefix)));
  const entries: Array<{ file: string; digest: string }> = [];
  for (const file of [...new Set(files)].sort()) entries.push({ file, digest: benchmarkDigest({ content: await readFile(path.join(root, file), "utf8") }) });
  return entries;
}

async function productTreeRevision(): Promise<string> {
  const product = await workspaceDigests(["app", "lib"], ["app/lib/benchmark/"]);
  const harness = await workspaceDigests(["app/lib/benchmark", "scripts/benchmark.ts", "scripts/stage9-placement-experiment.ts", "package.json", ".github/workflows/benchmark.yml"]);
  return `${gitHead()}+product-${benchmarkDigest(product).slice(7, 23)}+harness-${benchmarkDigest(harness).slice(7, 23)}`;
}

async function options(suiteId: string) {
  return { artifactRoot, repositoryRoot: root, suiteId, corpusVersion: STAGE9_CORPUS_V1.version, productUnderTest: "Sirkit", productVersion: "stage1-8-protected-baseline", codeRevision: await productTreeRevision(), cacheState: "cold" as const, scope: "local" as const };
}

async function writeExclusive(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${canonicalBenchmarkJson(value)}\n`, { flag: "wx" });
}

async function loadBaseline() {
  const index = JSON.parse(await readFile(path.join(artifactRoot, "baseline-index.json"), "utf8")) as { runIds: string[] };
  const store = new ImmutableBenchmarkStore(artifactRoot);
  return Promise.all(index.runIds.map((runId) => store.read(runId)));
}

async function main(): Promise<void> {
  const [command = "help", argument] = process.argv.slice(2);
  if (command === "validate") {
    const diagnostics = validateCorpusManifest(STAGE9_CORPUS_V1, STAGE9_CORPUS_PACKAGES);
    process.stdout.write(`${JSON.stringify({ corpus: STAGE9_CORPUS_V1.corpusId, version: STAGE9_CORPUS_V1.version, packages: STAGE9_CORPUS_PACKAGES.length, diagnostics }, null, 2)}\n`);
    if (diagnostics.some((item) => item.severity === "error")) process.exitCode = 1;
    return;
  }
  if (command === "list") {
    for (const item of STAGE9_CORPUS_PACKAGES) process.stdout.write(`${item.packageId}\t${item.partition}\t${item.tier}\t${item.taskKinds.join(",")}\n`);
    return;
  }
  if (command === "run") {
    const pkg = STAGE9_CORPUS_PACKAGES.find((item) => item.packageId === argument || item.packageId.endsWith(argument ?? ""));
    if (!pkg) throw new Error(`Unknown benchmark package: ${argument}`);
    const stored = await runBenchmarkPackage(pkg, builtinBenchmarkExecutor, { ...(await options(`single:${pkg.packageId}`)), randomSeeds: Array.from({ length: pkg.runBudgetProfile.trials }, (_, index) => index + 1) });
    process.stdout.write(`${JSON.stringify({ runId: stored.run.runId, status: stored.run.status, resultDigest: stored.result.resultDigest, directory: stored.runDirectory }, null, 2)}\n`);
    return;
  }
  if (command === "baseline") {
    await mkdir(artifactRoot, { recursive: true });
    await writeExclusive(path.join(artifactRoot, "corpus-v1.json"), { manifest: STAGE9_CORPUS_V1, packages: STAGE9_CORPUS_PACKAGES });
    const selected = STAGE9_CORPUS_PACKAGES.filter((item) => item.partition === "publicDevelopment");
    const runIds: string[] = []; const statuses: Record<string, number> = {}; const config = await options("stage9-baseline-v1");
    for (const pkg of selected) {
      const stored = await runBenchmarkPackage(pkg, builtinBenchmarkExecutor, { ...config, randomSeeds: Array.from({ length: pkg.runBudgetProfile.trials }, (_, index) => index + 1) });
      runIds.push(stored.run.runId); statuses[stored.run.status] = (statuses[stored.run.status] ?? 0) + 1;
      process.stdout.write(`${pkg.packageId}: ${stored.run.status}\n`);
    }
    await writeExclusive(path.join(artifactRoot, "baseline-index.json"), { schema: "sirkit.benchmark-baseline-index.v1", frozenAt: new Date().toISOString(), corpusId: STAGE9_CORPUS_V1.corpusId, corpusVersion: STAGE9_CORPUS_V1.version, codeRevision: config.codeRevision, runIds, statuses, immutable: true });
    return;
  }
  if (command === "report") {
    const bundles = await loadBaseline(); const summary = summarizeBenchmarkRuns(bundles.map((bundle) => ({ ...bundle, package: STAGE9_CORPUS_PACKAGES.find((pkg) => pkg.packageId === bundle.run.packageId) })));
    const index = JSON.parse(await readFile(path.join(artifactRoot, "baseline-index.json"), "utf8")) as { codeRevision: string };
    const generatedAt = new Date().toISOString();
    const summaryPath = path.join(artifactRoot, "baseline-summary.json"); const htmlPath = path.join(artifactRoot, "baseline-report.html");
    await writeExclusive(summaryPath, { schema: "sirkit.benchmark-summary.v1", generatedAt, corpusVersion: STAGE9_CORPUS_V1.version, codeRevision: index.codeRevision, summary });
    await writeFile(htmlPath, renderBenchmarkReport(summary, { title: "Sirkit Stage 9 baseline", corpusVersion: STAGE9_CORPUS_V1.version, codeRevision: index.codeRevision, generatedAt }), { flag: "wx" });
    process.stdout.write(`${summaryPath}\n${htmlPath}\n`);
    return;
  }
  if (command === "audit-baseline") {
    const bundles = await loadBaseline(); const summary = summarizeBenchmarkRuns(bundles.map((bundle) => ({ ...bundle, package: STAGE9_CORPUS_PACKAGES.find((pkg) => pkg.packageId === bundle.run.packageId) })));
    const index = JSON.parse(await readFile(path.join(artifactRoot, "baseline-index.json"), "utf8")) as { codeRevision: string; runIds: string[] };
    const generatedAt = new Date().toISOString(); const derivationRevision = await productTreeRevision();
    const audit = { schema: "sirkit.benchmark-baseline-audit.v2", generatedAt, immutableBaselineCodeRevision: index.codeRevision, derivationRevision, correction: "Feasibility now includes independent oracle failure/unknown/disagreement states; raw runs and v1 files are unchanged.", runIds: index.runIds, summary };
    const jsonPath = path.join(artifactRoot, "baseline-audit-v2.json"); const htmlPath = path.join(artifactRoot, "baseline-audit-v2.html");
    await writeExclusive(jsonPath, audit); await writeFile(htmlPath, renderBenchmarkReport(summary, { title: "Sirkit Stage 9 baseline audit v2", corpusVersion: STAGE9_CORPUS_V1.version, codeRevision: derivationRevision, generatedAt }), { flag: "wx" });
    process.stdout.write(`${jsonPath}\n${htmlPath}\n`);
    return;
  }
  if (command === "metadata") {
    const capability = { schema: "sirkit.competitive-capability-registry.v1", generatedAt: new Date().toISOString(), protocol: { ...COMPETITIVE_PROTOCOL_V1, digest: COMPETITIVE_PROTOCOL_DIGEST }, hypotheses: COMPETITIVE_CAPABILITY_REGISTRY };
    const regressionBase = { schema: REGRESSION_POLICY_VERSION, generatedAt: new Date().toISOString(), suites: REGRESSION_SUITES, budgets: REGRESSION_BUDGETS };
    const regression = { ...regressionBase, digest: benchmarkDigest(regressionBase) };
    const capabilityPath = path.join(artifactRoot, "capability-registry.json"); const regressionPath = path.join(artifactRoot, "regression-policy.json");
    await writeExclusive(capabilityPath, capability); await writeExclusive(regressionPath, regression);
    process.stdout.write(`${capabilityPath}\n${regressionPath}\n`);
    return;
  }
  if (command === "inspect") {
    const store = new ImmutableBenchmarkStore(artifactRoot); const bundle = await store.read(argument ?? ""); process.stdout.write(`${JSON.stringify(bundle, null, 2)}\n`); return;
  }
  const commands = ["validate", "list", "run <package-id-or-suffix>", "baseline", "report", "audit-baseline", "metadata", "inspect <run-id>"];
  process.stdout.write(`Sirkit benchmark CLI\n${commands.map((item) => `  ${item}`).join("\n")}\n`);
}

main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`); process.exitCode = 1; });
