import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { cpus, platform, arch, totalmem } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { computeElectricalTruth } from "../app/lib/pcb/electrical-truth";
import { runDrc } from "../app/lib/pcb/drc/run-drc";
import { getPreset } from "../app/lib/pcb/drc/presets";
import { buildRoutedDemo } from "../app/lib/pcb/demo/routed-demo";
import { affectedDerivedKinds } from "../app/lib/engineering/dependency";
import { engineeringDigest, canonicalJson } from "../app/lib/engineering/stable";
import { STAGE10_CORPUS_MANIFEST, STAGE10_SCENARIOS } from "../app/lib/engineering/stage10-corpus";
import { EngineeringTransactionService, createEngineeringTransaction } from "../app/lib/engineering/transaction-service";
import type { CanonicalProjectState } from "../app/lib/engineering/types";

const root = process.cwd(); const artifactRoot = path.join(root, "artifacts", "stage-10");
function sha256(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function gitHead(): string { try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", windowsHide: true }).trim(); } catch { return "git-unavailable"; } }
async function implementationRevision(): Promise<string> {
  const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", "app/lib/engineering", "scripts/stage10-evidence.ts", "package.json"], { cwd: root, encoding: "utf8", windowsHide: true }).split(/\r?\n/).filter(Boolean).sort(); const digests = []; for (const file of files) digests.push({ file, sha256: sha256(await readFile(path.join(root, file), "utf8")) }); return `${gitHead()}+stage10-${sha256(canonicalJson(digests)).slice(0, 20)}`;
}
function quantile(values: number[], p: number): number { const sorted = [...values].sort((a, b) => a - b); const position = (sorted.length - 1) * p; const low = Math.floor(position); const high = Math.ceil(position); return sorted[low] + (sorted[high] - sorted[low]) * (position - low); }
function stats(values: number[]) { return { samples: values.length, p50Ms: quantile(values, 0.5), p95Ms: quantile(values, 0.95), maxMs: Math.max(...values) }; }

async function main(): Promise<void> {
  const auditMode = process.argv.includes("--audit-v2");
  const board = buildRoutedDemo(); const project: CanonicalProjectState = { schemaVersion: "sirkit.engineering.v1", tenantId: "benchmark", projectId: "stage10-routed-demo", branchId: "main", pcb: board, pinnedAssets: [] }; const rules = getPreset("jlcpcb-2l").rules; const electricalMs: number[] = []; const drcMs: number[] = [];
  for (let index = 0; index < 30; index += 1) { let started = performance.now(); computeElectricalTruth(board); electricalMs.push(performance.now() - started); started = performance.now(); runDrc(board, rules); drcMs.push(performance.now() - started); }
  const commitMs: number[] = []; let exampleChange;
  for (let index = 0; index < 20; index += 1) { const service = await EngineeringTransactionService.open(project, { buildId: "stage10-evidence" }); const operation = { operationId: `move:${index}`, schemaVersion: 1 as const, units: "nm" as const, kind: "move_footprint" as const, footprintId: board.footprints[0].id, at: { x: board.footprints[0].at.x + index + 1, y: board.footprints[0].at.y } }; const baseRevision = service.currentRevision(); const transaction = createEngineeringTransaction({ transactionId: `benchmark:tx:${index}`, projectId: project.projectId, branchId: project.branchId, clientOperationId: `benchmark:client:${index}`, actor: { actorId: "benchmark", actorKind: "human", sessionId: "benchmark", role: "project_admin" }, reason: "Stage 10 commit latency evidence", baseRevision, operations: [operation], approvals: [], provenance: { source: "api", toolVersion: "stage10-evidence" } }); const started = performance.now(); const result = await service.submit(transaction); commitMs.push(performance.now() - started); if (result.state !== "accepted") throw new Error(`benchmark transaction failed: ${result.state}`); exampleChange ??= result.record.appliedChangeSet; }
  const stage9Audit = await readFile(path.join(root, "artifacts", "stage-09", "baseline-audit-v2.json"), "utf8").then((value) => JSON.parse(value) as { summary: { statusDenominators: Record<string, number> } }).catch(() => undefined);
  const evidenceBase = { schema: auditMode ? "sirkit.stage10-foundation-evidence-audit.v2" : "sirkit.stage10-foundation-evidence.v1", generatedAt: new Date().toISOString(), implementationRevision: await implementationRevision(), environment: { platform: platform(), architecture: arch(), node: process.version, cpu: cpus()[0]?.model ?? "unknown", logicalCores: cpus().length, memoryMiB: Math.round(totalmem() / 1_048_576) }, project: { fixture: "buildRoutedDemo", footprints: board.footprints.length, pads: board.footprints.reduce((sum, item) => sum + item.def.pads.length, 0), nets: board.nets.length, tracks: board.tracks.length, vias: board.vias.length, zones: board.zones.length }, baselines: { fullElectricalTruth: stats(electricalMs), fullDrc: stats(drcMs), semanticCommitAndSynchronousInvalidation: stats(commitMs) }, dependencyFanout: exampleChange ? affectedDerivedKinds(exampleChange).length : 0, stage9BaselineStatuses: stage9Audit?.summary.statusDenominators ?? { evidence_unavailable: 1 }, corpus: { manifest: STAGE10_CORPUS_MANIFEST, scenarios: STAGE10_SCENARIOS }, proofSummary: { focusedTestCategoriesImplemented: ["semantic operations", "revision coverage", "change sets", "dependency invalidation", "atomic persistence faults", "idempotency", "integrity/restore", "migration", "writer lock", "collaboration rebase/conflict", "per-actor undo", "proposal review", "scheduler stale rejection", "shadow divergence", "authorization/AI scope", "rollout circuit breaker"], explicitFallbacks: ["connectivity affected edits use full oracle", "DRC checkers remain full-only", "constraint/readiness evaluators remain full-only", "selective incremental reads disabled"], completionVerdict: "STAGE 10 INCOMPLETE" } };
  const evidence = { ...evidenceBase, digest: engineeringDigest(evidenceBase) }; await mkdir(artifactRoot, { recursive: true }); const evidenceName = auditMode ? "foundation-evidence-audit-v2.json" : "foundation-evidence.json"; await writeFile(path.join(artifactRoot, evidenceName), `${canonicalJson(evidence)}\n`, { flag: "wx" }); if (!auditMode) await writeFile(path.join(artifactRoot, "corpus-v1.json"), `${canonicalJson({ manifest: STAGE10_CORPUS_MANIFEST, scenarios: STAGE10_SCENARIOS })}\n`, { flag: "wx" }); process.stdout.write(`${JSON.stringify({ artifactRoot, evidenceName, digest: evidence.digest, baselines: evidence.baselines }, null, 2)}\n`);
}

main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`); process.exitCode = 1; });
