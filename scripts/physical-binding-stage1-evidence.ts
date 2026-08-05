import { performance } from "node:perf_hooks";
import { evaluatePhysicalReadiness } from "../app/lib/physical-binding/readiness";
import { migrateLegacyPhysicalBinding } from "../app/lib/physical-binding/legacy";
import { physicalBindingDigest } from "../app/lib/physical-binding/stable";
import type { EngineeringActor } from "../app/lib/engineering/types";

const actor: EngineeringActor = { actorId: "qualification-migration", actorKind: "system_migration", sessionId: "stage1-evidence", role: "migration_admin" };
const now = "2026-07-18T12:00:00.000Z";
const scope = (index: number) => ({ tenantId: "qualification", projectId: "stage1-scale", branchId: "main", boardInstanceId: "board-1", componentInstanceId: `component-${index}`, hierarchyPath: ["root"], assemblyVariantIds: ["default"] });

function measured<T>(work: () => T): { elapsedMs: number; value: T } {
  const started = performance.now();
  const value = work();
  return { elapsedMs: Number((performance.now() - started).toFixed(3)), value };
}

const digests = measured(() => Array.from({ length: 10_000 }, (_, index) => physicalBindingDigest({ index, component: `component-${index}`, evidenceRefs: ["evidence-b", "evidence-a"], package: { name: "0603 imperial" } })));
const migrations = measured(() => Array.from({ length: 1_000 }, (_, index) => migrateLegacyPhysicalBinding({ sourceSchemaVersion: "sirkit.project.legacy-v3", scope: scope(index), rawComponent: { id: `component-${index}`, refDes: `C${index + 1}`, value: "100n", footprintHint: "Capacitor_SMD:C_0603_1608Metric", package: "0603", futureField: { preserved: true } }, actor, migratedAt: now })));
const assessments = measured(() => migrations.value.map((result) => evaluatePhysicalReadiness(result.candidate, { assessedAt: now })));
const candidateOrdering = measured(() => migrations.value.slice(0, 256).map((result) => result.candidate.revisionId).reverse().sort());

const evidence = {
  schemaVersion: "sirkit.physical-binding-stage1-performance-evidence.v1",
  measuredAt: now,
  environment: { platform: process.platform, architecture: process.arch, node: process.version },
  results: {
    canonicalDigests: { fixtureCount: digests.value.length, elapsedMs: digests.elapsedMs, budgetMs: 5_000, passed: digests.elapsedMs < 5_000 },
    legacyMigrationDryComputation: { fixtureCount: migrations.value.length, elapsedMs: migrations.elapsedMs, budgetMs: 5_000, passed: migrations.elapsedMs < 5_000, ambiguousCount: migrations.value.filter((result) => result.record.status === "ambiguous").length },
    readinessEvaluation: { fixtureCount: assessments.value.length, elapsedMs: assessments.elapsedMs, budgetMs: 5_000, passed: assessments.elapsedMs < 5_000, layoutReadyCount: assessments.value.filter((result) => result.layout === "ready").length, blockedCount: assessments.value.filter((result) => result.layout === "not_ready").length },
    boundedCandidateOrdering: { fixtureCount: candidateOrdering.value.length, elapsedMs: candidateOrdering.elapsedMs, budgetMs: 100, passed: candidateOrdering.elapsedMs < 100 },
  },
  caveats: ["Budgets are regression indicators for this machine, not universal hardware guarantees.", "PostgreSQL network/disk latency is not measured because qualification uses no external DATABASE_URL."],
};

if (!Object.values(evidence.results).every((result) => result.passed)) process.exitCode = 1;
process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
